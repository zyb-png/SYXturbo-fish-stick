import { NextRequest, NextResponse } from 'next/server';
import { S3Storage } from 'coze-coding-dev-sdk';
import fs from 'fs';
import path from 'path';
import { getRunningHubConfigSync } from '@/lib/app-settings';
import {
  completeCreationPointTask,
  failCreationPointTask,
  freezeCreationPoints,
  InsufficientCreationPointsError,
} from '@/lib/creation-points';
import { calculateImageCreationPoints } from '@/lib/provider-pricing';

// 图片数量限制
const MAX_IMAGES_PER_ASSET = 10;

// RunningHub API 配置
const TEXT_TO_IMAGE_MODEL = 'runninghub/rhart-image-g-2-official/text-to-image';
const IMAGE_TO_IMAGE_MODEL = 'runninghub/rhart-image-g-2/image-to-image';

function buildRunningHubEndpoints(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    textToImage: `${base}/rhart-image-g-2-official/text-to-image`,
    imageToImage: `${base}/rhart-image-g-2/image-to-image`,
    query: `${base}/query`,
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

// 查询任务最大重试次数和间隔
const MAX_POLL_RETRIES = 60;
const POLL_INTERVAL_MS = 3000;

const ASSET_FOLDERS: Record<string, string> = {
  scene: '场景图片',
  character: '人物图片',
  prop: '道具图片',
};

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

    const queryResponse = await fetch(endpoints.query, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: Buffer.from(JSON.stringify({ taskId }), 'utf-8'),
    });

    if (!queryResponse.ok) {
      const errorText = await queryResponse.text();
      throw new Error(`RunningHub 查询失败 (${queryResponse.status}): ${errorText}`);
    }

    const queryResult = await queryResponse.json();
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

    const queryResponse = await fetch(endpoints.query, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: Buffer.from(JSON.stringify({ taskId }), 'utf-8'),
    });

    if (!queryResponse.ok) {
      const errorText = await queryResponse.text();
      throw new Error(`RunningHub 查询失败 (${queryResponse.status}): ${errorText}`);
    }

    const queryResult = await queryResponse.json();
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
  try {
    const { type, data, currentCount, lookId, referenceImageUrl, customPrompt } = await request.json();

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
        error: '未配置 RunningHub API Key，请在右上角「设置」中填写',
      });
    }
    const apiKey = runningHubApiKey.trim();
    const endpoints = buildRunningHubEndpoints(runningHubConfig.baseUrl);

    // 根据类型构建提示词
    const prompt = customPrompt || buildPrompt(type, data, lookId);
    const sizeConfig = IMAGE_SIZES[type as keyof typeof IMAGE_SIZES] || IMAGE_SIZES.scene;
    const aspectRatio = ASPECT_RATIO_MAP[sizeConfig.ratio] || '16:9';

    console.log(`[RunningHub] 生成${type}图片，提示词:`, prompt.substring(0, 100));
    console.log(`[RunningHub] 宽高比: ${aspectRatio}, 分辨率: 2k, 质量: medium`);

    const imageMode = referenceImageUrl ? 'image-to-image' : 'text-to-image';
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
    if (referenceImageUrl) {
      console.log(`[RunningHub] 使用图生图模式，参考图片:`, referenceImageUrl.substring(0, 80));
      imageModel = IMAGE_TO_IMAGE_MODEL;
      imageUrl = await runRunningHubImageToImage(
        apiKey,
        endpoints,
        prompt,
        [referenceImageUrl],
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
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`下载图片失败: ${imageResponse.status}`);
    }
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    const localResult = await saveToLocalAssets(type, data.name || `asset-${data.id}`, imageBuffer, lookId);

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
        const fileName = `assets/${type}/${data.name || data.id}${lookSuffix}_${Date.now()}.png`;
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
      description: `${referenceImageUrl ? '图生图' : '文生图'}素材图片完成扣除（2K / medium）`,
    });

    return NextResponse.json({
      success: true,
      type,
      id: data.id,
      name: data.name,
      imageUrl: storedImageUrl,
      localUrl: localResult.localUrl,
      imageKey,
      prompt,
      provider: 'runninghub',
      model: imageModel,
      lookId,
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

    return NextResponse.json({
      success: false,
      error: error instanceof InsufficientCreationPointsError ? error.message : '素材图片生成失败',
      details: error?.message || '未知错误',
    }, { status: error instanceof InsufficientCreationPointsError ? 402 : 500 });
  }
}

// 根据类型构建真人风格图片提示词
function buildPrompt(type: string, data: any, lookId?: string): string {
  const parts: string[] = [];

  switch (type) {
    case 'scene':
      parts.push('【核心要求】这是一个纯场景图片，画面中绝对不能出现任何人物、人影、人形轮廓');
      parts.push('【核心要求】画面中必须没有任何人物存在，只有建筑、自然景观或室内空间');
      parts.push('【核心要求】画面中不能出现任何字幕、文字、水印、标题、说明文字');
      parts.push('超写实4K高清场景，画面细腻有质感，电影级画质');
      parts.push('极致细腻的画面细节，真实的材质纹理，丰富的光影层次');
      parts.push('【重要】场景设计大胆创新，视觉冲击力强，画面极具吸引力');
      parts.push('构图大胆独特，色彩对比鲜明，光影效果震撼');
      if (data.name) parts.push(`场景名称：${data.name}`);
      if (data.description) parts.push(data.description);
      if (data.type) parts.push(`场景类型：${data.type}`);
      if (data.timeOfDay) parts.push(`时间：${data.timeOfDay}`);
      if (data.atmosphere) parts.push(`氛围：${data.atmosphere}`);
      if (data.visualElements && data.visualElements.length > 0) {
        parts.push(`视觉元素：${data.visualElements.join('、')}`);
      }
      parts.push('电影级画面，实景拍摄质感，专业摄影，光影自然');
      parts.push('4K超高清分辨率，画面细腻逼真，质感丰富');
      parts.push('【再次强调】无人物，无人影，无人形，无字幕，无文字，纯场景环境');
      break;

    case 'character':
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

      if (lookPrompt) {
        // 如果造型有专门提示词，优先使用
        parts.push(lookPrompt);
      } else {
        // 否则使用通用提示词结构
        parts.push('【核心要求】人物全身照，必须完整展示人物从头到脚的整体形象');
        parts.push('【核心要求】纯白色背景，背景为干净的白色，无任何杂物或装饰');
        parts.push('【核心要求】画面中不能出现任何字幕、文字、水印、标题、说明文字');
        parts.push('【核心要求】4K高清画质，画面细腻有质感，细节丰富');
        parts.push('真人电影风格人物全身照');
        if (data.name) parts.push(`人物：${data.name}`);
        if (data.role) parts.push(`角色：${data.role}`);

        if (data.faceFeatures) {
          const ff = data.faceFeatures;
          if (ff.faceShape) parts.push(`脸型：${ff.faceShape}`);
          if (ff.eyeShape) parts.push(`眼睛：${ff.eyeShape}`);
          if (ff.noseShape) parts.push(`鼻子：${ff.noseShape}`);
          if (ff.lipShape) parts.push(`嘴唇：${ff.lipShape}`);
          if (ff.browShape) parts.push(`眉毛：${ff.browShape}`);
          if (ff.faceFeatures) parts.push(`面部特征：${ff.faceFeatures}`);
        }

        if (data.age) parts.push(`年龄：${data.age}`);
        if (data.gender) parts.push(`性别：${data.gender}`);
        if (data.appearance) parts.push(`外貌：${data.appearance}`);
        if (data.style) parts.push(`风格：${data.style}`);

        if (data.clothing && data.clothing.length > 0) {
          parts.push(`服装：${data.clothing.join('、')}`);
        }
        if (data.personality) parts.push(`气质：${data.personality}`);

        // 如果造型有服装/发型等信息也加入
        if (currentLook) {
          if (currentLook.costume) parts.push(`服装：${currentLook.costume}`);
          if (currentLook.hairstyle) parts.push(`发型：${currentLook.hairstyle}`);
          if (currentLook.accessories?.length) parts.push(`配饰：${currentLook.accessories.join('、')}`);
          if (currentLook.makeup) parts.push(`化妆：${currentLook.makeup}`);
          if (currentLook.mood) parts.push(`情绪：${currentLook.mood}`);
        }

        if (isMainCharacter) {
          parts.push('【主角光环】人物外貌出众，气质独特，具有主角气质');
        }
      }
      parts.push('4K超高清，人物细节清晰，高清面部特征，真实皮肤质感');
      parts.push('【再次强调】纯白色背景，全身照，无文字，无字幕，无水印');
      break;

    case 'prop':
      parts.push('【核心要求】道具图片展示，纯白色背景，画面中无人物出现');
      parts.push('【核心要求】画面中不能出现任何字幕、文字、水印、标题、说明文字');
      parts.push('超写实4K高清实物摄影，画面细腻有质感，电影级画质');
      parts.push('专业产品摄影，主体清晰，细节丰富');
      if (data.name) parts.push(`道具名称：${data.name}`);
      if (data.description) parts.push(data.description);
      if (data.material) parts.push(`材质：${data.material}`);
      if (data.color) parts.push(`颜色：${data.color}`);
      if (data.size) parts.push(`尺寸：${data.size}`);
      parts.push('4K超高清，产品细节清晰可见，质感真实');
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
async function saveToLocalAssets(type: string, name: string, buffer: Buffer, lookId?: string) {
  const lookSuffix = lookId ? `_${lookId}` : '';
  const folderName = ASSET_FOLDERS[type] || '其他';
  const assetsDir = path.join(getAssetsPath(), folderName);

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
