import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// 获取资产文件列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const folder = searchParams.get('folder') || '';
    
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
    
    // 如果指定了文件夹，则列出该文件夹内容
    if (folder) {
      const folderPath = path.join(assetsPath, folder);
      
      if (!fs.existsSync(folderPath)) {
        return NextResponse.json({
          success: false,
          error: '文件夹不存在',
        }, { status: 404 });
      }
      
      const files = fs.readdirSync(folderPath)
        .filter(f => fs.statSync(path.join(folderPath, f)).isFile())
        .map(f => {
          const filePath = path.join(folderPath, f);
          const stats = fs.statSync(filePath);
          return {
            name: f,
            size: stats.size,
            sizeFormatted: formatFileSize(stats.size),
            createdAt: stats.birthtime,
            modifiedAt: stats.mtime,
          };
        })
        .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
      
      return NextResponse.json({
        success: true,
        folder,
        files,
        totalCount: files.length,
      });
    }
    
    // 否则返回所有文件夹的概览
    const folderMap: Record<string, string> = {
      scenes: '场景图片',
      characters: '人物图片',
      props: '道具图片',
      storyboards: '分镜图片',
      videos: '视频文件',
    };
    
    const result: Record<string, { count: number; size: number; files: Array<{ name: string; size: number; modifiedAt: Date }> }> = {};
    
    for (const [key, folderName] of Object.entries(folderMap)) {
      const folderPath = path.join(assetsPath, folderName);
      
      if (fs.existsSync(folderPath)) {
        const files = fs.readdirSync(folderPath)
          .filter(f => fs.statSync(path.join(folderPath, f)).isFile())
          .map(f => {
            const filePath = path.join(folderPath, f);
            const stats = fs.statSync(filePath);
            return {
              name: f,
              size: stats.size,
              sizeFormatted: formatFileSize(stats.size),
              createdAt: stats.birthtime,
              modifiedAt: stats.mtime,
            };
          })
          .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
        
        result[key] = {
          count: files.length,
          size: files.reduce((sum, f) => sum + f.size, 0),
          files: files, // 返回所有文件
        };
      } else {
        result[key] = {
          count: 0,
          size: 0,
          files: [],
        };
      }
    }
    
    return NextResponse.json({
      success: true,
      assetsPath,
      folders: result,
    });
  } catch (error) {
    console.error('获取资产列表失败:', error);
    return NextResponse.json({
      success: false,
      error: '获取资产列表失败',
    }, { status: 500 });
  }
}

// 格式化文件大小
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
