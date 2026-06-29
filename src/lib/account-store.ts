import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

export const USER_SESSION_COOKIE = 'manfei_user_session';
export const ADMIN_SESSION_COOKIE = 'manfei_admin_session';
export const USER_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const ADMIN_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

interface ManagedAccount {
  id: string;
  username: string;
  name?: string;
  phone?: string;
  wechat?: string;
  status: 'active' | 'disabled';
  passwordSalt: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  loginBonusGrantedAt?: string;
}

interface AccountSession {
  token: string;
  accountId: string;
  createdAt: string;
  expiresAt: string;
}

interface AdminSession {
  token: string;
  createdAt: string;
  expiresAt: string;
}

interface AccountStoreState {
  version: number;
  updatedAt: string;
  accounts: ManagedAccount[];
  userSessions: AccountSession[];
  adminSessions: AdminSession[];
}

export interface PublicAccount {
  id: string;
  username: string;
  name?: string;
  phone?: string;
  wechat?: string;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  loginBonusGrantedAt?: string;
}

export interface AuthResult {
  account: PublicAccount;
  token: string;
  maxAge: number;
}

const ACCOUNT_STORE_FILE_NAME = 'accounts.json';
const DEFAULT_ADMIN_PASSWORD = 'admin123456';

let accountStoreQueue = Promise.resolve();

function nowIso(): string {
  return new Date().toISOString();
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
    console.warn('[账号] 读取资产配置失败，使用默认目录:', error);
    return fallback;
  }
}

function getStorePath(): string {
  return path.join(resolveAssetsPath(), 'project-state', ACCOUNT_STORE_FILE_NAME);
}

function createInitialStore(): AccountStoreState {
  return {
    version: 1,
    updatedAt: nowIso(),
    accounts: [],
    userSessions: [],
    adminSessions: [],
  };
}

function publicAccount(account: ManagedAccount): PublicAccount {
  return {
    id: account.id,
    username: account.username,
    name: account.name,
    phone: account.phone,
    wechat: account.wechat,
    status: account.status,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    lastLoginAt: account.lastLoginAt,
    loginBonusGrantedAt: account.loginBonusGrantedAt,
  };
}

function normalizeStore(input: unknown): AccountStoreState {
  const raw = input && typeof input === 'object' ? input as Partial<AccountStoreState> : {};
  return {
    version: 1,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso(),
    accounts: Array.isArray(raw.accounts) ? raw.accounts.filter((account) => (
      account &&
      typeof account.id === 'string' &&
      typeof account.username === 'string' &&
      typeof account.passwordSalt === 'string' &&
      typeof account.passwordHash === 'string'
    )).map((account) => ({
      ...account,
      status: account.status === 'disabled' ? 'disabled' : 'active',
    })) as ManagedAccount[] : [],
    userSessions: Array.isArray(raw.userSessions) ? raw.userSessions : [],
    adminSessions: Array.isArray(raw.adminSessions) ? raw.adminSessions : [],
  };
}

async function readStore(): Promise<AccountStoreState> {
  try {
    return normalizeStore(JSON.parse(await fsp.readFile(getStorePath(), 'utf-8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[账号] 读取账号库失败，将创建新账号库:', error);
    }
    const initialStore = createInitialStore();
    await writeStore(initialStore);
    return initialStore;
  }
}

async function writeStore(state: AccountStoreState): Promise<void> {
  const storePath = getStorePath();
  await fsp.mkdir(path.dirname(storePath), { recursive: true });
  const tempPath = `${storePath}.${randomUUID()}.tmp`;
  const nextState = {
    ...state,
    updatedAt: nowIso(),
  };
  await fsp.writeFile(tempPath, `${JSON.stringify(nextState, null, 2)}\n`, 'utf-8');
  await fsp.rename(tempPath, storePath);
}

function queueStoreMutation<T>(mutation: (state: AccountStoreState) => T | Promise<T>): Promise<T> {
  const run = accountStoreQueue.then(async () => {
    const state = await readStore();
    pruneExpiredSessions(state);
    const result = await mutation(state);
    await writeStore(state);
    return result;
  });
  accountStoreQueue = run.then(() => undefined, () => undefined);
  return run;
}

function pruneExpiredSessions(state: AccountStoreState): void {
  const now = Date.now();
  state.userSessions = state.userSessions.filter((session) => new Date(session.expiresAt).getTime() > now);
  state.adminSessions = state.adminSessions.filter((session) => new Date(session.expiresAt).getTime() > now);
}

function normalizeUsername(username: unknown): string {
  return typeof username === 'string' ? username.trim() : '';
}

function normalizeComparable(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeOptional(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function makePasswordHash(password: string, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password: string, account: ManagedAccount): boolean {
  const { hash } = makePasswordHash(password, account.passwordSalt);
  const expected = Buffer.from(account.passwordHash, 'hex');
  const actual = Buffer.from(hash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function getAdminPassword(): string {
  return process.env.MANFEI_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
}

function createSessionExpiry(maxAgeSeconds: number): string {
  return new Date(Date.now() + maxAgeSeconds * 1000).toISOString();
}

function findAccountByLogin(state: AccountStoreState, username: string): ManagedAccount | undefined {
  const comparable = normalizeComparable(username);
  return state.accounts.find((account) => (
    normalizeComparable(account.username) === comparable ||
    normalizeComparable(account.id) === comparable
  ));
}

export async function createManagedAccount(input: {
  username: string;
  password: string;
  name?: string;
  phone?: string;
  wechat?: string;
  status?: 'active' | 'disabled';
}): Promise<PublicAccount> {
  return queueStoreMutation((state) => {
    const username = normalizeUsername(input.username);
    const password = typeof input.password === 'string' ? input.password : '';
    if (!username) throw new Error('请输入账号');
    if (password.length < 4) throw new Error('密码至少需要 4 位');
    if (findAccountByLogin(state, username)) throw new Error('账号已存在');

    const createdAt = nowIso();
    const { salt, hash } = makePasswordHash(password);
    const account: ManagedAccount = {
      id: username,
      username,
      name: normalizeOptional(input.name),
      phone: normalizeOptional(input.phone),
      wechat: normalizeOptional(input.wechat),
      status: input.status === 'disabled' ? 'disabled' : 'active',
      passwordSalt: salt,
      passwordHash: hash,
      createdAt,
      updatedAt: createdAt,
    };
    state.accounts.push(account);
    return publicAccount(account);
  });
}

export async function updateManagedAccount(input: {
  accountId: string;
  password?: string;
  name?: string;
  phone?: string;
  wechat?: string;
  status?: 'active' | 'disabled';
}): Promise<PublicAccount> {
  return queueStoreMutation((state) => {
    const account = state.accounts.find((item) => item.id === input.accountId);
    if (!account) throw new Error('账号不存在');
    if (typeof input.name === 'string') account.name = normalizeOptional(input.name);
    if (typeof input.phone === 'string') account.phone = normalizeOptional(input.phone);
    if (typeof input.wechat === 'string') account.wechat = normalizeOptional(input.wechat);
    if (input.status === 'active' || input.status === 'disabled') account.status = input.status;
    if (typeof input.password === 'string' && input.password.trim()) {
      if (input.password.length < 4) throw new Error('密码至少需要 4 位');
      const { salt, hash } = makePasswordHash(input.password);
      account.passwordSalt = salt;
      account.passwordHash = hash;
    }
    account.updatedAt = nowIso();
    return publicAccount(account);
  });
}

export async function authenticateUserAccount(username: string, password: string): Promise<AuthResult> {
  return queueStoreMutation((state) => {
    const account = findAccountByLogin(state, username);
    if (!account || !verifyPassword(password, account)) {
      throw new Error('账号或密码错误');
    }
    if (account.status === 'disabled') {
      throw new Error('账号已停用，请联系管理员');
    }

    const token = randomBytes(32).toString('hex');
    const createdAt = nowIso();
    state.userSessions.push({
      token,
      accountId: account.id,
      createdAt,
      expiresAt: createSessionExpiry(USER_SESSION_MAX_AGE_SECONDS),
    });
    account.lastLoginAt = createdAt;
    account.updatedAt = createdAt;

    return {
      account: publicAccount(account),
      token,
      maxAge: USER_SESSION_MAX_AGE_SECONDS,
    };
  });
}

export async function authenticateAdmin(password: string): Promise<{ token: string; maxAge: number }> {
  return queueStoreMutation((state) => {
    if (password !== getAdminPassword()) {
      throw new Error('后台口令错误');
    }
    const token = randomBytes(32).toString('hex');
    state.adminSessions.push({
      token,
      createdAt: nowIso(),
      expiresAt: createSessionExpiry(ADMIN_SESSION_MAX_AGE_SECONDS),
    });
    return { token, maxAge: ADMIN_SESSION_MAX_AGE_SECONDS };
  });
}

export async function logoutUserSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await queueStoreMutation((state) => {
    state.userSessions = state.userSessions.filter((session) => session.token !== token);
  });
}

export async function getPublicAccountById(accountId: string): Promise<PublicAccount | null> {
  await accountStoreQueue;
  const state = await readStore();
  const account = state.accounts.find((item) => item.id === accountId);
  return account ? publicAccount(account) : null;
}

export async function hasLoginBonusGranted(accountId: string): Promise<boolean> {
  await accountStoreQueue;
  const state = await readStore();
  const account = state.accounts.find((item) => item.id === accountId);
  return Boolean(account?.loginBonusGrantedAt);
}

export async function markLoginBonusGranted(accountId: string): Promise<void> {
  await queueStoreMutation((state) => {
    const account = state.accounts.find((item) => item.id === accountId);
    if (!account || account.loginBonusGrantedAt) return;
    const markedAt = nowIso();
    account.loginBonusGrantedAt = markedAt;
    account.updatedAt = markedAt;
  });
}

export async function listPublicAccounts(): Promise<PublicAccount[]> {
  await accountStoreQueue;
  const state = await readStore();
  return state.accounts.map(publicAccount);
}

export async function getUserAccountByToken(token: string | undefined): Promise<PublicAccount | null> {
  if (!token) return null;
  await accountStoreQueue;
  const state = await readStore();
  pruneExpiredSessions(state);
  const session = state.userSessions.find((item) => item.token === token);
  if (!session) return null;
  const account = state.accounts.find((item) => item.id === session.accountId && item.status === 'active');
  return account ? publicAccount(account) : null;
}

export async function getCurrentUserAccount(): Promise<PublicAccount | null> {
  const cookieStore = await cookies();
  return getUserAccountByToken(cookieStore.get(USER_SESSION_COOKIE)?.value);
}

export async function requireAdminSession(request: NextRequest): Promise<void> {
  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) throw new Error('请先登录后台');
  await accountStoreQueue;
  const state = await readStore();
  pruneExpiredSessions(state);
  const valid = state.adminSessions.some((session) => session.token === token);
  if (!valid) throw new Error('后台登录已过期，请重新登录');
}

export function getDefaultAdminPasswordHint(): string {
  return process.env.MANFEI_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD ? '已使用环境变量后台口令' : DEFAULT_ADMIN_PASSWORD;
}
