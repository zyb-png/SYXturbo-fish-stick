import { NextResponse } from 'next/server';
import {
  getCreationPointSnapshot,
  getPendingExternalCreationPointTasks,
  settleCreationPointTaskByExternalId,
} from '@/lib/creation-points';
import { getManfeiVideoStatus } from '@/lib/manfei';

export const dynamic = 'force-dynamic';

async function reconcilePendingVideoTasks() {
  const pendingTasks = (await getPendingExternalCreationPointTasks('generate_video')).slice(0, 20);
  await Promise.allSettled(pendingTasks.map(async (task) => {
    const result = await getManfeiVideoStatus(task.externalTaskId);
    const succeeded = ['succeeded', 'success'].includes(result.status);
    const failed = ['failed', 'cancelled', 'expired', 'error'].includes(result.status);
    if (succeeded && result.videoUrl) {
      await settleCreationPointTaskByExternalId(task.externalTaskId, 'success');
    } else if (failed) {
      await settleCreationPointTaskByExternalId(
        task.externalTaskId,
        'failure',
        result.error || '视频生成失败'
      );
    }
  }));
}

export async function GET() {
  try {
    await reconcilePendingVideoTasks();
    return NextResponse.json({
      success: true,
      ...(await getCreationPointSnapshot()),
    });
  } catch (error) {
    console.error('[创作点] 读取钱包失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '读取创作点钱包失败',
    }, { status: 500 });
  }
}
