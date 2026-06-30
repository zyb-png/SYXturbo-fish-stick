import { NextRequest, NextResponse } from 'next/server';
import { S3Storage } from 'coze-coding-dev-sdk';
import fs from 'fs';
import path from 'path';
import { requireUserLoginResponse } from '@/lib/auth-guard';

// 图片数量限制
const MAX_IMAGES_PER_ASSET = 10;
// 图片文件大小限制（支持 4K 高清图，最大 50MB）
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const type = formData.get('type') as string; // scene, character, prop
    const id = formData.get('id') as string;
    const name = formData.get('name') as string;
    const currentCount = parseInt(formData.get('currentCount') as string) || 0;

    if (!file || !type || !id) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 检查图片数量限制
    if (currentCount >= MAX_IMAGES_PER_ASSET) {
      return NextResponse.json(
        { error: `每个素材最多支持上传 ${MAX_IMAGES_PER_ASSET} 张图片` },
        { status: 400 }
      );
    }

    // 检查文件大小（支持 4K 高清图）
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: '图片文件过大，请上传 50MB 以内的图片' },
        { status: 400 }
      );
    }

    // 验证文件类型
    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { error: '请上传图片文件' },
        { status: 400 }
      );
    }

    console.log(`上传素材图片: ${file.name}, 大小: ${(file.size / (1024 * 1024)).toFixed(2)}MB`);

    // 保存文件。优先保存本地，配置了对象存储时再同步上传。
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split('.').pop() || 'png';
    const localResult = await saveUploadedAssetToLocal(type, name || file.name, fileBuffer, file.name);

    let imageUrl = localResult.localUrl;
    let imageKey = localResult.fileName;

    if (process.env.COZE_BUCKET_ENDPOINT_URL && process.env.COZE_BUCKET_NAME) {
      try {
        const storage = new S3Storage({
          endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
          accessKey: "",
          secretKey: "",
          bucketName: process.env.COZE_BUCKET_NAME,
          region: "cn-beijing",
        });

        const fileName = `assets/${type}/custom_${id}_${Date.now()}.${ext}`;
        imageKey = await storage.uploadFile({
          fileContent: fileBuffer,
          fileName,
          contentType: file.type,
        });

        imageUrl = await storage.generatePresignedUrl({
          key: imageKey,
          expireTime: 86400 * 30,
        });
      } catch (storageError) {
        console.warn('对象存储上传失败，使用本地图片地址:', storageError);
      }
    }

    return NextResponse.json({
      success: true,
      type,
      id,
      name: name || file.name,
      imageUrl,
      localUrl: localResult.localUrl,
      imageKey,
      isCustom: true,
    });
  } catch (error: any) {
    console.error('素材上传失败:', error);
    return NextResponse.json(
      { error: '素材上传失败', details: error?.message || '未知错误' },
      { status: 500 }
    );
  }
}

// 保存上传的素材到本地文件夹
async function saveUploadedAssetToLocal(type: string, name: string, buffer: Buffer, originalFileName: string): Promise<{ fileName: string; localUrl: string }> {
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
  
  // 文件夹映射
  const folderMap: Record<string, string> = {
    scene: '场景图片',
    character: '人物图片',
    prop: '道具图片',
  };
  
  const folderName = folderMap[type] || '其他';
  const folderPath = path.join(assetsPath, folderName);
  
  // 确保文件夹存在
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
  
  // 生成文件名
  const safeName = name.replace(/[<>:"/\\|?*\s]+/g, '_').slice(0, 80);
  const timestamp = Date.now();
  const ext = originalFileName.split('.').pop() || 'png';
  const fileName = `${safeName}_${timestamp}.${ext}`;
  const filePath = path.join(folderPath, fileName);
  
  // 写入文件
  fs.writeFileSync(filePath, buffer);
  console.log(`上传素材已保存到本地: ${filePath}`);
  
  // 返回本地访问URL
  const localUrl = `/api/assets-view?folder=${encodeURIComponent(folderName)}&filename=${encodeURIComponent(fileName)}`;
  return { fileName, localUrl };
}
