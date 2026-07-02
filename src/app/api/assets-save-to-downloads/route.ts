import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import { getAccountAssetsPath } from '@/lib/account-assets';
import type { PublicAccount } from '@/lib/account-store';

export const runtime = 'nodejs';

const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.mov']);

function safeName(value: unknown, fallback: string) {
  const text = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return text.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 120);
}

function getUniqueFilePath(parentDir: string, fileName: string) {
  const ext = path.extname(fileName);
  const baseName = path.basename(fileName, ext);
  let targetPath = path.join(parentDir, fileName);
  let suffix = 2;

  while (fs.existsSync(targetPath)) {
    targetPath = path.join(parentDir, `${baseName}_${suffix}${ext}`);
    suffix += 1;
  }

  return targetPath;
}

function getContentExtension(contentType: string) {
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return '.jpg';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('gif')) return '.gif';
  if (contentType.includes('mp4')) return '.mp4';
  if (contentType.includes('webm')) return '.webm';
  return '.png';
}

function getContentTypeFromExtension(ext: string) {
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  return 'image/png';
}

function attachmentResponse(buffer: Buffer, fileName: string, contentType: string) {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Content-Length': buffer.length.toString(),
      'Cache-Control': 'private, no-store',
    },
  });
}

function resolveLocalAssetPath(imageUrl: string, account: PublicAccount) {
  const parsed = new URL(imageUrl, 'http://localhost');
  if (parsed.pathname !== '/api/assets-view') return null;

  const folder = parsed.searchParams.get('folder');
  const filename = parsed.searchParams.get('filename');
  if (!folder || !filename) return null;

  const safeFolder = folder.replace(/\.\./g, '');
  const safeFilename = filename.replace(/\.\./g, '');
  const sourcePath = path.join(getAccountAssetsPath(account), safeFolder, safeFilename);
  const ext = path.extname(safeFilename).toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error('不支持的文件类型');
  }

  return { sourcePath, fileName: safeFilename };
}

export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const { imageUrl, fileName, saveToDownloads = true } = await request.json();
    if (typeof imageUrl !== 'string' || !imageUrl.trim()) {
      return NextResponse.json({ success: false, error: '缺少图片地址' }, { status: 400 });
    }

    const downloadsDir = path.join(os.homedir(), 'Downloads', 'AI故事分镜视频生成器', '单图下载');
    fs.mkdirSync(downloadsDir, { recursive: true });

    const localAsset = resolveLocalAssetPath(imageUrl, auth.account);
    if (localAsset) {
      if (!fs.existsSync(localAsset.sourcePath)) {
        return NextResponse.json({ success: false, error: '图片文件不存在' }, { status: 404 });
      }

      const targetName = `${safeName(fileName, path.basename(localAsset.fileName, path.extname(localAsset.fileName)))}${path.extname(localAsset.fileName) || '.png'}`;
      const buffer = fs.readFileSync(localAsset.sourcePath);
      if (!saveToDownloads) {
        return attachmentResponse(buffer, targetName, getContentTypeFromExtension(path.extname(localAsset.fileName).toLowerCase()));
      }

      const targetPath = getUniqueFilePath(downloadsDir, targetName);
      fs.copyFileSync(localAsset.sourcePath, targetPath);
      return NextResponse.json({ success: true, targetPath, filename: path.basename(targetPath) });
    }

    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`下载图片失败: ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const ext = getContentExtension(contentType);
    const buffer = Buffer.from(await response.arrayBuffer());
    const targetName = `${safeName(fileName, 'download')}${ext}`;
    if (!saveToDownloads) {
      return attachmentResponse(buffer, targetName, contentType);
    }

    const targetPath = getUniqueFilePath(downloadsDir, targetName);
    fs.writeFileSync(targetPath, buffer);

    return NextResponse.json({ success: true, targetPath, filename: path.basename(targetPath) });
  } catch (error: any) {
    console.error('保存单张资产失败:', error);
    return NextResponse.json({
      success: false,
      error: error?.message || '保存单张资产失败',
    }, { status: 500 });
  }
}
