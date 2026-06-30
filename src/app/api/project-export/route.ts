import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { requireUserLoginResponse } from '@/lib/auth-guard';

// 项目版本号
const PROJECT_VERSION = '1.0.0';

export async function GET(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const projectName = searchParams.get('name') || 'storyboard-project';

    // 读取项目配置
    const configPath = path.join(process.cwd(), 'assets-config.json');
    let assetsPath = path.join(process.cwd(), 'assets');
    
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configData);
      assetsPath = config.assetsPath || assetsPath;
    }

    // 创建 zip 流
    const chunks: Buffer[] = [];
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('data', (chunk) => {
      chunks.push(chunk);
    });

    const archivePromise = new Promise<Buffer>((resolve, reject) => {
      archive.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
      archive.on('error', reject);
    });

    // 添加项目元数据
    const metadata = {
      version: PROJECT_VERSION,
      exportedAt: new Date().toISOString(),
      name: projectName,
      description: 'AI 故事分镜视频生成器项目文件',
    };
    archive.append(JSON.stringify(metadata, null, 2), { name: 'project.json' });

    // 添加资产配置
    if (fs.existsSync(configPath)) {
      archive.file(configPath, { name: 'config/assets-config.json' });
    }

    // 添加资产文件夹
    const assetFolders = ['场景图片', '人物图片', '道具图片', '分镜图片', '视频文件'];
    
    for (const folder of assetFolders) {
      const folderPath = path.join(assetsPath, folder);
      if (fs.existsSync(folderPath)) {
        const files = fs.readdirSync(folderPath);
        for (const file of files) {
          const filePath = path.join(folderPath, file);
          if (fs.statSync(filePath).isFile()) {
            archive.file(filePath, { name: `assets/${folder}/${file}` });
          }
        }
      }
    }

    // 完成打包
    archive.finalize();

    const zipBuffer = await archivePromise;

    // 生成文件名
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `${projectName}_${timestamp}.zip`;

    // 返回 zip 文件
    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'Content-Length': zipBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('导出项目失败:', error);
    return NextResponse.json({
      success: false,
      error: '导出项目失败',
      details: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}
