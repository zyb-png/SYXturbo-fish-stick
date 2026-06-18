import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// 文件夹映射
const FOLDER_MAP: Record<string, string> = {
  scene: '场景图片',
  character: '人物图片',
  prop: '道具图片',
  storyboard: '分镜图片',
  video: '视频文件',
};

// 从本地资产恢复数据
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type'); // scenes, characters, props, storyboards, videos
    
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
    
    // 恢复素材图片（场景、人物、道具）
    if (type === 'assets') {
      const assetImages: Record<string, Array<{ name: string; url: string; timestamp: number }>> = {
        scene: [],
        character: [],
        prop: [],
      };
      
      for (const [assetType, folderName] of Object.entries(FOLDER_MAP)) {
        if (assetType === 'storyboard' || assetType === 'video') continue;
        
        const folderPath = path.join(assetsPath, folderName);
        
        if (fs.existsSync(folderPath)) {
          const files = fs.readdirSync(folderPath)
            .filter(f => fs.statSync(path.join(folderPath, f)).isFile())
            .filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f));
          
          for (const file of files) {
            // 解析文件名：格式为 "名称_时间戳.扩展名"
            const match = file.match(/^(.+)_(\d+)\.[^.]+$/);
            const name = match ? match[1] : file;
            const timestamp = match ? parseInt(match[2]) : Date.now();
            
            assetImages[assetType].push({
              name,
              url: `/api/assets-view?folder=${encodeURIComponent(folderName)}&filename=${encodeURIComponent(file)}`,
              timestamp,
            });
          }
        }
        
        // 按时间戳排序
        assetImages[assetType].sort((a, b) => b.timestamp - a.timestamp);
      }
      
      return NextResponse.json({
        success: true,
        assetImages,
      });
    }
    
    // 恢复分镜图片
    if (type === 'storyboards') {
      const folderPath = path.join(assetsPath, '分镜图片');
      const storyboards: Record<string, Array<{ shotNumber: number; url: string; timestamp: number }>> = {};
      
      if (fs.existsSync(folderPath)) {
        const files = fs.readdirSync(folderPath)
          .filter(f => fs.statSync(path.join(folderPath, f)).isFile())
          .filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f));
        
        for (const file of files) {
          // 解析文件名：格式为 "章节名_分镜N_时间戳.扩展名"
          const match = file.match(/^(.+)_分镜(\d+)_(\d+)\.[^.]+$/);
          if (match) {
            const chapterTitle = match[1];
            const shotNumber = parseInt(match[2]);
            const timestamp = parseInt(match[3]);
            
            if (!storyboards[chapterTitle]) {
              storyboards[chapterTitle] = [];
            }
            
            storyboards[chapterTitle].push({
              shotNumber,
              url: `/api/assets-view?folder=${encodeURIComponent('分镜图片')}&filename=${encodeURIComponent(file)}`,
              timestamp,
            });
          }
        }
        
        // 排序
        for (const chapter of Object.keys(storyboards)) {
          storyboards[chapter].sort((a, b) => a.shotNumber - b.shotNumber);
        }
      }
      
      return NextResponse.json({
        success: true,
        storyboards,
      });
    }
    
    // 恢复视频
    if (type === 'videos') {
      const folderPath = path.join(assetsPath, '视频文件');
      const videos: Record<string, Array<{ shotNumber: number; url: string; timestamp: number; ratio: string }>> = {};
      
      if (fs.existsSync(folderPath)) {
        const files = fs.readdirSync(folderPath)
          .filter(f => fs.statSync(path.join(folderPath, f)).isFile())
          .filter(f => /\.(mp4|webm)$/i.test(f));
        
        for (const file of files) {
          // 解析文件名：格式为 "章节名_分镜N_比例_时间戳.mp4"
          const match = file.match(/^(.+)_分镜(\d+)_(\d+x\d+)_(\d+)\.[^.]+$/);
          if (match) {
            const chapterTitle = match[1];
            const shotNumber = parseInt(match[2]);
            const ratio = match[3];
            const timestamp = parseInt(match[4]);
            
            if (!videos[chapterTitle]) {
              videos[chapterTitle] = [];
            }
            
            videos[chapterTitle].push({
              shotNumber,
              url: `/api/assets-view?folder=${encodeURIComponent('视频文件')}&filename=${encodeURIComponent(file)}`,
              timestamp,
              ratio,
            });
          }
        }
        
        // 排序
        for (const chapter of Object.keys(videos)) {
          videos[chapter].sort((a, b) => a.shotNumber - b.shotNumber);
        }
      }
      
      return NextResponse.json({
        success: true,
        videos,
      });
    }
    
    // 恢复所有数据
    if (type === 'all') {
      // 素材图片
      const assetImages: Record<string, Array<{ name: string; url: string; timestamp: number }>> = {
        scene: [],
        character: [],
        prop: [],
      };
      
      for (const [assetType, folderName] of Object.entries(FOLDER_MAP)) {
        if (assetType === 'storyboard' || assetType === 'video') continue;
        
        const folderPath = path.join(assetsPath, folderName);
        
        if (fs.existsSync(folderPath)) {
          const files = fs.readdirSync(folderPath)
            .filter(f => fs.statSync(path.join(folderPath, f)).isFile())
            .filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f));
          
          for (const file of files) {
            const match = file.match(/^(.+)_(\d+)\.[^.]+$/);
            const name = match ? match[1] : file;
            const timestamp = match ? parseInt(match[2]) : Date.now();
            
            assetImages[assetType].push({
              name,
              url: `/api/assets-view?folder=${encodeURIComponent(folderName)}&filename=${encodeURIComponent(file)}`,
              timestamp,
            });
          }
        }
        
        assetImages[assetType].sort((a, b) => b.timestamp - a.timestamp);
      }
      
      // 分镜图片
      const storyboardFolder = path.join(assetsPath, '分镜图片');
      const storyboards: Record<string, Array<{ shotNumber: number; url: string; timestamp: number }>> = {};
      
      if (fs.existsSync(storyboardFolder)) {
        const files = fs.readdirSync(storyboardFolder)
          .filter(f => fs.statSync(path.join(storyboardFolder, f)).isFile())
          .filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f));
        
        for (const file of files) {
          const match = file.match(/^(.+)_分镜(\d+)_(\d+)\.[^.]+$/);
          if (match) {
            const chapterTitle = match[1];
            const shotNumber = parseInt(match[2]);
            const timestamp = parseInt(match[3]);
            
            if (!storyboards[chapterTitle]) {
              storyboards[chapterTitle] = [];
            }
            
            storyboards[chapterTitle].push({
              shotNumber,
              url: `/api/assets-view?folder=${encodeURIComponent('分镜图片')}&filename=${encodeURIComponent(file)}`,
              timestamp,
            });
          }
        }
        
        for (const chapter of Object.keys(storyboards)) {
          storyboards[chapter].sort((a, b) => a.shotNumber - b.shotNumber);
        }
      }
      
      // 视频
      const videoFolder = path.join(assetsPath, '视频文件');
      const videos: Record<string, Array<{ shotNumber: number; url: string; timestamp: number; ratio: string }>> = {};
      
      if (fs.existsSync(videoFolder)) {
        const files = fs.readdirSync(videoFolder)
          .filter(f => fs.statSync(path.join(videoFolder, f)).isFile())
          .filter(f => /\.(mp4|webm)$/i.test(f));
        
        for (const file of files) {
          const match = file.match(/^(.+)_分镜(\d+)_(\d+x\d+)_(\d+)\.[^.]+$/);
          if (match) {
            const chapterTitle = match[1];
            const shotNumber = parseInt(match[2]);
            const ratio = match[3];
            const timestamp = parseInt(match[4]);
            
            if (!videos[chapterTitle]) {
              videos[chapterTitle] = [];
            }
            
            videos[chapterTitle].push({
              shotNumber,
              url: `/api/assets-view?folder=${encodeURIComponent('视频文件')}&filename=${encodeURIComponent(file)}`,
              timestamp,
              ratio,
            });
          }
        }
        
        for (const chapter of Object.keys(videos)) {
          videos[chapter].sort((a, b) => a.shotNumber - b.shotNumber);
        }
      }
      
      return NextResponse.json({
        success: true,
        assetImages,
        storyboards,
        videos,
      });
    }
    
    return NextResponse.json({
      success: false,
      error: '未知类型',
    }, { status: 400 });
  } catch (error) {
    console.error('恢复资产失败:', error);
    return NextResponse.json({
      success: false,
      error: '恢复资产失败',
    }, { status: 500 });
  }
}
