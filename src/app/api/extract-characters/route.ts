import { NextRequest, NextResponse } from 'next/server';
import { stream as oaiStream, invoke as oaiInvoke } from '@/lib/openai-client';
import { estimateMessagesTokens, estimateTokens } from '@/lib/token-utils';
import { tryExtractAndFixJSON, removeControlCharsInStrings } from '@/lib/json-utils';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import { mapWithConcurrency, selectEvenlySpaced, splitTextForFullScan } from '@/lib/full-text-scan';
import { normalizeCharacterLooks } from '@/lib/character-look-utils';
import {
  buildCharacterLifecycleRequirements,
  formatCharacterLifecycleChecklist,
} from '@/lib/character-lifecycle-audit';
import {
  inheritBodyProfileForLooks,
  mergeCharacterBodyProfiles,
  normalizeCharacterBodyProfile,
  stripBodyDetailsFromAppearance,
  type CharacterBodyProfile,
} from '@/lib/character-body-profile';
import {
  inferCharacterEntityKind,
  inferExplicitGenderFromName,
  resolveCharacterGenderByPolicy,
} from '@/lib/character-semantic-rules';
import { buildLeadCharacterExtractionInstruction } from '@/lib/lead-character-design';

export const maxDuration = 600;

// 每批处理的人物数
const BATCH_SIZE = 8;
const FULL_SCAN_CONCURRENCY = 2;

type CreationBible = {
  creationType?: string;
  subjectRegion?: string;
  creationBackground?: string;
};

function buildCreationBibleInstruction(creationBible?: CreationBible): string {
  const creationType = typeof creationBible?.creationType === 'string' ? creationBible.creationType.trim() : '';
  const subjectRegion = typeof creationBible?.subjectRegion === 'string' ? creationBible.subjectRegion.trim() : '';
  const creationBackground = typeof creationBible?.creationBackground === 'string'
    ? creationBible.creationBackground.trim()
    : '';
  if (!creationType && !subjectRegion && !creationBackground) return '';

  const lines = ['【创作圣经约束】'];
  if (creationType === '仿真人') {
    lines.push('创作类型：仿真人。人物外貌、faceFeatures 和 looks 要服务真人短剧/真人电影质感，强调真实皮肤、真实服装材质、自然妆发和可拍摄造型。');
  } else if (creationType === '3D') {
    lines.push('创作类型：3D。人物外貌、faceFeatures 和 looks 必须服务高端院线级风格化3D动画电影角色设计：使用圆润简洁、略微夸张但协调自然的角色比例，精致干净且可建模的五官，雕塑式发束结构，清晰的PBR材质分区和电影级光影；只从剧本提取身份与外貌证据，不要写成真人照片、真人摄影皮肤或由真人轻度磨皮得到的效果。');
  } else if (creationType === '动漫') {
    lines.push('创作类型：动漫。人物外貌、faceFeatures 和 looks 要服务动漫角色设计，强调发型轮廓、眼型、色彩记忆点、服装线条和动画表现力，不要写成真人照片。');
  }
  if (subjectRegion === '国内') {
    lines.push('创作题材：国内。人物服装、妆发、身份关系、生活细节和社会语境应符合中国本土语境。');
  } else if (subjectRegion === '国外') {
    lines.push('创作题材：国外。人物服装、妆发、生活方式、职业细节和文化语境应符合海外/国际化语境；人类角色在剧本未明确族裔时，默认采用非东亚的欧美/国际化外貌特征，不得惯性生成中国或东亚面孔。剧本明确族裔时以剧本为准。');
  }
  if (creationBackground === '近代') {
    lines.push('创作背景：近代。人物的服装剪裁、妆发、首饰、鞋履、职业装束和不同阶段造型应符合近代年代语境。');
  } else if (creationBackground === '现代') {
    lines.push('创作背景：现代。人物的服装、妆发、配饰、职业装束和不同场景穿搭应符合现代生活语境。');
  } else if (creationBackground === '古代') {
    lines.push('创作背景：古代。人物的发式、冠帽、服装形制、妆容、首饰、鞋履和身份礼制应符合古代语境，禁止无剧情依据的现代服饰。');
  }
  lines.push('这些约束只影响视觉风格、题材语境和时代背景，不允许改动原剧情、人物关系、性别、年龄证据和关键事件；如剧本明确存在回忆、年代跳转或穿越，按原剧情呈现相应时期。');
  return lines.join('\n');
}

function buildLeadWardrobeInstruction(creationBible?: CreationBible): string {
  const background = typeof creationBible?.creationBackground === 'string'
    ? creationBible.creationBackground.trim()
    : '';
  const region = typeof creationBible?.subjectRegion === 'string'
    ? creationBible.subjectRegion.trim()
    : '';
  const context = [background || '剧本对应时代', region || '剧本对应地域'].join('、');

  return `【主角服装设计圣经】
1. 仅对 role=主角 的人类角色提升服装设计等级；服装必须先服从剧本身份、场合、季节、动作需求和${context}，再增加设计感，不能改变原剧情。
2. 每位主角先建立稳定的个人衣橱基因：固定1组主色与1组辅助色、1种常用轮廓、1至2个签名细节。不同造型可以变化，但应让观众看出属于同一个人物。
3. 日常造型用于生活、通勤、工作、出行和连续接戏。日常不等于普通：使用清楚的剪裁、比例、层次、材质和一个克制记忆点，避免只写“白衬衫+黑裤子”“普通西装”“休闲装”等泛化搭配。
4. 女主日常方向：合体但不紧绷的剪裁、高腰比例、长裤或长裙、马甲/西装/风衣/皮衣等层次；象牙白、黑、棕、酒红、灰、橄榄等克制配色；蝴蝶结、蕾丝、腰封、帽饰或珠宝最多选择1至2项作为女性化记忆点。
5. 男主日常方向：松弛但利落的现代剪裁，针织/Polo/衬衫/夹克与高腰直筒或宽松长裤形成比例；黑白灰、奶油、棕、藏蓝等安静配色；通过外套结构、领型、面料、腕表或鞋履形成高级感，禁止油腻紧身和模板化商务套装。
6. 高光造型仅用于宴会、婚礼、典礼、正式发布、身份揭晓、重要登场、逆袭、决战、加冕、庆功等确有叙事意义的节点。高光造型强化轮廓、材质、配饰与色彩对比，但仍保持人物衣橱基因。
7. 女主高光方向：礼服、披肩/披风、结构化腰线、黑金/酒红/银白等电影化配色，珠宝、冠饰或帽饰作为焦点；最多保留2至3个视觉记忆点，避免堆满装饰。
8. 男主高光方向必须按世界观二选一：现代题材使用三件套、礼服、长大衣等克制正式造型；古代/奇幻题材才使用刺绣、披风、冠冕、皮草或铠甲。禁止把现代西装与奇幻王冠披风无依据混搭。
9. looks.costume 必须写清轮廓、内外层、上下装、主辅色、材质和鞋履；looks.accessories 只保留真实会出现在画面中的配饰。高光造型还要在 description 或 costume 中说明其叙事记忆点。
10. 同一服装在连续场次中不得无故改变；只有时间、场合、身份、剧情节点或身体状态发生足够明显变化时才新增造型。参考设计原则，不直接复制任何品牌、秀场或参考图中的完整成衣。`;
}

function getCreationStyleLabel(creationBible?: CreationBible): string {
  if (creationBible?.creationType === '3D') return '3D角色动画风格';
  if (creationBible?.creationType === '动漫') return '动漫角色设计风格';
  return '真人短剧写实风格';
}

export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const { content, fileName, batch = 0, characterMarkers, creationBible, sourceType } = await request.json();

    if (sourceType !== 'execution-script') {
      return NextResponse.json(
        { error: '人物提取仅允许使用当前执行剧本，请先重新拉取执行剧本' },
        { status: 400 }
      );
    }

    if (!content) {
      return NextResponse.json(
        { error: '未提供文件内容' },
        { status: 400 }
      );
    }

    console.log(`开始提取人物，文件: ${fileName}, 批次: ${batch}, 内容长度: ${content.length}`);

    // 第一批或没有人物标记时：识别所有人物名称
    let allCharacterMarkers: string[] = characterMarkers || [];
    
    if (batch <= 1 || !characterMarkers || characterMarkers.length === 0) {
      // 识别人物标记
      allCharacterMarkers = await identifyCharacterMarkers(content, fileName);
      console.log(`识别到 ${allCharacterMarkers.length} 个人物:`, allCharacterMarkers);
    }

    if (allCharacterMarkers.length === 0) {
      // 如果没有识别到人物标记，使用传统方式
      const result = await extractCharactersTraditional(content, fileName, creationBible);
      return NextResponse.json({
        success: true,
        type: 'characters',
        data: result,
        batchInfo: {
          currentBatch: 1,
          totalBatches: 1,
          hasMore: false,
        },
        tokenUsage: result.tokenUsage,
      });
    }

    // 分批提取人物详情
    const totalBatches = Math.ceil(allCharacterMarkers.length / BATCH_SIZE);
    // 确保 batch 至少为 1
    const currentBatch = Math.max(1, batch);
    const currentBatchStart = (currentBatch - 1) * BATCH_SIZE;
    const currentBatchCharacters = allCharacterMarkers.slice(currentBatchStart, currentBatchStart + BATCH_SIZE);
    
    console.log(`处理第 ${currentBatch}/${totalBatches} 批，人物: ${currentBatchCharacters.join(', ')}`);

    // 提取当前批次的人物详情，传入起始 id 确保全局唯一
    const startId = currentBatchStart;
    const batchResult = await extractBatchCharacters(content, currentBatchCharacters, startId, creationBible);
    
    const hasMore = currentBatch < totalBatches;
    
    console.log(`人物提取完成，批次 ${currentBatch}/${totalBatches}，返回 ${batchResult.characters.length} 个人物`);

    return NextResponse.json({
      success: true,
      type: 'characters',
      data: {
        totalCharacters: allCharacterMarkers.length,
        characters: batchResult.characters,
      },
      batchInfo: {
        currentBatch: currentBatch,
        totalBatches,
        hasMore,
        characterMarkers: allCharacterMarkers,
      },
      tokenUsage: batchResult.tokenUsage,
    });
  } catch (error: any) {
    console.error('人物提取失败:', error);
    console.error('错误详情:', error?.message);
    return NextResponse.json(
      { error: '人物提取失败', details: error?.message },
      { status: 500 }
    );
  }
}

/**
 * 识别所有人物名称
 */
async function identifyCharacterMarkers(content: string, fileName: string): Promise<string[]> {
  const localCharacters = extractLocalCharacterNames(content);
  if (localCharacters.length > 0) {
    console.log(`从剧本结构识别到 ${localCharacters.length} 个人物:`, localCharacters);
  }

  const systemPrompt = `你是一个专业的影视角色分析师。请分析文本，识别所有独特的人物名称。

**重要规则**：
1. 只返回人物名称数组，不要返回其他内容
2. 人物名称应该准确（如：张三、李四、王五等）
3. 合并同一人物的不同称呼（如"张三"和"老张"合并为"张三"）
4. 按出场顺序或重要性排列
5. 不要限制数量，宁可多提取也不要漏掉；长剧本中 50+ 人物是正常情况
6. 路人、龙套、背景人物也要识别，只是在 role 中标注为“路人/龙套/背景人物”

输出JSON数组格式：
["人物1", "人物2", "人物3"]`;

  const chunks = splitTextForFullScan(content);
  const modelCharacterGroups = await mapWithConcurrency(chunks, FULL_SCAN_CONCURRENCY, async chunk => {
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      {
        role: 'user' as const,
        content: `这是完整剧本的第 ${chunk.index}/${chunk.total} 段（字符 ${chunk.start}-${chunk.end}）。请识别本段出现、被提及或参与关系的全部人物，包括龙套、路人和背景人物，不要因人物可能出现在其他段而省略。\n\n文件名：${fileName}\n\n本段内容：\n${chunk.text}`,
      },
    ];

    let response = '';
    try {
      const stream = oaiStream(messages, { temperature: 0.3 });
      for await (const responseChunk of stream) {
        if (responseChunk.content) response += responseChunk.content.toString();
      }
      return parseCharacterMarkerResponse(response);
    } catch (error: any) {
      console.warn(`人物名称模型识别第 ${chunk.index}/${chunk.total} 段失败，保留其他段和本地结果:`, error?.message || error);
      return [];
    }
  });

  const mergedCharacters = mergeCharacterNames(localCharacters, ...modelCharacterGroups);
  const modelCharacterCount = modelCharacterGroups.reduce((sum, characters) => sum + characters.length, 0);
  console.log(`全文人物名称合并: ${chunks.length} 段，本地 ${localCharacters.length} 个，模型原始 ${modelCharacterCount} 个，合并后 ${mergedCharacters.length} 个`);
  return mergedCharacters;
}

function parseCharacterMarkerResponse(response: string): string[] {
  const cleanedResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  if (cleanedResponse.startsWith('[')) {
    try {
      const parsed = JSON.parse(removeControlCharsInStrings(cleanedResponse));
      if (Array.isArray(parsed)) {
        return parsed.filter((character): character is string => typeof character === 'string');
      }
    } catch (error) {
      console.log('人物名称数组解析失败，尝试修复解析:', error);
    }
  }

  const repaired = tryExtractAndFixJSON(response);
  if (Array.isArray(repaired)) {
    return repaired.filter((character): character is string => typeof character === 'string');
  }

  const matches = response.match(/"([^"]+)"/g);
  return matches
    ? matches.map(match => match.replace(/"/g, '')).filter(character => character.length > 0 && character.length < 50)
    : [];
}

function mergeCharacterNames(...groups: string[][]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const rawName of group) {
      if (typeof rawName !== 'string') continue;
      const name = rawName.trim();
      const identity = name.replace(/[，,。；;：:、\s]+/g, '').toLocaleLowerCase();
      if (!name || !identity || seen.has(identity)) continue;
      seen.add(identity);
      names.push(name);
    }
  }
  return names;
}

function extractLocalCharacterNames(content: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const blocked = new Set([
    '人物', '角色', '出场人物', '主要人物', '关键人物', '场景', '道具', '时间', '地点',
    '旁白', '画面', '镜头', '字幕', '剧情', '动作', '音效', '转场', '闪回', '回忆',
  ]);
  const addName = (rawName: string) => {
    const name = rawName
      .replace(/（.*?）/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/[*×xX]\d+/g, '')
      .replace(/[:：].*$/g, '')
      .trim();

    if (
      name &&
      name.length >= 2 &&
      name.length <= 12 &&
      !blocked.has(name) &&
      !seen.has(name)
    ) {
      seen.add(name);
      names.push(name);
    }
  };

  const castPatterns = [
    /【人物】([^【\n\r]+)/g,
    /人物[:：]([^\n\r]+)/g,
    /角色[:：]([^\n\r]+)/g,
  ];

  for (const pattern of castPatterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      for (const rawName of match[1].split(/[、,，;；\s]+/)) {
        addName(rawName);
      }
    }
  }

  const dialoguePattern = /(?:^|\n)\s*([\u4e00-\u9fa5A-Za-z]{2,8})[：:]/g;
  let dialogueMatch: RegExpExecArray | null;
  while ((dialogueMatch = dialoguePattern.exec(content)) !== null) {
    addName(dialogueMatch[1]);
  }

  return names;
}

function normalizeCharacterRole(role: any): string {
  if (typeof role !== 'string' || !role.trim()) return '次要配角';
  const normalized = role.trim();
  if (normalized.includes('主角') && !normalized.includes('配角')) return '主角';
  if (normalized.includes('主要配角')) return '主要配角';
  if (normalized.includes('次要配角')) return '次要配角';
  if (normalized.includes('龙套')) return '龙套';
  if (normalized.includes('路人')) return '路人';
  if (normalized.includes('背景') || normalized.includes('群众')) return '背景人物';
  return '次要配角';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeGender(value: any): '' | '男' | '女' | '待定' {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text) return '';
  if (/待定|未知|不明|无法判断/.test(text)) return '待定';
  const hasFemale = /女|女性|女生|女孩|女人/.test(text);
  const hasMale = /男|男性|男生|男孩|男人/.test(text);
  if (hasFemale && !hasMale) return '女';
  if (hasMale && !hasFemale) return '男';
  return '';
}

function collectCharacterEvidence(content: string, name: string, radius = 140, maxCount = 6): string[] {
  if (!name) return [];
  const matchIndexes: number[] = [];
  const regex = new RegExp(escapeRegExp(name), 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    matchIndexes.push(match.index);
  }

  const evidence: string[] = [];
  const seen = new Set<string>();
  for (const matchIndex of selectEvenlySpaced(matchIndexes, maxCount * 2)) {
    const start = Math.max(0, matchIndex - radius);
    const end = Math.min(content.length, matchIndex + name.length + radius);
    const snippet = content.slice(start, end).replace(/\s+/g, ' ').trim();
    if (snippet && !seen.has(snippet)) {
      seen.add(snippet);
      evidence.push(snippet);
      if (evidence.length >= maxCount) break;
    }
  }

  return evidence;
}

const CHARACTER_LIFECYCLE_CUE_PATTERN = /(闪回|回忆|回想|梦境|小时候|儿时|幼年|童年|儿童时期|少年时期|青年时期|中年时期|老年时期|年幼|年少|年轻时|长大后|多年以前|多年以后|[一二三四五六七八九十百0-9]+年(?:前|后)|[一二三四五六七八九十百0-9]+岁(?:时|那年)?)/;

function buildLifecycleContextDigest(content: string): string {
  const lines = content.split(/\r?\n/);
  const cueLineIndexes = lines.reduce<number[]>((indexes, line, index) => {
    if (CHARACTER_LIFECYCLE_CUE_PATTERN.test(line)) indexes.push(index);
    return indexes;
  }, []);
  if (cueLineIndexes.length === 0) return '全文未检索到明确的闪回、年龄时期或时间跳转标记。';

  const selectedIndexes = selectEvenlySpaced(cueLineIndexes, 36);
  const evidence: string[] = [];
  const seen = new Set<string>();
  selectedIndexes.forEach((lineIndex) => {
    const start = Math.max(0, lineIndex - 3);
    const end = Math.min(lines.length, lineIndex + 9);
    const block = lines.slice(start, end).join('\n').trim().slice(0, 900);
    const identity = block.replace(/\s+/g, '');
    if (!block || seen.has(identity)) return;
    seen.add(identity);
    evidence.push(`重点段落 ${evidence.length + 1}（约第 ${lineIndex + 1} 行）：\n${block}`);
  });

  return evidence.join('\n\n');
}

function inferGenderFromEvidence(name: string, content: string): '' | '男' | '女' {
  const evidence = collectCharacterEvidence(content, name, 220, 10).join(' ');
  if (!evidence) return '';

  const femalePatterns = [
    new RegExp(`${escapeRegExp(name)}[（(][^）)]*(女|养女|女儿|姑娘|小姐|大小姐|千金|太太|夫人|妻子|未婚妻|新娘|姐姐|妹妹)`, 'g'),
    new RegExp(`${escapeRegExp(name)}[^。！？：:\\n]{0,32}(她|女性|女儿|养女|小姐|姑娘|妻子|未婚妻|母亲|妈妈|姐姐|妹妹|新娘|太太|夫人)`, 'g'),
    new RegExp(`(她|女性|女儿|养女|小姐|姑娘|妻子|未婚妻|母亲|妈妈|姐姐|妹妹|新娘|太太|夫人)[^。！？：:\\n]{0,32}${escapeRegExp(name)}`, 'g'),
  ];
  const malePatterns = [
    new RegExp(`${escapeRegExp(name)}[（(][^）)]*(男|养子|儿子|先生|少爷|老爷|公子|丈夫|未婚夫|新郎|父亲|爸爸|哥哥|弟弟)`, 'g'),
    new RegExp(`${escapeRegExp(name)}[^。！？：:\\n]{0,32}(他|男性|儿子|养子|先生|少爷|丈夫|未婚夫|父亲|爸爸|哥哥|弟弟|新郎)`, 'g'),
    new RegExp(`(他|男性|儿子|养子|先生|少爷|丈夫|未婚夫|父亲|爸爸|哥哥|弟弟|新郎)[^。！？：:\\n]{0,32}${escapeRegExp(name)}`, 'g'),
  ];

  const score = (patterns: RegExp[]) => patterns.reduce((sum, pattern) => {
    pattern.lastIndex = 0;
    return sum + (evidence.match(pattern)?.length || 0);
  }, 0);

  const femaleScore = score(femalePatterns);
  const maleScore = score(malePatterns);
  if (femaleScore > maleScore) return '女';
  if (maleScore > femaleScore) return '男';
  return '';
}

function resolveCharacterGender(name: string, content: string, modelGender: any, character?: Record<string, any>): '男' | '女' | '待定' {
  const explicitNameGender = inferExplicitGenderFromName(name);
  if (explicitNameGender) return explicitNameGender;
  const evidenceGender = inferGenderFromEvidence(name, content);
  return resolveCharacterGenderByPolicy({
    name,
    currentGender: modelGender,
    evidenceGender,
    character: character || { name },
  });
}

function textContradictsGender(value: any, gender: '男' | '女' | '待定'): boolean {
  if (gender === '待定') return false;
  const text = Array.isArray(value) || (value && typeof value === 'object')
    ? JSON.stringify(value)
    : String(value || '');
  if (gender === '女') return /男性角色|男士|男装|男人|男孩|男生/.test(text);
  return /女性角色|女士|女装|女人|女孩|女生/.test(text);
}

function normalizeAppearanceDescription(value: unknown, fallback: string): string {
  const source = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  let description = source && !/^(待补充|待完善|暂无描述)$/.test(source)
    ? source
    : fallback.trim();

  if (description.length < 80 && fallback.trim() && !description.includes(fallback.trim())) {
    description = `${description}。${fallback.trim()}`;
  }
  if (description.length < 80) {
    description = `${description}。发型轮廓、固定五官、肤色与人物辨识特征保持稳定，正脸近景的眼神和表情符合剧情阶段，便于跨场景维持同一人物身份。`;
  }
  if (description.length <= 150) return description;

  const limited = description.slice(0, 150);
  const punctuationIndex = Math.max(
    limited.lastIndexOf('。'),
    limited.lastIndexOf('；'),
    limited.lastIndexOf('，')
  );
  return punctuationIndex >= 80 ? limited.slice(0, punctuationIndex + 1) : limited;
}

function buildCharacterContextDigest(content: string, characterNames: string[]): string {
  return characterNames.map((name) => {
    // 从完整剧本的全部命中位置中按时间线均匀抽取，兼顾首次出场、中段变化与结局状态。
    const snippets = collectCharacterEvidence(content, name, 280, 24);
    const evidence = snippets.length > 0
      ? snippets.map((snippet, index) => `${index + 1}. ${snippet}`).join('\n')
      : '未在文本片段中找到明确上下文，请勿凭空设定性别。';
    return `【${name}｜完整剧本全量检索后，按时间线整理的生命周期证据】\n${evidence}`;
  }).join('\n\n');
}

/**
 * 提取一批人物的详细信息
 */
async function extractBatchCharacters(
  content: string,
  characterNames: string[],
  startId: number = 0,  // 全局起始 id，确保不同批次的人物 id 不重复
  creationBible?: CreationBible
): Promise<{ characters: any[]; tokenUsage: any }> {
  const systemPrompt = `你是专业的影视角色分析师。为指定的人物生成详细信息。
${buildCreationBibleInstruction(creationBible)}
${buildLeadWardrobeInstruction(creationBible)}
${buildLeadCharacterExtractionInstruction(creationBible)}

**绝对重要规则**：
1. **必须为输入列表中的每个人物都生成信息，不能遗漏任何人！**
2. 即使人物只是简短提到或背景角色，也必须生成完整信息
3. 确保输出的人物名称与输入的人物名称**完全一致**（包括大小写、标点）
4. appearance 字段只描述正脸近景可见信息（发型、脸型轮廓、五官、肤色、皮肤质感和神态，**80-150字**），禁止混入身高、体重、体型和服装
5. **bodyProfile 字段必须独立记录人物全身体态档案**；身高、体重有剧本证据时按原文填写，没有精确证据时只写合理视觉范围或留空，禁止伪造精确数值
6. **faceFeatures 字段必须详细描述人物的固定脸型特征**，这些特征在所有场景下都保持不变
7. **looks 字段必须建立人物完整的视觉变化时间线**，不能只提取换装；必须识别服装、年龄时期、身体状态和特殊变身形态
8. 年龄时期包括但不限于童年、少年、青年、中年、老年，以及十年前、十年后等明确时间跨度；同一人物不同年龄仍是同一人物，固定五官辨识特征必须可追溯
9. 身体状态包括受伤、怀孕、生病、虚弱、醉酒、淋雨、毁容、康复等会明显改变画面的剧情状态；特殊形态包括觉醒、入魔、妖化、灵体、机甲、变身等
10. 每个人物至少需要有一个“基础造型”，基础造型必须是主要叙事时期的正常状态，作为后续年龄、服装、身体状态和变身形态的父级参考
11. 除非剧情是非常连续的接戏（同一天、同一空间、时间跨度很短），否则人物进入明显不同场景时可以合理换装：晚上在家可穿家居服/睡衣，工作场合可穿职场装，游玩场合可穿休闲/出游服，宴会/婚礼/葬礼等节点要有对应造型
12. 描述要贴合创作圣经风格，不要在仿真人模式下卡通化或过度夸张
13. role 只能使用：主角、主要配角、次要配角、龙套、路人、背景人物
14. gender 只能使用：男、女、待定。角色名或称谓本身明确写有“男/女”（如贵族男、贵族女、男仆、女仆、看守男）时，这是最高优先级证据，任何附近其他人物的代词都不得覆盖。
15. 其余人物再根据与该人物直接绑定的称谓、代词、亲属关系、括号身份说明和角色互动判断；不得统计同一场景中其他人物的“他/她”来替代该人物性别。确实没有证据时按产品制作规则写“男”，不要随机写“女”。
16. 性别判断优先级固定为：角色名中的明确性别 > 与人物直接绑定的剧本证据 > 模型综合判断 > 无法判断时默认男。女性护卫、女骑士等只有剧本或名称明确写出女性时才为女。
17. 不要把青年、中年、老年、受伤、怀孕或变身状态拆成新人物；它们必须放在同一人物的 looks 数组中
18. 不要机械组合“时期×服装×状态”生成不存在的造型，只提取剧本明确出现、强烈暗示或对画面连续性有实际影响的变化
19. 连续场次中时期、服装和身体状态没有明显改变时必须合并为同一造型，避免重复
20. 每个非基础造型必须填写 referenceLookId，指向视觉差异最小、剧情上紧邻的父级造型；受伤状态参考受伤前同服装造型，怀孕状态参考同年龄正常造型，变身状态参考变身前造型，老年优先参考中年而不是跨级直接参考青年
21. 所有造型必须保持人物固定脸型、眼睛、鼻子、嘴巴、肤色和辨识特征；年龄变化可以改变皱纹、发色、皮肤年龄感与体态，但不能换成另一个人
22. 每个 looks 项都必须写入 bodyProfile：默认继承人物身体档案；如该时期或状态改变了体态，在 bodyChanges 中只记录当前造型相对基础身体档案的变化
23. 必须先逐条审计“全剧本生命周期重点段落”。闪回中出现的小名、乳名、“小+姓名”、幼年称呼、女孩/男孩或亲属称呼，要结合闪回前后的转场、关系和事件判断对应人物；例如主线人物在闪回中以幼年身份出现，必须在同一人物的 looks 中新增“年龄时期”造型，不能因闪回段未重复写全名而漏掉
24. 每个明确的童年/幼年/少年/青年/中年/老年或多年以前/以后状态，都必须在 sourceEvidence 与 episodeNumbers 中保留证据；只有确实属于同一时期且视觉没有变化的段落才能合并
25. 必须区分人类与非人角色。地狱犬、狼人、兽人、魔兽等应保留动物/兽类物种特征；不能套用普通人类脸型、皮肤、妆容和人类发型模板。动物毛发必须顺应动物头骨与身体结构，禁止生成女性长发、披发、马尾或假发。
26. 对 role=主角 的人类角色，必须严格执行上方“主角形象设计规则”，并在 appearance 与 faceFeatures 中落成可重复生成的具体结构；该规则不能覆盖剧本明确设定。

每个人物包含：
- id: 序号
- name: 人物名称（必须与输入的人物名称完全一致）
- role: 主角/主要配角/次要配角/龙套/路人/背景人物（必须填写）
- age: 年龄（如：25岁、中年、老年等）
- gender: 男/女/待定
- personality: 性格特点数组（必须填写，至少2个）
- appearance: 正脸近景描述（**必须填写，80-150字**，只包含发型、脸型、五官、肤色、皮肤质感和神态）
- bodyProfile: 全身体态档案对象（身高、体重、体型、肩腰与骨架、四肢比例、体态）
  - height: 身高；有原文数值时照录，无精确证据时写合理视觉范围或空字符串
  - weight: 体重；有原文数值时照录，无精确证据时写体重范围/体重感或空字符串
  - bodyType: 体型和体格
  - shoulderWaist: 肩宽、腰线与骨架特征
  - limbProportions: 四肢、腿长和头身比例
  - posture: 常态体态、站姿或步态
- faceFeatures: 固定脸型特征对象（**必须填写**，包含脸型、眼睛、鼻子、嘴巴、肤色，这些特征在所有场景下保持一致）
  - faceShape: 脸型（如：椭圆脸、圆脸、方脸、鹅蛋脸等）
  - eyes: 眼睛特征（如：双眼皮大眼睛、丹凤眼、杏眼等）
  - nose: 鼻子特征（如：高鼻梁、翘鼻、塌鼻等）
  - mouth: 嘴巴特征（如：樱桃小嘴、薄唇、丰唇等）
  - skinTone: 肤色（如：白皙、健康、小麦色等）
- looks: 不同场景/阶段造型数组（**必须填写，至少1个**，每个人物在不同场景或不同剧情阶段的造型）
  - id: 造型唯一标识（如：look-1, look-2）
  - scene: 适用场景（如：初见、战斗、婚礼、日常生活、工作等）
  - stage: 故事阶段（可选，如：前期、中期、后期）
  - description: 造型整体描述（50-100字）
  - costume: 服装详细描述
  - hairstyle: 发型描述
  - accessories: 配饰数组（如：项链、戒指、手镯等）
  - makeup: 化妆描述（如：淡妆、浓妆、无妆等）
  - mood: 情绪状态（如：微笑、严肃、悲伤等）
  - continuityNote: 连续性说明（说明该造型是延续上一场还是因场景/时间跨度换装）
  - changeType: 变化类型，只能是“基础造型/服装造型/年龄时期/身体状态/特殊形态/复合变化”
  - ageStage: 人物时期（如：童年、青年、中年、老年、十年前）
  - physicalState: 身体状态（如：正常状态、受伤、怀孕、病弱）
  - transformationState: 特殊形态（没有则为空字符串，如：觉醒形态、入魔形态）
  - bodyProfile: 本造型使用的全身体态档案；默认完整继承人物 bodyProfile，发生年龄或身体变化时按当前造型覆盖相应字段
  - bodyChanges: 本造型相对基础身体档案的体态变化；没有变化则为空字符串
  - episodeNumbers: 该造型出现的集数数组
  - sceneNames: 该造型关联的场景名称数组
  - sourceEvidence: 剧本中支持该变化的简短依据，不得编造
  - isBaseLook: 是否为该人物主要时期的基础造型
  - referenceLookId: 父级参考造型ID；基础造型为空，其他造型必须填写
  - referenceReason: 为什么参考该父级造型
  - generationPriority: 生成优先级，基础造型1、年龄时期2、服装造型3、身体状态4、特殊形态或复合变化5
- background: 背景故事（如文本中有则填写）
- keyRelationships: 关键关系数组（列出与他人的重要关系）
- arc: 人物弧光（人物的发展变化轨迹）
- keyScenes: 关键出场场景数组
- props: 标志性道具数组

输出JSON格式：
{
  "characters": [
    {
      "id": 1,
      "name": "人物名称1",
      "role": "主角",
      "age": "25岁",
      "gender": "男",
      "personality": ["勇敢", "聪明", "正义感强"],
      "appearance": "只描述正脸近景可见的发型、脸型、五官、肤色、皮肤质感和神态（80-150字）",
      "bodyProfile": {
        "height": "165cm左右",
        "weight": "体重适中",
        "bodyType": "自然匀称",
        "shoulderWaist": "肩线舒展，腰线自然",
        "limbProportions": "四肢比例协调",
        "posture": "站姿挺拔但放松"
      },
      "faceFeatures": {
        "faceShape": "轮廓清晰的椭圆脸",
        "eyes": "眼神专注，眉眼有辨识度",
        "nose": "高鼻梁",
        "mouth": "唇线清楚，表情自然",
        "skinTone": "白皙"
      },
      "looks": [
        {
          "id": "look-1",
          "scene": "主要时期基础出场",
          "stage": "前期",
          "changeType": "基础造型",
          "ageStage": "青年",
          "physicalState": "正常状态",
          "transformationState": "",
          "bodyProfile": {
            "height": "165cm左右",
            "weight": "体重适中",
            "bodyType": "自然匀称",
            "shoulderWaist": "肩线舒展，腰线自然",
            "limbProportions": "四肢比例协调",
            "posture": "站姿挺拔但放松"
          },
          "bodyChanges": "",
          "description": "青年时期正常状态的基础造型",
          "costume": "白色衬衫搭配黑色西装",
          "hairstyle": "利落短发",
          "accessories": ["银色手表"],
          "makeup": "自然无妆或轻微修饰",
          "mood": "自然",
          "episodeNumbers": [1, 2],
          "sceneNames": ["公司办公室"],
          "sourceEvidence": "第1集首次以青年职场身份出场",
          "isBaseLook": true,
          "referenceLookId": "",
          "referenceReason": "直接参考已确认的人物正脸身份基准图",
          "generationPriority": 1
        },
        {
          "id": "look-2",
          "scene": "事故后住院",
          "stage": "中期",
          "changeType": "身体状态",
          "ageStage": "青年",
          "physicalState": "受伤包扎",
          "transformationState": "",
          "bodyProfile": {
            "height": "165cm左右",
            "weight": "体重适中",
            "bodyType": "自然匀称",
            "shoulderWaist": "肩线舒展，腰线自然",
            "limbProportions": "四肢比例协调",
            "posture": "因伤略微蜷缩"
          },
          "bodyChanges": "因伤动作受限，站姿略微蜷缩，其他身体比例保持不变",
          "description": "延续事故前同一人物和服装体系，表现受伤后的包扎与虚弱状态",
          "costume": "病号服，手臂和额头有包扎",
          "hairstyle": "略显凌乱",
          "accessories": [],
          "makeup": "苍白病弱妆",
          "mood": "痛苦克制",
          "episodeNumbers": [8],
          "sceneNames": ["医院病房"],
          "sourceEvidence": "第8集事故后住院并出现包扎",
          "isBaseLook": false,
          "referenceLookId": "look-1",
          "referenceReason": "参考青年正常造型，保持身份一致并增加受伤状态",
          "generationPriority": 4
        }
      ],
      "background": "背景故事",
      "keyRelationships": [{"target": "关系对象", "relationship": "关系类型"}],
      "arc": "人物发展轨迹",
      "keyScenes": ["关键出场场景1"],
      "props": ["标志性道具"]
    },
    {
      "id": 2,
      "name": "人物名称2",
      ...
    }
  ]
}

**重要提示：身份一致性与生成依赖**
- faceFeatures 描述的是人物的固定特征，在所有场景下都保持不变
- bodyProfile 是全身造型的稳定身体档案，不参与正脸近景文生图；它会继承到每套造型，只在全身造型图和四视图中使用
- looks 描述服装、年龄时期、身体状态和特殊形态的变化，不允许把同一人物拆成多个角色
- 基础造型参考已确认正脸；其他造型必须沿 referenceLookId 逐级图生图，不能跳过父级
- 生成图片时同时使用 faceFeatures、looks 和父级参考关系，确保身份一致但剧情状态准确变化`;

  const characterList = characterNames.map((c, i) => `${i + 1}. ${c}`).join('\n');
  const characterContextDigest = buildCharacterContextDigest(content, characterNames);
  const lifecycleContextDigest = buildLifecycleContextDigest(content);
  const lifecycleChecklist = formatCharacterLifecycleChecklist(
    buildCharacterLifecycleRequirements(content, characterNames)
  );
  
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    {
      role: 'user' as const,
      content: `请为以下所有人物生成详细信息（不要遗漏任何人）：\n${characterList}\n\n【程序核验生成的造型必填清单】\n下面每一项都有明确的集数、场次或剧情状态证据。你必须逐项映射到对应人物的 looks；属于同一视觉时期的多个场次应合并为一套造型，并合并 episodeNumbers 和 sceneNames，不能漏项，也不能机械拆成重复造型。\n${lifecycleChecklist}\n\n下面再提供从完整剧本中按人物检索的生命周期证据，帮助你补充清单之外的换装与变化：\n${characterContextDigest}\n\n【全剧本闪回、年龄时期与时间跳转重点段落】\n${lifecycleContextDigest}\n\n必须把上面每个重点段落映射到正确人物。即使段落只写“小林清”“小女孩”“她”“小时候的孩子”等别称，也要结合前后转场、亲属关系和同一事件确认身份；属于同一人物的幼年、童年、少年、青年、中年、老年状态必须进入该人物 looks。\n\n【完整执行剧本全文】\n你必须继续通读下面的完整文本，再综合判断性别、年龄、身份、关系、人物弧光、关键场景及不同阶段造型。不能只依据上面的摘要或首次出场；摘要与全文冲突时以全文为准。\n${content}`,
    }
  ];

  let response = '';
  try {
    const stream = oaiStream(messages, {
      temperature: 0.5,
      maxTokens: 24576,
    });

    for await (const chunk of stream) {
      if (chunk.content) response += chunk.content.toString();
    }
  } catch (error: any) {
    console.warn('人物详情模型提取失败，使用默认人物详情:', error?.message || error);
  }

  console.log(`人物详情提取响应长度: ${response.length} 字符`);
  console.log(`响应前500字符: ${response.substring(0, 500)}`);
  console.log(`响应后500字符: ${response.substring(Math.max(0, response.length - 500))}`);

  const result = tryExtractAndFixJSON(response);
  console.log(`JSON解析结果类型: ${typeof result}, 是否为null: ${result === null}`);
  if (result && typeof result === 'object') {
    console.log(`JSON解析结果键: ${Object.keys(result).join(', ')}`);
  }

  // 解析人物列表，更宽松的解析策略
  const characters: any[] = [];

  if (result && typeof result === 'object') {
    // 情况1: 标准格式 { characters: [...] }
    if (result.characters && Array.isArray(result.characters) && result.characters.length > 0) {
      characters.push(...result.characters);
      console.log(`JSON 解析成功，提取到 ${characters.length} 个人物（标准格式）`);
    } 
    // 情况2: 直接是数组格式 [...]
    else if (Array.isArray(result) && result.length > 0) {
      characters.push(...result);
      console.log(`JSON 解析为数组，提取到 ${characters.length} 个人物`);
    }
    // 情况3: 尝试其他可能的字段名
    else {
      for (const key of Object.keys(result)) {
        if (Array.isArray(result[key]) && result[key].length > 0) {
          characters.push(...result[key]);
          console.log(`JSON 从字段 ${key} 解析，提取到 ${characters.length} 个人物`);
          break;
        }
      }
    }
  }

  if (characters.length === 0) {
    console.log(`JSON 解析失败或结果为空，将基于 characterNames (${characterNames.length} 个) 生成默认数据`);
  } else {
    console.log(`成功解析 ${characters.length} 个人物的详细信息`);
    // 输出LLM返回的人物名称
    console.log(`LLM返回的人物名称: ${characters.map(c => c.name).join(', ')}`);
    console.log(`需要的人物名称: ${characterNames.join(', ')}`);
    // 找出缺失的人物
    const missingNames = characterNames.filter(name => !characters.some(c => c.name === name));
    if (missingNames.length > 0) {
      console.log(`缺失的人物: ${missingNames.join(', ')}`);
    }
  }

  // 确保所有人物都有完整的字段，尽量使用 LLM 返回的数据
  // 重要：使用 characterNames 的顺序来分配 id，确保名称和 id 正确对应
  const completeCharacters = characterNames.map((charName, idx) => {
    // 尝试从 LLM 返回的数据中找到匹配的人物（支持大小写不敏感匹配）
    const matchedChar = characters.find(c => 
      c.name === charName || 
      c.name.toLowerCase() === charName.toLowerCase() ||
      c.name.trim() === charName.trim()
    );
    
    // 使用 characterNames 的索引来生成全局唯一的 id
    const globalId = startId + idx + 1;
    const semanticCharacter = { ...(matchedChar || {}), name: charName };
    const isAnimalCreature = inferCharacterEntityKind(semanticCharacter) === 'animal-creature';
    const defaultGender = resolveCharacterGender(charName, content, matchedChar?.gender, semanticCharacter);
    const defaultAge = matchedChar?.age || (/村长|王叔|老陈|老板|刘总|孙总|钱老板/.test(charName) ? '45岁左右' : /李春梅|赵桂芳/.test(charName) ? '中年' : /张敏|李晓晓|小助理/.test(charName) ? '25岁左右' : /方宇/.test(charName) ? '28岁左右' : '30岁左右');
    const defaultPersonality = /方宇/.test(charName)
      ? ['冷静克制', '证据意识强', '外柔内刚']
      : /李春梅|赵桂芳/.test(charName)
        ? ['贪婪算计', '情绪外放', '欺软怕硬']
        : /张敏/.test(charName)
          ? ['真诚爽朗', '干练务实', '有分寸感']
          : /周特助|助理/.test(charName)
            ? ['专业谨慎', '执行力强', '反应敏捷']
            : ['性格鲜明', '行动直接', '服务剧情冲突'];
    
    // 生成默认的脸型特征
    const generateDefaultFaceFeatures = (char: any) => {
      if (isAnimalCreature) {
        return {
          faceShape: '符合物种的动物头骨与吻部轮廓，动物特征占主导',
          eyes: '符合剧情设定的兽类眼睛，目光与情绪清晰',
          nose: '动物鼻头与吻部结构清楚，不使用人类鼻型',
          mouth: '兽类口吻与牙齿结构，不使用人类唇形',
          skinTone: '符合物种设定的皮毛、鳞片或兽类表面材质',
        };
      }
      const gender = normalizeGender(char.gender) || defaultGender;
      return {
        faceShape: gender === '女' ? '鹅蛋脸或柔和椭圆脸，轮廓自然清晰' : gender === '男' ? '椭圆脸或方中带圆的脸型，轮廓稳定' : '自然写实脸型，轮廓清晰稳定',
        eyes: gender === '女' ? '眼型清晰有神，情绪表达明显' : gender === '男' ? '眼神专注，眉眼有辨识度' : '眼神清晰，情绪表达自然',
        nose: '鼻梁自然端正，符合写实真人比例',
        mouth: gender === '女' ? '唇形自然，表情变化细腻' : gender === '男' ? '唇线清楚，表情克制有力度' : '唇形自然，表情变化符合剧情',
        skinTone: gender === '女' ? '自然肤色，质感干净' : gender === '男' ? '自然健康肤色，保留真实皮肤质感' : '自然肤色，保留真实皮肤质感',
      };
    };

    const generateDefaultBodyProfile = (char: any): CharacterBodyProfile => {
      if (isAnimalCreature) {
        return mergeCharacterBodyProfiles(
          normalizeCharacterBodyProfile(char.bodyProfile, char.appearance),
          {
            height: '',
            weight: '',
            bodyType: '动物特征占主导的奇幻生物体型，解剖结构符合剧本物种设定',
            shoulderWaist: '肩背、胸腔与腰腹结构符合动物或兽类解剖',
            limbProportions: '四肢、爪、尾巴与头身比例符合物种设定',
            posture: '按剧本保持四足或明确的人形兽类姿态',
          }
        );
      }
      const gender = normalizeGender(char.gender) || defaultGender;
      const defaults: CharacterBodyProfile = {
        height: '',
        weight: '',
        bodyType: gender === '女'
          ? '自然匀称，体型与年龄和身份协调'
          : gender === '男'
            ? '自然匀称，体格与年龄和身份协调'
            : '自然比例，体型与年龄和身份协调',
        shoulderWaist: gender === '男' ? '肩腰比例自然，骨架稳定' : '肩腰比例自然，骨架协调',
        limbProportions: '四肢比例自然，符合人物年龄阶段',
        posture: '体态自然，站姿符合人物身份与剧情状态',
      };
      return mergeCharacterBodyProfiles(
        normalizeCharacterBodyProfile(char.bodyProfile, char.appearance),
        defaults
      );
    };

    // 生成默认的造型（至少一个）
    const generateDefaultLooks = (char: any) => {
      const gender = normalizeGender(char.gender) || defaultGender;
      const styleLabel = getCreationStyleLabel(creationBible);
      return [{
        id: 'look-1',
        scene: '默认造型',
        stage: '主要叙事时期',
        description: `${char.name}的基础出场造型，保持脸型和五官一致，服装根据人物身份与剧情阶段呈现${styleLabel}。`,
        costume: isAnimalCreature ? '无；除非剧本明确要求护甲、项圈或装饰' : char.costume && char.costume.length > 0 && !textContradictsGender(char.costume[0], gender) ? char.costume[0] : (gender === '女' ? '简洁生活装或职业装，颜色自然，方便在不同场景延展' : gender === '男' ? '简洁日常装或商务装，剪裁利落，贴合人物身份' : '简洁写实服装，颜色自然，贴合人物身份'),
        hairstyle: isAnimalCreature ? '毛发顺应动物头骨与身体结构生长，不使用任何人类发型' : gender === '女' ? '自然披发、低马尾或利落短发，根据场景微调' : gender === '男' ? '干净短发或自然整理发型' : '自然整理发型，贴合人物身份',
        accessories: [],
        makeup: isAnimalCreature ? '无；保持动物面部与皮毛自然材质' : gender === '女' ? '自然淡妆' : gender === '男' ? '自然无妆或轻微修饰' : '自然妆造',
        mood: '自然',
        changeType: '基础造型',
        ageStage: char.age || defaultAge || '主要时期',
        physicalState: '正常状态',
        transformationState: '',
        bodyProfile: generateDefaultBodyProfile(char),
        bodyChanges: '',
        episodeNumbers: [],
        sceneNames: ['默认造型'],
        sourceEvidence: '',
        isBaseLook: true,
        referenceLookId: '',
        referenceReason: '直接参考已确认的人物正脸身份基准图',
        generationPriority: 1,
      }];
    };

    // 生成默认的外貌描述（更详细的模板）
    const generateDefaultAppearance = (char: any) => {
      const genderText = normalizeGender(char.gender) || defaultGender;
      const ageText = char.age || defaultAge;
      const personalityText = char.personality && Array.isArray(char.personality) && char.personality.length > 0 
        ? char.personality[0] 
        : defaultPersonality[0];
      const genderRoleText = genderText === '待定' ? '角色' : `${genderText}性角色`;
      const styleLabel = getCreationStyleLabel(creationBible);
      if (isAnimalCreature) {
        return normalizeAppearanceDescription(
          char.appearance,
          `${char.name}是动物特征占主导的奇幻生物。头骨、吻部、兽耳、眼睛、鼻头、牙齿和皮毛符合剧本物种设定，毛发顺应动物头骨与身体结构生长，不出现人类皮肤、人类五官比例、女性长发、披发、马尾或其他人类发型。`
        );
      }
      const facialText = genderText === '女'
        ? '发型轮廓自然清晰，面部线条柔和但有辨识度，眉眼灵动，鼻唇比例协调'
        : genderText === '男'
          ? '发型干净利落，面部轮廓清晰稳定，眉眼有辨识度，鼻唇比例自然'
          : '发型与面部轮廓清晰稳定，固定五官具有辨识度';
      
      return `${char.name}是${ageText}的${genderRoleText}，${personalityText}。${facialText}，肤色均匀，皮肤清爽并保留自然纹理；正脸近景的表情和眼神符合人物身份，整体贴合${styleLabel}。`;
    };
    
    // 辅助函数：判断字符串是否有效（非空且不包含"待补充"相关关键词）
    const isValidString = (value: any): boolean => {
      return value && 
             typeof value === 'string' && 
             value.trim().length > 0 && 
             !value.includes('待补充') &&
             !value.includes('待完善');
    };

    // 辅助函数：专门用于验证外貌描述，更宽松的判断
    const isValidAppearance = (value: any): boolean => {
      if (!value || typeof value !== 'string' || value.trim().length < 10) {
        return false;
      }
      const trimmed = value.trim();
      // 检查是否只是占位符
      if (trimmed === '待补充' || trimmed === '待完善' || trimmed === '暂无描述') {
        return false;
      }
      // 检查是否完全是"待补充..."模式
      if (/^待补充[\u4e00-\u9fa5]+$/.test(trimmed)) {
        return false;
      }
      return true;
    };
    
    // 辅助函数：获取有效值，优先使用 matchedChar 的值，其次使用默认值
    const getValue = (matchedValue: any, defaultValue: any) => {
      if (matchedValue !== undefined && matchedValue !== null) {
        if (Array.isArray(matchedValue)) {
          return matchedValue.length > 0 ? matchedValue : defaultValue;
        }
        if (isValidString(matchedValue)) {
          return matchedValue;
        }
      }
      return defaultValue;
    };
    
    if (matchedChar) {
      // 使用 LLM 返回的数据，填充缺失的字段
      console.log(`人物 ${charName} 找到匹配数据，使用 LLM 返回的信息`);
      const normalizedModelGender = normalizeGender(matchedChar.gender);
      const genderWasCorrected = Boolean(normalizedModelGender && normalizedModelGender !== '待定' && normalizedModelGender !== defaultGender);
      const safeMatchedChar = { ...matchedChar, name: charName, gender: defaultGender };
      const defaultLook = generateDefaultLooks(safeMatchedChar)[0];
      const safeBodyProfile = generateDefaultBodyProfile(safeMatchedChar);
      const rawSafeLooks = !genderWasCorrected && !textContradictsGender(matchedChar.looks, defaultGender)
        ? getValue(matchedChar.looks, generateDefaultLooks(safeMatchedChar))
        : generateDefaultLooks(safeMatchedChar);
      const safeLooks = inheritBodyProfileForLooks(
        normalizeCharacterLooks(rawSafeLooks, defaultLook, getValue(matchedChar.age, defaultAge)),
        safeBodyProfile
      );
      const safeCostume = !genderWasCorrected && !textContradictsGender(matchedChar.costume, defaultGender)
        ? getValue(matchedChar.costume, [defaultLook.costume])
        : [defaultLook.costume];
      const safeCostumeDetails = !genderWasCorrected && matchedChar.costumeDetails && !textContradictsGender(matchedChar.costumeDetails, defaultGender)
        ? matchedChar.costumeDetails
        : {
            mainOutfit: defaultLook.costume,
            accessories: defaultLook.accessories,
            colorScheme: '自然写实配色',
            styleNotes: `贴合人物身份和${getCreationStyleLabel(creationBible)}`,
          };
      const defaultAppearance = generateDefaultAppearance(safeMatchedChar);
      const defaultFaceFeatures = generateDefaultFaceFeatures(safeMatchedChar);
      const modelFaceFeatures = !genderWasCorrected &&
        matchedChar.faceFeatures &&
        typeof matchedChar.faceFeatures === 'object' &&
        !Array.isArray(matchedChar.faceFeatures) &&
        !textContradictsGender(matchedChar.faceFeatures, defaultGender)
          ? matchedChar.faceFeatures
          : {};
      const safeFaceFeatures = {
        faceShape: getValue(modelFaceFeatures.faceShape, defaultFaceFeatures.faceShape),
        eyes: getValue(modelFaceFeatures.eyes, defaultFaceFeatures.eyes),
        nose: getValue(modelFaceFeatures.nose, defaultFaceFeatures.nose),
        mouth: getValue(modelFaceFeatures.mouth, defaultFaceFeatures.mouth),
        skinTone: getValue(modelFaceFeatures.skinTone, defaultFaceFeatures.skinTone),
      };
      return {
        id: globalId,
        name: charName,
        role: normalizeCharacterRole(getValue(matchedChar.role, '次要配角')),
        age: getValue(matchedChar.age, defaultAge),
        gender: defaultGender,
        personality: getValue(matchedChar.personality, defaultPersonality),
        // appearance 字段使用专门的验证函数
        appearance: normalizeAppearanceDescription(
          isValidAppearance(stripBodyDetailsFromAppearance(matchedChar.appearance)) && !textContradictsGender(matchedChar.appearance, defaultGender)
            ? stripBodyDetailsFromAppearance(matchedChar.appearance)
            : '',
          defaultAppearance
        ),
        faceFeatures: safeFaceFeatures,
        bodyProfile: safeBodyProfile,
        looks: safeLooks,
        background: getValue(matchedChar.background, `${charName}在剧情中承担${normalizeCharacterRole(getValue(matchedChar.role, '次要配角'))}功能，主要围绕核心矛盾推进人物关系和事件冲突。`),
        keyRelationships: getValue(matchedChar.keyRelationships, []),
        arc: getValue(matchedChar.arc, `${charName}随着剧情推进经历立场、情绪或处境变化，形象服务于故事冲突和反转。`),
        keyScenes: getValue(matchedChar.keyScenes, []),
        costume: safeCostume,
        costumeDetails: safeCostumeDetails,
        props: getValue(matchedChar.props, []),
      };
    } else {
      // 没有找到匹配的人物，生成默认数据
      console.log(`人物 ${charName} 没有在 LLM 响应中找到，生成默认数据`);
      return {
        id: globalId,
        name: charName,
        role: '次要配角',
        age: defaultAge,
        gender: defaultGender,
        personality: defaultPersonality,
        appearance: normalizeAppearanceDescription(
          '',
          generateDefaultAppearance({ name: charName, age: defaultAge, gender: defaultGender, personality: defaultPersonality })
        ),
        faceFeatures: generateDefaultFaceFeatures({ name: charName, gender: defaultGender }),
        bodyProfile: generateDefaultBodyProfile({ name: charName, gender: defaultGender }),
        looks: inheritBodyProfileForLooks(
          generateDefaultLooks({ name: charName, gender: defaultGender }),
          generateDefaultBodyProfile({ name: charName, gender: defaultGender })
        ),
        background: `${charName}在剧情中承担次要配角功能，主要围绕核心矛盾推进人物关系和事件冲突。`,
        keyRelationships: [],
        arc: `${charName}随着剧情推进经历立场、情绪或处境变化，形象服务于故事冲突和反转。`,
        keyScenes: [],
        costume: [generateDefaultLooks({ name: charName, gender: defaultGender })[0].costume],
        costumeDetails: {
          mainOutfit: generateDefaultLooks({ name: charName, gender: defaultGender })[0].costume,
          accessories: [],
          colorScheme: '自然写实配色',
          styleNotes: `贴合人物身份和${getCreationStyleLabel(creationBible)}`,
        },
        props: [],
      };
    }
  });

  console.log(`extractBatchCharacters 完成: characterNames=${characterNames.length}, completeCharacters=${completeCharacters.length}`);
  
  // 输出每个人物的详细信息用于调试
  completeCharacters.forEach((char, idx) => {
    console.log(`人物 ${idx + 1} [${char.name}]:`);
    console.log(`  - role: ${char.role}`);
    console.log(`  - appearance: ${char.appearance}`);
    console.log(`  - personality: ${JSON.stringify(char.personality)}`);
    console.log(`  - costume: ${JSON.stringify(char.costume)}`);
  });

  return {
    characters: completeCharacters.slice(0, characterNames.length),
    tokenUsage: {
      input: estimateMessagesTokens(messages),
      output: estimateTokens(response),
      timestamp: Date.now(),
    },
  };
}

/**
 * 传统方式提取人物（无人物标记时使用）
 */
async function extractCharactersTraditional(
  content: string,
  fileName: string,
  creationBible?: CreationBible
): Promise<any> {
  const systemPrompt = `你是一个专业的影视角色分析师。你的任务是：
${buildCreationBibleInstruction(creationBible)}
${buildLeadWardrobeInstruction(creationBible)}
${buildLeadCharacterExtractionInstruction(creationBible)}

1. 分析给定的文本内容，提取所有人物角色
2. 每个人物必须生成 role、age、gender、personality、appearance、bodyProfile、faceFeatures、looks、background、keyRelationships、arc、keyScenes、props
3. role 只能使用：主角、主要配角、次要配角、龙套、路人、背景人物
4. appearance 必须是 80-150 字正脸近景描述，只包含发型、脸型、五官、肤色质感和神态，禁止混入身高、体重、体型和服装
5. bodyProfile 独立记录身高、体重、体型、肩腰与骨架、四肢比例和体态；精确数值必须有剧本证据，否则只写合理视觉范围或留空
6. faceFeatures 必须是固定脸型特征，包括脸型、眼睛、鼻子、嘴巴、肤色，后续所有造型都保持一致
7. looks 必须建立同一人物的视觉变化时间线，识别服装造型、童年/青年/中年/老年等年龄时期、受伤/怀孕/病弱等身体状态，以及觉醒/入魔/变身等特殊形态
8. background 写背景故事，keyRelationships 写人物关系，arc 写人物弧光，keyScenes 写关键场景，props 写标志性道具
9. gender 只能使用：男、女、待定。角色名或称谓本身明确含有“男/女”时优先级最高；其余再根据与该人物直接绑定的称谓、代词、亲属关系、括号身份说明和互动判断，不能拿同场其他人物的代词替代。仍无法判断时按产品规则写“男”。
10. 性别判断优先级固定为：角色名中的明确性别 > 与人物直接绑定的剧本证据 > 模型综合判断 > 无法判断时默认男。女性护卫、女骑士等必须有明确女性证据。
11. 同一人物的不同时期和状态不能拆成新人物；连续场次没有明显视觉变化时合并，禁止机械组合不存在的造型
12. 每个人物必须有一个主要时期正常状态的基础造型；其他造型填写 referenceLookId，按“正脸→基础造型→年龄时期→服装造型→身体状态→特殊形态”建立依赖
13. 每个 looks 项必须继承人物 bodyProfile，并用 bodyChanges 单独说明当前时期、伤病、怀孕或变身造成的体态变化；没有变化则留空
14. 地狱犬、狼人、兽人、魔兽等非人角色必须保留动物/兽类解剖与物种特征，禁止套用普通人类脸型、皮肤、妆容或人类长发模板
15. 对 role=主角 的人类角色，必须严格执行上方“主角形象设计规则”，并在 appearance 与 faceFeatures 中落成可重复生成的具体结构；不得因此改变剧本明确设定。

请以 JSON 格式返回结果，格式如下：
{
  "totalCharacters": 人物总数,
  "characters": [
    {
      "id": 1,
      "name": "人物名称",
      "role": "主角/主要配角/次要配角/龙套/路人/背景人物",
      "age": "年龄",
      "gender": "男",
      "personality": ["性格特点1", "性格特点2"],
      "appearance": "80-150字正脸近景描述，只包含发型、脸型、五官、肤色质感和神态",
      "bodyProfile": {
        "height": "身高或合理视觉范围",
        "weight": "体重、体重范围或体重感",
        "bodyType": "体型和体格",
        "shoulderWaist": "肩宽、腰线与骨架",
        "limbProportions": "四肢和头身比例",
        "posture": "常态体态或站姿"
      },
      "faceFeatures": {
        "faceShape": "脸型",
        "eyes": "眼睛特征",
        "nose": "鼻子特征",
        "mouth": "嘴巴特征",
        "skinTone": "肤色"
      },
      "looks": [
        {
          "id": "look-1",
          "scene": "默认造型",
          "description": "造型描述",
          "costume": "服装",
          "hairstyle": "发型",
          "accessories": ["配饰"],
          "makeup": "化妆",
          "mood": "情绪",
          "changeType": "基础造型/服装造型/年龄时期/身体状态/特殊形态/复合变化",
          "ageStage": "青年",
          "physicalState": "正常状态",
          "transformationState": "",
          "bodyProfile": {
            "height": "继承人物身高",
            "weight": "继承人物体重",
            "bodyType": "继承人物体型",
            "shoulderWaist": "继承人物肩腰与骨架",
            "limbProportions": "继承人物四肢比例",
            "posture": "当前造型体态"
          },
          "bodyChanges": "",
          "episodeNumbers": [1],
          "sceneNames": ["关联场景"],
          "sourceEvidence": "剧本依据",
          "isBaseLook": true,
          "referenceLookId": "",
          "referenceReason": "参考关系说明",
          "generationPriority": 1
        }
      ],
      "background": "背景故事",
      "keyRelationships": [
        {
          "target": "关系对象",
          "relationship": "关系类型"
        }
      ],
      "arc": "人物弧光/发展轨迹",
      "keyScenes": ["关键出场场景1", "关键出场场景2"],
      "props": ["标志性道具1", "标志性道具2"]
    }
  ]
}

**重要提示**：
1. 必须返回完整且有效的 JSON 格式
2. 字符串中的引号需要转义为 \\"
3. 不要在 JSON 中添加注释
4. 确保所有数组和对象都正确闭合
5. 全文通读后再整理同一人物的时期与状态，所有变化必须符合剧情证据并保持固定五官身份一致`;

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: `请分析以下文本并提取所有人物：\n\n文件名：${fileName}\n\n内容：\n${content}` }
  ];

  const inputTokens = estimateMessagesTokens(messages);

  let fullResponse = '';
  try {
    const stream = oaiStream(messages, {
      temperature: 0.7,
    });

    for await (const chunk of stream) {
      if (chunk.content) {
        fullResponse += chunk.content.toString();
      }
    }
  } catch (error: any) {
    console.warn('传统人物模型提取失败，使用本地兜底:', error?.message || error);
    const localCharacters = extractLocalCharacterNames(content);
    const fallback = await extractBatchCharacters(content, localCharacters, 0, creationBible);
    return {
      totalCharacters: fallback.characters.length,
      characters: fallback.characters,
      tokenUsage: fallback.tokenUsage,
    };
  }

  const outputTokens = estimateTokens(fullResponse);

  console.log(`LLM 响应长度: ${fullResponse.length} 字符`);

  const result = tryExtractAndFixJSON(fullResponse);

  if (result) {
    if (Array.isArray(result.characters)) {
      result.characters = result.characters.map((character: any) => {
        const resolvedGender = resolveCharacterGender(character.name || '', content, character.gender, character);
        const fallbackLook = {
          id: 'look-1',
          scene: '默认造型',
          stage: '主要叙事时期',
          description: `${character.name || '该人物'}主要时期的正常状态基础造型`,
          costume: '符合人物身份和主要场景的基础服装',
          hairstyle: '保持人物辨识度的基础发型',
          accessories: [],
          makeup: resolvedGender === '女' ? '自然淡妆' : '自然妆造',
          mood: '自然',
          changeType: '基础造型',
          ageStage: character.age || '主要时期',
          physicalState: '正常状态',
          bodyProfile: normalizeCharacterBodyProfile(character.bodyProfile, character.appearance),
          bodyChanges: '',
          isBaseLook: true,
          generationPriority: 1,
        };
        const bodyProfile = normalizeCharacterBodyProfile(character.bodyProfile, character.appearance);
        return {
          ...character,
          role: normalizeCharacterRole(character.role),
          gender: resolvedGender,
          appearance: textContradictsGender(character.appearance, resolvedGender)
            ? ''
            : stripBodyDetailsFromAppearance(character.appearance),
          bodyProfile,
          looks: inheritBodyProfileForLooks(
            normalizeCharacterLooks(character.looks, fallbackLook, character.age || ''),
            bodyProfile
          ),
        };
      });
    }

    return {
      ...result,
      tokenUsage: {
        input: inputTokens,
        output: outputTokens,
        timestamp: Date.now(),
      },
    };
  } else {
    console.error('JSON 解析失败，无法修复');
    return {
      totalCharacters: 0,
      characters: [],
      tokenUsage: {
        input: inputTokens,
        output: outputTokens,
        timestamp: Date.now(),
      },
    };
  }
}
