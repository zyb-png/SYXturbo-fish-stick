import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { TosClient } from '@volcengine/tos-sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = await loadEnv(path.join(__dirname, '.env'));
const PORT = Number(process.env.PORT || env.PORT || 4177);
const API_BASE = (process.env.MANFEI_API_BASE || env.MANFEI_API_BASE || 'http://115.191.42.226:8001').replace(/\/+$/, '');
const API_TOKEN = process.env.MANFEI_API_TOKEN || env.MANFEI_API_TOKEN || '';
const APP_USERNAME = process.env.APP_USERNAME || env.APP_USERNAME || '';
const APP_PASSWORD = process.env.APP_PASSWORD || env.APP_PASSWORD || '';
const APP_STATE_FILE = process.env.APP_STATE_FILE || env.APP_STATE_FILE || path.join(__dirname, '.data', 'app-state.json');
const ACCOUNTS_FILE = process.env.ACCOUNTS_FILE || env.ACCOUNTS_FILE || path.join(__dirname, '.data', 'accounts.json');
const PUBLIC_ACCESS = readBoolean(process.env.PUBLIC_ACCESS || env.PUBLIC_ACCESS, true);
const PUBLIC_ACCOUNT_USERNAME = validateStartupUsername(process.env.PUBLIC_ACCOUNT_USERNAME || env.PUBLIC_ACCOUNT_USERNAME || 'public');
const PUBLIC_ACCOUNT_QUOTA = validateStartupQuota(process.env.PUBLIC_ACCOUNT_QUOTA || env.PUBLIC_ACCOUNT_QUOTA || 1000000);
const API_COST_PER_SECOND = validateStartupMoney(process.env.API_COST_PER_SECOND || env.API_COST_PER_SECOND || 1);
const API_COST_CURRENCY = process.env.API_COST_CURRENCY || env.API_COST_CURRENCY || '¥';
const SESSION_MAX_AGE_SECONDS = 172800;
const sessions = new Map();
let accountsMutationQueue = Promise.resolve();
const TOS_CONFIG = {
  bucket: process.env.TOS_BUCKET || env.TOS_BUCKET || '',
  region: process.env.TOS_REGION || env.TOS_REGION || 'cn-beijing',
  endpoint: process.env.TOS_ENDPOINT || env.TOS_ENDPOINT || 'tos-cn-beijing.volces.com',
  accessKeyId: process.env.TOS_ACCESS_KEY_ID || env.TOS_ACCESS_KEY_ID || '',
  accessKeySecret: process.env.TOS_SECRET_ACCESS_KEY || env.TOS_SECRET_ACCESS_KEY || '',
  uploadPrefix: (process.env.TOS_UPLOAD_PREFIX || env.TOS_UPLOAD_PREFIX || 'manfei-assets').replace(/^\/+|\/+$/g, ''),
  signedUrlExpires: Number(process.env.TOS_SIGNED_URL_EXPIRES || env.TOS_SIGNED_URL_EXPIRES || 604800),
  alias: process.env.TOS_ALIAS || env.TOS_ALIAS || '',
  accessPointLabel: process.env.TOS_ACCESS_POINT_LABEL || env.TOS_ACCESS_POINT_LABEL || '',
};
const tosClient = isTosConfigured()
  ? new TosClient({
      accessKeyId: TOS_CONFIG.accessKeyId,
      accessKeySecret: TOS_CONFIG.accessKeySecret,
      region: TOS_CONFIG.region,
      endpoint: TOS_CONFIG.endpoint,
      bucket: TOS_CONFIG.bucket,
    })
  : null;
await ensureAccountsFile();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/healthz') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }
    const requestUrl = new URL(req.url || '/', `http://localhost:${PORT}`);
    if (requestUrl.pathname === '/login' && req.method === 'GET') {
      if (PUBLIC_ACCESS && !requestUrl.searchParams.has('manual')) {
        res.writeHead(303, { 'Location': '/', 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      serveLoginPage(res);
      return;
    }
    if (requestUrl.pathname === '/login' && req.method === 'POST') {
      await handleLogin(req, res);
      return;
    }
    if (requestUrl.pathname === '/logout') {
      const sessionToken = getSessionToken(req);
      if (sessionToken) sessions.delete(sessionToken);
      res.writeHead(303, {
        'Set-Cookie': 'manfei_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
        'Location': PUBLIC_ACCESS ? '/' : '/login',
      });
      res.end();
      return;
    }
    const sessionAuth = await getAuthenticatedUser(req);
    const auth = sessionAuth || (PUBLIC_ACCESS ? await getPublicAccessUser() : null);
    if (!auth) {
      if (req.url?.startsWith('/api/')) {
        sendJson(res, 401, { error: '请先登录' });
      } else {
        res.writeHead(303, { 'Location': '/login', 'Cache-Control': 'no-store' });
        res.end();
      }
      return;
    }
    req.auth = auth;
    if (req.url?.startsWith('/api/')) {
      if (req.url === '/api/session' && req.method === 'GET') {
        sendJson(res, 200, { ...publicUser(auth.user), publicAccess: Boolean(auth.publicAccess) });
        return;
      }
      if (req.url === '/api/me' && req.method === 'GET') {
        sendJson(res, 200, { ...publicUser(auth.user), publicAccess: Boolean(auth.publicAccess) });
        return;
      }
      if (req.url.startsWith('/api/usage') && req.method === 'GET') {
        sendJson(res, 200, {
          username: auth.user.username,
          quota: auth.user.quota,
          used: auth.user.used,
          remaining: getRemainingQuota(auth.user),
          currency: API_COST_CURRENCY,
          costPerSecond: API_COST_PER_SECOND,
          items: [...(auth.user.usage || [])].reverse().slice(0, 50),
        });
        return;
      }
      if (req.url.startsWith('/api/app-state')) {
        await handleAppState(req, res);
        return;
      }
      if (req.url.startsWith('/api/upload-object')) {
        await uploadObject(req, res);
        return;
      }
      if (req.url.startsWith('/api/download-video')) {
        await downloadVideo(req, res);
        return;
      }
      await proxyApi(req, res);
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    console.error('[server]', error);
    sendJson(res, error.status || 500, { error: error.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Manfei Seedance app: http://localhost:${PORT}`);
  console.log(`Proxy target: ${API_BASE}`);
  console.log(tosClient ? `TOS bucket: ${TOS_CONFIG.bucket}` : 'TOS upload: not configured');
  console.log(`Account system: enabled (${ACCOUNTS_FILE})`);
  console.log(PUBLIC_ACCESS ? `Public access: enabled (${PUBLIC_ACCOUNT_USERNAME})` : 'Public access: disabled');
});

function getSessionToken(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies.manfei_session || '';
}

async function getAuthenticatedUser(req) {
  const token = getSessionToken(req);
  const session = token ? sessions.get(token) : null;
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  const accounts = await readAccounts();
  const user = accounts.users.find(item => item.id === session.userId && item.enabled !== false);
  if (!user) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  return { token, session, user, accounts };
}

async function getPublicAccessUser() {
  let accounts = await readAccounts();
  let user = accounts.users.find(item => item.username.toLowerCase() === PUBLIC_ACCOUNT_USERNAME.toLowerCase());
  if (!user) {
    user = await mutateAccounts(value => {
      const publicUserAccount = {
        id: crypto.randomUUID(),
        username: PUBLIC_ACCOUNT_USERNAME,
        phone: '',
        password: hashPassword(crypto.randomBytes(24).toString('base64url')),
        role: 'user',
        quota: PUBLIC_ACCOUNT_QUOTA,
        used: 0,
        enabled: true,
        usage: [],
        createdAt: new Date().toISOString(),
        lastLoginAt: null,
      };
      value.users.push(publicUserAccount);
      return publicUserAccount;
    });
    accounts = await readAccounts();
  }

  if (user.enabled === false || user.role !== 'user' || Number(user.quota || 0) < PUBLIC_ACCOUNT_QUOTA) {
    user = await mutateAccounts(value => {
      const publicUserAccount = value.users.find(item => item.username.toLowerCase() === PUBLIC_ACCOUNT_USERNAME.toLowerCase());
      publicUserAccount.enabled = true;
      publicUserAccount.role = 'user';
      publicUserAccount.quota = Math.max(Number(publicUserAccount.quota || 0), PUBLIC_ACCOUNT_QUOTA);
      return publicUserAccount;
    });
    accounts = await readAccounts();
  }

  return {
    token: 'public-access',
    session: null,
    user,
    accounts,
    publicAccess: true,
  };
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(cookieHeader.split(';').map(part => {
    const separator = part.indexOf('=');
    if (separator < 0) return ['', ''];
    return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }).filter(([key]) => key));
}

async function handleLogin(req, res) {
  const body = (await readBody(req)).toString('utf8');
  const form = new URLSearchParams(body);
  const username = form.get('username') || '';
  const password = form.get('password') || '';
  const accounts = await readAccounts();
    const login = username.trim().toLowerCase();
    const user = accounts.users.find(item => (
      item.username.toLowerCase() === login
      || String(item.phone || '').toLowerCase() === login
    ));
  if (user && user.enabled !== false && verifyPassword(password, user.password)) {
    const sessionToken = crypto.randomBytes(32).toString('hex');
    sessions.set(sessionToken, {
      userId: user.id,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
    });
    user.lastLoginAt = new Date().toISOString();
    await writeAccounts(accounts);
    res.writeHead(303, {
      'Set-Cookie': `manfei_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`,
      'Location': '/?welcome=1',
      'Cache-Control': 'no-store',
    });
    res.end();
    return;
  }
  serveLoginPage(res, true);
}

function serveLoginPage(res, hasError = false) {
  const error = hasError
    ? '<p class="error">用户名或密码错误</p>'
    : '';
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>登录 · 宋钰汐视频生成</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#030504;color:#eee2c9;font-family:system-ui,-apple-system,sans-serif}
    main{width:min(360px,calc(100vw - 32px));border:1px solid rgba(212,164,77,.55);border-radius:8px;background:#090c0a;padding:28px;box-shadow:0 20px 60px #000}
    .mark{display:grid;place-items:center;width:48px;height:48px;margin-bottom:18px;color:#ffe09a;font-size:22px;font-weight:900}
    h1{margin:0 0 6px;color:#efd18d;font-size:22px}p{margin:0 0 20px;color:#918875;font-size:12px}
    label{display:grid;gap:7px;margin-top:14px;color:#a79b85;font-size:12px}
    input{width:100%;height:42px;border:1px solid rgba(212,164,77,.4);border-radius:6px;background:#050806;color:#eee2c9;padding:0 12px;outline:none}
    input:focus{border-color:#d4a44d;box-shadow:0 0 0 2px rgba(212,164,77,.12)}
    .password-wrap{position:relative}.password-wrap input{padding-right:46px}.password-toggle{position:absolute;right:8px;top:50%;width:30px;height:30px;margin:0;transform:translateY(-50%);border:0;background:transparent;color:#d8b76a;font-size:16px;line-height:1;display:grid;place-items:center}
    .password-toggle:hover{color:#ffe09a;background:rgba(212,164,77,.12)}
    button{width:100%;height:44px;margin-top:20px;border:1px solid #e2af50;border-radius:6px;background:linear-gradient(135deg,#a96e22,#d7a44b,#79501c);color:#fff0c5;font-weight:800;cursor:pointer}
    .error{margin:12px 0 0;color:#ef8c7b}
  </style>
</head>
<body>
  <main>
    <div class="mark">钰汐</div>
    <h1>宋钰汐视频生成</h1>
    <p>使用个人账号登录 Seedance 工作台</p>
    ${error}
    <form method="post" action="/login">
      <label>用户名 / 手机号<input name="username" autocomplete="username" autofocus required></label>
      <label>密码<span class="password-wrap"><input name="password" type="password" autocomplete="current-password" required><button class="password-toggle" type="button" aria-label="显示密码" title="显示密码">◉</button></span></label>
      <button type="submit">登录</button>
    </form>
  </main>
  <script>${passwordToggleScript()}</script>
</body>
</html>`;
  res.writeHead(hasError ? 401 : 200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

function passwordToggleScript() {
  return `
    document.querySelectorAll('.password-toggle').forEach(function(button) {
      button.addEventListener('click', function() {
        var input = button.parentElement.querySelector('input');
        var visible = input.type === 'text';
        input.type = visible ? 'password' : 'text';
        button.textContent = visible ? '◉' : '◌';
        button.setAttribute('aria-label', visible ? '显示密码' : '隐藏密码');
        button.title = visible ? '显示密码' : '隐藏密码';
      });
    });
  `;
}

function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, encoded) {
  const [scheme, salt, expected] = String(encoded || '').split(':');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return safeEqual(actual, expected);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    phone: user.phone || '',
    role: user.role,
    quota: user.quota,
    used: user.used,
    remaining: getRemainingQuota(user),
    currency: API_COST_CURRENCY,
    costPerSecond: API_COST_PER_SECOND,
    enabled: user.enabled !== false,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
  };
}

function getRemainingQuota(user) {
  return roundMoney(Math.max(0, Number(user.quota || 0) - Number(user.used || 0)));
}

async function ensureAccountsFile() {
  try {
    await fs.access(ACCOUNTS_FILE);
  } catch {
    const username = APP_USERNAME || 'user';
    const password = APP_PASSWORD || crypto.randomBytes(12).toString('base64url');
    const initial = {
      version: 1,
      updatedAt: new Date().toISOString(),
      users: [{
        id: crypto.randomUUID(),
        username,
        phone: '',
        password: hashPassword(password),
        role: 'user',
        quota: 1000,
        used: 0,
        enabled: true,
        usage: [],
        createdAt: new Date().toISOString(),
        lastLoginAt: null,
      }],
    };
    await writeAccounts(initial);
    if (!APP_PASSWORD) {
      console.warn(`[accounts] 已创建初始账号 ${username}，临时密码：${password}`);
    }
  }
}

async function readAccounts() {
  const value = JSON.parse(await fs.readFile(ACCOUNTS_FILE, 'utf8'));
  return {
    version: 1,
    updatedAt: value.updatedAt || null,
    users: Array.isArray(value.users) ? value.users.map(user => ({
      ...user,
      phone: String(user.phone || ''),
      quota: normalizeMoney(user.quota),
      used: normalizeMoney(user.used),
      usage: Array.isArray(user.usage) ? user.usage : [],
      enabled: user.enabled !== false,
    })) : [],
  };
}

async function writeAccounts(accounts) {
  const directory = path.dirname(ACCOUNTS_FILE);
  const temporaryFile = `${ACCOUNTS_FILE}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  accounts.updatedAt = new Date().toISOString();
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(temporaryFile, JSON.stringify(accounts, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporaryFile, ACCOUNTS_FILE);
}

function mutateAccounts(mutator) {
  const operation = accountsMutationQueue.then(async () => {
    const accounts = await readAccounts();
    const result = await mutator(accounts);
    await writeAccounts(accounts);
    return result;
  });
  accountsMutationQueue = operation.catch(() => {});
  return operation;
}

function validateUsername(value) {
  const username = String(value || '').trim();
  if (!/^[\w.-]{3,32}$/.test(username)) {
    throw httpError(400, '账号名需为 3-32 位字母、数字、下划线、点或短横线');
  }
  return username;
}

function validateStartupUsername(value) {
  try {
    return validateUsername(value);
  } catch {
    return 'public';
  }
}

function validateQuota(value) {
  const quota = Number(value);
  if (!Number.isFinite(quota) || quota < 0 || quota > 1000000) {
    throw httpError(400, '费用额度需为 0-1000000 的数字');
  }
  return roundMoney(quota);
}

function validateStartupQuota(value) {
  const quota = Number(value);
  return Number.isFinite(quota) && quota >= 0 ? roundMoney(quota) : 0;
}

function validateStartupMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? roundMoney(amount) : 1;
}

function normalizeMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? roundMoney(amount) : 0;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function formatMoney(value) {
  return `${API_COST_CURRENCY}${roundMoney(value).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;
}

function readBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function loadEnv(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return Object.fromEntries(
      text.split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && line.includes('='))
        .map(line => {
          const index = line.indexOf('=');
          return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
        })
    );
  } catch {
    return {};
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(__dirname, safePath === '/' ? 'index.html' : safePath);

  if (!filePath.startsWith(__dirname)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

async function serveFile(filePath, res) {
  const data = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': mimeTypes[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

async function proxyApi(req, res) {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const target = mapApiUrl(url);
  if (!target) {
    sendJson(res, 404, { error: 'Unknown API route' });
    return;
  }
  if (!API_TOKEN) {
    sendJson(res, 500, { error: 'Missing MANFEI_API_TOKEN in .env' });
    return;
  }

  const body = await readBody(req);
  const isGenerationRequest = req.method === 'POST'
    && (url.pathname === '/api/video/tasks' || url.pathname === '/api/video/tasks/generate');
  let reservation = null;
  if (isGenerationRequest) {
    const requestSummary = safeRequestSummary(body);
    const chargeAmount = estimateGenerationCost(requestSummary.duration);
    reservation = await reserveGenerationQuota(req.auth.user.id, {
      endpoint: url.pathname,
      request: requestSummary,
      amount: chargeAmount,
    });
    if (!reservation.allowed) {
      sendJson(res, 402, {
        error: `费用余额不足：本次预计需要 ${formatMoney(chargeAmount)}，当前剩余 ${formatMoney(reservation.user.remaining)}`,
        code: 'QUOTA_EXHAUSTED',
        required: chargeAmount,
        currency: API_COST_CURRENCY,
        quota: reservation.user.quota,
        used: reservation.user.used,
        remaining: reservation.user.remaining,
      });
      return;
    }
  }
  const headers = {
    'Authorization': `Bearer ${API_TOKEN}`,
    'Accept': 'application/json',
  };
  if (body.length > 0) headers['Content-Type'] = req.headers['content-type'] || 'application/json';

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: body.length > 0 ? body : undefined,
    });
    const text = await upstream.text();
    if (reservation && (!upstream.ok || isFailedTaskResponse(text))) {
      const reason = !upstream.ok ? `上游返回 HTTP ${upstream.status}` : '视频生成失败';
      await refundGenerationQuota(req.auth.user.id, reservation.usageId, reason);
    } else if (reservation) {
      await finalizeGenerationUsage(req.auth.user.id, reservation.usageId, text);
    } else if (req.method === 'GET' && url.pathname.startsWith('/api/video/tasks/')) {
      const taskId = readTaskId(text) || decodeURIComponent(url.pathname.slice('/api/video/tasks/'.length));
      if (isFailedTaskResponse(text)) {
        await refundFailedTaskQuota(req.auth.user.id, taskId);
      } else {
        await updateTaskUsageCost(req.auth.user.id, taskId, text);
      }
    }
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(text);
  } catch (error) {
    if (reservation) {
      await refundGenerationQuota(req.auth.user.id, reservation.usageId, '上游请求未完成');
    }
    throw error;
  }
}

async function reserveGenerationQuota(userId, context) {
  return mutateAccounts(accounts => {
    const user = accounts.users.find(item => item.id === userId && item.enabled !== false);
    if (!user) throw httpError(401, '账号已失效，请重新登录');
    const amount = normalizeMoney(context.amount);
    if (getRemainingQuota(user) < amount) {
      return { allowed: false, user: publicUser(user) };
    }
    const usageId = crypto.randomUUID();
    user.used = roundMoney(Number(user.used || 0) + amount);
    user.usage = Array.isArray(user.usage) ? user.usage : [];
    user.usage.push({
      id: usageId,
      type: 'video_generation',
      amount,
      currency: API_COST_CURRENCY,
      costPerSecond: API_COST_PER_SECOND,
      status: 'reserved',
      endpoint: context.endpoint,
      request: context.request,
      createdAt: new Date().toISOString(),
    });
    user.usage = user.usage.slice(-500);
    return { allowed: true, usageId, user: publicUser(user) };
  });
}

async function finalizeGenerationUsage(userId, usageId, responseText) {
  await mutateAccounts(accounts => {
    const user = accounts.users.find(item => item.id === userId);
    const usage = user?.usage?.find(item => item.id === usageId);
    if (!user || !usage) return;
    const apiCost = extractApiCost(responseText);
    if (apiCost !== null) {
      const estimatedAmount = normalizeMoney(usage.amount);
      const actualAmount = normalizeMoney(apiCost);
      user.used = roundMoney(Math.max(0, Number(user.used || 0) - estimatedAmount + actualAmount));
      usage.estimatedAmount = estimatedAmount;
      usage.amount = actualAmount;
      usage.apiCost = actualAmount;
    }
    usage.status = 'charged';
    usage.taskId = readTaskId(responseText);
    usage.completedAt = new Date().toISOString();
  });
}

async function refundGenerationQuota(userId, usageId, reason) {
  await mutateAccounts(accounts => {
    const user = accounts.users.find(item => item.id === userId);
    const usage = user?.usage?.find(item => item.id === usageId);
    if (!user || !usage || usage.status === 'refunded') return;
    user.used = roundMoney(Math.max(0, Number(user.used || 0) - Number(usage.amount || 0)));
    usage.status = 'refunded';
    usage.reason = reason;
    usage.completedAt = new Date().toISOString();
  });
}

function safeRequestSummary(body) {
  try {
    const payload = JSON.parse(body.toString('utf8') || '{}');
    return {
      model: payload.model || '',
      duration: payload.duration || null,
      resolution: payload.resolution || '',
      ratio: payload.ratio || '',
    };
  } catch {
    return {};
  }
}

function estimateGenerationCost(value) {
  const duration = Number(value);
  if (!Number.isInteger(duration) || duration < 1 || duration > 3600) {
    throw httpError(400, '视频时长无效，无法计算预估费用');
  }
  return roundMoney(duration * API_COST_PER_SECOND);
}

function readTaskId(text) {
  try {
    const payload = JSON.parse(text || '{}');
    return payload.id || payload.task_id || payload.detail?.task_id || null;
  } catch {
    return null;
  }
}

function isFailedTaskResponse(text) {
  try {
    const payload = JSON.parse(text || '{}');
    return ['failed', 'error', 'cancelled', 'canceled'].includes(String(payload.status || '').toLowerCase());
  } catch {
    return false;
  }
}

function extractApiCost(text) {
  try {
    const payload = JSON.parse(text || '{}');
    return findCostValue(payload);
  } catch {
    return null;
  }
}

function findCostValue(value, depth = 0, seen = new Set()) {
  if (!value || typeof value !== 'object' || depth > 6 || seen.has(value)) return null;
  seen.add(value);
  const costKeys = [
    'cost',
    'fee',
    'price',
    'amount',
    'total_cost',
    'totalCost',
    'total_fee',
    'totalFee',
    'api_cost',
    'apiCost',
    'billing_amount',
    'billingAmount',
  ];
  for (const key of costKeys) {
    const cost = parseCostNumber(value[key]);
    if (cost !== null) return cost;
  }
  for (const key of ['billing', 'usage', 'cost_detail', 'costDetail', 'data', 'result', 'detail']) {
    const nested = findCostValue(value[key], depth + 1, seen);
    if (nested !== null) return nested;
  }
  return null;
}

function parseCostNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return roundMoney(value);
  if (typeof value === 'string') {
    const normalized = value.replace(/[^\d.-]/g, '');
    if (!normalized) return null;
    const amount = Number(normalized);
    if (Number.isFinite(amount) && amount >= 0) return roundMoney(amount);
  }
  return null;
}

async function refundFailedTaskQuota(userId, taskId) {
  if (!taskId) return;
  await mutateAccounts(accounts => {
    const user = accounts.users.find(item => item.id === userId);
    const usage = user?.usage?.find(item => item.taskId === taskId && item.status === 'charged');
    if (!user || !usage) return;
    user.used = roundMoney(Math.max(0, Number(user.used || 0) - Number(usage.amount || 0)));
    usage.status = 'refunded';
    usage.reason = '视频任务失败';
    usage.completedAt = new Date().toISOString();
  });
}

async function updateTaskUsageCost(userId, taskId, responseText) {
  if (!taskId) return;
  const apiCost = extractApiCost(responseText);
  if (apiCost === null) return;
  await mutateAccounts(accounts => {
    const user = accounts.users.find(item => item.id === userId);
    const usage = user?.usage?.find(item => item.taskId === taskId && item.status === 'charged');
    if (!user || !usage) return;
    const currentAmount = normalizeMoney(usage.amount);
    const actualAmount = normalizeMoney(apiCost);
    if (currentAmount === actualAmount) return;
    user.used = roundMoney(Math.max(0, Number(user.used || 0) - currentAmount + actualAmount));
    usage.estimatedAmount = usage.estimatedAmount ?? currentAmount;
    usage.amount = actualAmount;
    usage.apiCost = actualAmount;
    usage.costUpdatedAt = new Date().toISOString();
  });
}

async function downloadVideo(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const requestUrl = new URL(req.url || '/', `http://localhost:${PORT}`);
  const source = requestUrl.searchParams.get('url') || '';
  const requestedName = requestUrl.searchParams.get('filename') || 'seedance-video.mp4';
  let sourceUrl;
  try {
    sourceUrl = new URL(source);
  } catch {
    sendJson(res, 400, { error: '无效的视频地址' });
    return;
  }

  if (sourceUrl.protocol !== 'https:' || !isAllowedVideoHost(sourceUrl.hostname)) {
    sendJson(res, 400, { error: '不允许下载该视频地址' });
    return;
  }

  const upstream = await fetch(sourceUrl, {
    headers: { 'Accept': 'video/*,application/octet-stream' },
  });
  if (!upstream.ok || !upstream.body) {
    sendJson(res, upstream.status || 502, { error: `视频下载失败：HTTP ${upstream.status}` });
    return;
  }

  const filename = sanitizeDownloadFilename(requestedName);
  const headers = {
    'Content-Type': upstream.headers.get('content-type') || 'video/mp4',
    'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'private, no-store',
  };
  const contentLength = upstream.headers.get('content-length');
  if (contentLength) headers['Content-Length'] = contentLength;
  res.writeHead(200, headers);
  Readable.fromWeb(upstream.body).pipe(res);
}

function isAllowedVideoHost(hostname) {
  return hostname === 'volces.com'
    || hostname.endsWith('.volces.com')
    || hostname === 'volcengine.com'
    || hostname.endsWith('.volcengine.com');
}

function sanitizeDownloadFilename(filename) {
  const safe = path.basename(filename)
    .replace(/[\u0000-\u001f\u007f"\\/:*?<>|]+/g, '-')
    .slice(0, 120) || 'seedance-video.mp4';
  return path.extname(safe).toLowerCase() === '.mp4' ? safe : `${safe}.mp4`;
}

async function handleAppState(req, res) {
  if (req.method === 'GET') {
    sendJson(res, 200, await readAppState());
    return;
  }
  if (req.method !== 'PUT') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
  if (!Array.isArray(payload.resources)) {
    sendJson(res, 400, { error: 'resources 必须是数组' });
    return;
  }

  const appState = {
    version: 1,
    updatedAt: new Date().toISOString(),
    resources: payload.resources,
  };
  await writeAppState(appState);
  sendJson(res, 200, {
    saved: true,
    updatedAt: appState.updatedAt,
    resourceGroups: appState.resources.length,
  });
}

async function readAppState() {
  try {
    const value = await readStateFile(APP_STATE_FILE);
    return {
      version: 1,
      updatedAt: value.updatedAt || null,
      resources: Array.isArray(value.resources) ? value.resources : [],
    };
  } catch (error) {
    try {
      const backup = await readStateFile(`${APP_STATE_FILE}.bak`);
      console.warn('[app-state] 主文件不可用，已从备份恢复');
      return {
        version: 1,
        updatedAt: backup.updatedAt || null,
        resources: Array.isArray(backup.resources) ? backup.resources : [],
      };
    } catch {
      if (error.code !== 'ENOENT') console.error('[app-state:read]', error);
      return { version: 1, updatedAt: null, resources: [] };
    }
  }
}

async function readStateFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeAppState(appState) {
  const directory = path.dirname(APP_STATE_FILE);
  const temporaryFile = `${APP_STATE_FILE}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(temporaryFile, JSON.stringify(appState, null, 2), 'utf8');
  try {
    await fs.copyFile(APP_STATE_FILE, `${APP_STATE_FILE}.bak`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fs.rename(temporaryFile, APP_STATE_FILE);
}

async function uploadObject(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (!tosClient) {
    sendJson(res, 500, {
      error: 'TOS 对象存储未配置。请检查 .env 中的 TOS_BUCKET、TOS_REGION、TOS_ACCESS_KEY_ID、TOS_SECRET_ACCESS_KEY。',
    });
    return;
  }

  const payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
  const { filename, mimeType, dataBase64 } = payload;
  if (!filename || !dataBase64) {
    sendJson(res, 400, { error: '缺少 filename 或 dataBase64' });
    return;
  }

  const buffer = Buffer.from(String(dataBase64).replace(/^data:[^,]+,/, ''), 'base64');
  if (buffer.length === 0) {
    sendJson(res, 400, { error: '文件内容为空' });
    return;
  }
  if (buffer.length > 64 * 1024 * 1024) {
    sendJson(res, 400, { error: '文件超过 64MB，请改用公网 URL 或更大的上传通道' });
    return;
  }

  const key = buildObjectKey(filename);
  const uploadResult = await tosClient.putObject({
    bucket: TOS_CONFIG.bucket,
    key,
    body: buffer,
    contentLength: buffer.length,
    contentType: mimeType || 'application/octet-stream',
  });
  const headResult = await tosClient.headObject({
    bucket: TOS_CONFIG.bucket,
    key,
  });
  const publicUrl = tosClient.getPreSignedUrl({
    bucket: TOS_CONFIG.bucket,
    key,
    method: 'GET',
    expires: TOS_CONFIG.signedUrlExpires,
  });
  sendJson(res, 200, {
    url: publicUrl,
    key,
    size: buffer.length,
    mimeType: mimeType || 'application/octet-stream',
    bucket: TOS_CONFIG.bucket,
    requestId: uploadResult.requestId,
    verifiedRequestId: headResult.requestId,
    expiresIn: TOS_CONFIG.signedUrlExpires,
  });
}

function mapApiUrl(url) {
  const pathname = url.pathname;
  const search = url.search || '';

  if (pathname === '/api/me') return `${API_BASE}/v1/me`;
  if (pathname === '/api/usage') return `${API_BASE}/v1/usage${search}`;
  if (pathname === '/api/assets') return `${API_BASE}/v1/assets`;
  if (pathname.startsWith('/api/assets/')) {
    const id = encodeURIComponent(pathname.slice('/api/assets/'.length));
    return `${API_BASE}/v1/assets/${id}`;
  }
  if (pathname === '/api/video/tasks') return `${API_BASE}/v1/video/tasks`;
  if (pathname === '/api/video/tasks/generate') return `${API_BASE}/v1/video/tasks:generate`;
  if (pathname.startsWith('/api/video/tasks/') && pathname.endsWith('/cancel')) {
    const id = encodeURIComponent(pathname.slice('/api/video/tasks/'.length, -'/cancel'.length));
    return `${API_BASE}/v1/video/tasks/${id}/cancel`;
  }
  if (pathname.startsWith('/api/video/tasks/')) {
    const id = encodeURIComponent(pathname.slice('/api/video/tasks/'.length));
    return `${API_BASE}/v1/video/tasks/${id}`;
  }
  return null;
}

function buildObjectKey(filename) {
  const ext = path.extname(filename).toLowerCase();
  const safeBase = path.basename(filename, ext)
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'file';
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const random = crypto.randomBytes(4).toString('hex');
  return `${TOS_CONFIG.uploadPrefix}/${stamp}_${random}_${safeBase}${ext}`;
}

function isTosConfigured() {
  return Boolean(
    TOS_CONFIG.bucket &&
    TOS_CONFIG.region &&
    TOS_CONFIG.endpoint &&
    TOS_CONFIG.accessKeyId &&
    TOS_CONFIG.accessKeySecret
  );
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}
