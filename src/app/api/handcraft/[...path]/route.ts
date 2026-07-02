import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { TosClient } from '@volcengine/tos-sdk';
import {
  getAssetStorageConfigSync,
  getManfeiConfigSync,
} from '@/lib/app-settings';
import {
  getAccountProjectStateDir,
  getAccountRemoteKey,
} from '@/lib/account-assets';
import { settleManfeiVideoCreationPointsByTaskId } from '@/lib/manfei-billing';
import { getCurrentUserAccount } from '@/lib/account-store';
import {
  bindCreationPointTask,
  completeCreationPointTask,
  failCreationPointTask,
  freezeCreationPoints,
  getCreationPointSnapshotForAccount,
  InsufficientCreationPointsError,
  settleCreationPointTaskByExternalId,
} from '@/lib/creation-points';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type JsonRecord = Record<string, unknown>;

const HANDCRAFT_API_PREFIX = '/api/handcraft';
const APP_STATE_FILE = 'handcraft-app-state.json';
const TOS_UPLOAD_PREFIX = 'handcraft-assets';
const TOS_SIGNED_URL_EXPIRES = 7 * 24 * 60 * 60;
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

function json(payload: JsonRecord, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function getHandcraftPath(request: NextRequest): string {
  const pathname = new URL(request.url).pathname;
  return pathname.startsWith(HANDCRAFT_API_PREFIX)
    ? pathname.slice(HANDCRAFT_API_PREFIX.length) || '/'
    : pathname;
}

function getAppStatePath(account: NonNullable<Awaited<ReturnType<typeof getCurrentUserAccount>>>): string {
  return path.join(getAccountProjectStateDir(account), APP_STATE_FILE);
}

function normalizeTosEndpoint(endpointUrl: string): string {
  try {
    return new URL(endpointUrl.includes('://') ? endpointUrl : `https://${endpointUrl}`).hostname;
  } catch {
    return endpointUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }
}

function buildObjectKey(
  account: NonNullable<Awaited<ReturnType<typeof getCurrentUserAccount>>>,
  filename: string
): string {
  const ext = path.extname(filename).toLowerCase();
  const safeBase = path.basename(filename, ext)
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'file';
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const random = crypto.randomBytes(4).toString('hex');
  return getAccountRemoteKey(account, `${TOS_UPLOAD_PREFIX}/${stamp}_${random}_${safeBase}${ext}`);
}

function parseJson(text: string): JsonRecord {
  try {
    const value = JSON.parse(text || '{}');
    return value && typeof value === 'object' ? value as JsonRecord : {};
  } catch {
    return {};
  }
}

function getNestedRecord(value: unknown, key: string): JsonRecord | null {
  if (!value || typeof value !== 'object') return null;
  const nested = (value as JsonRecord)[key];
  return nested && typeof nested === 'object' ? nested as JsonRecord : null;
}

function extractTaskId(payload: JsonRecord): string {
  const detail = getNestedRecord(payload, 'detail');
  return String(
    payload.id ||
    payload.task_id ||
    detail?.task_id ||
    detail?.id ||
    ''
  );
}

function extractStatus(payload: JsonRecord): string {
  return String(payload.status || getNestedRecord(payload, 'detail')?.status || '').toLowerCase();
}

function isSuccessStatus(status: string): boolean {
  return ['succeeded', 'success', 'completed', 'complete'].includes(status);
}

function isFailureStatus(status: string): boolean {
  return ['failed', 'error', 'cancelled', 'canceled', 'expired'].includes(status);
}

function normalizeVideoDuration(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(15, Math.max(4, Math.round(parsed)));
}

function buildSessionPayload(
  account: Awaited<ReturnType<typeof getCurrentUserAccount>>,
  snapshot?: Awaited<ReturnType<typeof getCreationPointSnapshotForAccount>>,
): JsonRecord {
  if (!account || !snapshot) {
    return {
      username: '未登录账号',
      quota: 0,
      used: 0,
      remaining: 0,
      frozen: 0,
      currency: '点',
      publicAccess: true,
    };
  }

  return {
    id: account.id,
    username: account.username,
    name: account.name || account.username,
    quota: snapshot.summary.availablePoints + snapshot.summary.frozenPoints + snapshot.summary.consumedPoints,
    used: snapshot.summary.consumedPoints,
    remaining: snapshot.summary.availablePoints,
    frozen: snapshot.summary.frozenPoints,
    currency: '点',
    publicAccess: false,
  };
}

async function getCurrentSessionPayload(): Promise<JsonRecord> {
  const account = await getCurrentUserAccount();
  if (!account) return buildSessionPayload(null);
  const snapshot = await getCreationPointSnapshotForAccount(account.id);
  return buildSessionPayload(account, snapshot);
}

async function requireUserLogin(): Promise<NextResponse | null> {
  const account = await getCurrentUserAccount();
  if (account) return null;
  return json({
    success: false,
    error: '请先登录账号后再使用该功能',
    code: 'LOGIN_REQUIRED',
  }, 401);
}

async function handleUsage(request: NextRequest): Promise<NextResponse> {
  const account = await getCurrentUserAccount();
  if (!account) return json({
    username: '未登录账号',
    quota: 0,
    used: 0,
    remaining: 0,
    currency: '点',
    items: [],
  });

  const snapshot = await getCreationPointSnapshotForAccount(account.id);
  const search = new URL(request.url).searchParams;
  const limit = Math.min(100, Math.max(1, Number(search.get('limit')) || 20));
  const chargedOnly = search.get('charged_only') === 'true';
  const items = snapshot.transactions
    .filter((item) => item.type !== 'freeze')
    .filter((item) => !chargedOnly || (item.type === 'consume' && Boolean(item.taskId || item.featureCode)))
    .slice()
    .reverse()
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      taskId: item.taskId,
      type: item.type,
      amount: item.amount,
      currency: '点',
      featureCode: item.featureCode,
      description: item.description,
      createdAt: item.createdAt,
    }));

  return json({
    username: account.username,
    quota: snapshot.summary.availablePoints + snapshot.summary.frozenPoints + snapshot.summary.consumedPoints,
    used: snapshot.summary.consumedPoints,
    remaining: snapshot.summary.availablePoints,
    frozen: snapshot.summary.frozenPoints,
    currency: '点',
    items,
  });
}

async function handleAppState(request: NextRequest): Promise<NextResponse> {
  const account = await getCurrentUserAccount();
  if (!account) return json({
    success: false,
    error: '请先登录账号后再使用该功能',
    code: 'LOGIN_REQUIRED',
  }, 401);

  const appStatePath = getAppStatePath(account);
  if (request.method === 'GET') {
    try {
      const value = JSON.parse(await fsp.readFile(appStatePath, 'utf-8'));
      return json({
        version: 1,
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
        resources: Array.isArray(value.resources) ? value.resources : [],
      });
    } catch {
      return json({ version: 1, updatedAt: null, resources: [] });
    }
  }

  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405);
  const payload = await request.json().catch(() => ({}));
  const resources = Array.isArray(payload.resources) ? payload.resources : [];
  const appState = {
    version: 1,
    updatedAt: new Date().toISOString(),
    resources,
  };
  await fsp.mkdir(path.dirname(appStatePath), { recursive: true });
  await fsp.writeFile(appStatePath, `${JSON.stringify(appState, null, 2)}\n`, 'utf-8');
  return json({
    saved: true,
    updatedAt: appState.updatedAt,
    resourceGroups: resources.length,
  });
}

async function handleUploadObject(request: NextRequest): Promise<NextResponse> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const loginResponse = await requireUserLogin();
  if (loginResponse) return loginResponse;
  const account = await getCurrentUserAccount();
  if (!account) return json({
    success: false,
    error: '请先登录账号后再使用该功能',
    code: 'LOGIN_REQUIRED',
  }, 401);

  const config = getAssetStorageConfigSync();
  const bucket = config.accessPointAlias || config.bucketName;
  if (!config.endpointUrl || !bucket || !config.accessKeyId || !config.secretAccessKey) {
    return json({
      error: 'TOS 对象存储未配置，请联系管理员检查素材存储设置',
    }, 500);
  }

  const payload = await request.json().catch(() => ({}));
  const filename = typeof payload.filename === 'string' ? payload.filename : '';
  const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType : 'application/octet-stream';
  const dataBase64 = typeof payload.dataBase64 === 'string' ? payload.dataBase64 : '';
  if (!filename || !dataBase64) {
    return json({ error: '缺少 filename 或 dataBase64' }, 400);
  }

  const buffer = Buffer.from(dataBase64.replace(/^data:[^,]+,/, ''), 'base64');
  if (buffer.length === 0) return json({ error: '文件内容为空' }, 400);
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return json({ error: '文件超过 64MB，请改用公网 URL 或更大的上传通道' }, 400);
  }

  const key = buildObjectKey(account, filename);
  const client = new TosClient({
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.secretAccessKey,
    region: config.region || 'cn-beijing',
    endpoint: normalizeTosEndpoint(config.endpointUrl),
    bucket,
  });
  const uploadResult = await client.putObject({
    key,
    body: buffer,
    contentType: mimeType,
  });
  const publicUrl = client.getPreSignedUrl({
    key,
    method: 'GET',
    expires: TOS_SIGNED_URL_EXPIRES,
  });

  return json({
    url: publicUrl,
    key,
    size: buffer.length,
    mimeType,
    bucket,
    requestId: uploadResult.requestId,
    expiresIn: TOS_SIGNED_URL_EXPIRES,
  });
}

function isPublicHttpsHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return !(
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local') ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

function sanitizeDownloadFilename(filename: string): string {
  const safe = path.basename(filename)
    .replace(/[\u0000-\u001f\u007f"\\/:*?<>|]+/g, '-')
    .slice(0, 120) || 'seedance-video.mp4';
  return path.extname(safe).toLowerCase() === '.mp4' ? safe : `${safe}.mp4`;
}

async function handleDownloadVideo(request: NextRequest): Promise<NextResponse> {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const requestUrl = new URL(request.url);
  const source = requestUrl.searchParams.get('url') || '';
  const requestedName = requestUrl.searchParams.get('filename') || 'seedance-video.mp4';

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(source);
  } catch {
    return json({ error: '无效的视频地址' }, 400);
  }

  if (sourceUrl.protocol !== 'https:' || !isPublicHttpsHost(sourceUrl.hostname)) {
    return json({ error: '不允许下载该视频地址' }, 400);
  }

  const upstream = await fetch(sourceUrl, {
    headers: { Accept: 'video/*,application/octet-stream' },
  });
  if (!upstream.ok || !upstream.body) {
    return json({ error: `视频下载失败：HTTP ${upstream.status}` }, upstream.status || 502);
  }

  const filename = sanitizeDownloadFilename(requestedName);
  const headers = new Headers({
    'Content-Type': upstream.headers.get('content-type') || 'video/mp4',
    'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'private, no-store',
  });
  const contentLength = upstream.headers.get('content-length');
  if (contentLength) headers.set('Content-Length', contentLength);
  return new NextResponse(upstream.body, { status: 200, headers });
}

function mapManfeiTarget(apiPath: string, search: string): string | null {
  const config = getManfeiConfigSync();
  const baseUrl = config.baseUrl.replace(/\/+$/, '');

  if (apiPath === '/assets') return `${baseUrl}/v1/assets`;
  if (apiPath.startsWith('/assets/')) {
    const id = encodeURIComponent(decodeURIComponent(apiPath.slice('/assets/'.length)));
    return `${baseUrl}/v1/assets/${id}`;
  }
  if (apiPath === '/video/tasks') return `${baseUrl}/v1/video/tasks`;
  if (apiPath === '/video/tasks/generate') return `${baseUrl}/v1/video/tasks:generate`;
  if (apiPath.startsWith('/video/tasks/') && apiPath.endsWith('/cancel')) {
    const id = encodeURIComponent(decodeURIComponent(apiPath.slice('/video/tasks/'.length, -'/cancel'.length)));
    return `${baseUrl}/v1/video/tasks/${id}/cancel`;
  }
  if (apiPath.startsWith('/video/tasks/')) {
    const id = encodeURIComponent(decodeURIComponent(apiPath.slice('/video/tasks/'.length)));
    return `${baseUrl}/v1/video/tasks/${id}${search}`;
  }
  return null;
}

async function proxyManfei(
  request: NextRequest,
  apiPath: string,
  body: Buffer,
): Promise<{ response: Response; text: string; payload: JsonRecord }> {
  const config = getManfeiConfigSync();
  if (!config.apiKey) throw new Error('未配置 manfei Token，请联系管理员配置视频生成接口');

  const requestUrl = new URL(request.url);
  const target = mapManfeiTarget(apiPath, requestUrl.search || '');
  if (!target) {
    return {
      response: new Response(JSON.stringify({ error: 'Unknown API route' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      }),
      text: JSON.stringify({ error: 'Unknown API route' }),
      payload: { error: 'Unknown API route' },
    };
  }

  const headers: HeadersInit = {
    Authorization: `Bearer ${config.apiKey}`,
    Accept: 'application/json',
  };
  if (body.length > 0) {
    headers['Content-Type'] = request.headers.get('content-type') || 'application/json';
  }

  const response = await fetch(target, {
    method: request.method,
    headers,
    body: body.length > 0 ? body as unknown as BodyInit : undefined,
  });
  const text = await response.text();
  return { response, text, payload: parseJson(text) };
}

async function settleTaskFromPayload(payload: JsonRecord): Promise<void> {
  const taskId = extractTaskId(payload);
  const status = extractStatus(payload);
  if (!taskId || !status) return;
  if (isSuccessStatus(status)) {
    await settleManfeiVideoCreationPointsByTaskId(taskId, {
      attempts: 3,
      intervalMs: 1_500,
    });
  } else if (isFailureStatus(status)) {
    const errorMessage = String(payload.error || payload.message || '视频任务失败');
    await settleCreationPointTaskByExternalId(taskId, 'failure', errorMessage);
  }
}

function passthroughResponse(response: Response, text: string): NextResponse {
  return new NextResponse(text, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('content-type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function handleManfeiProxy(request: NextRequest): Promise<NextResponse> {
  const loginResponse = await requireUserLogin();
  if (loginResponse) return loginResponse;

  const apiPath = getHandcraftPath(request);
  const isVideoCreate = request.method === 'POST' &&
    (apiPath === '/video/tasks' || apiPath === '/video/tasks/generate');
  const isVideoTaskRead = request.method === 'GET' && apiPath.startsWith('/video/tasks/');
  const isVideoTaskCancel = request.method === 'POST' &&
    apiPath.startsWith('/video/tasks/') &&
    apiPath.endsWith('/cancel');
  const body = Buffer.from(await request.arrayBuffer());
  let creationPointTaskId = '';

  try {
    if (isVideoCreate) {
      const payload = parseJson(body.toString('utf-8'));
      const duration = normalizeVideoDuration(payload.duration);
      const pointTask = await freezeCreationPoints({
        featureCode: 'generate_video',
        quantity: duration,
        metadata: {
          duration,
          ratio: payload.ratio,
          resolution: payload.resolution,
          model: payload.model || 'moon-manfei-new',
          source: 'handcraft',
        },
      });
      creationPointTaskId = pointTask.taskId;
    }

    const upstream = await proxyManfei(request, apiPath, body);
    const status = extractStatus(upstream.payload);
    const taskId = extractTaskId(upstream.payload);

    if (isVideoCreate && creationPointTaskId) {
      if (!upstream.response.ok || isFailureStatus(status)) {
        await failCreationPointTask(
          creationPointTaskId,
          String(upstream.payload.error || upstream.payload.message || `上游返回 HTTP ${upstream.response.status}`)
        );
      } else if (taskId) {
        await bindCreationPointTask(creationPointTaskId, taskId);
        if (isSuccessStatus(status)) {
          await settleManfeiVideoCreationPointsByTaskId(taskId, {
            attempts: 3,
            intervalMs: 1_500,
          });
        } else if (isFailureStatus(status)) {
          await failCreationPointTask(creationPointTaskId, String(upstream.payload.error || '视频生成失败'));
        }
      } else if (upstream.response.ok && apiPath === '/video/tasks/generate') {
        await completeCreationPointTask(creationPointTaskId);
      }
    } else if (isVideoTaskRead) {
      await settleTaskFromPayload(upstream.payload);
    } else if (isVideoTaskCancel) {
      const cancelledTaskId = decodeURIComponent(apiPath.slice('/video/tasks/'.length, -'/cancel'.length));
      if (upstream.response.ok && cancelledTaskId) {
        await settleCreationPointTaskByExternalId(cancelledTaskId, 'failure', '视频任务已取消');
      }
    }

    return passthroughResponse(upstream.response, upstream.text);
  } catch (error) {
    if (creationPointTaskId) {
      await failCreationPointTask(
        creationPointTaskId,
        error instanceof Error ? error.message : '视频任务提交失败'
      ).catch((refundError) => {
        console.error('[handcraft] 视频任务退回失败:', refundError);
      });
    }
    const status = error instanceof InsufficientCreationPointsError ? 402 : 500;
    return json({
      success: false,
      error: error instanceof Error ? error.message : '请求失败',
      code: error instanceof InsufficientCreationPointsError ? 'INSUFFICIENT_CREATION_POINTS' : 'HANDCRAFT_API_ERROR',
    }, status);
  }
}

async function handleRequest(request: NextRequest): Promise<NextResponse> {
  const apiPath = getHandcraftPath(request);
  if ((apiPath === '/session' || apiPath === '/me') && request.method === 'GET') {
    return json(await getCurrentSessionPayload());
  }
  if (apiPath === '/usage' && request.method === 'GET') return handleUsage(request);
  if (apiPath === '/app-state') return handleAppState(request);
  if (apiPath === '/upload-object') return handleUploadObject(request);
  if (apiPath === '/download-video') return handleDownloadVideo(request);
  return handleManfeiProxy(request);
}

export async function GET(request: NextRequest) {
  return handleRequest(request);
}

export async function POST(request: NextRequest) {
  return handleRequest(request);
}

export async function PUT(request: NextRequest) {
  return handleRequest(request);
}
