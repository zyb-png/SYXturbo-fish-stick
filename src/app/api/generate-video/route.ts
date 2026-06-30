import { NextRequest, NextResponse } from 'next/server';
import {
  createManfeiVideoTask,
  getManfeiVideoStatus,
  prepareManfeiImageAssets,
} from '@/lib/manfei';
import { settleManfeiVideoCreationPointsByTaskId } from '@/lib/manfei-billing';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import {
  bindCreationPointTask,
  failCreationPointTask,
  freezeCreationPoints,
  InsufficientCreationPointsError,
  settleCreationPointTaskByExternalId,
} from '@/lib/creation-points';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const MAX_VIDEO_PROMPT_CHARS = 6000;
const SETTLEMENT_POLL_INTERVAL_MS = 10_000;
const SETTLEMENT_MAX_ATTEMPTS = 720;
const settlementMonitors = new Set<string>();

function cleanVideoPrompt(prompt: string): string {
  return String(prompt || '')
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
    .trim()
    .slice(0, MAX_VIDEO_PROMPT_CHARS);
}

function normalizeRatio(value: unknown): string {
  const ratio = typeof value === 'string' ? value : '9:16';
  return ['16:9', '9:16', '1:1', '4:3', '3:4'].includes(ratio) ? ratio : '9:16';
}

function normalizeDuration(value: unknown): number {
  const parsed = Number(value);
  const duration = Number.isFinite(parsed) ? Math.round(parsed) : 15;
  return Math.min(15, Math.max(4, duration));
}

async function monitorVideoSettlement(taskId: string): Promise<void> {
  if (settlementMonitors.has(taskId)) return;
  settlementMonitors.add(taskId);
  try {
    for (let attempt = 0; attempt < SETTLEMENT_MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, SETTLEMENT_POLL_INTERVAL_MS));
      }
      const result = await getManfeiVideoStatus(taskId);
      if (['succeeded', 'success'].includes(result.status) && result.videoUrl) {
        const settlement = await settleManfeiVideoCreationPointsByTaskId(taskId, {
          attempts: 3,
          intervalMs: 2_000,
        });
        if (settlement.settled) return;
      }
      if (['failed', 'cancelled', 'expired', 'error'].includes(result.status)) {
        await settleCreationPointTaskByExternalId(
          taskId,
          'failure',
          result.error || '视频生成失败'
        );
        return;
      }
    }
    console.warn(`[创作点] 视频任务 ${taskId} 后台结算等待超时，将在钱包刷新时继续复核`);
  } catch (error) {
    console.warn(`[创作点] 视频任务 ${taskId} 后台结算暂时中断，将在钱包刷新时继续复核:`, error);
  } finally {
    settlementMonitors.delete(taskId);
  }
}

export async function POST(request: NextRequest) {
  let creationPointTaskId = '';
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const prompt = cleanVideoPrompt(body.prompt);
    const ratio = normalizeRatio(body.ratio || body.videoRatio);
    const duration = normalizeDuration(body.duration);
    const imageUrls = Array.from(new Set([
      body.imageUrl,
      ...(Array.isArray(body.imageUrls) ? body.imageUrls : []),
    ].filter((url): url is string => typeof url === 'string' && url.trim().length > 0))).slice(0, 9);

    if (prompt.length < 5) {
      return NextResponse.json({
        success: false,
        error: '提示词内容过短，请提供更详细的描述',
      }, { status: 400 });
    }

    const pointTask = await freezeCreationPoints({
      featureCode: 'generate_video',
      quantity: duration,
      metadata: {
        duration,
        ratio,
        referenceImageCount: imageUrls.length,
        model: 'moon-manfei-new',
      },
    });
    creationPointTaskId = pointTask.taskId;

    console.log(`[manfei] 准备 ${imageUrls.length} 张参考图，模型 moon-manfei-new，分辨率 720p，比例 ${ratio}，时长 ${duration} 秒`);
    const assetIds = await prepareManfeiImageAssets(imageUrls, 4);
    const taskId = await createManfeiVideoTask({
      prompt,
      assetIds,
      duration,
      ratio,
    });
    await bindCreationPointTask(creationPointTaskId, taskId);
    void monitorVideoSettlement(taskId);

    return NextResponse.json({
      success: true,
      pending: true,
      task: {
        id: taskId,
        status: 'queued',
        model: 'moon-manfei-new',
        resolution: '720p',
        duration,
        ratio,
        referenceAssetCount: assetIds.length,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (creationPointTaskId) {
      await failCreationPointTask(creationPointTaskId, message).catch((refundError) => {
        console.error('[创作点] 视频任务退回失败:', refundError);
      });
    }
    console.error('[manfei] 创建视频任务失败:', error);
    return NextResponse.json({
      success: false,
      error: message,
    }, { status: error instanceof InsufficientCreationPointsError ? 402 : 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const taskId = new URL(request.url).searchParams.get('taskId');
    if (!taskId) {
      return NextResponse.json({
        success: false,
        error: '缺少 taskId',
      }, { status: 400 });
    }

    const result = await getManfeiVideoStatus(taskId);
    const succeeded = result.status === 'succeeded' || result.status === 'success';
    const failed = ['failed', 'cancelled', 'expired', 'error'].includes(result.status);

    if (succeeded && result.videoUrl) {
      const settlement = await settleManfeiVideoCreationPointsByTaskId(taskId, {
        attempts: 3,
        intervalMs: 1_500,
      });
      return NextResponse.json({
        success: true,
        pending: false,
        billingPending: !settlement.settled,
        billing: settlement.settled
          ? {
              actualCostRmb: settlement.actualCostRmb,
              finalPoints: settlement.finalPoints,
            }
          : undefined,
        video: {
          url: result.videoUrl,
          taskId,
          model: 'moon-manfei-new',
          resolution: '720p',
        },
        usage: result.usage,
      });
    }

    if (failed) {
      await settleCreationPointTaskByExternalId(taskId, 'failure', result.error || '视频生成失败');
      return NextResponse.json({
        success: false,
        pending: false,
        taskId,
        status: result.status,
        error: result.error || '视频生成失败',
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      pending: true,
      taskId,
      status: result.status || 'queued',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({
      success: false,
      error: message,
    }, { status: 500 });
  }
}
