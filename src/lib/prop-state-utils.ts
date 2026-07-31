type UnknownRecord = Record<string, any>;

type NormalizedOccurrence = {
  episodeNumber: number | null;
  episodeLabel: string;
  sceneName: string;
  heading: string;
  stateLabel: string;
};

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function cleanNumbers(value: unknown): number[] {
  const source = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  const numbers = source.flatMap(item => {
    if (typeof item === 'number' && Number.isFinite(item)) return [Math.max(1, Math.round(item))];
    return (String(item).match(/\d+/g) || [])
      .map(match => Number.parseInt(match, 10))
      .filter(number => Number.isFinite(number) && number > 0);
  });
  return Array.from(new Set(numbers)).sort((a, b) => a - b);
}

function episodeNumbersFromText(value: unknown): number[] {
  const text = cleanText(value);
  if (!text) return [];
  return cleanNumbers(Array.from(text.matchAll(/第\s*(\d+)\s*集/g), match => match[1]));
}

function normalizeStateIdentity(value: unknown): string {
  return cleanText(value)
    .replace(/状态/g, '')
    .replace(/[【】\[\]（）()\s·•,，。；;：:、]/g, '')
    .trim();
}

function isVisualProductionStateLabel(value: unknown): boolean {
  const identity = normalizeStateIdentity(value);
  if (!identity) return false;
  return !/^(?:被)?(?:展示|拿起|捡起|使用|发现|携带|转交|交付|归还|赠送|掉落|出现|摆放|取出|购买|售卖|移动|运输)(?:中|后|时)?$/.test(identity);
}

function normalizeOccurrence(value: unknown): NormalizedOccurrence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as UnknownRecord;
  const episodeNumber = cleanNumbers(source.episodeNumber ?? source.episodeLabel)[0] || null;
  const episodeLabel = cleanText(source.episodeLabel) || (episodeNumber ? `第${episodeNumber}集` : '未标注集数');
  const sceneName = cleanText(source.sceneName || source.scene);
  const heading = cleanText(source.heading);
  const stateLabel = cleanText(source.stateLabel || source.stateName);
  if (!episodeNumber && !sceneName && !heading && !stateLabel) return null;
  return { episodeNumber, episodeLabel, sceneName, heading, stateLabel };
}

function occurrenceKey(occurrence: NormalizedOccurrence): string {
  return [
    occurrence.episodeNumber || occurrence.episodeLabel,
    occurrence.heading || occurrence.sceneName,
  ].map(item => cleanText(item).replace(/\s+/g, '')).join('::');
}

function deduplicateOccurrences(values: NormalizedOccurrence[]): NormalizedOccurrence[] {
  const seen = new Set<string>();
  return values.filter(item => {
    const key = `${occurrenceKey(item)}::${normalizeStateIdentity(item.stateLabel)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stableNumericId(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) || 1;
}

function createStateUnitName(mainPropName: string, stateName: string): string {
  return `${mainPropName}（${stateName || '默认状态'}）`;
}

function hasIndependentStateEvidence(state: UnknownRecord): boolean {
  const evidence = cleanText(state.evidence || state.sourceEvidence || state.scriptEvidence);
  if (evidence) return true;
  const visualChange = cleanText(state.visualChange);
  return Boolean(visualChange && !/^在前一状态基础上变为/.test(visualChange) && visualChange !== '基准状态');
}

function hasNarrativeStateValue(state: UnknownRecord): boolean {
  return Boolean(cleanText(
    state.narrativeFunction || state.storyFunction || state.storyImpact || state.productionReason
  ));
}

function hasDifferentProductionContext(
  current: NormalizedOccurrence[],
  previous: NormalizedOccurrence[]
): boolean {
  if (current.length === 0) return false;
  if (previous.length === 0) return true;
  const previousKeys = new Set(previous.map(occurrenceKey));
  return current.some(item => !previousKeys.has(occurrenceKey(item)));
}

function expandSingleProp(rawProp: unknown): UnknownRecord[] {
  if (!rawProp || typeof rawProp !== 'object' || Array.isArray(rawProp)) return [];
  const prop = rawProp as UnknownRecord;
  if (prop.isStateUnit) return [prop];

  const mainPropName = cleanText(prop.mainPropName || prop.name) || '未命名道具';
  const rawVariants = Array.isArray(prop.stateVariants) && prop.stateVariants.length > 0
    ? prop.stateVariants.filter((item: unknown) => item && typeof item === 'object' && !Array.isArray(item))
    : [{
        id: 'state-1',
        stateName: prop.stateLabel || '默认状态',
        scene: Array.isArray(prop.appearanceScenes) ? prop.appearanceScenes[0] : '',
        description: prop.description,
        visualChange: '基准状态',
        referenceFromStateId: '',
        imageMode: prop.imageMode || 'text-to-image',
        episodeNumbers: prop.episodeNumbers,
        occurrences: prop.occurrences,
      }];
  const firstVisualState = rawVariants.find((state: UnknownRecord) => (
    isVisualProductionStateLabel(state.stateName || state.name || state.stage)
  ));
  const baselineStateName = cleanText(
    firstVisualState?.stateName
      || (isVisualProductionStateLabel(prop.stateLabel) ? prop.stateLabel : '')
      || '基准状态'
  );
  const productionVariants: UnknownRecord[] = firstVisualState
    ? rawVariants
    : [{
        ...rawVariants[0],
        id: cleanText(rawVariants[0]?.id) || 'state-1',
        stateName: baselineStateName,
        description: cleanText(rawVariants[0]?.description) || cleanText(prop.description),
        visualChange: '基准状态',
        transitionEvent: '基准状态',
        narrativeFunction: cleanText(prop.function),
        episodeNumbers: prop.episodeNumbers,
        occurrences: prop.occurrences,
      }];
  const normalizeActionOccurrence = (occurrence: NormalizedOccurrence): NormalizedOccurrence => (
    isVisualProductionStateLabel(occurrence.stateLabel)
      ? occurrence
      : { ...occurrence, stateLabel: baselineStateName }
  );
  const parentOccurrences = deduplicateOccurrences([
    ...(Array.isArray(prop.occurrences) ? prop.occurrences : [])
      .map(normalizeOccurrence)
      .filter((item): item is NormalizedOccurrence => Boolean(item))
      .map(normalizeActionOccurrence),
    ...rawVariants
      .filter((state: UnknownRecord) => !isVisualProductionStateLabel(state.stateName || state.name || state.stage))
      .flatMap((state: UnknownRecord) => (Array.isArray(state.occurrences) ? state.occurrences : []))
      .map(normalizeOccurrence)
      .filter((item): item is NormalizedOccurrence => Boolean(item))
      .map(item => ({ ...item, stateLabel: baselineStateName })),
  ]);
  const parentOccurrenceMap = new Map(parentOccurrences.map(item => [occurrenceKey(item), item]));

  const seenStates = new Set<string>();
  let acceptedStateCount = 0;
  let previousAcceptedOccurrences: NormalizedOccurrence[] = [];
  const normalizedStates: UnknownRecord[] = productionVariants.flatMap((rawState: UnknownRecord, sourceIndex: number) => {
    const stateName = cleanText(rawState.stateName || rawState.name || rawState.stage || prop.stateLabel || `状态${sourceIndex + 1}`);
    const stateIdentity = normalizeStateIdentity(stateName);
    if (!stateIdentity || !isVisualProductionStateLabel(stateName) || seenStates.has(stateIdentity)) return [];
    seenStates.add(stateIdentity);

    const matchingParentOccurrences = parentOccurrences.filter(item => (
      normalizeStateIdentity(item.stateLabel) === stateIdentity
    ));
    const explicitOccurrences = (Array.isArray(rawState.occurrences) ? rawState.occurrences : [])
      .map(normalizeOccurrence)
      .filter((item): item is NormalizedOccurrence => Boolean(item))
      .filter(item => {
        if (item.stateLabel && normalizeStateIdentity(item.stateLabel) !== stateIdentity) return false;
        const parent = parentOccurrenceMap.get(occurrenceKey(item));
        return !parent || !parent.stateLabel || normalizeStateIdentity(parent.stateLabel) === stateIdentity;
      });
    const occurrences = deduplicateOccurrences([...matchingParentOccurrences, ...explicitOccurrences]);
    const episodeNumbers = cleanNumbers([
      ...(Array.isArray(rawState.episodeNumbers) ? rawState.episodeNumbers : []),
      ...occurrences.map(item => item.episodeNumber),
      ...episodeNumbersFromText(rawState.stage),
    ]);
    const hasPersistentStoryImpact = hasNarrativeStateValue(rawState) && hasIndependentStateEvidence(rawState);
    const hasIndependentContext = hasDifferentProductionContext(occurrences, previousAcceptedOccurrences);
    const supported = acceptedStateCount === 0 || (
      hasIndependentContext && hasPersistentStoryImpact
    );
    if (!supported) return [];
    const productionIndex = acceptedStateCount++;
    previousAcceptedOccurrences = occurrences;

    return [{
      ...rawState,
      id: cleanText(rawState.id) || `state-${sourceIndex + 1}`,
      stateName,
      description: cleanText(rawState.description) || cleanText(prop.visualDescription) || cleanText(prop.description),
      visualChange: cleanText(rawState.visualChange) || (productionIndex === 0 ? '基准状态' : `从上一状态变化为${stateName}`),
      episodeNumbers,
      occurrences,
      _sourceIndex: sourceIndex,
    }];
  });

  if (normalizedStates.length === 0) return [];
  const forceStateSpecificNames = rawVariants.length > 1 || normalizedStates.length > 1;
  const stateUnitNames = normalizedStates.map(state => (
    forceStateSpecificNames
      ? createStateUnitName(mainPropName, state.stateName)
      : cleanText(prop.name) || createStateUnitName(mainPropName, state.stateName)
  ));

  return normalizedStates.map((state, index) => {
    const previousState = index > 0 ? normalizedStates[index - 1] : null;
    const previousName = index > 0 ? stateUnitNames[index - 1] : '';
    const episodeNumbers = normalizedStates.length === 1
      ? cleanNumbers([...(state.episodeNumbers || []), ...(Array.isArray(prop.episodeNumbers) ? prop.episodeNumbers : [])])
      : state.episodeNumbers;
    const occurrences = normalizedStates.length === 1
      ? deduplicateOccurrences([...(state.occurrences || []), ...parentOccurrences])
      : state.occurrences;
    const scenes = Array.from(new Set([
      cleanText(state.scene),
      ...occurrences.map((item: NormalizedOccurrence) => item.sceneName),
    ].filter(Boolean)));
    const stateRecord = {
      ...state,
      referenceFromStateId: index === 0 ? '' : cleanText(previousState?.id),
      imageMode: index === 0 ? 'text-to-image' : 'image-to-image',
      episodeNumbers,
      occurrences,
    };
    Reflect.deleteProperty(stateRecord, '_sourceIndex');

    const unitName = stateUnitNames[index];
    return {
      ...prop,
      id: stableNumericId(`${prop.id || mainPropName}::${unitName}`),
      name: unitName,
      sourcePropName: cleanText(prop.name),
      mainPropName,
      stateUnitId: cleanText(state.id) || `state-${index + 1}`,
      isStateUnit: true,
      stateSequence: index + 1,
      totalStates: normalizedStates.length,
      stateLabel: state.stateName,
      referencePropName: previousName,
      referenceStateId: index === 0 ? '' : cleanText(previousState?.id),
      imageMode: index === 0 ? 'text-to-image' : 'image-to-image',
      episodeNumbers,
      occurrences,
      appearanceScenes: scenes.length > 0 ? scenes : (Array.isArray(prop.appearanceScenes) ? prop.appearanceScenes : []),
      description: state.description || cleanText(prop.visualDescription) || prop.description,
      visualDescription: [state.description, state.visualChange].map(cleanText).filter(Boolean).join('；'),
      stateVisualChange: state.visualChange,
      stateTransitionEvent: cleanText(state.transitionEvent),
      stateNarrativeFunction: cleanText(state.narrativeFunction || state.storyFunction || state.storyImpact),
      stateEvidence: cleanText(state.evidence || state.sourceEvidence || state.scriptEvidence),
      stateVariants: [stateRecord],
    };
  });
}

export function expandPropStateUnits(rawProps: unknown): UnknownRecord[] {
  if (!Array.isArray(rawProps)) return [];
  const expanded = rawProps.flatMap(expandSingleProp);
  const seen = new Set<string>();
  return expanded.filter(prop => {
    const key = cleanText(prop.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
