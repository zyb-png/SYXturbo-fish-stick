import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import { getAccountAssetsPath } from '@/lib/account-assets';

// 下载资产文件
export async function GET(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const folder = searchParams.get('folder');
    const filename = searchParams.get('filename');
    
    if (!folder || !filename) {
      return NextResponse.json({
        success: false,
        error: '缺少参数',
      }, { status: 400 });
    }
    
    // 安全检查：防止路径遍历攻击
    const safeFolder = folder.replace(/\.\./g, '');
    const safeFilename = filename.replace(/\.\./g, '');
    
    const assetsPath = getAccountAssetsPath(auth.account);
    
    const filePath = path.join(assetsPath, safeFolder, safeFilename);
    
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({
        success: false,
        error: '文件不存在',
      }, { status: 404 });
    }
    
    // 读取文件
    const fileBuffer = fs.readFileSync(filePath);
    
    // 确定文件类型
    const ext = path.extname(safeFilename).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
    };
    
    const contentType = contentTypes[ext] || 'application/octet-stream';
    
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safeFilename)}`,
        'Content-Length': fileBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('下载文件失败:', error);
    return NextResponse.json({
      success: false,
      error: '下载文件失败',
    }, { status: 500 });
  }
}
