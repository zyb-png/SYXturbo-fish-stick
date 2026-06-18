import { NextRequest, NextResponse } from 'next/server';
import { SEEDANCE_CONFIG, cleanPrompt, resolveAssetUrl, getSeedanceApiKey, getSeedanceConfig } from '@/lib/seedance';
import {
  bindCreationPointTask,
  completeCreationPointTask,
  failCreationPointTask,
  freezeCreationPoints,
  InsufficientCreationPointsError,
} from '@/lib/creation-points';

// 设置 API 路由超时时间为 1 小时（视频生成需要较长时间）
export const maxDuration = 3600; // 单位：秒

/**
 * 创建 Seedance 2.0 视频编辑任务
 */
async function createSeedanceTask(
  prompt: string,
  referenceImageUrl?: string,
  referenceVideoUrl?: string,
  options: {
    ratio?: string;
    duration?: number;
  } = {}
): Promise<{ taskId: string } | null> {
  const apiKey = getSeedanceApiKey();
  if (!apiKey) throw new Error('未配置 Seedance API Key，请在右上角「设置」中填写');
  const seedanceConfig = getSeedanceConfig();

  try {
    const { ratio = '9:16', duration = 15 } = options;

    console.log('=== 创建 Seedance 2.0 视频编辑任务 (xszy.top) ===');
    console.log(`模型: ${seedanceConfig.modelId}`);
    console.log(`提示词: ${prompt.substring(0, 200)}...`);
    console.log(`参考图片: ${referenceImageUrl ? '有' : '无'}`);
    console.log(`参考视频: ${referenceVideoUrl ? '有' : '无'}`);
    console.log(`比例: ${ratio}, 持续: ${duration}s`);

    const requestBody: Record<string, unknown> = {
      model: seedanceConfig.modelId,
      prompt,
      duration,
      ratio,
    };

    if (referenceImageUrl) {
      requestBody.image_url = referenceImageUrl;
    }

    if (referenceVideoUrl) {
      requestBody.video_url = referenceVideoUrl;
    }

    console.log('请求参数:', JSON.stringify(requestBody, null, 2));

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
    console.log('创建任务响应:', JSON.stringify(result, null, 2));

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
    console.log(`=== 查询任务状态: ${taskId} ===`);

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

    console.log(`任务状态: ${result.status}, 进度: ${result.progress || 'N/A'}`);

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
        console.log(`✓ 视频编辑成功: ${videoUrl.substring(0, 100)}...`);
        return { videoUrl, status: result.status };
      }

      console.error('任务成功但未找到视频 URL');
      return { videoUrl: null, status: result.status, error: '未找到视频 URL' };
    }

    if (result.status === 'FAILED') {
      console.error(`✗ 任务失败: ${result.error || result.message || '未知错误'}`);
      return {
        videoUrl: null,
        status: result.status,
        error: result.error || result.message || '视频编辑失败',
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
  maxWaitTime: number = SEEDANCE_CONFIG.maxWaitTime
): Promise<{ videoUrl: string | null; error?: string }> {
  console.log(`=== 开始轮询任务: ${taskId} ===`);

  const startTime = Date.now();
  const pollInterval = SEEDANCE_CONFIG.pollInterval * 1000;

  while (Date.now() - startTime < maxWaitTime * 1000) {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    console.log(`⏱️  已等待 ${elapsed} 秒，查询任务状态...`);

    try {
      const result = await getSeedanceTaskStatus(taskId);

      if (!result) {
        console.warn('查询返回空，继续等待...');
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        continue;
      }

      if (result.videoUrl) {
        console.log('✓ 视频编辑完成');
        return { videoUrl: result.videoUrl };
      }

      if (result.status === 'FAILED') {
        console.error(`✗ 任务失败: ${result.error}`);
        return { videoUrl: null, error: result.error || '视频编辑失败' };
      }

      console.log(`→ 任务状态: ${result.status}，继续等待...`);
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('轮询任务异常:', msg);
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }

  console.error('✗ 任务超时');
  return { videoUrl: null, error: `视频编辑超时（已等待 ${maxWaitTime} 秒）` };
}

/**
 * POST - 视频编辑接口
 */
export async function POST(request: NextRequest) {
  let creationPointTaskId = '';
  try {
    const body = await request.json();

    const { prompt, referenceImageUrl, referenceVideoUrl, ratio, duration } = body;

    // 验证必要参数
    if (!prompt) {
      return NextResponse.json({ success: false, error: '请提供视频编辑提示词' }, { status: 400 });
    }

    if (!referenceImageUrl && !referenceVideoUrl) {
      return NextResponse.json(
        { success: false, error: '请至少提供一个参考素材（图片或视频）' },
        { status: 400 }
      );
    }

    if (!getSeedanceApiKey()) {
      return NextResponse.json({ success: false, error: '未配置 Seedance API Key，请在右上角「设置」中填写' }, { status: 500 });
    }

    console.log('=== Seedance 2.0 视频编辑请求 ===');
    console.log(`提示词长度: ${prompt.length} 字符`);
    console.log(`参考图片: ${referenceImageUrl ? '有' : '无'}`);
    console.log(`参考视频: ${referenceVideoUrl ? '有' : '无'}`);
    console.log(`比例: ${ratio || '16:9'}`);
    console.log(`持续时间: ${duration || 5}秒`);

    if (prompt.length < 5) {
      return NextResponse.json({ success: false, error: '提示词内容过短，请提供更详细的描述（至少 5 个字符）' }, { status: 400 });
    }

    const validRatios = ['16:9', '9:16', '1:1', '4:3', '3:4'];
    if (ratio && !validRatios.includes(ratio)) {
      return NextResponse.json({ success: false, error: `视频比例无效，支持 ${validRatios.join('、')}` }, { status: 400 });
    }

    if (duration && (duration < 1 || duration > 30)) {
      return NextResponse.json({ success: false, error: '视频持续时间必须在 1-30 秒之间' }, { status: 400 });
    }

    // 解析素材 URL
    const resolvedImageUrl = await resolveAssetUrl(referenceImageUrl);
    const resolvedVideoUrl = await resolveAssetUrl(referenceVideoUrl);

    if (referenceImageUrl && !resolvedImageUrl) {
      console.warn('参考图片 URL 解析失败，继续使用原 URL');
    }
    if (referenceVideoUrl && !resolvedVideoUrl) {
      console.warn('参考视频 URL 解析失败，继续使用原 URL');
    }

    const cleanedPrompt = cleanPrompt(prompt);
    const truncatedPrompt = cleanedPrompt.length > 800 ? cleanedPrompt.substring(0, 800) : cleanedPrompt;
    console.log(`✓ 提示词已清理，长度: ${truncatedPrompt.length} 字符`);

    const normalizedDuration = duration || 5;
    const pointTask = await freezeCreationPoints({
      featureCode: 'video_edit',
      quantity: normalizedDuration,
      metadata: {
        duration: normalizedDuration,
        ratio: ratio || '16:9',
        hasReferenceImage: Boolean(referenceImageUrl),
        hasReferenceVideo: Boolean(referenceVideoUrl),
      },
    });
    creationPointTaskId = pointTask.taskId;

    const taskResult = await createSeedanceTask(
      truncatedPrompt,
      resolvedImageUrl || referenceImageUrl,
      resolvedVideoUrl || referenceVideoUrl,
      {
        ratio: ratio || '16:9',
        duration: duration || 5,
      }
    );

    if (!taskResult || !taskResult.taskId) {
      await failCreationPointTask(creationPointTaskId, '创建视频编辑任务失败');
      return NextResponse.json({ success: false, error: '创建视频编辑任务失败' }, { status: 500 });
    }
    await bindCreationPointTask(creationPointTaskId, taskResult.taskId);

    const finalResult = await pollTaskCompletion(taskResult.taskId, SEEDANCE_CONFIG.maxWaitTime);

    if (finalResult.videoUrl) {
      await completeCreationPointTask(creationPointTaskId);
      console.log('✓ 视频编辑成功');
      return NextResponse.json({
        success: true,
        video: {
          url: finalResult.videoUrl,
          taskId: taskResult.taskId,
          duration: duration || 5,
          ratio: ratio || '16:9',
        },
      });
    }

    console.error('✗ 视频编辑失败:', finalResult.error);
    await failCreationPointTask(creationPointTaskId, finalResult.error || '视频编辑失败');
    return NextResponse.json({ success: false, error: finalResult.error || '视频编辑失败' }, { status: 500 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (creationPointTaskId) {
      await failCreationPointTask(creationPointTaskId, msg).catch((refundError) => {
        console.error('[创作点] 视频编辑任务退回失败:', refundError);
      });
    }
    console.error('视频编辑异常:', error);
    return NextResponse.json(
      { success: false, error: error instanceof InsufficientCreationPointsError ? msg : `视频编辑异常: ${msg}` },
      { status: error instanceof InsufficientCreationPointsError ? 402 : 500 }
    );
  }
}
