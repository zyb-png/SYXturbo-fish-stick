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

function isScriptExcerptText(text: string): boolean {
  const normalized = text.replace(/\s+/g, '');
  const scriptMarkers = [
    /剧情围绕/,
    /第[一二三四五六七八九十\d]+集/,
    /场景[:：]/,
    /出场人物/,
    /关键人物/,
    /对白[:：]/,
    /台词[:：]/,
    /（\d{1,3}岁/,
    /\(\d{1,3}岁/,
    /《[^》]{2,}》第[一二三四五六七八九十\d]+集/,
  ];

  if (scriptMarkers.some((pattern) => pattern.test(text))) return true;

  const commaCount = (normalized.match(/[，,、]/g) || []).length;
  const ageCount = (normalized.match(/\d{1,3}岁/g) || []).length;
  return commaCount >= 5 && ageCount >= 2;
}

function firstUsefulString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (!text) continue;
    if (text.includes('待补充') || text.includes('点击添加') || text === '描述') continue;
    if (isScriptExcerptText(text)) continue;
    return text;
  }
  return '';
}

function extractSceneContext(content: string, sceneName: string): string {
  const normalizedName = normalizeSceneNameForMatch(sceneName);
  const lines = content.split(/\r?\n/);
  const matchedIndexes: number[] = [];

  lines.forEach((line, index) => {
    const normalizedLine = normalizeSceneNameForMatch(line);
    if (
      line.includes(sceneName) ||
      (normalizedName && normalizedLine.includes(normalizedName))
    ) {
      matchedIndexes.push(index);
    }
  });

  if (matchedIndexes.length > 0) {
    const segments = matchedIndexes.slice(0, 3).map((index) => {
      const start = Math.max(0, index - 2);
      const end = Math.min(lines.length, index + 9);
      return lines.slice(start, end).join('\n');
    });
    return cleanContextText(segments.join('\n'));
  }

  const rawIndex = content.indexOf(sceneName);
  if (rawIndex >= 0) {
    return cleanContextText(content.slice(Math.max(0, rawIndex - 500), rawIndex + 1200));
  }

  return cleanContextText(content.slice(0, 1600));
}

function cleanContextText(text: string): string {
  return text
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1800);
}

function extractContextSentences(context: string, sceneName: string): string[] {
  const normalizedName = normalizeSceneNameForMatch(sceneName);
  return context
    .replace(/[“”"「」]/g, '')
    .split(/[。！？!?；;\n]/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => {
      if (sentence.length < 8 || sentence.length > 90) return false;
      if (/^(第?\d+[集章节幕场]?|人物|时间|地点|内|外|日|夜)$/i.test(sentence)) return false;
      const normalizedSentence = normalizeSceneNameForMatch(sentence);
      return !normalizedName || normalizedSentence !== normalizedName;
    })
    .slice(0, 3);
}

function inferVisualElements(sceneName: string, context: string, defaults: ReturnType<typeof inferSceneDefaults>): string[] {
  const source = `${sceneName}\n${context}`;
  const elements: string[] = [];
  const add = (value: string) => {
    if (!elements.includes(value)) elements.push(value);
  };

  const keywordMap: Array<[RegExp, string[]]> = [
    [/办公室|公司|会议室|工位|总裁|董事/i, ['办公桌椅', '玻璃隔断', '电脑文件', '冷色顶光']],
    [/医院|病房|诊所|走廊|护士/i, ['白色墙面', '病床器械', '走廊灯光', '消毒氛围']],
    [/家|客厅|卧室|厨房|房间|宿舍/i, ['生活家具', '暖色灯光', '门窗陈设', '日常杂物']],
    [/酒店|会所|餐厅|包厢|宴会/i, ['装饰灯光', '桌椅陈设', '精致软装', '空间纵深']],
    [/街|路|巷|门口|院子|公园|村/i, ['街道路面', '建筑外立面', '自然光影', '行人背景']],
    [/车|停车场|车库/i, ['车辆轮廓', '反光金属', '道路标线', '低位光源']],
    [/雨|夜/i, ['湿润地面', '暗部阴影', '反射光', '压低色温']],
  ];

  keywordMap.forEach(([pattern, values]) => {
    if (pattern.test(source)) values.forEach(add);
  });

  if (elements.length === 0) {
    if (defaults.type === '室外') {
      ['环境纵深', '自然光影', '空间层次'].forEach(add);
    } else {
      ['室内陈设', '主光源', '人物动线'].forEach(add);
    }
  }

  return elements.slice(0, 4);
}

function getSceneDisplayName(sceneName: string): string {
  return sceneName
    .replace(/[【\[]\s*(?:内|外|日|夜|白天|黑夜|晨|早|晚|黄昏)\s*[】\]]/g, '')
    .replace(/\s+(?:内|外|日|夜|白天|黑夜|晨|早|晚|黄昏)\s*$/g, '')
    .replace(/\s+/g, '')
    .trim() || sceneName.trim();
}

function inferLayoutDescription(sceneName: string, context: string, defaults: ReturnType<typeof inferSceneDefaults>): string {
  const source = `${sceneName}\n${context}`;
  if (/公馆|宅|别墅|豪宅|正厅|大厅/.test(source)) {
    return '空间开阔、有厅堂纵深，门廊、墙面和家具形成清晰的层次';
  }
  if (/办公室|公司|会议室|工位|董事|总裁/.test(source)) {
    return '空间以办公桌椅、玻璃隔断和文件设备构成，线条利落、秩序感强';
  }
  if (/医院|病房|诊所|走廊/.test(source)) {
    return '空间以洁净墙面、走廊纵深和医疗设施为主，视觉上偏冷静克制';
  }
  if (/家|客厅|卧室|厨房|宿舍|房间/.test(source)) {
    return '空间带有日常生活痕迹，家具、门窗和杂物让环境更真实';
  }
  if (/酒店|会所|餐厅|包厢|宴会/.test(source)) {
    return '空间有较强装饰感，桌椅、灯光和软装营造精致氛围';
  }
  if (defaults.type === '室外') {
    return '空间有明显前后景关系，建筑外立面、道路或自然环境形成纵深';
  }
  return '空间布局清晰，主要陈设和人物动线便于镜头调度';
}

function inferLightingDescription(sceneName: string, defaults: ReturnType<typeof inferSceneDefaults>): string {
  if (/夜|雨夜|黑夜/.test(sceneName) || defaults.timeOfDay === '夜晚') {
    return '光线以低照度和局部暖光为主，暗部阴影保留压迫感';
  }
  if (/晨|早|上午/.test(sceneName) || defaults.timeOfDay === '上午') {
    return '光线偏清晨或上午自然光，画面干净、层次柔和';
  }
  if (/晚|黄昏/.test(sceneName) || defaults.timeOfDay === '傍晚') {
    return '光线带有黄昏色温，明暗过渡柔和但情绪更浓';
  }
  return '光线保持真实自然，主次光源分明，方便突出人物表演';
}

function normalizeVisualAtmosphere(defaults: ReturnType<typeof inferSceneDefaults>): string {
  return defaults.atmosphere === '剧情推进' ? '克制、真实' : defaults.atmosphere;
}

function buildFallbackDescription(sceneName: string, content: string, defaults: ReturnType<typeof inferSceneDefaults>): string {
  const context = extractSceneContext(content, sceneName);
  const displayName = getSceneDisplayName(sceneName);
  const visualElements = inferVisualElements(sceneName, context, defaults).slice(0, 3).join('、');
  const layout = inferLayoutDescription(sceneName, context, defaults);
  const lighting = inferLightingDescription(sceneName, defaults);
  const atmosphere = normalizeVisualAtmosphere(defaults);
  const visualPart = visualElements || '空间布局、光线层次、人物动线';

  return `${displayName}是${defaults.type}场景，时间倾向${defaults.timeOfDay}，整体氛围偏${atmosphere}。${layout}，${lighting}。画面重点呈现${visualPart}，用于稳定后续场景图的环境质感与镜头空间。`;
}

function inferKeyEvents(sceneName: string, content: string): string[] {
  const context = extractSceneContext(content, sceneName);
  const sentences = extractContextSentences(context, sceneName);
  if (sentences.length > 0) return sentences.slice(0, 3);
  return [`${sceneName}中发生推动剧情发展的关键事件`];
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
    atmosphere: isNight ? '压抑、紧张' : '克制、真实',
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
2. description 字段只写“场景环境视觉描述”，必须描述空间布局、建筑/装饰风格、光线、色调、陈设、氛围等（50-100字）
3. description 不能摘录剧本文本，不能写第几集、场景标记、出场人物、年龄、剧情事件、台词、对白、人物动作
4. keyEvents 必须列出该场景中发生的关键剧情事件（至少1-3个）
5. visualElements 必须列出场景的视觉元素（如：家具、装饰、光线等）
6. 如果原文没有环境细节，请根据场景名称、内外景和时间推断合理的视觉环境，不要写“待补充”

每个场景包含：
- id: 序号
- name: 场景名称（必须与输入的场景名称完全一致）
- description: 场景环境描述（必须填写，只描述环境、空间、光线、陈设、氛围，不描述剧情和出场人物，50-100字）
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
      "description": "只描述场景的空间布局、建筑风格、光线色调、陈设和环境氛围，不摘录剧情内容",
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
    const defaultDescription = buildFallbackDescription(sceneName, content, defaults);
    const defaultVisualElements = inferVisualElements(sceneName, extractSceneContext(content, sceneName), defaults);
    const defaultKeyEvents = inferKeyEvents(sceneName, content);
    
    // 使用 sceneNames 的索引来生成全局唯一的 id
    const globalId = startId + idx + 1;
    
    if (matchedScene) {
      const matchedDescription = firstUsefulString(
        matchedScene.description,
        matchedScene.sceneDescription,
        matchedScene.visualDescription,
        matchedScene.environment,
        matchedScene.setting,
        matchedScene['场景描述'],
        matchedScene['描述'],
      );
      // 判断 description 是否有效：存在、非空、且不是默认的待补充文本
      const hasValidDescription = matchedDescription.length > 0 &&
        !matchedDescription.includes('待补充') &&
        !matchedDescription.includes('环境特点待补充');
      
      return {
        id: globalId,
        name: sceneName,
        description: hasValidDescription ? matchedDescription : defaultDescription,
        type: matchedScene.type || defaults.type,
        importance: matchedScene.importance || defaults.importance,
        timeOfDay: matchedScene.timeOfDay || defaults.timeOfDay,
        atmosphere: matchedScene.atmosphere || defaults.atmosphere,
        keyEvents: hasUsefulList(matchedScene.keyEvents)
          ? matchedScene.keyEvents 
          : defaultKeyEvents,
        visualElements: hasUsefulList(matchedScene.visualElements)
          ? matchedScene.visualElements 
          : defaultVisualElements,
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
        keyEvents: defaultKeyEvents,
        visualElements: defaultVisualElements,
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
4. description 只描述场景环境、空间、光线、陈设、氛围，不要摘录剧情、出场人物、年龄、台词或场景标记

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
    result.scenes = result.scenes.map((scene: any, index: number) => {
      const sceneName = firstUsefulString(scene?.name, scene?.sceneName, scene?.['场景名']) || `场景${index + 1}`;
      const defaults = inferSceneDefaults(sceneName);
      const description = firstUsefulString(
        scene?.description,
        scene?.sceneDescription,
        scene?.visualDescription,
        scene?.environment,
        scene?.setting,
        scene?.['场景描述'],
        scene?.['描述'],
      ) || buildFallbackDescription(sceneName, content, defaults);

      return {
        id: index + 1,
        name: sceneName,
        description,
        type: scene?.type || defaults.type,
        importance: scene?.importance || defaults.importance,
        timeOfDay: scene?.timeOfDay || defaults.timeOfDay,
        atmosphere: scene?.atmosphere || defaults.atmosphere,
        keyEvents: hasUsefulList(scene?.keyEvents) ? scene.keyEvents : inferKeyEvents(sceneName, content),
        visualElements: hasUsefulList(scene?.visualElements)
          ? scene.visualElements
          : inferVisualElements(sceneName, extractSceneContext(content, sceneName), defaults),
      };
    });
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
