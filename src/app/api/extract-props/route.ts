import { NextRequest, NextResponse } from 'next/server';
import { stream as oaiStream, invoke as oaiInvoke } from '@/lib/openai-client';
import { estimateMessagesTokens, estimateTokens } from '@/lib/token-utils';
import { tryExtractAndFixJSON } from '@/lib/json-utils';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import { expandPropStateUnits } from '@/lib/prop-state-utils';
import { buildCreationStyleInstruction } from '@/lib/creation-style-presets';

// 每批处理的道具数
const BATCH_SIZE = 8;
const PROP_AUDIT_MAX_INPUT_TOKENS = 780_000;
const PROP_AUDIT_CHUNK_TOKENS = 180_000;

export const maxDuration = 300;

type CreationBible = {
  creationType?: string;
  subjectRegion?: string;
  creationBackground?: string;
  creativeStyle?: string;
};

type PropOccurrence = {
  episodeNumber: number | null;
  episodeLabel: string;
  sceneName: string;
  heading: string;
  stateLabel: string;
};

type PropInventoryState = {
  stateName: string;
  episodeNumber?: number | null;
  episodeLabel?: string;
  sceneName?: string;
  episodeNumbers?: number[];
  occurrences?: PropOccurrence[];
  visualChange?: string;
  transitionEvent?: string;
  narrativeFunction?: string;
  evidence?: string;
};

type PropInventoryItem = {
  name: string;
  aliases: string[];
  type?: string;
  owner?: string;
  firstAppearanceOrder?: number;
  episodeNumbers?: number[];
  appearanceScenes?: string[];
  functionSummary?: string;
  visualSummary?: string;
  states: PropInventoryState[];
  evidence?: string[];
};

function buildCreationBibleInstruction(creationBible?: CreationBible): string {
  const creationType = typeof creationBible?.creationType === 'string' ? creationBible.creationType.trim() : '';
  const subjectRegion = typeof creationBible?.subjectRegion === 'string' ? creationBible.subjectRegion.trim() : '';
  const creationBackground = typeof creationBible?.creationBackground === 'string'
    ? creationBible.creationBackground.trim()
    : '';
  const creationStyleInstruction = buildCreationStyleInstruction(creationBible?.creativeStyle);
  if (!creationType && !subjectRegion && !creationBackground && !creationStyleInstruction) return '';

  const lines = ['【创作圣经约束】'];
  if (creationType === '仿真人') {
    lines.push('创作类型：仿真人。道具描述要服务真人实拍/产品摄影质感，强调真实材质、磨损痕迹、可拍摄细节和真实比例。');
  } else if (creationType === '3D') {
    lines.push('创作类型：3D。道具描述要服务3D资产制作，强调模型结构、材质分区、边缘轮廓、可渲染纹理和统一CG质感。');
  } else if (creationType === '动漫') {
    lines.push('创作类型：动漫。道具描述要服务动漫/动画美术，强调清晰轮廓、色块、符号化特征、可识别形状和动画表现力。');
  }
  if (subjectRegion === '国内') {
    lines.push('创作题材：国内。道具的样式、标识、材质和使用场景应符合中国本土语境。');
  } else if (subjectRegion === '国外') {
    lines.push('创作题材：国外。道具的样式、品牌感、生活方式和使用场景应符合海外/国际化语境。');
  }
  if (creationBackground === '近代') {
    lines.push('创作背景：近代。道具的造型、材料、制造工艺、文字标识和使用方式应符合近代社会与早期工业化年代特征。');
  } else if (creationBackground === '现代') {
    lines.push('创作背景：现代。道具的造型、材料、技术水平、文字标识和使用方式应符合现代生活语境。');
  } else if (creationBackground === '古代') {
    lines.push('创作背景：古代。道具的造型、材料、制造工艺、文字形态和使用方式应符合古代生产力与礼制，禁止无剧情依据的现代工业品和电子设备。');
  }
  if (creationStyleInstruction) lines.push(creationStyleInstruction);
  lines.push('这些约束只影响视觉风格、题材语境和时代背景，不允许改动原剧情、道具功能和归属关系；如剧本明确存在回忆、年代跳转或穿越，按原剧情保留跨时代道具。');
  return lines.join('\n');
}

export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const { content, fileName, batch = 0, propMarkers, propInventory, creationBible, sourceType } = await request.json();

    if (sourceType !== 'execution-script') {
      return NextResponse.json(
        { error: '道具提取仅允许使用当前执行剧本，请先重新拉取执行剧本' },
        { status: 400 }
      );
    }

    if (!content) {
      return NextResponse.json(
        { error: '未提供文件内容' },
        { status: 400 }
      );
    }

    console.log(`开始提取道具，文件: ${fileName}, 批次: ${batch}, 内容长度: ${content.length}`);

    // 初始化 LLM 客户端

    // 第一批或没有道具标记时：识别所有道具名称
    let allPropMarkers: string[] = filterValidPropNames(Array.isArray(propMarkers) ? propMarkers : []);
    let allPropInventory: PropInventoryItem[] = filterValidPropInventory(normalizePropInventory(propInventory));
    
    if (batch <= 1 || !propMarkers || propMarkers.length === 0) {
      // 先让大模型通读全文，建立完整物品实体表，再按实体表分批补详情。
      allPropInventory = filterValidPropInventory(await identifyPropInventory(content, fileName, creationBible));
      allPropMarkers = filterValidPropNames(allPropInventory.map(item => item.name));
      console.log(`识别到 ${allPropMarkers.length} 个主道具:`, allPropMarkers);
    } else if (allPropInventory.length === 0) {
      // 兼容旧的批次缓存：只有名称时仍可继续提取。
      allPropInventory = filterValidPropInventory(allPropMarkers.map((name, index) => createMinimalPropInventoryItem(name, index)));
    }

    if (allPropMarkers.length === 0) {
      // 如果没有识别到道具标记，使用传统方式
      const result = await extractPropsTraditional(content, fileName, creationBible);
      return NextResponse.json({
        success: true,
        type: 'props',
        data: result,
        batchInfo: {
          currentBatch: 1,
          totalBatches: 1,
          hasMore: false,
        },
        tokenUsage: result.tokenUsage,
      });
    }

    // 分批提取道具详情
    const totalBatches = Math.ceil(allPropMarkers.length / BATCH_SIZE);
    // 确保 batch 至少为 1
    const currentBatch = Math.max(1, batch);
    const currentBatchStart = (currentBatch - 1) * BATCH_SIZE;
    const currentBatchProps = allPropMarkers.slice(currentBatchStart, currentBatchStart + BATCH_SIZE);
    const currentBatchInventory = currentBatchProps
      .map(name => findMatchingInventoryItem(allPropInventory, name))
      .filter((item): item is PropInventoryItem => Boolean(item));
    
    console.log(`处理第 ${currentBatch}/${totalBatches} 批，道具: ${currentBatchProps.join(', ')}`);

    // 提取当前批次的道具详情，传入起始 id 确保全局唯一
    const startId = currentBatchStart;
    const batchResult = await extractBatchProps(content, currentBatchProps, startId, creationBible, currentBatchInventory);
    
    const hasMore = currentBatch < totalBatches;

    return NextResponse.json({
      success: true,
      type: 'props',
      data: {
        totalProps: allPropMarkers.length,
        totalMainProps: buildPropGroups(batchResult.props).length,
        totalPropStates: countPropStates(batchResult.props),
        props: batchResult.props,
        propGroups: buildPropGroups(batchResult.props),
      },
      batchInfo: {
        currentBatch: currentBatch,
        totalBatches,
        hasMore,
        propMarkers: allPropMarkers,
        propInventory: allPropInventory,
      },
      tokenUsage: batchResult.tokenUsage,
    });
  } catch (error: any) {
    console.error('道具提取失败:', error);
    console.error('错误详情:', error?.message);
    return NextResponse.json(
      { error: '道具提取失败', details: error?.message },
      { status: 500 }
    );
  }
}

function normalizeStringList(value: unknown, limit = 80): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const text = item.replace(/\s+/g, ' ').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function normalizeEpisodeNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map(item => Number(item))
      .filter(item => Number.isFinite(item) && item > 0)
  )).sort((a, b) => a - b);
}

const NON_PROP_BODY_PART_PATTERN = /(眼尾|眼角|眼眶|眼睛|眼球|眼泪|泪水|泪痕|嘴角|嘴唇|脸颊|面颊|脸部|面部|额头|头发|发丝|肩膀|肩头|肩胛|脖颈|脖子|颈侧|喉结|胸口|后背|腰背|手臂|手腕|手掌|手指|膝盖|脚踝|皮肤|旧伤|伤口|伤疤|血痕|淤青|伤势)/;
const NON_PROP_ATMOSPHERE_PATTERN = /(血腥味|铁锈味|气味|味道|异味|香味|臭味|腥味|氛围|气氛|压迫感|寒意|恐惧感|悲伤感|紧张感|杀气|怒意|眼神|表情|情绪|状态)$/;
const PROP_OBJECT_HINT_PATTERN = /(刀|剑|枪|棍|棒|针|锤|斧|衣|衫|裙|裤|鞋|帽|袜|手套|披风|外套|制服|礼服|盔甲|甲|面具|眼镜|戒指|项链|耳环|玉佩|饰品|包|箱|盒|瓶|杯|碗|盘|锅|纸|单|票|证|书|本|信|照片|相框|手机|电脑|钥匙|车|门|窗|灯|桌|椅|床|柜|镜|绳|链|药|符|印|旗|牌|令|珠|石|晶|卷轴|法杖|阵盘|法器|护符|血袋|绷带)/;
const VISIBLE_EFFECT_PATTERN = /(法术|法阵|阵法|符文|灵力|魔法|能量|光效|特效|烟雾|雾气|火焰|闪电|雷电|冰霜|结界|护盾|血雾|黑雾|光环|气刃|剑气)/;

function isInvalidPropCandidateName(rawName: unknown): boolean {
  if (typeof rawName !== 'string') return true;
  const name = getMainPropName(rawName).replace(/\s+/g, '').trim();
  if (!name) return true;
  if (VISIBLE_EFFECT_PATTERN.test(name)) return false;
  if (NON_PROP_ATMOSPHERE_PATTERN.test(name)) return true;
  if (NON_PROP_BODY_PART_PATTERN.test(name) && !PROP_OBJECT_HINT_PATTERN.test(name)) return true;
  return false;
}

function filterValidPropInventory(items: PropInventoryItem[]): PropInventoryItem[] {
  return items.filter(item => !isInvalidPropCandidateName(item.name));
}

function filterValidPropNames(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    if (isInvalidPropCandidateName(name)) continue;
    const key = normalizePropNameForIdentity(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

function createMinimalPropInventoryItem(name: string, index: number): PropInventoryItem {
  return {
    name: getMainPropName(name),
    aliases: name === getMainPropName(name) ? [] : [name],
    firstAppearanceOrder: index + 1,
    states: [],
  };
}

function normalizePropInventory(value: unknown): PropInventoryItem[] {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as any).inventory)
      ? (value as any).inventory
      : value && typeof value === 'object' && Array.isArray((value as any).props)
        ? (value as any).props
        : [];

  const normalized: PropInventoryItem[] = [];
  source.forEach((raw: any, index: number) => {
    if (typeof raw === 'string') {
      const item = createMinimalPropInventoryItem(raw, index);
      if (item.name) normalized.push(item);
      return;
    }
    if (!raw || typeof raw !== 'object') return;
    const rawName = raw.name || raw.propName || raw.mainPropName;
    if (typeof rawName !== 'string') return;
    const name = getMainPropName(rawName);
    if (!name || name.length > 60) return;
    if (isInvalidPropCandidateName(name)) return;
    const statesSource = Array.isArray(raw.states)
      ? raw.states
      : Array.isArray(raw.stateVariants)
        ? raw.stateVariants
        : [];
    const states: PropInventoryState[] = statesSource
      .map((state: any) => {
        const stateName = String(state?.stateName || state?.name || state?.stage || '').trim();
        const occurrences: PropOccurrence[] = (Array.isArray(state?.occurrences) ? state.occurrences : [])
          .flatMap((occurrence: any) => {
            if (!occurrence || typeof occurrence !== 'object') return [];
            const episodeNumber = Number.isFinite(Number(occurrence.episodeNumber))
              ? Number(occurrence.episodeNumber)
              : null;
            const episodeLabel = typeof occurrence.episodeLabel === 'string' && occurrence.episodeLabel.trim()
              ? occurrence.episodeLabel.trim()
              : episodeNumber
                ? `第${episodeNumber}集`
                : '未标注集数';
            const sceneName = String(occurrence.sceneName || occurrence.scene || '').trim();
            const heading = String(occurrence.heading || '').trim();
            if (!episodeNumber && !sceneName && !heading) return [];
            return [{
              episodeNumber,
              episodeLabel,
              sceneName,
              heading,
              stateLabel: String(occurrence.stateLabel || stateName).trim(),
            }];
          });
        const episodeNumber = Number.isFinite(Number(state?.episodeNumber)) ? Number(state.episodeNumber) : null;
        const episodeNumbers = normalizeEpisodeNumbers([
          ...(Array.isArray(state?.episodeNumbers) ? state.episodeNumbers : []),
          episodeNumber,
          ...occurrences.map(item => item.episodeNumber),
        ]);
        return {
          stateName,
          episodeNumber,
          episodeLabel: typeof state?.episodeLabel === 'string' ? state.episodeLabel.trim() : '',
          sceneName: typeof state?.sceneName === 'string'
            ? state.sceneName.trim()
            : typeof state?.scene === 'string'
              ? state.scene.trim()
              : '',
          episodeNumbers,
          occurrences,
          visualChange: typeof state?.visualChange === 'string' ? state.visualChange.trim() : '',
          transitionEvent: typeof state?.transitionEvent === 'string' ? state.transitionEvent.trim() : '',
          narrativeFunction: typeof state?.narrativeFunction === 'string'
            ? state.narrativeFunction.trim()
            : typeof state?.storyFunction === 'string'
              ? state.storyFunction.trim()
              : '',
          evidence: typeof state?.evidence === 'string' ? state.evidence.trim().slice(0, 240) : '',
        };
      })
      .filter((state: PropInventoryState) => Boolean(state.stateName));
    normalized.push({
      name,
      aliases: normalizeStringList([...(Array.isArray(raw.aliases) ? raw.aliases : []), rawName])
        .filter(alias => normalizePropNameForIdentity(alias) !== normalizePropNameForIdentity(name)),
      type: typeof raw.type === 'string' ? raw.type.trim() : '',
      owner: typeof raw.owner === 'string' ? raw.owner.trim() : '',
      firstAppearanceOrder: Number.isFinite(Number(raw.firstAppearanceOrder))
        ? Number(raw.firstAppearanceOrder)
        : index + 1,
      episodeNumbers: normalizeEpisodeNumbers(raw.episodeNumbers),
      appearanceScenes: normalizeStringList(raw.appearanceScenes, 30),
      functionSummary: typeof raw.functionSummary === 'string'
        ? raw.functionSummary.trim()
        : typeof raw.function === 'string'
          ? raw.function.trim()
          : '',
      visualSummary: typeof raw.visualSummary === 'string'
        ? raw.visualSummary.trim()
        : typeof raw.visualDescription === 'string'
          ? raw.visualDescription.trim()
          : '',
      states,
      evidence: normalizeStringList(raw.evidence, 12).map(item => item.slice(0, 240)),
    });
  });
  return filterValidPropInventory(mergePropInventoryItems(normalized));
}

function mergePropOccurrences(occurrences: PropOccurrence[]): PropOccurrence[] {
  const seen = new Set<string>();
  return occurrences.filter(occurrence => {
    const key = [
      occurrence.episodeNumber ?? occurrence.episodeLabel,
      occurrence.heading || occurrence.sceneName,
      occurrence.stateLabel,
    ].map(value => String(value || '').replace(/\s+/g, '')).join('::');
    if (!key.replace(/:/g, '') || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergePropInventoryItems(items: PropInventoryItem[]): PropInventoryItem[] {
  const merged: PropInventoryItem[] = [];
  for (const item of items) {
    const identities = new Set(
      [item.name, ...item.aliases]
        .map(normalizePropNameForIdentity)
        .filter(Boolean)
    );
    const existing = merged.find(candidate => {
      const currentOwner = String(item.owner || '').replace(/\s+/g, '');
      const candidateOwner = String(candidate.owner || '').replace(/\s+/g, '');
      const hasDistinctOwners = Boolean(
        currentOwner &&
        candidateOwner &&
        currentOwner !== candidateOwner &&
        !/^(公共|场景|无|未知|不适用)/.test(currentOwner) &&
        !/^(公共|场景|无|未知|不适用)/.test(candidateOwner)
      );
      if (hasDistinctOwners) return false;
      return [candidate.name, ...candidate.aliases]
        .map(normalizePropNameForIdentity)
        .some(identity => identities.has(identity));
    });
    if (!existing) {
      merged.push({
        ...item,
        aliases: [...item.aliases],
        states: [...item.states],
        episodeNumbers: [...(item.episodeNumbers || [])],
        appearanceScenes: [...(item.appearanceScenes || [])],
        evidence: [...(item.evidence || [])],
      });
      continue;
    }

    existing.aliases = normalizeStringList([...existing.aliases, item.name, ...item.aliases])
      .filter(alias => normalizePropNameForIdentity(alias) !== normalizePropNameForIdentity(existing.name));
    existing.episodeNumbers = normalizeEpisodeNumbers([
      ...(existing.episodeNumbers || []),
      ...(item.episodeNumbers || []),
    ]);
    existing.appearanceScenes = normalizeStringList([
      ...(existing.appearanceScenes || []),
      ...(item.appearanceScenes || []),
    ], 40);
    existing.evidence = normalizeStringList([
      ...(existing.evidence || []),
      ...(item.evidence || []),
    ], 16);
    existing.firstAppearanceOrder = Math.min(
      existing.firstAppearanceOrder || Number.MAX_SAFE_INTEGER,
      item.firstAppearanceOrder || Number.MAX_SAFE_INTEGER,
    );
    existing.type ||= item.type;
    existing.owner ||= item.owner;
    existing.functionSummary ||= item.functionSummary;
    existing.visualSummary ||= item.visualSummary;

    for (const state of item.states) {
      const identity = state.stateName.replace(/\s+/g, '');
      if (!identity) continue;
      const existingState = existing.states.find(candidate => candidate.stateName.replace(/\s+/g, '') === identity);
      if (!existingState) {
        existing.states.push(state);
        continue;
      }
      existingState.episodeNumbers = normalizeEpisodeNumbers([
        ...(existingState.episodeNumbers || []),
        ...(state.episodeNumbers || []),
        existingState.episodeNumber,
        state.episodeNumber,
      ]);
      existingState.occurrences = mergePropOccurrences([
        ...(existingState.occurrences || []),
        ...(state.occurrences || []),
      ]);
      existingState.episodeNumber ||= state.episodeNumber;
      existingState.episodeLabel ||= state.episodeLabel;
      existingState.sceneName ||= state.sceneName;
      existingState.visualChange ||= state.visualChange;
      existingState.transitionEvent ||= state.transitionEvent;
      existingState.narrativeFunction ||= state.narrativeFunction;
      existingState.evidence ||= state.evidence;
    }
  }

  return merged.sort((a, b) => (
    (a.firstAppearanceOrder || Number.MAX_SAFE_INTEGER) - (b.firstAppearanceOrder || Number.MAX_SAFE_INTEGER)
  ));
}

function findMatchingInventoryItem(items: PropInventoryItem[], propName: string): PropInventoryItem | undefined {
  const identity = normalizePropNameForIdentity(propName);
  return items.find(item => (
    [item.name, ...item.aliases].some(name => normalizePropNameForIdentity(name) === identity)
  ));
}

function parsePropInventoryResponse(response: string): PropInventoryItem[] {
  const parsed = tryExtractAndFixJSON(response);
  const normalized = normalizePropInventory(parsed);
  if (normalized.length > 0) return normalized;

  const namedValues = Array.from(
    response.matchAll(/"(?:name|mainPropName|propName)"\s*:\s*"([^"]+)"/g),
    match => match[1],
  );
  if (namedValues.length > 0) return normalizePropInventory(namedValues);

  const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  if (!cleaned.startsWith('[')) return [];
  const arrayValues = Array.from(cleaned.matchAll(/"([^"]+)"/g), match => match[1]);
  return normalizePropInventory(arrayValues);
}

function splitContentForPropAudit(content: string): string[] {
  if (estimateTokens(content) <= PROP_AUDIT_MAX_INPUT_TOKENS) return [content];

  const lines = content.replace(/\r/g, '').split('\n');
  const chunks: string[] = [];
  let currentLines: string[] = [];
  let currentTokens = 0;

  for (const line of lines) {
    const lineTokens = estimateTokens(line) + 1;
    if (currentLines.length > 0 && currentTokens + lineTokens > PROP_AUDIT_CHUNK_TOKENS) {
      chunks.push(currentLines.join('\n'));
      currentLines = currentLines.slice(-8);
      currentTokens = estimateTokens(currentLines.join('\n'));
    }
    currentLines.push(line);
    currentTokens += lineTokens;
  }
  if (currentLines.length > 0) chunks.push(currentLines.join('\n'));
  return chunks;
}

function buildPropInventoryPrompt(creationBible?: CreationBible): string {
  return `你是资深影视制片、道具统筹和剧本语义分析专家。你必须先完整阅读给定剧本文本，再建立穷尽式物品实体表。
${buildCreationBibleInstruction(creationBible)}

【道具判定标准】
1. 除人物、动物和场景地点本身之外，剧情中提到的一切“可独立制作成素材图的具体物品”都属于道具，不能只提关键道具，也不能以“是否重要”作为筛选条件。
2. 必须覆盖人物手持、携带、穿戴、使用、交换、赠送、丢弃、损坏的物品；家具、家电、灯具、门窗部件、交通工具、电子设备、文件票据、书籍、证件、药品、食物饮料、容器包装、工具武器、首饰配件、服装鞋帽、玩具、清洁用品、办公用品、陈设摆件、临时消耗品和背景中被明确提到的物件。
3. 必须排除人物/动物、人体部位、人物状态、伤势、表情、眼神、情绪、动作、关系、纯地点或房间名称、抽象概念、光线、天气、纯声音、气味和氛围。比如“眼尾、肩膀、脖颈、旧伤、伤口、血腥味、铁锈味、压迫感、悲伤感”都不是道具。
4. “某人的身体部位/伤势/表情/眼神/气味”不得当道具提取；只有真实可独立存在的物件才可提取，例如“沈屹的旧外套、苏念的手机、带血短刀、退货单、相框”。
5. 剧本中明确出现的可见法术、能量、法阵、符文、烟雾、火焰、闪电、血雾等视觉特效，可以作为“特效道具”提取；但只是“味道、气氛、压迫感、杀气”等不可见感受不得提取。
6. 被剧情明确提到的固定物件仍要提取，例如门、窗、灯、桌椅、床、镜子、招牌。
7. 同一个物理物品的别名、简称、代称必须合并。比如“母亲留下的玉佩 / 玉佩 / 碎玉佩”是同一个实体。
8. 同类但属于不同人物或承担不同剧情身份的物品不能误合并。例如“沈念的手机”和“顾延之的手机”应分别记录；名称中加入归属人或稳定识别特征。
9. 同一个物品的完整、破碎、损坏、染血、烧毁、修复、打开、关闭、空、装满、十年前、十年后等视觉变化必须归入同一条记录的 states，按剧情首次出现顺序排列，不能误当成两个物理道具。
10. states 中的每个状态都是后续独立制作的一张图，必须分别填写自己的 episodeNumbers 和 occurrences。只有变化后的状态持续到另一个独立场次，并在该场次承担新的线索、冲突、证据、结果或人物行动作用，才可新增状态。
11. 同一场戏内部发生的拿起、放下、打开、关闭、使用、摔碎、燃烧、装满、倒空等连续动作，不单列静态状态图，这些交给视频模型表现。除非变化后的结果在后续另一个场次再次出现并推动剧情。
12. 每个后续状态必须填写 transitionEvent、narrativeFunction 和 evidence，明确“怎样变成该状态”“该状态在哪个后续场次发挥什么不同作用”“原文依据是什么”；缺少跨场次剧情作用时不得新增。
13. “泛黄的退货单”“磨损的旧皮箱”等从首次到最后都不变的固有外观，只是一个基准状态，不得再凭形容词虚构“完整状态 + 旧化状态”。同一状态在多集出现时合并到该状态的 episodeNumbers/occurrences。
14. 必须从开头读到结尾后再输出；不限制数量，长剧本出现 100 至 300 个物品是正常情况。宁可多提取，不可漏掉普通小物件。
15. 创作圣经用于规范 type、visualSummary 和状态视觉表达，但不得改写或凭空增加剧情物品、状态或集数。

输出严格 JSON：
{
  "inventory": [
    {
      "name": "稳定、可区分物理实体的主名称",
      "aliases": ["剧本中的其他称呼"],
      "type": "人物道具/场景道具/特效道具/服装配饰/交通工具/消耗品/背景道具",
      "owner": "归属人物或公共/场景",
      "firstAppearanceOrder": 1,
      "episodeNumbers": [1, 2],
      "appearanceScenes": ["场景名"],
      "functionSummary": "剧情中如何被使用；普通陈设也如实说明",
      "visualSummary": "符合创作圣经的材质、颜色、形制和识别特征概括",
      "states": [
        {
          "stateName": "首次出现时的准确状态名",
          "episodeNumbers": [1, 2],
          "occurrences": [
            {"episodeNumber": 1, "episodeLabel": "第1集", "sceneName": "场景名", "heading": "1-1 场景名", "stateLabel": "该状态名"}
          ],
          "visualChange": "基准状态",
          "transitionEvent": "首个制作状态，无前置变化",
          "narrativeFunction": "该状态在对应场次中的剧情作用",
          "evidence": "能证明该物品及状态的简短原文依据"
        }
      ],
      "evidence": ["首次或关键出现的简短原文依据"]
    }
  ]
}`;
}

async function auditPropInventoryChunk(
  content: string,
  fileName: string,
  creationBible: CreationBible | undefined,
  scopeLabel: string,
): Promise<PropInventoryItem[]> {
  const messages = [
    { role: 'system' as const, content: buildPropInventoryPrompt(creationBible) },
    {
      role: 'user' as const,
      content: `文件名：${fileName}\n阅读范围：${scopeLabel}\n\n请通读以下剧本文本后，输出穷尽式物品实体表：\n\n${content}`,
    },
  ];
  const response = await oaiInvoke(messages, {
    temperature: 0.1,
    maxTokens: 32768,
    timeout: 300_000,
    billingLabel: '道具全文盘点',
  });
  return parsePropInventoryResponse(response);
}

async function consolidatePropInventories(
  inventories: PropInventoryItem[],
  creationBible?: CreationBible,
): Promise<PropInventoryItem[]> {
  const deterministic = mergePropInventoryItems(inventories);
  if (deterministic.length === 0) return [];
  const messages = [
    {
      role: 'system' as const,
      content: `你是影视道具总表审核员。请合并分段盘点结果中的同一物理物品，同时保留同类但归属或剧情身份不同的物品。不同状态必须合并到同一物品的 states，并保留所有集数、场景、别名和原文依据。不得删掉普通或背景物品。\n${buildCreationBibleInstruction(creationBible)}\n只输出与输入相同结构的严格 JSON 对象 {"inventory": [...]}。`,
    },
    {
      role: 'user' as const,
      content: `请审核并合并以下分段道具总表：\n${JSON.stringify({ inventory: deterministic })}`,
    },
  ];
  try {
    const response = await oaiInvoke(messages, {
      temperature: 0.1,
      maxTokens: 32768,
      timeout: 300_000,
      billingLabel: '道具总表归并',
    });
    const consolidated = parsePropInventoryResponse(response);
    return consolidated.length > 0 ? consolidated : deterministic;
  } catch (error: any) {
    console.warn('道具分段总表模型归并失败，使用本地归并结果:', error?.message || error);
    return deterministic;
  }
}

/**
 * 让大模型通读全文，建立所有物品及其状态的实体总表。
 */
async function identifyPropInventory(
  content: string,
  fileName: string,
  creationBible?: CreationBible,
): Promise<PropInventoryItem[]> {
  const taggedProps = extractTaggedNames(content, '道具');
  const chunks = splitContentForPropAudit(content);
  const chunkInventories: PropInventoryItem[] = [];

  try {
    for (let index = 0; index < chunks.length; index++) {
      const scopeLabel = chunks.length === 1 ? '全文' : `全文第 ${index + 1}/${chunks.length} 段`;
      const items = await auditPropInventoryChunk(chunks[index], fileName, creationBible, scopeLabel);
      chunkInventories.push(...items.map((item, itemIndex) => ({
        ...item,
        firstAppearanceOrder: index * 100_000 + (item.firstAppearanceOrder || itemIndex + 1),
      })));
    }
  } catch (error: any) {
    console.warn('道具全文盘点失败，将保留已完成结果并加入本地标记:', error?.message || error);
  }

  const modelInventory = chunks.length > 1
    ? await consolidatePropInventories(chunkInventories, creationBible)
    : mergePropInventoryItems(chunkInventories);
  const taggedInventory = taggedProps.map((name, index) => (
    createMinimalPropInventoryItem(name, modelInventory.length + index)
  ));
  const merged = filterValidPropInventory(mergePropInventoryItems([...modelInventory, ...taggedInventory]));
  console.log(`道具全文盘点: 模型 ${modelInventory.length} 个，本地标记 ${taggedProps.length} 个，合并后 ${merged.length} 个`);
  return merged;
}

function extractTaggedNames(content: string, tagName: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const addSegment = (segment: string) => {
    const cleanedSegment = segment
      .replace(/。.*$/g, '')
      .replace(/；.*$/g, '')
      .replace(/，?时间[:：].*$/g, '');

    for (const rawName of cleanedSegment.split(/[、,，;；\s]+/)) {
      const name = rawName
        .replace(/（.*?）/g, '')
        .replace(/\(.*?\)/g, '')
        .replace(/[:：].*$/g, '')
        .trim();

      if (name && name.length <= 20 && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  };

  const patterns = [
    new RegExp(`【${tagName}】([^【\\n\\r]+)`, 'g'),
    new RegExp(`${tagName}[:：]([^。\\n\\r]+)`, 'g'),
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      addSegment(match[1]);
    }
  }

  if (names.length === 0 && tagName === '道具') {
    const commonProps = [
      '探照灯', '铁锤', '沙发', '公文包', '检测仪', '喷雾', '黄色胶带', '本子', '纸笔',
      '保安亭', '劳斯莱斯', '安保系统', '话筒', '手机', '直播摄像头', '文件', '合同',
      '转账记录', '车钥匙', '横幅', '舞狮', '锣鼓', '鞭炮', '冰箱', '空调', '资质证书',
      '饭盒', '项链', '婚纱', '钥匙', '证书', '摄像头', '车辆', '锤子',
    ];
    for (const prop of commonProps) {
      if (content.includes(prop) && !seen.has(prop)) {
        seen.add(prop);
        names.push(prop);
      }
    }
  }

  return filterValidPropNames(names);
}

function normalizePropNameForIdentity(rawName: unknown): string {
  if (typeof rawName !== 'string') return '';
  return getMainPropName(rawName)
    .replace(/[【】\[\]（）()《》"'“”‘’]/g, '')
    .replace(/[，,。；;：:、\s]+/g, '')
    .trim();
}

function normalizePropNameForMatch(rawName: unknown): string {
  if (typeof rawName !== 'string') return '';
  return normalizePropNameForIdentity(rawName);
}

function getMainPropName(rawName: unknown): string {
  if (typeof rawName !== 'string') return '';
  const stateWords = '完整|基准|原始|破碎|碎裂|损坏|破损|裂开|断裂|旧化|陈旧|老旧|沾血|染血|血迹|烧毁|焦黑|修复|修好|打开|关闭|空的|空置|空瓶|空盒|空状态|装满|改造前|改造后|十年前|10年前|十年后|10年后|遗失|失效';
  const cleaned = rawName
    .replace(/^(?:一把|一个|一只|一件|一张|一份|一台|一部|一辆|一枚|一本|一条|一双|一块|一串|这把|这个|那把|那个)/g, '')
    .replace(/[【\[]\s*(?:完整|基准|原始|破碎|碎裂|损坏|破损|裂开|断裂|旧化|陈旧|老旧|沾血|染血|血迹|烧毁|焦黑|修复|修好|打开|关闭|空的|空置|空瓶|空盒|空状态|装满|改造前|改造后|十年前|10年前|十年后|10年后|遗失|失效)\s*[】\]]/g, '')
    .replace(new RegExp(`（\\s*(?:${stateWords})(?:状态)?\\s*）`, 'g'), '')
    .replace(new RegExp(`\\(\\s*(?:${stateWords})(?:状态)?\\s*\\)`, 'g'), '')
    .replace(new RegExp(`^(?:${stateWords})的?`, 'g'), '')
    .replace(new RegExp(`(?:${stateWords})(?:状态|版|后|前)?$`, 'g'), '')
    .replace(/\s+/g, '')
    .trim();
  return cleaned || rawName.trim();
}

function findMatchingProp(props: any[], propName: string) {
  const normalizedName = normalizePropNameForMatch(propName);
  return props.find((prop) => {
    if (!prop || typeof prop.name !== 'string') return false;
    if (prop.name === propName) return true;
    const normalizedProp = normalizePropNameForMatch(prop.name);
    const normalizedMain = normalizePropNameForMatch(prop.mainPropName);
    return (
      normalizedProp === normalizedName ||
      normalizedMain === normalizedName
    );
  });
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

function inferPropStateLabelFromText(text: string, fallback = ''): string {
  const source = `${text}\n${fallback}`;
  const statePatterns: Array<[RegExp, string]> = [
    [/破碎|碎裂|裂开|碎片|摔碎/, '破碎状态'],
    [/损坏|破损|断裂|断掉|变形|坏了/, '损坏状态'],
    [/沾血|染血|血迹|血污/, '染血状态'],
    [/烧毁|烧焦|焦黑|灰烬/, '烧毁状态'],
    [/旧化|陈旧|老旧|泛黄|磨损|锈迹|褪色/, '旧化状态'],
    [/修复|修好|复原|重新拼合/, '修复状态'],
    [/打开|展开|开启/, '打开状态'],
    [/关闭|合上|收起/, '关闭状态'],
    [/装满|塞满|盛满/, '装满状态'],
    [/空的|空置|空瓶|空盒/, '空状态'],
    [/十年前|10年前|过去/, '10年前状态'],
    [/十年后|10年后|后来/, '10年后状态'],
    [/改造前|改装前/, '改造前'],
    [/改造后|改装后/, '改造后'],
    [/崭新|全新|新买|新/, '全新状态'],
    [/完整|完好|原样|原本|基准/, '完整状态'],
  ];
  for (const [pattern, label] of statePatterns) {
    if (pattern.test(source)) return label;
  }
  return fallback || '完整状态';
}

function cleanPropContextText(text: string, maxLength = 1800): string {
  return text
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

function extractPropContext(content: string, propName: string, aliases: string[] = []): string {
  const names = normalizeStringList([propName, ...aliases]);
  const normalizedNames = names.map(normalizePropNameForMatch).filter(Boolean);
  const lines = content.split(/\r?\n/);
  const matchedIndexes: number[] = [];

  lines.forEach((line, index) => {
    const normalizedLine = normalizePropNameForMatch(line);
    if (names.some(name => line.includes(name)) || normalizedNames.some(name => normalizedLine.includes(name))) {
      matchedIndexes.push(index);
    }
  });

  if (matchedIndexes.length > 0) {
    const segments = Array.from(new Set(matchedIndexes)).slice(0, 12).map((index) => {
      const start = Math.max(0, index - 3);
      const end = Math.min(lines.length, index + 8);
      return lines.slice(start, end).join('\n');
    });
    return cleanPropContextText(segments.join('\n'), 6000);
  }

  return cleanPropContextText(content.slice(0, 2400), 2400);
}

function getCurrentSceneHeading(lines: string[], index: number): string {
  for (let i = index; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (!line) continue;
    if (/^\d+[-—]\d+/.test(line) || /场景[:：]|【场景】|\[内\]|\[外\]|【内】|【外】/.test(line)) {
      return line;
    }
  }
  return '';
}

function inferPropOccurrences(content: string, propName: string, aliases: string[] = []): { episodeNumbers: number[]; occurrences: PropOccurrence[] } {
  const names = normalizeStringList([propName, ...aliases]);
  const normalizedNames = names.map(normalizePropNameForMatch).filter(Boolean);
  const blocks = parseEpisodeBlocks(content);
  const occurrences: PropOccurrence[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const lines = block.text.split(/\n/);
    lines.forEach((line, index) => {
      const normalizedLine = normalizePropNameForMatch(line);
      const hasExact = names.some(name => line.includes(name));
      const hasProp = normalizedNames.some(name => normalizedLine.includes(name));
      if (!hasExact && !hasProp) return;

      const context = lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 4)).join('\n');
      const heading = getCurrentSceneHeading(lines, index) || line.trim() || propName;
      const sceneName = heading.replace(/^\s*\d+[-—]\d+\s*/, '').replace(/[，,。；;].*$/g, '').trim() || heading;
      const stateLabel = inferPropStateLabelFromText(`${propName}\n${context}`, '');
      const key = `${block.number ?? 'unknown'}::${heading}::${stateLabel}`;
      if (seen.has(key)) return;
      seen.add(key);
      occurrences.push({
        episodeNumber: block.number,
        episodeLabel: block.label,
        sceneName,
        heading,
        stateLabel,
      });
    });
  }

  if (occurrences.length === 0) {
    const context = extractPropContext(content, propName, aliases);
    const episodeNumber = extractEpisodeNumberFromText(context);
    occurrences.push({
      episodeNumber,
      episodeLabel: episodeNumber ? `第${episodeNumber}集` : '未标注集数',
      sceneName: '首次出现的场景',
      heading: propName,
      stateLabel: inferPropStateLabelFromText(`${propName}\n${context}`, ''),
    });
  }

  const episodeNumbers = Array.from(new Set(
    occurrences
      .map(item => item.episodeNumber)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  )).sort((a, b) => a - b);

  return {
    episodeNumbers,
    occurrences: occurrences.slice(0, 10),
  };
}

function normalizeStateVariants(
  propName: string,
  matchedProp: any,
  content: string,
  defaultDescription: string,
  inventoryItem?: PropInventoryItem,
): any[] {
  const occurrenceInfo = inferPropOccurrences(content, propName, inventoryItem?.aliases || []);
  const normalizeStateKey = (value: unknown) => String(value || '')
    .replace(/状态/g, '')
    .replace(/[【】\[\]（）()\s·•,，。；;：:、]/g, '')
    .trim();
  const inventoryVariants = (inventoryItem?.states || []).map(state => {
    const occurrences = state.occurrences && state.occurrences.length > 0
      ? state.occurrences
      : (state.episodeNumber || state.sceneName)
        ? [{
            episodeNumber: state.episodeNumber || null,
            episodeLabel: state.episodeLabel || (state.episodeNumber ? `第${state.episodeNumber}集` : '未标注集数'),
            sceneName: state.sceneName || '',
            heading: state.sceneName || '',
            stateLabel: state.stateName,
          }]
        : [];
    return {
      stateName: state.stateName,
      scene: state.sceneName,
      stage: state.episodeLabel,
      description: state.evidence || state.visualChange || defaultDescription,
      visualChange: state.visualChange,
      transitionEvent: state.transitionEvent,
      narrativeFunction: state.narrativeFunction,
      evidence: state.evidence,
      episodeNumbers: normalizeEpisodeNumbers([
        ...(state.episodeNumbers || []),
        state.episodeNumber,
        ...occurrences.map(item => item.episodeNumber),
      ]),
      occurrences,
    };
  });
  const modelVariants: any[] = Array.isArray(matchedProp?.stateVariants) ? matchedProp.stateVariants : [];
  const rawVariants: any[] = [...inventoryVariants, ...modelVariants];
  const variants: any[] = [];
  const seenStates = new Set<string>();
  const addVariant = (rawVariant: any, fallbackIndex: number) => {
    const stateName = String(rawVariant?.stateName || rawVariant?.name || rawVariant?.stage || `状态${fallbackIndex + 1}`).trim();
    const normalizedState = normalizeStateKey(stateName);
    if (!normalizedState) return;
    if (seenStates.has(normalizedState)) {
      const existingVariant = variants.find(item => normalizeStateKey(item.stateName) === normalizedState);
      if (!existingVariant) return;
      const duplicateOccurrences = Array.isArray(rawVariant?.occurrences)
        ? rawVariant.occurrences.filter((item: unknown) => item && typeof item === 'object')
        : [];
      existingVariant.occurrences = mergePropOccurrences([
        ...(existingVariant.occurrences || []),
        ...duplicateOccurrences,
      ] as PropOccurrence[]);
      existingVariant.episodeNumbers = normalizeEpisodeNumbers([
        ...(existingVariant.episodeNumbers || []),
        ...(Array.isArray(rawVariant?.episodeNumbers) ? rawVariant.episodeNumbers : []),
        ...duplicateOccurrences.map((item: any) => item.episodeNumber),
      ]);
      existingVariant.evidence ||= rawVariant?.evidence || '';
      existingVariant.visualChange ||= rawVariant?.visualChange || '';
      existingVariant.transitionEvent ||= rawVariant?.transitionEvent || '';
      existingVariant.narrativeFunction ||= rawVariant?.narrativeFunction || rawVariant?.storyFunction || '';
      existingVariant.description ||= rawVariant?.description || '';
      return;
    }
    seenStates.add(normalizedState);
    const index = variants.length;
    const explicitOccurrences = Array.isArray(rawVariant?.occurrences)
      ? rawVariant.occurrences.filter((item: unknown) => item && typeof item === 'object')
      : [];
    const matchingOccurrences = occurrenceInfo.occurrences.filter(item => (
      normalizeStateKey(item.stateLabel) === normalizedState
    ));
    const occurrences = mergePropOccurrences([
      ...explicitOccurrences,
      ...matchingOccurrences,
    ] as PropOccurrence[]);
    const fallbackOccurrences = rawVariants.length <= 1 && occurrences.length === 0
      ? occurrenceInfo.occurrences
      : occurrences;
    const firstOccurrence = fallbackOccurrences[0];
    const previousId = index > 0 ? `state-${index}` : '';
    variants.push({
      id: rawVariant?.id || `state-${index + 1}`,
      stateName,
      scene: rawVariant?.scene || firstOccurrence?.sceneName || firstOccurrence?.heading || '首次出现的场景',
      stage: rawVariant?.stage || firstOccurrence?.episodeLabel || (index === 0 ? '首次出现' : '后续状态'),
      description: rawVariant?.description || rawVariant?.evidence || defaultDescription,
      visualChange: rawVariant?.visualChange || (index === 0 ? '基准状态' : `在前一状态基础上变为${stateName}`),
      transitionEvent: rawVariant?.transitionEvent || (index === 0 ? '基准状态' : ''),
      narrativeFunction: rawVariant?.narrativeFunction || rawVariant?.storyFunction || '',
      evidence: rawVariant?.evidence || '',
      referenceFromStateId: rawVariant?.referenceFromStateId ?? previousId,
      imageMode: rawVariant?.imageMode || (index === 0 ? 'text-to-image' : 'image-to-image'),
      episodeNumbers: normalizeEpisodeNumbers([
        ...(Array.isArray(rawVariant?.episodeNumbers) ? rawVariant.episodeNumbers : []),
        ...fallbackOccurrences.map(item => item.episodeNumber),
      ]),
      occurrences: fallbackOccurrences,
    });
  };

  rawVariants.forEach((variant, index) => addVariant(variant, index));

  if (variants.length === 0) {
    addVariant({
      stateName: occurrenceInfo.occurrences[0]?.stateLabel || '完整状态',
      scene: occurrenceInfo.occurrences[0]?.sceneName || '首次出现的场景',
      stage: occurrenceInfo.occurrences[0]?.episodeLabel || '首次出现',
      description: defaultDescription,
      visualChange: '基准状态',
      episodeNumbers: occurrenceInfo.episodeNumbers,
      occurrences: occurrenceInfo.occurrences,
    }, 0);
  }

  return variants.map((variant, index) => ({
    ...variant,
    id: `state-${index + 1}`,
    referenceFromStateId: index === 0 ? '' : `state-${index}`,
    imageMode: index === 0 ? 'text-to-image' : 'image-to-image',
  }));
}

function buildPropGroups(props: any[]): any[] {
  const groups: any[] = [];
  const groupMap = new Map<string, any>();

  for (const prop of props || []) {
    const mainPropName = prop?.mainPropName || getMainPropName(prop?.name || '');
    const key = normalizePropNameForIdentity(mainPropName);
    if (!key) continue;
    if (!groupMap.has(key)) {
      const group = {
        mainPropName,
        propCount: 0,
        stateCount: 0,
        episodeNumbers: [] as number[],
        props: [] as any[],
      };
      groupMap.set(key, group);
      groups.push(group);
    }
    const group = groupMap.get(key);
    group.props.push(prop);
    group.propCount = group.props.length;
    group.stateCount += Array.isArray(prop?.stateVariants) && prop.stateVariants.length > 0 ? prop.stateVariants.length : 1;
    const episodeNumbers = Array.isArray(prop?.episodeNumbers) ? prop.episodeNumbers : [];
    group.episodeNumbers = Array.from(new Set([...group.episodeNumbers, ...episodeNumbers])).sort((a, b) => a - b);
  }

  return groups;
}

function countPropStates(props: any[]): number {
  return (props || []).reduce((total, prop) => (
    total + (Array.isArray(prop?.stateVariants) && prop.stateVariants.length > 0 ? prop.stateVariants.length : 1)
  ), 0);
}

function buildBatchPropReference(
  content: string,
  propNames: string[],
  inventoryItems: PropInventoryItem[],
): string {
  return propNames.map((propName, index) => {
    const inventoryItem = findMatchingInventoryItem(inventoryItems, propName);
    const aliases = inventoryItem?.aliases || [];
    const context = extractPropContext(content, propName, aliases);
    return [
      `【物品 ${index + 1}：${propName}】`,
      `全文盘点记录：${JSON.stringify(inventoryItem || createMinimalPropInventoryItem(propName, index))}`,
      `全文相关原文片段：\n${context}`,
    ].join('\n');
  }).join('\n\n');
}

/**
 * 提取一批道具的详细信息
 */
async function extractBatchProps(
  
  content: string,
  propNames: string[],
  startId: number = 0,  // 全局起始 id，确保不同批次的道具 id 不重复
  creationBible?: CreationBible,
  inventoryItems: PropInventoryItem[] = [],
): Promise<{ props: any[]; tokenUsage: any }> {
  const systemPrompt = `你是专业的影视道具设计师。为指定的道具生成详细信息。
${buildCreationBibleInstruction(creationBible)}

**重要规则**：
1. 必须为每个道具生成完整的描述信息，不要遗漏任何字段
2. description 字段必须详细描述道具的外观特点、材质、颜色、尺寸等（至少30字）
3. 如果文本中没有详细描述，请根据道具名称和剧情推断合理的描述
4. function 字段必须描述道具在剧情中的作用或功能
5. visualDescription 必须描述道具的视觉外观特点
6. appearanceScenes 必须列出道具出现的场景
7. 同一道具在剧情中出现“完整/破碎/损坏/沾血/烧毁/被修复/打开/关闭/空/装满”等真实变化时，物理身份仍归入同一个 mainPropName，但每个视觉状态必须在 stateVariants 中独立记录，后续会分别制作一张图
8. stateVariants 按剧本出场顺序排列；第一个状态用 text-to-image 建立身份基准，后续状态用 image-to-image 严格参考前一状态图，只改变剧本明确发生的部分
9. 每个 stateVariants 项必须有自己准确的 episodeNumbers、occurrences、transitionEvent、narrativeFunction 和 evidence；不得把所有状态的集数合并后复制给每个状态
10. 只有变化后的状态持续到另一个独立场次，并在后续场次产生新的线索、冲突、证据、结果或人物行动作用时，才新增状态；同一场戏内的拿起、放下、打开、关闭、使用、摔碎等连续动作交给视频模型，不单列静态状态图
11. “泛黄的退货单”“磨损的旧皮箱”若从首次出现起一直如此，只属于一个基准状态，禁止虚构第二个旧化/损坏状态
12. 每个道具必须填写 mainPropName、episodeNumbers、occurrences；父级集数可用于汇总，状态制作必须以各 stateVariants 自己的关联为准
13. 同一主道具不要拆成多个物理实体；不同状态只写入 stateVariants。比如“完整玉佩”和“破碎玉佩”都属于 mainPropName: "玉佩"
14. “全文盘点记录”来自大模型通读完整剧本后的实体表，必须保留其中的别名、普通物品、出现集数和有证据的状态，不得因为当前原文片段较短而删减
15. 即使物品只是被提及、摆放、穿戴、食用或作为背景陈设，也必须生成详情；importance 可标记为普通道具或背景道具，但不能删除
16. 如果输入中误含人物身体部位、伤势、表情、眼神、情绪、气味或氛围词，例如“眼尾、肩膀、脖颈、旧伤、伤口、血腥味、铁锈味、压迫感”，必须从输出中剔除，不能包装成道具。
17. 可见法术/特效可以作为“特效道具”，但 visualDescription 必须描述可见效果本身，例如能量形态、符文、法阵、烟雾、火焰、闪电、光色和运动轨迹；不得把施法者、受伤者或人体部位画进道具素材。

每个道具包含：
- id: 序号
- name: 道具名称（必须与输入的道具名称完全一致）
- mainPropName: 主道具名称（同一道具状态变化时保持一致）
- type: 人物道具/场景道具/特效道具/服装配饰（必须填写）
- importance: 关键道具/重要道具/普通道具/背景道具（必须填写）
- description: 道具详细描述（必须填写，描述外观、材质、颜色、特点等，30-80字）
- appearanceScenes: 出现场景数组（必须填写，列出道具出现的场景）
- owner: 道具归属人物（如果是人物道具必须填写）
- function: 道具功能/作用（必须填写，描述在剧情中的作用）
- visualDescription: 视觉外观描述（详细描述外观特点）
- stateVariants: 道具状态变化数组（至少1个；如完整、破碎、损坏、旧化等）
  - id: 状态ID（如 state-1）
  - stateName: 状态名称（如：完整状态、破碎状态）
  - scene: 该状态出现的场景
  - stage: 剧情阶段或时间
  - description: 该状态下的外观描述
  - visualChange: 相比上一状态发生的视觉变化
  - transitionEvent: 前一状态如何变成当前状态；首状态写“基准状态”
  - narrativeFunction: 当前状态在所关联的独立场次中产生的不同剧情推动作用
  - episodeNumbers: 只有该状态实际出现的集数
  - occurrences: 只有该状态实际出现的场次
  - evidence: 能证明该状态的简短原文；无证据不得新增状态
  - referenceFromStateId: 后续状态参考的前一状态ID；首个状态为空
  - imageMode: 首个状态为 text-to-image，后续状态为 image-to-image
- episodeNumbers: 该道具出现的集数数组，例如 [1, 3]
- occurrences: 出现场次数组，每项包含 episodeNumber、episodeLabel、sceneName、heading、stateLabel
- notes: 特殊备注（如需要特效、定制等）

输出JSON格式：
{
  "props": [
    {
      "id": 1,
      "name": "道具名称",
      "mainPropName": "主道具名称",
      "type": "人物道具",
      "importance": "关键道具",
      "description": "详细描述道具的外观特点、材质、颜色、尺寸等",
      "appearanceScenes": ["出现场景1", "出现场景2"],
      "owner": "归属人物",
      "function": "道具在剧情中的功能或作用",
      "visualDescription": "视觉外观描述",
      "stateVariants": [
        {
          "id": "state-1",
          "stateName": "完整状态",
          "scene": "首次出现的场景",
          "stage": "前期",
          "description": "完整状态下的外观",
          "visualChange": "基准状态",
          "transitionEvent": "基准状态",
          "narrativeFunction": "作为人物身份线索首次出现",
          "episodeNumbers": [1, 2],
          "occurrences": [{"episodeNumber": 1, "episodeLabel": "第1集", "sceneName": "首次出现的场景", "heading": "1-1 首次出现的场景", "stateLabel": "完整状态"}],
          "evidence": "证明完整状态的简短原文",
          "referenceFromStateId": "",
          "imageMode": "text-to-image"
        },
        {
          "id": "state-2",
          "stateName": "破碎状态",
          "scene": "破碎后出现的场景",
          "stage": "后期",
          "description": "破碎状态下的外观",
          "visualChange": "在state-1基础上出现裂痕、缺口、碎片或污损",
          "transitionEvent": "上一场事故后玉佩断裂，破碎结果延续到第3集",
          "narrativeFunction": "破碎玉佩在后续场次成为揭示真相的新证据",
          "episodeNumbers": [3],
          "occurrences": [{"episodeNumber": 3, "episodeLabel": "第3集", "sceneName": "破碎后出现的场景", "heading": "3-2 破碎后出现的场景", "stateLabel": "破碎状态"}],
          "evidence": "证明道具在第3集破碎的简短原文",
          "referenceFromStateId": "state-1",
          "imageMode": "image-to-image"
        }
      ],
      "episodeNumbers": [1],
      "occurrences": [{"episodeNumber": 1, "episodeLabel": "第1集", "sceneName": "场景名", "heading": "1-1 场景名", "stateLabel": "完整状态"}],
      "notes": "特殊备注"
    }
  ]
}`;

  const propList = propNames.map((p, i) => `${i + 1}. ${p}`).join('\n');
  const batchReference = buildBatchPropReference(content, propNames, inventoryItems);
  
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: `请为以下道具生成详细信息：\n${propList}\n\n以下内容包含通读全文得到的盘点记录，以及从完整剧本中检索出的全部相关片段：\n\n${batchReference}` }
  ];

  let response = '';
  try {
    const stream = oaiStream(messages, {
      temperature: 0.25,
      maxTokens: 20000,
      timeout: 240_000,
      billingLabel: '道具详情提取',
    });

    for await (const chunk of stream) {
      if (chunk.content) response += chunk.content.toString();
    }
  } catch (error: any) {
    console.warn('道具详情模型提取失败，使用默认道具详情:', error?.message || error);
  }

  const result = tryExtractAndFixJSON(response);
  const props: any[] = [];

  if (result && result.props && Array.isArray(result.props) && result.props.length > 0) {
    props.push(...result.props);
    console.log(`JSON 解析成功，提取到 ${props.length} 个道具`);
  } else if (Array.isArray(result) && result.length > 0) {
    props.push(...result);
    console.log(`JSON 解析为数组，提取到 ${props.length} 个道具`);
  } else {
    console.log(`JSON 解析失败或结果为空，将基于 propNames (${propNames.length} 个) 生成默认数据`);
  }

  // 确保所有道具都有完整的字段，生成有意义的默认值
  // 重要：使用 propNames 的顺序来分配 id，确保名称和 id 正确对应
  const completeProps = propNames.map((propName, idx) => {
    // 尝试从 LLM 返回的数据中找到匹配的道具
    const matchedProp = findMatchingProp(props, propName);
    const inventoryItem = findMatchingInventoryItem(inventoryItems, propName);
    const defaultDescription = inventoryItem?.visualSummary || `该道具"${propName}"的外观特点待补充。请根据剧本内容补充道具的材质、颜色、尺寸、特点等信息。`;
    const occurrenceInfo = inferPropOccurrences(content, propName, inventoryItem?.aliases || []);
    const stateVariants = normalizeStateVariants(
      propName,
      matchedProp,
      content,
      matchedProp?.description || defaultDescription,
      inventoryItem,
    );
    const mainPropName = matchedProp?.mainPropName || inventoryItem?.name || getMainPropName(propName);
    const fallbackScenes = (inventoryItem?.appearanceScenes && inventoryItem.appearanceScenes.length > 0)
      ? inventoryItem.appearanceScenes
      : normalizeStringList(occurrenceInfo.occurrences.map(item => item.sceneName), 20);
    const episodeNumbers = normalizeEpisodeNumbers([
      ...(Array.isArray(matchedProp?.episodeNumbers) ? matchedProp.episodeNumbers : []),
      ...(inventoryItem?.episodeNumbers || []),
      ...occurrenceInfo.episodeNumbers,
    ]);
    
    // 使用 propNames 的索引来生成全局唯一的 id
    const globalId = startId + idx + 1;
    
    if (matchedProp) {
      // 判断 description 是否有效：存在、非空、且不是默认的待补充文本
      const hasValidDescription = matchedProp.description && 
        matchedProp.description.trim().length > 0 &&
        !matchedProp.description.includes('待补充') &&
        !matchedProp.description.includes('外观特点待补充');
      
      return {
        id: globalId,
        name: propName,
        mainPropName,
        aliases: inventoryItem?.aliases || [],
        type: matchedProp.type || inventoryItem?.type || '普通道具',
        importance: matchedProp.importance || (inventoryItem?.type === '背景道具' ? '背景道具' : '普通道具'),
        description: hasValidDescription ? matchedProp.description : defaultDescription,
        appearanceScenes: matchedProp.appearanceScenes && matchedProp.appearanceScenes.length > 0 
          ? matchedProp.appearanceScenes 
          : (fallbackScenes.length > 0 ? fallbackScenes : ['待补充出现场景']),
        owner: matchedProp.owner || inventoryItem?.owner || '公共/场景',
        function: matchedProp.function && matchedProp.function.length > 0 
          ? matchedProp.function 
          : (inventoryItem?.functionSummary || '普通陈设或生活使用物品'),
        visualDescription: matchedProp.visualDescription && matchedProp.visualDescription.length > 0 
          ? matchedProp.visualDescription 
          : (inventoryItem?.visualSummary || defaultDescription),
        stateVariants,
        stateLabel: stateVariants[0]?.stateName || occurrenceInfo.occurrences[0]?.stateLabel || '完整状态',
        imageMode: 'text-to-image',
        episodeNumbers,
        occurrences: Array.isArray(matchedProp.occurrences) && matchedProp.occurrences.length > 0
          ? matchedProp.occurrences
          : occurrenceInfo.occurrences,
        notes: matchedProp.notes || '',
      };
    } else {
      // 没有找到匹配的道具，生成默认数据
      return {
        id: globalId,
        name: propName,
        mainPropName,
        aliases: inventoryItem?.aliases || [],
        type: inventoryItem?.type || '普通道具',
        importance: inventoryItem?.type === '背景道具' ? '背景道具' : '普通道具',
        description: defaultDescription,
        appearanceScenes: fallbackScenes.length > 0 ? fallbackScenes : ['待补充出现场景'],
        owner: inventoryItem?.owner || '公共/场景',
        function: inventoryItem?.functionSummary || '普通陈设或生活使用物品',
        visualDescription: inventoryItem?.visualSummary || defaultDescription,
        stateVariants,
        stateLabel: stateVariants[0]?.stateName || occurrenceInfo.occurrences[0]?.stateLabel || '完整状态',
        imageMode: 'text-to-image',
        episodeNumbers,
        occurrences: occurrenceInfo.occurrences,
        notes: '',
      };
    }
  });

  const stateUnits = expandPropStateUnits(completeProps);
  console.log(`extractBatchProps 完成: propNames=${propNames.length}, completeProps=${completeProps.length}, stateUnits=${stateUnits.length}`);

  return {
    props: stateUnits,
    tokenUsage: {
      input: estimateMessagesTokens(messages),
      output: estimateTokens(response),
      timestamp: Date.now(),
    },
  };
}

/**
 * 传统方式提取道具（无道具标记时使用）
 */
async function extractPropsTraditional(
  
  content: string,
  fileName: string,
  creationBible?: CreationBible
): Promise<any> {
  const systemPrompt = `你是一个专业的影视道具设计师。你的任务是：
${buildCreationBibleInstruction(creationBible)}

1. 完整通读给定文本，提取人物和场景地点之外被提到的一切可独立制作成素材图的具体物品，不以重要性作为筛选条件
2. 每个道具需要包含：名称、类型、描述、重要程度、出现场景
3. 识别道具的属性（人物道具/场景道具/特效道具）
4. 分析道具对剧情的作用
5. 同一道具的完整、破碎、损坏、沾血、烧毁、修复等变化归入同一个 mainPropName，但只有变化结果持续到另一个场次并产生新的剧情推动作用时，才在 stateVariants 中独立记录
6. 同一场戏内的拿起、放下、打开、关闭、使用、摔碎等连续动作交给视频模型，不单列静态状态图；变化后的状态若在后续场次作为新线索、冲突、证据或结果出现，才单列
7. 排除人体部位、人物状态、伤势、表情、眼神、情绪、气味和氛围，例如“眼尾、肩膀、脖颈、旧伤、伤口、血腥味、铁锈味、压迫感”不是道具
8. 剧本里可见的法术、法阵、符文、能量、烟雾、火焰、闪电等可作为“特效道具”；只是不可见的味道或气氛不得作为道具
9. stateVariants 第一个状态用于文生图建立基准图，后续状态应基于前一状态图生图延展；禁止把两个状态画在一张对照图里
10. 固有外观不是状态变化：“泛黄的退货单”若首次出现时已泛黄，且后续未发生变化，就只保留一个“泛黄状态”，不得额外虚构损坏状态
11. 每个状态必须输出 episodeNumbers、occurrences、transitionEvent、narrativeFunction、evidence；无独立场次、不同剧情作用和原文证据，不得增加该状态
12. 家具家电、服装鞋帽、食物饮料、文件票据、电子设备、工具、容器、交通工具、背景陈设和普通生活小物件都必须提取
13. 同类但归属不同人物的物品分别记录；同一物品的别名和状态必须合并

请以 JSON 格式返回结果，格式如下：
{
  "totalProps": 道具总数,
  "props": [
    {
      "id": 1,
      "name": "道具名称",
      "type": "人物道具/场景道具/特效道具/服装配饰",
      "importance": "关键道具/重要道具/普通道具/背景道具",
      "description": "道具详细描述",
      "appearanceScenes": ["出现场景1", "出现场景2"],
      "owner": "道具归属人物（如果是人物道具）",
      "function": "道具功能/作用",
      "visualDescription": "视觉外观描述",
      "stateVariants": [
        {
          "id": "state-1",
          "stateName": "完整状态",
          "scene": "出现场景",
          "stage": "前期",
          "description": "完整状态外观",
          "visualChange": "基准状态",
          "transitionEvent": "基准状态",
          "narrativeFunction": "该状态在对应场次中的剧情作用",
          "episodeNumbers": [1],
          "occurrences": [{"episodeNumber": 1, "episodeLabel": "第1集", "sceneName": "出现场景", "heading": "1-1 出现场景", "stateLabel": "完整状态"}],
          "evidence": "证明该状态的简短原文",
          "referenceFromStateId": "",
          "imageMode": "text-to-image"
        }
      ],
      "notes": "特殊备注（如：需要特效、需要定制等）"
    }
  ],
  "propCategories": {
    "characterProps": ["人物道具列表"],
    "sceneProps": ["场景道具列表"],
    "fxProps": ["特效道具列表"],
    "costumes": ["服装配饰列表"]
  },
  "keyProps": ["推动剧情的关键道具"],
  "customProps": ["需要特别定制的道具"]
}

**重要提示**：
1. 必须返回完整且有效的 JSON 格式
2. 字符串中的引号需要转义为 \\"
3. 不要在 JSON 中添加注释
4. 确保所有数组和对象都正确闭合`;

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: `请分析以下文本并提取所有道具：\n\n文件名：${fileName}\n\n内容：\n${content}` }
  ];

  const inputTokens = estimateMessagesTokens(messages);

  let fullResponse = '';
  try {
    const stream = oaiStream(messages, {
      temperature: 0.2,
      maxTokens: 32768,
      timeout: 300_000,
      billingLabel: '道具全文兜底提取',
    });

    for await (const chunk of stream) {
      if (chunk.content) {
        fullResponse += chunk.content.toString();
      }
    }
  } catch (error: any) {
    console.warn('传统道具模型提取失败，使用本地兜底:', error?.message || error);
    const localProps = extractTaggedNames(content, '道具');
    const fallback = await extractBatchProps(content, localProps, 0, creationBible);
    const propGroups = buildPropGroups(fallback.props);
    return {
      totalProps: fallback.props.length,
      totalMainProps: propGroups.length,
      totalPropStates: countPropStates(fallback.props),
      props: fallback.props,
      propGroups,
      tokenUsage: fallback.tokenUsage,
    };
  }

  const outputTokens = estimateTokens(fullResponse);
  
  console.log(`LLM 响应长度: ${fullResponse.length} 字符`);

  const result = tryExtractAndFixJSON(fullResponse);
  
  if (result) {
    if (result.props && Array.isArray(result.props)) {
      const normalizedProps = result.props
        .filter((prop: any) => !isInvalidPropCandidateName(prop?.name || prop?.propName || prop?.mainPropName))
        .map((prop: any, index: number) => {
        const propName = prop?.name || prop?.propName || `道具${index + 1}`;
        const defaultDescription = prop?.description || `该道具"${propName}"的外观特点待补充。`;
        const occurrenceInfo = inferPropOccurrences(content, propName);
        const stateVariants = normalizeStateVariants(propName, prop, content, defaultDescription);
        return {
          ...prop,
          id: index + 1,
          name: propName,
          mainPropName: prop?.mainPropName || getMainPropName(propName),
          stateVariants,
          stateLabel: prop?.stateLabel || stateVariants[0]?.stateName || occurrenceInfo.occurrences[0]?.stateLabel || '完整状态',
          imageMode: prop?.imageMode || 'text-to-image',
          episodeNumbers: Array.isArray(prop?.episodeNumbers) && prop.episodeNumbers.length > 0 ? prop.episodeNumbers : occurrenceInfo.episodeNumbers,
          occurrences: Array.isArray(prop?.occurrences) && prop.occurrences.length > 0 ? prop.occurrences : occurrenceInfo.occurrences,
        };
      });
      result.props = expandPropStateUnits(normalizedProps);
      result.totalProps = result.props.length;
      result.totalMainProps = buildPropGroups(result.props).length;
      result.totalPropStates = countPropStates(result.props);
      result.propGroups = buildPropGroups(result.props);
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
      totalProps: 0,
      props: [],
      tokenUsage: {
        input: inputTokens,
        output: outputTokens,
        timestamp: Date.now(),
      },
    };
  }
}
