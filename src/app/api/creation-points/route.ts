import { NextResponse } from 'next/server';
import {
  getCreationPointSnapshot,
  getPendingExternalCreationPointTasks,
  settleCreationPointTaskByExternalId,
} from '@/lib/creation-points';
import { settleManfeiVideoCreationPointsByTaskId } from '@/lib/manfei-billing';
import { getManfeiVideoStatus } from '@/lib/manfei';

export const dynamic = 'force-dynamic';

const RECONCILE_INTERVAL_MS = 60_000;
let lastReconcileStartedAt = 0;
let reconcilePromise: Promise<void> | null = null;

async function reconcilePendingVideoTasks() {
  const pendingTasks = (await getPendingExternalCreationPointTasks('generate_video')).slice(0, 20);
  await Promise.allSettled(pendingTasks.map(async (task) => {
    const result = await getManfeiVideoStatus(task.externalTaskId);
    const succeeded = ['succeeded', 'success'].includes(result.status);
    const failed = ['failed', 'cancelled', 'expired', 'error'].includes(result.status);
    if (succeeded && result.videoUrl) {
      await settleManfeiVideoCreationPointsByTaskId(task.externalTaskId, {
        attempts: 2,
        intervalMs: 1_000,
      });
    } else if (failed) {
      await settleCreationPointTaskByExternalId(
        task.externalTaskId,
        'failure',
        result.error || '视频生成失败'
      );
    }
  }));
}

function schedulePendingVideoReconciliation() {
  const now = Date.now();
  if (reconcilePromise || now - lastReconcileStartedAt < RECONCILE_INTERVAL_MS) return;

  lastReconcileStartedAt = now;
  reconcilePromise = reconcilePendingVideoTasks()
    .catch((error) => {
      console.warn('[创作点] 后台视频任务对账失败:', error);
    })
    .finally(() => {
      reconcilePromise = null;
    });
}

export async function GET() {
  try {
    const snapshot = await getCreationPointSnapshot();
    schedulePendingVideoReconciliation();
    return NextResponse.json({
      success: true,
      ...snapshot,
    });
  } catch (error) {
    console.error('[创作点] 读取钱包失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '读取创作点钱包失败',
    }, { status: 500 });
  }
}
