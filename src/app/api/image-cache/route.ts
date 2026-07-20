import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { getAccountAssetsPath } from '@/lib/account-assets';
import { requireUserLoginResponse } from '@/lib/auth-guard';

const MIN_WIDTH = 160;
const MAX_WIDTH = 1800;
const MIN_QUALITY = 45;
const MAX_QUALITY = 88;
const MAX_REMOTE_IMAGE_BYTES = 50 * 1024 * 1024;
const REMOTE_FETCH_TIMEOUT_MS = 45_000;
const MAX_REDIRECTS = 4;

const KNOWN_IMAGE_HOST_SUFFIXES = [
  '.volces.com',
  '.myqcloud.com',
  '.runninghub.cn',
  '.aliyuncs.com',
];

const globalWithRemoteImageCache = globalThis as typeof globalThis & {
  __remoteImageCachePending?: Map<string, Promise<void>>;
};

const pendingRemoteDownloads = globalWithRemoteImageCache.__remoteImageCachePending ?? new Map<string, Promise<void>>();
globalWithRemoteImageCache.__remoteImageCachePending = pendingRemoteDownloads;

function clampInteger(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function getConfiguredStorageHostname() {
  try {
    return new URL(process.env.COZE_BUCKET_ENDPOINT_URL || '').hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isAllowedRemoteImageUrl(value: URL) {
  if (value.protocol !== 'https:' && value.protocol !== 'http:') return false;
  const hostname = value.hostname.toLowerCase();
  const configuredStorageHostname = getConfiguredStorageHostname();
  if (configuredStorageHostname && hostname === configuredStorageHostname) return true;
  return KNOWN_IMAGE_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix));
}

async function fetchRemoteImage(sourceUrl: URL): Promise<{ buffer: Buffer; contentType: string }> {
  let currentUrl = sourceUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    if (!isAllowedRemoteImageUrl(currentUrl)) {
      throw new Error(`不允许缓存该图片域名: ${currentUrl.hostname}`);
    }

    const response = await fetch(currentUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS),
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*',
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`远程图片重定向缺少地址 (${response.status})`);
      currentUrl = new URL(location, currentUrl);
      continue;
    }

    if (!response.ok) {
      throw new Error(`远程图片读取失败 (${response.status})`);
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    if (!contentType.startsWith('image/')) {
      throw new Error(`远程文件不是图片: ${contentType}`);
    }

    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > MAX_REMOTE_IMAGE_BYTES) {
      throw new Error('远程图片超过 50MB，无法生成预览');
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_REMOTE_IMAGE_BYTES) {
      throw new Error('远程图片为空或超过 50MB');
    }

    return { buffer, contentType };
  }

  throw new Error('远程图片重定向次数过多');
}

function getRemoteImageIdentity(sourceUrl: URL) {
  const identityUrl = new URL(sourceUrl);
  identityUrl.search = '';
  identityUrl.hash = '';
  return createHash('sha256').update(identityUrl.toString()).digest('hex');
}

async function ensureRemoteImageCached(sourceUrl: URL, sourcePath: string) {
  try {
    const stats = await fs.promises.stat(sourcePath);
    if (stats.isFile() && stats.size > 0) return;
  } catch {
    // 首次读取时进入下载流程。
  }

  const existingDownload = pendingRemoteDownloads.get(sourcePath);
  if (existingDownload) {
    await existingDownload;
    return;
  }

  const download = (async () => {
    const { buffer } = await fetchRemoteImage(sourceUrl);
    await fs.promises.mkdir(path.dirname(sourcePath), { recursive: true });
    const temporaryPath = `${sourcePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.promises.writeFile(temporaryPath, buffer);
      await fs.promises.rename(temporaryPath, sourcePath);
    } catch (error) {
      await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  })();

  pendingRemoteDownloads.set(sourcePath, download);
  try {
    await download;
  } finally {
    pendingRemoteDownloads.delete(sourcePath);
  }
}

async function getCachedThumbnail(sourcePath: string, thumbnailPath: string, width: number, quality: number) {
  try {
    return await fs.promises.readFile(thumbnailPath);
  } catch {
    await fs.promises.mkdir(path.dirname(thumbnailPath), { recursive: true });
  }

  const thumbnail = await sharp(sourcePath, { failOn: 'none' })
    .rotate()
    .resize({
      width,
      height: width,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality, effort: 4 })
    .toBuffer();

  const temporaryPath = `${thumbnailPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.promises.writeFile(temporaryPath, thumbnail);
    await fs.promises.rename(temporaryPath, thumbnailPath);
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
    try {
      return await fs.promises.readFile(thumbnailPath);
    } catch {
      throw error;
    }
  }

  return thumbnail;
}

export async function GET(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  const source = request.nextUrl.searchParams.get('src')?.trim() || '';
  if (!source) {
    return NextResponse.json({ error: '缺少远程图片地址' }, { status: 400 });
  }

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(source);
  } catch {
    return NextResponse.json({ error: '远程图片地址无效' }, { status: 400 });
  }

  // 非本站生成图片继续由浏览器直连，避免把代理接口变成任意网址抓取器。
  if (!isAllowedRemoteImageUrl(sourceUrl)) {
    return NextResponse.redirect(sourceUrl, 307);
  }

  try {
    const width = clampInteger(request.nextUrl.searchParams.get('width'), 900, MIN_WIDTH, MAX_WIDTH);
    const quality = clampInteger(request.nextUrl.searchParams.get('quality'), 72, MIN_QUALITY, MAX_QUALITY);
    const cacheIdentity = getRemoteImageIdentity(sourceUrl);
    const cacheDirectory = path.join(getAccountAssetsPath(auth.account), '.remote-image-cache');
    const sourcePath = path.join(cacheDirectory, `${cacheIdentity}.source`);
    const thumbnailPath = path.join(cacheDirectory, `${cacheIdentity}-${width}-${quality}.webp`);

    await ensureRemoteImageCached(sourceUrl, sourcePath);
    const thumbnail = await getCachedThumbnail(sourcePath, thumbnailPath, width, quality);

    return new NextResponse(new Uint8Array(thumbnail), {
      headers: {
        'Content-Type': 'image/webp',
        'Content-Length': String(thumbnail.length),
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Image-Cache': 'hit',
      },
    });
  } catch (error) {
    console.warn('[远程图片缓存] 生成缩略图失败，回退为原始地址:', error);
    return NextResponse.redirect(sourceUrl, 307);
  }
}
