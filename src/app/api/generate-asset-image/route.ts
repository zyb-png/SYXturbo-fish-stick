import { NextRequest, NextResponse } from 'next/server';
import { S3Storage } from 'coze-coding-dev-sdk';
import fs from 'fs';
import path from 'path';
import { getRunningHubConfigSync } from '@/lib/app-settings';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import {
  completeCreationPointTask,
  failCreationPointTask,
  freezeCreationPoints,
  InsufficientCreationPointsError,
} from '@/lib/creation-points';
import { calculateImageCreationPoints } from '@/lib/provider-pricing';
import { getAccountAssetsPath, getAccountRemoteKey } from '@/lib/account-assets';
import type { PublicAccount } from '@/lib/account-store';
import {
  formatCharacterBodyProfile,
  mergeCharacterBodyProfiles,
  normalizeCharacterBodyProfile,
  stripBodyDetailsFromAppearance,
} from '@/lib/character-body-profile';
import {
  getAnimalCreaturePromptDirectives,
  inferCharacterEntityKind,
  resolveCharacterGenderByPolicy,
} from '@/lib/character-semantic-rules';

// 图片数量限制
const MAX_IMAGES_PER_ASSET = 3;

// RunningHub API 配置
const TEXT_TO_IMAGE_MODEL = 'runninghub/rhart-image-g-2-official/text-to-image';
const IMAGE_TO_IMAGE_MODEL = 'runninghub/rhart-image-g-2/image-to-image';

const STYLIZED_3D_CHARACTER_PROMPT = [
  '高端院线级风格化3D动画电影美术，圆润简洁的造型语言，略微夸张但协调自然的角色比例，精致干净的面部建模，柔和且富有表现力的五官设计。',
  '皮肤光滑细腻，带有轻微自然的次表面散射，材质柔润但不过度塑料化。',
  '头发采用清晰的雕塑式发束结构，同时保留细腻发丝层次。',
  '高品质PBR材质，精致抛光的CGI质感。',
  '柔和的摄影棚主光，轻微轮廓光，柔软自然的阴影，电影级光影层次，浅景深，干净简洁的背景。',
  '色彩饱满但克制，电影级调色，画面精致、清晰、统一，高品质物理渲染。',
].join('');

const STYLIZED_3D_CHARACTER_STYLE_LOCK =
  '【3D风格最终锁定】必须输出明确可辨的风格化3D动画电影角色CGI渲染，不是真人照片，不是由真人照片轻度磨皮得到的效果，不是2D插画；保持圆润简洁且略微夸张的造型、高品质PBR材质和自然次表面散射，避免写实真人毛孔、真人摄影感、蜡像感和廉价塑料玩具感';

const STYLIZED_3D_ASSET_STYLE_LOCK = [
  '【3D统一美术总控】人物、场景和道具必须属于同一部高端院线级风格化3D动画电影。',
  '统一使用圆润简洁、略微夸张但协调自然的造型语言，清楚的体块与轮廓，高品质PBR材质分区，柔和主光、轻微轮廓光、自然受控的阴影和电影级色彩管理。',
  '材质精致但经过动画化概括，细节密度、表面粗糙度、色彩饱和度、光源方向和渲染完成度在人物、场景和道具之间保持一致。',
].join('');

const STYLIZED_3D_ASSET_NEGATIVE_LOCK =
  '【3D禁止项】禁止真人照片、实拍摄影、照片贴图直出、写实真人皮肤；禁止2D插画、赛璐璐平涂、厚涂概念画；禁止低模游戏截图、像素风、黏土定格、蜡像、廉价塑料玩具和过度写实到难以辨认为动画的效果';

const STYLIZED_3D_ASSET_FINAL_LOCK =
  '【3D最终锁定】最终输出必须是统一的风格化3D动画电影CGI渲染：清晰体块、高品质PBR材质、柔和电影光影；不得呈现真人实拍、2D插画、低模游戏或廉价塑料效果';

const TWO_D_ANIME_STYLE_LOCK = [
  '【2D动漫统一美术总控】纯二维手绘动画电影美术，人物、场景和道具必须使用同一套视觉语言。',
  '使用干净稳定的中细线稿与清楚轮廓，线条有轻微粗细变化；以平整色块和精细赛璐璐上色为主，阴影控制在两到三层，辅以柔和环境光和少量空气透视。',
  '材质通过二维线条、色块、明暗和高光概括表达，保留动画设计感，不追求照片级纹理；色彩饱满但克制，层次清楚，画面精致统一，达到院线级二维动画电影完成度。',
].join('');

const TWO_D_ANIME_NEGATIVE_LOCK =
  '【2D动漫禁止项】禁止真人照片、实拍摄影、照片贴图、写实皮肤与写实产品摄影；禁止3D、CGI、PBR材质、光线追踪、游戏引擎渲染、塑料模型、黏土感；禁止厚涂写实油画、水彩晕染、素描草稿和低幼简笔画';

const TWO_D_ANIME_FINAL_LOCK =
  '【2D最终锁定】最终输出必须是纯二维动画电影赛璐璐精修图：可见稳定线稿、平整色块、两到三层明确明暗；不得呈现照片、3D、CGI、PBR或厚涂写实效果';

function buildRunningHubEndpoints(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    textToImage: `${base}/rhart-image-g-2-official/text-to-image`,
    imageToImage: `${base}/rhart-image-g-2/image-to-image`,
    query: `${base}/query`,
    mediaUpload: `${base}/media/upload/binary`,
  };
}

// 图片尺寸配置
const IMAGE_SIZES = {
  scene: { size: '4096x4096', ratio: '16:9' },
  prop: { size: '4096x4096', ratio: '1:1' },
  character: { size: '4096x4096', ratio: '9:16' },
};

// 宽高比映射
const ASPECT_RATIO_MAP: Record<string, string> = {
  '16:9': '16:9',
  '1:1': '1:1',
  '9:16': '9:16',
  '4:3': '4:3',
  '3:4': '3:4',
  '21:9': '21:9',
  '9:21': '9:21',
  '2:1': '2:1',
  '1:2': '1:2',
};

function readPositiveInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// 2K 图片在上游排队时可能超过 3 分钟。默认等待 10 分钟，并允许部署时覆盖。
const MAX_POLL_RETRIES = readPositiveInt('ASSET_IMAGE_MAX_POLL_RETRIES', 200);
const POLL_INTERVAL_MS = readPositiveInt('ASSET_IMAGE_POLL_INTERVAL_MS', 3000);
const QUERY_NETWORK_RETRIES = readPositiveInt('ASSET_IMAGE_QUERY_NETWORK_RETRIES', 3);
const NETWORK_RETRY_DELAY_MS = readPositiveInt('ASSET_IMAGE_NETWORK_RETRY_DELAY_MS', 1200);

const ASSET_FOLDERS: Record<string, string> = {
  scene: '场景图片',
  character: '人物图片',
  prop: '道具图片',
};

function getContentTypeFromFileName(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/png';
}

function getExtensionFromContentType(contentType: string): string {
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  return 'png';
}

function isLocalHostName(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function resolveLocalAssetFilePath(account: PublicAccount, urlString: string): { filePath: string; contentType: string } | null {
  const url = new URL(urlString, 'http://localhost');
  if (url.pathname !== '/api/assets-view') return null;

  const folder = url.searchParams.get('folder');
  const filename = url.searchParams.get('filename');
  const allowedFolders = new Set(Object.values(ASSET_FOLDERS));
  if (!folder || !filename || !allowedFolders.has(folder)) return null;

  const safeFilename = path.basename(filename);
  if (!safeFilename || safeFilename !== filename) return null;

  return {
    filePath: path.join(getAccountAssetsPath(account), folder, safeFilename),
    contentType: getContentTypeFromFileName(safeFilename),
  };
}

async function readReferenceImage(
  account: PublicAccount,
  imageUrl: string,
  request: NextRequest
): Promise<{ buffer: Buffer; fileName: string; contentType: string } | null> {
  const value = imageUrl.trim();
  if (!value) return null;

  const dataUrlMatch = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (dataUrlMatch) {
    const contentType = dataUrlMatch[1];
    return {
      buffer: Buffer.from(dataUrlMatch[2], 'base64'),
      fileName: `asset-reference.${getExtensionFromContentType(contentType)}`,
      contentType,
    };
  }

  const localAsset = resolveLocalAssetFilePath(account, value);
  if (localAsset) {
    try {
      return {
        buffer: await fs.promises.readFile(localAsset.filePath),
        fileName: path.basename(localAsset.filePath),
        contentType: localAsset.contentType,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`参考图“${path.basename(localAsset.filePath)}”已不存在，请重新生成或选择有效参考图后再试`);
      }
      throw error;
    }
  }

  const parsed = new URL(value, request.url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  let lastError: unknown;
  for (let attempt = 1; attempt <= QUERY_NETWORK_RETRIES; attempt++) {
    try {
      const response = await fetch(parsed.toString());
      if (!response.ok) {
        const referenceError = new Error(`读取参考图失败 (${response.status})`);
        if (attempt < QUERY_NETWORK_RETRIES && isRetryableHttpStatus(response.status)) {
          lastError = referenceError;
          await waitBeforeNetworkRetry(attempt);
          continue;
        }
        throw referenceError;
      }
      const contentType = response.headers.get('content-type') || 'image/png';
      if (!contentType.startsWith('image/')) {
        throw new Error(`参考图不是图片类型: ${contentType}`);
      }

      return {
        buffer: Buffer.from(await response.arrayBuffer()),
        fileName: `asset-reference.${getExtensionFromContentType(contentType)}`,
        contentType,
      };
    } catch (error) {
      lastError = error;
      if (attempt >= QUERY_NETWORK_RETRIES || !isTransientNetworkError(error)) throw error;
      await waitBeforeNetworkRetry(attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('读取参考图失败');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTransientNetworkError(error: unknown): boolean {
  const nestedCause = error && typeof error === 'object' && 'cause' in error
    ? (error as { cause?: unknown }).cause
    : undefined;
  const message = `${errorMessage(error)} ${errorMessage(nestedCause)}`.toLowerCase();
  return [
    'fetch failed',
    'econnreset',
    'etimedout',
    'econnrefused',
    'socket hang up',
    'network',
    'terminated',
  ].some(keyword => message.includes(keyword));
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function waitBeforeNetworkRetry(attempt: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, NETWORK_RETRY_DELAY_MS * attempt));
}

async function queryRunningHubTask(
  apiKey: string,
  endpoints: ReturnType<typeof buildRunningHubEndpoints>,
  taskId: string,
  label: string
): Promise<any> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= QUERY_NETWORK_RETRIES; attempt++) {
    try {
      const queryResponse = await fetch(endpoints.query, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: Buffer.from(JSON.stringify({ taskId }), 'utf-8'),
      });

      const responseText = await queryResponse.text();
      if (!queryResponse.ok) {
        const queryError = new Error(`RunningHub ${label}查询失败 (${queryResponse.status}): ${responseText.slice(0, 300)}`);
        if (attempt < QUERY_NETWORK_RETRIES && isRetryableHttpStatus(queryResponse.status)) {
          lastError = queryError;
          console.warn(`[RunningHub] ${label}任务 ${taskId} 查询暂时失败，第 ${attempt}/${QUERY_NETWORK_RETRIES} 次重试`);
          await waitBeforeNetworkRetry(attempt);
          continue;
        }
        throw queryError;
      }

      try {
        return JSON.parse(responseText);
      } catch {
        const parseError = new Error(`RunningHub ${label}查询返回了无法解析的数据`);
        if (attempt < QUERY_NETWORK_RETRIES) {
          lastError = parseError;
          await waitBeforeNetworkRetry(attempt);
          continue;
        }
        throw parseError;
      }
    } catch (error) {
      lastError = error;
      if (attempt >= QUERY_NETWORK_RETRIES || !isTransientNetworkError(error)) throw error;
      console.warn(`[RunningHub] ${label}任务 ${taskId} 查询连接中断，第 ${attempt}/${QUERY_NETWORK_RETRIES} 次重试`);
      await waitBeforeNetworkRetry(attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`RunningHub ${label}查询失败`);
}

async function downloadGeneratedImage(imageUrl: string): Promise<Buffer> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= QUERY_NETWORK_RETRIES; attempt++) {
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        const downloadError = new Error(`下载图片失败 (${response.status})`);
        if (attempt < QUERY_NETWORK_RETRIES && isRetryableHttpStatus(response.status)) {
          lastError = downloadError;
          await waitBeforeNetworkRetry(attempt);
          continue;
        }
        throw downloadError;
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt >= QUERY_NETWORK_RETRIES || !isTransientNetworkError(error)) throw error;
      console.warn(`[RunningHub] 下载生成图片连接中断，第 ${attempt}/${QUERY_NETWORK_RETRIES} 次重试`);
      await waitBeforeNetworkRetry(attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('下载图片失败');
}

function getPublicAssetImageError(error: unknown): string {
  if (error instanceof InsufficientCreationPointsError) return error.message;

  const message = errorMessage(error);
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  if (message.includes('参考图')) return message;
  if (message.includes('RunningHub')) return message;
  if (message.includes('下载图片失败')) return `${message}，请稍后重试`;
  if (code === 'ENOSPC' || message.includes('ENOSPC')) return '服务器存储空间不足，图片已生成但无法保存，请联系管理员清理空间后重试';
  if (code === 'EACCES' || code === 'EPERM') return '服务器没有权限保存图片，请联系管理员检查资产目录权限';
  if (message.includes('无法读取图生图参考图片')) return message;
  if (isTransientNetworkError(error)) return '图片接口连接临时中断，已退回本次冻结点数，请稍后重试';
  return '素材图片生成失败，请稍后重试';
}

async function uploadReferenceImageToRunningHub(
  apiKey: string,
  endpoints: ReturnType<typeof buildRunningHubEndpoints>,
  image: { buffer: Buffer; fileName: string; contentType: string }
): Promise<string> {
  const formData = new FormData();
  const arrayBuffer = image.buffer.buffer.slice(
    image.buffer.byteOffset,
    image.buffer.byteOffset + image.buffer.byteLength
  ) as ArrayBuffer;
  formData.append('file', new Blob([arrayBuffer], { type: image.contentType }), image.fileName);

  const response = await fetch(endpoints.mediaUpload, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
  });
  const responseText = await response.text();
  let result: any = null;
  try {
    result = responseText ? JSON.parse(responseText) : null;
  } catch {
    result = null;
  }

  if (!response.ok) {
    throw new Error(`RunningHub 上传参考图失败 (${response.status}): ${responseText.slice(0, 200)}`);
  }
  const downloadUrl = result?.data?.download_url || result?.download_url || '';
  if (!downloadUrl) {
    throw new Error('RunningHub 上传参考图未返回可用地址');
  }
  return downloadUrl;
}

async function normalizeReferenceImageUrl(
  apiKey: string,
  endpoints: ReturnType<typeof buildRunningHubEndpoints>,
  account: PublicAccount,
  request: NextRequest,
  referenceImageUrl: string
): Promise<string> {
  const value = referenceImageUrl.trim();
  if (!value) return '';

  const parsed = new URL(value, request.url);
  const needsUpload = parsed.protocol === 'data:' || parsed.pathname === '/api/assets-view' || isLocalHostName(parsed.hostname);
  if (!needsUpload && (parsed.protocol === 'http:' || parsed.protocol === 'https:')) {
    return parsed.toString();
  }

  const image = await readReferenceImage(account, value, request);
  if (!image) throw new Error('无法读取图生图参考图片');
  return uploadReferenceImageToRunningHub(apiKey, endpoints, image);
}

/**
 * 调用 RunningHub API 生成图片
 */
async function runRunningHubTextToImage(
  apiKey: string,
  endpoints: ReturnType<typeof buildRunningHubEndpoints>,
  prompt: string,
  aspectRatio: string,
  resolution: '1k' | '2k' | '4k' = '4k',
  quality: 'low' | 'medium' | 'high' = 'high'
): Promise<string> {
  // 第1步：提交任务
  const requestBody = JSON.stringify({
    prompt,
    aspectRatio,
    resolution,
    quality,
  });
  const createResponse = await fetch(endpoints.textToImage, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: Buffer.from(requestBody, 'utf-8'),
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    throw new Error(`RunningHub 任务创建失败 (${createResponse.status}): ${errorText}`);
  }

  const createResult = await createResponse.json();
  const taskId = createResult.taskId;

  if (!taskId) {
    throw new Error('RunningHub 未返回任务 ID');
  }

  // 第2步：轮询查询任务状态
  for (let i = 0; i < MAX_POLL_RETRIES; i++) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

    const queryResult = await queryRunningHubTask(apiKey, endpoints, taskId, '图片');
    const status = queryResult.status;

    if (status === 'SUCCESS') {
      const results = queryResult.results;
      if (results && results.length > 0) {
        // 返回第一张图片的 URL
        return results[0].url;
      }
      throw new Error('RunningHub 返回成功但无图片结果');
    }

    if (status === 'FAILED') {
      throw new Error(`RunningHub 图片生成失败: ${queryResult.errorMessage || '未知错误'}`);
    }

    // QUEUED / RUNNING - 继续轮询
  }

  throw new Error(`RunningHub 图片生成超时（已等待 ${(MAX_POLL_RETRIES * POLL_INTERVAL_MS) / 1000} 秒）`);
}

/**
 * 调用 RunningHub API 进行图生图（保留人物面部特征换装）
 */
async function runRunningHubImageToImage(
  apiKey: string,
  endpoints: ReturnType<typeof buildRunningHubEndpoints>,
  prompt: string,
  imageUrls: string[],
  aspectRatio: string,
  resolution: '1k' | '2k' | '4k' = '2k',
  quality: 'low' | 'medium' | 'high' = 'medium'
): Promise<string> {
  const requestBody = JSON.stringify({
    prompt,
    imageUrls,
    aspectRatio,
    resolution,
    quality,
  });
  const createResponse = await fetch(endpoints.imageToImage, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: Buffer.from(requestBody, 'utf-8'),
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    throw new Error(`RunningHub 图生图任务创建失败 (${createResponse.status}): ${errorText}`);
  }

  const createResult = await createResponse.json();
  const taskId = createResult.taskId;

  if (!taskId) {
    throw new Error('RunningHub 图生图未返回任务 ID');
  }

  // 轮询查询任务状态
  for (let i = 0; i < MAX_POLL_RETRIES; i++) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

    const queryResult = await queryRunningHubTask(apiKey, endpoints, taskId, '图生图');
    const status = queryResult.status;

    if (status === 'SUCCESS') {
      const results = queryResult.results;
      if (results && results.length > 0) {
        return results[0].url;
      }
      throw new Error('RunningHub 图生图返回成功但无图片结果');
    }

    if (status === 'FAILED') {
      throw new Error(`RunningHub 图生图失败: ${queryResult.errorMessage || '未知错误'}`);
    }

    // QUEUED / RUNNING - 继续轮询
  }

  throw new Error(`RunningHub 图生图超时（已等待 ${(MAX_POLL_RETRIES * POLL_INTERVAL_MS) / 1000} 秒）`);
}

export async function POST(request: NextRequest) {
  let creationPointTaskId = '';
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const { type, data, currentCount, lookId, referenceImageUrl, customPrompt, imageVariant, assetImageName, creationBible } = await request.json();

    if (!type || !data) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 检查图片数量限制
    if (currentCount !== undefined && currentCount >= MAX_IMAGES_PER_ASSET) {
      return NextResponse.json({
        success: false,
        error: `每个素材最多支持 ${MAX_IMAGES_PER_ASSET} 张图片`,
      });
    }

    const runningHubConfig = getRunningHubConfigSync();
    const runningHubApiKey = runningHubConfig.apiKey;
    if (!runningHubApiKey) {
      return NextResponse.json({
        success: false,
        error: '未配置 RunningHub API Key，请联系管理员配置图片生成接口',
      }, { status: 503 });
    }
    const apiKey = runningHubApiKey.trim();
    const endpoints = buildRunningHubEndpoints(runningHubConfig.baseUrl);

    const resolvedImageVariant = imageVariant || (type === 'character' ? (lookId ? 'character-look' : 'character-face') : undefined);
    const requestedReferenceImageUrl = typeof referenceImageUrl === 'string' ? referenceImageUrl.trim() : '';

    const characterNeedsReference = type === 'character' && (
      resolvedImageVariant === 'character-look' || resolvedImageVariant === 'character-four-view'
    );
    if (characterNeedsReference && (!data?.identityImageConfirmed || !data?.confirmedFaceImageUrl)) {
      return NextResponse.json({
        success: false,
        error: '请先由用户选择并确认人物正脸身份基准图，再生成任何人物变体',
      }, { status: 400 });
    }
    if (characterNeedsReference && !requestedReferenceImageUrl) {
      return NextResponse.json({
        success: false,
        error: resolvedImageVariant === 'character-four-view'
          ? '人物四视图必须参考已生成的对应造型图'
          : '人物造型必须先确认正脸身份基准，并参考正脸或父级造型进行图生图',
      }, { status: 400 });
    }

    if (characterNeedsReference) {
      const characterLooks = Array.isArray(data?.looks) ? data.looks : [];
      const targetLook = characterLooks.find((look: Record<string, unknown>) => String(look?.id || '') === String(lookId || ''));
      if (!lookId || !targetLook) {
        return NextResponse.json({
          success: false,
          error: '未找到需要生成的人物造型，请重新提取人物信息后再试',
        }, { status: 400 });
      }
      if (resolvedImageVariant === 'character-four-view' && targetLook.identityNeedsReview) {
        return NextResponse.json({
          success: false,
          error: '该造型基于旧正脸身份，请先按当前确认正脸重新生成造型图',
        }, { status: 400 });
      }

      if (resolvedImageVariant === 'character-four-view') {
        const targetLookImageUrl = typeof targetLook.imageUrl === 'string' ? targetLook.imageUrl.trim() : '';
        if (!targetLookImageUrl || requestedReferenceImageUrl !== targetLookImageUrl) {
          return NextResponse.json({
            success: false,
            error: '人物四视图必须严格参考当前造型图，不能使用其他人物图或旧造型图',
          }, { status: 400 });
        }
      } else {
        const currentLookImageUrl = typeof targetLook.imageUrl === 'string' ? targetLook.imageUrl.trim() : '';
        const isCurrentLookReroll = Boolean(
          !targetLook.identityNeedsReview &&
          currentLookImageUrl &&
          requestedReferenceImageUrl === currentLookImageUrl
        );
        if (!isCurrentLookReroll) {
          let expectedReferenceImageUrl = '';
          if (targetLook.isBaseLook) {
            expectedReferenceImageUrl = String(data.confirmedFaceImageUrl || '').trim();
          } else {
            const parentLookId = typeof targetLook.referenceLookId === 'string' ? targetLook.referenceLookId.trim() : '';
            const parentLook = parentLookId
              ? characterLooks.find((look: Record<string, unknown>) => String(look?.id || '') === parentLookId)
              : undefined;
            if (!parentLookId || !parentLook) {
              return NextResponse.json({
                success: false,
                error: '该人物变体缺少有效父级造型，不能跳过依赖直接生图',
              }, { status: 400 });
            }
            if (parentLook.identityNeedsReview) {
              return NextResponse.json({
                success: false,
                error: '父级造型基于旧正脸，请先重新生成父级造型',
              }, { status: 400 });
            }
            expectedReferenceImageUrl = typeof parentLook.imageUrl === 'string' ? parentLook.imageUrl.trim() : '';
          }

          if (!expectedReferenceImageUrl || requestedReferenceImageUrl !== expectedReferenceImageUrl) {
            return NextResponse.json({
              success: false,
              error: '人物造型参考图与当前依赖链不一致，请按界面提示先生成父级造型',
            }, { status: 400 });
          }
        }
      }
    }

    const sceneNeedsReference = type === 'scene' && (
      data?.imageMode === 'image-to-image' ||
      (typeof data?.referenceSceneName === 'string' && data.referenceSceneName.trim().length > 0)
    );
    if (sceneNeedsReference && !requestedReferenceImageUrl) {
      return NextResponse.json({
        success: false,
        error: `场景变体必须先生成参考场景「${data.referenceSceneName || '基准场景'}」的图片`,
      }, { status: 400 });
    }

    const propNeedsReference = type === 'prop' && (
      data?.imageMode === 'image-to-image' ||
      (typeof data?.referencePropName === 'string' && data.referencePropName.trim().length > 0)
    );
    if (propNeedsReference && !requestedReferenceImageUrl) {
      return NextResponse.json({
        success: false,
        error: `道具状态变体必须先生成参考状态「${data.referencePropName || '基准状态'}」的图片`,
      }, { status: 400 });
    }

    const normalizedReferenceImageUrl = requestedReferenceImageUrl
      ? await normalizeReferenceImageUrl(apiKey, endpoints, auth.account, request, requestedReferenceImageUrl)
      : '';

    // 根据类型构建提示词
    const prompt = customPrompt
      ? buildCustomAssetPrompt(type, customPrompt, creationBible)
      : buildPrompt(type, data, lookId, resolvedImageVariant, creationBible);
    const sizeConfig = IMAGE_SIZES[type as keyof typeof IMAGE_SIZES] || IMAGE_SIZES.scene;
    const aspectRatio = type === 'character'
      ? (resolvedImageVariant === 'character-face' ? '1:1' : resolvedImageVariant === 'character-four-view' ? '16:9' : '9:16')
      : (ASPECT_RATIO_MAP[sizeConfig.ratio] || '16:9');

    console.log(`[RunningHub] 生成${type}图片，提示词:`, prompt.substring(0, 100));
    console.log(`[RunningHub] 宽高比: ${aspectRatio}, 分辨率: 2k, 质量: medium`);

    const imageMode = normalizedReferenceImageUrl ? 'image-to-image' : 'text-to-image';
    const imagePoints = calculateImageCreationPoints({
      mode: imageMode,
      resolution: '2k',
      quality: 'medium',
    });
    const pointTask = await freezeCreationPoints({
      featureCode: 'generate_asset_image',
      points: imagePoints,
      metadata: {
        assetType: type,
        assetId: data.id,
        assetName: data.name,
        imageMode,
        resolution: '2k',
        quality: 'medium',
        pricing: 'provider_cost_x1.5',
      },
    });
    creationPointTaskId = pointTask.taskId;

    let imageUrl: string;
    let imageModel = TEXT_TO_IMAGE_MODEL;

    // 如果有参考图片，使用 image-to-image
    if (normalizedReferenceImageUrl) {
      console.log(`[RunningHub] 使用图生图模式，参考图片:`, normalizedReferenceImageUrl.substring(0, 80));
      imageModel = IMAGE_TO_IMAGE_MODEL;
      imageUrl = await runRunningHubImageToImage(
        apiKey,
        endpoints,
        prompt,
        [normalizedReferenceImageUrl],
        aspectRatio,
        '2k',
        'medium'
      );
    } else {
      // 普通文生图
      imageUrl = await runRunningHubTextToImage(
        apiKey,
        endpoints,
        prompt,
        aspectRatio,
        '2k',
        'medium'
      );
    }

    console.log(`[RunningHub] 图片生成成功:`, imageUrl);

    // 下载图片并持久化保存
    const imageBuffer = await downloadGeneratedImage(imageUrl);
    const outputName = assetImageName || (resolvedImageVariant === 'character-four-view' ? `${data.name || `asset-${data.id}`}的四视图` : (data.name || `asset-${data.id}`));
    const localResult = await saveToLocalAssets(auth.account, type, outputName, imageBuffer, lookId);

    let storedImageUrl = localResult.localUrl;
    let imageKey = localResult.fileName;

    // 如果配置了对象存储，也同步上传；没有配置时本地文件就是主存储
    if (process.env.COZE_BUCKET_ENDPOINT_URL && process.env.COZE_BUCKET_NAME) {
      try {
        const storage = new S3Storage({
          endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
          accessKey: "",
          secretKey: "",
          bucketName: process.env.COZE_BUCKET_NAME,
          region: "cn-beijing",
        });
        const lookSuffix = lookId ? `_${lookId}` : '';
        const fileName = getAccountRemoteKey(auth.account, `assets/${type}/${outputName || data.id}${lookSuffix}_${Date.now()}.png`);
        imageKey = await storage.uploadFile({
          fileContent: imageBuffer,
          fileName,
          contentType: 'image/png',
        });
        storedImageUrl = await storage.generatePresignedUrl({
          key: imageKey,
          expireTime: 86400 * 30,
        });
      } catch (storageError) {
        console.warn('对象存储保存失败，使用本地图片地址:', storageError);
      }
    }

    await completeCreationPointTask(creationPointTaskId, imagePoints, {
      description: `${normalizedReferenceImageUrl ? '图生图' : '文生图'}素材图片完成扣除（2K / medium）`,
    });

    return NextResponse.json({
      success: true,
      type,
      id: data.id,
      name: outputName,
      imageUrl: storedImageUrl,
      localUrl: localResult.localUrl,
      imageKey,
      prompt,
      provider: 'runninghub',
      model: imageModel,
      lookId,
      imageVariant: resolvedImageVariant,
    });
  } catch (error: any) {
    if (creationPointTaskId) {
      await failCreationPointTask(creationPointTaskId, error?.message || '素材图片生成失败').catch((refundError) => {
        console.error('[创作点] 素材图片任务退回失败:', refundError);
      });
    }
    console.error('素材图片生成失败:', error);
    console.error('错误详情:', {
      message: error?.message,
    });

    const publicError = getPublicAssetImageError(error);

    return NextResponse.json({
      success: false,
      error: publicError,
      details: error?.message || '未知错误',
      retryable: isTransientNetworkError(error) || publicError.includes('超时') || publicError.includes('稍后重试'),
    }, { status: error instanceof InsufficientCreationPointsError ? 402 : 500 });
  }
}

type CreationBible = {
  creationType?: string;
  subjectRegion?: string;
  creationBackground?: string;
};

function normalizeCreationType(creationBible?: CreationBible): string {
  return typeof creationBible?.creationType === 'string' ? creationBible.creationType.trim() : '';
}

function normalizeSubjectRegion(creationBible?: CreationBible): string {
  return typeof creationBible?.subjectRegion === 'string' ? creationBible.subjectRegion.trim() : '';
}

function normalizeCreationBackground(creationBible?: CreationBible): string {
  return typeof creationBible?.creationBackground === 'string'
    ? creationBible.creationBackground.trim()
    : '';
}

function buildCreationBibleImageDirectives(creationBible?: CreationBible): string[] {
  const creationType = normalizeCreationType(creationBible);
  const subjectRegion = normalizeSubjectRegion(creationBible);
  const creationBackground = normalizeCreationBackground(creationBible);
  const parts: string[] = [];

  if (creationType === '仿真人') {
    parts.push('【创作类型最高优先级】仿真人：真人实拍质感，真实皮肤/真实材质/电影摄影，避免动漫化和CG塑料感');
  } else if (creationType === '3D') {
    parts.push(STYLIZED_3D_ASSET_STYLE_LOCK);
    parts.push(STYLIZED_3D_ASSET_NEGATIVE_LOCK);
  } else if (creationType === '动漫') {
    parts.push(TWO_D_ANIME_STYLE_LOCK);
    parts.push(TWO_D_ANIME_NEGATIVE_LOCK);
  }

  if (subjectRegion === '国内') {
    parts.push('【创作题材】国内：中国本土语境，环境陈设、服饰、生活细节和社会关系符合国内语境');
  } else if (subjectRegion === '国外') {
    parts.push('【创作题材最高优先级】国外：海外/国际化语境，建筑、服饰、生活方式和文化细节符合国外语境；人类角色若剧本未明确族裔，必须默认采用非东亚的欧美/国际化面孔与骨相，不得惯性生成中国或东亚面孔。剧本明确族裔时以剧本为准');
  }

  if (creationBackground === '近代') {
    parts.push('【创作背景】近代：服化道、建筑、交通、通讯、标识、材料与器物保持近代社会及早期工业化年代质感');
  } else if (creationBackground === '现代') {
    parts.push('【创作背景】现代：服化道、建筑、交通、通讯、设备、标识与生活细节符合现代社会语境');
  } else if (creationBackground === '古代') {
    parts.push('【创作背景】古代：服饰形制、发式、建筑、交通、照明、器物、材料与礼仪符合古代语境，禁止无剧情依据的现代元素');
  }

  if (creationBackground) {
    parts.push('剧本明确存在回忆、年代跳转或穿越时按原剧情呈现相应时期，除此之外不得混入其他时代元素');
  }

  if (creationType === '3D') {
    parts.push('如后续人物、场景或道具资料中含有“真人、实拍、照片、二维插画、赛璐璐”等旧画风描述，只读取其中的身份、空间、结构、颜色、材质类别与剧情事实，不得继承冲突画风；发生冲突时以统一风格化3D动画电影CGI美术为最高优先级');
  } else if (creationType === '动漫') {
    parts.push('如后续人物、场景或道具资料中含有“真人、实拍、写实、照片、真实皮肤、真实摄影、PBR”等旧描述，只读取其中的身份、空间、结构、颜色与剧情事实，不得继承其画风；发生冲突时以二维动画电影赛璐璐美术为最高优先级');
  }

  return parts;
}

function getSceneQualityPrompt(creationBible?: CreationBible): string[] {
  const creationType = normalizeCreationType(creationBible);
  if (creationType === '3D') {
    return [
      '【3D动画场景】高端院线级风格化3D动画电影环境成片，空间结构和透视准确，建筑、家具、植被与陈设使用圆润简洁、略微夸张但协调的建模语言',
      '【场景材质】使用与3D人物一致的高品质PBR材质分区和动画化纹理密度，材质精致但不过度照片写实；体积光、柔和主光、轮廓光与阴影方向统一',
      '【场景一致性】模型圆润度、材质粗糙度、色彩饱和度、光影层次和电影级调色必须与3D人物及3D道具一致，呈现同一部风格化3D动画电影中的环境',
    ];
  }
  if (creationType === '动漫') {
    return [
      '【2D动漫场景】纯二维手绘动画电影背景美术，不是照片滤镜，也不是3D场景渲染；空间结构准确，透视清楚，建筑和陈设轮廓使用与人物正脸图一致的干净中细线稿',
      '【场景上色】平整底色结合两到三层赛璐璐明暗，远景用柔和空气透视，近景保留简洁可读的二维纹理；光影服务时间与氛围，但不能变成写实摄影光效',
      '【场景一致性】线稿密度、色彩饱和度、阴影边缘、材质概括方式必须与动漫人物图一致，呈现同一部二维动画电影中的背景画面',
      '构图层次鲜明，前中后景关系清楚，氛围色彩有记忆点，场景可以直接用于动画分镜和故事板',
    ];
  }
  return [
    '超写实4K高清场景，画面细腻有质感，电影级画质',
    '极致细腻的画面细节，真实的材质纹理，丰富的光影层次',
  ];
}

function getCharacterRenderPhrase(creationBible?: CreationBible): string {
  const creationType = normalizeCreationType(creationBible);
  if (creationType === '3D') return '高端院线级风格化3D动画电影角色渲染，圆润简洁造型，高品质PBR材质与电影级光影';
  if (creationType === '动漫') return '纯二维手绘动画电影角色设计，干净中细线稿，平整色块，两到三层赛璐璐明暗，统一二维动画电影质感';
  return '真人电影风格，真实摄影质感';
}

function getCharacterStyleDirectives(creationBible?: CreationBible): string[] {
  const creationType = normalizeCreationType(creationBible);
  if (creationType === '3D') {
    return [
      `【3D人物美术总控】${STYLIZED_3D_CHARACTER_PROMPT}`,
      '【3D身份表达】保留人物的年龄、性别、脸型、五官关系和辨识特征，但必须用风格化3D角色建模语言重新表达，不能直接输出真人脸照片',
    ];
  }
  if (creationType === '动漫') {
    return [
      '【2D动漫人物】遵循统一二维动画电影美术总控：干净中细线稿、平整色块、两到三层赛璐璐明暗；具有记忆点的发型和眼型，协调自然的动漫比例，不使用厚涂写实或3D渲染',
      '【动漫身份表达】保留人物的年龄、性别、脸型、五官关系和辨识特征，用纯二维动漫角色设计语言表达；人物线稿、色彩、阴影和材质概括方式必须能与场景及道具直接合成',
    ];
  }
  return [
    '【仿真人物美术总控】真人电影人像摄影质感，真实自然的五官比例、皮肤与服装材质，干净克制的妆发和电影级柔光',
  ];
}

function getCharacterSkinRequirement(creationBible?: CreationBible): string {
  const creationType = normalizeCreationType(creationBible);
  if (creationType === '3D') {
    return '【皮肤材质】人物肤色均匀、无脏点，使用光滑细腻的风格化3D皮肤材质，带轻微自然次表面散射，以干净哑光肤质为主，只保留受控的柔润高光；不要真人毛孔摄影、油光、脏斑、蜡像感或廉价塑料感';
  }
  if (creationType === '动漫') {
    return '【面部上色】人物肤色均匀、无脏点，面部干净清爽，使用平整哑光底色与两到三层赛璐璐明暗，鼻梁、眼窝和下颌只做克制的二维色块塑形；不要真人皮肤毛孔、油光、脏斑、照片质感或3D体积皮肤';
  }
  return '【人物皮肤要求】人物皮肤肤色均匀、无脏点，皮肤质感真实，呈自然哑光皮肤肤质；避免皮肤油光、脏污、斑驳、蜡像感和过度磨皮，保留细腻真实的自然皮肤纹理';
}

function getCharacterFaceComposition(creationBible?: CreationBible): string {
  const creationType = normalizeCreationType(creationBible);
  if (creationType === '3D') {
    return '【核心要求】风格化3D动画电影角色正面脸部近景渲染，只呈现头部到肩部，不生成全身；精致干净的面部建模，五官柔和且富有表现力';
  }
  if (creationType === '动漫') {
    return '【核心要求】动漫电影角色正面脸部近景设定图，只呈现头部到肩部，不生成全身；发型轮廓、眼型和五官设计清晰统一';
  }
  return '【核心要求】人物正面人脸近景照片，只呈现头部到肩部，不生成全身';
}

function getCharacterNegativeRequirement(creationBible?: CreationBible, fullBody = false): string {
  const framing = fullBody ? '不要裁切身体或脚部' : '不要全身照，不要半身环境照';
  const creationType = normalizeCreationType(creationBible);
  if (creationType === '3D') {
    return `【禁止】无文字、无字幕、无水印；不要真人照片、真人摄影皮肤、真人轻磨皮效果、2D插画、蜡像或廉价塑料玩具感；${framing}`;
  }
  if (creationType === '动漫') {
    return `【禁止】无文字、无字幕、无水印；不要真人照片、真人摄影皮肤、照片滤镜、3D/CGI/PBR、塑料模型、厚涂写实或水彩效果；${framing}`;
  }
  return `【禁止】无文字、无字幕、无水印，不要换脸，不要夸张卡通；${framing}`;
}

function buildCustomAssetPrompt(
  type: string,
  customPrompt: string,
  creationBible?: CreationBible
): string {
  const parts = [...buildCreationBibleImageDirectives(creationBible)];
  if (type === 'character') {
    parts.push(...getCharacterStyleDirectives(creationBible));
  } else if (type === 'scene') {
    parts.push(...getSceneQualityPrompt(creationBible));
  } else if (type === 'prop') {
    parts.push(...getPropQualityPrompt(creationBible));
  }
  parts.push(customPrompt);
  if (normalizeCreationType(creationBible) === '3D') {
    parts.push(type === 'character' ? STYLIZED_3D_CHARACTER_STYLE_LOCK : STYLIZED_3D_ASSET_FINAL_LOCK);
  } else if (normalizeCreationType(creationBible) === '动漫') {
    parts.push(TWO_D_ANIME_FINAL_LOCK);
  }
  return parts.filter(Boolean).join('；');
}

function getPropQualityPrompt(creationBible?: CreationBible): string[] {
  const creationType = normalizeCreationType(creationBible);
  if (creationType === '3D') {
    return [
      '【3D动画道具】高品质风格化3D动画电影道具资产，轮廓和体块清晰，造型略微概括但结构准确，细节密度与3D人物、3D场景一致',
      '【道具材质】使用清楚的PBR材质分区、动画化纹理、受控高光和柔和阴影，金属、玻璃、木材、布料等材质可辨但不过度照片写实',
      '【道具一致性】建模圆润度、材质粗糙度、色彩饱和度、灯光方向和电影级调色必须与3D人物及3D场景保持一致，像同一部3D动画电影的官方道具资产',
    ];
  }
  if (creationType === '动漫') {
    return [
      '【2D动漫道具】纯二维动画电影道具设定图，使用与人物及场景一致的干净中细线稿、平整色块和两到三层赛璐璐明暗；主体轮廓清晰，造型特征有记忆点',
      '【材质表达】金属、玻璃、木材、布料等材质只通过二维色块、轮廓线、克制高光和简化纹理表达，不使用照片纹理、真实产品摄影或PBR渲染',
      '【道具一致性】线条颜色、上色方式、阴影边缘和色彩饱和度与动漫人物正脸图及动漫场景图保持一致，像同一部二维动画电影的官方道具设定',
    ];
  }
  return ['超写实4K高清实物摄影，画面细腻有质感，电影级画质', '专业产品摄影，主体清晰，细节丰富'];
}

// 根据类型构建图片提示词
function buildPrompt(type: string, data: any, lookId?: string, imageVariant?: string, creationBible?: CreationBible): string {
  const parts: string[] = [];
  parts.push(...buildCreationBibleImageDirectives(creationBible));

  switch (type) {
    case 'scene':
      const sceneCreationType = normalizeCreationType(creationBible);
      parts.push('【核心要求】这是一个纯场景图片，画面中绝对不能出现任何人物、人影、人形轮廓');
      parts.push('【核心要求】画面中必须没有任何人物存在，只有建筑、自然景观或室内空间');
      parts.push('【核心要求】画面中不能出现任何字幕、文字、水印、标题、说明文字');
      parts.push(...getSceneQualityPrompt(creationBible));
      parts.push(sceneCreationType === '动漫'
        ? '【构图要求】二维动画背景构图清楚、有视觉吸引力，前中后景层次明确，色彩与光影保持赛璐璐动画语言'
        : '【重要】场景设计大胆创新，视觉冲击力强，画面极具吸引力');
      if (sceneCreationType !== '动漫') {
        parts.push('构图大胆独特，色彩对比鲜明，光影效果震撼');
      }
      if (data.name) parts.push(`场景名称：${data.name}`);
      if (data.physicalLocation) parts.push(`物理地点：${data.physicalLocation}`);
      if (data.stateLabel) parts.push(`场景状态：${data.stateLabel}`);
      if (data.stateReasonLabel || data.stateReason) {
        parts.push(`【状态成立原因】${data.stateReasonLabel || data.stateReason}`);
      }
      if (data.stateChangeEvidence) {
        parts.push(`【剧本依据】${data.stateChangeEvidence}`);
      }
      if (data.stateVisualDifference) {
        parts.push(`【本状态唯一变化】${data.stateVisualDifference}`);
      }
      if (data.referenceSceneName) {
        parts.push(`【状态延展】输入的参考图是「${data.referenceSceneName}」的基准场景图。必须严格继承参考图中的空间结构、固定建筑、固定装修、主陈设、材质关系、镜头方向和整体视觉身份，只改变“本状态唯一变化”明确要求的日夜、年代或重大持久场景变化，不得重新设计成另一个地点`);
        parts.push('人物进出、情绪、镜头角度、天气细节以及临时增加或减少少量道具，都不能成为重新设计场景的理由');
      }
      if (data.description) parts.push(data.description);
      if (data.type) parts.push(`场景类型：${data.type}`);
      if (data.timeOfDay) parts.push(`时间：${data.timeOfDay}`);
      if (data.atmosphere) parts.push(`氛围：${data.atmosphere}`);
      if (data.visualElements && data.visualElements.length > 0) {
        parts.push(`固定环境视觉元素：${data.visualElements.join('、')}`);
        parts.push('视觉元素只用于稳定建筑、装修、主要家具和长期陈设；忽略人物手持物、文件、食物等临时剧情道具，不要因此创建新的场景状态');
      }
      if (data.referenceSceneName && data.stateVisualDifference) {
        parts.push(`【最终状态锁定】必须以“${data.stateVisualDifference}”为最终画面状态；如果通用空间描述中的时间、光线或临时布置与它冲突，一律以本状态唯一变化为准`);
      }
      parts.push(sceneCreationType === '动漫'
        ? '纯二维动画背景成片，线稿完整，赛璐璐色块稳定，禁止照片滤镜和三维渲染'
        : sceneCreationType === '3D'
          ? '风格化3D动画电影环境成片，模型、PBR材质、灯光和调色与3D人物及3D道具保持统一'
        : sceneCreationType === '仿真人' || !sceneCreationType
          ? '电影级画面，实景拍摄质感，专业摄影，光影自然'
          : '高完成度概念图，画面统一，光影自然，细节丰富');
      parts.push('4K超高清分辨率，画面细腻，质感丰富');
      if (sceneCreationType === '动漫') parts.push(TWO_D_ANIME_FINAL_LOCK);
      if (sceneCreationType === '3D') parts.push(STYLIZED_3D_ASSET_FINAL_LOCK);
      parts.push('【再次强调】无人物，无人影，无人形，无字幕，无文字，纯场景环境');
      break;

    case 'character':
      const characterCreationType = normalizeCreationType(creationBible);
      const isAnimalCreature = inferCharacterEntityKind(data) === 'animal-creature';
      const resolvedCharacterGender = resolveCharacterGenderByPolicy({
        name: data?.name,
        currentGender: data?.gender,
        character: data,
      });
      parts.push(...getCharacterStyleDirectives(creationBible));
      if (isAnimalCreature) {
        parts.push(...getAnimalCreaturePromptDirectives(data));
      }
      const isMainCharacter = data.role && (
        data.role.includes('主角') ||
        data.role.includes('男主') ||
        data.role.includes('女主') ||
        data.role.includes('男主角') ||
        data.role.includes('女主角') ||
        data.role.toLowerCase().includes('protagonist') ||
        data.role.toLowerCase().includes('main')
      );

      // 查找当前造型的提示词
      const currentLook = lookId && data.looks?.find((l: any) => l.id === lookId);
      const lookPrompt = currentLook?.description?.trim();
      const faceOnlyAppearance = isAnimalCreature ? '' : stripBodyDetailsFromAppearance(data.appearance);
      const characterBodyProfile = normalizeCharacterBodyProfile(data.bodyProfile, data.appearance);
      const currentBodyProfile = mergeCharacterBodyProfiles(currentLook?.bodyProfile, characterBodyProfile);

      const faceParts: string[] = [];
      if (data.faceFeatures) {
        const ff = data.faceFeatures;
        if (ff.faceShape) faceParts.push(`脸型：${ff.faceShape}`);
        if (ff.eyes) faceParts.push(`眼睛：${ff.eyes}`);
        if (ff.nose) faceParts.push(`鼻子：${ff.nose}`);
        if (ff.mouth) faceParts.push(`嘴巴：${ff.mouth}`);
        if (ff.skinTone) faceParts.push(`肤色：${ff.skinTone}`);
      }

      const appendCharacterIdentity = (includeBodyProfile = false) => {
        if (data.name) parts.push(`人物：${data.name}`);
        if (data.role) parts.push(`角色：${data.role}`);
        if (data.age) parts.push(`年龄：${data.age}`);
        if (resolvedCharacterGender) parts.push(`性别：${resolvedCharacterGender}`);
        if (faceOnlyAppearance) parts.push(`正脸外貌：${faceOnlyAppearance}`);
        if (data.personality) parts.push(`气质：${Array.isArray(data.personality) ? data.personality.join('、') : data.personality}`);
        if (faceParts.length > 0) parts.push(`固定面部特征：${faceParts.join('，')}`);
        if (includeBodyProfile) {
          const bodyProfileText = formatCharacterBodyProfile(currentBodyProfile);
          if (bodyProfileText) parts.push(`全身体态档案：${bodyProfileText}`);
        }
      };

      const appendLookDetails = () => {
        if (lookPrompt) parts.push(`当前造型说明：${lookPrompt}`);
        if (currentLook) {
          if (currentLook.changeType) parts.push(`造型变化类型：${currentLook.changeType}`);
          if (currentLook.ageStage) parts.push(`人物时期：${currentLook.ageStage}`);
          if (currentLook.physicalState) parts.push(`身体状态：${currentLook.physicalState}`);
          if (currentLook.transformationState) parts.push(`特殊形态：${currentLook.transformationState}`);
          if (currentLook.scene) parts.push(`适用场景：${currentLook.scene}`);
          if (currentLook.stage) parts.push(`剧情阶段：${currentLook.stage}`);
          if (currentLook.episodeNumbers?.length) parts.push(`关联集数：${currentLook.episodeNumbers.join('、')}`);
          if (currentLook.sceneNames?.length) parts.push(`关联场景：${currentLook.sceneNames.join('、')}`);
          if (currentLook.costume) parts.push(`服装：${currentLook.costume}`);
          if (currentLook.hairstyle) parts.push(`发型：${currentLook.hairstyle}`);
          if (currentLook.accessories?.length) parts.push(`配饰：${currentLook.accessories.join('、')}`);
          if (currentLook.makeup) parts.push(`化妆：${currentLook.makeup}`);
          if (currentLook.mood) parts.push(`情绪：${currentLook.mood}`);
          if (currentLook.bodyChanges) parts.push(`本造型身体变化：${currentLook.bodyChanges}`);
        }
      };

      if (imageVariant === 'character-four-view') {
        parts.push(`严格按照参考图像，制作一张专业的角色概念设计图。使用干净、纯白背景，以技术模型转场的形式呈现，同时确保与参考图像的视觉风格完全匹配（相同的${characterCreationType === '仿真人' || !characterCreationType ? '写实程度' : '风格化程度'}、渲染方法、纹理、色彩处理和整体美感）。`);
        parts.push(isAnimalCreature
          ? '将构图安排为4列：左1为动物头部正面特写；左2为完整身体正面视图；左3为完整身体左侧视图；左4为完整身体背面视图。四足角色必须始终保持自然、放松的四足站姿。'
          : '将构图安排为4列排列：左1为一张高度精细的特写肖像：正面脸部肖像；左2为全身站立的正面视图；左3为全身站立的侧面视图（面向左侧）；左4为全身站立的背面视图。');
        parts.push(isAnimalCreature
          ? '确保四个面板是同一只动物角色，物种、头骨、吻部、耳形、眼睛、牙齿、皮毛花纹、爪、尾巴和身体比例完全一致；各视图尺寸与地面线对齐，动物解剖准确，轮廓清楚。'
          : '确保每个面板上的身份保持一致。让角色保持放松的A型站姿，各视图之间保持一致的尺寸和对齐，确保解剖准确，轮廓清晰；确保间距均匀，面板分离清晰，全身肖像系列采用统一的构图和一致的头高，各肖像之间的面部尺寸保持一致。');
        parts.push('所有面板的照明应保持一致（方向、强度和柔和度相同），阴影自然且受控，在不产生剧烈情绪变化的情况下保留细节。输出一张清晰、可打印的参考图，细节锐利。避免裁剪、重叠、杂乱背景和动态姿势。比例：16:9。');
        parts.push('【一致性要求】必须严格参考输入图片的人脸，保持脸型、眼睛、鼻子、嘴巴、肤色、年龄感一致。');
        parts.push(isAnimalCreature
          ? '【动物表面材质】皮毛、鳞片或兽类皮肤必须符合物种和创作类型，干净清晰并保留自然层次；不得出现人类皮肤或人类头发'
          : getCharacterSkinRequirement(creationBible));
        parts.push('【禁止】不要文字、字幕、水印、标签、编号，不要多人不同脸，不要裁切脚部。');
        appendCharacterIdentity(true);
        appendLookDetails();
      } else {
        if (imageVariant === 'character-look') {
          const allowsAgeChange = ['年龄时期', '复合变化'].includes(currentLook?.changeType);
          parts.push(isAnimalCreature
            ? `【核心要求】奇幻动物角色剧情状态全身设定图，严格使用输入参考图延续同一动物身份；只按剧情要求改变年龄、伤病、护甲、项圈或特殊形态，保持物种与动物解剖一致`
            : `【核心要求】${characterCreationType === '3D' ? '风格化3D人物剧情造型全身渲染' : characterCreationType === '动漫' ? '动漫人物剧情造型全身设定图' : '人物剧情造型全身照'}，严格使用输入参考图延续同一人物身份；根据当前造型要求改变服装、年龄时期、身体状态或特殊形态`);
          parts.push(isAnimalCreature
            ? `【构图要求】完整动物全身与四肢、爪、尾巴全部可见，自然物种站姿，${getCharacterRenderPhrase(creationBible)}，纯白色背景，干净无杂物`
            : `【构图要求】全身站姿，从头到脚完整可见，${getCharacterRenderPhrase(creationBible)}，纯白色背景，干净无杂物`);
          parts.push(isAnimalCreature
            ? '【身份一致性】头骨、吻部、耳形、眼睛、鼻头、牙齿、皮毛花纹、爪、尾巴和身体比例必须继承参考图，不能变成另一物种或人类'
            : '【身份一致性】脸型骨骼、眼睛形状与间距、鼻型、嘴型、基础肤色和核心辨识特征必须继承参考图，不能换成另一个人');
          if (allowsAgeChange) {
            parts.push(`【年龄变化】允许按“${currentLook?.ageStage || '目标时期'}”调整皱纹、发色、皮肤年龄感、体态和妆发，但必须清楚看出是参考图中的同一人物`);
          } else {
            parts.push('【年龄锁定】人物年龄感与参考图保持一致，不得无故年轻化或老化');
          }
          if (currentLook?.physicalState && currentLook.physicalState !== '正常状态') {
            parts.push(`【身体状态变化】准确表现“${currentLook.physicalState}”，只改变剧情要求涉及的身体与面貌状态，其他身份和造型连续性保持不变`);
          }
          if (currentLook?.transformationState) {
            parts.push(`【特殊形态变化】在保留可识别的人脸结构和身份锚点前提下表现“${currentLook.transformationState}”，形态变化不能把人物变成完全无关的新角色`);
          }
          parts.push(isAnimalCreature
            ? '【动物表面材质】皮毛、鳞片或兽类皮肤必须符合物种和创作类型，干净清晰并保留自然层次；不得出现人类皮肤或人类头发'
            : getCharacterSkinRequirement(creationBible));
          parts.push(getCharacterNegativeRequirement(creationBible, true));
          appendCharacterIdentity(true);
          appendLookDetails();
        } else {
          parts.push(isAnimalCreature
            ? '【核心要求】奇幻动物角色身份基准图。四足角色采用完整四足全身的侧前方三分之四视图，清楚呈现动物头部、吻部、耳朵、眼睛、皮毛、爪、尾巴与整体物种轮廓；不得生成人类头像'
            : getCharacterFaceComposition(creationBible));
          parts.push(isAnimalCreature
            ? '【信息分流】读取物种、动物头骨、吻部、耳形、眼睛、牙齿、皮毛花纹、爪、尾巴与身体比例，忽略任何人类脸型、妆容和发型模板'
            : '【信息分流】这是正脸近景基准图，只读取发型、脸型、五官、肤色、皮肤质感和神态；忽略身高、体重、体型、肩腰、四肢比例与服装信息');
          parts.push('【核心要求】纯白色背景，背景干净明亮，无任何杂物或装饰');
          parts.push(isAnimalCreature
            ? '【动物表面材质】皮毛、鳞片或兽类皮肤必须符合物种和创作类型，干净清晰并保留自然层次；不得出现人类皮肤或人类头发'
            : getCharacterSkinRequirement(creationBible));
          parts.push(`【画质要求】${getCharacterRenderPhrase(creationBible)}，4K高清，${isAnimalCreature ? '动物解剖与物种辨识特征清晰' : '面部五官清晰'}，自然柔光`);
          parts.push(getCharacterNegativeRequirement(creationBible));
          appendCharacterIdentity(false);
          if (isMainCharacter) {
            parts.push('【主角光环】人物外貌出众，气质独特，具有主角气质');
          }
        }
      }
      if (characterCreationType === '3D') {
        parts.push(STYLIZED_3D_CHARACTER_STYLE_LOCK);
      } else if (characterCreationType === '动漫') {
        parts.push(TWO_D_ANIME_FINAL_LOCK);
      }
      if (isAnimalCreature) {
        parts.push(...getAnimalCreaturePromptDirectives(data));
      }
      parts.push(isAnimalCreature
        ? '4K超高清，动物角色解剖与物种细节清晰，身份一致'
        : '4K超高清，人物细节清晰，高清面部特征，身份一致');
      parts.push('【再次强调】纯白色背景，无文字，无字幕，无水印');
      break;

    case 'prop':
      const propCreationType = normalizeCreationType(creationBible);
      const currentPropState = Array.isArray(data.stateVariants) && data.stateVariants.length > 0
        ? data.stateVariants[0]
        : null;
      parts.push('【核心要求】道具图片展示，纯白色背景，画面中无人物出现');
      parts.push('【核心要求】画面中不能出现任何字幕、文字、水印、标题、说明文字');
      parts.push('【单状态制作】本次只生成一个道具实体的一种当前状态；禁止左右对照、前后对比、分栏、多宫格、设计稿排版，禁止同时展示完整与损坏两种状态');
      parts.push(...getPropQualityPrompt(creationBible));
      if (data.name) parts.push(`道具名称：${data.name}`);
      if (data.mainPropName) parts.push(`同一道具身份：${data.mainPropName}`);
      if (data.stateLabel || currentPropState?.stateName) {
        parts.push(`本次唯一状态：${data.stateLabel || currentPropState.stateName}`);
      }
      if (data.description) parts.push(data.description);
      if (data.visualDescription && data.visualDescription !== data.description) {
        parts.push(`当前状态视觉：${data.visualDescription}`);
      }
      if (data.stateVisualChange || currentPropState?.visualChange) {
        parts.push(`相对前一状态的唯一变化：${data.stateVisualChange || currentPropState.visualChange}`);
      }
      if (data.stateTransitionEvent || currentPropState?.transitionEvent) {
        parts.push(`状态形成背景：${data.stateTransitionEvent || currentPropState.transitionEvent}；只呈现变化完成后的稳定结果，不表现同一场戏里的变化过程`);
      }
      if (data.stateNarrativeFunction || currentPropState?.narrativeFunction) {
        parts.push(`该状态的剧情识别重点：${data.stateNarrativeFunction || currentPropState.narrativeFunction}`);
      }
      if (data.referencePropName) {
        parts.push(`【图生图身份锁定】输入参考图是前一状态“${data.referencePropName}”。必须保留同一件道具的尺寸比例、主体结构、材质、颜色、稳定纹样与识别特征，只表现本次状态要求的变化`);
      } else {
        parts.push('【基准状态】这是该道具的首张身份基准图，完整建立稳定的形制、材质、颜色和识别特征，供后续状态图生图使用');
      }
      parts.push('【构图要求】单个道具居中完整展示，不裁切；若当前状态为破碎或散落，可展示属于同一件道具的必要碎片，但不得再放一件完整道具作比较');
      if (data.material) parts.push(`材质：${data.material}`);
      if (data.color) parts.push(`颜色：${data.color}`);
      if (data.size) parts.push(`尺寸：${data.size}`);
      parts.push(propCreationType === '动漫'
        ? '4K高清二维动漫道具设定，线稿锐利，色块干净，结构和状态细节清晰可读'
        : propCreationType === '3D'
          ? '4K高清风格化3D动画电影道具资产，建模、PBR材质、灯光与3D人物及3D场景保持统一'
        : '4K超高清，产品细节清晰可见，质感真实');
      if (propCreationType === '动漫') parts.push(TWO_D_ANIME_FINAL_LOCK);
      if (propCreationType === '3D') parts.push(STYLIZED_3D_ASSET_FINAL_LOCK);
      parts.push('【再次强调】纯白色背景，无人无文字无字幕无水印');
      break;

    default:
      parts.push('4K超高清图片，极致细节，电影级画质');
      if (data.name) parts.push(data.name);
      if (data.description) parts.push(data.description);
      break;
  }

  return parts.join('；');
}

// 保存图片到本地资产文件夹
async function saveToLocalAssets(account: PublicAccount, type: string, name: string, buffer: Buffer, lookId?: string) {
  const lookSuffix = lookId ? `_${lookId}` : '';
  const folderName = ASSET_FOLDERS[type] || '其他';
  const assetsDir = path.join(getAccountAssetsPath(account), folderName);

  // 确保目录存在
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const safeName = String(name).replace(/[<>:"/\\|?*\s]+/g, '_').slice(0, 80);
  const fileName = `${safeName}${lookSuffix}_${Date.now()}.png`;
  const filePath = path.join(assetsDir, fileName);

  await fs.promises.writeFile(filePath, buffer);

  return {
    localUrl: `/api/assets-view?folder=${encodeURIComponent(folderName)}&filename=${encodeURIComponent(fileName)}`,
    fileName,
    filePath,
  };
}
