export type CharacterLookChangeType =
  | '基础造型'
  | '服装造型'
  | '年龄时期'
  | '身体状态'
  | '特殊形态'
  | '复合变化';

type CharacterLookRecord = Record<string, unknown>;

interface NormalizedCharacterLook extends CharacterLookRecord {
  id: string;
  scene: string;
  stage: string;
  description: string;
  costume: string;
  hairstyle: string;
  accessories: string[];
  makeup: string;
  mood: string;
  continuityNote: string;
  changeType: CharacterLookChangeType;
  ageStage: string;
  physicalState: string;
  transformationState: string;
  episodeNumbers: number[];
  sceneNames: string[];
  sourceEvidence: string;
  referenceLookId: string;
  referenceReason: string;
  isBaseLook: boolean;
  generationPriority: number;
}

type IndexedCharacterLook = NormalizedCharacterLook & {
  _sourceIndex: number;
  _wasExplicitBase: boolean;
};

const AGE_STAGE_PATTERN = /(婴儿|幼年|童年|儿童|少年|少女|青少年|青年|年轻|中年|壮年|老年|暮年|十年前|十五年前|二十年前|多年后|十年后|十五年后|二十年后)/;
const PHYSICAL_STATE_PATTERN = /(受伤|负伤|重伤|轻伤|流血|包扎|骨折|瘸|怀孕|孕期|临产|产后|生病|病弱|虚弱|昏迷|中毒|醉酒|淋雨|湿透|烧伤|毁容|失明|残疾|康复|疲惫|憔悴)/;
const TRANSFORMATION_PATTERN = /(变身|觉醒|入魔|魔化|妖化|兽化|异化|黑化形态|灵体|魂体|法相|真身|机甲|战甲形态|完全体|进化形态|神化|仙化)/;

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(cleanText).filter(Boolean)));
  }
  const text = cleanText(value);
  return text ? Array.from(new Set(text.split(/[、,，；;|/]+/).map(item => item.trim()).filter(Boolean))) : [];
}

function cleanEpisodeNumbers(value: unknown): number[] {
  const source = Array.isArray(value) ? value : cleanText(value) ? [value] : [];
  const numbers = source.flatMap(item => {
    if (typeof item === 'number' && Number.isFinite(item)) return [Math.max(1, Math.round(item))];
    const matches = String(item || '').match(/\d+/g) || [];
    return matches.map(match => Number.parseInt(match, 10)).filter(number => Number.isFinite(number) && number > 0);
  });
  return Array.from(new Set(numbers)).sort((a, b) => a - b);
}

function inferAgeStage(text: string, fallbackAge: string): string {
  const explicit = text.match(AGE_STAGE_PATTERN)?.[1] || cleanText(fallbackAge).match(AGE_STAGE_PATTERN)?.[1];
  if (explicit) return explicit;
  const numericAge = Number.parseInt(cleanText(fallbackAge).match(/\d+/)?.[0] || '', 10);
  if (Number.isFinite(numericAge)) {
    if (numericAge <= 12) return '童年';
    if (numericAge <= 17) return '少年';
    if (numericAge <= 35) return '青年';
    if (numericAge <= 59) return '中年';
    return '老年';
  }
  return cleanText(fallbackAge) || '主要时期';
}

function inferPhysicalState(text: string): string {
  return text.match(PHYSICAL_STATE_PATTERN)?.[1] || '正常状态';
}

function inferTransformationState(text: string): string {
  return text.match(TRANSFORMATION_PATTERN)?.[1] || '';
}

export function normalizeCharacterLookChangeType(value: unknown, context = ''): CharacterLookChangeType {
  const explicit = cleanText(value);
  if (explicit.includes('基础')) return '基础造型';
  if (explicit.includes('年龄') || explicit.includes('时期')) return '年龄时期';
  if (explicit.includes('身体') || explicit.includes('状态') || explicit.includes('受伤') || explicit.includes('怀孕')) return '身体状态';
  if (explicit.includes('变身') || explicit.includes('特殊') || explicit.includes('形态')) return '特殊形态';
  if (explicit.includes('复合')) return '复合变化';
  if (explicit.includes('服装') || explicit.includes('换装')) return '服装造型';

  const hasAge = AGE_STAGE_PATTERN.test(context);
  const hasPhysicalState = PHYSICAL_STATE_PATTERN.test(context);
  const hasTransformation = TRANSFORMATION_PATTERN.test(context);
  const changeCount = [hasAge, hasPhysicalState, hasTransformation].filter(Boolean).length;
  if (changeCount > 1) return '复合变化';
  if (hasTransformation) return '特殊形态';
  if (hasPhysicalState) return '身体状态';
  if (hasAge) return '年龄时期';
  if (/默认|基础|初始|初见|主要造型|常态/.test(context)) return '基础造型';
  return '服装造型';
}

function getGenerationPriority(type: CharacterLookChangeType): number {
  if (type === '基础造型') return 1;
  if (type === '年龄时期') return 2;
  if (type === '服装造型') return 3;
  if (type === '身体状态') return 4;
  return 5;
}

function getAgeStageRank(stage: unknown): number | undefined {
  const text = cleanText(stage);
  if (/婴儿|幼年|童年|儿童/.test(text)) return 0;
  if (/少年|少女|青少年/.test(text)) return 1;
  if (/青年|年轻/.test(text)) return 2;
  if (/中年|壮年/.test(text)) return 3;
  if (/老年|暮年/.test(text)) return 4;
  return undefined;
}

export function normalizeCharacterLooks(
  rawLooks: unknown,
  fallbackLook: object,
  fallbackAge = ''
): NormalizedCharacterLook[] {
  const fallback = fallbackLook as CharacterLookRecord;
  const source: unknown[] = Array.isArray(rawLooks) && rawLooks.length > 0 ? rawLooks : [fallbackLook];
  const normalized: IndexedCharacterLook[] = source.map((rawLook, index) => {
    const look = rawLook && typeof rawLook === 'object' ? rawLook as CharacterLookRecord : {};
    const context = [
      look.scene,
      look.stage,
      look.description,
      look.costume,
      look.ageStage,
      look.physicalState,
      look.transformationState,
    ].map(cleanText).filter(Boolean).join(' ');
    const changeType = normalizeCharacterLookChangeType(look.changeType || look.lookType, context);
    const ageStage = cleanText(look.ageStage || look.period) || inferAgeStage(context, fallbackAge);
    const physicalState = cleanText(look.physicalState || look.bodyState) || inferPhysicalState(context);
    const transformationState = cleanText(look.transformationState || look.formState) || inferTransformationState(context);

    return {
      ...fallback,
      ...look,
      id: cleanText(look.id) || `look-${index + 1}`,
      scene: cleanText(look.scene) || cleanText(fallback.scene) || '默认造型',
      stage: cleanText(look.stage),
      description: cleanText(look.description) || cleanText(fallback.description),
      costume: cleanText(look.costume) || cleanText(fallback.costume),
      hairstyle: cleanText(look.hairstyle) || cleanText(fallback.hairstyle),
      accessories: cleanStringArray(look.accessories),
      makeup: cleanText(look.makeup) || cleanText(fallback.makeup),
      mood: cleanText(look.mood) || cleanText(fallback.mood) || '自然',
      continuityNote: cleanText(look.continuityNote),
      changeType,
      ageStage,
      physicalState,
      transformationState,
      episodeNumbers: cleanEpisodeNumbers(look.episodeNumbers || look.episodes),
      sceneNames: cleanStringArray(look.sceneNames || look.relatedScenes || look.scene),
      sourceEvidence: cleanText(look.sourceEvidence || look.evidence),
      referenceLookId: cleanText(look.referenceLookId),
      referenceReason: cleanText(look.referenceReason),
      isBaseLook: Boolean(look.isBaseLook),
      // 优先级由变化类型统一计算，避免模型返回的数字与实际依赖顺序冲突。
      generationPriority: getGenerationPriority(changeType),
      _sourceIndex: index,
      _wasExplicitBase: Boolean(look.isBaseLook) || changeType === '基础造型',
    } as IndexedCharacterLook;
  });

  const fallbackAgeStage = inferAgeStage('', fallbackAge);
  const fallbackAgeRank = getAgeStageRank(fallbackAgeStage);
  const isFallbackAge = (look: IndexedCharacterLook) => {
    const rank = getAgeStageRank(look.ageStage);
    return rank !== undefined && fallbackAgeRank !== undefined
      ? rank === fallbackAgeRank
      : cleanText(look.ageStage) === cleanText(fallbackAgeStage);
  };
  const explicitBaseCandidates = normalized.filter(look => look._wasExplicitBase);
  let baseLook = explicitBaseCandidates.find(look => (
    isFallbackAge(look) && look.physicalState === '正常状态' && !look.transformationState
  )) || explicitBaseCandidates.find(look => (
    look.physicalState === '正常状态' && !look.transformationState
  ));
  const matchingAgeBase = normalized.find(look => (
    isFallbackAge(look) && look.physicalState === '正常状态' && !look.transformationState && look.changeType !== '特殊形态'
  ));
  const anyNormalBase = normalized.find(look => (
    look.physicalState === '正常状态' && !look.transformationState && look.changeType !== '特殊形态'
  ));
  const hasAgeVariation = normalized.some(look => look.changeType === '年龄时期' || look.changeType === '复合变化');
  baseLook = baseLook || matchingAgeBase || (!hasAgeVariation ? anyNormalBase : undefined);

  if (!baseLook) {
    const normalizedFallback = normalizeCharacterLooks([{
      ...fallbackLook,
      id: 'look-base',
      isBaseLook: true,
      changeType: '基础造型',
      physicalState: '正常状态',
      transformationState: '',
    }], fallbackLook, fallbackAge)[0];
    const indexedFallback = {
      ...normalizedFallback,
      _sourceIndex: -1,
      _wasExplicitBase: true,
    } as IndexedCharacterLook;
    normalized.unshift(indexedFallback);
    baseLook = indexedFallback;
  }

  normalized.forEach(look => {
    const isBase = look === baseLook;
    look.isBaseLook = isBase;
    if (isBase) {
      look.changeType = '基础造型';
    } else if (look.changeType === '基础造型') {
      const lookAgeRank = getAgeStageRank(look.ageStage);
      const baseAgeRank = getAgeStageRank(baseLook?.ageStage);
      const differsFromBaseAge = lookAgeRank !== undefined && baseAgeRank !== undefined
        ? lookAgeRank !== baseAgeRank
        : cleanText(look.ageStage) !== cleanText(baseLook?.ageStage);
      look.changeType = look.transformationState
        ? '特殊形态'
        : look.physicalState && look.physicalState !== '正常状态'
          ? '身体状态'
          : differsFromBaseAge
            ? '年龄时期'
            : '服装造型';
    }
    look.generationPriority = getGenerationPriority(look.changeType);
  });

  const chooseLongerText = (left: unknown, right: unknown) => {
    const leftText = cleanText(left);
    const rightText = cleanText(right);
    return rightText.length > leftText.length ? rightText : leftText;
  };
  const duplicateIdAliases = new Map<string, string>();
  const deduplicatedBySignature = new Map<string, IndexedCharacterLook>();
  const dedupeOrder = [...normalized].sort((left, right) => {
    if (left === baseLook) return -1;
    if (right === baseLook) return 1;
    if (left._wasExplicitBase !== right._wasExplicitBase) return left._wasExplicitBase ? 1 : -1;
    return left._sourceIndex - right._sourceIndex;
  });
  dedupeOrder.forEach(look => {
    const ageRank = getAgeStageRank(look.ageStage);
    const signature = [
      ageRank === undefined ? look.ageStage : `age-${ageRank}`,
      look.physicalState,
      look.transformationState,
      look.costume,
      look.hairstyle,
    ].map(value => cleanText(value).replace(/\s+/g, '')).join('|');
    const existing = deduplicatedBySignature.get(signature);
    if (!existing) {
      deduplicatedBySignature.set(signature, look);
      duplicateIdAliases.set(look.id, look.id);
      return;
    }
    duplicateIdAliases.set(look.id, existing.id);
    existing.episodeNumbers = cleanEpisodeNumbers([...existing.episodeNumbers, ...look.episodeNumbers]);
    existing.sceneNames = cleanStringArray([...existing.sceneNames, ...look.sceneNames]);
    existing.accessories = cleanStringArray([...existing.accessories, ...look.accessories]);
    existing.description = chooseLongerText(existing.description, look.description);
    existing.sourceEvidence = cleanStringArray([existing.sourceEvidence, look.sourceEvidence]).join('；');
    existing.continuityNote = chooseLongerText(existing.continuityNote, look.continuityNote);
    existing.bodyChanges = chooseLongerText(existing.bodyChanges, look.bodyChanges);
    existing.imageUrl = existing.imageUrl || look.imageUrl;
    existing.fourViewImageUrl = existing.fourViewImageUrl || look.fourViewImageUrl;
    existing.alternateImageUrls = cleanStringArray([
      ...(Array.isArray(existing.alternateImageUrls) ? existing.alternateImageUrls : []),
      existing.imageUrl,
      ...(Array.isArray(look.alternateImageUrls) ? look.alternateImageUrls : []),
      look.imageUrl,
    ]).filter(url => url !== existing.imageUrl).slice(0, 2);
  });
  const deduplicated = Array.from(deduplicatedBySignature.values());
  deduplicated.forEach(look => {
    const resolvedReferenceId = duplicateIdAliases.get(look.referenceLookId) || look.referenceLookId;
    look.referenceLookId = resolvedReferenceId === look.id ? '' : resolvedReferenceId;
  });

  const ensuredBase = deduplicated.find(look => look.isBaseLook) || deduplicated[0];

  const sorted: IndexedCharacterLook[] = deduplicated
    .map((look, index) => ({ ...look, _sourceIndex: look._sourceIndex ?? index }))
    .sort((a, b) => {
      if (a.id === ensuredBase.id) return -1;
      if (b.id === ensuredBase.id) return 1;
      return (a.generationPriority - b.generationPriority) || (a._sourceIndex - b._sourceIndex);
    });

  const usedIds = new Set<string>();
  sorted.forEach((look, index) => {
    let nextId = cleanText(look.id) || `look-${index + 1}`;
    while (usedIds.has(nextId)) nextId = `${nextId}-${index + 1}`;
    look.id = nextId;
    usedIds.add(nextId);
  });

  const finalBase = sorted.find(look => look.isBaseLook) || sorted[0];
  sorted.forEach((look, index) => {
    if (look.id === finalBase.id) {
      look.referenceLookId = '';
      look.referenceReason = look.referenceReason || '直接参考已确认的人物正脸身份基准图';
      return;
    }

    const previousLooks = sorted.slice(0, index);
    const targetAgeRank = getAgeStageRank(look.ageStage);
    const nearestAgeBase = [...previousLooks]
      .filter(candidate => candidate.physicalState === '正常状态' && !candidate.transformationState)
      .sort((a, b) => {
        const rankA = getAgeStageRank(a.ageStage);
        const rankB = getAgeStageRank(b.ageStage);
        const distanceA = targetAgeRank === undefined || rankA === undefined ? Number.MAX_SAFE_INTEGER : Math.abs(targetAgeRank - rankA);
        const distanceB = targetAgeRank === undefined || rankB === undefined ? Number.MAX_SAFE_INTEGER : Math.abs(targetAgeRank - rankB);
        return distanceA - distanceB;
      })[0];
    const sameAgeNormal = [...previousLooks].reverse().find(candidate => (
      candidate.ageStage === look.ageStage &&
      candidate.physicalState === '正常状态' &&
      !candidate.transformationState
    ));
    const sameAgeAny = [...previousLooks].reverse().find(candidate => candidate.ageStage === look.ageStage && !candidate.transformationState);
    const explicitReference = previousLooks.find(candidate => candidate.id === look.referenceLookId);
    if (explicitReference) {
      const explicitAgeRank = getAgeStageRank(explicitReference.ageStage);
      const nearestAgeRank = getAgeStageRank(nearestAgeBase?.ageStage);
      const explicitAgeDistance = targetAgeRank === undefined || explicitAgeRank === undefined
        ? Number.MAX_SAFE_INTEGER
        : Math.abs(targetAgeRank - explicitAgeRank);
      const nearestAgeDistance = targetAgeRank === undefined || nearestAgeRank === undefined
        ? Number.MAX_SAFE_INTEGER
        : Math.abs(targetAgeRank - nearestAgeRank);
      const sameOrUnknownAge = !look.ageStage || !explicitReference.ageStage || explicitReference.ageStage === look.ageStage;
      const explicitReferenceIsCompatible = look.changeType === '年龄时期'
        ? (
            explicitReference.physicalState === '正常状态' &&
            !explicitReference.transformationState &&
            explicitAgeDistance <= nearestAgeDistance
          )
        : sameOrUnknownAge;

      if (explicitReferenceIsCompatible) return;
    }

    const reference = look.changeType === '年龄时期'
      ? (nearestAgeBase || finalBase)
      : (sameAgeNormal || sameAgeAny || nearestAgeBase || finalBase);
    look.referenceLookId = reference.id;
    look.referenceReason = look.referenceReason || (
      look.changeType === '年龄时期'
        ? `从最接近的已确认时期造型「${reference.scene}」推进年龄变化`
        : `沿用「${reference.scene}」的身份、时期和连续性，仅表现当前剧情变化`
    );
  });

  return sorted.map(look => {
    const cleanLook = { ...look };
    Reflect.deleteProperty(cleanLook, '_sourceIndex');
    Reflect.deleteProperty(cleanLook, '_wasExplicitBase');
    return cleanLook;
  });
}
