import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { S3Storage } from 'coze-coding-dev-sdk';
import { requireUserLoginResponse } from '@/lib/auth-guard';

// 默认资产文件夹路径（沙箱环境）
// 注意：资产保存在服务器端，用户可通过导出功能下载到本地
const DEFAULT_ASSETS_PATH = path.join(process.cwd(), 'assets');

// 资产类型
type AssetType = 'scenes' | 'characters' | 'props' | 'storyboards' | 'videos';

// S3 文件夹前缀映射
const S3_PREFIX_MAP: Record<string, string> = {
  scenes: 'assets/scene/',
  characters: 'assets/character/',
  props: 'assets/prop/',
  storyboards: 'storyboards/',  // 分镜图片保存在 storyboards/ 目录下
  videos: 'assets/video/',
};

// 从 S3 获取资产数量
async function getAssetStatsFromS3(): Promise<Record<string, number> | null> {
  try {
    const storage = new S3Storage({
      endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
      accessKey: "",
      secretKey: "",
      bucketName: process.env.COZE_BUCKET_NAME,
      region: "cn-beijing",
    });

    const stats: Record<string, number> = {};

    for (const [key, prefix] of Object.entries(S3_PREFIX_MAP)) {
      try {
        const result = await storage.listFiles({ 
          prefix, 
          maxKeys: 1000 
        });
        
        // 过滤图片和视频文件
        const validFiles = result.keys.filter(k => 
          /\.(png|jpg|jpeg|gif|webp|mp4|webm)$/i.test(k)
        );
        stats[key] = validFiles.length;
      } catch (e) {
        stats[key] = 0;
      }
    }

    return stats;
  } catch (error) {
    console.error('从 S3 获取资产统计失败:', error);
    return null;
  }
}

// 获取资产配置
export async function GET(request: NextRequest) {
  try {
    const configPath = path.join(process.cwd(), 'assets-config.json');
    
    let config = {
      assetsPath: DEFAULT_ASSETS_PATH,
      folders: {
        scenes: '场景图片',
        characters: '人物图片', 
        props: '道具图片',
        storyboards: '分镜图片',
        videos: '视频文件',
      }
    };
    
    // 尝试读取已有配置
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf-8');
      config = { ...config, ...JSON.parse(configData) };
    }
    
    // 检查资产文件夹是否存在
    const assetsExist = fs.existsSync(config.assetsPath);
    let assetStats: Record<string, number> | null = null;
    
    // 首先尝试从 S3 获取资产统计
    assetStats = await getAssetStatsFromS3();
    
    // 如果 S3 没有数据，尝试从本地文件系统获取
    if (!assetStats || Object.values(assetStats).every(count => count === 0)) {
      if (assetsExist) {
        // 统计各类资产数量
        assetStats = {};
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
      } else {
        assetStats = {
          scenes: 0,
          characters: 0,
          props: 0,
          storyboards: 0,
          videos: 0,
        };
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
    
    // 创建配置
    const config = {
      assetsPath,
      folders: {
        scenes: '场景图片',
        characters: '人物图片',
        props: '道具图片',
        storyboards: '分镜图片',
        videos: '视频文件',
      }
    };
    
    // 创建资产文件夹结构
    for (const folder of Object.values(config.folders)) {
      const folderPath = path.join(assetsPath, folder);
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
      }
    }
    
    // 保存配置
    const configPath = path.join(process.cwd(), 'assets-config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    
    return NextResponse.json({
      success: true,
      message: '资产文件夹设置成功',
      config,
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
  try {
    const configPath = path.join(process.cwd(), 'assets-config.json');
    
    let config = {
      assetsPath: DEFAULT_ASSETS_PATH,
      folders: {
        scenes: '场景图片',
        characters: '人物图片',
        props: '道具图片',
        storyboards: '分镜图片',
        videos: '视频文件',
      }
    };
    
    // 尝试读取已有配置
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf-8');
      config = { ...config, ...JSON.parse(configData) };
    }
    
    // 创建文件夹结构
    for (const folder of Object.values(config.folders)) {
      const folderPath = path.join(config.assetsPath, folder);
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
      }
    }
    
    // 保存配置
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    
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
