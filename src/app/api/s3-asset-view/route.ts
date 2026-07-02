import { NextRequest, NextResponse } from 'next/server';
import { S3Storage } from 'coze-coding-dev-sdk';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import { isAccountRemoteKey } from '@/lib/account-assets';

// 获取 S3 对象的签名 URL
export async function GET(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');
    
    if (!key) {
      return NextResponse.json(
        { error: '缺少 key 参数' },
        { status: 400 }
      );
    }

    if (!isAccountRemoteKey(auth.account, key)) {
      return NextResponse.json(
        { error: '无权访问该资产' },
        { status: 403 }
      );
    }
    
    // 初始化 S3 存储
    const storage = new S3Storage({
      endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
      accessKey: "",
      secretKey: "",
      bucketName: process.env.COZE_BUCKET_NAME,
      region: "cn-beijing",
    });
    
    // 生成签名 URL（有效期 1 小时）
    const signedUrl = await storage.generatePresignedUrl({
      key,
      expireTime: 3600,
    });
    
    // 重定向到签名 URL
    return NextResponse.redirect(signedUrl);
  } catch (error) {
    console.error('获取 S3 对象签名 URL 失败:', error);
    return NextResponse.json(
      { error: '获取签名 URL 失败' },
      { status: 500 }
    );
  }
}
