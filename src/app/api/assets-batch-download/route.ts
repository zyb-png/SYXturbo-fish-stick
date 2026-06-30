import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { requireUserLoginResponse } from '@/lib/auth-guard';

export const runtime = 'nodejs';

const FOLDER_MAP: Record<string, string> = {
  scenes: '场景图片',
  characters: '人物图片',
  props: '道具图片',
  storyboards: '分镜图片',
  videos: '视频文件',
};

const MEDIA_FILE_PATTERN = /\.(png|jpe?g|gif|webp|mp4|webm|mov)$/i;

function readAssetsPath() {
  const configPath = path.join(process.cwd(), 'assets-config.json');
  let assetsPath = path.join(process.cwd(), 'assets');

  try {
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configData);
      if (typeof config.assetsPath === 'string' && config.assetsPath.trim()) {
        assetsPath = path.isAbsolute(config.assetsPath)
          ? config.assetsPath
          : path.join(process.cwd(), config.assetsPath);
      }
    }
  } catch (error) {
    console.warn('读取资产配置失败，使用默认 assets 目录:', error);
  }

  return assetsPath;
}

function getUniqueFolderPath(parentDir: string, folderName: string) {
  let targetPath = path.join(parentDir, folderName);
  let suffix = 2;

  while (fs.existsSync(targetPath)) {
    targetPath = path.join(parentDir, `${folderName}_${suffix}`);
    suffix += 1;
  }

  return targetPath;
}

function formatTimestamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join('-') + '_' + [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('-');
}

export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const { folderKey } = await request.json();
    const folderName = FOLDER_MAP[folderKey as string];

    if (!folderName) {
      return NextResponse.json({
        success: false,
        error: '未知资产类别',
      }, { status: 400 });
    }

    const assetsPath = readAssetsPath();
    const sourceFolder = path.join(assetsPath, folderName);

    if (!fs.existsSync(sourceFolder)) {
      return NextResponse.json({
        success: false,
        error: '资产文件夹不存在',
      }, { status: 404 });
    }

    const files = fs.readdirSync(sourceFolder)
      .filter((fileName) => MEDIA_FILE_PATTERN.test(fileName))
      .filter((fileName) => fs.statSync(path.join(sourceFolder, fileName)).isFile());

    if (files.length === 0) {
      return NextResponse.json({
        success: false,
        error: '该类别暂无可保存的文件',
      }, { status: 404 });
    }

    const downloadsRoot = path.join(os.homedir(), 'Downloads', 'AI故事分镜视频生成器');
    fs.mkdirSync(downloadsRoot, { recursive: true });

    const targetFolder = getUniqueFolderPath(downloadsRoot, `${folderName}_${formatTimestamp()}`);
    fs.mkdirSync(targetFolder, { recursive: true });

    let copiedCount = 0;
    let totalBytes = 0;

    for (const fileName of files) {
      const sourcePath = path.join(sourceFolder, fileName);
      const targetPath = path.join(targetFolder, fileName);
      fs.copyFileSync(sourcePath, targetPath);
      const stats = fs.statSync(targetPath);
      copiedCount += 1;
      totalBytes += stats.size;
    }

    return NextResponse.json({
      success: true,
      folderKey,
      folderName,
      copiedCount,
      totalBytes,
      targetPath: targetFolder,
    });
  } catch (error: any) {
    console.error('批量保存资产失败:', error);
    return NextResponse.json({
      success: false,
      error: '批量保存资产失败',
      details: error?.message || '未知错误',
    }, { status: 500 });
  }
}
