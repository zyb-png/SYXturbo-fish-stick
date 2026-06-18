import { NextRequest, NextResponse } from 'next/server';
import { S3Storage } from 'coze-coding-dev-sdk';

/**
 * 清除 S3 上的所有资产文件
 * 包括：场景图片、人物图片、道具图片、分镜图片、视频文件
 */
export async function POST(request: NextRequest) {
  try {
    const storage = new S3Storage({
      endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
      accessKey: "",
      secretKey: "",
      bucketName: process.env.COZE_BUCKET_NAME,
      region: "cn-beijing",
    });

    // 要清除的 S3 文件夹前缀
    const prefixesToDelete = [
      'assets/scene/',      // 场景图片
      'assets/character/',  // 人物图片
      'assets/prop/',       // 道具图片
      'storyboards/',       // 分镜图片
      'assets/video/',      // 视频文件
    ];

    let totalDeleted = 0;
    const deletedByType: Record<string, number> = {};

    for (const prefix of prefixesToDelete) {
      try {
        // 列出该前缀下的所有文件
        const result = await storage.listFiles({
          prefix,
          maxKeys: 1000,
        });

        if (result.keys && result.keys.length > 0) {
          // 批量删除文件
          for (const key of result.keys) {
            try {
              await storage.deleteFile({ fileKey: key });
              totalDeleted++;
            } catch (deleteError) {
              console.warn(`删除文件失败: ${key}`, deleteError);
            }
          }
          deletedByType[prefix] = result.keys.length;
          console.log(`已删除 ${prefix} 下的 ${result.keys.length} 个文件`);
        } else {
          deletedByType[prefix] = 0;
        }
      } catch (listError) {
        console.warn(`列出 ${prefix} 文件失败:`, listError);
        deletedByType[prefix] = 0;
      }
    }

    console.log(`资产清除完成，共删除 ${totalDeleted} 个文件`);

    return NextResponse.json({
      success: true,
      message: `已清除 ${totalDeleted} 个资产文件`,
      deletedByType,
      totalDeleted,
    });
  } catch (error) {
    console.error('清除资产失败:', error);
    return NextResponse.json({
      success: false,
      error: '清除资产失败，请稍后重试',
    }, { status: 500 });
  }
}
