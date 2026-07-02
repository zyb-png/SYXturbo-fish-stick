import { NextRequest, NextResponse } from 'next/server';
import { S3Storage } from 'coze-coding-dev-sdk';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import { getAccountRemoteKey } from '@/lib/account-assets';

// 保存视频到 S3
export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const { videoUrl, chapterNumber, shotNumber, videoIndex } = body;

    if (!videoUrl) {
      return NextResponse.json({
        success: false,
        error: '请提供视频 URL',
      });
    }

    console.log(`开始保存视频到 S3: 章节${chapterNumber}, 镜头${shotNumber}, 索引${videoIndex}`);

    // 初始化 S3 存储
    const storage = new S3Storage({
      endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
      accessKey: "",
      secretKey: "",
      bucketName: process.env.COZE_BUCKET_NAME,
      region: "cn-beijing",
    });

    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(`下载视频失败：HTTP ${response.status}`);
    }

    const videoBuffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'video/mp4';
    const fileName = getAccountRemoteKey(
      auth.account,
      `assets/videos/章节${chapterNumber || '未知'}_镜头${shotNumber || '未知'}_${Number(videoIndex || 0) + 1}_${Date.now()}.mp4`
    );

    const key = await storage.uploadFile({
      fileContent: videoBuffer,
      fileName,
      contentType,
    });

    console.log(`视频已保存到 S3: ${key}`);

    // 获取预签名 URL (7天有效期)
    const presignedUrl = await storage.generatePresignedUrl({ 
      key, 
      expireTime: 3600 * 24 * 7 
    });

    return NextResponse.json({
      success: true,
      key,
      fileName: key.split('/').pop(),
      url: presignedUrl,
    });
  } catch (error: any) {
    console.error('保存视频到 S3 失败:', error);
    return NextResponse.json({
      success: false,
      error: error.message || '保存视频失败',
    });
  }
}
