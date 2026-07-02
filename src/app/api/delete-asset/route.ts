import { NextRequest, NextResponse } from 'next/server';
import { S3Storage } from 'coze-coding-dev-sdk';
import fs from 'fs';
import path from 'path';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import { getAccountAssetsPath, isAccountRemoteKey, readAssetFoldersConfig } from '@/lib/account-assets';

function resolveAccountAssetPath(assetsPath: string, folder: string, filename: string): string | null {
  const root = path.resolve(assetsPath);
  const safeFolder = path.basename(folder);
  const safeFilename = path.basename(filename);
  const filePath = path.resolve(root, safeFolder, safeFilename);
  if (!filePath.startsWith(`${root}${path.sep}`)) return null;
  return filePath;
}

export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const { imageKey, imageUrl, folder } = await request.json();
    const assetsPath = getAccountAssetsPath(auth.account);

    // 优先删除本地文件
    if (imageUrl) {
      // 从 URL 中提取 folder 和 filename
      try {
        const url = new URL(imageUrl, 'http://localhost');
        const folderParam = url.searchParams.get('folder') || folder;
        const filename = url.searchParams.get('filename');
        
        if (folderParam && filename) {
          const filePath = resolveAccountAssetPath(assetsPath, folderParam, filename);
          
          if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`已删除本地文件: ${filePath}`);
            return NextResponse.json({
              success: true,
              message: '本地图片删除成功',
            });
          }
        }
      } catch (urlError) {
        console.log('解析 URL 失败:', urlError);
      }
    }

    // 如果提供了 folder 和 filename，直接删除
    if (folder && imageKey) {
      const filePath = resolveAccountAssetPath(assetsPath, folder, imageKey);
      
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`已删除本地文件: ${filePath}`);
        return NextResponse.json({
          success: true,
          message: '本地图片删除成功',
        });
      }
    }

    // 有些旧调用只传本地文件名不传分类；只在当前账号的标准资产分类里查找。
    if (imageKey && !isAccountRemoteKey(auth.account, imageKey)) {
      const folders = readAssetFoldersConfig();
      for (const folderName of Object.values(folders)) {
        const filePath = resolveAccountAssetPath(assetsPath, folderName, imageKey);
        if (filePath && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`已删除当前账号本地文件: ${filePath}`);
          return NextResponse.json({
            success: true,
            message: '本地图片删除成功',
          });
        }
      }
    }

    // 如果是当前账号的 S3 文件，才允许删除。
    if (imageKey && isAccountRemoteKey(auth.account, imageKey)) {
      try {
        const storage = new S3Storage({
          endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
          accessKey: "",
          secretKey: "",
          bucketName: process.env.COZE_BUCKET_NAME,
          region: "cn-beijing",
        });

        const success = await storage.deleteFile({ fileKey: imageKey });

        if (success) {
          return NextResponse.json({
            success: true,
            message: 'S3图片删除成功',
          });
        }
      } catch (s3Error) {
        console.log('S3删除失败:', s3Error);
      }
    }

    return NextResponse.json({
      success: false,
      error: '未找到可删除的文件',
    });
  } catch (error) {
    console.error('图片删除失败:', error);
    return NextResponse.json(
      { error: '图片删除失败' },
      { status: 500 }
    );
  }
}
