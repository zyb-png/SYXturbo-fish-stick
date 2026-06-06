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
const SESSION_TOKEN = crypto.createHash('sha256')
  .update(`${APP_USERNAME || 'manfei'}:${APP_PASSWORD}:manfei-session`)
  .digest('hex');
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
    if (req.url === '/login' && req.method === 'GET') {
      serveLoginPage(res);
      return;
    }
    if (req.url === '/login' && req.method === 'POST') {
      await handleLogin(req, res);
      return;
    }
    if (req.url === '/logout') {
      res.writeHead(303, {
        'Set-Cookie': 'manfei_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
        'Location': '/login',
      });
      res.end();
      return;
    }
    if (!isAuthorized(req)) {
      if (req.url?.startsWith('/api/')) {
        sendJson(res, 401, { error: '请先登录' });
      } else {
        res.writeHead(303, { 'Location': '/login', 'Cache-Control': 'no-store' });
        res.end();
      }
      return;
    }
    if (req.url?.startsWith('/api/')) {
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
    sendJson(res, 500, { error: error.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Manfei Seedance app: http://localhost:${PORT}`);
  console.log(`Proxy target: ${API_BASE}`);
  console.log(tosClient ? `TOS bucket: ${TOS_CONFIG.bucket}` : 'TOS upload: not configured');
  console.log(APP_PASSWORD ? `Access protection: enabled (${APP_USERNAME || 'manfei'})` : 'Access protection: disabled');
});

function isAuthorized(req) {
  if (!APP_PASSWORD) return true;
  const cookies = parseCookies(req.headers.cookie || '');
  if (cookies.manfei_session && safeEqual(cookies.manfei_session, SESSION_TOKEN)) return true;
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    return safeEqual(username, APP_USERNAME || 'manfei') && safeEqual(password, APP_PASSWORD);
  } catch {
    return false;
  }
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
  if (safeEqual(username, APP_USERNAME || 'manfei') && safeEqual(password, APP_PASSWORD)) {
    res.writeHead(303, {
      'Set-Cookie': `manfei_session=${SESSION_TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=172800`,
      'Location': '/',
      'Cache-Control': 'no-store',
    });
    res.end();
    return;
  }
  serveLoginPage(res, true);
}

function serveLoginPage(res, hasError = false) {
  const error = hasError ? '<p class="error">用户名或密码错误</p>' : '';
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>登录 · 漫飞视频生成</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#030504;color:#eee2c9;font-family:system-ui,-apple-system,sans-serif}
    main{width:min(360px,calc(100vw - 32px));border:1px solid rgba(212,164,77,.55);border-radius:8px;background:#090c0a;padding:28px;box-shadow:0 20px 60px #000}
    .mark{display:grid;place-items:center;width:48px;height:48px;margin-bottom:18px;border:1px solid #d4a44d;border-radius:7px;color:#ffe09a;font-weight:800}
    h1{margin:0 0 6px;color:#efd18d;font-size:22px}p{margin:0 0 20px;color:#918875;font-size:12px}
    label{display:grid;gap:7px;margin-top:14px;color:#a79b85;font-size:12px}
    input{width:100%;height:42px;border:1px solid rgba(212,164,77,.4);border-radius:6px;background:#050806;color:#eee2c9;padding:0 12px;outline:none}
    input:focus{border-color:#d4a44d;box-shadow:0 0 0 2px rgba(212,164,77,.12)}
    button{width:100%;height:44px;margin-top:20px;border:1px solid #e2af50;border-radius:6px;background:linear-gradient(135deg,#a96e22,#d7a44b,#79501c);color:#fff0c5;font-weight:800;cursor:pointer}
    .error{margin:12px 0 0;color:#ef8c7b}
  </style>
</head>
<body>
  <main>
    <div class="mark">MF</div>
    <h1>漫飞视频生成</h1>
    <p>登录后进入 Seedance 工作台</p>
    ${error}
    <form method="post" action="/login">
      <label>用户名<input name="username" autocomplete="username" autofocus required></label>
      <label>密码<input name="password" type="password" autocomplete="current-password" required></label>
      <button type="submit">登录</button>
    </form>
  </main>
</body>
</html>`;
  res.writeHead(hasError ? 401 : 200, {
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
  const headers = {
    'Authorization': `Bearer ${API_TOKEN}`,
    'Accept': 'application/json',
  };
  if (body.length > 0) headers['Content-Type'] = req.headers['content-type'] || 'application/json';

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: body.length > 0 ? body : undefined,
  });

  const text = await upstream.text();
  res.writeHead(upstream.status, {
    'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(text);
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
