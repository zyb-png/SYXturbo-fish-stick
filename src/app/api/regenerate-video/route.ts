import { NextRequest, NextResponse } from 'next/server';
import { S3Storage } from 'coze-coding-dev-sdk';
import { SEEDANCE_CONFIG, cleanPrompt, getSeedanceApiKey, getSeedanceConfig, resolveAssetUrl as resolveImageUrl } from '@/lib/seedance';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import {
  completeCreationPointTask,
  failCreationPointTask,
  freezeCreationPoints,
  InsufficientCreationPointsError,
} from '@/lib/creation-points';

// 设置 API 路由超时时间为 1 小时（视频生成需要较长时间）
export const maxDuration = 3600; // 单位：秒

// 视频格式配置
const VIDEO_RATIOS: Record<string, { width: number; height: number; label: string }> = {
  '16:9': { width: 1280, height: 720, label: '横屏 16:9' },
  '9:16': { width: 720, height: 1280, label: '竖屏 9:16' },
};

/**
 * 创建 Seedance 2.0 视频生成任务
 */
async function createSeedanceTask(
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

  try {
    const { ratio = '9:16', duration = 15 } = options;

    console.log('=== 创建 Seedance 2.0 视频重生成任务 (xszy.top) ===');
    console.log(`模型: ${seedanceConfig.modelId}`);
    console.log(`提示词: ${prompt.substring(0, 200)}...`);
    console.log(`首帧图片: ${imageUrl ? '有' : '无'}`);
    console.log(`比例: ${ratio}, 持续: ${duration}s`);

    const requestBody: Record<string, unknown> = {
      model: seedanceConfig.modelId,
      prompt,
      duration,
      ratio,
    };

    if (imageUrl) {
      requestBody.image_url = imageUrl;
    }

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
      console.error('创建任务失败:', response.status, errorText);
      throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const taskId = result.task_id || result.id;
    if (taskId) {
      console.log(`✓ 任务创建成功，Task ID: ${taskId}`);
      return { taskId };
    }

    console.error('创建任务失败: 未返回任务 ID');
    return null;
  } catch (error) {
    console.error('创建 Seedance 任务异常:', error);
    throw error;
  }
}

/**
 * 查询 Seedance 2.0 任务状态
 */
async function getSeedanceTaskStatus(
  taskId: string
): Promise<{ videoUrl: string | null; status: string; error?: string } | null> {
  const apiKey = getSeedanceApiKey();
  if (!apiKey) {
    console.error('未配置 Seedance API Key');
    return null;
  }
  const seedanceConfig = getSeedanceConfig();

  try {
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
      console.error('查询任务失败:', response.status, errorText);
      throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
    }

    const wrapper = await response.json();
    const result = wrapper.data || wrapper;

    if (result.status === 'SUCCESS') {
      let videoUrl: string | null = null;

      if (result.data?.content?.video_url) {
        videoUrl = result.data.content.video_url;
      } else if (result.video_url) {
        videoUrl = result.video_url;
      } else if (result.result_url) {
        videoUrl = result.result_url;
      } else if (result.output?.video_url) {
        videoUrl = result.output.video_url;
      }

      if (videoUrl) {
        console.log(`✓ 视频重生成成功: ${videoUrl.substring(0, 100)}...`);
        return { videoUrl, status: result.status };
      }

      return { videoUrl: null, status: result.status, error: '未找到视频 URL' };
    }

    if (result.status === 'FAILED') {
      return {
        videoUrl: null,
        status: result.status,
        error: result.error || result.message || '视频重生成失败',
      };
    }

    return { videoUrl: null, status: result.status };
  } catch (error) {
    console.error('查询任务状态异常:', error);
    throw error;
  }
}

/**
 * 轮询等待任务完成
 */
async function pollTaskCompletion(
  taskId: string,
  maxWaitSeconds: number = SEEDANCE_CONFIG.maxWaitTime,
  pollIntervalSeconds: number = SEEDANCE_CONFIG.pollInterval
): Promise<{ videoUrl: string | null; status: string; error?: string }> {
  const startTime = Date.now();

  while (true) {
    const elapsed = (Date.now() - startTime) / 1000;
    if (elapsed > maxWaitSeconds) {
      console.error(`任务超时 (${maxWaitSeconds}s)`);
      return { videoUrl: null, status: 'TIMEOUT', error: `任务超时 (${maxWaitSeconds}秒)` };
    }

    const result = await getSeedanceTaskStatus(taskId);
    if (!result) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalSeconds * 1000));
      continue;
    }

    if (result.status === 'SUCCESS') return result;
    if (result.status === 'FAILED') return result;

    console.log(`⏳ 任务进行中... (${Math.floor(elapsed)}s / ${maxWaitSeconds}s)`);
    await new Promise(resolve => setTimeout(resolve, pollIntervalSeconds * 1000));
  }
}

export async function POST(request: NextRequest) {
  let creationPointTaskId = '';
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const { videoPrompt, imageUrl, duration = 15, ratio = '9:16' } = body;

    console.log('=== 视频重生成请求 ===');
    console.log(`提示词: ${videoPrompt?.substring(0, 200)}`);
    console.log(`首帧图片: ${imageUrl || '无'}`);
    console.log(`比例: ${ratio}, 持续时间: ${duration}s`);

    if (!videoPrompt || videoPrompt.length < 5) {
      return NextResponse.json({ error: '提示词内容过短，请提供更详细的描述（至少 5 个字符）' }, { status: 400 });
    }

    const validRatios = ['16:9', '9:16', '1:1', '4:3', '3:4'];
    if (ratio && !validRatios.includes(ratio)) {
      return NextResponse.json({ error: `视频比例无效，支持 ${validRatios.join('、')}` }, { status: 400 });
    }

    if (duration && (duration < 1 || duration > 30)) {
      return NextResponse.json({ error: '视频持续时间必须在 1-30 秒之间' }, { status: 400 });
    }

    const cleanedPrompt = cleanPrompt(videoPrompt);
    const truncatedPrompt = cleanedPrompt.length > 800 ? cleanedPrompt.substring(0, 800) : cleanedPrompt;
    console.log(`✓ 提示词已清理，长度: ${truncatedPrompt.length} 字符`);

    const pointTask = await freezeCreationPoints({
      featureCode: 'generate_video',
      quantity: duration,
      metadata: {
        mode: 'regenerate',
        duration,
        ratio,
        hasReferenceImage: Boolean(imageUrl),
      },
    });
    creationPointTaskId = pointTask.taskId;

    // 解析首帧图片 URL
    const resolvedImageUrl = await resolveImageUrl(imageUrl);
    if (imageUrl && !resolvedImageUrl) {
      console.warn('首帧图片 URL 解析失败，继续使用原 URL');
    }

    const taskResult = await createSeedanceTask(
      truncatedPrompt,
      resolvedImageUrl || imageUrl,
      { ratio, duration }
    );

    if (!taskResult || !taskResult.taskId) {
      await failCreationPointTask(creationPointTaskId, '创建视频重生成任务失败');
      return NextResponse.json({ error: '创建视频重生成任务失败' }, { status: 500 });
    }

    const finalResult = await pollTaskCompletion(taskResult.taskId);

    if (finalResult.videoUrl) {
      // 生成 S3 签名 URL
      let s3VideoUrl = finalResult.videoUrl;
      try {
        const storage = new S3Storage({
          endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
          accessKey: '',
          secretKey: '',
          bucketName: process.env.COZE_BUCKET_NAME,
          region: 'cn-beijing',
        });
        const signedUrl = await storage.generatePresignedUrl({
          key: finalResult.videoUrl,
          expireTime: 86400,
        });
        s3VideoUrl = signedUrl;
        console.log(`✓ 已生成 S3 签名 URL`);
      } catch (error) {
        console.warn('生成 S3 签名 URL 失败，使用原始 URL:', error);
      }

      console.log('✓ 视频重生成成功');
      await completeCreationPointTask(creationPointTaskId);
      return NextResponse.json({
        success: true,
        video: {
          url: s3VideoUrl,
          taskId: taskResult.taskId,
          duration,
          ratio,
        },
      });
    }

    console.error('✗ 视频重生成失败:', finalResult.error);
    await failCreationPointTask(creationPointTaskId, finalResult.error || '视频重生成失败');
    return NextResponse.json({ error: finalResult.error || '视频重生成失败' }, { status: 500 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (creationPointTaskId) {
      await failCreationPointTask(creationPointTaskId, msg).catch((refundError) => {
        console.error('[创作点] 视频重生成任务退回失败:', refundError);
      });
    }
    console.error('视频重生成异常:', error);
    return NextResponse.json(
      { error: error instanceof InsufficientCreationPointsError ? msg : `视频重生成异常: ${msg}` },
      { status: error instanceof InsufficientCreationPointsError ? 402 : 500 }
    );
  }
}
