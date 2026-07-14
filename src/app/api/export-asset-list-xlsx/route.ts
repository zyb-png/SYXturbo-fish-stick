import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import archiver from 'archiver';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import {
  getAccountAssetsPath,
  readAssetFoldersConfig,
  resolveAccountAssetFilePath,
} from '@/lib/account-assets';

export const runtime = 'nodejs';
export const maxDuration = 300;

type ExportType = 'scene' | 'character' | 'prop';

interface ExportImage {
  url?: string;
  label?: string;
  fileName?: string;
}

interface ExportRow {
  group?: string;
  assetName?: string;
  assetLookId?: string;
  cells?: Record<string, string | number | boolean | null | undefined>;
  images?: ExportImage[];
}

interface ExportPayload {
  type?: ExportType;
  projectName?: string;
  saveToDownloads?: boolean;
  packageOriginals?: boolean;
  rows?: ExportRow[];
}

interface ColumnDefinition {
  key: string;
  header: string;
  width: number;
  imageSlot?: number;
}

interface WorkbookDefinition {
  title: string;
  sheetName: string;
  columns: ColumnDefinition[];
}

const GOLD = 'FFD9A62E';
const GOLD_LIGHT = 'FFFFE7A3';
const BLACK = 'FF0B0B0A';
const BLACK_SOFT = 'FF17150F';
const WARM_ROW = 'FFFFFBEE';
const WHITE = 'FFFFFFFF';
const TEXT = 'FF27231A';
const MUTED = 'FF6B6252';

const DEFINITIONS: Record<ExportType, WorkbookDefinition> = {
  scene: {
    title: '场景状态制作清单',
    sheetName: '场景列表',
    columns: [
      { key: 'sequence', header: '序号', width: 8 },
      { key: 'mainName', header: '主场景名称', width: 22 },
      { key: 'stateName', header: '状态 / 变体', width: 24 },
      { key: 'stateSequence', header: '状态序号', width: 10 },
      { key: 'episodes', header: '关联集数', width: 18 },
      { key: 'occurrences', header: '具体场次', width: 30 },
      { key: 'timePeriod', header: '日夜 / 年代', width: 16 },
      { key: 'description', header: '场景描述', width: 42 },
      { key: 'events', header: '关键事件', width: 36 },
      { key: 'visualElements', header: '视觉元素', width: 32 },
      { key: 'prompt', header: '最终提示词', width: 58 },
      { key: 'generationMode', header: '生成方式', width: 14 },
      { key: 'reference', header: '参考状态', width: 24 },
      { key: 'image1', header: '主图', width: 18, imageSlot: 0 },
      { key: 'image2', header: '图片 2', width: 18, imageSlot: 1 },
      { key: 'image3', header: '图片 3', width: 18, imageSlot: 2 },
    ],
  },
  character: {
    title: '人物造型与状态制作清单',
    sheetName: '人物列表',
    columns: [
      { key: 'sequence', header: '序号', width: 8 },
      { key: 'mainName', header: '人物名称', width: 18 },
      { key: 'role', header: '角色定位', width: 16 },
      { key: 'ageGender', header: '年龄 / 性别', width: 16 },
      { key: 'lookName', header: '造型 / 状态名称', width: 24 },
      { key: 'changeType', header: '变化类型', width: 16 },
      { key: 'episodes', header: '关联集数', width: 18 },
      { key: 'scenes', header: '关联场次', width: 30 },
      { key: 'events', header: '关联事件 / 原文依据', width: 36 },
      { key: 'personality', header: '性格', width: 24 },
      { key: 'appearance', header: '外貌与固定五官', width: 42 },
      { key: 'bodyProfile', header: '身高体型', width: 30 },
      { key: 'costume', header: '服装配饰', width: 34 },
      { key: 'background', header: '背景与人物关系', width: 42 },
      { key: 'arc', header: '人物弧光', width: 34 },
      { key: 'prompt', header: '最终提示词', width: 58 },
      { key: 'reference', header: '参考造型', width: 24 },
      { key: 'image1', header: '主图', width: 18, imageSlot: 0 },
      { key: 'image2', header: '图片 2', width: 18, imageSlot: 1 },
      { key: 'image3', header: '图片 3', width: 18, imageSlot: 2 },
      { key: 'fourView', header: '四视图', width: 20, imageSlot: 3 },
    ],
  },
  prop: {
    title: '道具状态制作清单',
    sheetName: '道具列表',
    columns: [
      { key: 'sequence', header: '序号', width: 8 },
      { key: 'mainName', header: '主道具名称', width: 22 },
      { key: 'stateName', header: '状态名称', width: 24 },
      { key: 'stateSequence', header: '状态顺序', width: 10 },
      { key: 'typeImportance', header: '类型 / 重要性', width: 18 },
      { key: 'owner', header: '归属', width: 16 },
      { key: 'episodes', header: '关联集数', width: 18 },
      { key: 'occurrences', header: '具体场次', width: 30 },
      { key: 'transition', header: '状态形成原因', width: 36 },
      { key: 'visualChange', header: '状态视觉变化', width: 38 },
      { key: 'narrativeFunction', header: '剧情推动作用', width: 38 },
      { key: 'evidence', header: '原文依据', width: 38 },
      { key: 'description', header: '道具描述', width: 38 },
      { key: 'prompt', header: '最终提示词', width: 58 },
      { key: 'generationMode', header: '生成方式', width: 14 },
      { key: 'reference', header: '参考状态', width: 24 },
      { key: 'image1', header: '主图', width: 18, imageSlot: 0 },
      { key: 'image2', header: '图片 2', width: 18, imageSlot: 1 },
      { key: 'image3', header: '图片 3', width: 18, imageSlot: 2 },
    ],
  },
};

const MAX_ROWS = 1200;
const MAX_SOURCE_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_DATA_URL_LENGTH = 45 * 1024 * 1024;
const IMAGE_FILE_PATTERN = /\.(png|jpe?g|gif|webp)$/i;
const EXPORT_TOKEN_PATTERN = /^[a-f0-9-]{36}$/i;
const EXPORT_RETENTION_MS = 24 * 60 * 60 * 1000;
const TYPE_FOLDER_NAMES: Record<ExportType, string> = {
  scene: '场景',
  character: '人物',
  prop: '道具',
};

interface PreparedExportMetadata {
  fileName: string;
  storedExtension?: 'xlsx' | 'zip';
  contentType?: string;
  workbookFileName?: string;
  createdAt: number;
  rowCount: number;
  imageCount: number;
  originalImageCount?: number;
  failedImageCount: number;
}

interface PreparedImage {
  imageId: number;
  originalRelativePath?: string;
}

function sanitizeFileName(value: string): string {
  return value
    .replace(/\.[^.]+$/, '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 70) || '项目';
}

function sanitizePathSegment(value: unknown, fallback: string): string {
  return String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim()
    .slice(0, 70) || fallback;
}

function toArchivePath(value: string): string {
  return value.split(path.sep).join('/');
}

async function detectOriginalImageExtension(buffer: Buffer): Promise<string> {
  try {
    const metadata = await sharp(buffer, { failOn: 'none', animated: false }).metadata();
    const extensionMap: Record<string, string> = {
      jpeg: 'jpg',
      jpg: 'jpg',
      png: 'png',
      webp: 'webp',
      gif: 'gif',
      tiff: 'tif',
      avif: 'avif',
      heif: 'heic',
    };
    return extensionMap[String(metadata.format || '').toLowerCase()] || 'png';
  } catch {
    return 'png';
  }
}

async function createZipArchive(sourceDirectory: string, destinationPath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(destinationPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('warning', warning => {
      if ((warning as NodeJS.ErrnoException).code === 'ENOENT') {
        console.warn('[完整素材 ZIP] 归档警告:', warning.message);
        return;
      }
      reject(warning);
    });
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDirectory, false);
    void archive.finalize();
  });
}

function makeAssetFilePrefix(value: string): string {
  return String(value || '')
    .replace(/[<>:"/\\|?*\s]+/g, '_')
    .slice(0, 80);
}

function getDiskFallbackImages(
  type: ExportType,
  row: ExportRow,
  account: NonNullable<Awaited<ReturnType<typeof requireUserLoginResponse>>['account']>
): ExportImage[] {
  const assetName = String(row.assetName || '').trim();
  if (!assetName) return [];

  const folders = readAssetFoldersConfig();
  const folderName = type === 'scene' ? folders.scenes : type === 'character' ? folders.characters : folders.props;
  const folderPath = path.join(getAccountAssetsPath(account), folderName);
  if (!fs.existsSync(folderPath)) return [];

  const assetPrefix = makeAssetFilePrefix(assetName);
  const lookId = String(row.assetLookId || '').trim();
  const files = fs.readdirSync(folderPath)
    .filter(fileName => IMAGE_FILE_PATTERN.test(fileName))
    .filter(fileName => fs.statSync(path.join(folderPath, fileName)).isFile())
    .sort((left, right) => (
      fs.statSync(path.join(folderPath, right)).mtimeMs - fs.statSync(path.join(folderPath, left)).mtimeMs
    ));

  const toExportImage = (fileName: string, label: string): ExportImage => ({
    url: `/api/assets-view?folder=${encodeURIComponent(folderName)}&filename=${encodeURIComponent(fileName)}`,
    label,
    fileName,
  });

  if (type !== 'character') {
    return files
      .filter(fileName => fileName.startsWith(`${assetPrefix}_`))
      .slice(0, 3)
      .map((fileName, index) => toExportImage(fileName, index === 0 ? '主图' : `图片 ${index + 1}`));
  }

  if (!lookId) {
    return files
      .filter(fileName => fileName.startsWith(`${assetPrefix}_`))
      .filter(fileName => !/_look-[^_]+_/i.test(fileName) && !fileName.includes('四视图'))
      .slice(0, 3)
      .map((fileName, index) => toExportImage(fileName, index === 0 ? '主图' : `图片 ${index + 1}`));
  }

  const lookPrefix = `${assetPrefix}_${lookId}_`;
  const fourViewPrefix = `${makeAssetFilePrefix(`${assetName}的四视图`)}_${lookId}_`;
  const lookImages = files
    .filter(fileName => fileName.startsWith(lookPrefix))
    .slice(0, 3)
    .map((fileName, index) => toExportImage(fileName, index === 0 ? '主图' : `图片 ${index + 1}`));
  const fourView = files.find(fileName => fileName.startsWith(fourViewPrefix));

  return [
    ...lookImages,
    ...Array.from({ length: Math.max(0, 3 - lookImages.length) }, () => ({} as ExportImage)),
    fourView ? toExportImage(fourView, '四视图') : {},
  ];
}

function formatTimestamp(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function getPreparedExportDirectory(
  account: NonNullable<Awaited<ReturnType<typeof requireUserLoginResponse>>['account']>
): string {
  return path.join(getAccountAssetsPath(account), 'prepared-exports');
}

function getUniqueDownloadPath(directory: string, fileName: string): string {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  let candidate = path.join(directory, fileName);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${baseName}_${suffix}${extension}`);
    suffix += 1;
  }
  return candidate;
}

function cleanupPreparedExports(directory: string): void {
  if (!fs.existsSync(directory)) return;
  const expireBefore = Date.now() - EXPORT_RETENTION_MS;
  for (const fileName of fs.readdirSync(directory)) {
    const filePath = path.join(directory, fileName);
    try {
      if (fs.statSync(filePath).isFile() && fs.statSync(filePath).mtimeMs < expireBefore) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.warn('[Excel 导出] 清理临时文件失败:', filePath, error);
    }
  }
}

function normalizeCellValue(value: unknown): string | number | boolean {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return '';
  return String(value).replace(/\r\n/g, '\n').trim();
}

function parseDataUrl(url: string): Buffer | null {
  if (url.length > MAX_DATA_URL_LENGTH) return null;
  const match = url.match(/^data:[^;,]+;base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  const buffer = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
  return buffer.length <= MAX_SOURCE_IMAGE_BYTES ? buffer : null;
}

function isPrivateNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

async function readRemoteImage(url: URL, cookie: string): Promise<Buffer | null> {
  if (isPrivateNetworkHost(url.hostname)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      headers: cookie ? { Cookie: cookie } : undefined,
      redirect: 'follow',
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok || isPrivateNetworkHost(new URL(response.url).hostname)) return null;
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > MAX_SOURCE_IMAGE_BYTES) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length <= MAX_SOURCE_IMAGE_BYTES ? buffer : null;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadSourceImage(
  rawUrl: string,
  request: NextRequest,
  account: NonNullable<Awaited<ReturnType<typeof requireUserLoginResponse>>['account']>
): Promise<Buffer | null> {
  const url = rawUrl.trim();
  if (!url) return null;
  if (url.startsWith('data:')) return parseDataUrl(url);

  let parsed: URL;
  try {
    parsed = new URL(url, request.nextUrl.origin);
  } catch {
    return null;
  }

  if (parsed.pathname === '/api/assets-view') {
    const folder = parsed.searchParams.get('folder') || '';
    const filename = parsed.searchParams.get('filename') || '';
    const filePath = resolveAccountAssetFilePath(account, folder, filename);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    if (fs.statSync(filePath).size > MAX_SOURCE_IMAGE_BYTES) return null;
    return fs.promises.readFile(filePath);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const isSameOrigin = parsed.origin === request.nextUrl.origin;
  if (isSameOrigin && parsed.pathname !== '/api/s3-asset-view') return null;
  return readRemoteImage(parsed, isSameOrigin ? request.headers.get('cookie') || '' : '');
}

async function makeExcelThumbnail(buffer: Buffer, type: ExportType): Promise<Buffer> {
  const portrait = type === 'character';
  return sharp(buffer, { failOn: 'none', animated: false })
    .rotate()
    .resize({
      width: portrait ? 180 : 260,
      height: portrait ? 220 : 150,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
}

function applyThinBorder(cell: ExcelJS.Cell, color = 'FFE4D8B5') {
  cell.border = {
    top: { style: 'thin', color: { argb: color } },
    left: { style: 'thin', color: { argb: color } },
    bottom: { style: 'thin', color: { argb: color } },
    right: { style: 'thin', color: { argb: color } },
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  const token = request.nextUrl.searchParams.get('token') || '';
  if (!EXPORT_TOKEN_PATTERN.test(token)) {
    return NextResponse.json({ success: false, error: '无效的下载地址' }, { status: 400 });
  }

  try {
    const directory = getPreparedExportDirectory(auth.account);
    cleanupPreparedExports(directory);
    const metadataPath = path.join(directory, `${token}.json`);
    if (!fs.existsSync(metadataPath)) {
      return NextResponse.json({ success: false, error: '导出文件已失效，请重新点击导出' }, { status: 404 });
    }

    const metadata = JSON.parse(await fs.promises.readFile(metadataPath, 'utf-8')) as PreparedExportMetadata;
    const storedExtension = metadata.storedExtension || 'xlsx';
    const preparedPath = path.join(directory, `${token}.${storedExtension}`);
    if (!fs.existsSync(preparedPath)) {
      return NextResponse.json({ success: false, error: '导出文件已失效，请重新点击导出' }, { status: 404 });
    }
    const buffer = await fs.promises.readFile(preparedPath);
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': metadata.contentType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(metadata.fileName)}`,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, no-store',
        'X-Export-Row-Count': String(metadata.rowCount),
        'X-Export-Image-Count': String(metadata.imageCount),
        'X-Export-Original-Image-Count': String(metadata.originalImageCount || 0),
        'X-Export-Image-Failed': String(metadata.failedImageCount),
      },
    });
  } catch (error) {
    console.error('[Excel 导出] 下载准备文件失败:', error);
    return NextResponse.json({ success: false, error: '读取导出文件失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  let packageDirectory: string | null = null;
  let temporaryArchivePath: string | null = null;
  try {
    const payload = await request.json() as ExportPayload;
    const type = payload.type;
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const packageOriginals = payload.packageOriginals === true;

    if (!type || !DEFINITIONS[type]) {
      return NextResponse.json({ success: false, error: '未知导出类型' }, { status: 400 });
    }
    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: '当前列表没有可导出的内容' }, { status: 400 });
    }
    if (rows.length > MAX_ROWS) {
      return NextResponse.json({ success: false, error: `单次最多导出 ${MAX_ROWS} 行` }, { status: 400 });
    }

    const definition = DEFINITIONS[type];
    if (packageOriginals) {
      packageDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'manfei-asset-package-'));
    }
    console.info(`[Excel 导出] 开始生成 ${definition.sheetName}: ${rows.length} 行`);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'MM钰汐 一站式工作流';
    workbook.company = 'MM钰汐';
    workbook.subject = definition.title;
    workbook.title = definition.title;
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.calcProperties.fullCalcOnLoad = true;

    const worksheet = workbook.addWorksheet(definition.sheetName, {
      properties: { defaultRowHeight: 20 },
      pageSetup: {
        orientation: 'landscape',
        paperSize: 9 as ExcelJS.PaperSize,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 },
      },
      views: [{ state: 'frozen', xSplit: 2, ySplit: 4, topLeftCell: 'C5', activeCell: 'A5' }],
    });

    worksheet.columns = definition.columns.map(column => ({
      key: column.key,
      width: column.width,
    }));

    const lastColumn = definition.columns.length;
    worksheet.mergeCells(1, 1, 1, lastColumn);
    const titleCell = worksheet.getCell(1, 1);
    titleCell.value = definition.title;
    titleCell.font = { name: 'Microsoft YaHei', size: 20, bold: true, color: { argb: GOLD_LIGHT } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLACK } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
    worksheet.getRow(1).height = 34;

    worksheet.mergeCells(2, 1, 2, lastColumn);
    const summaryCell = worksheet.getCell(2, 1);
    summaryCell.value = `项目：${String(payload.projectName || '未命名项目')}    导出时间：${new Date().toLocaleString('zh-CN')}    共 ${rows.length} 条制作项`;
    summaryCell.font = { name: 'Microsoft YaHei', size: 10, color: { argb: MUTED } };
    summaryCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF6D7' } };
    summaryCell.alignment = { vertical: 'middle', horizontal: 'left' };
    worksheet.getRow(2).height = 24;
    worksheet.getRow(3).height = 8;

    const headerRow = worksheet.getRow(4);
    headerRow.values = definition.columns.map(column => column.header);
    headerRow.height = 32;
    headerRow.eachCell(cell => {
      cell.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: WHITE } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLACK_SOFT } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      applyThinBorder(cell, GOLD);
    });

    const preparedImageCache = new Map<string, Promise<PreparedImage | null>>();
    const usedOriginalPaths = new Set<string>();
    let originalImageCount = 0;
    const getPreparedImage = (image: ExportImage, sourceRow: ExportRow, imageIndex: number) => {
      const url = String(image.url || '').trim();
      const cacheKey = [
        url,
        sourceRow.group || '',
        sourceRow.assetName || '',
        sourceRow.assetLookId || '',
        sourceRow.cells?.stateName || '',
        sourceRow.cells?.lookName || '',
        imageIndex,
      ].join('\u0000');
      if (!preparedImageCache.has(cacheKey)) {
        preparedImageCache.set(cacheKey, (async () => {
          try {
            const source = await loadSourceImage(url, request, auth.account);
            if (!source) return null;
            const thumbnail = await makeExcelThumbnail(source, type);
            const prepared: PreparedImage = {
              imageId: workbook.addImage({ base64: thumbnail.toString('base64'), extension: 'png' }),
            };

            if (packageOriginals && packageDirectory) {
              const groupName = sanitizePathSegment(
                sourceRow.group || sourceRow.cells?.mainName,
                `${TYPE_FOLDER_NAMES[type]}分组`
              );
              const stateName = sanitizePathSegment(
                sourceRow.cells?.stateName || sourceRow.cells?.lookName || sourceRow.assetName,
                '基准状态'
              );
              const originalName = sanitizePathSegment(
                path.basename(String(image.fileName || image.label || `图片${imageIndex + 1}`), path.extname(String(image.fileName || ''))),
                `图片${imageIndex + 1}`
              );
              const extension = await detectOriginalImageExtension(source);
              const folderPath = path.join('原图', TYPE_FOLDER_NAMES[type], groupName, stateName);
              let fileName = `${String(imageIndex + 1).padStart(2, '0')}_${originalName}.${extension}`;
              let relativePath = path.join(folderPath, fileName);
              let suffix = 2;
              while (usedOriginalPaths.has(relativePath)) {
                fileName = `${String(imageIndex + 1).padStart(2, '0')}_${originalName}_${suffix}.${extension}`;
                relativePath = path.join(folderPath, fileName);
                suffix += 1;
              }
              usedOriginalPaths.add(relativePath);
              const absolutePath = path.join(packageDirectory, relativePath);
              await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
              await fs.promises.writeFile(absolutePath, source);
              prepared.originalRelativePath = toArchivePath(relativePath);
              originalImageCount += 1;
            }
            return prepared;
          } catch (error) {
            console.warn('[Excel 导出] 图片读取失败:', url.slice(0, 160), error);
            return null;
          }
        })());
      }
      return preparedImageCache.get(cacheKey)!;
    };

    let embeddedImageCount = 0;
    let failedImageCount = 0;
    let previousGroup = '';
    let groupIndex = -1;

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const sourceRow = rows[rowIndex] || {};
      const excelRowNumber = rowIndex + 5;
      const excelRow = worksheet.getRow(excelRowNumber);
      const group = String(sourceRow.group || sourceRow.cells?.mainName || '').trim();
      const beginsGroup = rowIndex === 0 || group !== previousGroup;
      if (beginsGroup) groupIndex += 1;
      previousGroup = group;
      const diskFallbackImages = getDiskFallbackImages(type, sourceRow, auth.account);
      const mergedImages = Array.from({ length: type === 'character' ? 4 : 3 }, (_, imageIndex) => {
        const suppliedImage = sourceRow.images?.[imageIndex];
        if (suppliedImage?.url) return suppliedImage;
        return diskFallbackImages[imageIndex]?.url ? diskFallbackImages[imageIndex] : suppliedImage;
      });

      excelRow.height = 108;
      for (let columnIndex = 0; columnIndex < definition.columns.length; columnIndex += 1) {
        const column = definition.columns[columnIndex];
        const cell = excelRow.getCell(columnIndex + 1);
        cell.font = {
          name: 'Microsoft YaHei',
          size: column.imageSlot === undefined ? 9 : 8,
          color: { argb: column.imageSlot === undefined ? TEXT : MUTED },
          bold: column.key === 'mainName' || column.key === 'stateName' || column.key === 'lookName',
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: groupIndex % 2 === 0 ? WHITE : WARM_ROW },
        };
        cell.alignment = {
          vertical: column.imageSlot === undefined ? 'top' : 'bottom',
          horizontal: column.imageSlot === undefined ? (column.key === 'sequence' || column.key === 'stateSequence' ? 'center' : 'left') : 'center',
          wrapText: true,
          shrinkToFit: column.imageSlot !== undefined,
        };
        applyThinBorder(cell);

        if (beginsGroup) {
          cell.border = {
            ...cell.border,
            top: { style: 'medium', color: { argb: GOLD } },
          };
        }

        if (column.imageSlot === undefined) {
          cell.value = normalizeCellValue(sourceRow.cells?.[column.key]);
          continue;
        }

        const image = mergedImages[column.imageSlot];
        if (!image?.url) {
          cell.value = '未生成';
          continue;
        }

        const imageLabel = String(image.label || column.header).trim();
        const preparedImage = await getPreparedImage(image, sourceRow, column.imageSlot);
        if (preparedImage === null) {
          failedImageCount += 1;
          cell.value = `${imageLabel}\n图片读取失败`;
          cell.font = { ...cell.font, color: { argb: 'FF9E3D2E' } };
          continue;
        }

        embeddedImageCount += 1;
        const originalHyperlink = preparedImage.originalRelativePath
          ? `./${preparedImage.originalRelativePath}`
          : '';
        cell.value = originalHyperlink
          ? { text: `${imageLabel}（点击打开原图）`, hyperlink: originalHyperlink, tooltip: '点击打开 ZIP 内的原图' }
          : imageLabel;
        if (originalHyperlink) {
          cell.font = { ...cell.font, color: { argb: 'FF8C6512' }, underline: true };
        }
        cell.note = image.fileName ? `${imageLabel}\n${image.fileName}` : imageLabel;
        worksheet.addImage(preparedImage.imageId, {
          tl: { col: columnIndex + 0.08, row: excelRowNumber - 0.92 },
          ext: { width: type === 'character' ? 92 : 112, height: type === 'character' ? 92 : 74 },
          editAs: 'oneCell',
          ...(originalHyperlink ? {
            hyperlinks: {
              hyperlink: originalHyperlink,
              tooltip: '点击打开 ZIP 内的原图',
            },
          } : {}),
        });
      }
    }

    worksheet.autoFilter = {
      from: { row: 4, column: 1 },
      to: { row: 4 + rows.length, column: lastColumn },
    };
    worksheet.pageSetup.printTitlesRow = '1:4';
    worksheet.headerFooter.oddFooter = '&LMM钰汐 一站式工作流&C第 &P / &N 页&R导出清单';

    const workbookBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const projectName = sanitizeFileName(String(payload.projectName || '项目'));
    const timestamp = formatTimestamp();
    const workbookFileName = `${projectName}_${definition.sheetName}_${timestamp}.xlsx`;
    let fileName = workbookFileName;
    let storedExtension: 'xlsx' | 'zip' = 'xlsx';
    let contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    if (packageOriginals) {
      if (!packageDirectory) {
        throw new Error('完整素材包临时目录创建失败');
      }
      const originalRoot = path.join(packageDirectory, '原图', TYPE_FOLDER_NAMES[type]);
      await fs.promises.mkdir(originalRoot, { recursive: true });
      await fs.promises.writeFile(path.join(packageDirectory, workbookFileName), workbookBuffer);
      const instructions = [
        `${definition.title} - 完整素材包`,
        '',
        `项目：${String(payload.projectName || '未命名项目')}`,
        `制作项：${rows.length} 条`,
        `Excel 缩略图：${embeddedImageCount} 张`,
        `原图文件：${originalImageCount} 张`,
        failedImageCount > 0 ? `未能读取的旧图：${failedImageCount} 张` : '未能读取的旧图：0 张',
        '',
        '使用方法：',
        '1. 请先完整解压 ZIP，不要只单独打开或移动 Excel。',
        `2. 打开“${workbookFileName}”。`,
        '3. 点击 Excel 中的图片缩略图或“点击打开原图”文字，可打开该制作项对应的原图。',
        `4. 原图按“原图/${TYPE_FOLDER_NAMES[type]}/名称/状态”整理，可独立用于后续制作。`,
        '',
        '说明：Excel 内保留压缩缩略图以提高打开速度；原图文件保持导出时读取到的原始清晰度。',
      ].join('\n');
      await fs.promises.writeFile(path.join(packageDirectory, '使用说明.txt'), `${instructions}\n`, 'utf-8');

      fileName = `${projectName}_${definition.sheetName}_完整素材_${timestamp}.zip`;
      storedExtension = 'zip';
      contentType = 'application/zip';
      temporaryArchivePath = path.join(os.tmpdir(), `manfei-asset-export-${randomUUID()}.zip`);
      await createZipArchive(packageDirectory, temporaryArchivePath);
    }

    const writeExportFile = async (destinationPath: string) => {
      if (packageOriginals) {
        if (!temporaryArchivePath) throw new Error('完整素材 ZIP 尚未生成');
        await fs.promises.copyFile(temporaryArchivePath, destinationPath);
        return;
      }
      await fs.promises.writeFile(destinationPath, workbookBuffer);
    };

    console.info(
      `[素材导出] 生成完成 ${fileName}: ${rows.length} 行，${embeddedImageCount} 张缩略图，${originalImageCount} 张原图，${failedImageCount} 张失败`
    );

    if (request.nextUrl.searchParams.get('prepare') === '1') {
      const requestHost = (request.headers.get('host') || '').split(':')[0].replace(/^\[|\]$/g, '');
      const isLocalRequest = ['localhost', '127.0.0.1', '::1'].includes(requestHost);
      if (payload.saveToDownloads && isLocalRequest) {
        const downloadsDirectory = path.join(os.homedir(), 'Downloads');
        await fs.promises.mkdir(downloadsDirectory, { recursive: true });
        const savedPath = getUniqueDownloadPath(downloadsDirectory, fileName);
        await writeExportFile(savedPath);
        return NextResponse.json({
          success: true,
          fileName: path.basename(savedPath),
          workbookFileName,
          packageType: storedExtension,
          savedToDownloads: true,
          savedPath,
          rowCount: rows.length,
          imageCount: embeddedImageCount,
          originalImageCount,
          failedImageCount,
        }, {
          headers: { 'Cache-Control': 'private, no-store' },
        });
      }

      const token = randomUUID();
      const directory = getPreparedExportDirectory(auth.account);
      await fs.promises.mkdir(directory, { recursive: true });
      cleanupPreparedExports(directory);
      await writeExportFile(path.join(directory, `${token}.${storedExtension}`));
      const metadata: PreparedExportMetadata = {
        fileName,
        storedExtension,
        contentType,
        workbookFileName,
        createdAt: Date.now(),
        rowCount: rows.length,
        imageCount: embeddedImageCount,
        originalImageCount,
        failedImageCount,
      };
      await fs.promises.writeFile(
        path.join(directory, `${token}.json`),
        `${JSON.stringify(metadata)}\n`,
        'utf-8'
      );
      return NextResponse.json({
        success: true,
        fileName,
        workbookFileName,
        packageType: storedExtension,
        downloadUrl: `/api/export-asset-list-xlsx?token=${encodeURIComponent(token)}`,
        rowCount: rows.length,
        imageCount: embeddedImageCount,
        originalImageCount,
        failedImageCount,
      }, {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }

    const responseBuffer = packageOriginals && temporaryArchivePath
      ? await fs.promises.readFile(temporaryArchivePath)
      : workbookBuffer;
    return new NextResponse(responseBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Content-Length': String(responseBuffer.length),
        'Cache-Control': 'private, no-store',
        'X-Export-Row-Count': String(rows.length),
        'X-Export-Image-Count': String(embeddedImageCount),
        'X-Export-Original-Image-Count': String(originalImageCount),
        'X-Export-Image-Failed': String(failedImageCount),
      },
    });
  } catch (error) {
    console.error('[素材导出] 生成失败:', error);
    return NextResponse.json({
      success: false,
      error: '生成导出文件失败，请稍后重试',
      details: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  } finally {
    if (packageDirectory) {
      await fs.promises.rm(packageDirectory, { recursive: true, force: true }).catch(error => {
        console.warn('[完整素材 ZIP] 清理临时目录失败:', error);
      });
    }
    if (temporaryArchivePath) {
      await fs.promises.rm(temporaryArchivePath, { force: true }).catch(error => {
        console.warn('[完整素材 ZIP] 清理临时文件失败:', error);
      });
    }
  }
}
