import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { S3Storage } from 'coze-coding-dev-sdk';

/**
 * 清除 S3 和本地资产目录中的所有资产文件
 * 包括：场景图片、人物图片、道具图片、分镜图片、视频文件
 */

const DEFAULT_ASSET_FOLDERS = {
  scenes: '场景图片',
  characters: '人物图片',
  props: '道具图片',
  storyboards: '分镜图片',
  videos: '视频文件',
};

function readLocalAssetsConfig() {
  const configPath = path.join(process.cwd(), 'assets-config.json');
  const fallbackAssetsPath = path.join(process.cwd(), 'assets');
  let assetsPath = fallbackAssetsPath;
  let folders = DEFAULT_ASSET_FOLDERS;

  try {
    if (fs.existsSync(configPath)) {
      const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (typeof rawConfig.assetsPath === 'string' && rawConfig.assetsPath.trim()) {
        assetsPath = path.isAbsolute(rawConfig.assetsPath)
          ? rawConfig.assetsPath
          : path.join(process.cwd(), rawConfig.assetsPath);
      }
      if (rawConfig.folders && typeof rawConfig.folders === 'object') {
        folders = {
          ...DEFAULT_ASSET_FOLDERS,
          ...rawConfig.folders,
        };
      }
    }
  } catch (error) {
    console.warn('读取本地资产配置失败，使用默认 assets 目录:', error);
  }

  return {
    assetsPath: path.resolve(assetsPath),
    folders,
  };
}

function countFilesRecursively(targetPath: string): number {
  if (!fs.existsSync(targetPath)) return 0;
  const stats = fs.statSync(targetPath);
  if (stats.isFile()) return 1;
  if (!stats.isDirectory()) return 0;

  return fs.readdirSync(targetPath).reduce((sum, childName) => (
    sum + countFilesRecursively(path.join(targetPath, childName))
  ), 0);
}

function clearLocalAssetFolders() {
  const { assetsPath, folders } = readLocalAssetsConfig();
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
    localDeleted = clearLocalAssetFolders();
  } catch (localError) {
    console.error('清除本地资产失败:', localError);
    return NextResponse.json({
      success: false,
      error: '清除本地资产失败，请稍后重试',
      details: localError instanceof Error ? localError.message : '未知错误',
    }, { status: 500 });
  }

  try {
    if (process.env.COZE_BUCKET_ENDPOINT_URL && process.env.COZE_BUCKET_NAME) {
      const storage = new S3Storage({
        endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
        accessKey: "",
        secretKey: "",
        bucketName: process.env.COZE_BUCKET_NAME,
        region: "cn-beijing",
      });

      // 要清除的 S3 文件夹前缀
      const prefixesToDelete = [
        'assets/scene/',      // 场景图片
        'assets/character/',  // 人物图片
        'assets/prop/',       // 道具图片
        'storyboards/',       // 分镜图片
        'assets/video/',      // 视频文件
        'assets/videos/',     // 兼容旧的视频文件前缀
      ];

      const deletedByType: Record<string, number> = {};
      let totalDeleted = 0;

      for (const prefix of prefixesToDelete) {
        try {
          // 列出该前缀下的所有文件
          const result = await storage.listFiles({
            prefix,
            maxKeys: 1000,
          });

          if (result.keys && result.keys.length > 0) {
            // 批量删除文件
            for (const key of result.keys) {
              try {
                await storage.deleteFile({ fileKey: key });
                totalDeleted++;
              } catch (deleteError) {
                console.warn(`删除文件失败: ${key}`, deleteError);
              }
            }
            deletedByType[prefix] = result.keys.length;
            console.log(`已删除 ${prefix} 下的 ${result.keys.length} 个文件`);
          } else {
            deletedByType[prefix] = 0;
          }
        } catch (listError) {
          console.warn(`列出 ${prefix} 文件失败:`, listError);
          deletedByType[prefix] = 0;
        }
      }

      s3Deleted = { deletedByType, totalDeleted };
    }
  } catch (s3Error) {
    console.warn('清除 S3 资产失败，已继续保留本地清除结果:', s3Error);
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
