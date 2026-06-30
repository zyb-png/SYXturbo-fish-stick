import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import {
  getCurrentUserAccount,
  getPublicAccountById,
  hasLoginBonusGranted,
  markLoginBonusGranted,
  type PublicAccount,
} from './account-store';

export type CreationPointSource = 'paid' | 'bonus' | 'trial' | 'enterprise';
export type CreationPointTaskStatus = 'frozen' | 'succeeded' | 'failed';
export type CreationPointTransactionType = 'grant' | 'freeze' | 'consume' | 'refund' | 'adjustment';

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

export interface CreationPointAccount {
  id: string;
  username?: string;
  name?: string;
  phone?: string;
  wechat?: string;
  status?: 'active' | 'pending' | 'disabled';
  createdAt?: string;
}

interface CreationPointState {
  version: number;
  updatedAt: string;
  account: CreationPointAccount | null;
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
  account: CreationPointAccount | null;
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
const INITIAL_TRIAL_POINTS = 0;
const INITIAL_TRIAL_DAYS = 30;
const ADMIN_LOGIN_BONUS_POINTS = 500;
const ADMIN_LOGIN_BONUS_LABEL = '管理员赠送默认额度';
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

function getAccountStateFileName(accountId: string): string {
  const safeId = accountId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 48) || 'account';
  const digest = createHash('sha256').update(accountId).digest('hex').slice(0, 12);
  return `${safeId}-${digest}.json`;
}

function getStatePath(accountId?: string): string {
  if (accountId) {
    return path.join(
      resolveAssetsPath(),
      'project-state',
      'creation-points',
      'accounts',
      getAccountStateFileName(accountId)
    );
  }
  return path.join(resolveAssetsPath(), 'project-state', STATE_FILE_NAME);
}

function nowIso(): string {
  return new Date().toISOString();
}

function isBatchAvailable(batch: CreationPointBatch, now = Date.now()): boolean {
  return !batch.expiresAt || new Date(batch.expiresAt).getTime() > now;
}

function createInitialState(account: CreationPointAccount | null = null): CreationPointState {
  const createdAt = nowIso();
  const batches: CreationPointBatch[] = [];
  const transactions: CreationPointTransaction[] = [];

  if (INITIAL_TRIAL_POINTS > 0) {
    const expiresAt = new Date(Date.now() + INITIAL_TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const batchId = randomUUID();
    batches.push({
      id: batchId,
      source: 'trial',
      label: '本机体验额度',
      initialPoints: INITIAL_TRIAL_POINTS,
      remainingPoints: INITIAL_TRIAL_POINTS,
      frozenPoints: 0,
      createdAt,
      expiresAt,
    });
    transactions.push({
      id: randomUUID(),
      taskId: null,
      batchId,
      type: 'grant',
      amount: INITIAL_TRIAL_POINTS,
      featureCode: null,
      description: `发放本机体验额度，有效期 ${INITIAL_TRIAL_DAYS} 天`,
      createdAt,
    });
  }

  return {
    version: 1,
    updatedAt: createdAt,
    account,
    consumedPoints: 0,
    batches,
    tasks: [],
    transactions,
  };
}

function accountFromPublicAccount(account: PublicAccount): CreationPointAccount {
  return {
    id: account.id,
    username: account.username,
    name: account.name,
    phone: account.phone,
    wechat: account.wechat,
    status: account.status === 'disabled' ? 'disabled' : 'active',
    createdAt: account.createdAt,
  };
}

function normalizeAccount(account: unknown): CreationPointAccount | null {
  if (!account || typeof account !== 'object') return null;
  const raw = account as Partial<CreationPointAccount>;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!id && !name) return null;

  return {
      id: id || name,
      username: typeof raw.username === 'string' && raw.username.trim() ? raw.username.trim() : undefined,
      name: name || undefined,
    phone: typeof raw.phone === 'string' && raw.phone.trim() ? raw.phone.trim() : undefined,
    wechat: typeof raw.wechat === 'string' && raw.wechat.trim() ? raw.wechat.trim() : undefined,
    status: raw.status === 'pending' || raw.status === 'disabled' ? raw.status : 'active',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
  };
}

function normalizeState(input: unknown, account: CreationPointAccount | null = null): CreationPointState {
  const raw = input && typeof input === 'object' ? input as Partial<CreationPointState> : {};
  return {
    version: 1,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso(),
    account: account || normalizeAccount(raw.account),
    consumedPoints: Number.isFinite(raw.consumedPoints) ? Math.max(0, Number(raw.consumedPoints)) : 0,
    batches: Array.isArray(raw.batches) ? raw.batches : [],
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    transactions: Array.isArray(raw.transactions) ? raw.transactions : [],
  };
}

async function readState(account: CreationPointAccount | null = null): Promise<CreationPointState> {
  const statePath = getStatePath(account?.id);
  try {
    return normalizeState(JSON.parse(await fsp.readFile(statePath, 'utf-8')), account);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[创作点] 读取账本失败，将创建新账本:', error);
    }
    const initialState = createInitialState(account);
    await writeState(initialState);
    return initialState;
  }
}

async function writeState(state: CreationPointState): Promise<void> {
  const statePath = getStatePath(state.account?.id);
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

function queueMutation<T>(
  account: CreationPointAccount,
  mutation: (state: CreationPointState) => Promise<T> | T
): Promise<T> {
  const run = mutationQueue.then(async () => {
    const state = await readState(account);
    state.account = account;
    const result = await mutation(state);
    await writeState(state);
    return result;
  });
  mutationQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function resolveCurrentCreationPointAccount(): Promise<CreationPointAccount | null> {
  const account = await getCurrentUserAccount();
  return account ? accountFromPublicAccount(account) : null;
}

async function resolveCreationPointAccountById(accountId: string): Promise<CreationPointAccount> {
  const account = await getPublicAccountById(accountId);
  if (!account) throw new Error('账号不存在');
  return accountFromPublicAccount(account);
}

async function requireCurrentCreationPointAccount(): Promise<CreationPointAccount> {
  const account = await resolveCurrentCreationPointAccount();
  if (!account) throw new Error('请先登录账号后再使用创作点');
  if (account.status === 'disabled') throw new Error('账号已停用，请联系管理员');
  return account;
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
    consumedPoints: getActualConsumedPoints(state),
    totalGrantedPoints: state.batches.reduce((sum, batch) => sum + Math.max(0, batch.initialPoints), 0),
  };
}

function getActualConsumedPoints(state: CreationPointState): number {
  const transactionConsumed = state.transactions.reduce((sum, transaction) => {
    if (transaction.type !== 'consume') return sum;
    if (!transaction.taskId && !transaction.featureCode) return sum;
    return sum + Math.max(0, Math.round(transaction.amount || 0));
  }, 0);

  const taskConsumed = state.tasks.reduce((sum, task) => {
    if (task.status !== 'succeeded') return sum;
    return sum + Math.max(0, Math.round(task.finalPoints ?? task.estimatedPoints ?? 0));
  }, 0);

  return Math.max(transactionConsumed, taskConsumed);
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

function normalizeTransactionForSnapshot(transaction: CreationPointTransaction): CreationPointTransaction {
  if (transaction.type === 'consume' && !transaction.taskId && !transaction.featureCode) {
    return {
      ...transaction,
      type: 'adjustment',
    };
  }
  return transaction;
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

function hasAdminLoginBonusBatch(state: CreationPointState): boolean {
  return state.batches.some((batch) => (
    batch.source === 'bonus' &&
    (
      batch.label === ADMIN_LOGIN_BONUS_LABEL ||
      batch.label.includes('管理员赠送')
    )
  ));
}

function ensureAdminLoginBonus(state: CreationPointState): boolean {
  if (!state.account?.id || ADMIN_LOGIN_BONUS_POINTS <= 0) return false;
  if (hasAdminLoginBonusBatch(state)) return false;

  const createdAt = nowIso();
  const batchId = randomUUID();
  state.batches.push({
    id: batchId,
    source: 'bonus',
    label: ADMIN_LOGIN_BONUS_LABEL,
    initialPoints: ADMIN_LOGIN_BONUS_POINTS,
    remainingPoints: ADMIN_LOGIN_BONUS_POINTS,
    frozenPoints: 0,
    createdAt,
    expiresAt: null,
  });
  appendTransaction(state, {
    taskId: null,
    batchId,
    type: 'grant',
    amount: ADMIN_LOGIN_BONUS_POINTS,
    featureCode: null,
    description: `管理员赠送默认额度 ${ADMIN_LOGIN_BONUS_POINTS.toLocaleString('zh-CN')} 点`,
  });
  return true;
}

function buildSnapshot(state: CreationPointState): CreationPointSnapshot {
  const now = Date.now();
  return {
    account: state.account || null,
    summary: getSummary(state),
    batches: state.batches.map((batch) => ({ ...batch, available: isBatchAvailable(batch, now) })),
    pricing: CREATION_POINT_PRICING,
    transactions: [...state.transactions].reverse().slice(0, 100).map(normalizeTransactionForSnapshot),
    tasks: [...state.tasks].reverse().slice(0, 100),
    updatedAt: state.updatedAt,
  };
}

function emptySnapshot(): CreationPointSnapshot {
  const createdAt = nowIso();
  return {
    account: null,
    summary: {
      availablePoints: 0,
      frozenPoints: 0,
      consumedPoints: 0,
      totalGrantedPoints: 0,
    },
    batches: [],
    pricing: CREATION_POINT_PRICING,
    transactions: [],
    tasks: [],
    updatedAt: createdAt,
  };
}

function grantPointsInState(
  state: CreationPointState,
  amount: number,
  label: string,
  source: CreationPointSource = 'bonus'
): void {
  const normalizedAmount = Math.max(0, Math.round(amount));
  if (normalizedAmount <= 0) return;
  const createdAt = nowIso();
  const batchId = randomUUID();
  state.batches.push({
    id: batchId,
    source,
    label,
    initialPoints: normalizedAmount,
    remainingPoints: normalizedAmount,
    frozenPoints: 0,
    createdAt,
    expiresAt: null,
  });
  appendTransaction(state, {
    taskId: null,
    batchId,
    type: 'grant',
    amount: normalizedAmount,
    featureCode: null,
    description: `${label} ${normalizedAmount.toLocaleString('zh-CN')} 点`,
  });
}

function reduceAvailablePointsInState(state: CreationPointState, amount: number, description: string): void {
  let remaining = Math.max(0, Math.round(amount));
  if (remaining <= 0) return;
  let reduced = 0;
  for (const batch of getSpendableBatches(state)) {
    if (remaining <= 0) break;
    const used = Math.min(batch.remainingPoints, remaining);
    batch.remainingPoints -= used;
    reduced += used;
    remaining -= used;
  }
  if (reduced <= 0) return;
  appendTransaction(state, {
    taskId: null,
    batchId: null,
    type: 'adjustment',
    amount: reduced,
    featureCode: null,
    description,
  });
}

export async function getPendingExternalCreationPointTasks(
  featureCode?: string
): Promise<PendingExternalCreationPointTask[]> {
  const account = await resolveCurrentCreationPointAccount();
  if (!account) return [];
  await mutationQueue;
  const state = await readState(account);
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
  const account = await resolveCurrentCreationPointAccount();
  if (!account) return emptySnapshot();
  await queueMutation(account, (state) => {
    releaseStaleTasks(state);
  });
  const state = await readState(account);
  return buildSnapshot(state);
}

export async function getCreationPointSnapshotForAccount(accountId: string): Promise<CreationPointSnapshot> {
  const account = await resolveCreationPointAccountById(accountId);
  await mutationQueue;
  const state = await readState(account);
  return buildSnapshot(state);
}

export async function ensureLoginBonusForAccount(accountId: string): Promise<void> {
  const account = await resolveCreationPointAccountById(accountId);
  if (await hasLoginBonusGranted(account.id)) return;
  let alreadyHadDefaultBonus = false;
  let granted = false;
  await queueMutation(account, (state) => {
    alreadyHadDefaultBonus = hasAdminLoginBonusBatch(state);
    if (alreadyHadDefaultBonus) return;
    granted = ensureAdminLoginBonus(state);
  });
  if (alreadyHadDefaultBonus || granted) {
    await markLoginBonusGranted(account.id);
  }
}

export async function grantCreationPointsToAccount(input: {
  accountId: string;
  points: number;
  label?: string;
  source?: CreationPointSource;
}): Promise<CreationPointSnapshot> {
  const account = await resolveCreationPointAccountById(input.accountId);
  const label = input.label?.trim() || '管理员赠送额度';
  const source = input.source || 'bonus';
  if (source === 'bonus' && (label === ADMIN_LOGIN_BONUS_LABEL || label.includes('管理员赠送'))) {
    throw new Error('默认赠送额度由系统自动发放，每个账号仅一次，不能手动重复赠送');
  }
  await queueMutation(account, (state) => {
    grantPointsInState(
      state,
      input.points,
      label,
      source
    );
  });
  return getCreationPointSnapshotForAccount(account.id);
}

export async function setAccountAvailableCreationPoints(input: {
  accountId: string;
  points: number;
}): Promise<CreationPointSnapshot> {
  const account = await resolveCreationPointAccountById(input.accountId);
  await queueMutation(account, (state) => {
    const target = Math.max(0, Math.round(Number(input.points) || 0));
    const current = getSummary(state).availablePoints;
    const delta = target - current;
    if (delta > 0) {
      grantPointsInState(state, delta, '管理员设置额度', 'bonus');
    } else if (delta < 0) {
      reduceAvailablePointsInState(
        state,
        Math.abs(delta),
        `管理员调整额度至 ${target.toLocaleString('zh-CN')} 点`
      );
    }
  });
  return getCreationPointSnapshotForAccount(account.id);
}

export async function freezeCreationPoints(input: {
  featureCode: string;
  quantity?: number;
  points?: number;
  metadata?: Record<string, unknown>;
}): Promise<{ taskId: string; frozenPoints: number }> {
  const account = await requireCurrentCreationPointAccount();
  return queueMutation(account, (state) => {
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
  const account = await requireCurrentCreationPointAccount();
  await queueMutation(account, (state) => {
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
  const account = await requireCurrentCreationPointAccount();
  await queueMutation(account, (state) => {
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
  const account = await requireCurrentCreationPointAccount();
  await queueMutation(account, (state) => {
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
  const account = await requireCurrentCreationPointAccount();
  await queueMutation(account, (state) => {
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
