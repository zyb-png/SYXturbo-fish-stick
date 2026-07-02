import { NextRequest, NextResponse } from 'next/server';
import { S3Storage } from 'coze-coding-dev-sdk';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import { isAccountRemoteKey } from '@/lib/account-assets';

export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const { imageKey } = await request.json();

    if (!imageKey) {
      return NextResponse.json(
        { error: '缺少图片键' },
        { status: 400 }
      );
    }

    if (!isAccountRemoteKey(auth.account, imageKey)) {
      return NextResponse.json(
        { error: '无权删除该分镜图片' },
        { status: 403 }
      );
    }

    // 初始化存储
    const storage = new S3Storage({
      endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
      accessKey: "",
      secretKey: "",
      bucketName: process.env.COZE_BUCKET_NAME,
      region: "cn-beijing",
    });

    // 删除文件
    const success = await storage.deleteFile({ fileKey: imageKey });

    if (success) {
      return NextResponse.json({
        success: true,
        message: '分镜图片删除成功',
      });
    } else {
      return NextResponse.json({
        success: false,
        error: '分镜图片删除失败',
      });
    }
  } catch (error) {
    console.error('分镜图片删除失败:', error);
    return NextResponse.json(
      { error: '分镜图片删除失败' },
      { status: 500 }
    );
  }
}
