export type CharacterLifecycleChangeType = '年龄时期' | '身体状态' | '特殊形态' | '复合变化';

export type CharacterLifecycleRequirement = {
  id: string;
  characterName: string;
  label: string;
  changeType: CharacterLifecycleChangeType;
  ageStage: string;
  physicalState: string;
  transformationState: string;
  episodeNumbers: number[];
  sceneNames: string[];
  sourceEvidence: string;
  anchorTerms: string[];
  confidence: 'strong';
};

export type CharacterLifecycleAuditSummary = {
  requiredCount: number;
  coveredCount: number;
  missingCount: number;
  requirements: CharacterLifecycleRequirement[];
  missing: CharacterLifecycleRequirement[];
};

type CharacterIdentity = {
  name: string;
  aliases: string[];
};

type ScriptScene = {
  episodeNumber: number | null;
  heading: string;
  lines: string[];
  flashback: boolean;
  timeShift: boolean;
  temporalAnchors: string[];
};

const AGE_STAGE_PATTERN = /(婴儿|幼年|童年|儿童时期|少年时期|少女时期|青少年|青年时期|年轻时|中年时期|壮年时期|老年时期|暮年|年幼|年少)/g;
const RELATIVE_TIME_PATTERN = /([一二两三四五六七八九十百千万\d]+年(?:前|后))/g;
const CALENDAR_YEAR_PATTERN = /((?:18|19|20)\d{2}年)/g;
const PHYSICAL_STATE_PATTERN = /(重伤|轻伤|受伤|负伤|流血|包扎|骨折|瘸腿|怀孕|孕期|临产|产后|生病|病弱|虚弱|昏迷|中毒|醉酒|淋雨|湿透|烧伤|毁容|失明|残疾|康复|憔悴)/g;
const TRANSFORMATION_PATTERN = /(变身|觉醒|入魔|魔化|妖化|兽化|异化|黑化形态|灵体|魂体|法相|真身|机甲形态|战甲形态|完全体|进化形态|神化|仙化)/g;
const FLASHBACK_START_PATTERN = /【?\s*(?:闪回|回忆开始|回想开始)\s*】?/;
const FLASHBACK_END_PATTERN = /【?\s*(?:闪回结束|回忆结束|回想结束)(?:[^】\n]*)?】?/;
const SCENE_HEADING_PATTERN = /^\s*\d+\s*[-—–.]\s*\d+\s*[:：]?\s*(.+?)\s*$/;
const EPISODE_HEADING_PATTERN = /^\s*第\s*([一二两三四五六七八九十百千万\d]+)\s*[集章](?:\s*[:：]\s*.*|\s*)$/;
const STAGE_PREFIX_PATTERN = /^(婴儿|幼年|童年|儿童|少年|少女|青年|年轻|中年|壮年|老年|暮年)/;

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function normalizeIdentity(value: unknown): string {
  return cleanText(value)
    .toLocaleLowerCase()
    .replace(/[【】\[\]（）()<>:"/\\|?*·•，,。；;：:、'“”‘’\s_-]/g, '');
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const text = cleanText(value);
    const identity = normalizeIdentity(text);
    if (!identity || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  }).map(cleanText);
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
  const hundredIndex = value.indexOf('百');
  if (hundredIndex >= 0) {
    const hundreds = digits[value.slice(0, hundredIndex)] ?? 1;
    const remainder = value.slice(hundredIndex + 1);
    const remainderValue = remainder ? chineseNumberToNumber(remainder.replace(/^零/, '')) : 0;
    return remainderValue === null ? null : hundreds * 100 + remainderValue;
  }
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

function normalizeTimelineAnchor(value: string): string {
  const text = cleanText(value);
  const relativeMatch = text.match(/^([一二两三四五六七八九十百千万\d]+)(年(?:前|后))$/);
  if (!relativeMatch) return text;
  const number = chineseNumberToNumber(relativeMatch[1]);
  return number === null ? text : `${number}${relativeMatch[2]}`;
}

function buildTimelineEquivalence(content: string): Map<string, string> {
  const relativeMatches = Array.from(content.matchAll(RELATIVE_TIME_PATTERN)).map(match => ({
    anchor: normalizeTimelineAnchor(match[1] || match[0]),
    index: match.index || 0,
  }));
  const calendarMatches = Array.from(content.matchAll(CALENDAR_YEAR_PATTERN)).map(match => ({
    anchor: match[1] || match[0],
    index: match.index || 0,
  }));
  const equivalence = new Map<string, string>();
  relativeMatches.forEach(relative => {
    const nearest = calendarMatches
      .map(calendar => ({ ...calendar, distance: Math.abs(calendar.index - relative.index) }))
      .filter(calendar => calendar.distance <= 1200)
      .sort((left, right) => left.distance - right.distance)[0];
    if (!nearest) return;
    equivalence.set(relative.anchor, nearest.anchor);
    equivalence.set(nearest.anchor, nearest.anchor);
  });
  return equivalence;
}

function parseEpisodeNumber(line: string): number | null {
  const match = cleanText(line).match(EPISODE_HEADING_PATTERN);
  return match ? chineseNumberToNumber(match[1]) : null;
}

function getSceneHeading(line: string): string {
  return cleanText(line).match(SCENE_HEADING_PATTERN)?.[1] || '';
}

function extractTerms(text: string, pattern: RegExp): string[] {
  pattern.lastIndex = 0;
  return uniqueStrings(Array.from(text.matchAll(pattern)).map(match => match[1] || match[0]));
}

function getTemporalAnchors(text: string): string[] {
  return uniqueStrings([
    ...extractTerms(text, RELATIVE_TIME_PATTERN),
    ...extractTerms(text, CALENDAR_YEAR_PATTERN),
    ...extractTerms(text, AGE_STAGE_PATTERN),
  ]);
}

function parseScriptScenes(content: string): ScriptScene[] {
  const lines = content.replace(/\r/g, '').split('\n');
  const scenes: ScriptScene[] = [];
  let episodeNumber: number | null = null;
  let flashback = false;
  let pendingTemporalAnchors: string[] = [];
  let lastFlashbackAnchors: string[] = [];
  let lastFlashbackAnchorLine = Number.NEGATIVE_INFINITY;
  let current: ScriptScene | null = null;

  const finishCurrent = () => {
    if (!current) return;
    const visualAnchorText = current.lines
      .map(cleanText)
      .filter(line => (
        /^(?:字幕|画面字幕|时间)\s*[:：]/.test(line) ||
        /^[【\[].*(?:年(?:前|后)|(?:18|19|20)\d{2}年|童年|少年|青年|中年|老年).*[】\]]$/.test(line) ||
        /^(?:△\s*)?(?:[一二两三四五六七八九十百千万\d]+年(?:前|后)|(?:18|19|20)\d{2}年)[。.]?$/.test(line)
      ))
      .join('\n');
    current.temporalAnchors = uniqueStrings([
      ...current.temporalAnchors,
      ...getTemporalAnchors(visualAnchorText),
    ]);
    scenes.push(current);
    current = null;
  };

  lines.forEach((rawLine, lineIndex) => {
    const line = cleanText(rawLine);
    const parsedEpisode = parseEpisodeNumber(line);
    if (parsedEpisode !== null) {
      finishCurrent();
      episodeNumber = parsedEpisode;
      pendingTemporalAnchors = [];
      return;
    }

    if (FLASHBACK_END_PATTERN.test(line)) {
      if (current) current.lines.push(rawLine);
      finishCurrent();
      flashback = false;
      pendingTemporalAnchors = [];
      return;
    }
    if (FLASHBACK_START_PATTERN.test(line)) {
      finishCurrent();
      flashback = true;
      const precedingText = lines.slice(Math.max(0, lineIndex - 16), lineIndex + 1).join('\n');
      const precedingTimelineAnchors = getTemporalAnchors(precedingText)
        .filter(anchor => /年(?:前|后)$|^(?:18|19|20)\d{2}年$/.test(anchor));
      const recentFlashbackAnchors = lineIndex - lastFlashbackAnchorLine <= 220
        ? lastFlashbackAnchors
        : [];
      pendingTemporalAnchors = uniqueStrings([
        ...precedingTimelineAnchors,
        ...recentFlashbackAnchors,
      ]).slice(-4);
      if (precedingTimelineAnchors.length > 0) {
        lastFlashbackAnchors = precedingTimelineAnchors;
        lastFlashbackAnchorLine = lineIndex;
      }
      return;
    }

    const inlineAnchors = getTemporalAnchors(line);
    const isBracketedTimeMarker = inlineAnchors.length > 0 && /^[【\[].*[】\]]$/.test(line);
    const isInlineSceneTimeMarker = inlineAnchors.length > 0 && (
      /^(?:字幕|画面字幕|时间)\s*[:：]/.test(line) ||
      /^(?:△\s*)?(?:[一二两三四五六七八九十百千万\d]+年(?:前|后)|(?:18|19|20)\d{2}年)[。.]?$/.test(line)
    );
    if (current && isInlineSceneTimeMarker) {
      current.timeShift = true;
      current.temporalAnchors = uniqueStrings([...current.temporalAnchors, ...inlineAnchors]);
    } else if (inlineAnchors.length > 0 && (!current || isBracketedTimeMarker)) {
      pendingTemporalAnchors = uniqueStrings([...pendingTemporalAnchors, ...inlineAnchors]).slice(-4);
      if (flashback && isBracketedTimeMarker) {
        lastFlashbackAnchors = uniqueStrings([...lastFlashbackAnchors, ...inlineAnchors]).slice(-4);
        lastFlashbackAnchorLine = lineIndex;
      }
    }
    if (flashback && isInlineSceneTimeMarker) {
      lastFlashbackAnchors = uniqueStrings([...lastFlashbackAnchors, ...inlineAnchors]).slice(-4);
      lastFlashbackAnchorLine = lineIndex;
    }

    const heading = getSceneHeading(line);
    if (heading) {
      finishCurrent();
      current = {
        episodeNumber,
        heading,
        lines: [rawLine],
        flashback,
        timeShift: flashback || pendingTemporalAnchors.length > 0,
        temporalAnchors: [...pendingTemporalAnchors],
      };
      pendingTemporalAnchors = [];
      return;
    }

    if (current) current.lines.push(rawLine);
  });
  finishCurrent();
  return scenes;
}

function normalizeCharacterIdentities(characters: Array<string | Record<string, unknown>>): CharacterIdentity[] {
  return characters.flatMap(character => {
    const name = typeof character === 'string' ? cleanText(character) : cleanText(character?.name);
    if (!name) return [];
    const aliases = typeof character === 'string' || !Array.isArray(character?.aliases)
      ? []
      : character.aliases.map(cleanText).filter(Boolean);
    const strippedName = name.replace(STAGE_PREFIX_PATTERN, '');
    return [{
      name,
      aliases: uniqueStrings([name, strippedName, ...aliases]),
    }];
  });
}

function isAggregateIdentity(identity: CharacterIdentity): boolean {
  return identity.aliases.some(alias => (
    /若干|群众|路人|工作人员|众人|人群|宾客|亲戚|村民|同学|学生|顾客|记者|保安|护士|服务员/.test(alias)
  ));
}

function characterVisuallyAppearsInScene(identity: CharacterIdentity, sceneText: string): boolean {
  const aliases = uniqueStrings(identity.aliases.flatMap(alias => [
    alias,
    `童年${alias}`,
    `幼年${alias}`,
    `少年${alias}`,
    `青年${alias}`,
    `中年${alias}`,
    `老年${alias}`,
  ]));
  const lines = sceneText.split(/\r?\n/).map(cleanText);
  const castLines = lines.filter(line => /^(?:出场人物|人物|角色)\s*[:：]/.test(line));
  if (castLines.length > 0) {
    return castLines.some(line => aliases.some(alias => alias && line.includes(alias)));
  }
  return lines.some(line => {
    const matchedAlias = aliases.find(alias => alias && line.includes(alias));
    if (!matchedAlias) return false;
    if (/^(?:△|▲|画面|镜头)/.test(line)) return true;
    const escaped = matchedAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const dialogueMatch = line.match(new RegExp(`^${escaped}\\s*(?:[（(]([^）)]*)[）)])?\\s*[:：]`));
    if (!dialogueMatch) return false;
    return !/(?:V\.?O\.?|O\.?S\.?|画外音|电话音|广播|录音)/i.test(dialogueMatch[1] || '');
  });
}

function getCharacterStageTerms(identity: CharacterIdentity, scene: ScriptScene): string[] {
  const terms: string[] = [];
  const visualLines = [scene.heading, ...scene.lines.map(cleanText)].filter(line => (
    line === scene.heading || /^(?:△|▲|出场人物|人物|角色|字幕|画面字幕|时间|【|\[)/.test(line)
  ));
  visualLines.forEach(line => {
    identity.aliases.forEach(alias => {
      if (!alias) return;
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const prefixed = line.match(new RegExp(`(婴儿|幼年|童年|儿童|少年|少女|青年|年轻|中年|壮年|老年|暮年)(?:时期)?(?:的)?${escaped}`, 'g')) || [];
      prefixed.forEach(value => terms.push(...extractTerms(value, AGE_STAGE_PATTERN)));
      const contextual = line.match(new RegExp(`${escaped}[^，,、。；;！？!?\\n]{0,12}(小时候|儿时|幼年|童年|少年时期|青年时期|年轻时|中年时期|老年时期|年幼|年少)`, 'g')) || [];
      contextual.forEach(value => terms.push(...extractTerms(value, AGE_STAGE_PATTERN)));
    });
  });
  return uniqueStrings(terms);
}

function hasYoungerCoCastContext(identity: CharacterIdentity, sceneText: string): boolean {
  return sceneText.split(/\r?\n/).map(cleanText).some(line => {
    if (!/^(?:出场人物|人物|角色)\s*[:：]/.test(line)) return false;
    if (!identity.aliases.some(alias => alias && line.includes(alias))) return false;
    return /(?:婴儿|幼年|童年|儿童|少年|少女|青年|年轻)[\u4e00-\u9fa5A-Za-z]{2,12}/.test(line);
  });
}

function getCharacterStateTerms(identity: CharacterIdentity, sceneText: string, pattern: RegExp): string[] {
  const terms: string[] = [];
  sceneText.split(/\r?\n/).map(cleanText).filter(Boolean).forEach(line => {
    identity.aliases.forEach(alias => {
      if (!alias || !line.includes(alias)) return;
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const stateGrammar = '(?:本人|自己)?(?:神情|面色|脸色|身体|状态|浑身|双眼|手腕|腿部|头部|皮肤|声音|步态|看起来|显得|已经|仍然|仍|正|有些|十分|非常|略显|突然|逐渐|开始|变得|处于|陷入|被打得|摔得|病得|伤得|喝得|淋得|烧得)?[的地得着了\\s]{0,3}';
      const coordinatedSubject = `(?:和|与|、)[\\u4e00-\\u9fa5A-Za-z]{2,12}(?:神情|面色|脸色|身体|状态|浑身|看起来|显得|已经|仍然|仍|正|有些|十分|非常|略显|突然|逐渐|开始|变得|处于|陷入)[的地得着了\\s]{0,3}`;
      const nearby = line.match(new RegExp([
        `${escaped}\\s*[（(][^）)]{0,24}(?:${pattern.source})[^）)]{0,8}[）)]`,
        `${escaped}${stateGrammar}(?:${pattern.source})`,
        `${escaped}${coordinatedSubject}(?:${pattern.source})`,
        `(?:${pattern.source})(?:状态)?(?:的)?${escaped}`,
      ].join('|'), 'g')) || [];
      nearby.forEach(value => terms.push(...extractTerms(value, pattern)));
    });
  });
  return uniqueStrings(terms);
}

function makeEvidence(scene: ScriptScene, identity: CharacterIdentity): string {
  const relevantLines = scene.lines
    .map(cleanText)
    .filter(Boolean)
    .filter(line => identity.aliases.some(alias => alias && line.includes(alias)) || getTemporalAnchors(line).length > 0)
    .slice(0, 5);
  const prefix = [
    scene.episodeNumber ? `第${scene.episodeNumber}集` : '',
    scene.heading,
  ].filter(Boolean).join(' ');
  return `${prefix}：${relevantLines.join(' / ')}`.slice(0, 700);
}

function requirementIdentity(
  requirement: CharacterLifecycleRequirement,
  timelineEquivalence: Map<string, string>
): string {
  const explicitStage = requirement.anchorTerms.find(anchor => (
    /婴儿|幼年|童年|儿童时期|少年时期|少女时期|青少年|青年时期|年轻时|中年时期|壮年时期|老年时期|暮年|年幼|年少/.test(anchor)
  ));
  const calendarAnchor = requirement.anchorTerms.find(anchor => /^(?:18|19|20)\d{2}年$/.test(anchor));
  const relativeAnchor = requirement.anchorTerms.find(anchor => /年(?:前|后)$/.test(anchor));
  const normalizedTimeAnchor = normalizeTimelineAnchor(relativeAnchor || calendarAnchor || '');
  const equivalentTimeAnchor = timelineEquivalence.get(normalizedTimeAnchor) || normalizedTimeAnchor;
  const state = requirement.changeType === '年龄时期'
    ? (explicitStage || equivalentTimeAnchor || requirement.ageStage)
    : requirement.changeType === '身体状态'
      ? requirement.physicalState
      : requirement.changeType === '特殊形态'
        ? requirement.transformationState
        : [requirement.ageStage, requirement.physicalState, requirement.transformationState].filter(Boolean).join('|');
  return `${normalizeIdentity(requirement.characterName)}::${requirement.changeType}::${normalizeIdentity(state)}`;
}

function mergeRequirement(target: CharacterLifecycleRequirement, source: CharacterLifecycleRequirement) {
  target.episodeNumbers = Array.from(new Set([...target.episodeNumbers, ...source.episodeNumbers])).sort((a, b) => a - b);
  target.sceneNames = uniqueStrings([...target.sceneNames, ...source.sceneNames]);
  target.anchorTerms = uniqueStrings([...target.anchorTerms, ...source.anchorTerms]);
  target.sourceEvidence = uniqueStrings([target.sourceEvidence, source.sourceEvidence]).join('；').slice(0, 1000);
}

export function buildCharacterLifecycleRequirements(
  content: string,
  characters: Array<string | Record<string, unknown>>
): CharacterLifecycleRequirement[] {
  const identities = normalizeCharacterIdentities(characters);
  const scenes = parseScriptScenes(content);
  const timelineEquivalence = buildTimelineEquivalence(content);
  const requirements = new Map<string, CharacterLifecycleRequirement>();

  identities.forEach(identity => {
    if (isAggregateIdentity(identity)) return;
    const identityScenes = scenes.filter(scene => characterVisuallyAppearsInScene(identity, scene.lines.join('\n')));
    const timelineKeys = new Set<string>();
    let hasBaselineAppearance = false;
    identityScenes.forEach(scene => {
      const sceneText = scene.lines.join('\n');
      const stages = getCharacterStageTerms(identity, scene);
      const youngerCoCast = scene.flashback && stages.length === 0 && hasYoungerCoCastContext(identity, sceneText);
      const anchors = uniqueStrings([
        ...stages,
        ...(scene.timeShift ? scene.temporalAnchors : []),
        youngerCoCast ? '较年轻时期' : '',
      ]);
      if (anchors.length === 0) {
        hasBaselineAppearance = true;
        return;
      }
      anchors.forEach(anchor => {
        const normalized = normalizeTimelineAnchor(anchor);
        timelineKeys.add(timelineEquivalence.get(normalized) || normalized);
      });
    });
    const needsAgeVariants = hasBaselineAppearance || timelineKeys.size > 1;

    identityScenes.forEach(scene => {
      const sceneText = scene.lines.join('\n');

      const characterStages = getCharacterStageTerms(identity, scene);
      const youngerCoCastContext = scene.flashback && characterStages.length === 0 && hasYoungerCoCastContext(identity, sceneText);
      const temporalAnchors = uniqueStrings([
        ...characterStages,
        ...(scene.timeShift ? scene.temporalAnchors : []),
      ]);
      const physicalStates = getCharacterStateTerms(identity, sceneText, PHYSICAL_STATE_PATTERN);
      const transformations = getCharacterStateTerms(identity, sceneText, TRANSFORMATION_PATTERN);
      const hasStrongTemporalChange = characterStages.length > 0 || youngerCoCastContext || (scene.timeShift && temporalAnchors.length > 0);
      const evidence = makeEvidence(scene, identity);
      const episodeNumbers = scene.episodeNumber ? [scene.episodeNumber] : [];
      const sceneNames = scene.heading ? [scene.heading] : [];

      const addRequirement = (requirement: CharacterLifecycleRequirement) => {
        const key = requirementIdentity(requirement, timelineEquivalence);
        const existing = requirements.get(key);
        if (existing) mergeRequirement(existing, requirement);
        else requirements.set(key, requirement);
      };

      if (hasStrongTemporalChange && needsAgeVariants) {
        const calendarAnchor = temporalAnchors.find(anchor => /^(?:18|19|20)\d{2}年$/.test(anchor));
        const relativeAnchor = temporalAnchors.find(anchor => /年(?:前|后)$/.test(anchor));
        const stageAnchor = characterStages[0];
        const label = uniqueStrings([stageAnchor || '', relativeAnchor || '', calendarAnchor || '']).join(' / ') || (youngerCoCastContext ? '较年轻时期（与童年/少年角色同期）' : '明确时间变化时期');
        const ageStage = stageAnchor || relativeAnchor || calendarAnchor || (youngerCoCastContext ? '较年轻时期' : '明确时间变化时期');
        addRequirement({
          id: '',
          characterName: identity.name,
          label,
          changeType: physicalStates.length > 0 || transformations.length > 0 ? '复合变化' : '年龄时期',
          ageStage,
          physicalState: physicalStates[0] || '正常状态',
          transformationState: transformations[0] || '',
          episodeNumbers,
          sceneNames,
          sourceEvidence: evidence,
          anchorTerms: uniqueStrings([
            ...characterStages,
            relativeAnchor || '',
            calendarAnchor || '',
            youngerCoCastContext ? '较年轻时期' : '',
          ]),
          confidence: 'strong',
        });
      }

      physicalStates.forEach(state => addRequirement({
        id: '',
        characterName: identity.name,
        label: state,
        changeType: transformations.length > 0 ? '复合变化' : '身体状态',
        ageStage: '',
        physicalState: state,
        transformationState: transformations[0] || '',
        episodeNumbers,
        sceneNames,
        sourceEvidence: evidence,
        anchorTerms: [state],
        confidence: 'strong',
      }));

      transformations.forEach(state => addRequirement({
        id: '',
        characterName: identity.name,
        label: state,
        changeType: physicalStates.length > 0 ? '复合变化' : '特殊形态',
        ageStage: '',
        physicalState: physicalStates[0] || '正常状态',
        transformationState: state,
        episodeNumbers,
        sceneNames,
        sourceEvidence: evidence,
        anchorTerms: [state],
        confidence: 'strong',
      }));
    });
  });

  const mergedRequirements = Array.from(requirements.values());
  const removed = new Set<CharacterLifecycleRequirement>();
  mergedRequirements.forEach(requirement => {
    if (requirement.changeType !== '年龄时期') return;
    const hasExplicitStage = requirement.anchorTerms.some(anchor => (
      /婴儿|幼年|童年|儿童时期|少年时期|少女时期|青少年|青年时期|年轻时|中年时期|壮年时期|老年时期|暮年|年幼|年少/.test(anchor)
    ));
    if (hasExplicitStage) return;
    const timeAnchors = requirement.anchorTerms
      .map(normalizeTimelineAnchor)
      .map(anchor => timelineEquivalence.get(anchor) || anchor)
      .filter(Boolean);
    const isGenericYoungerPeriod = requirement.anchorTerms.includes('较年轻时期');
    const explicitPastRequirement = isGenericYoungerPeriod
      ? mergedRequirements.find(candidate => (
          candidate !== requirement &&
          candidate.characterName === requirement.characterName &&
          candidate.changeType === '年龄时期' &&
          candidate.anchorTerms.some(anchor => /年(?:前)$|^(?:18|19|20)\d{2}年$/.test(anchor))
        ))
      : undefined;
    if (explicitPastRequirement) {
      mergeRequirement(explicitPastRequirement, requirement);
      removed.add(requirement);
      return;
    }
    const stagedMatch = mergedRequirements.find(candidate => (
      candidate !== requirement &&
      candidate.characterName === requirement.characterName &&
      candidate.changeType === '年龄时期' &&
      candidate.anchorTerms.some(anchor => /婴儿|幼年|童年|儿童时期|少年时期|少女时期|青少年|青年时期|年轻时|中年时期|壮年时期|老年时期|暮年|年幼|年少/.test(anchor)) &&
      candidate.anchorTerms
        .map(normalizeTimelineAnchor)
        .map(anchor => timelineEquivalence.get(anchor) || anchor)
        .some(anchor => timeAnchors.includes(anchor))
    ));
    if (!stagedMatch) return;
    mergeRequirement(stagedMatch, requirement);
    removed.add(requirement);
  });

  return mergedRequirements.filter(requirement => !removed.has(requirement)).map((requirement, index) => ({
    ...requirement,
    id: `lifecycle-${index + 1}`,
  }));
}

function lookCoversRequirement(look: Record<string, unknown>, requirement: CharacterLifecycleRequirement): boolean {
  const lookText = cleanText([
    look?.scene,
    look?.stage,
    look?.description,
    look?.changeType,
    look?.ageStage,
    look?.physicalState,
    look?.transformationState,
    look?.sourceEvidence,
  ].filter(Boolean).join(' '));
  const lookEpisodes = Array.isArray(look?.episodeNumbers)
    ? look.episodeNumbers.map(value => Number(value)).filter(Number.isFinite)
    : [];
  const hasEpisodeOverlap = requirement.episodeNumbers.length === 0 || lookEpisodes.length === 0 || requirement.episodeNumbers.some(value => lookEpisodes.includes(value));
  if (!hasEpisodeOverlap) return false;

  if (requirement.transformationState && lookText.includes(requirement.transformationState)) return true;
  if (requirement.physicalState && requirement.physicalState !== '正常状态' && lookText.includes(requirement.physicalState)) return true;
  return requirement.anchorTerms.some(anchor => anchor && lookText.includes(anchor));
}

export function auditCharacterLifecycleLooks(
  characters: Array<Record<string, unknown>>,
  requirements: CharacterLifecycleRequirement[]
): CharacterLifecycleAuditSummary {
  const missing: CharacterLifecycleRequirement[] = [];
  requirements.forEach(requirement => {
    const character = characters.find(item => normalizeIdentity(item?.name) === normalizeIdentity(requirement.characterName));
    const looks = Array.isArray(character?.looks) ? character.looks as Array<Record<string, unknown>> : [];
    if (!looks.some(look => lookCoversRequirement(look, requirement))) missing.push(requirement);
  });
  return {
    requiredCount: requirements.length,
    coveredCount: requirements.length - missing.length,
    missingCount: missing.length,
    requirements,
    missing,
  };
}

export function formatCharacterLifecycleChecklist(requirements: CharacterLifecycleRequirement[]): string {
  if (requirements.length === 0) return '未检索到需要独立制作造型的强生命周期证据。';
  const grouped = new Map<string, CharacterLifecycleRequirement[]>();
  requirements.forEach(requirement => grouped.set(
    requirement.characterName,
    [...(grouped.get(requirement.characterName) || []), requirement]
  ));
  return Array.from(grouped.entries()).map(([name, items]) => [
    `【${name}｜必须覆盖 ${items.length} 项】`,
    ...items.map((item, index) => (
      `${index + 1}. ${item.changeType}：${item.label}；集数：${item.episodeNumbers.map(value => `第${value}集`).join('、') || '待核对'}；场景：${item.sceneNames.join('、') || '待核对'}；证据：${item.sourceEvidence}`
    )),
  ].join('\n')).join('\n\n');
}
