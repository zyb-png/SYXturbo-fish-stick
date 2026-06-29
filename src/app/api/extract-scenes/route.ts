import { NextRequest, NextResponse } from 'next/server';
import { stream as oaiStream, invoke as oaiInvoke } from '@/lib/openai-client';
import { estimateMessagesTokens, estimateTokens } from '@/lib/token-utils';
import { tryExtractAndFixJSON, removeControlCharsInStrings } from '@/lib/json-utils';
import { requireUserLoginResponse } from '@/lib/auth-guard';

// 每批处理的场景数
const BATCH_SIZE = 8;

export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const { content, fileName, batch = 0, sceneMarkers } = await request.json();

    if (!content) {
      return NextResponse.json(
        { error: '未提供文件内容' },
        { status: 400 }
      );
    }

    console.log(`开始提取场景，文件: ${fileName}, 批次: ${batch}, 内容长度: ${content.length}`);

    // 初始化 LLM 客户端

    // 第一批或没有场景标记时：识别所有场景名称
    let allSceneMarkers: string[] = sceneMarkers || [];
    
    if (batch <= 1 || !sceneMarkers || sceneMarkers.length === 0) {
      // 识别场景标记
      allSceneMarkers = await identifySceneMarkers(content, fileName);
      console.log(`识别到 ${allSceneMarkers.length} 个场景:`, allSceneMarkers);
    }

    if (allSceneMarkers.length === 0) {
      // 如果没有识别到场景标记，使用传统方式
      const result = await extractScenesTraditional(content, fileName);
      return NextResponse.json({
        success: true,
        type: 'scenes',
        data: result,
        batchInfo: {
          currentBatch: 1,
          totalBatches: 1,
          hasMore: false,
        },
        tokenUsage: result.tokenUsage,
      });
    }

    // 分批提取场景详情
    const totalBatches = Math.ceil(allSceneMarkers.length / BATCH_SIZE);
    // 确保 batch 至少为 1
    const currentBatch = Math.max(1, batch);
    const currentBatchStart = (currentBatch - 1) * BATCH_SIZE;
    const currentBatchScenes = allSceneMarkers.slice(currentBatchStart, currentBatchStart + BATCH_SIZE);
    
    console.log(`处理第 ${currentBatch}/${totalBatches} 批，场景: ${currentBatchScenes.join(', ')}`);

    // 提取当前批次的场景详情，传入起始 id 确保全局唯一
    const startId = currentBatchStart; // 使用批次的起始索引作为起始 id
    const batchResult = await extractBatchScenes(content, currentBatchScenes, startId);
    
    const hasMore = currentBatch < totalBatches;

    return NextResponse.json({
      success: true,
      type: 'scenes',
      data: {
        totalScenes: allSceneMarkers.length,
        scenes: batchResult.scenes,
      },
      batchInfo: {
        currentBatch: currentBatch,
        totalBatches,
        hasMore,
        sceneMarkers: allSceneMarkers,
      },
      tokenUsage: batchResult.tokenUsage,
    });
  } catch (error: any) {
    console.error('场景提取失败:', error);
    console.error('错误详情:', error?.message);
    return NextResponse.json(
      { error: '场景提取失败', details: error?.message },
      { status: 500 }
    );
  }
}

/**
 * 识别所有场景名称
 */
async function identifySceneMarkers( content: string, fileName: string): Promise<string[]> {
  const localScenes = extractLocalSceneNames(content);
  if (localScenes.length > 0) {
    console.log(`从剧本结构识别到 ${localScenes.length} 个场景:`, localScenes);
  }

  const systemPrompt = `你是一个专业的影视场景分析师。请分析文本，识别所有独特的场景名称。

**重要规则**：
1. 只返回场景名称数组，不要返回其他内容
2. 场景名称应该简洁明确（如：办公室、医院走廊、公园等）
3. 合并相同场景的不同叫法（如"医院大厅"和"医院走廊"可以合并为"医院"）
4. 按出场顺序排列
5. 不要遗漏文本中出现的场景

输出JSON数组格式：
["场景1", "场景2", "场景3"]`;

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: `请识别以下文本中的所有场景名称：\n\n文件名：${fileName}\n\n内容：\n${content.substring(0, 50000)}` }
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
    console.warn('场景名称模型识别失败，使用本地兜底:', error?.message || error);
    return localScenes;
  }

  let modelScenes: string[] = [];

  // 清理响应内容，移除 markdown 代码块标记
  let cleanedResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  // 如果响应以数组开始，直接尝试解析（先清理控制字符）
  if (cleanedResponse.startsWith('[')) {
    try {
      // 关键修复：先清理控制字符再解析
      const sanitizedResponse = removeControlCharsInStrings(cleanedResponse);
      const parsed = JSON.parse(sanitizedResponse);
      if (Array.isArray(parsed)) {
        modelScenes = parsed.filter((s): s is string => typeof s === 'string');
      }
    } catch (e) {
      console.log('场景名称数组解析失败:', e);
      // 解析失败，继续尝试其他方法
    }
  }

  // 解析场景名称数组
  if (modelScenes.length === 0) {
    const result = tryExtractAndFixJSON(response);
    if (Array.isArray(result)) {
      modelScenes = result.filter((s): s is string => typeof s === 'string');
    }
  }
  
  // 尝试用正则提取
  if (modelScenes.length === 0) {
    const matches = response.match(/"([^"]+)"/g);
    if (matches) {
      modelScenes = matches.map(m => m.replace(/"/g, '')).filter(s => s.length > 0 && s.length < 50);
    }
  }

  const mergedScenes = mergeSceneNames(localScenes, modelScenes);
  console.log(`合并场景名称: 本地 ${localScenes.length} 个，模型 ${modelScenes.length} 个，合并后 ${mergedScenes.length} 个`);
  return mergedScenes;
}

function mergeSceneNames(...sceneGroups: string[][]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const group of sceneGroups) {
    for (const rawName of group) {
      if (typeof rawName !== 'string') continue;
      const name = rawName.trim();
      const normalizedName = normalizeSceneNameForMatch(name);
      if (!name || !normalizedName || seen.has(normalizedName)) continue;
      seen.add(normalizedName);
      names.push(name);
    }
  }

  return names;
}

function extractLocalSceneNames(content: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const addName = (rawName: string) => {
    const name = rawName
      .replace(/（.*?）/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/[，,。；;].*$/g, '')
      .replace(/\s+(日|夜|晨|早|晚|上午|下午|黄昏|内|外).*$/g, '')
      .trim();

    if (name && name.length <= 30 && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  };

  const tagPatterns = [
    /【场景】([^【\n\r]+)/g,
    /场景[:：]([^。\n\r]+)/g,
  ];

  for (const pattern of tagPatterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      addName(match[1]);
    }
  }

  const headingPattern = /^\s*\d+[-—]\d+\s*([^\n\r]+?)(?:\s+(?:日|夜|晨|早|晚|上午|下午|黄昏|内|外)|\s+人物[:：]|$)/gm;
  let headingMatch: RegExpExecArray | null;
  while ((headingMatch = headingPattern.exec(content)) !== null) {
    addName(headingMatch[1]);
  }

  return names;
}

function normalizeSceneNameForMatch(rawName: unknown): string {
  if (typeof rawName !== 'string') return '';
  return rawName
    .replace(/[【】]/g, '')
    .replace(/\[[^\]]*]/g, '')
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s*(?:内|外|日|夜|晨|早|晚|上午|下午|黄昏|雨夜|白天|黑夜)\s*$/g, '')
    .replace(/[，,。；;：:、\s]+/g, '')
    .trim();
}

function findMatchingScene(scenes: any[], sceneName: string) {
  const normalizedName = normalizeSceneNameForMatch(sceneName);
  return scenes.find((scene) => {
    if (!scene || typeof scene.name !== 'string') return false;
    if (scene.name === sceneName) return true;
    const normalizedScene = normalizeSceneNameForMatch(scene.name);
    return normalizedScene === normalizedName || normalizedScene.includes(normalizedName) || normalizedName.includes(normalizedScene);
  });
}

function hasUsefulList(value: unknown): value is string[] {
  return Array.isArray(value) && value.some((item) => typeof item === 'string' && item.trim() && !item.includes('待补充'));
}

function inferSceneDefaults(sceneName: string) {
  const isExterior = /外|室外|马路|街|巷|院子|门口|公园|村头/.test(sceneName);
  const isNight = /夜|雨夜|黑夜/.test(sceneName);
  const isMorning = /晨|早|上午/.test(sceneName);
  const isEvening = /晚|黄昏/.test(sceneName);

  return {
    type: isExterior ? '室外' : '室内',
    timeOfDay: isNight ? '夜晚' : isMorning ? '上午' : isEvening ? '傍晚' : '白天',
    importance: '次要场景',
    atmosphere: isNight ? '压抑、紧张' : '剧情推进',
  };
}

/**
 * 提取一批场景的详细信息
 */
async function extractBatchScenes(
  
  content: string,
  sceneNames: string[],
  startId: number = 0  // 全局起始 id，确保不同批次的场景 id 不重复
): Promise<{ scenes: any[]; tokenUsage: any }> {
  const systemPrompt = `你是专业的影视场景分析师。为指定的场景生成详细信息。

**重要规则**：
1. 必须为每个场景生成完整的描述信息，不要遗漏任何字段
2. description 字段必须详细描述场景的视觉特点、环境氛围、建筑风格等（至少50字）
3. 如果文本中没有详细描述，请根据场景名称和剧情上下文推断合理的描述
4. keyEvents 必须列出该场景中发生的关键剧情事件（至少1-3个）
5. visualElements 必须列出场景的视觉元素（如：家具、装饰、光线等）

每个场景包含：
- id: 序号
- name: 场景名称（必须与输入的场景名称完全一致）
- description: 场景详细描述（必须填写，描述视觉特点、环境、氛围等，50-100字）
- type: 室内/室外/虚拟（必须填写）
- importance: 主要场景/次要场景/过渡场景（必须填写）
- timeOfDay: 时间设定（如：白天、夜晚、黄昏等）
- atmosphere: 氛围特点（如：紧张、温馨、神秘等）
- keyEvents: 关键事件数组（至少1个，描述在该场景发生的重要事件）
- visualElements: 视觉元素数组（至少2个，描述场景中的视觉元素）

输出JSON格式：
{
  "scenes": [
    {
      "id": 1,
      "name": "场景名称",
      "description": "详细描述场景的视觉特点、环境布局、建筑风格等",
      "type": "室内",
      "importance": "主要场景",
      "timeOfDay": "白天",
      "atmosphere": "紧张",
      "keyEvents": ["发生的关键事件1", "关键事件2"],
      "visualElements": ["视觉元素1", "视觉元素2"]
    }
  ]
}`;

  const sceneList = sceneNames.map((s, i) => `${i + 1}. ${s}`).join('\n');
  
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: `请为以下场景生成详细信息：\n${sceneList}\n\n参考文本：\n${content.substring(0, 30000)}` }
  ];

  let response = '';
  try {
    const stream = oaiStream(messages, {
      temperature: 0.5,
    });

    for await (const chunk of stream) {
      if (chunk.content) response += chunk.content.toString();
    }
  } catch (error: any) {
    console.warn('场景详情模型提取失败，使用默认场景详情:', error?.message || error);
  }

  const result = tryExtractAndFixJSON(response);
  const scenes: any[] = [];

  if (result && result.scenes && Array.isArray(result.scenes) && result.scenes.length > 0) {
    scenes.push(...result.scenes);
    console.log(`JSON 解析成功，提取到 ${scenes.length} 个场景`);
  } else if (Array.isArray(result) && result.length > 0) {
    scenes.push(...result);
    console.log(`JSON 解析为数组，提取到 ${scenes.length} 个场景`);
  } else {
    console.log(`JSON 解析失败或结果为空，将基于 sceneNames (${sceneNames.length} 个) 生成默认数据`);
  }

  // 确保所有场景都有完整的字段，生成有意义的默认值
  // 重要：使用 sceneNames 的顺序来分配 id，确保名称和 id 正确对应
  const completeScenes = sceneNames.map((sceneName, idx) => {
    // 尝试从 LLM 返回的数据中找到匹配的场景
    const matchedScene = findMatchingScene(scenes, sceneName);
    const defaults = inferSceneDefaults(sceneName);
    const defaultDescription = `该场景为"${sceneName}"，具体环境特点待补充描述。请根据剧本内容补充该场景的视觉特点、环境布局、氛围等信息。`;
    
    // 使用 sceneNames 的索引来生成全局唯一的 id
    const globalId = startId + idx + 1;
    
    if (matchedScene) {
      // 判断 description 是否有效：存在、非空、且不是默认的待补充文本
      const hasValidDescription = matchedScene.description && 
        matchedScene.description.trim().length > 0 &&
        !matchedScene.description.includes('待补充') &&
        !matchedScene.description.includes('环境特点待补充');
      
      return {
        id: globalId,
        name: sceneName,
        description: hasValidDescription ? matchedScene.description : defaultDescription,
        type: matchedScene.type || defaults.type,
        importance: matchedScene.importance || defaults.importance,
        timeOfDay: matchedScene.timeOfDay || defaults.timeOfDay,
        atmosphere: matchedScene.atmosphere || defaults.atmosphere,
        keyEvents: hasUsefulList(matchedScene.keyEvents)
          ? matchedScene.keyEvents 
          : ['待补充关键事件'],
        visualElements: hasUsefulList(matchedScene.visualElements)
          ? matchedScene.visualElements 
          : ['待补充视觉元素'],
      };
    } else {
      // 没有找到匹配的场景，生成默认数据
      return {
        id: globalId,
        name: sceneName,
        description: defaultDescription,
        type: defaults.type,
        importance: defaults.importance,
        timeOfDay: defaults.timeOfDay,
        atmosphere: defaults.atmosphere,
        keyEvents: ['待补充关键事件'],
        visualElements: ['待补充视觉元素'],
      };
    }
  });

  console.log(`extractBatchScenes 完成: sceneNames=${sceneNames.length}, completeScenes=${completeScenes.length}`);

  return {
    scenes: completeScenes.slice(0, sceneNames.length),
    tokenUsage: {
      input: estimateMessagesTokens(messages),
      output: estimateTokens(response),
      timestamp: Date.now(),
    },
  };
}

/**
 * 传统方式提取场景（无场景标记时使用）
 */
async function extractScenesTraditional(
  
  content: string,
  fileName: string
): Promise<any> {
  const systemPrompt = `你是一个专业的影视场景分析师。分析文本提取所有场景。

规则：
1. 提取所有独特场景
2. 合并相同场景的不同叫法
3. 不要遗漏文本中出现的场景

输出JSON：
{
  "totalScenes": N,
  "scenes": [
    {
      "id": 1,
      "name": "场景名",
      "description": "描述",
      "type": "室内/室外",
      "importance": "主要/次要/过渡",
      "timeOfDay": "时间",
      "atmosphere": "氛围",
      "keyEvents": ["事件"],
      "visualElements": ["元素"]
    }
  ]
}`;

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: `分析文本提取场景：\n文件：${fileName}\n内容：\n${content}` }
  ];

  let response = '';
  try {
    const stream = oaiStream(messages, {
      temperature: 0.5,
    });

    for await (const chunk of stream) {
      if (chunk.content) response += chunk.content.toString();
    }
  } catch (error: any) {
    console.warn('传统场景模型提取失败，使用本地兜底:', error?.message || error);
    const localScenes = extractLocalSceneNames(content);
    const fallback = await extractBatchScenes(content, localScenes, 0);
    return {
      totalScenes: fallback.scenes.length,
      scenes: fallback.scenes,
      tokenUsage: fallback.tokenUsage,
    };
  }

  const result = tryExtractAndFixJSON(response);
  
  if (result && result.scenes && Array.isArray(result.scenes)) {
    result.totalScenes = result.scenes.length;
    result.tokenUsage = {
      input: estimateMessagesTokens(messages),
      output: estimateTokens(response),
      timestamp: Date.now(),
    };
    return result;
  }

  // 如果解析失败，返回空结果
  return {
    totalScenes: 0,
    scenes: [],
    tokenUsage: {
      input: estimateMessagesTokens(messages),
      output: estimateTokens(response),
      timestamp: Date.now(),
    },
  };
}
