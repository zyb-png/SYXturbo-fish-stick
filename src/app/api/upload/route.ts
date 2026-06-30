import { NextRequest, NextResponse } from 'next/server';
import { S3Storage, FetchClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import mammoth from 'mammoth';
import { requireUserLoginResponse } from '@/lib/auth-guard';

// 支持的文件类型
const SUPPORTED_TYPES: Record<string, string[]> = {
  text: ['text/plain', 'text/markdown'],
  pdf: ['application/pdf'],
  word: [
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ],
};

// 支持的文件扩展名
const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.pdf', '.doc', '.docx'];

// 检查文件类型是否支持
function getSupportedFileType(mimeType: string, fileName: string): string | null {
  // 首先检查 MIME 类型
  for (const [type, mimes] of Object.entries(SUPPORTED_TYPES)) {
    if (mimes.includes(mimeType)) {
      return type;
    }
  }
  
  // 如果 MIME 类型不匹配，检查文件扩展名
  const ext = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
  if (ext === '.txt' || ext === '.md') return 'text';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.doc' || ext === '.docx') return 'word';
  
  return null;
}

export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: '未找到文件' },
        { status: 400 }
      );
    }

    console.log(`上传文件: ${file.name}, 类型: ${file.type}, 大小: ${file.size} bytes`);

    // 检查文件类型
    const fileType = getSupportedFileType(file.type, file.name);
    if (!fileType) {
      return NextResponse.json(
        { 
          error: '不支持的文件格式',
          supportedFormats: '支持 .txt, .md, .pdf, .doc, .docx 格式',
          receivedType: file.type,
          receivedName: file.name,
        },
        { status: 400 }
      );
    }

    // 读取文件内容
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    let textContent = '';
    let fileKey: string | null = null;
    let fileUrl: string | null = null;

    // 根据文件类型提取文本内容
    if (fileType === 'text') {
      // 纯文本文件直接读取
      try {
        textContent = fileBuffer.toString('utf-8');
        console.log(`文本文件读取成功，内容长度: ${textContent.length}`);
      } catch (textError) {
        console.error('文本文件读取失败:', textError);
        return NextResponse.json(
          { error: '文本文件读取失败' },
          { status: 500 }
        );
      }
    } else if (fileType === 'word') {
      // Word 文件使用 mammoth 本地解析（获取完整内容）
      console.log('使用 mammoth 解析 Word 文件...');
      try {
        const result = await mammoth.extractRawText({ buffer: fileBuffer });
        textContent = result.value.trim();
        console.log(`Word 文件解析成功，内容长度: ${textContent.length}`);
        
        if (!textContent) {
          return NextResponse.json(
            { 
              error: '无法从 Word 文件中提取文本内容',
              fileName: file.name,
              hint: '请确保文件包含可识别的文本内容',
            },
            { status: 400 }
          );
        }
      } catch (mammothError) {
        console.error('mammoth 解析失败:', mammothError);
        return NextResponse.json(
          { 
            error: 'Word 文件解析失败',
            details: mammothError instanceof Error ? mammothError.message : '未知错误',
            fileName: file.name,
            suggestion: '请确保文件是有效的 .docx 格式，或尝试将内容复制到 .txt 文件中上传',
          },
          { status: 500 }
        );
      }
    } else {
      // PDF 文件使用 FetchClient 解析
      console.log(`开始解析 ${fileType} 文件...`);
      
      try {
        if (!process.env.COZE_BUCKET_ENDPOINT_URL || !process.env.COZE_BUCKET_NAME) {
          return NextResponse.json(
            {
              error: 'PDF 解析需要对象存储配置',
              details: '当前本地环境未配置 COZE_BUCKET_ENDPOINT_URL 或 COZE_BUCKET_NAME',
              fileType,
              fileName: file.name,
              suggestion: '请上传 .txt、.md 或 .docx 文件，或配置对象存储后再上传 PDF',
            },
            { status: 503 }
          );
        }

        // 初始化客户端。PDF 解析服务需要一个可访问的文件 URL。
        const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
        const config = new Config();
        const storage = new S3Storage({
          endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
          accessKey: "",
          secretKey: "",
          bucketName: process.env.COZE_BUCKET_NAME,
          region: "cn-beijing",
        });

        fileKey = await storage.uploadFile({
          fileContent: fileBuffer,
          fileName: `storyboards/${Date.now()}_${file.name}`,
          contentType: file.type || 'application/octet-stream',
        });

        fileUrl = await storage.generatePresignedUrl({
          key: fileKey,
          expireTime: 86400, // 1 天有效期
        });

        console.log(`文件已上传到对象存储: ${fileKey}`);

        const fetchClient = new FetchClient(config, customHeaders);
        const fetchResponse = await fetchClient.fetch(fileUrl);

        console.log(`FetchClient 响应状态: ${fetchResponse.status_code}, 消息: ${fetchResponse.status_message}`);

        if (fetchResponse.status_code === 0 && fetchResponse.content) {
          // 提取文本内容
          const textItems = fetchResponse.content.filter(
            (item: any) => item.type === 'text'
          );
          textContent = textItems
            .map((item: any) => item.text)
            .join('\n')
            .trim();

          console.log(`文件解析成功，提取文本长度: ${textContent.length}`);

          if (!textContent) {
            // 如果没有提取到文本，返回错误
            return NextResponse.json(
              { 
                error: '无法从文件中提取文本内容',
                fileName: file.name,
                fileType,
                hint: '请确保文件包含可识别的文本内容',
              },
              { status: 400 }
            );
          }
        } else {
          // 解析失败
          console.error('文件解析失败:', fetchResponse.status_message);
          
          // 检查是否是账户余额问题
          const errorMsg = fetchResponse.status_message || '';
          if (errorMsg.includes('balance is overdue') || errorMsg.includes('denied')) {
            return NextResponse.json(
              { 
                error: '文档解析服务暂时不可用',
                details: '服务配额已用尽，请稍后再试或使用纯文本文件（.txt, .md）',
                fileType,
                fileName: file.name,
                suggestion: '建议将文档内容复制到 .txt 文件中上传',
              },
              { status: 503 }
            );
          }
          
          return NextResponse.json(
            { 
              error: '文件解析失败',
              details: fetchResponse.status_message || '解析服务返回错误',
              fileType,
              fileName: file.name,
            },
            { status: 500 }
          );
        }
      } catch (parseError) {
        console.error('文件解析错误:', parseError);
        return NextResponse.json(
          { 
            error: '文件解析失败',
            details: parseError instanceof Error ? parseError.message : '未知错误',
            fileType,
            fileName: file.name,
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      fileKey,
      fileUrl,
      fileName: file.name,
      fileSize: file.size,
      fileType,
      content: textContent,
      contentLength: textContent.length,
    });
  } catch (error) {
    console.error('文件上传失败:', error);
    return NextResponse.json(
      { 
        error: '文件上传失败',
        details: error instanceof Error ? error.message : '未知错误',
      },
      { status: 500 }
    );
  }
}
