import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import { getAccountAssetsPath, readAssetFoldersConfig, readConfiguredAssetsRoot, ensureAssetFolders } from '@/lib/account-assets';

// 获取资产配置
export async function GET() {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const folders = readAssetFoldersConfig();
    const assetsPath = getAccountAssetsPath(auth.account);
    let config = {
      assetsPath,
      rootAssetsPath: readConfiguredAssetsRoot(),
      folders,
    };

    // 检查资产文件夹是否存在
    const assetsExist = fs.existsSync(config.assetsPath);
    const assetStats: Record<string, number> = {};

    for (const [key, folder] of Object.entries(config.folders)) {
      const folderPath = path.join(config.assetsPath, folder);
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

// 设置资产文件夹路径
export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const { assetsPath } = await request.json();
    
    if (!assetsPath) {
      return NextResponse.json({
        success: false,
        error: '请提供资产文件夹路径',
      }, { status: 400 });
    }
    
    const rootAssetsPath = path.isAbsolute(assetsPath)
      ? assetsPath
      : path.join(process.cwd(), assetsPath);

    // 创建配置
    const config = {
      assetsPath: rootAssetsPath,
      folders: {
        scenes: '场景图片',
        characters: '人物图片',
        props: '道具图片',
        storyboards: '分镜图片',
        videos: '视频文件',
      }
    };
    
    // 保存配置
    const configPath = path.join(process.cwd(), 'assets-config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    const accountAssetsPath = getAccountAssetsPath(auth.account);
    ensureAssetFolders(accountAssetsPath, config.folders);
    
    return NextResponse.json({
      success: true,
      message: '资产文件夹设置成功',
      config: {
        assetsPath: accountAssetsPath,
        rootAssetsPath: readConfiguredAssetsRoot(),
        folders: config.folders,
      },
    });
  } catch (error) {
    console.error('设置资产文件夹失败:', error);
    return NextResponse.json({
      success: false,
      error: '设置资产文件夹失败，请检查路径是否有写入权限',
    }, { status: 500 });
  }
}

// 初始化资产文件夹
export async function PUT(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    let config = {
      assetsPath: getAccountAssetsPath(auth.account),
      rootAssetsPath: readConfiguredAssetsRoot(),
      folders: readAssetFoldersConfig(),
    };

    ensureAssetFolders(config.assetsPath, config.folders);
    
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
