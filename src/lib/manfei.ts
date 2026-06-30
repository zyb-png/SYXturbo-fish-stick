import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { TosClient } from '@volcengine/tos-sdk';
import {
  getAssetStorageConfigSync,
  getManfeiConfigSync,
} from './app-settings';

type ManfeiAssetCacheRecord = {
  assetId: string;
  objectKey?: string;
  status: string;
  updatedAt: string;
};

type ManfeiAssetCache = {
  version: number;
  records: Record<string, ManfeiAssetCacheRecord>;
};

export type ManfeiVideoStatus = {
  taskId: string;
  status: string;
  videoUrl?: string;
  error?: string;
  usage?: unknown;
};

export type ManfeiTaskBilling = {
  taskId: string;
  amountRmb: number;
  itemCount: number;
  endpoints: string[];
};

const ASSET_STATUS_TIMEOUT_MS = 180_000;
const ASSET_STATUS_POLL_MS = 2_000;
const inFlightAssets = new Map<string, Promise<string>>();
let cacheWriteQueue = Promise.resolve();

function readAssetsPath(): string {
  const configPath = path.join(process.cwd(), 'assets-config.json');
  let assetsPath = path.join(process.cwd(), 'assets');

  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (typeof config.assetsPath === 'string' && config.assetsPath.trim()) {
        assetsPath = path.isAbsolute(config.assetsPath)
          ? config.assetsPath
          : path.join(process.cwd(), config.assetsPath);
      }
    }
  } catch (error) {
    console.warn('[manfei] 读取资产路径失败，使用默认路径:', error);
  }

  return assetsPath;
}

function getCachePath(): string {
  return path.join(readAssetsPath(), 'project-state', 'manfei-assets.json');
}

async function readCache(): Promise<ManfeiAssetCache> {
  try {
    const parsed = JSON.parse(await fsp.readFile(getCachePath(), 'utf-8'));
    return {
      version: 1,
      records: parsed?.records && typeof parsed.records === 'object' ? parsed.records : {},
    };
  } catch {
    return { version: 1, records: {} };
  }
}

async function updateCache(hash: string, record: ManfeiAssetCacheRecord): Promise<void> {
  const run = cacheWriteQueue.then(async () => {
    const cache = await readCache();
    cache.records[hash] = record;
    const cachePath = getCachePath();
    await fsp.mkdir(path.dirname(cachePath), { recursive: true });
    await fsp.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf-8');
  });
  cacheWriteQueue = run.catch(() => undefined);
  await run;
}

function getContentType(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.bmp') return 'image/bmp';
  if (extension === '.tiff' || extension === '.tif') return 'image/tiff';
  return 'image/png';
}

function getFileExtension(contentType: string): string {
  if (contentType.includes('jpeg')) return '.jpg';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('gif')) return '.gif';
  if (contentType.includes('bmp')) return '.bmp';
  if (contentType.includes('tiff')) return '.tiff';
  return '.png';
}

function resolveLocalAssetPath(url: string): { filePath: string; contentType: string } | null {
  const parsed = new URL(url, 'http://localhost');
  if (parsed.pathname !== '/api/assets-view') return null;

  const folder = parsed.searchParams.get('folder');
  const filename = parsed.searchParams.get('filename');
  if (!folder || !filename) return null;

  const safeFolder = path.basename(folder);
  const safeFilename = path.basename(filename);
  return {
    filePath: path.join(readAssetsPath(), safeFolder, safeFilename),
    contentType: getContentType(safeFilename),
  };
}

function isPublicHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    return !(
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.endsWith('.local') ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    );
  } catch {
    return false;
  }
}

async function loadImageSource(url: string): Promise<{
  buffer?: Buffer;
  contentType?: string;
  publicUrl?: string;
}> {
  if (isPublicHttpUrl(url)) {
    return { publicUrl: url };
  }

  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;,]+)?(?:;base64)?,([\s\S]*)$/);
    if (!match) throw new Error('图片 Base64 格式无效');
    const contentType = match[1] || 'image/png';
    return {
      buffer: Buffer.from(match[2], url.includes(';base64,') ? 'base64' : 'utf8'),
      contentType,
    };
  }

  const localAsset = resolveLocalAssetPath(url);
  if (!localAsset || !fs.existsSync(localAsset.filePath)) {
    throw new Error(`无法读取本地素材：${url}`);
  }

  return {
    buffer: await fsp.readFile(localAsset.filePath),
    contentType: localAsset.contentType,
  };
}

function normalizeTosEndpoint(endpointUrl: string): string {
  try {
    return new URL(endpointUrl.includes('://') ? endpointUrl : `https://${endpointUrl}`).hostname;
  } catch {
    return endpointUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }
}

async function uploadToPublicStorage(
  buffer: Buffer,
  contentType: string,
  hash: string,
): Promise<{ publicUrl: string; objectKey: string }> {
  const config = getAssetStorageConfigSync();
  const bucket = config.accessPointAlias || config.bucketName;
  if (
    !config.endpointUrl ||
    !bucket ||
    !config.accessKeyId ||
    !config.secretAccessKey
  ) {
    throw new Error('本地图片需要先上传到火山 TOS。素材存储未配置，请联系管理员');
  }

  const key = `manfei-assets/${hash}${getFileExtension(contentType)}`;
  const client = new TosClient({
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.secretAccessKey,
    region: config.region || 'cn-beijing',
    endpoint: normalizeTosEndpoint(config.endpointUrl),
    bucket,
  });

  await client.putObject({
    key,
    body: buffer,
    contentType,
    cacheControl: 'private, max-age=31536000, immutable',
  });

  return {
    objectKey: key,
    publicUrl: client.getPreSignedUrl({
      key,
      method: 'GET',
      expires: 6 * 60 * 60,
    }),
  };
}

async function manfeiFetch(pathname: string, init?: RequestInit): Promise<Response> {
  const config = getManfeiConfigSync();
  if (!config.apiKey) {
    throw new Error('未配置 manfei Token，请联系管理员配置视频生成接口');
  }

  return fetch(`${config.baseUrl}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
}

async function waitForAssetActive(assetId: string): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < ASSET_STATUS_TIMEOUT_MS) {
    const response = await manfeiFetch(`/v1/assets/${encodeURIComponent(assetId)}`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`查询素材资产失败：HTTP ${response.status} ${JSON.stringify(body).slice(0, 300)}`);
    }

    const status = String(body.status || '').toLowerCase();
    if (status === 'active') return;
    if (['failed', 'error', 'deleted', 'expired'].includes(status)) {
      throw new Error(`素材资产不可用：${body.status || '未知状态'}`);
    }

    await new Promise(resolve => setTimeout(resolve, ASSET_STATUS_POLL_MS));
  }

  throw new Error(`素材资产准备超时：${assetId}`);
}

async function createAsset(publicUrl: string): Promise<string> {
  const response = await manfeiFetch('/v1/assets', {
    method: 'POST',
    body: JSON.stringify({
      url: publicUrl,
      asset_type: 'Image',
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`创建素材资产失败：HTTP ${response.status} ${JSON.stringify(body).slice(0, 500)}`);
  }

  const assetId = body.asset_id || body.id || body.Result?.Id;
  if (!assetId) throw new Error('创建素材资产成功，但接口未返回 asset_id');
  await waitForAssetActive(assetId);
  return assetId;
}

export async function prepareManfeiImageAsset(url: string): Promise<string> {
  const source = await loadImageSource(url);
  let hash: string;

  if (source.buffer) {
    hash = crypto.createHash('sha256').update(source.buffer).digest('hex');
  } else {
    hash = crypto.createHash('sha256').update(source.publicUrl || url).digest('hex');
  }

  const existingPromise = inFlightAssets.get(hash);
  if (existingPromise) return existingPromise;

  const promise = (async () => {
    const cache = await readCache();
    const cached = cache.records[hash];
    if (cached?.assetId && cached.status === 'Active') {
      return cached.assetId;
    }

    const uploaded = source.publicUrl
      ? { publicUrl: source.publicUrl, objectKey: undefined }
      : await uploadToPublicStorage(
        source.buffer as Buffer,
        source.contentType || 'image/png',
        hash,
      );
    const publicUrl = uploaded.publicUrl;
    const assetId = await createAsset(publicUrl);
    await updateCache(hash, {
      assetId,
      objectKey: uploaded.objectKey,
      status: 'Active',
      updatedAt: new Date().toISOString(),
    });
    return assetId;
  })();

  inFlightAssets.set(hash, promise);
  try {
    return await promise;
  } finally {
    inFlightAssets.delete(hash);
  }
}

export async function prepareManfeiImageAssets(urls: string[], concurrency = 4): Promise<string[]> {
  const uniqueUrls = Array.from(new Set(urls.filter(Boolean))).slice(0, 9);
  const results = new Array<string>(uniqueUrls.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, uniqueUrls.length) }, async () => {
    while (cursor < uniqueUrls.length) {
      const index = cursor++;
      results[index] = await prepareManfeiImageAsset(uniqueUrls[index]);
    }
  });

  await Promise.all(workers);
  return results.filter(Boolean);
}

export async function createManfeiVideoTask(input: {
  prompt: string;
  assetIds: string[];
  duration: number;
  ratio: string;
}): Promise<string> {
  const config = getManfeiConfigSync();
  const content = [
    ...input.assetIds.slice(0, 9).map(assetId => ({
      type: 'image_url',
      image_url: { url: `asset://${assetId}` },
      role: 'reference_image',
    })),
    {
      type: 'text',
      text: input.prompt,
    },
  ];

  const response = await manfeiFetch('/v1/video/tasks', {
    method: 'POST',
    body: JSON.stringify({
      model: 'moon-manfei-new',
      content,
      duration: input.duration,
      ratio: input.ratio,
      watermark: false,
      resolution: '720p',
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`创建视频任务失败：HTTP ${response.status} ${JSON.stringify(body).slice(0, 500)}`);
  }

  const taskId = body.id || body.task_id;
  if (!taskId) throw new Error('视频任务创建成功，但接口未返回任务 ID');
  console.log(`[manfei] 视频任务已创建: ${taskId}, 模型 ${config.model}, 分辨率 ${config.resolution}`);
  return taskId;
}

export async function getManfeiVideoStatus(taskId: string): Promise<ManfeiVideoStatus> {
  const response = await manfeiFetch(`/v1/video/tasks/${encodeURIComponent(taskId)}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      taskId,
      status: 'query_error',
      error: `查询视频任务失败：HTTP ${response.status} ${JSON.stringify(body).slice(0, 300)}`,
    };
  }

  const status = String(body.status || '').toLowerCase();
  const videoUrl =
    body.content?.video_url ||
    body.video_url ||
    body.result_url ||
    body.output?.video_url;

  return {
    taskId,
    status,
    videoUrl,
    error: body.error || body.message || body.detail?.message,
    usage: body.usage,
  };
}

function normalizeAmountRmb(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

export async function getManfeiTaskBilling(
  taskId: string,
  options: { limit?: number; pages?: number } = {},
): Promise<ManfeiTaskBilling | null> {
  const limit = Math.min(200, Math.max(1, Math.round(Number(options.limit) || 200)));
  const pages = Math.min(10, Math.max(1, Math.round(Number(options.pages) || 5)));
  let amountRmb = 0;
  let itemCount = 0;
  const endpoints = new Set<string>();

  for (let page = 0; page < pages; page++) {
    const offset = page * limit;
    const response = await manfeiFetch(`/v1/usage?limit=${limit}&offset=${offset}&charged_only=true`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`查询 Manfei 账单失败：HTTP ${response.status} ${JSON.stringify(body).slice(0, 300)}`);
    }

    const items = Array.isArray(body.items) ? body.items : [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      if (record.task_id !== taskId) continue;
      amountRmb += normalizeAmountRmb(record.amount_rmb);
      itemCount += 1;
      if (typeof record.endpoint === 'string' && record.endpoint) endpoints.add(record.endpoint);
    }

    if (items.length < limit) break;
  }

  if (itemCount === 0) return null;
  return {
    taskId,
    amountRmb: Number(amountRmb.toFixed(6)),
    itemCount,
    endpoints: Array.from(endpoints),
  };
}

export async function waitForManfeiTaskBilling(
  taskId: string,
  options: {
    attempts?: number;
    intervalMs?: number;
    limit?: number;
    pages?: number;
  } = {},
): Promise<ManfeiTaskBilling | null> {
  const attempts = Math.min(20, Math.max(1, Math.round(Number(options.attempts) || 1)));
  const intervalMs = Math.min(30_000, Math.max(0, Math.round(Number(options.intervalMs) || 0)));

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0 && intervalMs > 0) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    const billing = await getManfeiTaskBilling(taskId, {
      limit: options.limit,
      pages: options.pages,
    });
    if (billing) return billing;
  }

  return null;
}
