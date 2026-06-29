/**
 * Seedance 2.0 共享工具模块
 * 通过 xszy.top 代理调用
 */

import { S3Storage } from 'coze-coding-dev-sdk';
import { getSeedanceConnectionConfigSync } from './app-settings';

export const SEEDANCE_CONFIG = {
  modelId: 'Doubao-Seedance-2.0',
  endpoint: (process.env.SEEDANCE_BASE_URL || process.env.XSZY_BASE_URL || 'https://www.xszy.top').replace(/\/+$/, ''),
  maxWaitTime: 1800, // 30 分钟超时
  pollInterval: 5, // 5 秒轮询
};

export function getSeedanceConfig() {
  const connection = getSeedanceConnectionConfigSync();
  return {
    ...SEEDANCE_CONFIG,
    endpoint: connection.baseUrl || SEEDANCE_CONFIG.endpoint,
  };
}

/**
 * 获取 API Key（用户设置优先，环境变量兜底）
 */
export function getSeedanceApiKey(): string {
  return getSeedanceConnectionConfigSync().apiKey || '';
}

/**
 * 清理提示词
 */
export function cleanPrompt(prompt: string): string {
  let cleaned = prompt
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  cleaned = cleaned.replace(/[\u{1F300}-\u{1F9FF}]/gu, '');
  return cleaned;
}

/**
 * 解析素材 URL（支持 S3 签名 URL 转换）
 */
export async function resolveAssetUrl(url: string | undefined): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;

  if (url.includes('s3-asset-view')) {
    try {
      const match = url.match(/[?&]key=([^&]+)/);
      if (!match) return null;
      const key = decodeURIComponent(match[1]);
      const storage = new S3Storage({
        endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
        accessKey: '',
        secretKey: '',
        bucketName: process.env.COZE_BUCKET_NAME,
        region: 'cn-beijing',
      });
      return await storage.generatePresignedUrl({ key, expireTime: 3600 });
    } catch (error) {
      console.error('获取 S3 签名 URL 失败:', error);
      return null;
    }
  }
  return null;
}

/**
 * 创建 Seedance 2.0 视频生成任务
 */
export async function createSeedanceTask(
  prompt: string,
  imageUrl?: string,
  options: {
    ratio?: string;
    duration?: number;
  } = {}
): Promise<{ taskId: string } | null> {
  const apiKey = getSeedanceApiKey();
  if (!apiKey) throw new Error('未配置 Seedance API Key，请联系管理员配置视频接口');
  const seedanceConfig = getSeedanceConfig();

  const { ratio = '9:16', duration = 15 } = options;

  const requestBody: Record<string, unknown> = {
    model: seedanceConfig.modelId,
    prompt,
    duration,
    ratio,
  };
  if (imageUrl) requestBody.image_url = imageUrl;

  const response = await fetch(`${seedanceConfig.endpoint}/v1/video/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const taskId = result.task_id || result.id;
  return taskId ? { taskId } : null;
}

/**
 * 查询 Seedance 2.0 任务状态
 */
export async function getSeedanceTaskStatus(
  taskId: string
): Promise<{ videoUrl: string | null; status: string; error?: string } | null> {
  const apiKey = getSeedanceApiKey();
  if (!apiKey) {
    console.error('未配置 Seedance API Key');
    return null;
  }
  const seedanceConfig = getSeedanceConfig();

  const response = await fetch(
    `${seedanceConfig.endpoint}/v1/video/generations/${taskId}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
  }

  const wrapper = await response.json();
  const result = wrapper.data || wrapper;

  if (result.status === 'SUCCESS') {
    let videoUrl: string | null = null;
    if (result.data?.content?.video_url) videoUrl = result.data.content.video_url;
    else if (result.video_url) videoUrl = result.video_url;
    else if (result.result_url) videoUrl = result.result_url;
    else if (result.output?.video_url) videoUrl = result.output.video_url;

    return { videoUrl, status: result.status, error: videoUrl ? undefined : '未找到视频 URL' };
  }

  if (result.status === 'FAILED') {
    return { videoUrl: null, status: result.status, error: result.error || result.message || '任务失败' };
  }

  return { videoUrl: null, status: result.status };
}
