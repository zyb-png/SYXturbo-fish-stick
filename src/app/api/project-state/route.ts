import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { requireUserLoginResponse } from '@/lib/auth-guard';

type StateValues = Record<string, string>;

interface StateFile {
  version: number;
  updatedAt: string;
  values: StateValues;
}

const STATE_DIR_NAME = 'project-state';
const STATE_FILE_NAME = 'storyboard_state.json';
const PROTECTED_NON_EMPTY_KEYS = new Set([
  'storyboard_file_content',
  'storyboard_scenes_data',
  'storyboard_characters_data',
  'storyboard_props_data',
  'storyboard_outline',
  'storyboard_outline_batch_info',
  'storyboard_scene_batch_info',
  'storyboard_character_batch_info',
  'storyboard_prop_batch_info',
  'storyboard_chapter_storyboards',
  'storyboard_asset_images',
]);

let writeQueue = Promise.resolve();

function isAllowedKey(key: unknown): key is string {
  return (
    typeof key === 'string' &&
    key.startsWith('storyboard_') &&
    key.length <= 160 &&
    /^[a-zA-Z0-9_-]+$/.test(key)
  );
}

function resolveAssetsPath() {
  const fallback = path.join(process.cwd(), 'assets');
  const configPath = path.join(process.cwd(), 'assets-config.json');

  try {
    if (!fs.existsSync(configPath)) return fallback;

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const configuredPath = typeof config.assetsPath === 'string' && config.assetsPath.trim()
      ? config.assetsPath.trim()
      : fallback;

    return path.isAbsolute(configuredPath)
      ? configuredPath
      : path.join(process.cwd(), configuredPath);
  } catch (error) {
    console.warn('[项目状态] 读取资产配置失败，使用默认 assets 目录:', error);
    return fallback;
  }
}

function getStatePath() {
  const stateDir = path.join(resolveAssetsPath(), STATE_DIR_NAME);
  return {
    stateDir,
    stateFile: path.join(stateDir, STATE_FILE_NAME),
  };
}

function isRawEmptyValue(value: string) {
  const trimmed = value.trim();
  return trimmed === '' || trimmed === 'null' || trimmed === '{}' || trimmed === '[]';
}

function hasExistingNonEmptyValue(value: string | undefined) {
  return typeof value === 'string' && !isRawEmptyValue(value) && value.length > 10;
}

async function readStateFile(): Promise<StateFile> {
  const { stateFile } = getStatePath();

  try {
    const raw = await fsp.readFile(stateFile, 'utf-8');
    const parsed = JSON.parse(raw);
    const values = parsed?.values && typeof parsed.values === 'object'
      ? parsed.values
      : parsed;

    const sanitizedValues = Object.entries(values || {}).reduce<StateValues>((acc, [key, value]) => {
      if (isAllowedKey(key) && typeof value === 'string') {
        acc[key] = value;
      }
      return acc;
    }, {});

    return {
      version: 1,
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : '',
      values: sanitizedValues,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      console.warn('[项目状态] 读取本地状态备份失败，将创建新备份:', error);
    }

    return {
      version: 1,
      updatedAt: '',
      values: {},
    };
  }
}

async function writeStateFile(values: StateValues) {
  const { stateDir, stateFile } = getStatePath();
  const tempFile = `${stateFile}.${process.pid}.tmp`;
  await fsp.mkdir(stateDir, { recursive: true });

  try {
    await fsp.writeFile(
      tempFile,
      JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        values,
      }, null, 2),
      'utf-8'
    );
    await fsp.rename(tempFile, stateFile);
  } finally {
    await fsp.unlink(tempFile).catch(() => undefined);
  }
}

function queueStateUpdate(update: (values: StateValues) => StateValues | void) {
  const run = writeQueue.then(async () => {
    const stateFile = await readStateFile();
    const nextValues = { ...stateFile.values };
    const updateResult = update(nextValues);
    await writeStateFile(updateResult || nextValues);
  });

  writeQueue = run.catch(() => undefined);
  return run;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');
    const stateFile = await readStateFile();

    if (key) {
      if (!isAllowedKey(key)) {
        return NextResponse.json({
          success: false,
          error: '无效的状态 key',
        }, { status: 400 });
      }

      const value = stateFile.values[key] ?? null;
      return NextResponse.json({
        success: true,
        key,
        value,
        exists: value !== null,
        updatedAt: stateFile.updatedAt,
      });
    }

    return NextResponse.json({
      success: true,
      state: stateFile.values,
      count: Object.keys(stateFile.values).length,
      updatedAt: stateFile.updatedAt,
    });
  } catch (error) {
    console.error('[项目状态] 读取失败:', error);
    return NextResponse.json({
      success: false,
      error: '读取项目状态失败',
      details: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const body = await request.json();

    if (body?.state && typeof body.state === 'object') {
      const incomingValues = Object.entries(body.state).reduce<StateValues>((acc, [key, value]) => {
        if (isAllowedKey(key) && typeof value === 'string') {
          acc[key] = value;
        }
        return acc;
      }, {});

      await queueStateUpdate((values) => ({
        ...values,
        ...Object.fromEntries(
          Object.entries(incomingValues).filter(([key, value]) => {
            if (
              PROTECTED_NON_EMPTY_KEYS.has(key) &&
              isRawEmptyValue(value) &&
              hasExistingNonEmptyValue(values[key])
            ) {
              console.warn(`[项目状态] 跳过空值覆盖受保护数据: ${key}`);
              return false;
            }
            return true;
          })
        ),
      }));

      return NextResponse.json({
        success: true,
        count: Object.keys(incomingValues).length,
      });
    }

    const { key, value } = body || {};
    if (!isAllowedKey(key)) {
      return NextResponse.json({
        success: false,
        error: '无效的状态 key',
      }, { status: 400 });
    }

    if (typeof value !== 'string') {
      return NextResponse.json({
        success: false,
        error: '状态值必须是字符串',
      }, { status: 400 });
    }

    await queueStateUpdate((values) => {
      if (
        PROTECTED_NON_EMPTY_KEYS.has(key) &&
        isRawEmptyValue(value) &&
        hasExistingNonEmptyValue(values[key])
      ) {
        console.warn(`[项目状态] 跳过空值覆盖受保护数据: ${key}`);
        return;
      }
      values[key] = value;
    });

    return NextResponse.json({
      success: true,
      key,
      size: Buffer.byteLength(value, 'utf-8'),
    });
  } catch (error) {
    console.error('[项目状态] 保存失败:', error);
    return NextResponse.json({
      success: false,
      error: '保存项目状态失败',
      details: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (key) {
      if (!isAllowedKey(key)) {
        return NextResponse.json({
          success: false,
          error: '无效的状态 key',
        }, { status: 400 });
      }

      await queueStateUpdate((values) => {
        delete values[key];
      });

      return NextResponse.json({
        success: true,
        key,
        deleted: true,
      });
    }

    const { stateFile } = getStatePath();
    await fsp.rm(stateFile, { force: true });

    return NextResponse.json({
      success: true,
      deleted: true,
    });
  } catch (error) {
    console.error('[项目状态] 清除失败:', error);
    return NextResponse.json({
      success: false,
      error: '清除项目状态失败',
      details: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}
