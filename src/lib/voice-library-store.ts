import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import type { PublicAccount } from './account-store';
import { getAccountAssetsPath } from './account-assets';
import type { VoiceLibraryItem } from './character-voice';

export const MAX_CUSTOM_VOICE_BYTES = 20 * 1024 * 1024;

const BUILTIN_ROOT = path.join(process.cwd(), 'public', 'voice-library');
const CUSTOM_FOLDER_NAME = '音色库';
const CUSTOM_AUDIO_FOLDER_NAME = '用户上传';
const CUSTOM_METADATA_FILE_NAME = 'library.json';
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']);

const CONTENT_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
};

const CATEGORY_ORDER = [
  '女幼年', '男幼年',
  '女青年', '男青年',
  '女中年', '男中年',
  '女老年', '男老年',
  '系统', '第三方', '其他',
];

interface StoredCustomVoice extends VoiceLibraryItem {
  source: 'custom';
  relativePath: string;
}

interface CustomVoiceMetadata {
  version: 1;
  updatedAt: string;
  voices: StoredCustomVoice[];
}

interface SaveCustomVoiceInput {
  name: string;
  language: string;
  category: string;
  gender: VoiceLibraryItem['gender'];
  ageRange: string;
  description?: string;
  originalFileName: string;
  data: Buffer;
}

let builtinCache: VoiceLibraryItem[] | null = null;
let customStoreQueue = Promise.resolve();

function runCustomStoreExclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = customStoreQueue.then(task, task);
  customStoreQueue = run.then(() => undefined, () => undefined);
  return run;
}

function customRoot(account: Pick<PublicAccount, 'id'>): string {
  return path.join(getAccountAssetsPath(account), CUSTOM_FOLDER_NAME);
}

function customMetadataPath(account: Pick<PublicAccount, 'id'>): string {
  return path.join(customRoot(account), CUSTOM_METADATA_FILE_NAME);
}

function safeLabel(value: unknown, fallback: string, maxLength = 60): string {
  const normalized = String(value || '')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return normalized || fallback;
}

function safePathSegment(value: unknown, fallback: string, maxLength = 60): string {
  return safeLabel(value, fallback, maxLength)
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim() || fallback;
}

function safeFileStem(value: unknown): string {
  return safePathSegment(value, 'voice', 80)
    .replace(/[\s.]+$/g, '')
    .replace(/\s+/g, '_');
}

function isAudioExtension(extension: string): boolean {
  return AUDIO_EXTENSIONS.has(extension.toLowerCase());
}

function inferGender(category: string): VoiceLibraryItem['gender'] {
  if (category.startsWith('女')) return '女';
  if (category.startsWith('男')) return '男';
  return '中性';
}

function inferAgeRange(category: string): string {
  if (/幼年/.test(category)) return '幼年/童年';
  if (/青年/.test(category)) return '青年';
  if (/中年/.test(category)) return '中年';
  if (/老年/.test(category)) return '老年';
  return '不限';
}

function displayNameFromFile(fileName: string): string {
  return path.basename(fileName, path.extname(fileName))
    .replace(/\.(?:mp3|wav|m4a|aac|ogg|flac)$/i, '')
    .trim() || '未命名音色';
}

function encodePublicPath(relativePath: string): string {
  return `/voice-library/${relativePath.split(path.sep).map(encodeURIComponent).join('/')}`;
}

function compareVoices(a: VoiceLibraryItem, b: VoiceLibraryItem): number {
  const languageA = a.language === '中文' ? 0 : a.language === '英文' ? 1 : 2;
  const languageB = b.language === '中文' ? 0 : b.language === '英文' ? 1 : 2;
  if (languageA !== languageB) return languageA - languageB;
  const categoryA = CATEGORY_ORDER.indexOf(a.category || '其他');
  const categoryB = CATEGORY_ORDER.indexOf(b.category || '其他');
  if (categoryA !== categoryB) {
    return (categoryA < 0 ? 999 : categoryA) - (categoryB < 0 ? 999 : categoryB);
  }
  return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
}

async function walkAudioFiles(root: string, current = root): Promise<string[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(current, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === '.DS_Store' || entry.name.startsWith('._')) continue;
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkAudioFiles(root, entryPath));
    } else if (entry.isFile() && isAudioExtension(path.extname(entry.name))) {
      files.push(path.relative(root, entryPath));
    }
  }
  return files;
}

export async function listBuiltinVoices(): Promise<VoiceLibraryItem[]> {
  if (builtinCache) return builtinCache;

  const relativeFiles = await walkAudioFiles(BUILTIN_ROOT);
  const voices = await Promise.all(relativeFiles.map(async relativePath => {
    const segments = relativePath.split(path.sep);
    const language = safeLabel(segments[0], '其他');
    const category = safeLabel(segments[1], '其他');
    const fileName = segments.at(-1) || relativePath;
    const absolutePath = path.join(BUILTIN_ROOT, relativePath);
    const stat = await fsp.stat(absolutePath);
    const digest = createHash('sha256').update(relativePath).digest('hex').slice(0, 20);

    return {
      id: `builtin-${digest}`,
      name: displayNameFromFile(fileName),
      gender: inferGender(category),
      ageRange: inferAgeRange(category),
      description: `${language} · ${category}参考音频，可先试听，再绑定给人物对应时期或状态。`,
      tags: [language, category, path.extname(fileName).slice(1).toUpperCase()],
      source: 'builtin' as const,
      language,
      category,
      fileName,
      fileSize: stat.size,
      referenceAudioUrl: encodePublicPath(relativePath),
    } satisfies VoiceLibraryItem;
  }));

  builtinCache = voices.sort(compareVoices);
  return builtinCache;
}

function normalizeStoredVoice(value: unknown): StoredCustomVoice | null {
  if (!value || typeof value !== 'object') return null;
  const voice = value as Partial<StoredCustomVoice>;
  if (
    typeof voice.id !== 'string' ||
    typeof voice.name !== 'string' ||
    typeof voice.relativePath !== 'string' ||
    voice.source !== 'custom'
  ) return null;
  if (path.isAbsolute(voice.relativePath) || voice.relativePath.split(/[\\/]/).includes('..')) return null;

  return {
    id: voice.id,
    name: voice.name,
    gender: voice.gender === '女' || voice.gender === '男' ? voice.gender : '中性',
    ageRange: safeLabel(voice.ageRange, '不限'),
    description: safeLabel(voice.description, '用户上传的参考音色。', 300),
    tags: Array.isArray(voice.tags) ? voice.tags.map(tag => safeLabel(tag, '')).filter(Boolean).slice(0, 8) : [],
    source: 'custom',
    language: safeLabel(voice.language, '其他'),
    category: safeLabel(voice.category, '其他'),
    fileName: safeLabel(voice.fileName, path.basename(voice.relativePath), 120),
    fileSize: Number.isFinite(voice.fileSize) ? Math.max(0, Number(voice.fileSize)) : undefined,
    createdAt: typeof voice.createdAt === 'string' ? voice.createdAt : undefined,
    providerVoiceId: typeof voice.providerVoiceId === 'string' ? voice.providerVoiceId : undefined,
    referenceAudioUrl: `/api/voice-library/audio?id=${encodeURIComponent(voice.id)}`,
    relativePath: voice.relativePath,
  };
}

async function readCustomMetadata(account: Pick<PublicAccount, 'id'>): Promise<CustomVoiceMetadata> {
  try {
    const parsed = JSON.parse(await fsp.readFile(customMetadataPath(account), 'utf-8')) as Partial<CustomVoiceMetadata>;
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      voices: Array.isArray(parsed.voices)
        ? parsed.voices.map(normalizeStoredVoice).filter((voice): voice is StoredCustomVoice => Boolean(voice))
        : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[音色库] 读取账号音色元数据失败:', error);
    }
    return { version: 1, updatedAt: new Date().toISOString(), voices: [] };
  }
}

async function writeCustomMetadata(
  account: Pick<PublicAccount, 'id'>,
  metadata: CustomVoiceMetadata,
): Promise<void> {
  const metadataPath = customMetadataPath(account);
  await fsp.mkdir(path.dirname(metadataPath), { recursive: true });
  const nextMetadata = { ...metadata, version: 1 as const, updatedAt: new Date().toISOString() };
  const temporaryPath = `${metadataPath}.${randomUUID()}.tmp`;
  await fsp.writeFile(temporaryPath, JSON.stringify(nextMetadata, null, 2), 'utf-8');
  await fsp.rename(temporaryPath, metadataPath);
}

function publicCustomVoice(voice: StoredCustomVoice): VoiceLibraryItem {
  const { relativePath, ...publicVoice } = voice;
  void relativePath;
  return publicVoice;
}

export async function listCustomVoices(account: Pick<PublicAccount, 'id'>): Promise<VoiceLibraryItem[]> {
  const metadata = await readCustomMetadata(account);
  return metadata.voices.map(publicCustomVoice).sort(compareVoices);
}

export async function listAccountVoiceLibrary(
  account: Pick<PublicAccount, 'id'>,
): Promise<VoiceLibraryItem[]> {
  const [builtin, custom] = await Promise.all([listBuiltinVoices(), listCustomVoices(account)]);
  return [...builtin, ...custom];
}

export async function saveCustomVoice(
  account: Pick<PublicAccount, 'id'>,
  input: SaveCustomVoiceInput,
): Promise<VoiceLibraryItem> {
  return runCustomStoreExclusive(async () => {
    if (input.data.length === 0) throw new Error('音频文件为空');
    if (input.data.length > MAX_CUSTOM_VOICE_BYTES) throw new Error('单个音频不能超过 20MB');

    const extension = path.extname(input.originalFileName).toLowerCase();
    if (!isAudioExtension(extension)) throw new Error('仅支持 MP3、WAV、M4A、AAC、OGG、FLAC 音频');

    const language = safePathSegment(input.language, '其他');
    const category = safePathSegment(input.category, '其他');
    const id = `custom-${randomUUID()}`;
    const fileName = `${Date.now()}-${id.slice(-8)}-${safeFileStem(input.name)}${extension}`;
    const relativePath = path.join(CUSTOM_AUDIO_FOLDER_NAME, language, category, fileName);
    const root = path.resolve(customRoot(account));
    const absolutePath = path.resolve(root, relativePath);
    if (!absolutePath.startsWith(`${root}${path.sep}`)) throw new Error('无效的音频保存路径');

    await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
    await fsp.writeFile(absolutePath, input.data);

    const now = new Date().toISOString();
    const voice: StoredCustomVoice = {
      id,
      name: safeLabel(input.name, displayNameFromFile(input.originalFileName), 80),
      gender: input.gender,
      ageRange: safeLabel(input.ageRange, inferAgeRange(category)),
      description: safeLabel(input.description, `用户上传的${language} · ${category}参考音色。`, 300),
      tags: [language, category, '用户上传'],
      source: 'custom',
      language,
      category,
      fileName: input.originalFileName,
      fileSize: input.data.length,
      createdAt: now,
      referenceAudioUrl: `/api/voice-library/audio?id=${encodeURIComponent(id)}`,
      relativePath,
    };

    const metadata = await readCustomMetadata(account);
    metadata.voices.push(voice);
    try {
      await writeCustomMetadata(account, metadata);
    } catch (error) {
      await fsp.rm(absolutePath, { force: true });
      throw error;
    }
    return publicCustomVoice(voice);
  });
}

export async function deleteCustomVoice(
  account: Pick<PublicAccount, 'id'>,
  id: string,
): Promise<boolean> {
  return runCustomStoreExclusive(async () => {
    const metadata = await readCustomMetadata(account);
    const voice = metadata.voices.find(item => item.id === id);
    if (!voice) return false;

    const root = path.resolve(customRoot(account));
    const absolutePath = path.resolve(root, voice.relativePath);
    if (!absolutePath.startsWith(`${root}${path.sep}`)) throw new Error('无效的音频文件路径');

    metadata.voices = metadata.voices.filter(item => item.id !== id);
    await writeCustomMetadata(account, metadata);
    await fsp.rm(absolutePath, { force: true });
    return true;
  });
}

export async function readCustomVoiceAudio(
  account: Pick<PublicAccount, 'id'>,
  id: string,
): Promise<{ data: Buffer; contentType: string; fileName: string } | null> {
  const metadata = await readCustomMetadata(account);
  const voice = metadata.voices.find(item => item.id === id);
  if (!voice) return null;

  const root = path.resolve(customRoot(account));
  const absolutePath = path.resolve(root, voice.relativePath);
  if (!absolutePath.startsWith(`${root}${path.sep}`)) return null;

  try {
    const data = await fsp.readFile(absolutePath);
    return {
      data,
      contentType: CONTENT_TYPES[path.extname(absolutePath).toLowerCase()] || 'application/octet-stream',
      fileName: voice.fileName || path.basename(absolutePath),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
