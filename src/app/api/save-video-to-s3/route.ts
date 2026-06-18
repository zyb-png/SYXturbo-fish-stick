import { NextRequest, NextResponse } from 'next/server';
import { S3Storage } from 'coze-coding-dev-sdk';

// 保存视频到 S3
export async function POST(request: NextRequest) {
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

    // 使用 uploadFromUrl 从 URL 下载并上传到 S3
    // 生成文件名: 章节X_镜头Y_序号Z.扩展名
    const fileName = `assets/videos/章节${chapterNumber}_镜头${shotNumber}_${videoIndex + 1}.mp4`;
    
    const key = await storage.uploadFromUrl({
      url: videoUrl,
      timeout: 120000, // 2分钟超时
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
