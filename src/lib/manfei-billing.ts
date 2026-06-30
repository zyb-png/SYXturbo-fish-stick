import { settleCreationPointTaskByExternalId } from './creation-points';
import { waitForManfeiTaskBilling } from './manfei';
import {
  calculateManfeiVideoCreationPoints,
  MANFEI_VIDEO_PRICE_MULTIPLIER,
  POINTS_PER_RMB,
} from './provider-pricing';

export async function settleManfeiVideoCreationPointsByTaskId(
  taskId: string,
  options: {
    attempts?: number;
    intervalMs?: number;
    limit?: number;
    pages?: number;
  } = {},
): Promise<{
  settled: boolean;
  actualCostRmb?: number;
  finalPoints?: number;
}> {
  let billing = null;
  try {
    billing = await waitForManfeiTaskBilling(taskId, {
      attempts: options.attempts ?? 3,
      intervalMs: options.intervalMs ?? 2_000,
      limit: options.limit ?? 200,
      pages: options.pages ?? 5,
    });
  } catch (error) {
    console.warn(`[创作点] 查询 Manfei 实际账单失败，任务 ${taskId} 将稍后重试:`, error);
    return { settled: false };
  }

  if (!billing) {
    console.warn(`[创作点] Manfei 任务 ${taskId} 暂未查到账单，保留冻结点数等待下次复核`);
    return { settled: false };
  }

  const finalPoints = calculateManfeiVideoCreationPoints(billing.amountRmb);
  await settleCreationPointTaskByExternalId(
    taskId,
    'success',
    undefined,
    finalPoints,
    {
      description: `视频生成按 Manfei 实际账单扣除 ${finalPoints.toLocaleString('zh-CN')} 点`,
      ignoreMinimum: true,
      metadata: {
        billingMode: 'manfei_actual_amount_rmb',
        actualCostRmb: billing.amountRmb,
        saleAmountRmb: Number((finalPoints / POINTS_PER_RMB).toFixed(2)),
        priceMultiplier: MANFEI_VIDEO_PRICE_MULTIPLIER,
        billingItemCount: billing.itemCount,
        billingEndpoints: billing.endpoints,
      },
    }
  );

  return {
    settled: true,
    actualCostRmb: billing.amountRmb,
    finalPoints,
  };
}
