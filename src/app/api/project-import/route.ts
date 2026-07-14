import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import { getAccountAssetsPath } from '@/lib/account-assets';

const ASSET_FOLDERS = new Set(['场景图片', '人物图片', '道具图片', '分镜图片', '视频文件']);

function resolveSafeImportedAssetPath(assetsPath: string, entryName: string) {
  const normalizedEntryName = entryName.replace(/\\/g, '/');
  if (!normalizedEntryName.startsWith('assets/') || normalizedEntryName.includes('\0')) return null;

  const relativePath = normalizedEntryName.slice('assets/'.length);
  const segments = relativePath.split('/').filter(Boolean);
  if (segments.length < 2 || segments.some(segment => segment === '.' || segment === '..')) return null;

  const folderName = segments[0];
  if (!ASSET_FOLDERS.has(folderName)) return null;

  const assetsRoot = path.resolve(assetsPath);
  const targetPath = path.resolve(assetsRoot, ...segments);
  if (!targetPath.startsWith(`${assetsRoot}${path.sep}`)) return null;

  return { folderName, targetPath };
}

export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({
        success: false,
        error: '请上传项目文件',
      }, { status: 400 });
    }

    // 验证文件类型
    if (!file.name?.endsWith('.zip')) {
      return NextResponse.json({
        success: false,
        error: '请上传 .zip 格式的项目文件',
      }, { status: 400 });
    }

    // 读取文件内容
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 解压文件
    const zip = new AdmZip(buffer);
    const zipEntries = zip.getEntries();

    // 读取项目元数据
    const metadataEntry = zipEntries.find(e => e.entryName === 'project.json');
    if (!metadataEntry) {
      return NextResponse.json({
        success: false,
        error: '无效的项目文件，缺少 project.json',
      }, { status: 400 });
    }

    const metadata = JSON.parse(metadataEntry.getData().toString('utf8'));
    console.log('导入项目元数据:', metadata);

    // 读取项目状态
    const stateEntry = zipEntries.find(e => e.entryName === 'state/project-state.json');
    let projectState = null;
    if (stateEntry) {
      projectState = JSON.parse(stateEntry.getData().toString('utf8'));
    }

    const assetsPath = getAccountAssetsPath(auth.account);

    // 确保资产文件夹存在
    if (!fs.existsSync(assetsPath)) {
      fs.mkdirSync(assetsPath, { recursive: true });
    }

    // 统计信息
    const stats = {
      scenes: 0,
      characters: 0,
      props: 0,
      storyboards: 0,
      videos: 0,
    };

    // 解压资产文件
    for (const entry of zipEntries) {
      // 跳过元数据和配置文件
      if (entry.entryName === 'project.json' || 
          entry.entryName === 'state/project-state.json' ||
          entry.entryName.startsWith('config/')) {
        continue;
      }

      // 处理资产文件
      if (entry.entryName.startsWith('assets/')) {
        const safeAsset = resolveSafeImportedAssetPath(assetsPath, entry.entryName);
        if (!safeAsset) {
          console.warn('跳过不安全的项目资产路径:', entry.entryName);
          continue;
        }
        if (entry.isDirectory) continue;

        const targetDir = path.dirname(safeAsset.targetPath);
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(safeAsset.targetPath, entry.getData());

        if (safeAsset.folderName === '场景图片') stats.scenes++;
        else if (safeAsset.folderName === '人物图片') stats.characters++;
        else if (safeAsset.folderName === '道具图片') stats.props++;
        else if (safeAsset.folderName === '分镜图片') stats.storyboards++;
        else if (safeAsset.folderName === '视频文件') stats.videos++;
      }
    }

    return NextResponse.json({
      success: true,
      message: '项目导入成功',
      metadata,
      projectState, // 返回项目状态，前端恢复到 localStorage
      stats,
      assetsPath,
    });
  } catch (error) {
    console.error('导入项目失败:', error);
    return NextResponse.json({
      success: false,
      error: '导入项目失败',
      details: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}
