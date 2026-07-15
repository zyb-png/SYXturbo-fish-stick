import { NextRequest, NextResponse } from 'next/server';
import { invoke, type LlmTokenUsage } from '@/lib/openai-client';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import { normalizeExecutionScriptText } from '@/lib/execution-script-format';
import {
  assessEpisodeOutput,
  splitExecutionScriptEpisodes,
  type ExecutionScriptEpisodeBlock,
} from '@/lib/execution-script-episodes';

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

function addTokenUsage(total: LlmTokenUsage, usage: LlmTokenUsage | null): void {
  if (!usage) return;
  total.inputTokens += usage.inputTokens || 0;
  total.cachedInputTokens += usage.cachedInputTokens || 0;
  total.uncachedInputTokens += usage.uncachedInputTokens || 0;
  total.outputTokens += usage.outputTokens || 0;
  total.totalTokens += usage.totalTokens || 0;
}

function getEpisodeMaxTokens(block: ExecutionScriptEpisodeBlock): number {
  const sourceLength = block.source.replace(/\s/g, '').length;
  return Math.min(65_536, Math.max(8_192, Math.ceil(sourceLength * 1.8)));
}

function getEpisodeLabel(block: ExecutionScriptEpisodeBlock): string {
  return block.number === null ? '完整剧本' : `第${block.number}集`;
}

function buildEpisodeMessages(
  block: ExecutionScriptEpisodeBlock,
  fileName: string,
  blockIndex: number,
  totalBlocks: number,
  retryReasons: string[] = []
) {
  const episodeLabel = getEpisodeLabel(block);
  const retryInstruction = retryReasons.length > 0
    ? `\n\n上一次输出未通过完整性检查：${retryReasons.join('、')}。请从头完整重写本集，不能只写开头。`
    : '';

  return [
    {
      role: 'system' as const,
      content: `${EXECUTION_SCRIPT_PROMPT}\n\n特别约束：必须保留原文剧情路线、人物关系和关键台词。不要新增原文没有的对白、内心独白、人物关系、背景设定或剧情反转；不要改写台词含义。可以补足可视化动作、环境、音效和镜头画面，但不能改变故事信息。\n\n完整性约束：当前只处理${episodeLabel}，但必须从本集第一行一直处理到最后一行。原文的每个场景题头、关键动作和台词都要覆盖，禁止只输出本集开头或提前总结。输出前自检是否已处理至输入的最后一行。\n\n格式约束：请只输出改编后的执行剧本正文，不要输出解释、前言、总结或代码块。禁止使用 Markdown 标记和特殊排版符号，包括 #、*、**、- 列表符、\`\`\`、标题井号。标题和场景题头直接用纯文本，每一句独立换行，分集和场景之间最多保留一个空行。${retryInstruction}`,
    },
    {
      role: 'user' as const,
      content: `文件名：${fileName}\n分集进度：${blockIndex + 1}/${totalBlocks}\n目标集数：${episodeLabel}\n\n以下是本集的全部原文。请完整处理，并且只输出${episodeLabel}：\n\n${block.source}`,
    },
  ];
}

async function generateEpisode(
  block: ExecutionScriptEpisodeBlock,
  fileName: string,
  blockIndex: number,
  totalBlocks: number,
  signal: AbortSignal
): Promise<{ script: string; usage: LlmTokenUsage | null }> {
  let retryReasons: string[] = [];
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    let usage: LlmTokenUsage | null = null;
    try {
      const response = await invoke(
        buildEpisodeMessages(block, fileName, blockIndex, totalBlocks, retryReasons),
        {
          temperature: attempt === 0 ? 0.25 : 0.15,
          maxTokens: getEpisodeMaxTokens(block),
          timeout: 600_000,
          maxRetries: 2,
          signal,
          billingLabel: `拉执行剧本·${getEpisodeLabel(block)}`,
          onUsage: value => {
            usage = value;
          },
          validateContent: content => {
            const normalized = normalizeExecutionScriptText(content);
            const assessment = assessEpisodeOutput(block, normalized);
            if (!assessment.complete) {
              throw new Error(assessment.reasons.join('、'));
            }
          },
        }
      );

      return {
        script: normalizeExecutionScriptText(response),
        usage,
      };
    } catch (error) {
      lastError = error;
      retryReasons = [error instanceof Error ? error.message : String(error)];
      if (signal.aborted) throw error;
    }
  }

  throw lastError instanceof Error
    ? new Error(`${getEpisodeLabel(block)}生成不完整：${lastError.message}`)
    : new Error(`${getEpisodeLabel(block)}生成不完整`);
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

    const encoder = new TextEncoder();
    const abortController = new AbortController();
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    if (request.signal.aborted) abortController.abort();
    request.signal.addEventListener('abort', () => abortController.abort(), { once: true });

    const responseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const startedAt = Date.now();
        let progressMessage = 'DeepSeek 正在识别原剧本的完整分集结构';
        const send = (event: Record<string, unknown>) => {
          if (cancelled) return;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            cancelled = true;
            abortController.abort();
          }
        };

        send({
          type: 'progress',
          stage: 'connected',
          message: '已连接执行剧本服务，正在识别全部集数',
          elapsedSeconds: 0,
        });

        heartbeatTimer = setInterval(() => {
          send({
            type: 'progress',
            stage: 'generating',
            message: `${progressMessage}，连接正常`,
            elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000),
          });
        }, 8_000);

        void (async () => {
          try {
            const blocks = splitExecutionScriptEpisodes(scriptContent);
            if (blocks.length === 0) throw new Error('未识别到可处理的剧本内容');

            progressMessage = blocks.length > 1
              ? `已识别 ${blocks.length} 集，正在逐集生成并校验`
              : '未识别到多集标记，正在生成完整执行剧本';
            send({
              type: 'progress',
              stage: 'episodes-detected',
              message: progressMessage,
              completedEpisodes: 0,
              totalEpisodes: blocks.length,
              elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000),
            });

            const results: Array<{ script: string; usage: LlmTokenUsage | null } | undefined> = new Array(blocks.length);
            const totalUsage: LlmTokenUsage = {
              inputTokens: 0,
              cachedInputTokens: 0,
              uncachedInputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
            };
            let nextIndex = 0;
            let completedEpisodes = 0;
            const workerCount = Math.min(3, blocks.length);

            const runWorker = async () => {
              while (!abortController.signal.aborted) {
                const blockIndex = nextIndex++;
                if (blockIndex >= blocks.length) return;
                const result = await generateEpisode(
                  blocks[blockIndex],
                  safeFileName,
                  blockIndex,
                  blocks.length,
                  abortController.signal
                );
                results[blockIndex] = result;
                addTokenUsage(totalUsage, result.usage);
                completedEpisodes += 1;
                progressMessage = `已完成 ${completedEpisodes}/${blocks.length} 集，正在生成其余分集`;
                send({
                  type: 'progress',
                  stage: 'episode-complete',
                  message: progressMessage,
                  completedEpisodes,
                  totalEpisodes: blocks.length,
                  elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000),
                });
              }
            };

            try {
              await Promise.all(Array.from({ length: workerCount }, runWorker));
            } catch (error) {
              abortController.abort();
              throw error;
            }

            if (results.some(result => !result?.script)) {
              throw new Error('部分分集未生成完成，本次结果未保存');
            }

            const executionScript = normalizeExecutionScriptText(
              results.map(result => result?.script || '').join('\n\n')
            );
            if (!executionScript) {
              throw new Error('模型没有返回执行剧本内容');
            }

            send({
              type: 'complete',
              success: true,
              executionScript,
              episodeCount: blocks.length,
              tokenUsage: buildTokenUsage(totalUsage),
            });
          } catch (error: unknown) {
            const details = error instanceof Error ? error.message : String(error);
            console.error('拉执行剧本失败:', error);
            send({
              type: 'error',
              success: false,
              error: '拉执行剧本失败',
              details,
            });
          } finally {
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            heartbeatTimer = null;
            if (!cancelled) controller.close();
          }
        })();
      },
      cancel() {
        cancelled = true;
        abortController.abort();
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      },
    });

    return new Response(responseStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        'Connection': 'keep-alive',
      },
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
