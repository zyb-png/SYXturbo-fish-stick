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
const REGISTRATION_ENABLED = readBoolean(process.env.REGISTRATION_ENABLED || env.REGISTRATION_ENABLED, true);
const REGISTER_INVITE_CODES = parseList(process.env.REGISTER_INVITE_CODES || env.REGISTER_INVITE_CODES || 'SYX2026');
const REGISTER_SMS_CODE = String(process.env.REGISTER_SMS_CODE || env.REGISTER_SMS_CODE || '123456').trim();
const REGISTER_DEFAULT_QUOTA = validateStartupQuota(process.env.REGISTER_DEFAULT_QUOTA || env.REGISTER_DEFAULT_QUOTA || 0);
const PUBLIC_ACCESS = readBoolean(process.env.PUBLIC_ACCESS || env.PUBLIC_ACCESS, true);
const PUBLIC_ACCOUNT_USERNAME = validateStartupUsername(process.env.PUBLIC_ACCOUNT_USERNAME || env.PUBLIC_ACCOUNT_USERNAME || 'public');
const PUBLIC_ACCOUNT_QUOTA = validateStartupQuota(process.env.PUBLIC_ACCOUNT_QUOTA || env.PUBLIC_ACCOUNT_QUOTA || 1000000);
const MAX_ADMIN_ACCOUNTS = 4;
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
      if (PUBLIC_ACCESS) {
        res.writeHead(303, { 'Location': '/', 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      serveLoginPage(res);
      return;
    }
    if (requestUrl.pathname === '/register' && req.method === 'GET') {
      serveRegisterPage(res);
      return;
    }
    if (requestUrl.pathname === '/admin/login' && req.method === 'GET') {
      serveLoginPage(res, false, true);
      return;
    }
    if (requestUrl.pathname === '/login' && req.method === 'POST') {
      await handleLogin(req, res);
      return;
    }
    if (requestUrl.pathname === '/register' && req.method === 'POST') {
      await handleRegister(req, res);
      return;
    }
    if (requestUrl.pathname === '/admin/login' && req.method === 'POST') {
      await handleLogin(req, res, true);
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
    const isAdminRequest = isAdminPath(requestUrl.pathname);
    const sessionAuth = await getAuthenticatedUser(req);
    if (!sessionAuth && isAdminRequest) {
      if (req.url?.startsWith('/api/')) {
        sendJson(res, 401, { error: '请先使用管理员账号登录' });
      } else {
        res.writeHead(303, { 'Location': '/admin/login', 'Cache-Control': 'no-store' });
        res.end();
      }
      return;
    }
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
    if (req.url === '/admin' || req.url === '/admin/' || req.url === '/admin.html') {
      if (auth.user.role !== 'admin') {
        sendJson(res, 403, { error: '仅管理员可以访问账号管理页面' });
        return;
      }
      await serveFile(path.join(__dirname, 'admin.html'), res);
      return;
    }
    if (req.url?.startsWith('/api/')) {
      if (req.url === '/api/session' && req.method === 'GET') {
        sendJson(res, 200, publicUser(auth.user));
        return;
      }
      if (req.url === '/api/me' && req.method === 'GET') {
        sendJson(res, 200, publicUser(auth.user));
        return;
      }
      if (req.url.startsWith('/api/usage') && req.method === 'GET') {
        sendJson(res, 200, {
          username: auth.user.username,
          quota: auth.user.quota,
          used: auth.user.used,
          remaining: getRemainingQuota(auth.user),
          items: [...(auth.user.usage || [])].reverse().slice(0, 50),
        });
        return;
      }
      if (req.url.startsWith('/api/admin/')) {
        await handleAdminApi(req, res, auth);
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

function isAdminPath(pathname) {
  return pathname === '/admin'
    || pathname === '/admin/'
    || pathname === '/admin.html'
    || pathname.startsWith('/api/admin/');
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(cookieHeader.split(';').map(part => {
    const separator = part.indexOf('=');
    if (separator < 0) return ['', ''];
    return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }).filter(([key]) => key));
}

async function handleLogin(req, res, adminLogin = false) {
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
  if (user && user.enabled !== false && verifyPassword(password, user.password) && (!adminLogin || user.role === 'admin')) {
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
      'Location': adminLogin ? '/admin' : '/?welcome=1',
      'Cache-Control': 'no-store',
    });
    res.end();
    return;
  }
  serveLoginPage(res, true, adminLogin);
}

async function handleRegister(req, res) {
  if (!REGISTRATION_ENABLED) {
    serveRegisterPage(res, '注册暂未开放');
    return;
  }
  const body = (await readBody(req)).toString('utf8');
  const form = new URLSearchParams(body);
  const phone = form.get('phone') || '';
  const username = form.get('username') || '';
  const password = form.get('password') || '';
  const confirmPassword = form.get('confirmPassword') || '';
  const smsCode = form.get('smsCode') || '';
  const inviteCode = form.get('inviteCode') || '';

  try {
    const created = await mutateAccounts(accounts => {
      const normalizedPhone = validatePhone(phone);
      const normalizedUsername = validateUsername(username);
      const normalizedPassword = validateNewPassword(password);
      if (normalizedPassword !== confirmPassword) throw httpError(400, '两次输入的密码不一致');
      validateRegisterSmsCode(smsCode);
      validateInviteCode(inviteCode);
      if (accounts.users.some(user => user.username.toLowerCase() === normalizedUsername.toLowerCase())) {
        throw httpError(409, '用户名已存在');
      }
      if (accounts.users.some(user => String(user.phone || '') === normalizedPhone)) {
        throw httpError(409, '手机号已注册');
      }
      const user = {
        id: crypto.randomUUID(),
        username: normalizedUsername,
        phone: normalizedPhone,
        password: hashPassword(normalizedPassword),
        role: 'user',
        quota: REGISTER_DEFAULT_QUOTA,
        used: 0,
        enabled: true,
        usage: [],
        createdAt: new Date().toISOString(),
        lastLoginAt: null,
      };
      accounts.users.push(user);
      return publicUser(user);
    });
    serveRegisterPage(res, '', `注册成功：${created.username}。请返回登录，管理员分配额度后即可生成视频。`);
  } catch (error) {
    serveRegisterPage(res, error.message || '注册失败');
  }
}

function serveLoginPage(res, hasError = false, adminLogin = false) {
  const error = hasError
    ? `<p class="error">${adminLogin ? '管理员账号或密码错误' : '用户名或密码错误'}</p>`
    : '';
  const registerLink = !adminLogin && REGISTRATION_ENABLED
    ? '<p class="login-extra">还没有账号？<a href="/register">立即注册</a></p>'
    : '';
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${adminLogin ? '管理员登录' : '登录'} · 宋钰汐视频生成</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#030504;color:#eee2c9;font-family:system-ui,-apple-system,sans-serif}
    main{width:min(360px,calc(100vw - 32px));border:1px solid rgba(212,164,77,.55);border-radius:8px;background:#090c0a;padding:28px;box-shadow:0 20px 60px #000}
    .mark{display:grid;place-items:center;width:48px;height:48px;margin-bottom:18px;color:#ffe09a;font-size:22px;font-weight:900}
    h1{margin:0 0 6px;color:#efd18d;font-size:22px}p{margin:0 0 20px;color:#918875;font-size:12px}
    label{display:grid;gap:7px;margin-top:14px;color:#a79b85;font-size:12px}
    input{width:100%;height:42px;border:1px solid rgba(212,164,77,.4);border-radius:6px;background:#050806;color:#eee2c9;padding:0 12px;outline:none}
    input:focus{border-color:#d4a44d;box-shadow:0 0 0 2px rgba(212,164,77,.12)}
    button{width:100%;height:44px;margin-top:20px;border:1px solid #e2af50;border-radius:6px;background:linear-gradient(135deg,#a96e22,#d7a44b,#79501c);color:#fff0c5;font-weight:800;cursor:pointer}
    .error{margin:12px 0 0;color:#ef8c7b}.login-extra{margin:14px 0 0}.login-extra a{color:#ffe09a;text-decoration:none}
  </style>
</head>
<body>
  <main>
    <div class="mark">钰汐</div>
    <h1>${adminLogin ? '额度管理后台' : '宋钰汐视频生成'}</h1>
    <p>${adminLogin ? '仅管理员账号可以进入' : '使用个人账号登录 Seedance 工作台'}</p>
    ${error}
    <form method="post" action="${adminLogin ? '/admin/login' : '/login'}">
      <label>用户名 / 手机号<input name="username" autocomplete="username" autofocus required></label>
      <label>密码<input name="password" type="password" autocomplete="current-password" required></label>
      <button type="submit">登录</button>
    </form>
    ${registerLink}
  </main>
</body>
</html>`;
  res.writeHead(hasError ? 401 : 200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

function serveRegisterPage(res, errorMessage = '', successMessage = '') {
  const status = successMessage
    ? `<p class="success">${escapeHtml(successMessage)}</p>`
    : errorMessage
      ? `<p class="error">${escapeHtml(errorMessage)}</p>`
      : '';
  const disabled = REGISTRATION_ENABLED ? '' : 'disabled';
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>注册 · 宋钰汐视频生成</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#030504;color:#eee2c9;font-family:system-ui,-apple-system,sans-serif}
    main{width:min(420px,calc(100vw - 32px));border:1px solid rgba(212,164,77,.55);border-radius:8px;background:#090c0a;padding:28px;box-shadow:0 20px 60px #000}
    .mark{display:grid;place-items:center;width:48px;height:48px;margin-bottom:18px;color:#ffe09a;font-size:22px;font-weight:900}
    h1{margin:0 0 6px;color:#efd18d;font-size:22px}p{margin:0 0 18px;color:#918875;font-size:12px}
    label{display:grid;gap:7px;margin-top:13px;color:#a79b85;font-size:12px}
    input{width:100%;height:42px;border:1px solid rgba(212,164,77,.4);border-radius:6px;background:#050806;color:#eee2c9;padding:0 12px;outline:none}
    input:focus{border-color:#d4a44d;box-shadow:0 0 0 2px rgba(212,164,77,.12)}
    button{width:100%;height:44px;margin-top:20px;border:1px solid #e2af50;border-radius:6px;background:linear-gradient(135deg,#a96e22,#d7a44b,#79501c);color:#fff0c5;font-weight:800;cursor:pointer}
    button:disabled{opacity:.5;cursor:not-allowed}.error{margin:12px 0 0;color:#ef8c7b}.success{margin:12px 0 0;color:#88d89f}
    .extra{margin-top:14px}.extra a{color:#ffe09a;text-decoration:none}.hint{margin-top:8px;color:#756d5d}
  </style>
</head>
<body>
  <main>
    <div class="mark">钰汐</div>
    <h1>注册账号</h1>
    <p>注册后默认 0 秒额度，管理员审核并分配额度后即可生成视频。</p>
    ${status}
    <form method="post" action="/register">
      <label>手机号<input name="phone" inputmode="tel" autocomplete="tel" pattern="1[3-9][0-9]{9}" required ${disabled}></label>
      <label>用户名<input name="username" autocomplete="username" minlength="3" maxlength="32" required ${disabled}></label>
      <label>密码<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required ${disabled}></label>
      <label>确认密码<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required ${disabled}></label>
      <label>短信验证码<input name="smsCode" inputmode="numeric" autocomplete="one-time-code" required ${disabled}></label>
      <label>邀请码<input name="inviteCode" autocomplete="off" required ${disabled}></label>
      <p class="hint">当前短信验证码由管理员配置，之后可接入火山短信自动发送。</p>
      <button type="submit" ${disabled}>注册</button>
    </form>
    <p class="extra"><a href="/login">返回登录</a></p>
  </main>
</body>
</html>`;
  res.writeHead(errorMessage ? 400 : 200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(html);
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
    enabled: user.enabled !== false,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
  };
}

function getRemainingQuota(user) {
  return Math.max(0, Number(user.quota || 0) - Number(user.used || 0));
}

async function ensureAccountsFile() {
  try {
    await fs.access(ACCOUNTS_FILE);
  } catch {
    const username = APP_USERNAME || 'admin';
    const password = APP_PASSWORD || crypto.randomBytes(12).toString('base64url');
    const initial = {
      version: 1,
      updatedAt: new Date().toISOString(),
      users: [{
        id: crypto.randomUUID(),
        username,
        phone: '',
        password: hashPassword(password),
        role: 'admin',
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
      console.warn(`[accounts] 已创建管理员 ${username}，临时密码：${password}`);
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
      quota: Math.max(0, Math.floor(Number(user.quota || 0))),
      used: Math.max(0, Math.floor(Number(user.used || 0))),
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

async function handleAdminApi(req, res, auth) {
  if (auth.user.role !== 'admin') {
    sendJson(res, 403, { error: '仅管理员可以管理账号' });
    return;
  }
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const userPrefix = '/api/admin/users/';
  if (url.pathname === '/api/admin/users' && req.method === 'GET') {
    const accounts = await readAccounts();
    sendJson(res, 200, {
      maxAdmins: MAX_ADMIN_ACCOUNTS,
      users: accounts.users.map(publicUser),
    });
    return;
  }
  if (url.pathname === '/api/admin/users' && req.method === 'POST') {
    const payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const created = await mutateAccounts(accounts => {
      const username = validateUsername(payload.username);
      const password = validateNewPassword(payload.password);
      const phone = payload.phone ? validatePhone(payload.phone) : '';
      const role = payload.role === 'admin' ? 'admin' : 'user';
      const quota = validateQuota(payload.quota);
      if (accounts.users.some(user => user.username.toLowerCase() === username.toLowerCase())) {
        throw httpError(409, '账号名已存在');
      }
      if (phone && accounts.users.some(user => String(user.phone || '') === phone)) {
        throw httpError(409, '手机号已注册');
      }
      if (role === 'admin' && accounts.users.filter(user => user.role === 'admin').length >= MAX_ADMIN_ACCOUNTS) {
        throw httpError(400, `管理员账号最多 ${MAX_ADMIN_ACCOUNTS} 个`);
      }
      const user = {
        id: crypto.randomUUID(),
        username,
        phone,
        password: hashPassword(password),
        role,
        quota,
        used: 0,
        enabled: true,
        usage: [],
        createdAt: new Date().toISOString(),
        lastLoginAt: null,
      };
      accounts.users.push(user);
      return publicUser(user);
    });
    sendJson(res, 201, created);
    return;
  }
  if (url.pathname.startsWith(userPrefix)) {
    const userId = decodeURIComponent(url.pathname.slice(userPrefix.length));
    if (!userId) {
      sendJson(res, 404, { error: '账号不存在' });
      return;
    }
    if (req.method === 'PATCH') {
      const payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const updated = await mutateAccounts(accounts => {
        const user = accounts.users.find(item => item.id === userId);
        if (!user) throw httpError(404, '账号不存在');
        if (payload.username !== undefined) {
          const username = validateUsername(payload.username);
          if (accounts.users.some(item => item.id !== user.id && item.username.toLowerCase() === username.toLowerCase())) {
            throw httpError(409, '账号名已存在');
          }
          user.username = username;
        }
        if (payload.phone !== undefined) {
          const phone = payload.phone ? validatePhone(payload.phone) : '';
          if (phone && accounts.users.some(item => item.id !== user.id && String(item.phone || '') === phone)) {
            throw httpError(409, '手机号已注册');
          }
          user.phone = phone;
        }
        if (payload.password) user.password = hashPassword(validateNewPassword(payload.password));
        if (payload.quota !== undefined) user.quota = validateQuota(payload.quota);
        if (payload.enabled !== undefined) user.enabled = Boolean(payload.enabled);
        if (payload.role !== undefined) {
          const role = payload.role === 'admin' ? 'admin' : 'user';
          const adminCount = accounts.users.filter(item => item.role === 'admin').length;
          if (role === 'admin' && user.role !== 'admin' && adminCount >= MAX_ADMIN_ACCOUNTS) {
            throw httpError(400, `管理员账号最多 ${MAX_ADMIN_ACCOUNTS} 个`);
          }
          if (role !== 'admin' && user.role === 'admin' && adminCount <= 1) {
            throw httpError(400, '至少保留一个管理员账号');
          }
          user.role = role;
        }
        return publicUser(user);
      });
      sendJson(res, 200, updated);
      return;
    }
    if (req.method === 'DELETE') {
      if (userId === auth.user.id) {
        sendJson(res, 400, { error: '不能删除当前登录的管理员账号' });
        return;
      }
      await mutateAccounts(accounts => {
        const index = accounts.users.findIndex(item => item.id === userId);
        if (index < 0) throw httpError(404, '账号不存在');
        const user = accounts.users[index];
        if (user.role === 'admin' && accounts.users.filter(item => item.role === 'admin').length <= 1) {
          throw httpError(400, '至少保留一个管理员账号');
        }
        accounts.users.splice(index, 1);
      });
      for (const [token, session] of sessions) {
        if (session.userId === userId) sessions.delete(token);
      }
      sendJson(res, 200, { deleted: true });
      return;
    }
  }
  sendJson(res, 404, { error: '未知的管理员接口' });
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

function validatePhone(value) {
  const phone = String(value || '').trim();
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    throw httpError(400, '请输入有效的中国大陆手机号');
  }
  return phone;
}

function validateInviteCode(value) {
  const inviteCode = String(value || '').trim();
  if (REGISTER_INVITE_CODES.length === 0) return inviteCode;
  if (!REGISTER_INVITE_CODES.includes(inviteCode)) {
    throw httpError(400, '邀请码无效');
  }
  return inviteCode;
}

function validateRegisterSmsCode(value) {
  const smsCode = String(value || '').trim();
  if (REGISTER_SMS_CODE && smsCode !== REGISTER_SMS_CODE) {
    throw httpError(400, '短信验证码错误');
  }
  return smsCode;
}

function validateNewPassword(value) {
  const password = String(value || '');
  if (password.length < 8 || password.length > 128) {
    throw httpError(400, '密码长度需为 8-128 位');
  }
  return password;
}

function validateQuota(value) {
  const quota = Number(value);
  if (!Number.isInteger(quota) || quota < 0 || quota > 1000000) {
    throw httpError(400, '额度需为 0-1000000 的整数');
  }
  return quota;
}

function validateStartupQuota(value) {
  const quota = Number(value);
  return Number.isInteger(quota) && quota >= 0 ? quota : 0;
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
    const chargeAmount = validateGenerationDuration(requestSummary.duration);
    reservation = await reserveGenerationQuota(req.auth.user.id, {
      endpoint: url.pathname,
      request: requestSummary,
      amount: chargeAmount,
    });
    if (!reservation.allowed) {
      sendJson(res, 402, {
        error: `个人额度不足：本次 ${chargeAmount} 秒视频需要 ${chargeAmount} 点额度`,
        code: 'QUOTA_EXHAUSTED',
        required: chargeAmount,
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
    } else if (req.method === 'GET' && url.pathname.startsWith('/api/video/tasks/') && isFailedTaskResponse(text)) {
      await refundFailedTaskQuota(req.auth.user.id, readTaskId(text) || decodeURIComponent(url.pathname.slice('/api/video/tasks/'.length)));
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
    const amount = context.amount;
    if (getRemainingQuota(user) < amount) {
      return { allowed: false, user: publicUser(user) };
    }
    const usageId = crypto.randomUUID();
    user.used += amount;
    user.usage = Array.isArray(user.usage) ? user.usage : [];
    user.usage.push({
      id: usageId,
      type: 'video_generation',
      amount,
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
    if (!usage) return;
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
    user.used = Math.max(0, Number(user.used || 0) - Number(usage.amount || 0));
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

function validateGenerationDuration(value) {
  const duration = Number(value);
  if (!Number.isInteger(duration) || duration < 1 || duration > 3600) {
    throw httpError(400, '视频时长无效，无法计算额度');
  }
  return duration;
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

async function refundFailedTaskQuota(userId, taskId) {
  if (!taskId) return;
  await mutateAccounts(accounts => {
    const user = accounts.users.find(item => item.id === userId);
    const usage = user?.usage?.find(item => item.taskId === taskId && item.status === 'charged');
    if (!user || !usage) return;
    user.used = Math.max(0, Number(user.used || 0) - Number(usage.amount || 0));
    usage.status = 'refunded';
    usage.reason = '视频任务失败';
    usage.completedAt = new Date().toISOString();
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
