import { NextRequest, NextResponse } from 'next/server';
import { stream as oaiStream, invoke as oaiInvoke } from '@/lib/openai-client';
import { estimateMessagesTokens, estimateTokens } from '@/lib/token-utils';
import { tryExtractAndFixJSON, removeControlCharsInStrings } from '@/lib/json-utils';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import { mapWithConcurrency, selectEvenlySpaced, splitTextForFullScan } from '@/lib/full-text-scan';
import { normalizeSceneMarkerIdentity, normalizeSceneStateUnits } from '@/lib/scene-state-utils';
import { buildCreationStyleInstruction } from '@/lib/creation-style-presets';

export const maxDuration = 600;

// 每批处理的场景数
const BATCH_SIZE = 8;
const FULL_SCAN_CONCURRENCY = 2;

type CreationBible = {
  creationType?: string;
  subjectRegion?: string;
  creationBackground?: string;
  creativeStyle?: string;
};

type SceneOccurrence = {
  episodeNumber: number | null;
  episodeLabel: string;
  heading: string;
  stateLabel: string;
};

function buildCreationBibleInstruction(creationBible?: CreationBible): string {
  const creationType = typeof creationBible?.creationType === 'string' ? creationBible.creationType.trim() : '';
  const subjectRegion = typeof creationBible?.subjectRegion === 'string' ? creationBible.subjectRegion.trim() : '';
  const creationBackground = typeof creationBible?.creationBackground === 'string'
    ? creationBible.creationBackground.trim()
    : '';
  const creativeStyleInstruction = buildCreationStyleInstruction(creationBible?.creativeStyle);
  if (!creationType && !subjectRegion && !creationBackground && !creativeStyleInstruction) return '';

  const lines = ['【创作圣经约束】'];
  if (creationType === '仿真人') {
    lines.push('创作类型：仿真人。场景描述要服务真人实拍质感，强调真实空间、真实材质、可拍摄灯光和电影摄影，不要动漫化或CG塑料感。');
  } else if (creationType === '3D') {
    lines.push('创作类型：3D。场景描述要服务3D/CG制作，强调空间结构、模型材质、体积光、可建模陈设和统一渲染质感，不要写成真人照片。');
  } else if (creationType === '动漫') {
    lines.push('创作类型：动漫。场景描述要服务动漫/动画画面，强调线条、色块、构图层次、动画美术风格和氛围色彩，不要写成真人照片。');
  }
  if (subjectRegion === '国内') {
    lines.push('创作题材：国内。环境、建筑、陈设、生活细节、标识与社会关系应符合中国本土语境。');
  } else if (subjectRegion === '国外') {
    lines.push('创作题材：国外。环境、建筑、陈设、生活方式、服饰和文化细节应符合海外/国际化语境。');
  }
  if (creationBackground === '近代') {
    lines.push('创作背景：近代。建筑、街道、室内陈设、交通、照明、标识、材料与生活设施应符合近代社会及早期工业化年代质感。');
  } else if (creationBackground === '现代') {
    lines.push('创作背景：现代。建筑、室内陈设、交通、通讯、照明、标识、材料与生活设施应符合现代社会语境。');
  } else if (creationBackground === '古代') {
    lines.push('创作背景：古代。建筑形制、室内陈设、道路、交通、照明、标识、材料与生活设施应符合古代制度和传统工艺，禁止无剧情依据的现代科技元素。');
  }
  if (creativeStyleInstruction) lines.push(creativeStyleInstruction);
  lines.push('这些约束只影响视觉风格、题材语境和时代背景，不允许改动原剧情、人物关系和关键事件；如剧本明确存在回忆、年代跳转或穿越，按原剧情呈现相应时期。');
  return lines.join('\n');
}

export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const { content, fileName, batch = 0, sceneMarkers, creationBible, sourceType } = await request.json();

    if (sourceType !== 'execution-script') {
      return NextResponse.json(
        { error: '场景提取仅允许使用当前执行剧本，请先重新拉取执行剧本' },
        { status: 400 }
      );
    }

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
      const result = await extractScenesTraditional(content, fileName, creationBible);
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
    const batchResult = await extractBatchScenes(content, currentBatchScenes, startId, creationBible, allSceneMarkers);
    
    const hasMore = currentBatch < totalBatches;

    return NextResponse.json({
      success: true,
      type: 'scenes',
      data: {
        totalScenes: allSceneMarkers.length,
        totalMainScenes: buildSceneGroups(batchResult.scenes).length,
        scenes: batchResult.scenes,
        sceneGroups: buildSceneGroups(batchResult.scenes),
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
3. 先识别主要物理场景，再判断是否存在真正需要单独制作场景图的状态。只有以下情况拆成新状态：明确的日戏/夜戏切换；明确的年代跨度；改造、拆除、毁坏、重建、长期废弃等会延续并影响后续剧情的重大持久变化
4. 按出场顺序排列
5. 不要遗漏文本中出现的场景
6. 同一地点重复出现、上午/下午变化、天气变化、人物进出、镜头角度变化、情绪变化、临时增加或减少道具，都不算新的场景状态，必须合并
7. “客厅中/客厅”“公司前台区域/公司前台”等称呼差异不是状态；不要因为状态不同而改写主要场景名，状态写在括号里
8. 建议场景名称带有效状态后缀，例如：顾公馆正厅（白天）、顾公馆正厅（夜晚）、公司宿舍（10年前）、公司宿舍（10年后）、旧厂房（拆除后）
9. 对“院子/院子外/家里院子”“大厅/大厅中”等近似称呼，必须结合场次上下文判断物理空间；确认是同一布景时只保留一个稳定主场景名，只有明确切到院门外街道等独立空间时才拆开

输出JSON数组格式：
["场景1", "场景2", "场景3"]`;

  const chunks = splitTextForFullScan(content);
  const modelSceneGroups = await mapWithConcurrency(chunks, FULL_SCAN_CONCURRENCY, async chunk => {
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      {
        role: 'user' as const,
        content: `这是完整剧本的第 ${chunk.index}/${chunk.total} 段（字符 ${chunk.start}-${chunk.end}）。请识别本段出现的全部场景和状态场景，不要因它们可能在其他段出现而省略。\n\n文件名：${fileName}\n\n本段内容：\n${chunk.text}`,
      },
    ];

    let response = '';
    try {
      const stream = oaiStream(messages, { temperature: 0.3 });
      for await (const responseChunk of stream) {
        if (responseChunk.content) response += responseChunk.content.toString();
      }
      return parseSceneMarkerResponse(response);
    } catch (error: any) {
      console.warn(`场景名称模型识别第 ${chunk.index}/${chunk.total} 段失败，保留其他段和本地结果:`, error?.message || error);
      return [];
    }
  });

  const mergedScenes = mergeSceneNames(localScenes, ...modelSceneGroups);
  const modelSceneCount = modelSceneGroups.reduce((sum, scenes) => sum + scenes.length, 0);
  console.log(`全文场景名称合并: ${chunks.length} 段，本地 ${localScenes.length} 个，模型原始 ${modelSceneCount} 个，合并后 ${mergedScenes.length} 个`);
  return mergedScenes;
}

function parseSceneMarkerResponse(response: string): string[] {
  const cleanedResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  if (cleanedResponse.startsWith('[')) {
    try {
      const parsed = JSON.parse(removeControlCharsInStrings(cleanedResponse));
      if (Array.isArray(parsed)) {
        return parsed.filter((scene): scene is string => typeof scene === 'string');
      }
    } catch (error) {
      console.log('场景名称数组解析失败，尝试修复解析:', error);
    }
  }

  const repaired = tryExtractAndFixJSON(response);
  if (Array.isArray(repaired)) {
    return repaired.filter((scene): scene is string => typeof scene === 'string');
  }

  const matches = response.match(/"([^"]+)"/g);
  return matches
    ? matches.map(match => match.replace(/"/g, '')).filter(scene => scene.length > 0 && scene.length < 50)
    : [];
}

function mergeSceneNames(...sceneGroups: string[][]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const group of sceneGroups) {
    for (const rawName of group) {
      if (typeof rawName !== 'string') continue;
      const name = rawName.trim();
      const normalizedName = normalizeSceneMarkerIdentity(name) || normalizeSceneNameForIdentity(name);
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
      .replace(/[，,。；;].*$/g, '')
      .replace(/\s+(?:人物|角色|道具|出场人物|关键事件)[:：].*$/g, '')
      .trim();

    if (name && name.length <= 50 && !seen.has(name)) {
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

  const headingPattern = /^\s*\d+[-—]\d+\s*([^\n\r]+)/gm;
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

function normalizeSceneNameForIdentity(rawName: unknown): string {
  if (typeof rawName !== 'string') return '';
  return rawName
    .replace(/[【】\[\]（）()]/g, '')
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

function hasNumberList(value: unknown): value is number[] {
  return Array.isArray(value) && value.some((item) => typeof item === 'number' && Number.isFinite(item));
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
    const segments = selectEvenlySpaced(matchedIndexes, 6).map((index) => {
      const start = Math.max(0, index - 2);
      const end = Math.min(lines.length, index + 9);
      return lines.slice(start, end).join('\n');
    });
    return cleanContextText(segments.join('\n\n--- 不同出现场次 ---\n\n'), 3200);
  }

  const rawIndex = content.indexOf(sceneName);
  if (rawIndex >= 0) {
    return cleanContextText(content.slice(Math.max(0, rawIndex - 500), rawIndex + 1200));
  }

  return cleanContextText(content.slice(0, 1600));
}

function cleanContextText(text: string, maxLength = 1800): string {
  return text
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
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

function getPhysicalLocationName(sceneName: string): string {
  return sceneName
    .replace(/[【\[]\s*(?:内|外|日|夜|白天|黑夜|晨|早|晚|黄昏|雨夜|上午|下午)\s*[】\]]/g, '')
    .replace(/（\s*(?:内|外|日|夜|白天|黑夜|晨|早|晚|黄昏|雨夜|上午|下午|10年前|十年前|10年后|十年后|改造前|改造后|破败|焕新)\s*）/g, '')
    .replace(/\(\s*(?:内|外|日|夜|白天|黑夜|晨|早|晚|黄昏|雨夜|上午|下午|10年前|十年前|10年后|十年后|改造前|改造后|破败|焕新)\s*\)/g, '')
    .replace(/\s+(?:内|外|日|夜|白天|黑夜|晨|早|晚|黄昏|雨夜|上午|下午|10年前|十年前|10年后|十年后|改造前|改造后|破败|焕新)\s*$/g, '')
    .replace(/\s+/g, '')
    .trim() || getSceneDisplayName(sceneName);
}

function chineseNumberToNumber(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = {
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
  if (value === '十') return 10;
  const tenIndex = value.indexOf('十');
  if (tenIndex >= 0) {
    const before = value.slice(0, tenIndex);
    const after = value.slice(tenIndex + 1);
    const tens = before ? digits[before] : 1;
    const ones = after ? digits[after] : 0;
    if (typeof tens === 'number' && typeof ones === 'number') return tens * 10 + ones;
  }
  return typeof digits[value] === 'number' ? digits[value] : null;
}

function extractEpisodeNumberFromText(text: string): number | null {
  const match = text.match(/第\s*([一二两三四五六七八九十百千万\d]+)\s*[集章]/);
  if (!match) return null;
  return chineseNumberToNumber(match[1]);
}

function inferStateLabelFromText(text: string, fallback = ''): string {
  const statePatterns: Array<[RegExp, string]> = [
    [/雨夜/, '雨夜'],
    [/夜|黑夜|\[夜\]|【夜】/, '夜晚'],
    [/白天|\[日\]|【日】|日间/, '白天'],
    [/上午|清晨|早晨/, '上午'],
    [/下午/, '下午'],
    [/黄昏|傍晚|晚上/, '傍晚'],
    [/十年前|10年前/, '10年前'],
    [/十年后|10年后/, '10年后'],
    [/改造前|修缮前/, '改造前'],
    [/改造后|修缮后|焕新/, '改造后'],
    [/破败|破旧|废弃/, '破败状态'],
  ];

  const source = `${text}\n${fallback}`;
  for (const [pattern, label] of statePatterns) {
    if (pattern.test(source)) return label;
  }
  return fallback || '默认状态';
}

function parseEpisodeBlocks(content: string): Array<{ number: number | null; label: string; text: string }> {
  const lines = content.replace(/\r/g, '\n').split('\n');
  const blocks: Array<{ number: number | null; label: string; lines: string[] }> = [];
  let current: { number: number | null; label: string; lines: string[] } = {
    number: null,
    label: '未标注集数',
    lines: [],
  };

  for (const line of lines) {
    const episodeNumber = extractEpisodeNumberFromText(line);
    if (episodeNumber !== null && /第\s*[一二两三四五六七八九十百千万\d]+\s*[集章]/.test(line)) {
      if (current.lines.length > 0) blocks.push(current);
      current = {
        number: episodeNumber,
        label: `第${episodeNumber}集`,
        lines: [line],
      };
      continue;
    }
    current.lines.push(line);
  }

  if (current.lines.length > 0) blocks.push(current);
  return blocks.map(block => ({
    number: block.number,
    label: block.label,
    text: block.lines.join('\n'),
  }));
}

function inferSceneOccurrences(content: string, sceneName: string): { episodeNumbers: number[]; occurrences: SceneOccurrence[] } {
  const normalizedScene = normalizeSceneNameForMatch(sceneName);
  const physicalLocation = getPhysicalLocationName(sceneName);
  const normalizedPhysical = normalizeSceneNameForMatch(physicalLocation);
  const blocks = parseEpisodeBlocks(content);
  const occurrences: SceneOccurrence[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const lines = block.text.split(/\n/);
    lines.forEach((line, index) => {
      const normalizedLine = normalizeSceneNameForMatch(line);
      const hasExact = sceneName && line.includes(sceneName);
      const hasScene = normalizedScene && normalizedLine.includes(normalizedScene);
      const hasPhysical = normalizedPhysical && normalizedLine.includes(normalizedPhysical);
      if (!hasExact && !hasScene && !hasPhysical) return;

      const isHeadingLike = /^\s*\d+[-—]\d+/.test(line) || /场景|内|外|日|夜|白天|雨夜/.test(line);
      if (!isHeadingLike && occurrences.some(item => item.episodeNumber === block.number)) return;

      const heading = line.trim() || sceneName;
      const stateLabel = inferStateLabelFromText(`${heading}\n${lines.slice(index, index + 3).join('\n')}`, '');
      const key = `${block.number ?? 'unknown'}::${heading}`;
      if (seen.has(key)) return;
      seen.add(key);
      occurrences.push({
        episodeNumber: block.number,
        episodeLabel: block.label,
        heading,
        stateLabel,
      });
    });
  }

  if (occurrences.length === 0) {
    const context = extractSceneContext(content, sceneName);
    const episodeNumber = extractEpisodeNumberFromText(context);
    occurrences.push({
      episodeNumber,
      episodeLabel: episodeNumber ? `第${episodeNumber}集` : '未标注集数',
      heading: sceneName,
      stateLabel: inferStateLabelFromText(`${sceneName}\n${context}`, ''),
    });
  }

  const episodeNumbers = Array.from(new Set(
    occurrences
      .map(item => item.episodeNumber)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  )).sort((a, b) => a - b);

  return {
    episodeNumbers,
    occurrences: occurrences.slice(0, 8),
  };
}

function buildSceneGroups(scenes: any[]): any[] {
  const groups: any[] = [];
  const groupMap = new Map<string, any>();

  for (const scene of scenes || []) {
    const mainSceneName = scene?.mainSceneName || scene?.physicalLocation || getPhysicalLocationName(scene?.name || '');
    const key = normalizeSceneNameForIdentity(mainSceneName);
    if (!key) continue;
    if (!groupMap.has(key)) {
      const group = {
        mainSceneName,
        stateCount: 0,
        episodeNumbers: [] as number[],
        scenes: [] as any[],
      };
      groupMap.set(key, group);
      groups.push(group);
    }
    const group = groupMap.get(key);
    group.scenes.push(scene);
    group.stateCount = group.scenes.length;
    const episodeNumbers = Array.isArray(scene?.episodeNumbers) ? scene.episodeNumbers : [];
    group.episodeNumbers = Array.from(new Set([...group.episodeNumbers, ...episodeNumbers])).sort((a, b) => a - b);
  }

  return groups;
}

function findPreviousSamePhysicalScene(sceneNames: string[], sceneName: string, index: number): string {
  const physicalLocation = getPhysicalLocationName(sceneName);
  for (let i = index - 1; i >= 0; i--) {
    if (getPhysicalLocationName(sceneNames[i]) === physicalLocation) {
      return sceneNames[i];
    }
  }
  return '';
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

function buildSceneContextDigest(content: string, sceneNames: string[]): string {
  return sceneNames.map(sceneName => {
    const context = extractSceneContext(content, sceneName);
    return `【${sceneName}】\n${context || '全文中未检索到明确环境描述，请依据场景标题、内外景和时间信息谨慎推断。'}`;
  }).join('\n\n');
}

/**
 * 提取一批场景的详细信息
 */
async function extractBatchScenes(
  
  content: string,
  sceneNames: string[],
  startId: number = 0,  // 全局起始 id，确保不同批次的场景 id 不重复
  creationBible?: CreationBible,
  allSceneNames: string[] = sceneNames
): Promise<{ scenes: any[]; tokenUsage: any }> {
  const systemPrompt = `你是专业的影视场景分析师。为指定的场景生成详细信息。
${buildCreationBibleInstruction(creationBible)}

**重要规则**：
1. 必须为每个场景生成完整的描述信息，不要遗漏任何字段
2. description 字段只写“场景环境视觉描述”，必须描述空间布局、建筑/装饰风格、光线、色调、陈设、氛围等（50-100字）
3. description 不能摘录剧本文本，不能写第几集、场景标记、出场人物、年龄、剧情事件、台词、对白、人物动作
4. keyEvents 必须列出该场景中发生的关键剧情事件（至少1-3个）
5. visualElements 只列固定建筑、固定装修、主要家具、长期陈设和主光源；人物手持物、文件、食物等临时剧情道具不要列入场景视觉元素
6. 如果原文没有环境细节，请根据场景名称、内外景和时间推断合理的视觉环境，不要写“待补充”
7. 只有“明确日戏/夜戏切换、明确年代跨度、改造/拆除/毁坏/重建/长期废弃等会影响后续剧情的重大持久变化”才建立独立状态
8. 同一地点重复出现、上午/下午变化、天气变化、人物进出、镜头角度、情绪、临时道具增减，都不算新的场景状态；这些信息只合并进 occurrences、keyEvents 或 visualElements
9. 对于有效的后续状态，referenceSceneName 填写同一地点首次出现的基准场景名称，imageMode 填写 image-to-image；基准场景 imageMode 填写 text-to-image
10. stateLabel 用简短词标注有效状态，如：白天、夜晚、10年前、10年后、改造后、拆除后。禁止用“摆放了某道具”“某人物进入”“气氛紧张”作为状态
11. stateReason 只能填写 baseline、day-night-change、era-change、structural-change；stateChangeEvidence 必须写出剧本中支持拆分的明确依据；stateVisualDifference 只描述相对基准图真正需要改变的视觉部分
12. episodeNumbers 和 occurrences 必须关联原文对应集数/场次；如果无法判断，返回空数组，不要编造
13. 当前批次完成前必须再次核对全局场景顺序和剧本证据，清理“院子/院子外”“客厅/客厅中”等同一物理空间的重复名称；不确定是否同一空间时保留并给出清晰物理地点名，不可凭名称机械合并

每个场景包含：
- id: 序号
- name: 场景名称（必须与输入的场景名称完全一致）
- description: 场景环境描述（必须填写，只描述环境、空间、光线、陈设、氛围，不描述剧情和出场人物，50-100字）
- type: 室内/室外/虚拟（必须填写）
- importance: 主要场景/次要场景/过渡场景（必须填写）
- timeOfDay: 时间设定（如：白天、夜晚、黄昏等）
- atmosphere: 氛围特点（如：紧张、温馨、神秘等）
- keyEvents: 关键事件数组（至少1个，描述在该场景发生的重要事件）
- visualElements: 固定环境视觉元素数组（至少2个，只描述建筑、装修、主要家具、长期陈设和主光源）
- mainSceneName: 主要场景名/物理地点基名（如：顾公馆正厅）
- physicalLocation: 物理地点基名（如：顾公馆正厅）
- stateLabel: 场景状态标签（如：白天、夜晚、10年前、10年后）
- referenceSceneName: 如果是同一地点的后续状态，填写前一个可参考的场景名称；基准场景为空
- imageMode: text-to-image 或 image-to-image
- stateReason: baseline/day-night-change/era-change/structural-change
- stateChangeEvidence: 剧本中支持该状态独立制作的明确依据
- stateVisualDifference: 相对基准状态需要改变的视觉部分；基准状态写“基准空间状态”
- episodeNumbers: 出现集数数组，例如 [1, 3]
- occurrences: 出现场次数组，每项包含 episodeNumber、episodeLabel、heading、stateLabel

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
      "visualElements": ["视觉元素1", "视觉元素2"],
      "mainSceneName": "物理地点基名",
      "physicalLocation": "物理地点基名",
      "stateLabel": "白天",
      "referenceSceneName": "",
      "imageMode": "text-to-image",
      "stateReason": "baseline",
      "stateChangeEvidence": "主场景首次出现",
      "stateVisualDifference": "基准空间状态",
      "episodeNumbers": [1],
      "occurrences": [{"episodeNumber": 1, "episodeLabel": "第1集", "heading": "1-1 场景名 [内] [日]", "stateLabel": "白天"}]
    }
  ]
}`;

  const sceneList = sceneNames.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const globalSceneList = allSceneNames.map((scene, index) => `${index + 1}. ${scene}`).join('\n');
  const sceneContextDigest = buildSceneContextDigest(content, sceneNames);
  
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    {
      role: 'user' as const,
      content: `请为以下当前批次场景生成详细信息：\n${sceneList}\n\n这是模型分段通读全文后得到的全局场景顺序。请用它判断主要场景、状态变体和跨批次参考关系：\n${globalSceneList}\n\n以下证据由系统从全文所有位置检索并均匀抽取，必须优先依据这些证据提取环境、事件、集数和状态：\n${sceneContextDigest}`,
    }
  ];

  let response = '';
  try {
    const stream = oaiStream(messages, {
      temperature: 0.25,
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
    const globalSceneIndex = Math.min(startId + idx, Math.max(0, allSceneNames.length - 1));
    const previousSamePhysicalScene = findPreviousSamePhysicalScene(allSceneNames, sceneName, globalSceneIndex);
    const defaultImageMode = previousSamePhysicalScene ? 'image-to-image' : 'text-to-image';
    const mainSceneName = getPhysicalLocationName(sceneName);
    const occurrenceInfo = inferSceneOccurrences(content, sceneName);
    
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
        mainSceneName: matchedScene.mainSceneName || matchedScene.physicalLocation || mainSceneName,
        physicalLocation: matchedScene.physicalLocation || matchedScene.mainSceneName || mainSceneName,
        stateLabel: matchedScene.stateLabel || occurrenceInfo.occurrences[0]?.stateLabel || defaults.timeOfDay,
        stateReason: matchedScene.stateReason || '',
        stateChangeEvidence: matchedScene.stateChangeEvidence || matchedScene.stateEvidence || '',
        stateVisualDifference: matchedScene.stateVisualDifference || matchedScene.visualDifference || '',
        referenceSceneName: matchedScene.referenceSceneName || previousSamePhysicalScene,
        imageMode: matchedScene.imageMode || defaultImageMode,
        episodeNumbers: hasNumberList(matchedScene.episodeNumbers)
          ? matchedScene.episodeNumbers
          : occurrenceInfo.episodeNumbers,
        occurrences: Array.isArray(matchedScene.occurrences) && matchedScene.occurrences.length > 0
          ? matchedScene.occurrences
          : occurrenceInfo.occurrences,
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
        mainSceneName,
        physicalLocation: mainSceneName,
        stateLabel: occurrenceInfo.occurrences[0]?.stateLabel || defaults.timeOfDay,
        stateReason: 'baseline',
        stateChangeEvidence: '',
        stateVisualDifference: '',
        referenceSceneName: previousSamePhysicalScene,
        imageMode: defaultImageMode,
        episodeNumbers: occurrenceInfo.episodeNumbers,
        occurrences: occurrenceInfo.occurrences,
      };
    }
  });

  const normalizedScenes = normalizeSceneStateUnits(completeScenes).scenes;
  console.log(`extractBatchScenes 完成: sceneNames=${sceneNames.length}, completeScenes=${completeScenes.length}, 有效状态=${normalizedScenes.length}`);

  return {
    scenes: normalizedScenes,
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
  fileName: string,
  creationBible?: CreationBible
): Promise<any> {
  const systemPrompt = `你是一个专业的影视场景分析师。分析文本提取所有场景。
${buildCreationBibleInstruction(creationBible)}

规则：
1. 提取所有独特场景
2. 先按主要物理场景归类，只保留真正需要单独制作场景图的状态：明确日戏/夜戏切换、明确年代跨度、改造/拆除/毁坏/重建/长期废弃等影响后续剧情的重大持久变化
3. 不要遗漏文本中出现的场景
4. description 只描述场景环境、空间、光线、陈设、氛围，不要摘录剧情、出场人物、年龄、台词或场景标记
5. 同一地点重复出现、上午/下午、天气、人物、镜头、情绪和临时道具增减不算新状态，必须合并
6. 后出现的有效状态应参考同一地点首次出现的基准图，填写 referenceSceneName 和 imageMode: "image-to-image"
7. 每个场景必须包含 mainSceneName、episodeNumbers、occurrences、stateReason、stateChangeEvidence、stateVisualDifference
8. 输出前回查全文，确认“院子/院子外/家里院子”“客厅/客厅中”等近似称呼是否实际为同一物理布景；确认相同时只保留一个主场景，确属相邻独立空间时才分开

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
      "visualElements": ["元素"],
      "mainSceneName": "主要场景名",
      "physicalLocation": "物理地点基名",
      "stateLabel": "场景状态",
      "referenceSceneName": "可参考的前一场景名称",
      "imageMode": "text-to-image/image-to-image",
      "stateReason": "baseline/day-night-change/era-change/structural-change",
      "stateChangeEvidence": "支持拆分的剧本依据",
      "stateVisualDifference": "相对基准图真正需要改变的视觉部分",
      "episodeNumbers": [1],
      "occurrences": [{"episodeNumber": 1, "episodeLabel": "第1集", "heading": "1-1 场景名 [内] [日]", "stateLabel": "白天"}]
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
      temperature: 0.25,
    });

    for await (const chunk of stream) {
      if (chunk.content) response += chunk.content.toString();
    }
  } catch (error: any) {
    console.warn('传统场景模型提取失败，使用本地兜底:', error?.message || error);
    const localScenes = extractLocalSceneNames(content);
    const fallback = await extractBatchScenes(content, localScenes, 0, creationBible);
    const sceneGroups = buildSceneGroups(fallback.scenes);
    return {
      totalScenes: fallback.scenes.length,
      totalMainScenes: sceneGroups.length,
      scenes: fallback.scenes,
      sceneGroups,
      tokenUsage: fallback.tokenUsage,
    };
  }

  const result = tryExtractAndFixJSON(response);
  
  if (result && result.scenes && Array.isArray(result.scenes)) {
    result.scenes = result.scenes.map((scene: any, index: number) => {
      const sceneName = firstUsefulString(scene?.name, scene?.sceneName, scene?.['场景名']) || `场景${index + 1}`;
      const defaults = inferSceneDefaults(sceneName);
      const mainSceneName = scene?.mainSceneName || scene?.physicalLocation || getPhysicalLocationName(sceneName);
      const occurrenceInfo = inferSceneOccurrences(content, sceneName);
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
        mainSceneName,
        physicalLocation: scene?.physicalLocation || mainSceneName,
        stateLabel: scene?.stateLabel || occurrenceInfo.occurrences[0]?.stateLabel || defaults.timeOfDay,
        stateReason: scene?.stateReason || '',
        stateChangeEvidence: scene?.stateChangeEvidence || scene?.stateEvidence || '',
        stateVisualDifference: scene?.stateVisualDifference || scene?.visualDifference || '',
        referenceSceneName: scene?.referenceSceneName || '',
        imageMode: scene?.imageMode || 'text-to-image',
        episodeNumbers: hasNumberList(scene?.episodeNumbers) ? scene.episodeNumbers : occurrenceInfo.episodeNumbers,
        occurrences: Array.isArray(scene?.occurrences) && scene.occurrences.length > 0 ? scene.occurrences : occurrenceInfo.occurrences,
      };
    });
    result.scenes = normalizeSceneStateUnits(result.scenes).scenes;
    result.totalScenes = result.scenes.length;
    result.totalMainScenes = buildSceneGroups(result.scenes).length;
    result.sceneGroups = buildSceneGroups(result.scenes);
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
