import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import archiver from 'archiver';
import { requireUserLoginResponse } from '@/lib/auth-guard';

// 项目版本号
const PROJECT_VERSION = '1.0.0';

function sanitizeFileBaseName(value: unknown) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : 'storyboard-project';
  return raw.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'storyboard-project';
}

function getUniqueFilePath(parentDir: string, fileName: string) {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  let targetPath = path.join(parentDir, fileName);
  let suffix = 2;

  while (fs.existsSync(targetPath)) {
    targetPath = path.join(parentDir, `${baseName}_${suffix}${extension}`);
    suffix += 1;
  }

  return targetPath;
}

function addProjectEntries(
  archive: ReturnType<typeof archiver>,
  {
    metadata,
    state,
    configPath,
    assetsPath,
  }: {
    metadata: Record<string, unknown>;
    state: unknown;
    configPath: string;
    assetsPath: string;
  },
) {
  // 添加项目元数据
  archive.append(JSON.stringify(metadata, null, 2), { name: 'project.json' });

  // 添加项目状态
  archive.append(JSON.stringify(state, null, 2), { name: 'state/project-state.json' });

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
}

export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const { state, projectName, saveToDownloads } = await request.json();

    if (!state) {
      return NextResponse.json({
        success: false,
        error: '缺少项目状态数据',
      }, { status: 400 });
    }

    // 读取项目配置
    const configPath = path.join(process.cwd(), 'assets-config.json');
    let assetsPath = path.join(process.cwd(), 'assets');
    
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configData);
      assetsPath = config.assetsPath || assetsPath;
    }

    const safeProjectName = sanitizeFileBaseName(projectName);
    const metadata = {
      version: PROJECT_VERSION,
      exportedAt: new Date().toISOString(),
      name: safeProjectName,
      description: 'AI 故事分镜视频生成器项目文件',
    };

    // 生成文件名
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `${safeProjectName}_${timestamp}.zip`;

    if (saveToDownloads) {
      const downloadsDir = path.join(os.homedir(), 'Downloads', 'AI故事分镜视频生成器', '项目文件');
      fs.mkdirSync(downloadsDir, { recursive: true });
      const filePath = getUniqueFilePath(downloadsDir, fileName);

      const archive = archiver('zip', { zlib: { level: 9 } });
      const output = fs.createWriteStream(filePath);
      const archivePromise = new Promise<number>((resolve, reject) => {
        output.on('close', () => resolve(archive.pointer()));
        output.on('error', reject);
        archive.on('error', reject);
      });

      archive.pipe(output);
      addProjectEntries(archive, { metadata, state, configPath, assetsPath });
      archive.finalize();
      const zipSize = await archivePromise;

      return NextResponse.json({
        success: true,
        fileName: path.basename(filePath),
        filePath,
        size: zipSize,
      });
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

    addProjectEntries(archive, { metadata, state, configPath, assetsPath });
    archive.finalize();

    const zipBuffer = await archivePromise;

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
