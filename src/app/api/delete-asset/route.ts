import { NextRequest, NextResponse } from 'next/server';
import { S3Storage, HeaderUtils } from 'coze-coding-dev-sdk';
import fs from 'fs';
import path from 'path';
import { requireUserLoginResponse } from '@/lib/auth-guard';

export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const { imageKey, imageUrl, folder } = await request.json();

    // 读取配置
    const configPath = path.join(process.cwd(), 'assets-config.json');
    let assetsPath = path.join(process.cwd(), 'assets');
    
    try {
      if (fs.existsSync(configPath)) {
        const configData = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(configData);
        assetsPath = config.assetsPath || assetsPath;
      }
    } catch (e) {
      console.log('读取资产配置失败，使用默认路径');
    }

    // 优先删除本地文件
    if (imageUrl) {
      // 从 URL 中提取 folder 和 filename
      try {
        const url = new URL(imageUrl, 'http://localhost');
        const folderParam = url.searchParams.get('folder') || folder;
        const filename = url.searchParams.get('filename');
        
        if (folderParam && filename) {
          const safeFolder = folderParam.replace(/\.\./g, '');
          const safeFilename = filename.replace(/\.\./g, '');
          const filePath = path.join(assetsPath, safeFolder, safeFilename);
          
          if (fs.existsSync(filePath)) {
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
      const safeFolder = folder.replace(/\.\./g, '');
      const safeFilename = imageKey.replace(/\.\./g, '');
      const filePath = path.join(assetsPath, safeFolder, safeFilename);
      
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`已删除本地文件: ${filePath}`);
        return NextResponse.json({
          success: true,
          message: '本地图片删除成功',
        });
      }
    }

    // 如果是 S3 文件（有 imageKey 且不是 restored- 开头）
    if (imageKey && !imageKey.startsWith('restored-')) {
      try {
        const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
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
