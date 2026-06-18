import { NextRequest, NextResponse } from 'next/server';
import { S3Storage } from 'coze-coding-dev-sdk';

// 文件夹映射
const FOLDER_MAP: Record<string, { prefix: string; name: string }> = {
  scenes: { prefix: 'assets/scene/', name: '场景图片' },
  characters: { prefix: 'assets/character/', name: '人物图片' },
  props: { prefix: 'assets/prop/', name: '道具图片' },
  storyboards: { prefix: 'storyboards/', name: '分镜图片' },  // 分镜图片保存在 storyboards/ 目录下
  videos: { prefix: 'assets/videos/', name: '视频文件' },  // 视频文件
};

// 从 S3 对象存储获取图片列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const folder = searchParams.get('folder') || '';
    
    // 初始化 S3 存储
    const storage = new S3Storage({
      endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
      accessKey: "",
      secretKey: "",
      bucketName: process.env.COZE_BUCKET_NAME,
      region: "cn-beijing",
    });

    // 如果指定了文件夹，则列出该文件夹内容
    if (folder && FOLDER_MAP[folder]) {
      const prefix = FOLDER_MAP[folder].prefix;
      
      try {
        const result = await storage.listFiles({ 
          prefix, 
          maxKeys: 1000 
        });
        
        const files = result.keys
          .filter(key => {
            // 根据文件夹类型过滤文件扩展名
            if (folder === 'videos') {
              return /\.(mp4|mov|avi|webm|mkv)$/i.test(key);
            }
            return /\.(png|jpg|jpeg|gif|webp)$/i.test(key);
          })
          .map(key => {
            const fileName = key.split('/').pop() || key;
            // 解析文件名：格式为 "名称_时间戳.扩展名"
            const match = fileName.match(/^(.+)_(\d+)\.[^.]+$/);
            const name = match ? match[1] : fileName;
            const timestamp = match ? parseInt(match[2]) : Date.now();
            
            return {
              key,
              name,
              fileName,
              timestamp,
              url: `/api/s3-asset-view?key=${encodeURIComponent(key)}`,
            };
          })
          .sort((a, b) => b.timestamp - a.timestamp);
        
        return NextResponse.json({
          success: true,
          folder,
          files,
          totalCount: files.length,
        });
      } catch (s3Error) {
        console.error('从 S3 获取文件列表失败:', s3Error);
        return NextResponse.json({
          success: true,
          folder,
          files: [],
          totalCount: 0,
        });
      }
    }
    
    // 否则返回所有文件夹的概览
    const result: Record<string, { count: number; files: Array<{ key: string; name: string; fileName: string; timestamp: number; url: string }> }> = {};
    
    for (const [key, { prefix }] of Object.entries(FOLDER_MAP)) {
      try {
        const listResult = await storage.listFiles({ 
          prefix, 
          maxKeys: 1000 
        });
        
        const files = listResult.keys
          .filter(k => {
            // 根据文件夹类型过滤文件扩展名
            if (key === 'videos') {
              return /\.(mp4|mov|avi|webm|mkv)$/i.test(k);
            }
            return /\.(png|jpg|jpeg|gif|webp)$/i.test(k);
          })
          .map(k => {
            const fileName = k.split('/').pop() || k;
            const match = fileName.match(/^(.+)_(\d+)\.[^.]+$/);
            const name = match ? match[1] : fileName;
            const timestamp = match ? parseInt(match[2]) : Date.now();
            
            return {
              key: k,
              name,
              fileName,
              timestamp,
              url: `/api/s3-asset-view?key=${encodeURIComponent(k)}`,
            };
          })
          .sort((a, b) => b.timestamp - a.timestamp);
        
        result[key] = {
          count: files.length,
          files,
        };
      } catch (e) {
        result[key] = {
          count: 0,
          files: [],
        };
      }
    }
    
    return NextResponse.json({
      success: true,
      folders: result,
    });
  } catch (error) {
    console.error('获取 S3 资产列表失败:', error);
    return NextResponse.json({
      success: false,
      error: '获取资产列表失败',
    }, { status: 500 });
  }
}
