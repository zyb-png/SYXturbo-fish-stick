import { NextRequest, NextResponse } from 'next/server';
import { stream as oaiStream, invoke as oaiInvoke } from '@/lib/openai-client';
import { estimateMessagesTokens, estimateTokens } from '@/lib/token-utils';
import { tryExtractAndFixJSON } from '@/lib/json-utils';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import { getCanonicalEpisodeTitle, normalizeEpisodeChapterTitles } from '@/lib/outline-utils';

// 每批处理的章节数
const BATCH_SIZE = 5;

type EpisodeMarker = {
  number: number;
  marker: string;
  start?: number;
  end?: number;
  line?: string;
};

export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const {
      content,
      fileName,
      batch = 1,
      episodeMarkers: clientEpisodeMarkers,
      basicInfo,
      sourceType,
    } = await request.json();

    if (sourceType !== 'execution-script') {
      return NextResponse.json(
        { error: '大纲提取仅允许使用当前执行剧本，请先重新拉取执行剧本' },
        { status: 400 }
      );
    }

    if (!content) {
      return NextResponse.json(
        { error: '未提供文件内容' },
        { status: 400 }
      );
    }

    console.log(`开始提取大纲，文件: ${fileName}, 批次: ${batch}, 内容长度: ${content.length}`);

    // 初始化 LLM 客户端

    // 第一批：识别所有集数标记
    let episodeMarkers: EpisodeMarker[] = [];
    let scriptBasicInfo = basicInfo;
    
    if (batch === 1) {
      // 第一批时识别集数
      episodeMarkers = extractEpisodeMarkers(content);
      console.log(`从文本中识别到 ${episodeMarkers.length} 个集数标记:`, episodeMarkers.map(m => `[${m.number}] ${m.marker}`));
      
      // 提取剧本基本信息
      scriptBasicInfo = await extractBasicInfo(content, fileName);
    } else {
      // 后续批次：使用前端传来的集数数组（需要转换格式）
      if (clientEpisodeMarkers && Array.isArray(clientEpisodeMarkers)) {
        // 检查是否是旧格式（纯数字数组）
        if (typeof clientEpisodeMarkers[0] === 'number') {
          episodeMarkers = (clientEpisodeMarkers as number[]).map(num => ({ number: num, marker: `第${num}集` }));
        } else {
          episodeMarkers = clientEpisodeMarkers as EpisodeMarker[];
        }
      }
      console.log(`第 ${batch} 批，使用传入的集数数组，共 ${episodeMarkers.length} 个:`, episodeMarkers.map(m => `[${m.number}] ${m.marker}`));
    }

    // 如果没有识别到集数标记，使用传统方式（一次生成全部）
    if (episodeMarkers.length === 0) {
      console.log('未识别到集数标记，使用传统方式提取大纲');
      const outline = await generateOutlineTraditional(content, fileName);
      
      if (outline && outline.chapters && outline.chapters.length > 0) {
        return NextResponse.json({
          success: true,
          outline,
          tokenUsage: outline.tokenUsage,
          batchInfo: {
            currentBatch: 1,
            totalBatches: 1,
            hasMore: false,
          }
        });
      } else {
        return NextResponse.json({
          success: false,
          error: '大纲提取失败，请重试。',
        });
      }
    }

    // 分批生成章节
    const totalBatches = Math.ceil(episodeMarkers.length / BATCH_SIZE);
    const currentBatchStart = (batch - 1) * BATCH_SIZE;
    const currentBatchEpisodes = episodeMarkers.slice(currentBatchStart, currentBatchStart + BATCH_SIZE);
    
    console.log(`处理第 ${batch}/${totalBatches} 批，集数:`, currentBatchEpisodes.map(e => `[${e.number}] ${e.marker}`).join(', '));

    // 从原文中提取每个章节的实际内容，再用模型生成短剧情概括
    const batchResult = extractChapterContentFromOriginal(content, currentBatchEpisodes);
    const summaryResult = await summarizeChapterContents(batchResult.chapters);
    
    const hasMore = batch < totalBatches;

    // 构建部分大纲（当前批次）
    const partialOutline = {
      title: scriptBasicInfo?.title || fileName.replace(/\.[^.]+$/, ''),
      summary: scriptBasicInfo?.summary || '',
      totalChapters: episodeMarkers.length,
      chapters: summaryResult.chapters,
      tokenUsage: {
        input: batchResult.inputTokens + summaryResult.inputTokens,
        output: batchResult.outputTokens + summaryResult.outputTokens,
        timestamp: Date.now(),
      },
    };

    return NextResponse.json({
      success: true,
      outline: partialOutline,
      batchInfo: {
        currentBatch: batch,
        totalBatches,
        hasMore,
        totalEpisodes: episodeMarkers.length,
        processedEpisodes: currentBatchStart + batchResult.chapters.length,
        episodeMarkers: episodeMarkers,  // 返回完整的集数数组，供后续批次使用
      },
      basicInfo: scriptBasicInfo,
      tokenUsage: partialOutline.tokenUsage,
    });
  } catch (error: any) {
    console.error('大纲提取失败:', error);
    console.error('错误详情:', error?.message);
    return NextResponse.json(
      { error: '大纲提取失败，请重试', details: error?.message },
      { status: 500 }
    );
  }
}

/**
 * 从文本中提取所有集数标记
 * 返回包含数字和实际标记文本的对象数组
 */
function extractEpisodeMarkers(content: string): EpisodeMarker[] {
  const source = normalizeLineEndings(content);
  const markers: EpisodeMarker[] = [];
  const seen = new Set<number>();
  const linePattern = /([^\n]*)(?:\n|$)/g;
  let match: RegExpExecArray | null;

  while ((match = linePattern.exec(source)) !== null) {
    const rawLine = match[1] || '';
    if (!rawLine && match.index >= source.length) break;
    const parsed = parseEpisodeHeadingLine(rawLine);
    if (!parsed || seen.has(parsed.number)) continue;

    seen.add(parsed.number);
    const lineStart = match.index;
    const markerOffset = rawLine.indexOf(parsed.marker);
    const markerStart = lineStart + Math.max(0, markerOffset);
    markers.push({
      number: parsed.number,
      marker: parsed.marker,
      start: markerStart,
      end: markerStart + parsed.marker.length,
      line: rawLine.trim(),
    });
  }

  markers.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  return markers;
}

function normalizeLineEndings(value: string): string {
  return String(value || '').replace(/\r\n?/g, '\n');
}

function chineseToNumberMap(chinese: string): number {
  if (/^\d+$/.test(chinese)) return parseInt(chinese, 10);
  const digitMap: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (chinese === '十') return 10;
  if (chinese === '百' || chinese === '一百') return 100;

  const hundredIndex = chinese.indexOf('百');
  if (hundredIndex >= 0) {
    const beforeHundred = chinese.slice(0, hundredIndex);
    const afterHundred = chinese.slice(hundredIndex + 1);
    const hundreds = beforeHundred ? digitMap[beforeHundred] : 1;
    const rest = afterHundred ? chineseToNumberMap(afterHundred) : 0;
    return typeof hundreds === 'number' ? hundreds * 100 + rest : 0;
  }

  const tenIndex = chinese.indexOf('十');
  if (tenIndex >= 0) {
    const beforeTen = chinese.slice(0, tenIndex);
    const afterTen = chinese.slice(tenIndex + 1);
    const tens = beforeTen ? digitMap[beforeTen] : 1;
    const ones = afterTen ? digitMap[afterTen] : 0;
    return typeof tens === 'number' && typeof ones === 'number' ? tens * 10 + ones : 0;
  }

  return digitMap[chinese] || 0;
}

function parseEpisodeHeadingLine(rawLine: string): { number: number; marker: string } | null {
  const line = rawLine
    .replace(/^\s*#{1,6}\s*/g, '')
    .replace(/^\s*[-*+]\s*/g, '')
    .replace(/^\s*\d+\s*[.、．]\s*/g, '')
    .replace(/\*\*/g, '')
    .trim();

  if (!line || line.length > 120) return null;
  if (isLikelyDialogueLine(line) || isLikelySceneOrActionLine(line)) return null;

  const patterns: RegExp[] = [
    /^第\s*([一二两三四五六七八九十百千\d]+)\s*[集章幕话]/,
    /^(?:Episode|EP\.?)\s*(\d+)\b/i,
    /^\[\s*(\d+)\s*]\s*(?:$|[^\d].*)/,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(line);
    if (!match) continue;
    const number = chineseToNumberMap(match[1]);
    if (!Number.isFinite(number) || number <= 0) continue;
    return {
      number,
      marker: match[0].trim(),
    };
  }

  return null;
}

function isLikelyDialogueLine(line: string): boolean {
  const trimmed = line.trim();
  return /^[^：:\n]{1,32}[：:]\s*\S+/.test(trimmed);
}

function isLikelySceneOrActionLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('△') ||
    /^\d+\s*[-—]/.test(trimmed) ||
    /\b(日|夜|内|外|内\/外|外\/内)\b/.test(trimmed)
  );
}

/**
 * 提取剧本基本信息
 */
async function extractBasicInfo( content: string, fileName: string): Promise<any> {
  const systemPrompt = `提取剧本的基本信息。summary要用100字左右概括整体剧情，不摘抄原文或台词。只返回JSON格式：{"title":"标题","summary":"整体剧情概括"}`;
  
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: `文件：${fileName}\n内容前5000字：\n${content.substring(0, 5000)}` }
  ];
  
  let response = '';
  try {
    const stream = oaiStream(messages, {
      temperature: 0.3,
    });
  
    for await (const chunk of stream) {
      if (chunk.content) response += chunk.content.toString();
    }
  } catch (error: any) {
    console.warn('大纲基本信息模型提取失败，使用文件名和原文摘要兜底:', error?.message || error);
    const summary = buildLocalChapterSummary(content);
    return {
      title: fileName.replace(/\.[^.]+$/, ''),
      summary,
      inputTokens: estimateMessagesTokens(messages),
      outputTokens: 0,
    };
  }
  
  const info = tryExtractAndFixJSON(response) || { title: fileName, summary: '' };
  
  return {
    title: info.title || fileName.replace(/\.[^.]+$/, ''),
    summary: info.summary || '',
    inputTokens: estimateMessagesTokens(messages),
    outputTokens: estimateTokens(response),
  };
}

function normalizeSummaryText(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^["“]+|["”]+$/g, '')
    .trim();
}

function buildLocalChapterSummary(content: string): string {
  const lines = String(content || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^第[一二三四五六七八九十百千\d]+[集章节]/.test(line))
    .map(line => line.replace(/^[^：:\n]{1,18}[：:]\s*/, ''))
    .filter(line => line.length > 0 && (!isLikelySceneOrActionLine(line) || line.length > 18));

  const compact = normalizeSummaryText(lines.join(' ') || content);
  if (!compact) return '该章节内容较少，建议手动补充';
  return compact.length > 60 ? `${compact.substring(0, 60)}...` : compact;
}

function normalizeGeneratedSummary(summary: unknown, fallbackContent: string): string {
  const cleaned = normalizeSummaryText(summary);
  if (!cleaned) return buildLocalChapterSummary(fallbackContent);
  return cleaned.length > 120 ? `${cleaned.substring(0, 120)}...` : cleaned;
}

async function summarizeChapterContents(
  chapters: any[]
): Promise<{ chapters: any[]; inputTokens: number; outputTokens: number }> {
  if (!chapters.length) {
    return { chapters, inputTokens: 0, outputTokens: 0 };
  }

  const fallbackChapters = chapters.map(chapter => ({
    ...chapter,
    title: getCanonicalEpisodeTitle(chapter.chapterNumber),
    summary: buildLocalChapterSummary(chapter.content || ''),
  }));

  const chapterPayload = chapters.map(chapter => ({
    chapterNumber: chapter.chapterNumber,
    title: chapter.title || `第${chapter.chapterNumber}集`,
    content: normalizeSummaryText(chapter.content || '').substring(0, 3000),
  }));

  const systemPrompt = `你是剧情大纲编辑，请为每集生成50字左右的剧情概括。

规则：
1. 只概括剧情，不保留原文句式，不摘抄台词，不输出长段原文。
2. 用第三人称写清本集核心冲突、关键转折和结尾钩子。
3. 每集summary约50个中文字符，允许略短或略长。
4. 只返回JSON：{"chapters":[{"chapterNumber":1,"summary":"50字左右剧情概括"}]}`;

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: `请为以下章节生成短剧情概括：\n${JSON.stringify(chapterPayload, null, 2)}` },
  ];

  let response = '';
  try {
    const stream = oaiStream(messages, {
      temperature: 0.2,
    });

    for await (const chunk of stream) {
      if (chunk.content) response += chunk.content.toString();
    }
  } catch (error: any) {
    console.warn('章节短摘要模型生成失败，使用本地短摘要兜底:', error?.message || error);
    return {
      chapters: fallbackChapters,
      inputTokens: estimateMessagesTokens(messages),
      outputTokens: 0,
    };
  }

  const parsed = tryExtractAndFixJSON(response);
  const summaries = Array.isArray(parsed)
    ? parsed
    : (parsed && Array.isArray(parsed.chapters) ? parsed.chapters : []);

  const summaryByChapter = new Map<number, string>();
  for (const item of summaries) {
    const chapterNumber = Number(item?.chapterNumber);
    const summary = normalizeSummaryText(item?.summary);
    if (Number.isFinite(chapterNumber) && summary) {
      summaryByChapter.set(chapterNumber, summary);
    }
  }

  const updatedChapters = chapters.map(chapter => ({
    ...chapter,
    title: getCanonicalEpisodeTitle(chapter.chapterNumber),
    summary: normalizeGeneratedSummary(
      summaryByChapter.get(Number(chapter.chapterNumber)),
      chapter.content || ''
    ),
  }));

  return {
    chapters: updatedChapters,
    inputTokens: estimateMessagesTokens(messages),
    outputTokens: estimateTokens(response),
  };
}

/**
 * 从原文中提取每个章节的实际内容
 * 根据章节标记（如"第1集"）分割原文，获取每个章节的实际文本
 */
function extractChapterContentFromOriginal(
  content: string,
  episodes: EpisodeMarker[]
): { chapters: any[]; inputTokens: number; outputTokens: number } {
  const chapters: any[] = [];
  const source = normalizeLineEndings(content);
  
  console.log(`[章节提取] 开始提取章节内容，总长度: ${source.length}`);
  console.log(`[章节提取] 需要提取的集数:`, episodes.map(e => `[${e.number}] ${e.marker}`).join(', '));
  
  // 找到每个章节标记的位置（使用实际标记文本）
  const positions: { ep: number; marker: string; start: number; end: number }[] = [];
  
  for (const { number, marker } of episodes) {
    const episode = episodes.find(item => item.number === number && item.marker === marker);
    const index = typeof episode?.start === 'number'
      ? episode.start
      : findEpisodeMarkerPosition(source, marker, number);
    if (index !== -1) {
      console.log(`[章节提取] 找到章节标记: 第${number}集 "${marker}"，位置: ${index}`);
      positions.push({
        ep: number,
        marker,
        start: index,
        end: typeof episode?.end === 'number' ? episode.end : index + marker.length
      });
    } else {
      console.warn(`[章节提取] 未找到章节标记: 第${number}集 "${marker}"`);
    }
  }
  
  // 按位置排序
  positions.sort((a, b) => a.start - b.start);
  console.log(`[章节提取] 共找到 ${positions.length} 个章节标记`);
  
  // 提取每个章节的内容
  for (let i = 0; i < positions.length; i++) {
    const current = positions[i];
    const next = positions[i + 1];
    
    // 章节内容从当前标记结束位置开始，到下一个标记开始位置结束
    const contentStart = current.end;
    const contentEnd = next ? next.start : source.length;
    
    // 提取章节内容
    let chapterContent = source.substring(contentStart, contentEnd).trim();
    
    // 如果提取的内容为空，尝试从标记之前提取
    if (chapterContent.length === 0 && next) {
      // 尝试从前一个章节到当前章节之间提取
      const prev = positions[i - 1];
      if (prev) {
        const altStart = prev.end;
        const altEnd = current.start;
        chapterContent = source.substring(altStart, altEnd).trim();
        console.log(`[章节提取] 使用备用方案提取第${current.ep}集内容，长度: ${chapterContent.length}`);
      }
    }
    
    console.log(`[章节提取] 第${current.ep}集提取内容长度: ${chapterContent.length}`);
    
    // 分集标题由当前集号唯一确定，不能读取上一集结尾的台词、动作或转场标记。
    const title = getCanonicalEpisodeTitle(current.ep);
    
    // 截取内容长度限制（避免太长）
    // 保留最多 8000 字符用于分镜生成
    if (chapterContent.length > 8000) {
      chapterContent = chapterContent.substring(0, 8000) + '...';
    }
    
    // 如果内容仍然为空，添加默认内容
    if (chapterContent.length === 0) {
      chapterContent = '该章节内容较少，建议手动补充';
      console.warn(`[章节提取] 第${current.ep}集内容为空，使用默认内容`);
    }
    
    chapters.push({
      chapterNumber: current.ep,
      title: title,
      summary: buildLocalChapterSummary(chapterContent),
      characters: [], // 人物将从原文中提取
      scenes: [], // 场景将从原文中提取
      content: chapterContent,
    });
  }
  
  // 处理未找到标记的章节（添加占位）
  for (const { number } of episodes) {
    if (!chapters.find(c => c.chapterNumber === number)) {
      console.warn(`[章节提取] 第${number}集未找到内容，使用占位`);
      chapters.push({
        chapterNumber: number,
        title: `第${number}集`,
        summary: '该章节内容未能提取，建议重新上传或手动补充',
        characters: [],
        scenes: [],
        content: '该章节内容未能从原文中正确提取，建议重新上传文件或手动补充章节内容。',
      });
    }
  }
  
  // 按章节号排序
  chapters.sort((a, b) => a.chapterNumber - b.chapterNumber);
  
  console.log(`成功提取 ${chapters.length} 个章节的原文内容`);
  chapters.forEach(ch => {
    console.log(`  - 第${ch.chapterNumber}集: ${ch.content.length}字`);
  });
  
  return {
    chapters,
    inputTokens: 0, // 不使用LLM，没有token消耗
    outputTokens: 0,
  };
}

function findEpisodeMarkerPosition(content: string, marker: string, episodeNumber: number): number {
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const linePattern = new RegExp(`(^|\\n)([^\\n]*${escapedMarker}[^\\n]*)`, 'g');
  let match: RegExpExecArray | null;
  while ((match = linePattern.exec(content)) !== null) {
    const line = match[2] || '';
    const parsed = parseEpisodeHeadingLine(line);
    if (parsed?.number === episodeNumber) {
      const lineStart = match.index + (match[1] ? match[1].length : 0);
      return lineStart + line.indexOf(marker);
    }
  }
  return content.indexOf(marker);
}

/**
 * 生成一批章节（备用方法，当无法从原文提取时使用LLM生成）
 */
async function generateBatchChapters(
  
  content: string,
  episodes: number[],
): Promise<any> {
  const systemPrompt = `为剧本的指定集数生成章节信息。

**重要规则**：
1. content 字段必须详细描述该章节的完整情节（500-1000字），包括：
   - 场景描述和氛围
   - 人物对话要点
   - 关键事件发展
   - 情感变化
   - 冲突与转折
2. content 是用于生成分镜的核心素材，必须足够详细
3. 如果原文中有具体情节，要详细展开描述
4. summary 只做50字左右剧情概括，不摘抄原文或台词

每集包含：
- chapterNumber: 章节号
- title: 标题
- summary: 50字左右剧情概括
- characters: 主要人物数组
- scenes: 关键场景数组
- content: 详细情节描述(500-1000字，必须详细！)

输出JSON数组格式：
[{"chapterNumber":1,"title":"第1集","summary":"简短摘要","characters":["人物1","人物2"],"scenes":["场景1","场景2"],"content":"详细的情节描述，包括场景、对话要点、事件发展、情感变化等，500-1000字..."}]

注意：必须为每个指定的集数都生成章节信息。`;

  const episodeList = episodes.map(e => `第${e}集`).join('、');
  
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: `请为以下集数生成章节信息：${episodeList}\n\n剧本内容：\n${content}` }
  ];
  
  let response = '';
  try {
    const stream = oaiStream(messages, {
      temperature: 0.3,
    });
  
    for await (const chunk of stream) {
      if (chunk.content) response += chunk.content.toString();
    }
  } catch (error: any) {
    console.warn('章节批次模型生成失败，使用章节占位兜底:', error?.message || error);
    return {
      chapters: episodes.map(ep => ({
        chapterNumber: ep,
        title: `第${ep}集`,
        summary: '',
        characters: [],
        scenes: [],
        content: '',
      })),
      inputTokens: estimateMessagesTokens(messages),
      outputTokens: 0,
    };
  }
  
  // 解析章节
  const chapters: any[] = [];
  
  // 尝试解析为数组
  let parsed = tryExtractAndFixJSON(response);
  if (Array.isArray(parsed)) {
    chapters.push(...parsed);
  } else if (parsed && parsed.chapters && Array.isArray(parsed.chapters)) {
    chapters.push(...parsed.chapters);
  } else {
    // 使用正则提取
    const pattern = /\{\s*"chapterNumber"\s*:\s*(\d+)\s*,\s*"title"\s*:\s*"([^"]*)"\s*,\s*"summary"\s*:\s*"([^"]*)"/g;
    let match;
    while ((match = pattern.exec(response)) !== null) {
      chapters.push({
        chapterNumber: parseInt(match[1]),
        title: match[2] || `第${match[1]}集`,
        summary: match[3] || '',
        characters: [],
        scenes: [],
        content: ''
      });
    }
  }
  
  // 确保所有指定的集数都有对应的章节
  for (const ep of episodes) {
    if (!chapters.find(c => c.chapterNumber === ep)) {
      chapters.push({
        chapterNumber: ep,
        title: `第${ep}集`,
        summary: '',
        characters: [],
        scenes: [],
        content: ''
      });
    }
  }
  
  // 去除重复的 chapterNumber，保留第一个出现的
  const uniqueChapters = chapters.reduce((acc: any[], chapter) => {
    if (!acc.find(c => c.chapterNumber === chapter.chapterNumber)) {
      acc.push({
        ...chapter,
        title: getCanonicalEpisodeTitle(chapter.chapterNumber),
      });
    }
    return acc;
  }, []);
  
  // 按章节号排序
  uniqueChapters.sort((a, b) => a.chapterNumber - b.chapterNumber);
  
  return {
    chapters: uniqueChapters,
    inputTokens: estimateMessagesTokens(messages),
    outputTokens: estimateTokens(response),
  };
}

/**
 * 传统方式生成大纲（无集数标记时使用）
 */
async function generateOutlineTraditional(
  
  content: string,
  fileName: string
): Promise<any> {
  const systemPrompt = `你是剧本分析专家。分析剧本并完整拆分为分集大纲。

规则：
1. 优先遵循原文明确的分集或章节结构；没有明确标记时，再按剧情发展自然拆分。
2. 必须覆盖全文，不限制固定集数，不得漏掉后半部分，也不得把一句台词或转场标记单独当成一集。
3. 每集summary用50字左右概括剧情，不摘抄原文或台词。
4. content 字段必须详细描述该集的完整情节（500-1000字），包括场景描述、人物对话要点、关键事件发展、情感变化、冲突与转折。

输出JSON：
{"title":"标题","summary":"整体剧情概括100字左右","totalChapters":N,"chapters":[{"chapterNumber":1,"title":"第1集","summary":"50字左右剧情概括","characters":["人物"],"scenes":["场景"],"content":"详细的情节描述，包括场景、对话要点、事件发展、情感变化等，500-1000字..."}]}`;

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: `分析剧本提取大纲：\n文件：${fileName}\n内容：\n${content}` }
  ];
  
  let response = '';
  try {
    const stream = oaiStream(messages, {
      temperature: 0.3,
    });
  
    for await (const chunk of stream) {
      if (chunk.content) response += chunk.content.toString();
    }
  } catch (error: any) {
    console.warn('传统大纲模型生成失败，使用全文兜底:', error?.message || error);
    const summary = buildLocalChapterSummary(content);
    const chapterContent = content.substring(0, 8000);
    return {
      title: fileName.replace(/\.[^.]+$/, ''),
      summary,
      totalChapters: 1,
      chapters: [{
        chapterNumber: 1,
        title: '第1集',
        summary,
        characters: [],
        scenes: [],
        content: chapterContent,
      }],
      tokenUsage: {
        input: estimateMessagesTokens(messages),
        output: 0,
        timestamp: Date.now(),
      },
    };
  }
  
  const outline = tryExtractAndFixJSON(response);
  
  if (outline && outline.chapters) {
    const normalized = normalizeEpisodeChapterTitles(outline.chapters);
    outline.chapters = normalized.chapters;
    outline.totalChapters = normalized.chapters.length;
    outline.tokenUsage = {
      input: estimateMessagesTokens(messages),
      output: estimateTokens(response),
      timestamp: Date.now(),
    };
  }
  
  return outline;
}
