import { NextRequest, NextResponse } from 'next/server';
import { stream as oaiStream, invoke as oaiInvoke } from '@/lib/openai-client';
import { estimateMessagesTokens, estimateTokens } from '@/lib/token-utils';
import { tryExtractAndFixJSON } from '@/lib/json-utils';

// 每批处理的章节数
const BATCH_SIZE = 5;

export async function POST(request: NextRequest) {
  try {
    const { content, fileName, batch = 1, episodeMarkers: clientEpisodeMarkers, basicInfo } = await request.json();

    if (!content) {
      return NextResponse.json(
        { error: '未提供文件内容' },
        { status: 400 }
      );
    }

    console.log(`开始提取大纲，文件: ${fileName}, 批次: ${batch}, 内容长度: ${content.length}`);

    // 初始化 LLM 客户端

    // 第一批：识别所有集数标记
    let episodeMarkers: Array<{ number: number; marker: string }> = [];
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
          episodeMarkers = clientEpisodeMarkers as Array<{ number: number; marker: string }>;
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

    // 从原文中提取每个章节的实际内容
    const batchResult = extractChapterContentFromOriginal(content, currentBatchEpisodes);
    
    const hasMore = batch < totalBatches;

    // 构建部分大纲（当前批次）
    const partialOutline = {
      title: scriptBasicInfo?.title || fileName.replace(/\.[^.]+$/, ''),
      summary: scriptBasicInfo?.summary || '',
      totalChapters: episodeMarkers.length,
      chapters: batchResult.chapters,
      tokenUsage: {
        input: batchResult.inputTokens,
        output: batchResult.outputTokens,
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
function extractEpisodeMarkers(content: string): Array<{ number: number; marker: string }> {
  const markers: Array<{ number: number; marker: string }> = [];
  const seen = new Set<number>();  // 用于去重
  
  // 匹配各种集数格式
  const patterns: Array<{ pattern: RegExp; extractNumber: (match: RegExpExecArray) => number; extractMarker: (match: RegExpExecArray) => string }> = [
    { 
      pattern: /第(\d+)集/g,
      extractNumber: (match) => parseInt(match[1]),
      extractMarker: (match) => match[0]
    },
    { 
      pattern: /第([一二三四五六七八九十百千]+)集/g,
      extractNumber: (match) => chineseToNumberMap(match[1]),
      extractMarker: (match) => match[0]
    },
    { 
      pattern: /Episode\s*(\d+)/gi,
      extractNumber: (match) => parseInt(match[1]),
      extractMarker: (match) => match[0]
    },
    { 
      pattern: /EP\.?\s*(\d+)/gi,
      extractNumber: (match) => parseInt(match[1]),
      extractMarker: (match) => match[0]
    },
    { 
      pattern: /第(\d+)章/g,
      extractNumber: (match) => parseInt(match[1]),
      extractMarker: (match) => match[0]
    },
    // 添加方括号格式
    {
      pattern: /\[\s*(\d+)\s*\]/g,
      extractNumber: (match) => parseInt(match[1]),
      extractMarker: (match) => match[0]
    },
  ];
  
  // 中文数字映射
  function chineseToNumberMap(chinese: string): number {
    const map: Record<string, number> = {
      '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
      '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
      '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15,
      '十六': 16, '十七': 17, '十八': 18, '十九': 19, '二十': 20,
      '二十一': 21, '二十二': 22, '二十三': 23, '二十四': 24, '二十五': 25,
      '二十六': 26, '二十七': 27, '二十八': 28, '二十九': 29, '三十': 30,
      '三十一': 31, '三十二': 32, '三十三': 33, '三十四': 34, '三十五': 35,
      '三十六': 36, '三十七': 37, '三十八': 38, '三十九': 39, '四十': 40,
      '四十一': 41, '四十二': 42, '四十三': 43, '四十四': 44, '四十五': 45,
      '四十六': 46, '四十七': 47, '四十八': 48, '四十九': 49, '五十': 50,
      '五十一': 51, '五十二': 52, '五十三': 53, '五十四': 54, '五十五': 55,
      '五十六': 56, '五十七': 57, '五十八': 58, '五十九': 59, '六十': 60,
      '六十一': 61, '六十二': 62, '六十三': 63, '六十四': 64, '六十五': 65,
      '六十六': 66, '六十七': 67, '六十八': 68, '六十九': 69, '七十': 70,
      '七十一': 71, '七十二': 72, '七十三': 73, '七十四': 74, '七十五': 75,
      '七十六': 76, '七十七': 77, '七十八': 78, '七十九': 79, '八十': 80,
      '八十一': 81, '八十二': 82, '八十三': 83, '八十四': 84, '八十五': 85,
      '八十六': 86, '八十七': 87, '八十八': 88, '八十九': 89, '九十': 90,
      '九十一': 91, '九十二': 92, '九十三': 93, '九十四': 94, '九十五': 95,
      '九十六': 96, '九十七': 97, '九十八': 98, '九十九': 99, '一百': 100,
    };
    return map[chinese] || 0;
  }
  
  // 执行所有匹配
  for (const { pattern, extractNumber, extractMarker } of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const number = extractNumber(match);
      if (number > 0 && !seen.has(number)) {
        seen.add(number);
        markers.push({
          number,
          marker: extractMarker(match)
        });
      }
    }
  }
  
  // 按数字排序
  markers.sort((a, b) => a.number - b.number);
  
  return markers;
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

function isValidChapterTitleCandidate(line: string, markerPattern: RegExp): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length > 2 &&
    trimmed.length < 50 &&
    !markerPattern.test(trimmed) &&
    !isLikelyDialogueLine(trimmed) &&
    !isLikelySceneOrActionLine(trimmed)
  );
}

/**
 * 提取剧本基本信息
 */
async function extractBasicInfo( content: string, fileName: string): Promise<any> {
  const systemPrompt = `提取剧本的基本信息。只返回JSON格式：{"title":"标题","summary":"摘要100字"}`;
  
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
    const summary = content
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 100);
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

/**
 * 从原文中提取每个章节的实际内容
 * 根据章节标记（如"第1集"）分割原文，获取每个章节的实际文本
 */
function extractChapterContentFromOriginal(
  content: string,
  episodes: Array<{ number: number; marker: string }>
): { chapters: any[]; inputTokens: number; outputTokens: number } {
  const chapters: any[] = [];
  
  console.log(`[章节提取] 开始提取章节内容，总长度: ${content.length}`);
  console.log(`[章节提取] 需要提取的集数:`, episodes.map(e => `[${e.number}] ${e.marker}`).join(', '));
  
  // 找到每个章节标记的位置（使用实际标记文本）
  const positions: { ep: number; marker: string; start: number; end: number }[] = [];
  
  for (const { number, marker } of episodes) {
    const index = content.indexOf(marker);
    if (index !== -1) {
      console.log(`[章节提取] 找到章节标记: 第${number}集 "${marker}"，位置: ${index}`);
      positions.push({
        ep: number,
        marker,
        start: index,
        end: index + marker.length
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
    const contentEnd = next ? next.start : content.length;
    
    // 提取章节内容
    let chapterContent = content.substring(contentStart, contentEnd).trim();
    
    // 如果提取的内容为空，尝试从标记之前提取
    if (chapterContent.length === 0 && next) {
      // 尝试从前一个章节到当前章节之间提取
      const prev = positions[i - 1];
      if (prev) {
        const altStart = prev.end;
        const altEnd = current.start;
        chapterContent = content.substring(altStart, altEnd).trim();
        console.log(`[章节提取] 使用备用方案提取第${current.ep}集内容，长度: ${chapterContent.length}`);
      }
    }
    
    console.log(`[章节提取] 第${current.ep}集提取内容长度: ${chapterContent.length}`);
    
    // 提取章节标题（从标记位置往前找标题，或者使用默认标题）
    const titleStart = Math.max(0, current.start - 100);
    const titleArea = content.substring(titleStart, current.end);
    
    // 尝试提取标题（通常在章节标记前一行）
    const lines = titleArea.split('\n');
    let title = `第${current.ep}集`;
    const markerPattern = new RegExp(current.marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    for (const line of lines) {
      const trimmed = line.trim();
      if (isValidChapterTitleCandidate(trimmed, markerPattern)) {
        title = trimmed;
      }
    }
    
    // 截取内容长度限制（避免太长）
    // 保留最多 8000 字符用于分镜生成
    if (chapterContent.length > 8000) {
      chapterContent = chapterContent.substring(0, 8000) + '...';
    }
    
    // 生成摘要（取前200字）
    const summary = chapterContent.substring(0, 200).replace(/\n/g, ' ').trim();
    
    // 如果内容仍然为空，添加默认内容
    if (chapterContent.length === 0) {
      chapterContent = summary || '该章节内容较少，建议手动补充';
      console.warn(`[章节提取] 第${current.ep}集内容为空，使用默认内容`);
    }
    
    chapters.push({
      chapterNumber: current.ep,
      title: title,
      summary: summary.length > 50 ? summary.substring(0, 50) + '...' : summary,
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
        summary: '未能从原文中提取该章节内容',
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

每集包含：
- chapterNumber: 章节号
- title: 标题
- summary: 摘要(50字内)
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
      acc.push(chapter);
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
  const systemPrompt = `你是剧本分析专家。分析剧本并拆分章节。

规则：
1. 按情节发展拆分章节，最多10个章节
2. 章节摘要控制在50字以内
3. content 字段必须详细描述该章节的完整情节（500-1000字），包括场景描述、人物对话要点、关键事件发展、情感变化、冲突与转折

输出JSON：
{"title":"标题","summary":"摘要100字","totalChapters":N,"chapters":[{"chapterNumber":1,"title":"章节标题","summary":"摘要50字","characters":["人物"],"scenes":["场景"],"content":"详细的情节描述，包括场景、对话要点、事件发展、情感变化等，500-1000字..."}]}`;

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
    const summary = content.replace(/\s+/g, ' ').trim().substring(0, 100);
    const chapterContent = content.substring(0, 8000);
    return {
      title: fileName.replace(/\.[^.]+$/, ''),
      summary,
      totalChapters: 1,
      chapters: [{
        chapterNumber: 1,
        title: '第1章',
        summary: summary.substring(0, 50),
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
    outline.totalChapters = outline.chapters.length;
    outline.tokenUsage = {
      input: estimateMessagesTokens(messages),
      output: estimateTokens(response),
      timestamp: Date.now(),
    };
  }
  
  return outline;
}
