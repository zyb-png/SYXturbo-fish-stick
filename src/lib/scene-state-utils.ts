type UnknownRecord = Record<string, any>;

export type SceneStateReason =
  | 'baseline'
  | 'day-night-change'
  | 'era-change'
  | 'structural-change'
  | 'space-change';

type DayPart = 'day' | 'night' | 'dawn' | 'dusk' | 'unspecified';
type SpaceType = 'interior' | 'exterior' | 'virtual' | 'unspecified';

type NormalizedOccurrence = {
  episodeNumber: number | null;
  episodeLabel: string;
  heading: string;
  stateLabel: string;
};

type SceneStateSignature = {
  dayPart: DayPart;
  spaceType: SpaceType;
  era: string;
  structuralState: string;
};

type SceneStateBucket = {
  scene: UnknownRecord;
  signature: SceneStateSignature;
  sourceIndex: number;
  sourceNames: string[];
};

export type SceneStateNormalizationResult = {
  scenes: UnknownRecord[];
  aliases: Record<string, string>;
  mergedCount: number;
};

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function uniqueStrings(...values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  values.flatMap(value => Array.isArray(value) ? value : []).forEach(value => {
    const text = cleanText(value);
    const identity = text.replace(/[\s，,。；;：:、]/g, '');
    if (!text || !identity || seen.has(identity)) return;
    seen.add(identity);
    result.push(text);
  });
  return result;
}

function cleanEpisodeNumbers(...values: unknown[]): number[] {
  const numbers = values.flatMap(value => Array.isArray(value) ? value : [value]).flatMap(value => {
    if (typeof value === 'number' && Number.isFinite(value)) return [Math.max(1, Math.round(value))];
    return (cleanText(value).match(/\d+/g) || [])
      .map(item => Number.parseInt(item, 10))
      .filter(item => Number.isFinite(item) && item > 0);
  });
  return Array.from(new Set(numbers)).sort((a, b) => a - b);
}

function normalizeOccurrence(value: unknown): NormalizedOccurrence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as UnknownRecord;
  const episodeNumber = cleanEpisodeNumbers(source.episodeNumber, source.episodeLabel)[0] || null;
  const episodeLabel = cleanText(source.episodeLabel) || (episodeNumber ? `第${episodeNumber}集` : '未标注集数');
  const heading = cleanText(source.heading || source.sceneName || source.scene);
  const stateLabel = cleanText(source.stateLabel || source.stateName);
  if (!episodeNumber && !heading && !stateLabel) return null;
  return { episodeNumber, episodeLabel, heading, stateLabel };
}

function deduplicateOccurrences(...values: unknown[]): NormalizedOccurrence[] {
  const seen = new Set<string>();
  return values
    .flatMap(value => Array.isArray(value) ? value : [])
    .map(normalizeOccurrence)
    .filter((item): item is NormalizedOccurrence => Boolean(item))
    .filter(item => {
      const key = [
        item.episodeNumber || item.episodeLabel,
        item.heading.replace(/\s+/g, ''),
      ].join('::');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function stripSceneStateTokens(value: unknown): string {
  let text = cleanText(value)
    .replace(/^第\s*[一二两三四五六七八九十百千万\d]+\s*[集章]\s*/g, '')
    .replace(/^\d+\s*[-—]\s*\d+\s*/g, '')
    .replace(/[【\[]\s*(?:内|外|日|夜|白天|黑夜|晨|清晨|早|晚|黄昏|傍晚|雨夜|上午|下午)\s*[】\]]/g, '')
    .replace(/[（(]\s*(?:内|外|日|夜|白天|黑夜|晨|清晨|早|晚|黄昏|傍晚|雨夜|上午|下午|\d+年前|\d+年后|十年前|十年后|改造前|改造后|装修前|装修后|破败|焕新|废弃|拆除后|默认状态|基准状态)\s*[）)]/g, '')
    .replace(/\s+(?:内|外|日|夜|白天|黑夜|晨|清晨|早|晚|黄昏|傍晚|雨夜|上午|下午|默认状态|基准状态)\s*$/g, '')
    .replace(/[：:]\s*$/g, '')
    .replace(/\s+/g, '')
    .trim();

  if (text.length > 2 && text.endsWith('中') && !text.endsWith('中心')) {
    text = text.slice(0, -1);
  }
  if (text.length > 2 && /(?:之内|里面|内部)$/.test(text)) {
    text = text.replace(/(?:之内|里面|内部)$/g, '');
  }
  return text;
}

export function normalizeSceneLocationIdentity(value: unknown): string {
  return stripSceneStateTokens(value)
    .toLocaleLowerCase()
    .replace(/[\s_<>:"/\\|?*·•，,。；;：:、'“”‘’]/g, '');
}

export function getSceneMainLocation(scene: unknown): string {
  if (!scene || typeof scene !== 'object' || Array.isArray(scene)) return '';
  const source = scene as UnknownRecord;
  return stripSceneStateTokens(
    source.mainSceneName || source.physicalLocation || source.location || source.name
  ) || cleanText(source.name);
}

function inferDayPartFromText(value: unknown): DayPart {
  const source = cleanText(value);
  if (/雨夜|深夜|午夜|夜晚|黑夜|夜间|晚上|【夜】|\[夜\]/.test(source)) return 'night';
  if (/黄昏|傍晚|日落/.test(source)) return 'dusk';
  if (/清晨|黎明|拂晓|晨间/.test(source)) return 'dawn';
  if (/白天|日间|上午|下午|中午|【日】|\[日\]/.test(source)) return 'day';
  return 'unspecified';
}

function inferDayPart(scene: UnknownRecord): DayPart {
  const preferredDayPart = inferDayPartFromText(
    [scene.stateLabel, scene.timeOfDay, scene.name].map(cleanText).join(' ')
  );
  const occurrenceDayParts = (Array.isArray(scene.occurrences) ? scene.occurrences : [])
    .map((item: UnknownRecord) => inferDayPartFromText(`${cleanText(item?.heading)} ${cleanText(item?.stateLabel)}`))
    .filter(dayPart => dayPart !== 'unspecified');

  if (occurrenceDayParts.length > 0) {
    if (preferredDayPart !== 'unspecified' && occurrenceDayParts.includes(preferredDayPart)) {
      return preferredDayPart;
    }
    const counts = occurrenceDayParts.reduce((result, dayPart) => {
      result.set(dayPart, (result.get(dayPart) || 0) + 1);
      return result;
    }, new Map<DayPart, number>());
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || preferredDayPart;
  }
  return preferredDayPart;
}

function inferSpaceType(scene: UnknownRecord): SpaceType {
  const source = [scene.type, scene.name, scene.physicalLocation].map(cleanText).join(' ');
  if (/虚拟|梦境|意识空间/.test(source)) return 'virtual';
  if (/室外|外景|【外】|\[外\]/.test(source)) return 'exterior';
  if (/室内|内景|【内】|\[内\]/.test(source)) return 'interior';
  return 'unspecified';
}

function inferEra(scene: UnknownRecord): string {
  const source = [scene.stateLabel, scene.name, scene.stateChangeEvidence, scene.stateVisualDifference]
    .map(cleanText)
    .join(' ');
  const relativeMatch = source.match(/(?:距今)?(?:\d+|[一二两三四五六七八九十百]+)\s*年\s*(?:前|后)/);
  if (relativeMatch) return relativeMatch[0].replace(/\s+/g, '');
  const explicitMatch = source.match(/(?:回忆时期|过去时期|未来时期|战前|战后)/);
  return explicitMatch?.[0] || '';
}

function inferStructuralState(scene: UnknownRecord): string {
  const source = [
    scene.stateLabel,
    scene.name,
    scene.stateChangeEvidence,
    scene.stateVisualDifference,
    scene.stateReason,
  ].map(cleanText).join(' ');

  const patterns: Array<[RegExp, string]> = [
    [/(?:改造前|装修前|翻修前|重建前|修缮前)/, '改造前'],
    [/(?:改造后|装修后|翻修后|重建后|修缮后|重新装修|焕新)/, '改造后'],
    [/(?:拆除|拆迁|被拆|夷为平地)/, '拆除后'],
    [/(?:坍塌|倒塌|成为废墟|废墟状态)/, '坍塌后'],
    [/(?:烧毁|焚毁|火灾后)/, '烧毁后'],
    [/(?:炸毁|爆炸后)/, '爆炸后'],
    [/(?:水淹|淹没|洪水后)/, '水淹后'],
    [/(?:废弃|荒废|破败|破旧)/, '破败状态'],
    [/(?:修复完成|恢复原貌)/, '修复后'],
  ];

  for (const [pattern, label] of patterns) {
    if (pattern.test(source)) return label;
  }
  return '';
}

function getSceneStateSignature(scene: UnknownRecord): SceneStateSignature {
  return {
    dayPart: inferDayPart(scene),
    spaceType: inferSpaceType(scene),
    era: inferEra(scene),
    structuralState: inferStructuralState(scene),
  };
}

function getSignatureKey(signature: SceneStateSignature): string {
  return [signature.spaceType, signature.dayPart, signature.era || 'same-era', signature.structuralState || 'same-structure'].join('::');
}

function getFirstEpisode(scene: UnknownRecord): number {
  const occurrences = deduplicateOccurrences(scene.occurrences);
  return cleanEpisodeNumbers(scene.episodeNumbers, occurrences.map(item => item.episodeNumber))[0] || Number.MAX_SAFE_INTEGER;
}

function preferImportance(first: unknown, second: unknown): string {
  const ranking = new Map([
    ['主要场景', 3],
    ['次要场景', 2],
    ['过渡场景', 1],
  ]);
  const firstText = cleanText(first);
  const secondText = cleanText(second);
  return (ranking.get(secondText) || 0) > (ranking.get(firstText) || 0) ? secondText : firstText || secondText;
}

function preferDescription(first: unknown, second: unknown): string {
  const firstText = cleanText(first);
  const secondText = cleanText(second);
  const score = (text: string) => {
    if (!text) return 0;
    const visualTerms = (text.match(/空间|布局|墙|地面|建筑|装饰|材质|光线|色调|陈设|窗|门|灯/g) || []).length;
    const scriptPenalty = /第\d+集|出场人物|台词|对白/.test(text) ? 100 : 0;
    return Math.min(text.length, 180) + visualTerms * 12 - scriptPenalty;
  };
  return score(secondText) > score(firstText) ? secondText : firstText || secondText;
}

function mergeSceneRecords(target: UnknownRecord, source: UnknownRecord): UnknownRecord {
  const occurrences = deduplicateOccurrences(target.occurrences, source.occurrences);
  return {
    ...target,
    description: preferDescription(target.description, source.description),
    importance: preferImportance(target.importance, source.importance),
    keyEvents: uniqueStrings(target.keyEvents, source.keyEvents),
    visualElements: uniqueStrings(target.visualElements, source.visualElements),
    episodeNumbers: cleanEpisodeNumbers(
      target.episodeNumbers,
      source.episodeNumbers,
      occurrences.map(item => item.episodeNumber)
    ),
    occurrences,
    stateChangeEvidence: cleanText(target.stateChangeEvidence) || cleanText(source.stateChangeEvidence),
    stateVisualDifference: cleanText(target.stateVisualDifference) || cleanText(source.stateVisualDifference),
  };
}

function reasonFromSignatures(current: SceneStateSignature, baseline: SceneStateSignature): SceneStateReason {
  if (current.structuralState !== baseline.structuralState) return 'structural-change';
  if (current.era !== baseline.era) return 'era-change';
  if (current.dayPart !== baseline.dayPart) return 'day-night-change';
  if (current.spaceType !== baseline.spaceType) return 'space-change';
  return 'baseline';
}

export function getSceneStateReasonLabel(reason: unknown): string {
  const labels: Record<SceneStateReason, string> = {
    baseline: '基准状态',
    'day-night-change': '日夜切换',
    'era-change': '年代变化',
    'structural-change': '场景重大变化',
    'space-change': '内外景切换',
  };
  return labels[cleanText(reason) as SceneStateReason] || '基准状态';
}

function getCanonicalStateLabel(signature: SceneStateSignature): string {
  const labels = [
    signature.era,
    signature.structuralState,
    signature.dayPart === 'night'
      ? '夜晚'
      : signature.dayPart === 'dawn'
        ? '清晨'
        : signature.dayPart === 'dusk'
          ? '黄昏'
          : signature.dayPart === 'day'
            ? '白天'
            : '',
  ].filter(Boolean);
  return labels.join(' · ') || '基准状态';
}

function getCanonicalTimeOfDay(dayPart: DayPart, fallback: unknown): string {
  if (dayPart === 'night') return '夜晚';
  if (dayPart === 'dawn') return '清晨';
  if (dayPart === 'dusk') return '黄昏';
  if (dayPart === 'day') return '白天';
  return cleanText(fallback) || '未明确';
}

function createSceneStateName(mainSceneName: string, signature: SceneStateSignature): string {
  const spaceTag = signature.spaceType === 'interior'
    ? '[内]'
    : signature.spaceType === 'exterior'
      ? '[外]'
      : '';
  const timeTag = signature.dayPart === 'night'
    ? '[夜]'
    : signature.dayPart === 'dawn'
      ? '[晨]'
      : signature.dayPart === 'dusk'
        ? '[黄昏]'
        : signature.dayPart === 'day'
          ? '[日]'
          : '';
  const modifiers = [signature.era, signature.structuralState].filter(Boolean);
  return [mainSceneName, spaceTag, timeTag, modifiers.length > 0 ? `（${modifiers.join(' · ')}）` : '']
    .filter(Boolean)
    .join(' ')
    .trim();
}

function inferStateEvidence(scene: UnknownRecord, reason: SceneStateReason, signature: SceneStateSignature): string {
  const explicit = cleanText(scene.stateChangeEvidence || scene.stateEvidence || scene.scriptEvidence);
  const explicitDayPart = inferDayPartFromText(explicit);
  const explicitIsCompatible = reason !== 'day-night-change'
    || explicitDayPart === 'unspecified'
    || explicitDayPart === signature.dayPart;
  if (explicit && explicitIsCompatible) return explicit;
  if (reason === 'baseline') return '该主场景在剧本中的首次有效出现，作为后续变体的基准状态。';

  const relevantPattern = reason === 'day-night-change'
    ? signature.dayPart === 'night'
      ? /夜|深夜|午夜|晚上/
      : signature.dayPart === 'dawn'
        ? /晨|黎明|拂晓/
        : signature.dayPart === 'dusk'
          ? /黄昏|傍晚|日落/
          : /日|白天|上午|下午|中午/
    : reason === 'era-change'
      ? /年前|年后|回忆|过去|未来|战前|战后/
      : reason === 'structural-change'
        ? /改造|装修|翻修|重建|修缮|拆除|拆迁|坍塌|废墟|烧毁|焚毁|爆炸|水淹|破败|废弃|焕新|修复/
        : /内|外/;
  const occurrenceEvidence = deduplicateOccurrences(scene.occurrences)
    .map(item => item.heading)
    .filter(item => relevantPattern.test(item))
    .slice(0, 2);
  if (occurrenceEvidence.length > 0) return occurrenceEvidence.join('；');

  if (reason === 'day-night-change') return `场次时间明确切换为${getCanonicalStateLabel(signature)}。`;
  if (reason === 'era-change') return `剧本明确进入${signature.era || '另一年代'}。`;
  if (reason === 'structural-change') return `场景发生会延续到后续剧情的${signature.structuralState || '重大结构变化'}。`;
  return '剧本明确切换了内外景制作空间。';
}

function inferVisualDifference(
  scene: UnknownRecord,
  reason: SceneStateReason,
  signature: SceneStateSignature,
  baselineName: string
): string {
  const explicit = cleanText(scene.stateVisualDifference || scene.visualDifference || scene.stateVisualChange);
  if (explicit) return explicit;
  if (reason === 'baseline') return '主场景首次出现的基准空间、固定装修和主陈设。';
  if (reason === 'day-night-change') {
    return `严格继承「${baselineName}」的空间结构、固定装修和主陈设，只按剧本把时间与光线切换为${getCanonicalStateLabel(signature)}。`;
  }
  if (reason === 'era-change') {
    return `保持「${baselineName}」可识别的空间身份，按${signature.era || '对应年代'}调整固定装修、材质老化程度和时代设施。`;
  }
  if (reason === 'structural-change') {
    return `保持「${baselineName}」可识别的空间骨架，明确呈现${signature.structuralState || '剧情要求的重大持久变化'}，不把临时道具增减当作变化主体。`;
  }
  return '该场次切换为独立的内外景制作空间，不沿用上一状态的镜头构图。';
}

function normalizeDayPartWithinGroup(buckets: SceneStateBucket[]): void {
  const explicitDayParts = buckets
    .map(bucket => bucket.signature.dayPart)
    .filter(dayPart => dayPart !== 'unspecified');
  const fallback = explicitDayParts[0] || 'unspecified';
  buckets.forEach(bucket => {
    if (bucket.signature.dayPart === 'unspecified') bucket.signature.dayPart = fallback;
  });
}

function filterOccurrencesForSignature(
  occurrences: NormalizedOccurrence[],
  signature: SceneStateSignature
): NormalizedOccurrence[] {
  let filtered = occurrences;
  if (signature.dayPart !== 'unspecified') {
    const matchingDayPart = filtered.filter(item => {
      const occurrenceDayPart = inferDayPartFromText(`${item.heading} ${item.stateLabel}`);
      return occurrenceDayPart === 'unspecified' || occurrenceDayPart === signature.dayPart;
    });
    if (matchingDayPart.some(item => inferDayPartFromText(`${item.heading} ${item.stateLabel}`) === signature.dayPart)) {
      filtered = matchingDayPart;
    }
  }

  if (signature.era) {
    const matchingEra = filtered.filter(item => inferEra({
      name: item.heading,
      stateLabel: item.stateLabel,
    }) === signature.era);
    if (matchingEra.length > 0) filtered = matchingEra;
  }

  if (signature.structuralState) {
    const matchingStructure = filtered.filter(item => inferStructuralState({
      name: item.heading,
      stateLabel: item.stateLabel,
    }) === signature.structuralState);
    if (matchingStructure.length > 0) filtered = matchingStructure;
  }
  return filtered;
}

export function normalizeSceneMarkerIdentity(value: unknown): string {
  const name = cleanText(value);
  if (!name) return '';
  const scene = { name, stateLabel: name, timeOfDay: name, type: name };
  const signature = getSceneStateSignature(scene);
  return [
    normalizeSceneLocationIdentity(name),
    getSignatureKey(signature),
  ].join('::');
}

export function normalizeSceneStateUnits(rawScenes: unknown): SceneStateNormalizationResult {
  if (!Array.isArray(rawScenes)) return { scenes: [], aliases: {}, mergedCount: 0 };

  const sourceScenes = rawScenes.filter(scene => scene && typeof scene === 'object' && !Array.isArray(scene)) as UnknownRecord[];
  const groups = new Map<string, { mainSceneName: string; sourceIndex: number; buckets: SceneStateBucket[] }>();

  sourceScenes.forEach((sourceScene, sourceIndex) => {
    const mainSceneName = getSceneMainLocation(sourceScene) || stripSceneStateTokens(sourceScene.name) || `场景${sourceIndex + 1}`;
    const groupIdentity = normalizeSceneLocationIdentity(mainSceneName) || `scene-${sourceIndex}`;
    const group = groups.get(groupIdentity) || { mainSceneName, sourceIndex, buckets: [] };
    group.sourceIndex = Math.min(group.sourceIndex, sourceIndex);
    group.buckets.push({
      scene: { ...sourceScene },
      signature: getSceneStateSignature(sourceScene),
      sourceIndex,
      sourceNames: [cleanText(sourceScene.name)].filter(Boolean),
    });
    groups.set(groupIdentity, group);
  });

  const aliases: Record<string, string> = {};
  const normalizedScenes: UnknownRecord[] = [];

  Array.from(groups.values())
    .sort((a, b) => a.sourceIndex - b.sourceIndex)
    .forEach(group => {
      normalizeDayPartWithinGroup(group.buckets);
      const stateBuckets = new Map<string, SceneStateBucket>();

      group.buckets
        .sort((a, b) => a.sourceIndex - b.sourceIndex)
        .forEach(bucket => {
          const signatureKey = getSignatureKey(bucket.signature);
          const existing = stateBuckets.get(signatureKey);
          if (!existing) {
            stateBuckets.set(signatureKey, bucket);
            return;
          }
          existing.scene = mergeSceneRecords(existing.scene, bucket.scene);
          existing.sourceIndex = Math.min(existing.sourceIndex, bucket.sourceIndex);
          existing.sourceNames = uniqueStrings(existing.sourceNames, bucket.sourceNames);
        });

      const states = Array.from(stateBuckets.values()).sort((a, b) => {
        const episodeDifference = getFirstEpisode(a.scene) - getFirstEpisode(b.scene);
        return episodeDifference === 0 ? a.sourceIndex - b.sourceIndex : episodeDifference;
      });
      if (states.length === 0) return;

      const baseline = states[0];
      const baselineName = createSceneStateName(group.mainSceneName, baseline.signature);

      states.forEach((bucket, index) => {
        const reason = index === 0 ? 'baseline' : reasonFromSignatures(bucket.signature, baseline.signature);
        const canonicalName = createSceneStateName(group.mainSceneName, bucket.signature);
        const referenceSceneName = index > 0 && reason !== 'space-change' ? baselineName : '';
        const occurrences = filterOccurrencesForSignature(
          deduplicateOccurrences(bucket.scene.occurrences),
          bucket.signature
        );
        const occurrenceEpisodeNumbers = cleanEpisodeNumbers(occurrences.map(item => item.episodeNumber));
        const episodeNumbers = occurrenceEpisodeNumbers.length > 0
          ? occurrenceEpisodeNumbers
          : cleanEpisodeNumbers(bucket.scene.episodeNumbers);

        bucket.sourceNames.forEach(sourceName => {
          if (sourceName && sourceName !== canonicalName) aliases[sourceName] = canonicalName;
        });

        normalizedScenes.push({
          ...bucket.scene,
          id: bucket.scene.id ?? bucket.sourceIndex + 1,
          name: canonicalName,
          mainSceneName: group.mainSceneName,
          physicalLocation: group.mainSceneName,
          stateLabel: getCanonicalStateLabel(bucket.signature),
          timeOfDay: getCanonicalTimeOfDay(bucket.signature.dayPart, bucket.scene.timeOfDay),
          stateReason: reason,
          stateReasonLabel: getSceneStateReasonLabel(reason),
          stateChangeEvidence: inferStateEvidence(bucket.scene, reason, bucket.signature),
          stateVisualDifference: inferVisualDifference(bucket.scene, reason, bucket.signature, baselineName),
          isIndependentState: true,
          stateSequence: index + 1,
          totalStates: states.length,
          referenceSceneName,
          imageMode: referenceSceneName ? 'image-to-image' : 'text-to-image',
          episodeNumbers,
          occurrences,
        });
      });
    });

  return {
    scenes: normalizedScenes,
    aliases,
    mergedCount: Math.max(0, sourceScenes.length - normalizedScenes.length),
  };
}
