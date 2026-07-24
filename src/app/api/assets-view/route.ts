import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import sharp from 'sharp';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import { resolveAccountAssetFilePath } from '@/lib/account-assets';

const THUMBNAIL_MIN_WIDTH = 160;
const THUMBNAIL_MAX_WIDTH = 1600;
const THUMBNAIL_MIN_QUALITY = 45;
const THUMBNAIL_MAX_QUALITY = 88;

function clampInteger(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function getThumbnailBuffer(filePath: string, width: number, quality: number) {
  const sourceStats = await fs.promises.stat(filePath);
  const cacheDirectory = path.join(path.dirname(filePath), '.thumbnails');
  const sourceIdentity = createHash('sha256')
    .update(`${path.basename(filePath)}:${sourceStats.size}:${sourceStats.mtimeMs}`)
    .digest('hex')
    .slice(0, 24);
  const cacheName = `${sourceIdentity}-${width}-${quality}.webp`;
  const cachePath = path.join(cacheDirectory, cacheName);

  try {
    return await fs.promises.readFile(cachePath);
  } catch {
    await fs.promises.mkdir(cacheDirectory, { recursive: true });
  }

  const thumbnail = await sharp(filePath, { failOn: 'none' })
    .rotate()
    .resize({
      width,
      height: width,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality, effort: 1 })
    .toBuffer();

  const temporaryPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.promises.writeFile(temporaryPath, thumbnail);
    await fs.promises.rename(temporaryPath, cachePath);
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
    if (!fs.existsSync(cachePath)) throw error;
  }

  return thumbnail;
}

// 查看本地资产图片（用于页面显示）
export async function GET(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const folder = searchParams.get('folder');
    const filename = searchParams.get('filename');
    const wantsThumbnail = searchParams.get('thumbnail') === '1';
    const thumbnailWidth = clampInteger(searchParams.get('width'), 720, THUMBNAIL_MIN_WIDTH, THUMBNAIL_MAX_WIDTH);
    const thumbnailQuality = clampInteger(searchParams.get('quality'), 72, THUMBNAIL_MIN_QUALITY, THUMBNAIL_MAX_QUALITY);
    
    if (!folder || !filename) {
      return NextResponse.json({
        success: false,
        error: '缺少参数',
      }, { status: 400 });
    }
    
    const filePath = resolveAccountAssetFilePath(auth.account, folder, filename);
    if (!filePath) {
      return NextResponse.json({
        success: false,
        error: '无效的资产路径',
      }, { status: 400 });
    }
    
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return NextResponse.json({
        success: false,
        error: '文件不存在',
      }, { status: 404 });
    }
    
    // 确定文件类型
    const ext = path.extname(filename).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
    };
    
    const contentType = contentTypes[ext] || 'application/octet-stream';

    if (wantsThumbnail && contentType.startsWith('image/')) {
      const thumbnail = await getThumbnailBuffer(filePath, thumbnailWidth, thumbnailQuality);
      return new NextResponse(new Uint8Array(thumbnail), {
        headers: {
          'Content-Type': 'image/webp',
          'Cache-Control': 'private, max-age=31536000, immutable',
          'Content-Length': thumbnail.length.toString(),
          'X-Asset-Variant': 'thumbnail',
        },
      });
    }

    // 原图仅在预览、下载等明确请求时读取，缩略图请求不再同步加载整张原图。
    const fileBuffer = await fs.promises.readFile(filePath);
    
    // 设置缓存头，让浏览器缓存图片
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=31536000, immutable',
        'Content-Length': fileBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('查看文件失败:', error);
    return NextResponse.json({
      success: false,
      error: '查看文件失败',
    }, { status: 500 });
  }
}
