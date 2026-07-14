import { NextRequest, NextResponse } from 'next/server';
import { invoke, type LlmTokenUsage } from '@/lib/openai-client';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import { normalizeExecutionScriptText } from '@/lib/execution-script-format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const EXECUTION_SCRIPT_PROMPT = `你是一个经验丰富的编剧，博览群书，擅长捕捉抖音、视频号、小红书、快手等自媒体平台用户喜好，参与过大量剧本创作，并且看过无数的电影、电视剧和动漫，精通各种类型微电影剧本撰写具备深厚的微电影剧本撰写知识和创作能力，能够创作优秀的剧本，根据你剧本创作的动漫和电视剧，总会大卖。
这是一个故事脚本，学习它，请通读全文，我要改编成短剧，集数按照他原本的集数来，每集时长不做控制以原来的脚本长度为准，按照要求，并运用自身能力编写剧本，可在工作中使用动漫、微短剧、电视剧、电影等等知识库。
请按照如下格式来帮我写剧本，请记住下面的格式：

1、【场景题头】：格式为：场号 场景名 [内 / 外] [日 / 夜]示例：1-1 废弃仓库 [内] [夜]（场景题头要加粗）
2、【画面 / 动作 (Action)】：所有的环境描写、人物动作、镜头画面，必须以符号 “△” 开头。严禁出现心理描写（如 “他心里想…”），必须转化为可视化的动作或表情。示例：△ 陈墨推开门，掸了掸身上的雨水。
3、【对白 (Dialogue)】：采用 “紧凑格式”，人名后加冒号，人名要加粗。格式为：角色名：(情绪 / 动作提示) 台词内容示例：陈墨：(冷笑) 你以为你能跑得掉？
4、【特殊音效与视觉】：重要的声音 / 音效，使用【音效】标注。屏幕上的文字 / 字幕，使用【字幕】标注。示例：【音效】远处传来警笛声。
5、【专业术语】：画外音（人在现场但镜头未拍到嘴动）标注为 (O.S.)。内心独白（心理声音）标注为 (V.O.)。示例：陈墨 (V.O.)：哪怕只有百分之一的机会，我也要试一试。
6、每一集要在最前面把当集的出场人物的名称写出来，加粗。
7、不要把 “【画面 / 动作 (Action)】、【场景题头】、【对白 (Dialogue)】、【特殊音效与视觉】、【专业术语】” 这些字眼放到剧本里，这里是说要有它们的内容即可。
8、每一句话之间都要换行。
9、要遵守剧情路线，不要擅自修改。`;

function buildTokenUsage(usage: LlmTokenUsage | null) {
  return {
    input: usage?.inputTokens || 0,
    output: usage?.outputTokens || 0,
    timestamp: Date.now(),
    cachedInput: usage?.cachedInputTokens || 0,
    uncachedInput: usage?.uncachedInputTokens || 0,
    total: usage?.totalTokens || 0,
  };
}

export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const { content, fileName } = await request.json();
    const scriptContent = typeof content === 'string' ? content.trim() : '';
    const safeFileName = typeof fileName === 'string' && fileName.trim() ? fileName.trim() : '剧本';

    if (!scriptContent) {
      return NextResponse.json(
        { success: false, error: '未提供剧本内容' },
        { status: 400 }
      );
    }

    let usage: LlmTokenUsage | null = null;
    const response = await invoke(
      [
        {
          role: 'system',
          content: `${EXECUTION_SCRIPT_PROMPT}\n\n特别约束：必须保留原文剧情路线、人物关系和关键台词。不要新增原文没有的对白、内心独白、人物关系、背景设定或剧情反转；不要改写台词含义。可以补足可视化动作、环境、音效和镜头画面，但不能改变故事信息。\n\n格式约束：请只输出改编后的执行剧本正文，不要输出解释、前言、总结或代码块。禁止使用 Markdown 标记和特殊排版符号，包括 #、*、**、- 列表符、\`\`\`、标题井号。标题和场景题头直接用纯文本，每一句独立换行，分集和场景之间最多保留一个空行。`,
        },
        {
          role: 'user',
          content: `文件名：${safeFileName}\n\n以下是原始故事脚本，请通读全文后按要求拉成执行剧本：\n\n${scriptContent}`,
        },
      ],
      {
        temperature: 0.35,
        maxTokens: 65536,
        timeout: 600_000,
        maxRetries: 2,
        billingLabel: '拉执行剧本',
        onUsage: value => {
          usage = value;
        },
      }
    );

    const executionScript = normalizeExecutionScriptText(response);
    if (!executionScript) {
      throw new Error('模型没有返回执行剧本内容');
    }

    return NextResponse.json({
      success: true,
      executionScript,
      tokenUsage: buildTokenUsage(usage),
    });
  } catch (error: any) {
    console.error('拉执行剧本失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: '拉执行剧本失败',
        details: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}
