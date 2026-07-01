import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import * as XLSX from 'xlsx';
import { TosClient } from '@volcengine/tos-sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  try {
    const content = fsSync.readFileSync(envPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index <= 0) continue;
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {}
}

loadEnvFile();

const PORT = Number(process.env.PORT || 4177);
const API_BASE = (process.env.MANFEI_API_BASE || process.env.API_BASE || '').replace(/\/$/, '');
const API_TOKEN = process.env.MANFEI_API_TOKEN || process.env.API_TOKEN || '';
const APP_USERNAME = process.env.APP_USERNAME || 'manfei';
const APP_PASSWORD = process.env.APP_PASSWORD || 'manfei';
const LEGACY_APP_STATE_FILE = process.env.APP_STATE_FILE || path.join(__dirname, '.data', 'app-state.json');
const DB_FILE = process.env.DB_FILE || path.join(__dirname, '.data', 'manfei.sqlite');
const COOKIE_NAME = 'manfei_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const DEFAULT_ADMIN_ID = 'acct_default_admin';
const DEFAULT_PROJECT_ID = 'proj_default';
const MAX_ADMINS = 6;

const TOS_CONFIG = {
  accessKeyId: process.env.TOS_ACCESS_KEY_ID || process.env.VOLCENGINE_TOS_AK || '',
  accessKeySecret: process.env.TOS_ACCESS_KEY_SECRET || process.env.TOS_SECRET_ACCESS_KEY || process.env.VOLCENGINE_TOS_SK || '',
  region: process.env.TOS_REGION || 'cn-beijing',
  bucket: process.env.TOS_BUCKET || '',
  endpoint: process.env.TOS_ENDPOINT || '',
  publicBaseUrl: (process.env.TOS_PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  signedUrlExpires: Math.max(60, Math.min(Number(process.env.TOS_SIGNED_URL_EXPIRES || 604800), 604800)),
};

const VOD_CONFIG = {
  apiKey: process.env.VOD_API_KEY || process.env.VOLCENGINE_VOD_API_KEY || process.env.OPENCLAW_API_KEY || '',
  accessKeyId: process.env.VOD_ACCESS_KEY_ID || process.env.VOLCENGINE_ACCESS_KEY_ID || TOS_CONFIG.accessKeyId,
  accessKeySecret: process.env.VOD_ACCESS_KEY_SECRET || process.env.VOD_SECRET_ACCESS_KEY || process.env.VOLCENGINE_SECRET_ACCESS_KEY || TOS_CONFIG.accessKeySecret,
  region: process.env.VOD_REGION || 'cn-north-1',
  service: process.env.VOD_SERVICE || 'vod',
  host: process.env.VOD_HOST || 'vod.volcengineapi.com',
  version: process.env.VOD_VERSION || '2025-01-01',
  spaceName: process.env.VOD_SPACE_NAME || '',
  bucketName: process.env.VOD_BUCKET_NAME || '',
  subtitleEncodeMode: process.env.VOD_SUBTITLE_ERASE_ENCODE_MODE || 'Size',
};

const RUNNINGHUB_CONFIG = {
  apiKey: process.env.RUNNINGHUB_API_KEY || process.env.RH_API_KEY || '',
  baseUrl: (process.env.RUNNINGHUB_API_BASE || 'https://www.runninghub.cn/openapi/v2').replace(/\/$/, ''),
  subtitleEraseEndpoint: process.env.RUNNINGHUB_SUBTITLE_ERASE_ENDPOINT || '/volc-subtitle-erase-pro/video',
  subtitleEraseType: process.env.RUNNINGHUB_SUBTITLE_ERASE_TYPE || 'subtitle',
  subtitleEncodeMode: process.env.RUNNINGHUB_SUBTITLE_ENCODE_MODE || 'size',
  videoUpscalerEndpoint: process.env.RUNNINGHUB_VIDEO_UPSCALER_ENDPOINT || '/rhart-video/video-upscaler',
  videoUpscalerResolution: process.env.RUNNINGHUB_VIDEO_UPSCALER_RESOLUTION || '720p',
};

fsSync.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function nowIso() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
}

function centsFromYuan(value) {
  if (value === null || value === undefined || value === '') return 0;
  return Math.round(Number(value) * 100);
}

function yuanFromCents(cents) {
  return Number(((Number(cents) || 0) / 100).toFixed(2));
}

function normalizeCents(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [method, salt, hash] = stored.split('$');
  if (method !== 'scrypt' || !salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), candidate);
}

function initDb() {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('super_admin','admin','user')),
      admin_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quotas (
      account_id TEXT PRIMARY KEY,
      total_cents INTEGER NOT NULL DEFAULT 0,
      used_cents INTEGER NOT NULL DEFAULT 0,
      frozen_cents INTEGER NOT NULL DEFAULT 0,
      daily_limit_cents INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      budget_cents INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      admin_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      model TEXT,
      resolution TEXT,
      duration INTEGER,
      ratio TEXT,
      prompt TEXT,
      status TEXT,
      params_json TEXT,
      response_json TEXT,
      video_url TEXT,
      error_message TEXT,
      estimate_cents INTEGER NOT NULL DEFAULT 0,
      frozen_cents INTEGER NOT NULL DEFAULT 0,
      actual_cents INTEGER NOT NULL DEFAULT 0,
      billing_status TEXT NOT NULL DEFAULT 'frozen',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS usage_records (
      id TEXT PRIMARY KEY,
      endpoint TEXT,
      task_id TEXT,
      account_id TEXT,
      admin_id TEXT,
      project_id TEXT,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quota_transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      admin_id TEXT,
      project_id TEXT,
      task_id TEXT,
      type TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      note TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS operation_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      scope_admin_id TEXT,
      action TEXT NOT NULL,
      detail_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pricing_rules (
      id TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      resolution TEXT NOT NULL,
      duration INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      UNIQUE(model, resolution, duration)
    );

    CREATE TABLE IF NOT EXISTS app_state (
      account_id TEXT PRIMARY KEY,
      resources_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const count = db.prepare('SELECT COUNT(*) AS count FROM accounts').get().count;
  if (count === 0) {
    const createdAt = nowIso();
    const insertAccount = db.prepare(`
      INSERT INTO accounts (id, username, display_name, password_hash, role, admin_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `);
    insertAccount.run('acct_super', APP_USERNAME, APP_USERNAME, hashPassword(APP_PASSWORD), 'super_admin', null, createdAt, createdAt);
    insertAccount.run(DEFAULT_ADMIN_ID, 'default_admin', '默认管理员', hashPassword(APP_PASSWORD), 'admin', null, createdAt, createdAt);
    db.prepare('INSERT INTO quotas (account_id, total_cents, used_cents, frozen_cents, daily_limit_cents) VALUES (?, ?, 0, 0, 0)')
      .run('acct_super', 100000000);
    db.prepare('INSERT INTO quotas (account_id, total_cents, used_cents, frozen_cents, daily_limit_cents) VALUES (?, ?, 0, 0, 0)')
      .run(DEFAULT_ADMIN_ID, 100000000);
    db.prepare(`
      INSERT INTO projects (id, admin_id, name, status, budget_cents, notes, created_at, updated_at)
      VALUES (?, ?, '默认项目', 'active', 0, '系统初始化项目', ?, ?)
    `).run(DEFAULT_PROJECT_ID, DEFAULT_ADMIN_ID, createdAt, createdAt);
    logOperation('acct_super', null, 'bootstrap', { superAdmin: APP_USERNAME, defaultAdmin: 'default_admin' });
  }

  seedPricing();
  normalizePricingRulesToPerSecond();
  migrateLegacyAppState();
}

function seedPricing() {
  const count = db.prepare('SELECT COUNT(*) AS count FROM pricing_rules').get().count;
  if (count > 0) return;
  const insert = db.prepare('INSERT INTO pricing_rules (id, model, resolution, duration, amount_cents) VALUES (?, ?, ?, ?, ?)');
  const rates = [
    ['moon-manfei-new', '480p', 60],
    ['moon-manfei-new', '720p', 90],
    ['sun-manfei-new', '480p', 80],
    ['sun-manfei-new', '720p', 120],
    ['sun-manfei-new', '1080p', 180],
  ];
  for (const [model, resolution, perSecond] of rates) {
    insert.run(id('price'), model, resolution, 1, perSecond);
  }
}

function normalizePricingRulesToPerSecond() {
  const rows = db.prepare('SELECT * FROM pricing_rules ORDER BY model, resolution, duration').all();
  if (!rows.length) return;
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.model}\u0000${row.resolution}`;
    const perSecondCents = Math.max(0, Math.ceil(Number(row.amount_cents || 0) / Math.max(1, Number(row.duration || 1))));
    const existing = grouped.get(key);
    if (!existing || Number(row.duration) === 1 || perSecondCents > existing.perSecondCents) {
      grouped.set(key, {
        model: row.model,
        resolution: row.resolution,
        perSecondCents,
      });
    }
  }
  const needsNormalize = rows.length !== grouped.size || rows.some(row => Number(row.duration) !== 1);
  if (!needsNormalize) return;
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM pricing_rules');
    const insert = db.prepare('INSERT INTO pricing_rules (id, model, resolution, duration, amount_cents) VALUES (?, ?, ?, 1, ?)');
    for (const group of grouped.values()) {
      insert.run(id('price'), group.model, group.resolution, group.perSecondCents);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function migrateLegacyAppState() {
  const exists = db.prepare('SELECT account_id FROM app_state WHERE account_id = ?').get(DEFAULT_ADMIN_ID);
  if (exists) return;
  let resources = [];
  try {
    const legacy = JSON.parse(fsSync.readFileSync(LEGACY_APP_STATE_FILE, 'utf8'));
    resources = Array.isArray(legacy.resources) ? legacy.resources : [];
  } catch {}
  db.prepare('INSERT OR REPLACE INTO app_state (account_id, resources_json, updated_at) VALUES (?, ?, ?)')
    .run(DEFAULT_ADMIN_ID, JSON.stringify(resources), nowIso());
}

function logOperation(actorId, scopeAdminId, action, detail = {}) {
  db.prepare(`
    INSERT INTO operation_logs (id, actor_id, scope_admin_id, action, detail_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id('op'), actorId, scopeAdminId, action, JSON.stringify(detail), nowIso());
}

initDb();

function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
}

function sendText(res, status, text, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const text = await readBody(req);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const params = new URLSearchParams(text);
    return Object.fromEntries(params.entries());
  }
}

function parseCookies(req) {
  const result = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return result;
}

function accountPublic(account) {
  if (!account) return null;
  return {
    id: account.id,
    username: account.username,
    display_name: account.display_name,
    role: account.role,
    admin_id: account.admin_id,
    status: account.status,
    deleted_at: account.deleted_at,
    created_at: account.created_at,
    updated_at: account.updated_at,
  };
}

function getAccountById(accountId) {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
}

function getAccountByUsername(username) {
  return db.prepare('SELECT * FROM accounts WHERE username = ?').get(username);
}

function getSession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const session = db.prepare(`
    SELECT sessions.token, sessions.expires_at, accounts.*
    FROM sessions
    JOIN accounts ON accounts.id = sessions.account_id
    WHERE sessions.token = ?
  `).get(token);
  if (!session || session.expires_at < Date.now() || session.deleted_at || session.status !== 'active') {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return { token, account: session };
}

function isApiPath(pathname) {
  return pathname.startsWith('/api/');
}

function isPublicStaticPath(pathname) {
  if (pathname === '/' || pathname === '/index.html') return true;
  if (pathname === '/app.js' || pathname === '/styles.css') return true;
  return /\.(?:png|jpe?g|gif|svg|ico|webp|mp3|wav|m4a)$/i.test(pathname);
}

function redirectToLogin(res) {
  res.writeHead(302, { Location: '/login' });
  res.end();
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
}

function requireSession(req, res) {
  const session = getSession(req);
  if (!session) {
    if (isApiPath(new URL(req.url, `http://${req.headers.host}`).pathname)) {
      sendJson(res, 401, { error: '请先登录' });
    } else {
      redirectToLogin(res);
    }
    return null;
  }
  return session;
}

function roleRank(role) {
  return { user: 1, admin: 2, super_admin: 3 }[role] || 0;
}

function accountAdminId(account) {
  if (account.role === 'user') return account.admin_id;
  if (account.role === 'admin') return account.id;
  return account.admin_id || account.id;
}

function canSeeAccount(actor, target) {
  if (actor.role === 'super_admin') return true;
  if (actor.role === 'admin') return target.id === actor.id || target.admin_id === actor.id;
  return target.id === actor.id;
}

function canSeeProject(actor, project) {
  if (actor.role === 'super_admin') return true;
  if (actor.role === 'admin') return project.admin_id === actor.id;
  return project.admin_id === actor.admin_id;
}

function getQuota(accountId) {
  let quota = db.prepare('SELECT * FROM quotas WHERE account_id = ?').get(accountId);
  if (!quota) {
    db.prepare('INSERT INTO quotas (account_id, total_cents, used_cents, frozen_cents, daily_limit_cents) VALUES (?, 0, 0, 0, 0)').run(accountId);
    quota = db.prepare('SELECT * FROM quotas WHERE account_id = ?').get(accountId);
  }
  return quota;
}

function quotaSummary(accountId) {
  const quota = getQuota(accountId);
  const remaining = quota.total_cents - quota.used_cents - quota.frozen_cents;
  return {
    account_id: accountId,
    total_cents: quota.total_cents,
    used_cents: quota.used_cents,
    frozen_cents: quota.frozen_cents,
    daily_limit_cents: quota.daily_limit_cents,
    remaining_cents: remaining,
    total_rmb: yuanFromCents(quota.total_cents),
    used_rmb: yuanFromCents(quota.used_cents),
    frozen_rmb: yuanFromCents(quota.frozen_cents),
    daily_limit_rmb: yuanFromCents(quota.daily_limit_cents),
    remaining_rmb: yuanFromCents(remaining),
  };
}

function visibleEntries(account) {
  const entries = [{ label: '生成工作台', href: '/' }];
  if (account.role === 'admin') entries.push({ label: '管理员后台', href: '/admin' });
  if (account.role === 'super_admin') {
    entries.push({ label: '超级后台', href: '/super-admin' });
    entries.push({ label: '管理员后台', href: '/admin' });
  }
  return entries;
}

function loginRedirect(role) {
  return role === 'super_admin' ? '/super-admin' : '/';
}

async function handleLogin(req, res) {
  if (req.method === 'GET') {
    return serveLoginPage(res);
  }
  const data = await readJson(req);
  const username = String(data.username || '').trim();
  const password = String(data.password || '');
  const account = getAccountByUsername(username);
  if (!account || account.deleted_at || account.status !== 'active' || !verifyPassword(password, account.password_hash)) {
    if (req.headers.accept?.includes('application/json')) return sendJson(res, 401, { error: '账号或密码不正确' });
    return serveLoginPage(res, '账号或密码不正确');
  }
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(token, account.id, Date.now() + SESSION_TTL_MS, nowIso());
  setSessionCookie(res, token);
  if (req.headers.accept?.includes('application/json') || new URL(req.url, `http://${req.headers.host}`).pathname.startsWith('/api/')) {
    return sendJson(res, 200, { ok: true, account: accountPublic(account), redirect: loginRedirect(account.role) });
  }
  res.writeHead(302, { Location: loginRedirect(account.role) });
  res.end();
}

function serveLoginPage(res, error = '') {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>登录 · 漫飞视频生成</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080704;color:#f8e7bd;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    body:before{content:"";position:fixed;inset:0;background:radial-gradient(circle at 20% 20%,rgba(255,202,93,.24),transparent 30%),radial-gradient(circle at 78% 70%,rgba(255,178,55,.16),transparent 28%);pointer-events:none}
    form{position:relative;width:min(380px,calc(100vw - 40px));padding:28px;border:1px solid rgba(245,189,91,.55);border-radius:16px;background:rgba(9,9,8,.88);box-shadow:0 20px 60px rgba(0,0,0,.45)}
    h1{margin:0 0 8px;font-size:28px}
    p{margin:0 0 22px;color:#bca779}
    label{display:grid;gap:8px;margin:14px 0;color:#e8cf9a}
    input{height:42px;border:1px solid rgba(245,189,91,.45);border-radius:8px;background:#111;color:#fff;padding:0 12px;font-size:15px}
    button{width:100%;height:44px;margin-top:10px;border:0;border-radius:8px;background:linear-gradient(135deg,#f8d58a,#a66b16);color:#1b1104;font-weight:800;font-size:15px;cursor:pointer}
    .password-wrap{position:relative;display:block}
    .password-wrap input{box-sizing:border-box;width:100%;padding-right:46px}
    .password-toggle{position:absolute;right:8px;top:50%;transform:translateY(-50%);display:grid;place-items:center;width:30px;height:30px;margin:0;border:1px solid rgba(245,189,91,.28);border-radius:999px;background:rgba(35,25,10,.72);color:#f5d58d;line-height:1}
    .password-toggle svg{display:block;width:16px;height:16px;stroke:currentColor;stroke-width:1.8;fill:none}
    .password-toggle:hover{border-color:rgba(245,189,91,.7);color:#ffe8ad}
    .back{display:inline-flex;align-items:center;gap:6px;width:max-content;margin:0 0 18px;padding:7px 10px;border:1px solid rgba(245,189,91,.34);border-radius:999px;color:#e8cf9a;background:rgba(35,25,10,.42);font-size:13px;text-decoration:none}
    .back:hover{border-color:rgba(245,189,91,.72);color:#ffe5aa}
    .error{padding:10px 12px;border:1px solid rgba(255,100,100,.55);border-radius:8px;color:#ffd0d0;background:rgba(255,80,80,.12);margin-bottom:12px}
  </style>
</head>
<body>
  <form method="post" action="/login">
    <a class="back" href="/">← 返回主页</a>
    <h1>漫飞视频生成</h1>
    <p>登录后进入工作台或管理后台</p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    <label>账号<input name="username" autocomplete="username" autofocus></label>
    <label>密码<span class="password-wrap"><input id="passwordInput" name="password" type="password" autocomplete="current-password"><button class="password-toggle" type="button" aria-label="显示密码" title="显示密码"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="3"></circle></svg></button></span></label>
    <button type="submit">登录</button>
  </form>
  <script>
    const input = document.getElementById('passwordInput');
    const toggle = document.querySelector('.password-toggle');
    toggle.addEventListener('click', () => {
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      toggle.setAttribute('aria-label', visible ? '显示密码' : '隐藏密码');
      toggle.title = visible ? '显示密码' : '隐藏密码';
    });
  </script>
</body>
</html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function handleLogout(req, res, session) {
  if (session?.token) db.prepare('DELETE FROM sessions WHERE token = ?').run(session.token);
  clearSessionCookie(res);
  if (new URL(req.url, `http://${req.headers.host}`).pathname.startsWith('/api/')) {
    return sendJson(res, 200, { ok: true });
  }
  res.writeHead(302, { Location: '/login' });
  res.end();
}

function mapApiUrl(pathname, search = '') {
  if (pathname === '/api/me') return `/v1/me${search}`;
  if (pathname === '/api/usage') return `/v1/usage${search}`;
  if (pathname === '/api/assets') return `/v1/assets${search}`;
  const asset = pathname.match(/^\/api\/assets\/([^/]+)$/);
  if (asset) return `/v1/assets/${encodeURIComponent(asset[1])}${search}`;
  if (pathname === '/api/video/tasks') return `/v1/video/tasks${search}`;
  if (pathname === '/api/video/tasks/generate') return `/v1/video/tasks/generate${search}`;
  const cancel = pathname.match(/^\/api\/video\/tasks\/([^/]+)\/cancel$/);
  if (cancel) return `/v1/video/tasks/${encodeURIComponent(cancel[1])}/cancel${search}`;
  const task = pathname.match(/^\/api\/video\/tasks\/([^/]+)$/);
  if (task) return `/v1/video/tasks/${encodeURIComponent(task[1])}${search}`;
  return null;
}

async function callManfei(apiPath, { method = 'GET', body = null, headers = {} } = {}) {
  if (!API_BASE || !API_TOKEN) {
    return {
      ok: false,
      status: 500,
      data: { error: '服务端未配置 Manfei API 地址或 Token' },
      text: JSON.stringify({ error: '服务端未配置 Manfei API 地址或 Token' }),
    };
  }
  const response = await fetch(`${API_BASE}${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { ok: response.ok, status: response.status, data, text, headers: response.headers };
}

async function fetchManfeiBalance() {
  const upstream = await callManfei('/v1/me');
  if (!upstream.ok || upstream.data?.balance_rmb === undefined) {
    return {
      ok: false,
      data: upstream.data,
      error: upstream.data?.error || upstream.data?.message || '无法查询 Manfei API 总余额',
    };
  }
  const balanceRmb = Number(upstream.data.balance_rmb) || 0;
  return {
    ok: true,
    data: upstream.data,
    balance_rmb: balanceRmb,
    balance_cents: centsFromYuan(balanceRmb),
  };
}

async function assertQuotaWithinApiBalance(totalCents) {
  if (totalCents <= 0) return null;
  const balance = await fetchManfeiBalance();
  if (!balance.ok) {
    const error = new Error(`${balance.error}，暂时不能分配额度`);
    error.status = 503;
    throw error;
  }
  if (totalCents > balance.balance_cents) {
    const error = new Error(`分配额度不能超过 Manfei API 当前余额 ${balance.balance_rmb} 元`);
    error.status = 400;
    throw error;
  }
  return balance;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function volcDateParts(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    xDate: iso,
    shortDate: iso.slice(0, 8),
  };
}

async function callVolcVod(action, body = {}) {
  if (!VOD_CONFIG.accessKeyId || !VOD_CONFIG.accessKeySecret) {
    return {
      ok: false,
      status: 500,
      data: { error: '服务端未配置火山引擎 VOD AK/SK，无法提交媒体处理任务' },
    };
  }

  const payload = JSON.stringify(body);
  const { xDate, shortDate } = volcDateParts();
  const query = new URLSearchParams({ Action: action, Version: VOD_CONFIG.version });
  const canonicalQuery = [...query.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  const signedHeaders = 'content-type;host;x-date';
  const canonicalHeaders = [
    'content-type:application/json',
    `host:${VOD_CONFIG.host}`,
    `x-date:${xDate}`,
    '',
  ].join('\n');
  const canonicalRequest = [
    'POST',
    '/',
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    sha256Hex(payload),
  ].join('\n');
  const scope = `${shortDate}/${VOD_CONFIG.region}/${VOD_CONFIG.service}/request`;
  const stringToSign = [
    'HMAC-SHA256',
    xDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const kDate = hmac(Buffer.from(VOD_CONFIG.accessKeySecret, 'utf8'), shortDate);
  const kRegion = hmac(kDate, VOD_CONFIG.region);
  const kService = hmac(kRegion, VOD_CONFIG.service);
  const kSigning = hmac(kService, 'request');
  const signature = hmac(kSigning, stringToSign, 'hex');
  const authorization = `HMAC-SHA256 Credential=${VOD_CONFIG.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(`https://${VOD_CONFIG.host}/?${canonicalQuery}`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      Host: VOD_CONFIG.host,
      'X-Date': xDate,
    },
    body: payload,
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { ok: response.ok && !data.ResponseMetadata?.Error, status: response.status, data, text };
}

function buildVodDirectInput(videoUrl) {
  let parsed;
  try {
    parsed = new URL(videoUrl);
  } catch {
    throw Object.assign(new Error('视频 URL 不合法，无法提交媒体处理任务'), { status: 400 });
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw Object.assign(new Error('媒体处理任务只支持 http/https 视频 URL'), { status: 400 });
  }
  const bucketFromHost = parsed.hostname.match(/^(.+?)\.tos-[^.]+\.volces\.com$/)?.[1] || parsed.hostname.split('.')[0];
  const fileName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  if (!fileName) {
    throw Object.assign(new Error('视频 URL 中没有可识别的文件路径'), { status: 400 });
  }
  if (!VOD_CONFIG.spaceName) {
    throw Object.assign(new Error('服务端缺少 VOD_SPACE_NAME，无法使用 DirectUrl 提交字幕擦除/超分任务'), { status: 500 });
  }
  return {
    Type: 'DirectUrl',
    DirectUrl: {
      SpaceName: VOD_CONFIG.spaceName,
      FileName: fileName,
      BucketName: VOD_CONFIG.bucketName || bucketFromHost,
    },
  };
}

function makeSubtitleEraseBody(videoUrl, options = {}) {
  return {
    Input: buildVodDirectInput(videoUrl),
    Operation: {
      Type: 'Task',
      Task: {
        Type: 'Erase',
        Erase: {
          Mode: options.mode || 'Auto',
          Auto: {
            Type: options.autoType || 'Subtitle',
            SubtitleFilter: {},
          },
          VideoOption: {
            EncodeMode: options.encodeMode || VOD_CONFIG.subtitleEncodeMode,
          },
          NewVid: true,
          WithEraseInfo: true,
        },
      },
    },
    Control: {
      ClientToken: options.clientToken || crypto.randomBytes(16).toString('hex'),
      CallbackArgs: options.callbackArgs || 'manfei-subtitle-erase',
    },
  };
}

function makeVideoEnhanceBody(videoUrl, options = {}) {
  return {
    Input: buildVodDirectInput(videoUrl),
    Operation: {
      Type: 'Task',
      Task: {
        Type: options.taskType || 'Enhance',
        Enhance: {
          NewVid: true,
          VideoOption: {
            EncodeMode: options.encodeMode || 'Quality',
          },
        },
      },
    },
    Control: {
      ClientToken: options.clientToken || crypto.randomBytes(16).toString('hex'),
      CallbackArgs: options.callbackArgs || 'manfei-video-enhance',
    },
  };
}

function extractRunId(payload) {
  return payload?.Result?.RunId || payload?.RunId || payload?.run_id || payload?.ResponseMetadata?.RunId;
}

function extractExecutionStatus(payload) {
  return payload?.Result?.Status
    || payload?.Result?.Execution?.Status
    || payload?.Output?.Status
    || payload?.Status
    || payload?.status
    || '';
}

function extractExecutionVideoUrl(payload) {
  const candidates = [
    payload?.Result?.Output?.Task?.Erase?.File?.Url,
    payload?.Result?.Output?.Task?.Erase?.File?.URL,
    payload?.Result?.Output?.Task?.Erase?.File?.DownloadUrl,
    payload?.Result?.Output?.Task?.Enhance?.File?.Url,
    payload?.Result?.Output?.Task?.Enhance?.File?.URL,
    payload?.Result?.Output?.Task?.Enhance?.File?.DownloadUrl,
    payload?.Output?.Task?.Erase?.File?.Url,
    payload?.Output?.Task?.Enhance?.File?.Url,
  ];
  return candidates.find(value => typeof value === 'string' && /^https?:\/\//.test(value)) || '';
}

function runningHubUrl(endpoint) {
  const suffix = String(endpoint || '').startsWith('/') ? endpoint : `/${endpoint}`;
  return `${RUNNINGHUB_CONFIG.baseUrl}${suffix}`;
}

function requireRunningHubKey() {
  if (!RUNNINGHUB_CONFIG.apiKey) {
    throw Object.assign(new Error('服务端缺少 RUNNINGHUB_API_KEY，无法提交 RunningHub 媒体任务'), { status: 500 });
  }
}

async function callRunningHub(endpoint, body) {
  requireRunningHubKey();
  const response = await fetch(runningHubUrl(endpoint), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RUNNINGHUB_CONFIG.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { ok: response.ok && !data.errorCode, status: response.status, data, text };
}

function makeRunningHubSubtitleEraseBody(videoUrl, options = {}) {
  return {
    videoUrl,
    eraseType: options.eraseType || RUNNINGHUB_CONFIG.subtitleEraseType,
    encodeMode: String(options.encodeMode || RUNNINGHUB_CONFIG.subtitleEncodeMode).toLowerCase(),
    clientToken: options.clientToken || crypto.randomBytes(16).toString('hex'),
    ...(Array.isArray(options.eraseRatioLocation) ? { eraseRatioLocation: options.eraseRatioLocation } : {}),
  };
}

function makeRunningHubVideoUpscalerBody(videoUrl, options = {}) {
  return {
    videoUrl,
    targetResolution: options.targetResolution || options.resolution || RUNNINGHUB_CONFIG.videoUpscalerResolution,
  };
}

function extractRunningHubTaskId(payload) {
  return payload?.taskId || payload?.task_id || payload?.data?.taskId || payload?.data?.task_id || '';
}

function extractRunningHubStatus(payload) {
  return payload?.status || payload?.data?.status || '';
}

function extractRunningHubVideoUrl(payload) {
  const results = payload?.results || payload?.data?.results || [];
  if (!Array.isArray(results)) return '';
  const item = results.find(result => {
    const type = String(result?.outputType || '').toLowerCase();
    return type === 'mp4' || type === 'mov' || type === 'video' || /^https?:\/\//.test(String(result?.url || ''));
  });
  return typeof item?.url === 'string' ? item.url : '';
}

async function handleMediaTaskSubmit(req, res, type) {
  try {
    const body = await readJson(req);
    const videoUrl = String(body.video_url || body.videoUrl || '').trim();
    if (!videoUrl) return sendJson(res, 400, { error: '缺少 video_url' });
    if (type === 'subtitle_erase' || type === 'video_enhance') {
      const isSubtitle = type === 'subtitle_erase';
      const requestBody = isSubtitle
        ? makeRunningHubSubtitleEraseBody(videoUrl, body.options || {})
        : makeRunningHubVideoUpscalerBody(videoUrl, body.options || {});
      const endpoint = isSubtitle ? RUNNINGHUB_CONFIG.subtitleEraseEndpoint : RUNNINGHUB_CONFIG.videoUpscalerEndpoint;
      const label = isSubtitle ? '去字幕' : '视频超分';
      const upstream = await callRunningHub(endpoint, requestBody);
      const runId = extractRunningHubTaskId(upstream.data);
      if (!upstream.ok || !runId) {
        return sendJson(res, upstream.status || 500, {
          error: collectErrorText(upstream.data) || upstream.data?.errorMessage || `RunningHub ${label}任务提交失败`,
          raw: upstream.data,
          request: requestBody.clientToken ? { ...requestBody, clientToken: '[hidden]' } : requestBody,
        });
      }
      return sendJson(res, 200, {
        id: runId,
        run_id: runId,
        type,
        provider: 'runninghub',
        status: 'submitted',
        source_video_url: videoUrl,
        request: requestBody.clientToken ? { ...requestBody, clientToken: '[hidden]' } : requestBody,
        raw: upstream.data,
      });
    }
    const requestBody = type === 'subtitle_erase'
      ? makeSubtitleEraseBody(videoUrl, body.options || {})
      : makeVideoEnhanceBody(videoUrl, body.options || {});
    const upstream = await callVolcVod('StartExecution', requestBody);
    const runId = extractRunId(upstream.data);
    if (!upstream.ok || !runId) {
      return sendJson(res, upstream.status || 500, {
        error: collectErrorText(upstream.data) || '火山引擎媒体处理任务提交失败',
        raw: upstream.data,
        request: requestBody,
      });
    }
    return sendJson(res, 200, {
      id: runId,
      run_id: runId,
      type,
      status: 'submitted',
      source_video_url: videoUrl,
      request: requestBody,
      raw: upstream.data,
    });
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error.message || '媒体处理任务提交失败' });
  }
}

async function handleMediaTaskQuery(req, res, runId, taskType = '') {
  if (taskType === 'subtitle_erase' || taskType === 'video_enhance') {
    const upstream = await callRunningHub('/query', { taskId: runId });
    if (!upstream.ok) {
      return sendJson(res, upstream.status || 500, {
        error: collectErrorText(upstream.data) || upstream.data?.errorMessage || 'RunningHub 媒体任务查询失败',
        raw: upstream.data,
      });
    }
    const status = extractRunningHubStatus(upstream.data);
    const videoUrl = extractRunningHubVideoUrl(upstream.data);
    return sendJson(res, 200, {
      id: runId,
      run_id: runId,
      type: taskType,
      provider: 'runninghub',
      status,
      video_url: videoUrl,
      raw: upstream.data,
    });
  }
  const upstream = await callVolcVod('GetExecution', { RunId: runId });
  if (!upstream.ok) {
    return sendJson(res, upstream.status || 500, {
      error: collectErrorText(upstream.data) || '媒体处理任务查询失败',
      raw: upstream.data,
    });
  }
  const status = extractExecutionStatus(upstream.data);
  const videoUrl = extractExecutionVideoUrl(upstream.data);
  return sendJson(res, 200, {
    id: runId,
    run_id: runId,
    status,
    video_url: videoUrl,
    raw: upstream.data,
  });
}

function extractTaskId(payload) {
  return payload?.id || payload?.task_id || payload?.detail?.task_id || payload?.data?.id || payload?.data?.task_id;
}

function extractVideoUrl(payload) {
  return payload?.content?.video_url || payload?.video_url || payload?.url || payload?.data?.content?.video_url || payload?.data?.video_url;
}

function extractPrompt(content) {
  if (!Array.isArray(content)) return '';
  const textItem = content.find(item => item?.type === 'text');
  return String(textItem?.text || '').slice(0, 8000);
}

function getPricing(model, resolution, duration) {
  const seconds = Math.max(1, Math.round(Number(duration) || 1));
  const perSecond = db.prepare(`
    SELECT * FROM pricing_rules
    WHERE model = ? AND resolution = ? AND duration = 1
  `).get(model, resolution);
  if (perSecond) {
    return {
      ...perSecond,
      amount_cents: Number(perSecond.amount_cents) * seconds,
      per_second_cents: Number(perSecond.amount_cents),
    };
  }
  return db.prepare(`
    SELECT * FROM pricing_rules
    WHERE model = ? AND resolution = ? AND duration = ?
  `).get(model, resolution, seconds);
}

function projectCommittedCents(projectId) {
  return db.prepare(`
    SELECT COALESCE(SUM(
      CASE
        WHEN usage_totals.amount_cents IS NOT NULL THEN usage_totals.amount_cents
        WHEN tasks.actual_cents IS NOT NULL AND tasks.actual_cents > 0 THEN tasks.actual_cents
        WHEN tasks.billing_status IN ('refunded') THEN 0
        WHEN tasks.status IN ('failed', 'cancelled', 'expired') THEN 0
        ELSE COALESCE(NULLIF(tasks.frozen_cents, 0), tasks.estimate_cents, 0)
      END
    ), 0) AS used
    FROM tasks
    LEFT JOIN (
      SELECT task_id, SUM(amount_cents) AS amount_cents
      FROM usage_records
      GROUP BY task_id
    ) usage_totals ON usage_totals.task_id = tasks.id
    WHERE tasks.project_id = ?
  `).get(projectId).used;
}

function ensureBudget(actor, project, estimateCents) {
  const accountQuota = quotaSummary(actor.id);
  if (accountQuota.remaining_cents < estimateCents) {
    throw Object.assign(new Error(`当前账号额度不足，预计需要 ${yuanFromCents(estimateCents)} 元，剩余 ${accountQuota.remaining_rmb} 元`), { status: 402 });
  }
  if (actor.role === 'user') {
    const adminQuota = quotaSummary(actor.admin_id);
    if (adminQuota.remaining_cents < estimateCents) {
      throw Object.assign(new Error('所属管理员团队额度不足，暂时不能继续生成'), { status: 402 });
    }
  }
  if (project.budget_cents > 0) {
    const used = projectCommittedCents(project.id);
    const remaining = project.budget_cents - used;
    if (remaining < estimateCents) {
      throw Object.assign(new Error(`项目「${project.name}」预算不足：预算 ${yuanFromCents(project.budget_cents)} 元，已占用 ${yuanFromCents(used)} 元，剩余 ${yuanFromCents(Math.max(0, remaining))} 元，本次预计 ${yuanFromCents(estimateCents)} 元。请联系管理员增加预算后再生成。`), { status: 402 });
    }
  }
}

function applyQuotaDelta(accountId, changes) {
  getQuota(accountId);
  const current = getQuota(accountId);
  const next = {
    total_cents: changes.total_cents ?? current.total_cents,
    used_cents: Math.max(0, current.used_cents + (changes.used_delta || 0)),
    frozen_cents: Math.max(0, current.frozen_cents + (changes.frozen_delta || 0)),
    daily_limit_cents: changes.daily_limit_cents ?? current.daily_limit_cents,
  };
  db.prepare(`
    UPDATE quotas SET total_cents = ?, used_cents = ?, frozen_cents = ?, daily_limit_cents = ?
    WHERE account_id = ?
  `).run(next.total_cents, next.used_cents, next.frozen_cents, next.daily_limit_cents, accountId);
  return next;
}

function addQuotaTransaction({ accountId, adminId = null, projectId = null, taskId = null, type, amountCents, note = '', createdBy = null }) {
  db.prepare(`
    INSERT INTO quota_transactions (id, account_id, admin_id, project_id, task_id, type, amount_cents, note, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id('txn'), accountId, adminId, projectId, taskId, type, amountCents, note, createdBy, nowIso());
}

function freezeQuota(actor, project, taskId, amountCents) {
  applyQuotaDelta(actor.id, { frozen_delta: amountCents });
  addQuotaTransaction({ accountId: actor.id, adminId: project.admin_id, projectId: project.id, taskId, type: 'freeze', amountCents, note: '任务预冻结', createdBy: actor.id });
  if (actor.role === 'user') {
    applyQuotaDelta(actor.admin_id, { frozen_delta: amountCents });
    addQuotaTransaction({ accountId: actor.admin_id, adminId: actor.admin_id, projectId: project.id, taskId, type: 'team_freeze', amountCents, note: `用户 ${actor.username} 任务预冻结`, createdBy: actor.id });
  }
}

function settleQuota(actor, task, actualCents, billingStatus = 'settled') {
  const frozen = Number(task.frozen_cents) || 0;
  if (task.billing_status === 'settled' || task.billing_status === 'refunded') return;
  applyQuotaDelta(actor.id, { frozen_delta: -frozen, used_delta: actualCents });
  addQuotaTransaction({ accountId: actor.id, adminId: task.admin_id, projectId: task.project_id, taskId: task.id, type: 'settle', amountCents: actualCents, note: `冻结 ${yuanFromCents(frozen)} 元，实际 ${yuanFromCents(actualCents)} 元`, createdBy: actor.id });
  if (actor.role === 'user') {
    applyQuotaDelta(task.admin_id, { frozen_delta: -frozen, used_delta: actualCents });
    addQuotaTransaction({ accountId: task.admin_id, adminId: task.admin_id, projectId: task.project_id, taskId: task.id, type: 'team_settle', amountCents: actualCents, note: `用户 ${actor.username} 任务结算`, createdBy: actor.id });
  }
  db.prepare('UPDATE tasks SET actual_cents = ?, billing_status = ?, updated_at = ? WHERE id = ?')
    .run(actualCents, billingStatus, nowIso(), task.id);
}

function releaseQuota(actor, task, note = '任务未产生扣费，释放冻结金额') {
  const frozen = Number(task.frozen_cents) || 0;
  if (task.billing_status === 'settled' || task.billing_status === 'refunded') return;
  applyQuotaDelta(actor.id, { frozen_delta: -frozen });
  addQuotaTransaction({ accountId: actor.id, adminId: task.admin_id, projectId: task.project_id, taskId: task.id, type: 'release', amountCents: frozen, note, createdBy: actor.id });
  if (actor.role === 'user') {
    applyQuotaDelta(task.admin_id, { frozen_delta: -frozen });
    addQuotaTransaction({ accountId: task.admin_id, adminId: task.admin_id, projectId: task.project_id, taskId: task.id, type: 'team_release', amountCents: frozen, note, createdBy: actor.id });
  }
  db.prepare('UPDATE tasks SET actual_cents = 0, billing_status = ?, updated_at = ? WHERE id = ?')
    .run('refunded', nowIso(), task.id);
}

async function syncUsageForTask(taskId) {
  const matched = [];
  for (let offset = 0; offset <= 800; offset += 200) {
    const upstream = await callManfei(`/v1/usage?charged_only=true&limit=200&offset=${offset}`);
    if (!upstream.ok) return { amountCents: null, items: matched };
    const items = Array.isArray(upstream.data?.items) ? upstream.data.items : [];
    matched.push(...items.filter(item => String(item.task_id || item.taskId || item.task?.id || '') === String(taskId)));
    if (matched.length > 0 || items.length < 200) break;
  }
  db.prepare('DELETE FROM usage_records WHERE task_id = ?').run(taskId);
  let amountCents = 0;
  for (const item of matched) {
    const cents = centsFromYuan(item.amount_rmb ?? item.amount ?? item.cost_rmb ?? 0);
    amountCents += cents;
    db.prepare(`
      INSERT INTO usage_records (id, endpoint, task_id, account_id, admin_id, project_id, amount_cents, raw_json, created_at)
      SELECT ?, ?, ?, account_id, admin_id, project_id, ?, ?, ?
      FROM tasks WHERE id = ?
    `).run(id('usage'), '/v1/usage', taskId, cents, JSON.stringify(item), nowIso(), taskId);
  }
  return { amountCents, items: matched };
}

async function maybeSettleTask(task, upstreamPayload) {
  const status = upstreamPayload?.status || task.status;
  if (!['succeeded', 'failed', 'cancelled', 'expired'].includes(status)) return;
  const actor = getAccountById(task.account_id);
  if (!actor) return;
  const usage = await syncUsageForTask(task.id);
  if (usage.amountCents !== null && usage.items.length > 0) {
    settleQuota(actor, task, usage.amountCents, 'settled');
    return;
  }
  if (status === 'succeeded') {
    db.prepare('UPDATE tasks SET billing_status = ?, updated_at = ? WHERE id = ?').run('pending_billing', nowIso(), task.id);
  } else {
    releaseQuota(actor, task);
  }
}

function getVisibleProject(actor, projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL').get(projectId);
  if (!project || !canSeeProject(actor, project)) return null;
  return project;
}

async function handleCreateVideoTask(req, res, session, sync = false) {
  const actor = session.account;
  try {
    const body = await readJson(req);
    const projectId = String(body.project_id || body.projectId || '').trim();
    if (!projectId) throw Object.assign(new Error('生成视频前必须选择项目'), { status: 400 });
    const project = getVisibleProject(actor, projectId);
    if (!project || project.status !== 'active') throw Object.assign(new Error('项目不存在或已暂停'), { status: 403 });
    const duration = Number(body.duration || 5);
    const pricing = getPricing(body.model, body.resolution, duration);
    if (!pricing) {
      throw Object.assign(new Error('本地估算价格表缺少当前模型/分辨率/时长，请联系超级管理员配置后再提交'), { status: 400 });
    }
    const estimateCents = Number(pricing.amount_cents);
    ensureBudget(actor, project, estimateCents);

    const upstreamBody = { ...body };
    delete upstreamBody.project_id;
    delete upstreamBody.projectId;
    const upstream = await callManfei(sync ? '/v1/video/tasks/generate' : '/v1/video/tasks', {
      method: 'POST',
      body: upstreamBody,
    });
    if (!upstream.ok) return sendJson(res, upstream.status, upstream.data);

    const taskId = extractTaskId(upstream.data) || id('task');
    const createdAt = nowIso();
    const adminId = actor.role === 'user' ? actor.admin_id : actor.id;
    db.prepare(`
      INSERT OR REPLACE INTO tasks
      (id, account_id, admin_id, project_id, model, resolution, duration, ratio, prompt, status, params_json, response_json, video_url, error_message, estimate_cents, frozen_cents, actual_cents, billing_status, created_at, updated_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'frozen', ?, ?, ?)
    `).run(
      taskId,
      actor.id,
      adminId,
      project.id,
      body.model || '',
      body.resolution || '',
      duration,
      body.ratio || '',
      extractPrompt(body.content),
      upstream.data?.status || 'queued',
      JSON.stringify(upstreamBody),
      JSON.stringify(upstream.data),
      extractVideoUrl(upstream.data) || null,
      null,
      estimateCents,
      estimateCents,
      createdAt,
      createdAt,
      ['succeeded', 'failed', 'cancelled', 'expired'].includes(upstream.data?.status) ? createdAt : null
    );
    freezeQuota(actor, project, taskId, estimateCents);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    await maybeSettleTask(task, upstream.data);
    return sendJson(res, upstream.status, {
      ...upstream.data,
      id: extractTaskId(upstream.data) || taskId,
      billing: {
        project_id: project.id,
        estimate_rmb: yuanFromCents(estimateCents),
        frozen_rmb: yuanFromCents(estimateCents),
      },
    });
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error.message || '任务提交失败' });
  }
}

async function handleQueryVideoTask(req, res, session, taskId) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (task) {
    const target = getAccountById(task.account_id);
    if (!target || !canSeeAccount(session.account, target)) return sendJson(res, 403, { error: '无权查看该任务' });
  }
  const upstream = await callManfei(`/v1/video/tasks/${encodeURIComponent(taskId)}`);
  if (!upstream.ok) return sendJson(res, upstream.status, upstream.data);
  if (task) {
    const status = upstream.data?.status || task.status;
    db.prepare(`
      UPDATE tasks SET status = ?, response_json = ?, video_url = ?, error_message = ?, updated_at = ?, completed_at = COALESCE(completed_at, ?)
      WHERE id = ?
    `).run(
      status,
      JSON.stringify(upstream.data),
      extractVideoUrl(upstream.data) || task.video_url,
      collectErrorText(upstream.data) || task.error_message,
      nowIso(),
      ['succeeded', 'failed', 'cancelled', 'expired'].includes(status) ? nowIso() : null,
      taskId
    );
    const refreshed = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    await maybeSettleTask(refreshed, upstream.data);
  }
  return sendJson(res, 200, upstream.data);
}

async function handleCancelVideoTask(req, res, session, taskId) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (task) {
    const target = getAccountById(task.account_id);
    if (!target || !canSeeAccount(session.account, target)) return sendJson(res, 403, { error: '无权取消该任务' });
  }
  const upstream = await callManfei(`/v1/video/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' });
  if (task) {
    db.prepare('UPDATE tasks SET status = ?, response_json = ?, updated_at = ? WHERE id = ?')
      .run('cancel_requested', JSON.stringify(upstream.data), nowIso(), taskId);
  }
  return sendJson(res, upstream.status, upstream.data);
}

function collectErrorText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const candidates = [
    payload.error,
    payload.message,
    payload.reason,
    payload.detail,
    payload?.error?.message,
    payload?.data?.error,
    payload?.data?.message,
    payload?.ResponseMetadata?.Error?.Message,
    payload?.ResponseMetadata?.Error?.Code,
  ];
  return candidates.find(item => typeof item === 'string' && item.trim()) || '';
}

async function handleSessionApi(req, res, session) {
  const payload = {
    account: accountPublic(session.account),
    quota: quotaSummary(session.account.id),
    entries: visibleEntries(session.account),
  };
  if (['super_admin', 'admin'].includes(session.account.role)) {
    const balance = await fetchManfeiBalance();
    if (balance.ok) {
      payload.manfei_balance_rmb = balance.balance_rmb;
      payload.manfei = balance.data;
    } else {
      payload.manfei = { error: balance.error };
    }
  }
  return sendJson(res, 200, payload);
}

async function handleAccountsApi(req, res, session, url) {
  const actor = session.account;
  const targetId = url.pathname.match(/^\/api\/accounts\/([^/]+)$/)?.[1];
  if (req.method === 'GET' && !targetId) {
    const rows = actor.role === 'super_admin'
      ? db.prepare('SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY created_at DESC').all()
      : actor.role === 'admin'
        ? db.prepare('SELECT * FROM accounts WHERE deleted_at IS NULL AND (id = ? OR admin_id = ?) ORDER BY created_at DESC').all(actor.id, actor.id)
        : [actor];
    return sendJson(res, 200, { items: rows.map(row => ({ ...accountPublic(row), quota: quotaSummary(row.id) })) });
  }
  if (req.method === 'POST') {
    if (actor.role === 'user') return sendJson(res, 403, { error: '无权创建账号' });
    const data = await readJson(req);
    const role = actor.role === 'super_admin' ? (data.role || 'admin') : 'user';
    if (!['admin', 'user'].includes(role)) return sendJson(res, 400, { error: '只能创建管理员或普通账号' });
    if (role === 'admin') {
      const adminCount = db.prepare("SELECT COUNT(*) AS count FROM accounts WHERE role = 'admin' AND deleted_at IS NULL").get().count;
      if (adminCount >= MAX_ADMINS) return sendJson(res, 400, { error: `管理员账号最多 ${MAX_ADMINS} 个` });
    }
    const adminId = role === 'user'
      ? (actor.role === 'admin' ? actor.id : String(data.admin_id || DEFAULT_ADMIN_ID))
      : null;
    const createdAt = nowIso();
    const accountId = id('acct');
    const totalCents = normalizeCents(data.total_cents ?? centsFromYuan(data.total_rmb));
    const dailyLimitCents = normalizeCents(data.daily_limit_cents ?? centsFromYuan(data.daily_limit_rmb));
    try {
      await assertQuotaWithinApiBalance(totalCents);
      db.prepare(`
        INSERT INTO accounts (id, username, display_name, password_hash, role, admin_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `).run(accountId, String(data.username || '').trim(), String(data.display_name || data.username || '').trim(), hashPassword(data.password || '123456'), role, adminId, createdAt, createdAt);
      db.prepare('INSERT INTO quotas (account_id, total_cents, used_cents, frozen_cents, daily_limit_cents) VALUES (?, ?, 0, 0, ?)')
        .run(accountId, totalCents, dailyLimitCents);
      logOperation(actor.id, role === 'user' ? adminId : accountId, 'account_create', { accountId, username: data.username, role });
      return sendJson(res, 201, { account: accountPublic(getAccountById(accountId)), quota: quotaSummary(accountId) });
    } catch (error) {
      return sendJson(res, error.status || 400, { error: error.message.includes('UNIQUE') ? '账号名已存在' : error.message });
    }
  }
  if (!targetId) return sendJson(res, 404, { error: '接口不存在' });
  const target = getAccountById(targetId);
  if (!target || !canSeeAccount(actor, target)) return sendJson(res, 404, { error: '账号不存在' });
  if (req.method === 'PATCH') {
    if (actor.role === 'user') return sendJson(res, 403, { error: '无权修改账号' });
    if (target.role === 'super_admin' && actor.role !== 'super_admin') return sendJson(res, 403, { error: '无权修改超级管理员' });
    const data = await readJson(req);
    const displayName = data.display_name ?? target.display_name;
    const status = data.status ?? target.status;
    if (status !== target.status && status === 'disabled') {
      if (target.id === actor.id) return sendJson(res, 400, { error: '不能禁用当前正在登录的账号' });
      if (target.role === 'super_admin') return sendJson(res, 400, { error: '不能禁用超级管理员账号' });
    }
    const passwordHash = data.password ? hashPassword(data.password) : target.password_hash;
    db.prepare('UPDATE accounts SET display_name = ?, password_hash = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(displayName, passwordHash, status, nowIso(), target.id);
    if ('total_cents' in data || 'total_rmb' in data || 'daily_limit_cents' in data || 'daily_limit_rmb' in data) {
      const currentQuota = getQuota(target.id);
      const nextTotal = ('total_cents' in data || 'total_rmb' in data)
        ? normalizeCents(data.total_cents ?? centsFromYuan(data.total_rmb))
        : currentQuota.total_cents;
      const nextDailyLimit = ('daily_limit_cents' in data || 'daily_limit_rmb' in data)
        ? normalizeCents(data.daily_limit_cents ?? centsFromYuan(data.daily_limit_rmb))
        : currentQuota.daily_limit_cents;
      await assertQuotaWithinApiBalance(nextTotal);
      applyQuotaDelta(target.id, {
        total_cents: nextTotal,
        daily_limit_cents: nextDailyLimit,
      });
      addQuotaTransaction({ accountId: target.id, adminId: target.admin_id || target.id, type: 'adjust', amountCents: nextTotal, note: '额度调整', createdBy: actor.id });
    }
    logOperation(actor.id, target.admin_id || target.id, 'account_update', { targetId: target.id });
    return sendJson(res, 200, { account: accountPublic(getAccountById(target.id)), quota: quotaSummary(target.id) });
  }
  if (req.method === 'DELETE') {
    if (target.role === 'super_admin') return sendJson(res, 400, { error: '不能删除超级管理员' });
    db.prepare("UPDATE accounts SET status = 'disabled', deleted_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), target.id);
    logOperation(actor.id, target.admin_id || target.id, 'account_delete', { targetId: target.id });
    return sendJson(res, 200, { ok: true });
  }
  return sendJson(res, 405, { error: '方法不支持' });
}

async function handleProjectsApi(req, res, session, url) {
  const actor = session.account;
  const targetId = url.pathname.match(/^\/api\/projects\/([^/]+)$/)?.[1];
  if (req.method === 'GET' && !targetId) {
    const rows = actor.role === 'super_admin'
      ? db.prepare('SELECT projects.*, accounts.username AS admin_username FROM projects LEFT JOIN accounts ON accounts.id = projects.admin_id WHERE projects.deleted_at IS NULL ORDER BY projects.created_at DESC').all()
      : actor.role === 'admin'
        ? db.prepare('SELECT * FROM projects WHERE deleted_at IS NULL AND admin_id = ? ORDER BY created_at DESC').all(actor.id)
        : db.prepare("SELECT * FROM projects WHERE deleted_at IS NULL AND status = 'active' AND admin_id = ? ORDER BY created_at DESC").all(actor.admin_id);
    return sendJson(res, 200, { items: rows.map(projectReportRow) });
  }
  if (req.method === 'POST') {
    if (actor.role === 'user') return sendJson(res, 403, { error: '无权创建项目' });
    const data = await readJson(req);
    const adminId = actor.role === 'super_admin' ? (data.admin_id || DEFAULT_ADMIN_ID) : actor.id;
    const projectId = id('proj');
    const createdAt = nowIso();
    db.prepare(`
      INSERT INTO projects (id, admin_id, name, status, budget_cents, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(projectId, adminId, String(data.name || '新项目').trim(), data.status || 'active', normalizeCents(data.budget_cents ?? centsFromYuan(data.budget_rmb)), data.notes || '', createdAt, createdAt);
    logOperation(actor.id, adminId, 'project_create', { projectId });
    return sendJson(res, 201, { project: projectReportRow(db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId)) });
  }
  if (!targetId) return sendJson(res, 404, { error: '接口不存在' });
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL').get(targetId);
  if (!project || !canSeeProject(actor, project)) return sendJson(res, 404, { error: '项目不存在' });
  if (req.method === 'PATCH') {
    if (actor.role === 'user') return sendJson(res, 403, { error: '无权修改项目' });
    const data = await readJson(req);
    const nextBudget = ('budget_cents' in data || 'budget_rmb' in data)
      ? normalizeCents(data.budget_cents ?? centsFromYuan(data.budget_rmb))
      : project.budget_cents;
    db.prepare('UPDATE projects SET name = ?, status = ?, budget_cents = ?, notes = ?, updated_at = ? WHERE id = ?')
      .run(data.name ?? project.name, data.status ?? project.status, nextBudget, data.notes ?? project.notes, nowIso(), project.id);
    logOperation(actor.id, project.admin_id, 'project_update', { projectId: project.id });
    return sendJson(res, 200, { project: projectReportRow(db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id)) });
  }
  if (req.method === 'DELETE') {
    if (actor.role === 'user') return sendJson(res, 403, { error: '无权删除项目' });
    db.prepare('UPDATE projects SET deleted_at = ?, status = ?, updated_at = ? WHERE id = ?').run(nowIso(), 'deleted', nowIso(), project.id);
    logOperation(actor.id, project.admin_id, 'project_delete', { projectId: project.id });
    return sendJson(res, 200, { ok: true });
  }
  return sendJson(res, 405, { error: '方法不支持' });
}

function projectReportRow(project) {
  const usage = projectCommittedCents(project.id);
  const hasBudget = Number(project.budget_cents) > 0;
  const remaining = hasBudget ? Math.max(0, Number(project.budget_cents) - Number(usage)) : null;
  return {
    ...project,
    budget_rmb: yuanFromCents(project.budget_cents),
    used_cents: usage,
    used_rmb: yuanFromCents(usage),
    remaining_budget_cents: remaining,
    remaining_budget_rmb: remaining === null ? null : yuanFromCents(remaining),
    budget_exceeded: hasBudget && remaining <= 0,
  };
}

async function handlePricingApi(req, res, session) {
  if (session.account.role !== 'super_admin') return sendJson(res, 403, { error: '只有超级管理员可以管理价格表' });
  if (req.method === 'GET') {
    const rows = db.prepare('SELECT * FROM pricing_rules ORDER BY model, resolution, duration').all();
    const grouped = new Map();
    for (const row of rows) {
      const key = `${row.model}\u0000${row.resolution}`;
      const perSecondCents = Math.max(0, Math.ceil(Number(row.amount_cents || 0) / Math.max(1, Number(row.duration || 1))));
      const existing = grouped.get(key);
      if (!existing || Number(row.duration) === 1 || perSecondCents > existing.per_second_cents) {
        grouped.set(key, {
          id: key,
          model: row.model,
          resolution: row.resolution,
          duration: 1,
          per_second_cents: perSecondCents,
          per_second_rmb: yuanFromCents(perSecondCents),
          amount_cents: perSecondCents,
          amount_rmb: yuanFromCents(perSecondCents),
        });
      }
    }
    return sendJson(res, 200, { unit: 'per_second', items: Array.from(grouped.values()).sort((a, b) => `${a.model}-${a.resolution}`.localeCompare(`${b.model}-${b.resolution}`)) });
  }
  if (req.method === 'PUT') {
    const data = await readJson(req);
    const items = Array.isArray(data.items) ? data.items : [];
    db.exec('DELETE FROM pricing_rules');
    const insert = db.prepare('INSERT INTO pricing_rules (id, model, resolution, duration, amount_cents) VALUES (?, ?, ?, ?, ?)');
    for (const item of items) {
      if (!item.model || !item.resolution) continue;
      const perSecondCents = normalizeCents(item.per_second_cents ?? item.amount_cents ?? centsFromYuan(item.per_second_rmb ?? item.amount_rmb));
      insert.run(id('price'), item.model, item.resolution, 1, perSecondCents);
    }
    logOperation(session.account.id, null, 'pricing_update', { count: items.length });
    return sendJson(res, 200, { ok: true });
  }
  return sendJson(res, 405, { error: '方法不支持' });
}

async function handlePricingSyncApi(req, res, session) {
  if (session.account.role !== 'super_admin') return sendJson(res, 403, { error: '只有超级管理员可以同步价格表' });
  if (req.method !== 'POST') return sendJson(res, 405, { error: '方法不支持' });

  const data = await readJson(req);
  const limit = Math.min(200, Math.max(1, Number(data.limit || 200)));
  const pages = Math.min(10, Math.max(1, Number(data.pages || 5)));
  const rawItems = await fetchManfeiUsagePages({ limit, offset: 0, pages });
  const decorated = rawItems.map(decorateBillingItem);
  const matchedItems = decorated.filter(item => (
    item.matched_local_task &&
    item.model &&
    item.project_id &&
    item.amount_cents > 0
  ));
  const groups = new Map();
  for (const item of matchedItems) {
    const task = db.prepare('SELECT model, resolution, duration FROM tasks WHERE id = ?').get(item.task_id);
    if (!task?.model || !task?.resolution || !task?.duration) continue;
    const seconds = Math.max(1, Number(task.duration));
    const perSecondCents = Math.max(0, Math.ceil(item.amount_cents / seconds));
    const key = `${task.model}\u0000${task.resolution}`;
    if (!groups.has(key)) {
      groups.set(key, {
        model: task.model,
        resolution: task.resolution,
        count: 0,
        total_cents: 0,
        total_per_second_cents: 0,
        max_cents: 0,
        max_per_second_cents: 0,
      });
    }
    const group = groups.get(key);
    group.count += 1;
    group.total_cents += item.amount_cents;
    group.total_per_second_cents += perSecondCents;
    group.max_cents = Math.max(group.max_cents, item.amount_cents);
    group.max_per_second_cents = Math.max(group.max_per_second_cents, perSecondCents);
  }

  const updated = [];
  const upsert = db.prepare(`
    INSERT INTO pricing_rules (id, model, resolution, duration, amount_cents)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(model, resolution, duration)
    DO UPDATE SET amount_cents = excluded.amount_cents
  `);
  db.exec('BEGIN');
  try {
    for (const group of groups.values()) {
      upsert.run(id('price'), group.model, group.resolution, 1, group.max_per_second_cents);
      updated.push({
        model: group.model,
        resolution: group.resolution,
        duration: 1,
        sample_count: group.count,
        per_second_rmb: yuanFromCents(group.max_per_second_cents),
        average_per_second_rmb: yuanFromCents(Math.round(group.total_per_second_cents / group.count)),
      });
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  logOperation(session.account.id, null, 'pricing_sync_actual_usage', {
    updated: updated.length,
    matched_records: matchedItems.length,
    unmatched_records: decorated.length - matchedItems.length,
  });
  return sendJson(res, 200, {
    ok: true,
    source: '/v1/usage',
    strategy: '按模型、分辨率分组，使用已匹配真实扣款折算出的最高每秒金额作为预估单价',
    updated: updated.length,
    matched_records: matchedItems.length,
    unmatched_records: decorated.length - matchedItems.length,
    items: updated,
  });
}

async function handleQuotasApi(req, res, session) {
  const actor = session.account;
  if (req.method === 'GET') {
    const accounts = actor.role === 'super_admin'
      ? db.prepare('SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY role, username').all()
      : actor.role === 'admin'
        ? db.prepare('SELECT * FROM accounts WHERE deleted_at IS NULL AND (id = ? OR admin_id = ?) ORDER BY role, username').all(actor.id, actor.id)
        : [actor];
    return sendJson(res, 200, {
      items: accounts.map(account => ({
        account: accountPublic(account),
        quota: quotaSummary(account.id),
      })),
    });
  }
  return sendJson(res, 405, { error: '方法不支持' });
}

async function handleQuotaAdjustApi(req, res, session) {
  const actor = session.account;
  if (req.method !== 'POST') return sendJson(res, 405, { error: '方法不支持' });
  if (actor.role === 'user') return sendJson(res, 403, { error: '无权调整额度' });
  const data = await readJson(req);
  const target = getAccountById(String(data.account_id || ''));
  if (!target || !canSeeAccount(actor, target) || target.deleted_at) return sendJson(res, 404, { error: '账号不存在' });
  if (target.role === 'super_admin' && actor.role !== 'super_admin') return sendJson(res, 403, { error: '无权调整超级管理员额度' });
  const totalCents = normalizeCents(data.total_cents ?? centsFromYuan(data.total_rmb));
  const dailyLimitCents = ('daily_limit_cents' in data || 'daily_limit_rmb' in data)
    ? normalizeCents(data.daily_limit_cents ?? centsFromYuan(data.daily_limit_rmb))
    : getQuota(target.id).daily_limit_cents;
  await assertQuotaWithinApiBalance(totalCents);
  applyQuotaDelta(target.id, {
    total_cents: totalCents,
    daily_limit_cents: dailyLimitCents,
  });
  addQuotaTransaction({
    accountId: target.id,
    adminId: target.admin_id || target.id,
    type: 'adjust',
    amountCents: totalCents,
    note: data.note || '额度调整',
    createdBy: actor.id,
  });
  logOperation(actor.id, target.admin_id || target.id, 'quota_adjust', { targetId: target.id, totalCents });
  return sendJson(res, 200, { account: accountPublic(getAccountById(target.id)), quota: quotaSummary(target.id) });
}

function scopedTaskWhere(actor, params = []) {
  if (actor.role === 'super_admin') return { where: '1 = 1', params };
  if (actor.role === 'admin') return { where: 'tasks.admin_id = ?', params: [actor.id, ...params] };
  return { where: 'tasks.account_id = ?', params: [actor.id, ...params] };
}

function usageRows(actor, url) {
  const clauses = [];
  const params = [];
  if (actor.role === 'admin') {
    clauses.push('tasks.admin_id = ?');
    params.push(actor.id);
  } else if (actor.role === 'user') {
    clauses.push('tasks.account_id = ?');
    params.push(actor.id);
  }
  const projectId = url.searchParams.get('project_id');
  if (projectId) {
    clauses.push('tasks.project_id = ?');
    params.push(projectId);
  }
  const accountId = url.searchParams.get('account_id');
  if (accountId) {
    clauses.push('tasks.account_id = ?');
    params.push(accountId);
  }
  const dateFrom = url.searchParams.get('date_from');
  if (dateFrom) {
    clauses.push('tasks.created_at >= ?');
    params.push(`${dateFrom}T00:00:00.000Z`);
  }
  const dateTo = url.searchParams.get('date_to');
  if (dateTo) {
    clauses.push('tasks.created_at <= ?');
    params.push(`${dateTo}T23:59:59.999Z`);
  }
  const where = clauses.length ? clauses.join(' AND ') : '1 = 1';
  return db.prepare(`
    SELECT tasks.*, COALESCE(usage_totals.amount_cents, tasks.actual_cents) AS report_actual_cents,
      accounts.username, accounts.display_name, admins.username AS admin_username,
      admins.display_name AS admin_display_name, projects.name AS project_name
    FROM tasks
    LEFT JOIN (
      SELECT task_id, SUM(amount_cents) AS amount_cents
      FROM usage_records
      GROUP BY task_id
    ) usage_totals ON usage_totals.task_id = tasks.id
    LEFT JOIN accounts ON accounts.id = tasks.account_id
    LEFT JOIN accounts admins ON admins.id = tasks.admin_id
    LEFT JOIN projects ON projects.id = tasks.project_id
    WHERE ${where}
    ORDER BY tasks.created_at DESC
    LIMIT 1000
  `).all(...params);
}

async function handleUsageReport(req, res, session, url) {
  if (url.searchParams.get('sync_billing') === 'true') {
    const candidates = usageRows(session.account, url)
      .filter(row => ['succeeded', 'failed', 'cancelled', 'expired'].includes(String(row.status).toLowerCase()))
      .slice(0, 25);
    for (const row of candidates) {
      await maybeSettleTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(row.id), row);
    }
  }
  const rows = usageRows(session.account, url).map(row => ({
    ...row,
    estimate_rmb: yuanFromCents(row.estimate_cents),
    frozen_rmb: yuanFromCents(row.frozen_cents),
    actual_cents: row.report_actual_cents,
    actual_rmb: yuanFromCents(row.report_actual_cents),
  }));
  const totalCents = rows.reduce((sum, row) => sum + (Number(row.report_actual_cents ?? row.actual_cents) || 0), 0);
  return sendJson(res, 200, { items: rows, total_cents: totalCents, total_rmb: yuanFromCents(totalCents) });
}

async function fetchManfeiUsagePages({ limit = 200, offset = 0, pages = 1 } = {}) {
  const items = [];
  for (let page = 0; page < pages; page += 1) {
    const currentOffset = offset + page * limit;
    const upstream = await callManfei(`/v1/usage?charged_only=true&limit=${limit}&offset=${currentOffset}`);
    if (!upstream.ok) {
      const error = new Error(upstream.data?.error || upstream.data?.detail?.message || '读取 Manfei 扣款记录失败');
      error.status = upstream.status;
      error.data = upstream.data;
      throw error;
    }
    const pageItems = Array.isArray(upstream.data?.items) ? upstream.data.items : [];
    items.push(...pageItems);
    if (pageItems.length < limit) break;
  }
  return items;
}

function decorateBillingItem(item) {
  const taskId = String(item.task_id || item.taskId || item.task?.id || '');
  const task = taskId ? db.prepare(`
    SELECT tasks.id, tasks.account_id, tasks.admin_id, tasks.project_id, tasks.model, tasks.status,
      accounts.username, accounts.display_name, admins.username AS admin_username, projects.name AS project_name
    FROM tasks
    LEFT JOIN accounts ON accounts.id = tasks.account_id
    LEFT JOIN accounts admins ON admins.id = tasks.admin_id
    LEFT JOIN projects ON projects.id = tasks.project_id
    WHERE tasks.id = ?
  `).get(taskId) : null;
  const amount = Number(item.amount_rmb ?? item.amount ?? item.cost_rmb ?? 0) || 0;
  return {
    id: item.id,
    endpoint: item.endpoint || '',
    task_id: taskId,
    request_id: item.request_id || item.requestId || '',
    amount_rmb: Number(amount.toFixed(4)),
    amount_cents: centsFromYuan(amount),
    tokens_charged: item.tokens_charged ?? item.tokens ?? null,
    rmb_per_million_tokens: item.rmb_per_million_tokens ?? null,
    balance_before: item.balance_before ?? null,
    balance_after: item.balance_after ?? null,
    status: item.status || '',
    has_video_input: Boolean(item.has_video_input),
    created_at: item.created_at || '',
    account_id: task?.account_id || null,
    account_username: task?.username || '',
    account_display_name: task?.display_name || '',
    admin_id: task?.admin_id || null,
    admin_username: task?.admin_username || '',
    admin_display_name: task?.admin_display_name || '',
    project_id: task?.project_id || null,
    project_name: task?.project_name || '',
    model: task?.model || '',
    task_status: task?.status || '',
    matched_local_task: Boolean(task),
    raw: item,
  };
}

function canSeeBillingRecord(actor, item) {
  if (actor.role === 'super_admin') return true;
  if (!item.matched_local_task) return false;
  if (actor.role === 'admin') return item.admin_id === actor.id;
  return item.account_id === actor.id;
}

async function handleBillingRecords(req, res, session, url) {
  try {
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100)));
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
    const pages = Math.min(5, Math.max(1, Number(url.searchParams.get('pages') || 2)));
    const rawItems = await fetchManfeiUsagePages({ limit, offset, pages });
    let items = rawItems.map(decorateBillingItem).filter(item => canSeeBillingRecord(session.account, item));

    const accountId = url.searchParams.get('account_id');
    if (accountId) items = items.filter(item => item.account_id === accountId);
    const projectId = url.searchParams.get('project_id');
    if (projectId) items = items.filter(item => item.project_id === projectId);
    const endpoint = url.searchParams.get('endpoint');
    if (endpoint) items = items.filter(item => item.endpoint === endpoint);
    const dateFrom = url.searchParams.get('date_from');
    if (dateFrom) items = items.filter(item => String(item.created_at) >= `${dateFrom}T00:00:00`);
    const dateTo = url.searchParams.get('date_to');
    if (dateTo) items = items.filter(item => String(item.created_at) <= `${dateTo}T23:59:59`);

    const totalCents = items.reduce((sum, item) => sum + item.amount_cents, 0);
    const byEndpoint = Object.values(items.reduce((acc, item) => {
      const key = item.endpoint || 'unknown';
      acc[key] ||= { endpoint: key, count: 0, amount_cents: 0, amount_rmb: 0 };
      acc[key].count += 1;
      acc[key].amount_cents += item.amount_cents;
      acc[key].amount_rmb = yuanFromCents(acc[key].amount_cents);
      return acc;
    }, {}));
    const byProject = Object.values(items.reduce((acc, item) => {
      const key = item.project_id || 'unmatched';
      acc[key] ||= { project_id: item.project_id, project_name: item.project_name || '未匹配本地项目', count: 0, amount_cents: 0, amount_rmb: 0 };
      acc[key].count += 1;
      acc[key].amount_cents += item.amount_cents;
      acc[key].amount_rmb = yuanFromCents(acc[key].amount_cents);
      return acc;
    }, {}));
    return sendJson(res, 200, {
      realtime: true,
      source: '/v1/usage',
      items,
      summary: {
        count: items.length,
        total_cents: totalCents,
        total_rmb: yuanFromCents(totalCents),
        by_endpoint: byEndpoint,
        by_project: byProject,
      },
    });
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error.message, raw: error.data });
  }
}

async function handleExport(req, res, session, url) {
  if (url.searchParams.get('sync_billing') === 'true') {
    const candidates = usageRows(session.account, url)
      .filter(row => ['succeeded', 'failed', 'cancelled', 'expired'].includes(String(row.status).toLowerCase()))
      .slice(0, 25);
    for (const row of candidates) {
      await maybeSettleTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(row.id), row);
    }
  }
  const rows = usageRows(session.account, url).map(row => ({
    日期: row.created_at,
    账号: row.username,
    管理员: row.admin_username,
    项目: row.project_name,
    任务ID: row.id,
    模型: row.model,
    分辨率: row.resolution,
    时长: row.duration,
    比例: row.ratio,
    状态: row.status,
    预估金额: yuanFromCents(row.estimate_cents),
    冻结金额: yuanFromCents(row.frozen_cents),
    实际金额: yuanFromCents(row.report_actual_cents),
    结算状态: row.billing_status,
    错误信息: row.error_message || '',
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), '用量报表');
  try {
    const billingItems = (await fetchManfeiUsagePages({ limit: 200, offset: 0, pages: 5 }))
      .map(decorateBillingItem)
      .filter(item => canSeeBillingRecord(session.account, item))
      .map(item => ({
        时间: item.created_at,
        扣款类型: item.endpoint,
        任务ID: item.task_id,
        账号: item.account_display_name || item.account_username || '',
        管理员: item.admin_username || '',
        项目: item.project_name || '',
        模型: item.model || '',
        金额: item.amount_rmb,
        余额前: item.balance_before ?? '',
        余额后: item.balance_after ?? '',
        RequestID: item.request_id || '',
        是否匹配本地任务: item.matched_local_task ? '是' : '否',
      }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(billingItems), 'Manfei扣款明细');
  } catch {}
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.writeHead(200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="manfei-usage-${Date.now()}.xlsx"`,
  });
  res.end(buffer);
}

async function handleLocalUsage(req, res, session, url) {
  const rows = usageRows(session.account, url).slice(0, Number(url.searchParams.get('limit') || 20));
  return sendJson(res, 200, {
    items: rows.map(row => ({
      task_id: row.id,
      account: row.username,
      project: row.project_name,
      status: row.status,
      amount_rmb: yuanFromCents(row.report_actual_cents),
      billing_status: row.billing_status,
      created_at: row.created_at,
    })),
  });
}

async function handleMe(req, res, session) {
  const quota = quotaSummary(session.account.id);
  const result = {
    account: accountPublic(session.account),
    balance_rmb: quota.remaining_rmb,
    quota,
  };
  if (session.account.role === 'super_admin') {
    const upstream = await callManfei('/v1/me');
    result.manfei = upstream.ok ? upstream.data : { error: upstream.data?.error || '无法查询 Manfei 总余额' };
    if (upstream.ok && upstream.data?.balance_rmb !== undefined) {
      result.manfei_balance_rmb = upstream.data.balance_rmb;
      result.balance_rmb = upstream.data.balance_rmb;
    }
  }
  return sendJson(res, 200, result);
}

async function handleAppState(req, res, session) {
  const accountId = session.account.id;
  if (req.method === 'GET') {
    const row = db.prepare('SELECT * FROM app_state WHERE account_id = ?').get(accountId);
    return sendJson(res, 200, {
      version: 2,
      updatedAt: row?.updated_at || null,
      resources: row ? JSON.parse(row.resources_json || '[]') : [],
    });
  }
  if (req.method === 'PUT' || req.method === 'POST') {
    const payload = await readJson(req);
    const resources = Array.isArray(payload.resources) ? payload.resources : [];
    const updatedAt = nowIso();
    db.prepare('INSERT OR REPLACE INTO app_state (account_id, resources_json, updated_at) VALUES (?, ?, ?)')
      .run(accountId, JSON.stringify(resources), updatedAt);
    return sendJson(res, 200, { ok: true, version: 2, updatedAt, resources });
  }
  return sendJson(res, 405, { error: '方法不支持' });
}

async function uploadObject(req, res) {
  if (!TOS_CONFIG.accessKeyId || !TOS_CONFIG.accessKeySecret || !TOS_CONFIG.bucket) {
    return sendJson(res, 500, { error: '服务端未配置 TOS 对象存储' });
  }
  const body = await readJson(req);
  const filename = sanitizeFilename(body.filename || `upload-${Date.now()}`);
  const mimeType = body.mimeType || 'application/octet-stream';
  const dataUrl = String(body.dataBase64 || '');
  const [, base64 = dataUrl] = dataUrl.split(',');
  const buffer = Buffer.from(base64, 'base64');
  const date = new Date();
  const key = `manfei-assets/${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}/${Date.now()}-${crypto.randomBytes(5).toString('hex')}-${filename}`;
  const client = new TosClient({
    accessKeyId: TOS_CONFIG.accessKeyId,
    accessKeySecret: TOS_CONFIG.accessKeySecret,
    region: TOS_CONFIG.region,
    endpoint: TOS_CONFIG.endpoint || `tos-${TOS_CONFIG.region}.volces.com`,
  });
  await client.putObject({
    bucket: TOS_CONFIG.bucket,
    key,
    body: Readable.from(buffer),
    contentType: mimeType,
  });
  const url = getTosAssetDownloadUrl(client, key);
  return sendJson(res, 200, { key, url, size: buffer.length, mimeType });
}

function getTosAssetDownloadUrl(client, key) {
  if (TOS_CONFIG.publicBaseUrl) return `${TOS_CONFIG.publicBaseUrl}/${key}`;
  return client.getPreSignedUrl({
    bucket: TOS_CONFIG.bucket,
    key,
    method: 'GET',
    expires: TOS_CONFIG.signedUrlExpires,
  });
}

function sanitizeFilename(name) {
  return path.basename(String(name)).replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_').slice(0, 120) || `file-${Date.now()}`;
}

async function downloadVideo(req, res, url) {
  const videoUrl = url.searchParams.get('url');
  if (!videoUrl) return sendJson(res, 400, { error: '缺少 url' });
  let parsed;
  try {
    parsed = new URL(videoUrl);
  } catch {
    return sendJson(res, 400, { error: '视频 URL 不合法' });
  }
  if (parsed.protocol !== 'https:' || !/(volces|volcengine)\.com$/i.test(parsed.hostname)) {
    return sendJson(res, 400, { error: '仅支持下载火山引擎视频地址' });
  }
  const upstream = await fetch(parsed);
  if (!upstream.ok) return sendJson(res, upstream.status, { error: '视频下载失败' });
  const filename = sanitizeFilename(url.searchParams.get('filename') || path.basename(parsed.pathname) || `video-${Date.now()}.mp4`);
  res.writeHead(200, {
    'Content-Type': upstream.headers.get('content-type') || 'video/mp4',
    'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
  });
  if (upstream.body) {
    Readable.fromWeb(upstream.body).pipe(res);
  } else {
    res.end(Buffer.from(await upstream.arrayBuffer()));
  }
}

async function proxySimple(req, res, url) {
  const apiPath = mapApiUrl(url.pathname, url.search);
  if (!apiPath) return sendJson(res, 404, { error: '接口不存在' });
  const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJson(req) : null;
  const upstream = await callManfei(apiPath, { method: req.method, body });
  return sendJson(res, upstream.status, upstream.data);
}

async function serveStatic(req, res, pathname, session = null) {
  if (pathname === '/') return serveFile(res, path.join(__dirname, 'index.html'));
  if (['/admin', '/admin/users', '/admin/projects', '/admin/usage', '/admin/export'].includes(pathname)) {
    if (!session) return redirectToLogin(res);
    if (roleRank(session.account.role) < roleRank('admin')) return sendText(res, 403, '无权访问管理员后台');
    return serveFile(res, path.join(__dirname, 'admin.html'));
  }
  if (['/super-admin', '/super-admin/admins', '/super-admin/pricing'].includes(pathname)) {
    if (!session) return redirectToLogin(res);
    if (session.account.role !== 'super_admin') return sendText(res, 403, '无权访问超级管理员后台');
    return serveFile(res, path.join(__dirname, 'admin.html'));
  }
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(__dirname, safePath);
  if (!filePath.startsWith(__dirname)) return sendText(res, 403, 'Forbidden');
  return serveFile(res, filePath);
}

async function serveFile(res, filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) return serveFile(res, path.join(filePath, 'index.html'));
    const content = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  } catch {
    sendText(res, 404, 'Not found');
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/healthz') return sendJson(res, 200, { ok: true });
    if (pathname === '/login' || pathname === '/api/auth/login') return handleLogin(req, res);
    if (isPublicStaticPath(pathname)) return serveStatic(req, res, pathname);

    const session = requireSession(req, res);
    if (!session) return;

    if (pathname === '/logout' || pathname === '/api/auth/logout') return handleLogout(req, res, session);
    if (pathname === '/api/session') return handleSessionApi(req, res, session);
    if (pathname === '/api/accounts' || pathname.startsWith('/api/accounts/')) return handleAccountsApi(req, res, session, url);
    if (pathname === '/api/projects' || pathname.startsWith('/api/projects/')) return handleProjectsApi(req, res, session, url);
    if (pathname === '/api/quotas') return handleQuotasApi(req, res, session);
    if (pathname === '/api/quotas/adjust') return handleQuotaAdjustApi(req, res, session);
    if (pathname === '/api/pricing') return handlePricingApi(req, res, session);
    if (pathname === '/api/pricing/sync') return handlePricingSyncApi(req, res, session);
    if (pathname === '/api/usage-report') return handleUsageReport(req, res, session, url);
    if (pathname === '/api/billing-records') return handleBillingRecords(req, res, session, url);
    if (pathname === '/api/export.xlsx') return handleExport(req, res, session, url);
    if (pathname === '/api/me') return handleMe(req, res, session);
    if (pathname === '/api/usage') return handleLocalUsage(req, res, session, url);
    if (pathname === '/api/app-state') return handleAppState(req, res, session);
    if (pathname === '/api/upload-object' && req.method === 'POST') return uploadObject(req, res);
    if (pathname === '/api/download-video') return downloadVideo(req, res, url);
    if (pathname === '/api/media/subtitle-erase' && req.method === 'POST') return handleMediaTaskSubmit(req, res, 'subtitle_erase');
    if (pathname === '/api/media/enhance' && req.method === 'POST') return handleMediaTaskSubmit(req, res, 'video_enhance');
    const mediaTaskMatch = pathname.match(/^\/api\/media\/executions\/([^/]+)$/);
    if (mediaTaskMatch && req.method === 'GET') return handleMediaTaskQuery(req, res, mediaTaskMatch[1], url.searchParams.get('type') || '');
    if (pathname === '/api/video/tasks' && req.method === 'POST') return handleCreateVideoTask(req, res, session, false);
    if (pathname === '/api/video/tasks/generate' && req.method === 'POST') return handleCreateVideoTask(req, res, session, true);
    const taskMatch = pathname.match(/^\/api\/video\/tasks\/([^/]+)$/);
    if (taskMatch && req.method === 'GET') return handleQueryVideoTask(req, res, session, taskMatch[1]);
    const cancelMatch = pathname.match(/^\/api\/video\/tasks\/([^/]+)\/cancel$/);
    if (cancelMatch && req.method === 'POST') return handleCancelVideoTask(req, res, session, cancelMatch[1]);
    if (pathname.startsWith('/api/')) return proxySimple(req, res, url);

    return serveStatic(req, res, pathname, session);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: error.message || '服务器内部错误' });
  }
});

server.listen(PORT, () => {
  console.log(`Manfei Seedance app listening on http://localhost:${PORT}`);
});
