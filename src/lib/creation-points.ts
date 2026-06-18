import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

export type CreationPointSource = 'paid' | 'bonus' | 'trial' | 'enterprise';
export type CreationPointTaskStatus = 'frozen' | 'succeeded' | 'failed';
export type CreationPointTransactionType = 'grant' | 'freeze' | 'consume' | 'refund';

export interface CreationPointPricing {
  featureCode: string;
  name: string;
  unit: '次' | '张' | '秒' | '动态';
  unitPoints: number;
  pricingDescription?: string;
  minimumPoints?: number;
  maximumPoints?: number;
  billingEnabled: boolean;
}

interface CreationPointBatch {
  id: string;
  source: CreationPointSource;
  label: string;
  initialPoints: number;
  remainingPoints: number;
  frozenPoints: number;
  createdAt: string;
  expiresAt: string | null;
}

interface PointAllocation {
  batchId: string;
  amount: number;
}

interface CreationPointTask {
  id: string;
  featureCode: string;
  featureName: string;
  quantity: number;
  estimatedPoints: number;
  finalPoints: number | null;
  status: CreationPointTaskStatus;
  allocations: PointAllocation[];
  externalTaskId: string | null;
  metadata: Record<string, unknown>;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CreationPointTransaction {
  id: string;
  taskId: string | null;
  batchId: string | null;
  type: CreationPointTransactionType;
  amount: number;
  featureCode: string | null;
  description: string;
  createdAt: string;
}

interface CreationPointState {
  version: number;
  updatedAt: string;
  consumedPoints: number;
  batches: CreationPointBatch[];
  tasks: CreationPointTask[];
  transactions: CreationPointTransaction[];
}

export interface CreationPointSummary {
  availablePoints: number;
  frozenPoints: number;
  consumedPoints: number;
  totalGrantedPoints: number;
}

export interface CreationPointSnapshot {
  summary: CreationPointSummary;
  batches: Array<CreationPointBatch & { available: boolean }>;
  pricing: CreationPointPricing[];
  transactions: CreationPointTransaction[];
  tasks: CreationPointTask[];
  updatedAt: string;
}

export interface PendingExternalCreationPointTask {
  id: string;
  featureCode: string;
  externalTaskId: string;
  updatedAt: string;
}

export const CREATION_POINT_PRICING: CreationPointPricing[] = [
  { featureCode: 'generate_outline', name: '故事大纲', unit: '次', unitPoints: 50, billingEnabled: false },
  { featureCode: 'generate_character_setting', name: '人物设定', unit: '次', unitPoints: 100, billingEnabled: false },
  { featureCode: 'generate_project_bible', name: '项目设定集', unit: '次', unitPoints: 500, billingEnabled: false },
  { featureCode: 'generate_episode_script', name: '单集剧本', unit: '次', unitPoints: 800, billingEnabled: false },
  {
    featureCode: 'generate_storyboard_text',
    name: '文字分镜',
    unit: '动态',
    unitPoints: 0,
    pricingDescription: '按 DeepSeek 实际 Token 用量：缓存输入 4 点/百万，未缓存输入 200 点/百万，输出 400 点/百万',
    billingEnabled: true,
  },
  {
    featureCode: 'deepseek_text_analysis',
    name: 'DeepSeek 文本分析',
    unit: '动态',
    unitPoints: 0,
    pricingDescription: '缓存输入 4 点/百万 Token，未缓存输入 200 点/百万 Token，输出 400 点/百万 Token',
    billingEnabled: true,
  },
  {
    featureCode: 'generate_asset_image',
    name: '场景/人物/道具图片',
    unit: '张',
    unitPoints: 114,
    pricingDescription: '当前规格 2K + medium，售价为模型成本的 1.5 倍',
    billingEnabled: true,
  },
  {
    featureCode: 'generate_storyboard_image',
    name: '故事板图片',
    unit: '张',
    unitPoints: 170,
    pricingDescription: '当前规格 4K + medium，售价为模型成本的 1.5 倍',
    billingEnabled: true,
  },
  { featureCode: 'generate_video', name: '视频生成', unit: '秒', unitPoints: 240, minimumPoints: 1200, billingEnabled: true },
  { featureCode: 'video_edit', name: '视频编辑', unit: '秒', unitPoints: 400, minimumPoints: 1200, billingEnabled: true },
];

const STATE_FILE_NAME = 'creation-points.json';
const INITIAL_TRIAL_POINTS = 500;
const INITIAL_TRIAL_DAYS = 30;
const STALE_TASK_MS = 24 * 60 * 60 * 1000;
const MAX_TRANSACTIONS = 2_000;
const MAX_TASKS = 1_000;

let mutationQueue = Promise.resolve();

export class InsufficientCreationPointsError extends Error {
  readonly availablePoints: number;
  readonly requiredPoints: number;

  constructor(availablePoints: number, requiredPoints: number) {
    super(`创作点余额不足：需要 ${requiredPoints.toLocaleString('zh-CN')}，当前可用 ${availablePoints.toLocaleString('zh-CN')}`);
    this.name = 'InsufficientCreationPointsError';
    this.availablePoints = availablePoints;
    this.requiredPoints = requiredPoints;
  }
}

function resolveAssetsPath(): string {
  const fallback = path.join(process.cwd(), 'assets');
  const configPath = path.join(process.cwd(), 'assets-config.json');

  try {
    if (!fs.existsSync(configPath)) return fallback;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const configured = typeof config.assetsPath === 'string' ? config.assetsPath.trim() : '';
    if (!configured) return fallback;
    return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
  } catch (error) {
    console.warn('[创作点] 读取资产配置失败，使用默认目录:', error);
    return fallback;
  }
}

function getStatePath(): string {
  return path.join(resolveAssetsPath(), 'project-state', STATE_FILE_NAME);
}

function nowIso(): string {
  return new Date().toISOString();
}

function isBatchAvailable(batch: CreationPointBatch, now = Date.now()): boolean {
  return !batch.expiresAt || new Date(batch.expiresAt).getTime() > now;
}

function createInitialState(): CreationPointState {
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + INITIAL_TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const batchId = randomUUID();
  return {
    version: 1,
    updatedAt: createdAt,
    consumedPoints: 0,
    batches: [{
      id: batchId,
      source: 'trial',
      label: '本机体验额度',
      initialPoints: INITIAL_TRIAL_POINTS,
      remainingPoints: INITIAL_TRIAL_POINTS,
      frozenPoints: 0,
      createdAt,
      expiresAt,
    }],
    tasks: [],
    transactions: [{
      id: randomUUID(),
      taskId: null,
      batchId,
      type: 'grant',
      amount: INITIAL_TRIAL_POINTS,
      featureCode: null,
      description: `发放本机体验额度，有效期 ${INITIAL_TRIAL_DAYS} 天`,
      createdAt,
    }],
  };
}

function normalizeState(input: unknown): CreationPointState {
  const raw = input && typeof input === 'object' ? input as Partial<CreationPointState> : {};
  return {
    version: 1,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso(),
    consumedPoints: Number.isFinite(raw.consumedPoints) ? Math.max(0, Number(raw.consumedPoints)) : 0,
    batches: Array.isArray(raw.batches) ? raw.batches : [],
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    transactions: Array.isArray(raw.transactions) ? raw.transactions : [],
  };
}

async function readState(): Promise<CreationPointState> {
  const statePath = getStatePath();
  try {
    return normalizeState(JSON.parse(await fsp.readFile(statePath, 'utf-8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[创作点] 读取账本失败，将创建新账本:', error);
    }
    const initialState = createInitialState();
    await writeState(initialState);
    return initialState;
  }
}

async function writeState(state: CreationPointState): Promise<void> {
  const statePath = getStatePath();
  await fsp.mkdir(path.dirname(statePath), { recursive: true });
  const tempPath = `${statePath}.${randomUUID()}.tmp`;
  const nextState = {
    ...state,
    updatedAt: nowIso(),
    tasks: state.tasks.slice(-MAX_TASKS),
    transactions: state.transactions.slice(-MAX_TRANSACTIONS),
  };
  await fsp.writeFile(tempPath, `${JSON.stringify(nextState, null, 2)}\n`, 'utf-8');
  await fsp.rename(tempPath, statePath);
}

function queueMutation<T>(mutation: (state: CreationPointState) => Promise<T> | T): Promise<T> {
  const run = mutationQueue.then(async () => {
    const state = await readState();
    const result = await mutation(state);
    await writeState(state);
    return result;
  });
  mutationQueue = run.then(() => undefined, () => undefined);
  return run;
}

function getPricing(featureCode: string): CreationPointPricing {
  const pricing = CREATION_POINT_PRICING.find((item) => item.featureCode === featureCode);
  if (!pricing) throw new Error(`未配置创作点价格: ${featureCode}`);
  return pricing;
}

export function estimateCreationPoints(featureCode: string, quantity = 1): number {
  const pricing = getPricing(featureCode);
  const normalizedQuantity = Math.max(1, Math.ceil(Number(quantity) || 1));
  const calculated = Math.max(pricing.minimumPoints || 0, pricing.unitPoints * normalizedQuantity);
  return pricing.maximumPoints ? Math.min(pricing.maximumPoints, calculated) : calculated;
}

function getSummary(state: CreationPointState): CreationPointSummary {
  const now = Date.now();
  return {
    availablePoints: state.batches
      .filter((batch) => isBatchAvailable(batch, now))
      .reduce((sum, batch) => sum + Math.max(0, batch.remainingPoints), 0),
    frozenPoints: state.batches.reduce((sum, batch) => sum + Math.max(0, batch.frozenPoints), 0),
    consumedPoints: Math.max(0, state.consumedPoints),
    totalGrantedPoints: state.batches.reduce((sum, batch) => sum + Math.max(0, batch.initialPoints), 0),
  };
}

function getSpendableBatches(state: CreationPointState): CreationPointBatch[] {
  const sourceOrder: Record<CreationPointSource, number> = {
    bonus: 0,
    trial: 1,
    enterprise: 2,
    paid: 3,
  };
  return state.batches
    .filter((batch) => isBatchAvailable(batch) && batch.remainingPoints > 0)
    .sort((a, b) => {
      const aExpiry = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bExpiry = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
      return aExpiry - bExpiry || sourceOrder[a.source] - sourceOrder[b.source];
    });
}

function appendTransaction(
  state: CreationPointState,
  transaction: Omit<CreationPointTransaction, 'id' | 'createdAt'>
): void {
  state.transactions.push({
    ...transaction,
    id: randomUUID(),
    createdAt: nowIso(),
  });
}

function refundTaskInState(state: CreationPointState, task: CreationPointTask, reason: string): void {
  if (task.status !== 'frozen') return;
  for (const allocation of task.allocations) {
    const batch = state.batches.find((item) => item.id === allocation.batchId);
    if (!batch) continue;
    batch.frozenPoints = Math.max(0, batch.frozenPoints - allocation.amount);
    batch.remainingPoints += allocation.amount;
  }
  task.status = 'failed';
  task.error = reason;
  task.updatedAt = nowIso();
  appendTransaction(state, {
    taskId: task.id,
    batchId: null,
    type: 'refund',
    amount: task.estimatedPoints,
    featureCode: task.featureCode,
    description: `${task.featureName}失败，已自动退回冻结创作点`,
  });
}

function releaseStaleTasks(state: CreationPointState): boolean {
  let changed = false;
  const cutoff = Date.now() - STALE_TASK_MS;
  for (const task of state.tasks) {
    if (
      task.status === 'frozen' &&
      !task.externalTaskId &&
      new Date(task.updatedAt).getTime() < cutoff
    ) {
      refundTaskInState(state, task, '任务超过 24 小时未完成，系统自动退回');
      changed = true;
    }
  }
  return changed;
}

export async function getPendingExternalCreationPointTasks(
  featureCode?: string
): Promise<PendingExternalCreationPointTask[]> {
  await mutationQueue;
  const state = await readState();
  return state.tasks
    .filter((task) => (
      task.status === 'frozen' &&
      Boolean(task.externalTaskId) &&
      (!featureCode || task.featureCode === featureCode)
    ))
    .map((task) => ({
      id: task.id,
      featureCode: task.featureCode,
      externalTaskId: task.externalTaskId as string,
      updatedAt: task.updatedAt,
    }));
}

export async function getCreationPointSnapshot(): Promise<CreationPointSnapshot> {
  await queueMutation((state) => {
    releaseStaleTasks(state);
  });
  const state = await readState();
  const now = Date.now();
  return {
    summary: getSummary(state),
    batches: state.batches.map((batch) => ({ ...batch, available: isBatchAvailable(batch, now) })),
    pricing: CREATION_POINT_PRICING,
    transactions: [...state.transactions].reverse().slice(0, 100),
    tasks: [...state.tasks].reverse().slice(0, 100),
    updatedAt: state.updatedAt,
  };
}

export async function freezeCreationPoints(input: {
  featureCode: string;
  quantity?: number;
  points?: number;
  metadata?: Record<string, unknown>;
}): Promise<{ taskId: string; frozenPoints: number }> {
  return queueMutation((state) => {
    releaseStaleTasks(state);
    const pricing = getPricing(input.featureCode);
    const quantity = Math.max(1, Math.ceil(Number(input.quantity) || 1));
    const requestedPoints = Number(input.points);
    const requiredPoints = Number.isFinite(requestedPoints)
      ? Math.max(
          pricing.minimumPoints || 0,
          pricing.maximumPoints
            ? Math.min(pricing.maximumPoints, Math.ceil(requestedPoints))
            : Math.ceil(requestedPoints)
        )
      : estimateCreationPoints(input.featureCode, quantity);
    const summary = getSummary(state);
    if (summary.availablePoints < requiredPoints) {
      throw new InsufficientCreationPointsError(summary.availablePoints, requiredPoints);
    }

    const batches = getSpendableBatches(state);

    let remaining = requiredPoints;
    const allocations: PointAllocation[] = [];
    for (const batch of batches) {
      if (remaining <= 0) break;
      const amount = Math.min(batch.remainingPoints, remaining);
      batch.remainingPoints -= amount;
      batch.frozenPoints += amount;
      allocations.push({ batchId: batch.id, amount });
      remaining -= amount;
    }

    const createdAt = nowIso();
    const task: CreationPointTask = {
      id: randomUUID(),
      featureCode: input.featureCode,
      featureName: pricing.name,
      quantity,
      estimatedPoints: requiredPoints,
      finalPoints: null,
      status: 'frozen',
      allocations,
      externalTaskId: null,
      metadata: input.metadata || {},
      error: null,
      createdAt,
      updatedAt: createdAt,
    };
    state.tasks.push(task);
    appendTransaction(state, {
      taskId: task.id,
      batchId: null,
      type: 'freeze',
      amount: requiredPoints,
      featureCode: input.featureCode,
      description: `${pricing.name}预冻结`,
    });
    return { taskId: task.id, frozenPoints: requiredPoints };
  });
}

export async function bindCreationPointTask(taskId: string, externalTaskId: string): Promise<void> {
  await queueMutation((state) => {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task || task.status !== 'frozen') return;
    task.externalTaskId = externalTaskId;
    task.updatedAt = nowIso();
  });
}

export async function completeCreationPointTask(
  taskId: string,
  finalPoints?: number,
  details?: {
    description?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await queueMutation((state) => {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task || task.status !== 'frozen') return;

    const pricing = getPricing(task.featureCode);
    const rawFinalPoints = Math.max(0, Math.round(finalPoints ?? task.estimatedPoints));
    const desiredPoints = Math.min(
      pricing.maximumPoints || Number.MAX_SAFE_INTEGER,
      Math.max(pricing.minimumPoints || 0, rawFinalPoints)
    );

    if (desiredPoints > task.estimatedPoints) {
      let extraNeeded = desiredPoints - task.estimatedPoints;
      let extraFrozen = 0;
      for (const batch of getSpendableBatches(state)) {
        if (extraNeeded <= 0) break;
        const amount = Math.min(batch.remainingPoints, extraNeeded);
        batch.remainingPoints -= amount;
        batch.frozenPoints += amount;
        task.allocations.push({ batchId: batch.id, amount });
        extraNeeded -= amount;
        extraFrozen += amount;
      }
      if (extraFrozen > 0) {
        task.estimatedPoints += extraFrozen;
        appendTransaction(state, {
          taskId: task.id,
          batchId: null,
          type: 'freeze',
          amount: extraFrozen,
          featureCode: task.featureCode,
          description: `${task.featureName}按实际用量补充冻结`,
        });
      }
      if (extraNeeded > 0) {
        task.metadata = {
          ...task.metadata,
          billingShortfallPoints: extraNeeded,
        };
      }
    }

    const settledPoints = Math.min(task.estimatedPoints, desiredPoints);
    let pointsToConsume = settledPoints;
    for (const allocation of task.allocations) {
      const batch = state.batches.find((item) => item.id === allocation.batchId);
      if (!batch) continue;
      const consumed = Math.min(allocation.amount, pointsToConsume);
      const refunded = allocation.amount - consumed;
      batch.frozenPoints = Math.max(0, batch.frozenPoints - allocation.amount);
      batch.remainingPoints += refunded;
      pointsToConsume -= consumed;
    }

    task.status = 'succeeded';
    task.finalPoints = settledPoints;
    task.metadata = {
      ...task.metadata,
      ...(details?.metadata || {}),
    };
    task.updatedAt = nowIso();
    state.consumedPoints += settledPoints;
    appendTransaction(state, {
      taskId: task.id,
      batchId: null,
      type: 'consume',
      amount: settledPoints,
      featureCode: task.featureCode,
      description: details?.description || `${task.featureName}完成扣除`,
    });
  });
}

export async function failCreationPointTask(taskId: string, reason = '任务失败'): Promise<void> {
  await queueMutation((state) => {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;
    refundTaskInState(state, task, reason);
  });
}

export async function settleCreationPointTaskByExternalId(
  externalTaskId: string,
  outcome: 'success' | 'failure',
  reason?: string
): Promise<void> {
  await queueMutation((state) => {
    const task = state.tasks.find((item) => item.externalTaskId === externalTaskId);
    if (!task || task.status !== 'frozen') return;
    if (outcome === 'failure') {
      refundTaskInState(state, task, reason || '外部任务失败');
      return;
    }

    let consumed = 0;
    for (const allocation of task.allocations) {
      const batch = state.batches.find((item) => item.id === allocation.batchId);
      if (!batch) continue;
      batch.frozenPoints = Math.max(0, batch.frozenPoints - allocation.amount);
      consumed += allocation.amount;
    }
    task.status = 'succeeded';
    task.finalPoints = consumed;
    task.updatedAt = nowIso();
    state.consumedPoints += consumed;
    appendTransaction(state, {
      taskId: task.id,
      batchId: null,
      type: 'consume',
      amount: consumed,
      featureCode: task.featureCode,
      description: `${task.featureName}完成扣除`,
    });
  });
}
