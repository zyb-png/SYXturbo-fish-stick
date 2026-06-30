export type ImageGenerationMode = 'text-to-image' | 'image-to-image';
export type ImageQuality = 'low' | 'medium' | 'high';
export type ImageResolution = '1k' | '2k' | '4k';

export interface DeepSeekBillableUsage {
  cachedInputTokens?: number;
  uncachedInputTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export const POINTS_PER_RMB = 100;
export const DEEPSEEK_PRICE_MULTIPLIER = 2;
export const IMAGE_PRICE_MULTIPLIER = 1.5;
export const MANFEI_VIDEO_PRICE_MULTIPLIER = 1.3;

const TOKENS_PER_PRICE_UNIT = 1_000_000;

const DEEPSEEK_FLASH_COST_RMB_PER_MILLION = {
  cachedInput: 0.02,
  uncachedInput: 1,
  output: 2,
} as const;

const IMAGE_COST_RMB: Record<ImageGenerationMode, Record<ImageQuality, Record<ImageResolution, number>>> = {
  'text-to-image': {
    low: { '1k': 0.06, '2k': 0.13, '4k': 0.19 },
    medium: { '1k': 0.38, '2k': 0.76, '4k': 1.13 },
    high: { '1k': 1.39, '2k': 2.77, '4k': 4.16 },
  },
  'image-to-image': {
    low: { '1k': 0.19, '2k': 0.38, '4k': 0.57 },
    medium: { '1k': 0.38, '2k': 0.76, '4k': 1.13 },
    high: { '1k': 1.39, '2k': 2.77, '4k': 4.16 },
  },
};

function normalizeTokenCount(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

export function calculateDeepSeekCreationPoints(usage: DeepSeekBillableUsage): number {
  const cachedInputTokens = normalizeTokenCount(usage.cachedInputTokens);
  const declaredUncached = normalizeTokenCount(usage.uncachedInputTokens);
  const totalInputTokens = normalizeTokenCount(usage.inputTokens);
  const uncachedInputTokens = declaredUncached || Math.max(0, totalInputTokens - cachedInputTokens);
  const outputTokens = normalizeTokenCount(usage.outputTokens);

  const saleRmb = (
    cachedInputTokens * DEEPSEEK_FLASH_COST_RMB_PER_MILLION.cachedInput +
    uncachedInputTokens * DEEPSEEK_FLASH_COST_RMB_PER_MILLION.uncachedInput +
    outputTokens * DEEPSEEK_FLASH_COST_RMB_PER_MILLION.output
  ) / TOKENS_PER_PRICE_UNIT * DEEPSEEK_PRICE_MULTIPLIER;

  const points = Math.ceil(saleRmb * POINTS_PER_RMB);
  return cachedInputTokens + uncachedInputTokens + outputTokens > 0 ? Math.max(1, points) : 0;
}

export function calculateImageCreationPoints(input: {
  mode: ImageGenerationMode;
  quality: ImageQuality;
  resolution: ImageResolution;
}): number {
  const costRmb = IMAGE_COST_RMB[input.mode][input.quality][input.resolution];
  return Math.ceil(costRmb * (IMAGE_PRICE_MULTIPLIER * POINTS_PER_RMB));
}

export function calculateManfeiVideoCreationPoints(actualCostRmb: number): number {
  const costRmb = Number(actualCostRmb);
  if (!Number.isFinite(costRmb) || costRmb <= 0) return 0;
  return Math.ceil(costRmb * MANFEI_VIDEO_PRICE_MULTIPLIER * POINTS_PER_RMB);
}

export const DEEPSEEK_PRICING_DESCRIPTION =
  '缓存输入 4 点/百万 Token，未缓存输入 200 点/百万 Token，输出 400 点/百万 Token';
