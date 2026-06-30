import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { requireUserLoginResponse } from '@/lib/auth-guard';

// 项目版本号
const PROJECT_VERSION = '1.0.0';

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

    // 读取资产配置路径
    const configPath = path.join(process.cwd(), 'assets-config.json');
    let assetsPath = path.join(process.cwd(), 'assets');
    
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configData);
      assetsPath = config.assetsPath || assetsPath;
    }

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
    const assetFolders = ['场景图片', '人物图片', '道具图片', '分镜图片', '视频文件'];
    
    for (const entry of zipEntries) {
      // 跳过元数据和配置文件
      if (entry.entryName === 'project.json' || 
          entry.entryName === 'state/project-state.json' ||
          entry.entryName.startsWith('config/')) {
        continue;
      }

      // 处理资产文件
      if (entry.entryName.startsWith('assets/')) {
        const relativePath = entry.entryName.replace('assets/', '');
        const folderName = relativePath.split('/')[0];
        
        if (assetFolders.includes(folderName)) {
          const targetPath = path.join(assetsPath, relativePath);
          const targetDir = path.dirname(targetPath);
          
          // 创建目录
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
          
          // 写入文件
          if (!entry.isDirectory) {
            fs.writeFileSync(targetPath, entry.getData());
            
            // 统计
            if (folderName === '场景图片') stats.scenes++;
            else if (folderName === '人物图片') stats.characters++;
            else if (folderName === '道具图片') stats.props++;
            else if (folderName === '分镜图片') stats.storyboards++;
            else if (folderName === '视频文件') stats.videos++;
          }
        }
      }
    }

    // 恢复资产配置
    const configEntry = zipEntries.find(e => e.entryName === 'config/assets-config.json');
    if (configEntry) {
      fs.writeFileSync(configPath, configEntry.getData().toString('utf8'));
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
