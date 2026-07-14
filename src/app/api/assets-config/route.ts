import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import { getAccountAssetsPath, readAssetFoldersConfig, ensureAssetFolders } from '@/lib/account-assets';

// 获取资产配置
export async function GET() {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const folders = readAssetFoldersConfig();
    const assetsPath = getAccountAssetsPath(auth.account);
    const config = {
      assetsPath: '账号独立资产目录',
      rootAssetsPath: '',
      folders,
    };

    // 检查资产文件夹是否存在
    const assetsExist = fs.existsSync(assetsPath);
    const assetStats: Record<string, number> = {};

    for (const [key, folder] of Object.entries(config.folders)) {
      const folderPath = path.join(assetsPath, folder);
      if (fs.existsSync(folderPath)) {
        const files = fs.readdirSync(folderPath).filter(f =>
          fs.statSync(path.join(folderPath, f)).isFile()
        );
        assetStats[key] = files.length;
      } else {
        assetStats[key] = 0;
      }
    }
    
    return NextResponse.json({
      success: true,
      config,
      assetsExist,
      assetStats,
    });
  } catch (error) {
    console.error('获取资产配置失败:', error);
    return NextResponse.json({
      success: false,
      error: '获取资产配置失败',
    }, { status: 500 });
  }
}

// 初始化资产文件夹
export async function PUT() {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const assetsPath = getAccountAssetsPath(auth.account);
    const folders = readAssetFoldersConfig();
    const config = {
      assetsPath: '账号独立资产目录',
      rootAssetsPath: '',
      folders,
    };

    ensureAssetFolders(assetsPath, folders);
    
    return NextResponse.json({
      success: true,
      message: '资产文件夹初始化成功',
      config,
    });
  } catch (error) {
    console.error('初始化资产文件夹失败:', error);
    return NextResponse.json({
      success: false,
      error: '初始化资产文件夹失败',
    }, { status: 500 });
  }
}
