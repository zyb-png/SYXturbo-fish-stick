import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import { getAccountAssetsPath, readAssetFoldersConfig } from '@/lib/account-assets';
import type { PublicAccount } from '@/lib/account-store';

/**
 * 清除当前账号本地资产目录中的资产文件。
 * S3 旧前缀是全局共享的，不能在普通账号清除数据时批量删除。
 */

function countFilesRecursively(targetPath: string): number {
  if (!fs.existsSync(targetPath)) return 0;
  const stats = fs.statSync(targetPath);
  if (stats.isFile()) return 1;
  if (!stats.isDirectory()) return 0;

  return fs.readdirSync(targetPath).reduce((sum, childName) => (
    sum + countFilesRecursively(path.join(targetPath, childName))
  ), 0);
}

function clearLocalAssetFolders(account: PublicAccount) {
  const assetsPath = path.resolve(getAccountAssetsPath(account));
  const folders = readAssetFoldersConfig();
  const deletedByFolder: Record<string, number> = {};
  let totalDeleted = 0;

  for (const [folderKey, folderName] of Object.entries(folders)) {
    const folderPath = path.resolve(assetsPath, folderName);

    // 只允许清理 assetsPath 下的类别文件夹，避免配置异常时误删其他目录。
    if (folderPath === assetsPath || !folderPath.startsWith(`${assetsPath}${path.sep}`)) {
      console.warn(`跳过不安全的资产目录: ${folderPath}`);
      deletedByFolder[folderKey] = 0;
      continue;
    }

    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
      deletedByFolder[folderKey] = 0;
      continue;
    }

    let folderDeleted = 0;
    for (const childName of fs.readdirSync(folderPath)) {
      const childPath = path.join(folderPath, childName);
      folderDeleted += countFilesRecursively(childPath);
      fs.rmSync(childPath, { recursive: true, force: true });
    }

    deletedByFolder[folderKey] = folderDeleted;
    totalDeleted += folderDeleted;
  }

  return {
    assetsPath,
    deletedByFolder,
    totalDeleted,
  };
}

export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  let localDeleted = {
    assetsPath: '',
    deletedByFolder: {} as Record<string, number>,
    totalDeleted: 0,
  };
  let s3Deleted = {
    deletedByType: {} as Record<string, number>,
    totalDeleted: 0,
  };

  try {
    localDeleted = clearLocalAssetFolders(auth.account);
  } catch (localError) {
    console.error('清除本地资产失败:', localError);
    return NextResponse.json({
      success: false,
      error: '清除本地资产失败，请稍后重试',
      details: localError instanceof Error ? localError.message : '未知错误',
    }, { status: 500 });
  }

  try {
    console.log(`资产清除完成，本地删除 ${localDeleted.totalDeleted} 个文件，S3 删除 ${s3Deleted.totalDeleted} 个文件`);

    return NextResponse.json({
      success: true,
      message: `已清除 ${localDeleted.totalDeleted + s3Deleted.totalDeleted} 个资产文件`,
      local: localDeleted,
      s3: s3Deleted,
      deletedByType: s3Deleted.deletedByType,
      totalDeleted: localDeleted.totalDeleted + s3Deleted.totalDeleted,
    });
  } catch (error) {
    console.error('清除资产失败:', error);
    return NextResponse.json({
      success: false,
      error: '清除资产失败，请稍后重试',
    }, { status: 500 });
  }
}
