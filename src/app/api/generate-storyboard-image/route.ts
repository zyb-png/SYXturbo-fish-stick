import { NextRequest, NextResponse } from 'next/server';
import { S3Storage } from 'coze-coding-dev-sdk';
import { invoke as oaiInvoke } from '@/lib/openai-client';
import { getRunningHubConfigSync } from '@/lib/app-settings';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import {
  completeCreationPointTask,
  failCreationPointTask,
  freezeCreationPoints,
  InsufficientCreationPointsError,
} from '@/lib/creation-points';
import { calculateImageCreationPoints } from '@/lib/provider-pricing';
import fs from 'fs';
import path from 'path';

// 设置 API 路由超时时间
export const maxDuration = 600;

const TEXT_TO_IMAGE_MODEL = 'runninghub/rhart-image-g-2-official/text-to-image';
const IMAGE_TO_IMAGE_MODEL = 'runninghub/rhart-image-g-2-official/image-to-image';

function buildRunningHubEndpoints(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    textToImage: `${base}/rhart-image-g-2-official/text-to-image`,
    imageToImage: `${base}/rhart-image-g-2-official/image-to-image`,
    query: `${base}/query`,
    mediaUpload: `${base}/media/upload/binary`,
  };
}

const STORYBOARD_IMAGE_MODE = process.env.STORYBOARD_IMAGE_MODE || 'quality';
const IS_QUALITY_MODE = STORYBOARD_IMAGE_MODE === 'quality';
const STORYBOARD_RESOLUTION: '1k' | '2k' | '4k' = '4k';
const STORYBOARD_QUALITY: 'low' | 'medium' | 'high' = 'medium';
const STORYBOARD_REF_IMAGE_LIMIT = readPositiveInt('STORYBOARD_REF_IMAGE_LIMIT', IS_QUALITY_MODE ? 8 : 4);
const MAX_POLL_RETRIES = readPositiveInt('STORYBOARD_IMAGE_MAX_POLL_RETRIES', IS_QUALITY_MODE ? 200 : 60);
const POLL_INTERVAL_MS = readPositiveInt('STORYBOARD_IMAGE_POLL_INTERVAL_MS', IS_QUALITY_MODE ? 3000 : 2500);
const CREATE_TASK_RETRIES = IS_QUALITY_MODE ? 3 : 2;
const ENABLE_LLM_IMAGE_PROMPT = process.env.ENABLE_LLM_STORYBOARD_IMAGE_PROMPT === 'true';

function readPositiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function cleanText(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function oneLine(value: unknown, maxLength = 140): string {
  const text = cleanText(value).replace(/\s+/g, ' ');
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function buildLocalVisualPrompt(
  chapterTitle: string,
  groupIndex: number,
  shots: any[],
  referenceImageCount: number,
  imageSettings: any
): string {
  const shotLines = shots.map((shot, index) => {
    const scene = shot.scene || {};
    const characters = Array.isArray(shot.characters) ? shot.characters : [];
    const characterText = characters.map((character: any) => {
      return [
        cleanText(character?.name, '人物'),
        cleanText(character?.position),
        cleanText(character?.action || shot?.actionAndDialogue),
        cleanText(character?.expression),
      ].filter(Boolean).join('/');
    }).join('；');

    return `镜头${shot.shotNumber ?? index + 1}：${oneLine(shot.description || shot.panelDescription || shot.videoPrompt, 90)}，${cleanText(shot.shotType, '中景')}，${cleanText(shot.cameraPosition || shot.cameraAngle, '平视机位')}，${cleanText(shot.cameraMovement, '稳定运镜')}，场景${cleanText(scene.location || shot.location, '未指定')}，人物${characterText || oneLine(shot.actorBlocking || shot.actionAndDialogue, 80)}`;
  }).join('；');

  const styles = Array.isArray(imageSettings?.styles) && imageSettings.styles.length > 0 ? imageSettings.styles.join('、') : '电影感、写实';
  const lighting = Array.isArray(imageSettings?.lighting) && imageSettings.lighting.length > 0 ? imageSettings.lighting.join('、') : '自然电影光';

  return `横向超宽电影工业级分镜故事板总控图，章节「${chapterTitle || '未命名章节'}」第${groupIndex}组，包含${shots.length}个连续镜头格。顶部中文项目信息栏，上方角色设定、场景设定、运镜方案，主体为时间分镜表，底部镜头说明/色彩指南/灯光参考。${shotLines}。画面风格：${styles}；光影：${lighting}。中文印刷级标注，清晰边框，真实导演工作板，不要水印，不要涂鸦，不要手写批注。${referenceImageCount > 0 ? `参考${referenceImageCount}张素材图，继承角色外观、场景质感和色彩光影。` : ''}`;
}

function prepareImagePrompt(
  customPrompt: unknown,
  chapterTitle: string,
  groupIndex: number,
  shots: any[],
  referenceImageCount: number,
  imageSettings: any
): string {
  const fallbackPrompt = buildLocalVisualPrompt(chapterTitle, groupIndex, shots, referenceImageCount, imageSettings);
  const prompt = cleanText(customPrompt);
  if (!prompt) return fallbackPrompt;

  const normalized = prompt.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 1200) return normalized;

  return `${fallbackPrompt}\n用户确认提示词关键要求：${normalized.slice(0, 520)}`;
}

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

function resolveLocalAssetFilePath(urlString: string): { filePath: string; contentType: string } | null {
  const url = new URL(urlString, 'http://localhost');
  if (url.pathname !== '/api/assets-view') return null;

  const folder = url.searchParams.get('folder');
  const filename = url.searchParams.get('filename');
  if (!folder || !filename) return null;

  const safeFolder = folder.replace(/\.\./g, '');
  const safeFilename = filename.replace(/\.\./g, '');
  return {
    filePath: path.join(getAssetsPath(), safeFolder, safeFilename),
    contentType: getContentTypeFromFileName(safeFilename),
  };
}

async function readReferenceImage(
  imageUrl: string,
  request: NextRequest,
  index: number
): Promise<{ buffer: Buffer; fileName: string; contentType: string } | null> {
  const value = imageUrl.trim();
  if (!value) return null;

  const dataUrlMatch = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (dataUrlMatch) {
    const contentType = dataUrlMatch[1];
    return {
      buffer: Buffer.from(dataUrlMatch[2], 'base64'),
      fileName: `storyboard-reference-${index}.${getExtensionFromContentType(contentType)}`,
      contentType,
    };
  }

  const localAsset = resolveLocalAssetFilePath(value);
  if (localAsset) {
    const buffer = await fs.promises.readFile(localAsset.filePath);
    return {
      buffer,
      fileName: path.basename(localAsset.filePath),
      contentType: localAsset.contentType,
    };
  }

  const parsed = new URL(value, request.url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const response = await fetch(parsed.toString());
  if (!response.ok) {
    throw new Error(`读取参考图失败 (${response.status}): ${value.slice(0, 80)}`);
  }

  const contentType = response.headers.get('content-type') || 'image/png';
  if (!contentType.startsWith('image/')) {
    throw new Error(`参考图不是图片类型: ${contentType}`);
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    fileName: `storyboard-reference-${index}.${getExtensionFromContentType(contentType)}`,
    contentType,
  };
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
  const blob = new Blob([arrayBuffer], { type: image.contentType });
  formData.append('file', blob, image.fileName);

  const response = await fetch(endpoints.mediaUpload, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });

  const text = await response.text();
  let result: any = null;
  try {
    result = text ? JSON.parse(text) : null;
  } catch {
    result = null;
  }

  if (!response.ok) {
    throw new Error(`RunningHub 上传参考图失败 (${response.status}): ${text.slice(0, 200)}`);
  }

  const downloadUrl = result?.data?.download_url || result?.download_url || '';
  if (!downloadUrl) {
    throw new Error(`RunningHub 上传参考图未返回 download_url: ${text.slice(0, 200)}`);
  }

  return downloadUrl;
}

async function normalizeReferenceImages(
  apiKey: string,
  endpoints: ReturnType<typeof buildRunningHubEndpoints>,
  referenceImages: unknown,
  request: NextRequest
): Promise<string[]> {
  if (!Array.isArray(referenceImages)) return [];

  const candidates = referenceImages
    .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
    .slice(0, STORYBOARD_REF_IMAGE_LIMIT);

  const normalized: string[] = [];
  for (const [index, imageUrl] of candidates.entries()) {
    try {
      const parsed = new URL(imageUrl, request.url);
      const isLocalUrl = parsed.protocol === 'data:' || parsed.pathname === '/api/assets-view' || isLocalHostName(parsed.hostname);

      if (!isLocalUrl && (parsed.protocol === 'http:' || parsed.protocol === 'https:')) {
        normalized.push(parsed.toString());
        continue;
      }

      const image = await readReferenceImage(imageUrl, request, index + 1);
      if (!image) continue;

      const uploadedUrl = await uploadReferenceImageToRunningHub(apiKey, endpoints, image);
      normalized.push(uploadedUrl);
      console.log(`[RunningHub 参考图] 已上传本地参考图 ${index + 1}/${candidates.length}: ${image.fileName}`);
    } catch (error) {
      console.warn(`[RunningHub 参考图] 跳过无效参考图 ${index + 1}:`, error);
    }
  }

  return normalized;
}

/**
 * 用 GPT-5 将分镜组数据浓缩成适合文生图模型使用的视觉描述
 */
async function generateConciseVisualPrompt(
  chapterTitle: string,
  groupIndex: number,
  shots: any[],
  referenceImageCount: number
): Promise<string> {
  // 构建分镜组描述
  const shotDescriptions = shots.map((shot) => {
    const scene = shot.scene || {};
    const characters = shot.characters || [];
    const charDesc = characters.map((c: any) => {
      return `${c.name} - 动作: ${shot.actionAndDialogue || c.action || ''}${c.dialogue ? `, 台词: 「${c.dialogue}」` : ''}`;
    }).join('；');

    return `[镜头${shot.shotNumber}] 景别=${shot.shotType || '中景'} | 焦段=${shot.focalLength || ''} | 机位=${shot.cameraPosition || ''} | 运镜=${shot.cameraMovement || ''} | 内容=${shot.description || ''} | 人物=${charDesc} | 场景=${scene.location || ''}(${scene.time || ''},${scene.atmosphere || ''})`;
  }).join('\n');

  const allCharacters = shots.flatMap((s: any) => (s.characters || []).map((c: any) => c.name));
  const uniqueChars = [...new Set(allCharacters)].join('、');
  const mainScene = shots[0]?.scene?.location || '';

  const systemMsg = `你是一名电影分镜视觉设计师。你的任务是将一组分镜信息浓缩为一段简短有力的AI文生图提示词。

要求：
1. 只用1-2段话，200字以内
2. 描述画面中最核心的视觉元素：构图、人物位置、场景氛围、光影、情绪基调
3. 聚焦本组最关键的1-2个镜头场景，不要逐一列举
4. 使用电影级描述语言（如"黄昏暖光"、"冷调蓝青"、"浅景深"、"逆光剪影"）
5. 输出纯文本，不要任何格式、编号或解释
6. 直接输出提示词正文，不要有前缀后缀`;

  const userMsg = `章节：${chapterTitle}
第 ${groupIndex} 组分镜（${shots.length} 个连续镜头）：
${shotDescriptions}

关键角色：${uniqueChars || '无'}
主要场景：${mainScene || '无'}
${referenceImageCount > 0 ? `参考图片数量：${referenceImageCount} 张` : ''}

请生成一段简洁的视觉描述提示词。`;

  const trimmed = (await oaiInvoke([
    { role: 'system', content: systemMsg },
    { role: 'user', content: userMsg },
  ], { temperature: 0.7, maxTokens: 500, timeout: 45_000 })).trim();
  if (!trimmed) throw new Error('GPT-5 未返回有效的视觉描述');

  return trimmed;
}

/**
 * 调用 RunningHub 文生图 API
 */
async function runRunningHubTextToImage(
  apiKey: string,
  endpoints: ReturnType<typeof buildRunningHubEndpoints>,
  prompt: string,
  aspectRatio: string,
  resolution: '1k' | '2k' | '4k' = '4k',
  quality: 'low' | 'medium' | 'high' = 'high'
): Promise<string> {
  const requestBody = JSON.stringify({ prompt, aspectRatio, resolution, quality });

  // 创建任务（最多重试 3 次）
  let taskId = '';
  for (let attempt = 0; attempt < CREATE_TASK_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(`[RunningHub 文生图] 重试第 ${attempt + 1} 次...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

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
      console.error(`[RunningHub 文生图] 创建失败 (${createResponse.status}): ${errorText}`);
      continue;
    }

    const createResult = await createResponse.json();
    taskId = createResult.taskId;

    if (taskId) break;

    console.error(`[RunningHub 文生图] 未返回任务 ID (尝试 ${attempt + 1}/${CREATE_TASK_RETRIES}), 响应: ${JSON.stringify(createResult)}`);
  }

  if (!taskId) {
    throw new Error('RunningHub 文生图未返回任务 ID');
  }

  // 轮询查询任务状态
  for (let i = 0; i < MAX_POLL_RETRIES; i++) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

    const queryResponse = await fetch(endpoints.query, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ taskId }),
    });

    if (!queryResponse.ok) continue;

    const queryResult = await queryResponse.json();

    if (queryResult.status === 'SUCCESS') {
      const imgUrl = queryResult.results?.[0]?.imageUrl || queryResult.results?.[0]?.url || queryResult.imageUrl || queryResult.url || '';
      if (!imgUrl) {
        console.error(`[RunningHub 图生图] SUCCESS 但无图片地址, 完整响应: ${JSON.stringify(queryResult).substring(0, 300)}`);
      }
      return imgUrl;
    } else if (queryResult.status === 'FAILED') {
      throw new Error(`RunningHub 图片生成失败: ${queryResult.errorMessage || queryResult.error || '未知错误'}`);
    }
  }

  throw new Error(`RunningHub 图片生成超时（已等待约 ${Math.round((MAX_POLL_RETRIES * POLL_INTERVAL_MS) / 1000)} 秒）`);
}

/**
 * 使用参考图进行图生图
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
  const refImages = imageUrls
    .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
    .slice(0, STORYBOARD_REF_IMAGE_LIMIT);
  const requestBody = JSON.stringify({ prompt, imageUrls: refImages, aspectRatio, resolution, quality });

  // 创建任务（最多重试 3 次）
  let taskId = '';
  for (let attempt = 0; attempt < CREATE_TASK_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(`[RunningHub 图生图] 重试第 ${attempt + 1} 次...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log(`[RunningHub 图生图] 请求: prompt="${prompt.substring(0, 50)}..." 参考图:${refImages.length}张, 第一张=${refImages[0]?.substring(0, 50) || '无'}`);

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
      console.error(`[RunningHub 图生图] 创建失败 (${createResponse.status}): ${errorText}`);
      continue;
    }

    const createResult = await createResponse.json();
    taskId = createResult.taskId;

    // 检测 API 返回的业务错误
    if (createResult.errorCode) {
      console.error(`[RunningHub 图生图] API 返回错误 (尝试 ${attempt + 1}/${CREATE_TASK_RETRIES}): code=${createResult.errorCode}, msg=${createResult.errorMessage || '无'}`);
    }

    if (taskId) break;

    console.error(`[RunningHub 图生图] 未返回任务 ID (尝试 ${attempt + 1}/${CREATE_TASK_RETRIES}), 响应: ${JSON.stringify(createResult)}`);
  }

  if (!taskId) {
    throw new Error('RunningHub 图生图未返回任务 ID');
  }

  for (let i = 0; i < MAX_POLL_RETRIES; i++) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

    const queryResponse = await fetch(endpoints.query, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ taskId }),
    });

    if (!queryResponse.ok) continue;

    const queryResult = await queryResponse.json();

    if (queryResult.status === 'SUCCESS') {
      return queryResult.results?.[0]?.imageUrl || queryResult.results?.[0]?.url || queryResult.imageUrl || queryResult.url || '';
    } else if (queryResult.status === 'FAILED') {
      throw new Error(`RunningHub 图生图失败: ${queryResult.errorMessage || queryResult.error || '未知错误'}`);
    }
  }

  throw new Error(`RunningHub 图生图超时（已等待约 ${Math.round((MAX_POLL_RETRIES * POLL_INTERVAL_MS) / 1000)} 秒）`);
}

/**
 * 保存图片。没有对象存储配置时保存到本地资产目录。
 */
async function saveGeneratedImage(imageUrl: string): Promise<{ url: string; key: string }> {
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`下载图片失败: ${imageResponse.status}`);
  }

  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const contentType = imageResponse.headers.get('content-type') || 'image/png';
  const ext = contentType.includes('jpeg') ? 'jpg' : contentType.includes('webp') ? 'webp' : 'png';
  const timestamp = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);
  const fileName = `storyboard_${timestamp}_${rand}.${ext}`;

  if (process.env.COZE_BUCKET_ENDPOINT_URL && process.env.COZE_BUCKET_NAME) {
    try {
      const key = `storyboard/${fileName}`;
      const storage = new S3Storage({
        endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
        accessKey: "",
        secretKey: "",
        bucketName: process.env.COZE_BUCKET_NAME,
        region: "cn-beijing",
      });
      const imageKey = await storage.uploadFile({ fileContent: imageBuffer, fileName: key, contentType });
      const presignedUrl = await storage.generatePresignedUrl({
        key: imageKey,
        expireTime: 86400 * 30,
      });
      return { url: presignedUrl, key: imageKey };
    } catch (storageError) {
      console.warn('对象存储保存失败，改为保存到本地资产目录:', storageError);
    }
  }

  const folderName = '分镜图片';
  const folderPath = path.join(getAssetsPath(), folderName);
  await fs.promises.mkdir(folderPath, { recursive: true });
  const filePath = path.join(folderPath, fileName);
  await fs.promises.writeFile(filePath, imageBuffer);

  return {
    url: `/api/assets-view?folder=${encodeURIComponent(folderName)}&filename=${encodeURIComponent(fileName)}`,
    key: fileName,
  };
}

function getAssetsPath(): string {
  const configPath = path.join(process.cwd(), 'assets-config.json');
  let assetsPath = path.join(process.cwd(), 'assets');

  try {
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configData);
      assetsPath = config.assetsPath || assetsPath;
    }
  } catch (error) {
    console.warn('读取资产配置失败，使用默认 assets 目录:', error);
  }

  return assetsPath;
}

export async function POST(request: NextRequest) {
  let creationPointTaskId = '';
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const {
      chapterTitle,
      groupIndex,
      shots,
      referenceImages,
      imageSettings,
      customPrompt,   // 可选的用户确认后的自定义提示词
    } = await request.json();

    if (!shots || !Array.isArray(shots) || shots.length === 0) {
      return NextResponse.json({ error: '请提供分镜数据' }, { status: 400 });
    }

    if (shots.length > 6) {
      return NextResponse.json({ error: '每组分镜最多6个' }, { status: 400 });
    }

    const runninghubConfig = getRunningHubConfigSync();
    const runninghubKey = runninghubConfig.apiKey;
    if (!runninghubKey) {
      return NextResponse.json({ error: '未配置 RunningHub API Key，请联系管理员配置图片生成接口' }, { status: 500 });
    }
    const runninghubEndpoints = buildRunningHubEndpoints(runninghubConfig.baseUrl);

    console.log(`🎬 开始生成故事板图片: 章节="${chapterTitle}", 第${groupIndex}组, ${shots.length}个镜头, 模式=${STORYBOARD_IMAGE_MODE}`);

    const imagePoints = calculateImageCreationPoints({
      mode: 'text-to-image',
      resolution: STORYBOARD_RESOLUTION,
      quality: STORYBOARD_QUALITY,
    });
    const pointTask = await freezeCreationPoints({
      featureCode: 'generate_storyboard_image',
      points: imagePoints,
      metadata: {
        chapterTitle,
        groupIndex,
        shotCount: shots.length,
        resolution: STORYBOARD_RESOLUTION,
        quality: STORYBOARD_QUALITY,
        pricing: 'provider_cost_x1.5',
      },
    });
    creationPointTaskId = pointTask.taskId;

    // 第一步：准备出图 prompt。默认用本地结构化提示词，避免额外模型调用拉长等待。
    let concisePrompt: string;
    if (customPrompt) {
      concisePrompt = prepareImagePrompt(customPrompt, chapterTitle, groupIndex, shots, referenceImages?.length || 0, imageSettings);
      console.log(`📝 使用用户确认的自定义提示词（已做出图长度优化）: ${concisePrompt.substring(0, 200)}...`);
    } else if (ENABLE_LLM_IMAGE_PROMPT) {
      try {
        console.log('🤖 正在用 GPT-5 生成视觉描述...');
        concisePrompt = await generateConciseVisualPrompt(
          chapterTitle,
          groupIndex,
          shots,
          referenceImages?.length || 0
        );
        console.log(`📝 GPT-5 视觉描述: ${concisePrompt.substring(0, 200)}...`);
      } catch (promptError) {
        console.warn('GPT-5 视觉描述生成失败，改用本地快速提示词:', promptError);
        concisePrompt = buildLocalVisualPrompt(chapterTitle, groupIndex, shots, referenceImages?.length || 0, imageSettings);
      }
    } else {
      concisePrompt = buildLocalVisualPrompt(chapterTitle, groupIndex, shots, referenceImages?.length || 0, imageSettings);
      console.log(`📝 使用本地快速视觉描述: ${concisePrompt.substring(0, 200)}...`);
    }

    // 第二步：用 RunningHub 图生图（rhart-image-g-2-official/image-to-image）
    // 传入所有参考图片，让 AI 继承角色/场景/道具的视觉风格
    const ratio = imageSettings?.ratios?.[0] || '16:9';
    const aspectRatioMap: Record<string, string> = {
      '16:9': '16:9', '9:16': '9:16', '4:3': '4:3', '1:1': '1:1', '21:9': '21:9',
    };
    const aspectRatio = aspectRatioMap[ratio] || '16:9';

    let imageUrl: string;
    let imageModel = TEXT_TO_IMAGE_MODEL;

    const normalizedReferenceImages = await normalizeReferenceImages(runninghubKey, runninghubEndpoints, referenceImages, request);

    if (normalizedReferenceImages.length > 0) {
      console.log(`🖼️ 使用图生图模式（rhart-image-g-2-official/image-to-image），参考图数量: ${normalizedReferenceImages.length}，实际传入最多 ${STORYBOARD_REF_IMAGE_LIMIT} 张`);
      imageModel = IMAGE_TO_IMAGE_MODEL;
      imageUrl = await runRunningHubImageToImage(
        runninghubKey, runninghubEndpoints, concisePrompt, normalizedReferenceImages, aspectRatio, STORYBOARD_RESOLUTION, STORYBOARD_QUALITY
      );
    } else {
      console.log(`⚠️ 无参考图，降级为文生图模式（${STORYBOARD_RESOLUTION}/${STORYBOARD_QUALITY}）`);
      imageUrl = await runRunningHubTextToImage(
        runninghubKey, runninghubEndpoints, concisePrompt, aspectRatio, STORYBOARD_RESOLUTION, STORYBOARD_QUALITY
      );
    }

    console.log(`✅ RunningHub 返回图片: ${imageUrl?.substring(0, 60)}...`);

    if (!imageUrl) {
      throw new Error('RunningHub 未返回图片地址');
    }

    // 第三步：持久化保存
    console.log('💾 保存图片...');
    const { url: signedUrl, key } = await saveGeneratedImage(imageUrl);

    console.log(`✅ 故事板图片生成成功: ${signedUrl?.substring(0, 60)}...`);

    await completeCreationPointTask(creationPointTaskId, imagePoints, {
      description: `故事板图片完成扣除（${STORYBOARD_RESOLUTION.toUpperCase()} / ${STORYBOARD_QUALITY}）`,
      metadata: {
        imageMode: normalizedReferenceImages.length > 0 ? 'image-to-image' : 'text-to-image',
      },
    });

    return NextResponse.json({
      success: true,
      imageUrl: signedUrl,
      imageKey: key,
      concisePrompt,
      groupIndex,
      shotCount: shots.length,
      provider: 'runninghub',
      model: imageModel,
    });

  } catch (error: any) {
    if (creationPointTaskId) {
      await failCreationPointTask(creationPointTaskId, error?.message || '故事板图片生成失败').catch((refundError) => {
        console.error('[创作点] 故事板图片任务退回失败:', refundError);
      });
    }
    console.error('❌ 故事板图片生成失败:', error);
    return NextResponse.json({
      success: false,
      error: error.message || '故事板图片生成失败',
    }, { status: error instanceof InsufficientCreationPointsError ? 402 : 500 });
  }
}
