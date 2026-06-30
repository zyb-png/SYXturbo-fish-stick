import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { requireUserLoginResponse } from '@/lib/auth-guard';

// 资产类型映射 - 键名改为复数形式以匹配前端
const ASSET_FOLDERS: Record<string, string> = {
  scenes: '场景图片',
  characters: '人物图片',
  props: '道具图片',
  storyboards: '分镜图片',
  videos: '视频文件',
};

// 单数到复数的映射（用于保存资产时兼容旧调用）
const SINGULAR_TO_PLURAL: Record<string, string> = {
  scene: 'scenes',
  character: 'characters',
  prop: 'props',
  storyboard: 'storyboards',
  video: 'videos',
};

// 保存资产到本地
export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const { type, name, url, data } = await request.json();
    
    if (!type || !name) {
      return NextResponse.json({
        success: false,
        error: '缺少必要参数',
      }, { status: 400 });
    }
    
    // 转换单数形式为复数形式
    const pluralType = SINGULAR_TO_PLURAL[type] || type;
    
    // 读取配置
    const configPath = path.join(process.cwd(), 'assets-config.json');
    let assetsPath = path.join(process.cwd(), 'assets');
    
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configData);
      assetsPath = config.assetsPath || assetsPath;
    }
    
    // 获取文件夹名称
    const folderName = ASSET_FOLDERS[pluralType] || '其他';
    const folderPath = path.join(assetsPath, folderName);
    
    // 确保文件夹存在
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
    
    // 生成文件名（去除特殊字符）
    const safeName = name.replace(/[<>:"/\\|?*]/g, '_');
    const timestamp = Date.now();
    
    let fileName: string;
    let filePath: string;
    
    if (data) {
      // Base64数据直接保存
      const ext = pluralType === 'videos' ? 'mp4' : 'png';
      fileName = `${safeName}_${timestamp}.${ext}`;
      filePath = path.join(folderPath, fileName);
      
      const buffer = Buffer.from(data, 'base64');
      fs.writeFileSync(filePath, buffer);
    } else if (url) {
      // 从URL下载
      const response = await fetch(url);
      const buffer = Buffer.from(await response.arrayBuffer());
      
      // 根据content-type确定扩展名
      const contentType = response.headers.get('content-type') || '';
      let ext = 'bin';
      if (contentType.includes('png')) ext = 'png';
      else if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';
      else if (contentType.includes('mp4')) ext = 'mp4';
      else if (contentType.includes('webm')) ext = 'webm';
      else if (pluralType === 'videos') ext = 'mp4';
      else ext = 'png';
      
      fileName = `${safeName}_${timestamp}.${ext}`;
      filePath = path.join(folderPath, fileName);
      
      fs.writeFileSync(filePath, buffer);
    } else {
      return NextResponse.json({
        success: false,
        error: '请提供URL或数据',
      }, { status: 400 });
    }
    
    return NextResponse.json({
      success: true,
      fileName,
      filePath,
      folderPath,
      message: `已保存到 ${folderName}/${fileName}`,
    });
  } catch (error) {
    console.error('保存资产失败:', error);
    return NextResponse.json({
      success: false,
      error: '保存资产失败',
    }, { status: 500 });
  }
}

// 获取资产列表
export async function GET(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    
    // 读取配置
    const configPath = path.join(process.cwd(), 'assets-config.json');
    let assetsPath = path.join(process.cwd(), 'assets');
    
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configData);
      assetsPath = config.assetsPath || assetsPath;
    }
    
    const result: Record<string, Array<{ name: string; path: string; size: number; time: Date }>> = {};
    
    const types = type ? [type] : Object.keys(ASSET_FOLDERS);
    
    for (const t of types) {
      const folderName = ASSET_FOLDERS[t] || '其他';
      const folderPath = path.join(assetsPath, folderName);
      
      if (fs.existsSync(folderPath)) {
        const files = fs.readdirSync(folderPath);
        result[t] = files
          .filter(f => fs.statSync(path.join(folderPath, f)).isFile())
          .map(f => {
            const stats = fs.statSync(path.join(folderPath, f));
            return {
              name: f,
              path: path.join(folderPath, f),
              size: stats.size,
              time: stats.mtime,
            };
          })
          .sort((a, b) => b.time.getTime() - a.time.getTime());
      } else {
        result[t] = [];
      }
    }
    
    return NextResponse.json({
      success: true,
      assetsPath,
      assets: result,
    });
  } catch (error) {
    console.error('获取资产列表失败:', error);
    return NextResponse.json({
      success: false,
      error: '获取资产列表失败',
    }, { status: 500 });
  }
}

// 删除资产
export async function DELETE(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const { filePath } = await request.json();
    
    if (!filePath || !fs.existsSync(filePath)) {
      return NextResponse.json({
        success: false,
        error: '文件不存在',
      }, { status: 404 });
    }
    
    fs.unlinkSync(filePath);
    
    return NextResponse.json({
      success: true,
      message: '文件已删除',
    });
  } catch (error) {
    console.error('删除资产失败:', error);
    return NextResponse.json({
      success: false,
      error: '删除资产失败',
    }, { status: 500 });
  }
}
