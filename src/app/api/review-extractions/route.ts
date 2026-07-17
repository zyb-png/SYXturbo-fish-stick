import { NextRequest, NextResponse } from 'next/server';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import { mapWithConcurrency } from '@/lib/full-text-scan';
import { tryExtractAndFixJSON } from '@/lib/json-utils';
import { invoke as oaiInvoke } from '@/lib/openai-client';
import { normalizeCharacterLooks } from '@/lib/character-look-utils';
import { inheritBodyProfileForLooks, normalizeCharacterBodyProfile } from '@/lib/character-body-profile';
import {
  auditCharacterLifecycleLooks,
  buildCharacterLifecycleRequirements,
  formatCharacterLifecycleChecklist,
  type CharacterLifecycleRequirement,
} from '@/lib/character-lifecycle-audit';
import {
  getSceneMainLocation,
  normalizeSceneLocationIdentity,
  normalizeSceneStateUnits,
} from '@/lib/scene-state-utils';
import {
  inferCharacterEntityKind,
  normalizeCharacterGender,
  resolveCharacterGenderByPolicy,
} from '@/lib/character-semantic-rules';

export const maxDuration = 600;

type UnknownRecord = Record<string, any>;
type ReviewType = 'scene' | 'character' | 'prop';

type EntitySummary = {
  type: ReviewType;
  name: string;
  sourceIndex: number;
  episodeNumbers: number[];
  descriptions: string[];
  occurrences: string[];
  aliases: string[];
};

type CandidatePair = {
  id: string;
  type: ReviewType;
  left: EntitySummary;
  right: EntitySummary;
  score: number;
  commonEpisodes: number[];
  scriptEvidence: string[];
};

type ConfirmedDecision = {
  candidateId: string;
  type: ReviewType;
  left: string;
  right: string;
  canonicalName: string;
  reason: string;
};

type MergeGroup = {
  type: ReviewType;
  canonicalName: string;
  aliases: string[];
  reason: string;
};

const REVIEW_BATCH_SIZE = 30;
const MAX_CANDIDATES_PER_TYPE = 60;

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function normalizeIdentity(value: unknown): string {
  return cleanText(value)
    .toLocaleLowerCase()
    .replace(/[【】\[\]（）()<>:"/\\|?*·•，,。；;：:、'“”‘’\s_-]/g, '');
}

function uniqueStrings(...values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  values.flatMap(value => Array.isArray(value) ? value : []).forEach(value => {
    const text = cleanText(value);
    const identity = normalizeIdentity(text);
    if (!identity || seen.has(identity)) return;
    seen.add(identity);
    result.push(text);
  });
  return result;
}

function cleanNumbers(...values: unknown[]): number[] {
  return Array.from(new Set(values
    .flatMap(value => Array.isArray(value) ? value : [value])
    .flatMap(value => {
      if (typeof value === 'number' && Number.isFinite(value)) return [Math.round(value)];
      return (cleanText(value).match(/\d+/g) || []).map(item => Number.parseInt(item, 10));
    })
    .filter(value => Number.isFinite(value) && value > 0)))
    .sort((a, b) => a - b);
}

function chooseUsefulText(...values: unknown[]): string {
  const texts = values.map(cleanText).filter(Boolean);
  if (texts.length === 0) return '';
  return texts.sort((a, b) => {
    const score = (text: string) => Math.min(text.length, 220) - (/待补充|暂无|未知/.test(text) ? 500 : 0);
    return score(b) - score(a);
  })[0];
}

function getRecordEpisodes(record: UnknownRecord): number[] {
  const occurrences = Array.isArray(record?.occurrences)
    ? record.occurrences.map((item: UnknownRecord) => item?.episodeNumber ?? item?.episodeLabel)
    : [];
  const lookEpisodes = Array.isArray(record?.looks)
    ? record.looks.flatMap((look: UnknownRecord) => look?.episodeNumbers || [])
    : [];
  return cleanNumbers(record?.episodeNumbers, occurrences, lookEpisodes);
}

function getOccurrenceLabels(record: UnknownRecord): string[] {
  const occurrenceLabels = (Array.isArray(record?.occurrences) ? record.occurrences : [])
    .map((item: UnknownRecord) => cleanText(
      item?.heading || item?.sceneName || item?.scene || item?.episodeLabel
    ));
  return uniqueStrings(
    occurrenceLabels,
    record?.keyScenes,
    record?.appearanceScenes,
    Array.isArray(record?.looks) ? record.looks.flatMap((look: UnknownRecord) => look?.sceneNames || []) : []
  ).slice(0, 12);
}

function buildSceneSummaries(scenes: UnknownRecord[]): EntitySummary[] {
  const groups = new Map<string, EntitySummary>();
  scenes.forEach((scene, sourceIndex) => {
    const name = getSceneMainLocation(scene) || cleanText(scene?.name);
    const identity = normalizeSceneLocationIdentity(name) || normalizeIdentity(name);
    if (!identity || !name) return;
    const current = groups.get(identity) || {
      type: 'scene' as const,
      name,
      sourceIndex,
      episodeNumbers: [],
      descriptions: [],
      occurrences: [],
      aliases: [],
    };
    current.sourceIndex = Math.min(current.sourceIndex, sourceIndex);
    current.episodeNumbers = cleanNumbers(current.episodeNumbers, getRecordEpisodes(scene));
    current.descriptions = uniqueStrings(current.descriptions, [scene?.description, scene?.stateVisualDifference]).slice(0, 5);
    current.occurrences = uniqueStrings(current.occurrences, getOccurrenceLabels(scene)).slice(0, 12);
    current.aliases = uniqueStrings(current.aliases, [scene?.name, scene?.mainSceneName, scene?.physicalLocation]);
    groups.set(identity, current);
  });
  return Array.from(groups.values()).sort((a, b) => a.sourceIndex - b.sourceIndex);
}

function buildCharacterSummaries(characters: UnknownRecord[]): EntitySummary[] {
  return characters.flatMap((character, sourceIndex) => {
    const name = cleanText(character?.name);
    if (!name) return [];
    return [{
      type: 'character' as const,
      name,
      sourceIndex,
      episodeNumbers: getRecordEpisodes(character),
      descriptions: uniqueStrings([
        character?.appearance,
        character?.background,
        character?.role,
        character?.gender,
        character?.age,
      ]).slice(0, 5),
      occurrences: getOccurrenceLabels(character),
      aliases: uniqueStrings([name], character?.aliases),
    }];
  });
}

function buildPropSummaries(props: UnknownRecord[]): EntitySummary[] {
  const groups = new Map<string, EntitySummary>();
  props.forEach((prop, sourceIndex) => {
    const name = cleanText(prop?.mainPropName || prop?.sourcePropName || prop?.name);
    const identity = normalizeIdentity(name);
    if (!identity || !name) return;
    const current = groups.get(identity) || {
      type: 'prop' as const,
      name,
      sourceIndex,
      episodeNumbers: [],
      descriptions: [],
      occurrences: [],
      aliases: [],
    };
    current.sourceIndex = Math.min(current.sourceIndex, sourceIndex);
    current.episodeNumbers = cleanNumbers(current.episodeNumbers, getRecordEpisodes(prop));
    current.descriptions = uniqueStrings(current.descriptions, [
      prop?.description,
      prop?.visualDescription,
      prop?.function,
      prop?.stateNarrativeFunction,
    ]).slice(0, 5);
    current.occurrences = uniqueStrings(current.occurrences, getOccurrenceLabels(prop)).slice(0, 12);
    current.aliases = uniqueStrings(current.aliases, [prop?.name, prop?.mainPropName, prop?.sourcePropName]);
    groups.set(identity, current);
  });
  return Array.from(groups.values()).sort((a, b) => a.sourceIndex - b.sourceIndex);
}

function comparisonVariants(value: string, type: ReviewType): string[] {
  const identity = normalizeIdentity(value)
    .replace(/第\d+集/g, '')
    .replace(/\d+年前|\d+年后|十年前|十年后/g, '')
    .replace(/(?:白天|黑夜|夜晚|深夜|清晨|黄昏|傍晚|上午|下午|日|夜)$/g, '');
  const variants = new Set<string>([identity]);

  if (type === 'scene') {
    const synonym = identity
      .replace(/庭院|宅院/g, '院子')
      .replace(/公司总部/g, '公司')
      .replace(/家中|家里/g, '家');
    variants.add(synonym);
    variants.add(synonym.replace(/^(?:家|老宅|住宅|公司|集团)(?=.{2,})/, ''));
    variants.add(synonym.replace(/(?:里面|内部|外面|区域|场景|之内|中|内|外)$/g, ''));
  } else if (type === 'character') {
    variants.add(identity.replace(/^(?:幼年|童年|少年|青年|中年|老年)/, ''));
    if (identity.length >= 3) variants.add(identity.replace(/^(?:小|老)/, ''));
    variants.add(identity.replace(/(?:先生|女士|小姐|老师|总|经理|主任)$/g, ''));
  } else {
    const withoutState = identity
      .replace(/^(?:完整|破碎|损坏|烧毁|沾血|修复后|打开|关闭|空的|装满的|泛黄|崭新|旧的)/, '')
      .replace(/(?:完整状态|破碎状态|损坏状态|烧毁状态|修复状态|打开状态|关闭状态|基准状态)$/g, '');
    variants.add(withoutState);
  }

  return Array.from(variants).filter(value => value.length >= 2);
}

function bigrams(value: string): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index < value.length - 1; index++) result.add(value.slice(index, index + 2));
  return result;
}

function getNameSimilarity(left: string, right: string, type: ReviewType): number {
  const leftVariants = comparisonVariants(left, type);
  const rightVariants = comparisonVariants(right, type);
  let best = 0;
  leftVariants.forEach(leftValue => {
    rightVariants.forEach(rightValue => {
      if (leftValue === rightValue) {
        best = Math.max(best, 100);
        return;
      }
      if (leftValue.includes(rightValue) || rightValue.includes(leftValue)) {
        const ratio = Math.min(leftValue.length, rightValue.length) / Math.max(leftValue.length, rightValue.length);
        best = Math.max(best, 68 + Math.round(ratio * 22));
      }
      const leftPairs = bigrams(leftValue);
      const rightPairs = bigrams(rightValue);
      if (leftPairs.size > 0 && rightPairs.size > 0) {
        const intersection = Array.from(leftPairs).filter(value => rightPairs.has(value)).length;
        const union = new Set([...leftPairs, ...rightPairs]).size;
        best = Math.max(best, Math.round((intersection / Math.max(1, union)) * 80));
      }
    });
  });
  return best;
}

function findScriptEvidence(content: string, names: string[]): string[] {
  const lines = content.split(/\r?\n/);
  const cleanNames = uniqueStrings(names).filter(name => name.length >= 2);
  const snippets: string[] = [];
  const seen = new Set<string>();

  lines.forEach((line, index) => {
    if (snippets.length >= 5 || !cleanNames.some(name => line.includes(name))) return;
    let start = Math.max(0, index - 2);
    for (let cursor = index - 1; cursor >= Math.max(0, index - 12); cursor--) {
      if (/第\s*[一二两三四五六七八九十百千万\d]+\s*集|\d+\s*[-—]\s*\d+/.test(lines[cursor])) {
        start = cursor;
        break;
      }
    }
    const snippet = lines.slice(start, Math.min(lines.length, index + 3))
      .map(cleanText)
      .filter(Boolean)
      .join(' / ')
      .slice(0, 700);
    const identity = normalizeIdentity(snippet);
    if (!identity || seen.has(identity)) return;
    seen.add(identity);
    snippets.push(snippet);
  });
  return snippets;
}

function buildCandidates(items: EntitySummary[], type: ReviewType, content: string): CandidatePair[] {
  const candidates: CandidatePair[] = [];
  for (let leftIndex = 0; leftIndex < items.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex++) {
      const left = items[leftIndex];
      const right = items[rightIndex];
      const nameScore = getNameSimilarity(left.name, right.name, type);
      const commonEpisodes = left.episodeNumbers.filter(number => right.episodeNumbers.includes(number));
      const episodeScore = commonEpisodes.length > 0 ? Math.min(16, 8 + commonEpisodes.length * 2) : 0;
      const occurrenceOverlap = left.occurrences.some(leftOccurrence => (
        right.occurrences.some(rightOccurrence => {
          const leftIdentity = normalizeIdentity(leftOccurrence);
          const rightIdentity = normalizeIdentity(rightOccurrence);
          return leftIdentity && rightIdentity && (
            leftIdentity === rightIdentity || leftIdentity.includes(rightIdentity) || rightIdentity.includes(leftIdentity)
          );
        })
      )) ? 10 : 0;
      const score = nameScore + episodeScore + occurrenceOverlap;
      if (nameScore < 68 || score < 76) continue;
      candidates.push({
        id: `${type}-${candidates.length + 1}`,
        type,
        left,
        right,
        score,
        commonEpisodes,
        scriptEvidence: findScriptEvidence(content, [left.name, right.name, ...left.aliases, ...right.aliases]),
      });
    }
  }
  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES_PER_TYPE)
    .map((candidate, index) => ({ ...candidate, id: `${type}-${index + 1}` }));
}

function formatCandidate(candidate: CandidatePair): string {
  const evidence = uniqueStrings(
    candidate.left.occurrences,
    candidate.right.occurrences,
    candidate.scriptEvidence
  ).slice(0, 8);
  return [
    `候选编号：${candidate.id}`,
    `左项：${candidate.left.name}`,
    `右项：${candidate.right.name}`,
    `共同集数：${candidate.commonEpisodes.length > 0 ? candidate.commonEpisodes.join('、') : '无明确共同集数'}`,
    `左项摘要：${candidate.left.descriptions.join('；').slice(0, 500) || '无'}`,
    `右项摘要：${candidate.right.descriptions.join('；').slice(0, 500) || '无'}`,
    `剧本与场次证据：${evidence.join('；').slice(0, 1800) || '无明确摘录'}`,
  ].join('\n');
}

function getTypeReviewRules(type: ReviewType): string {
  if (type === 'scene') {
    return `场景核验标准：只有指向同一个可复用的物理空间时才合并。名称里“内/外/中/区域”等词不同但剧本实际仍是同一个院落、房间或地点，可合并；如果一个是院内、另一个明确是院门外街道，或属于相邻但需要独立布景的空间，不得合并。日夜、年代或重大持久改造属于同一主场景的不同状态，不是两个主场景。`;
  }
  if (type === 'character') {
    return `人物核验标准：只有同一剧情人物的本名、昵称、小名、幼年称呼、职务称呼等才合并。年龄时期、服装或身体状态应成为同一人物的造型变化；同姓、同职务或关系相近的不同人物不得合并。`;
  }
  return `道具核验标准：只有同一件具体道具的别称，或同一道具的完整、破损、修复等剧情状态才合并。同类但剧本明确为不同件、不同归属或同时存在的物品不得合并；状态变化应保留为同一主道具下的独立制作状态。`;
}

async function reviewCandidateBatch(candidates: CandidatePair[]): Promise<ConfirmedDecision[]> {
  if (candidates.length === 0) return [];
  const type = candidates[0].type;
  const messages = [
    {
      role: 'system' as const,
      content: `你是影视制作资产核验师。你必须回看候选项的剧本/场次证据，判断是否被重复提取。
${getTypeReviewRules(type)}

严格规则：
1. 宁可保留两个不确定项目，也不要误合并。
2. 只有证据足以确认是同一实体时，duplicate 才能为 true。
3. canonicalName 必须从 left 或 right 中二选一，优先选择能稳定代表物理空间/人物/道具、且不含临时状态的名称。
4. 不要因为出现在同一集、描述相似或属于同一类别就直接判定重复。
5. 每个候选编号都必须返回一条判断。

只输出 JSON：
{
  "decisions": [
    {
      "candidateId": "scene-1",
      "duplicate": true,
      "canonicalName": "保留名称",
      "reason": "结合剧本证据说明为什么是或不是同一实体"
    }
  ]
}`,
    },
    {
      role: 'user' as const,
      content: candidates.map(formatCandidate).join('\n\n---\n\n'),
    },
  ];

  const response = await oaiInvoke(messages, {
    temperature: 0.05,
    maxTokens: 8192,
    timeout: 180_000,
    billingLabel: '人物场景道具重复核验',
  });
  const parsed = tryExtractAndFixJSON(response);
  const rawDecisions = Array.isArray(parsed?.decisions)
    ? parsed.decisions
    : Array.isArray(parsed)
      ? parsed
      : [];
  const candidateMap = new Map(candidates.map(candidate => [candidate.id, candidate]));
  return rawDecisions.flatMap((decision: UnknownRecord) => {
    const candidateId = cleanText(decision?.candidateId || decision?.id);
    const candidate = candidateMap.get(candidateId);
    const duplicate = decision?.duplicate === true || /^(?:true|yes|merge|重复|合并)$/i.test(cleanText(decision?.duplicate || decision?.decision));
    if (!candidate || !duplicate) return [];
    const requestedCanonical = cleanText(decision?.canonicalName);
    const canonicalName = [candidate.left.name, candidate.right.name].find(name => (
      normalizeIdentity(name) === normalizeIdentity(requestedCanonical)
    )) || candidate.left.name;
    return [{
      candidateId,
      type: candidate.type,
      left: candidate.left.name,
      right: candidate.right.name,
      canonicalName,
      reason: cleanText(decision?.reason) || '剧本证据确认两项指向同一实体',
    }];
  });
}

function createMergeGroups(
  items: EntitySummary[],
  type: ReviewType,
  decisions: ConfirmedDecision[]
): MergeGroup[] {
  const names = items.map(item => item.name);
  const parent = new Map(names.map(name => [normalizeIdentity(name), normalizeIdentity(name)]));
  const display = new Map(names.map(name => [normalizeIdentity(name), name]));
  const find = (identity: string): string => {
    const current = parent.get(identity) || identity;
    if (current === identity) return identity;
    const root = find(current);
    parent.set(identity, root);
    return root;
  };
  const union = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };

  decisions.filter(decision => decision.type === type).forEach(decision => {
    const left = normalizeIdentity(decision.left);
    const right = normalizeIdentity(decision.right);
    if (parent.has(left) && parent.has(right)) union(left, right);
  });

  const components = new Map<string, string[]>();
  names.forEach(name => {
    const root = find(normalizeIdentity(name));
    components.set(root, [...(components.get(root) || []), name]);
  });

  return Array.from(components.values()).flatMap(componentNames => {
    if (componentNames.length < 2) return [];
    const componentIdentities = new Set(componentNames.map(normalizeIdentity));
    const componentDecisions = decisions.filter(decision => (
      decision.type === type &&
      componentIdentities.has(normalizeIdentity(decision.left)) &&
      componentIdentities.has(normalizeIdentity(decision.right))
    ));
    const canonicalVotes = new Map<string, number>();
    componentDecisions.forEach(decision => {
      const identity = normalizeIdentity(decision.canonicalName);
      canonicalVotes.set(identity, (canonicalVotes.get(identity) || 0) + 1);
    });
    const canonicalIdentity = Array.from(canonicalVotes.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0]
      || normalizeIdentity(componentNames[0]);
    const canonicalName = display.get(canonicalIdentity) || componentNames[0];
    return [{
      type,
      canonicalName,
      aliases: componentNames,
      reason: uniqueStrings(componentDecisions.map(decision => decision.reason)).join('；'),
    }];
  });
}

function groupAliasMap(groups: MergeGroup[]): Map<string, string> {
  const result = new Map<string, string>();
  groups.forEach(group => group.aliases.forEach(alias => result.set(normalizeIdentity(alias), group.canonicalName)));
  return result;
}

function mergeScenes(scenes: UnknownRecord[], groups: MergeGroup[]) {
  const mainAliases = groupAliasMap(groups);
  const prepared = scenes.map(scene => {
    const currentMain = getSceneMainLocation(scene) || cleanText(scene?.name);
    const canonicalName = mainAliases.get(normalizeIdentity(currentMain));
    if (!canonicalName) return scene;
    const group = groups.find(item => item.canonicalName === canonicalName);
    return {
      ...scene,
      mainSceneName: canonicalName,
      physicalLocation: canonicalName,
      aliases: uniqueStrings(scene?.aliases, group?.aliases),
    };
  });
  const normalized = normalizeSceneStateUnits(prepared);
  const scenesWithAliases = normalized.scenes.map(scene => {
    const group = groups.find(item => normalizeIdentity(item.canonicalName) === normalizeIdentity(getSceneMainLocation(scene)));
    return group ? { ...scene, aliases: uniqueStrings(scene?.aliases, group.aliases) } : scene;
  });
  return {
    scenes: scenesWithAliases,
    aliases: normalized.aliases,
  };
}

function mergeCharacterLooks(records: UnknownRecord[]): UnknownRecord[] {
  const merged: UnknownRecord[] = [];
  const usedIds = new Set<string>();
  records.flatMap(record => Array.isArray(record?.looks) ? record.looks : []).forEach((look: UnknownRecord) => {
    const key = [
      look?.changeType,
      look?.ageStage,
      look?.physicalState,
      look?.transformationState,
      look?.scene,
      look?.stage,
    ].map(normalizeIdentity).join('::');
    const existing = merged.find(item => item.__mergeKey === key && key.replace(/:/g, ''));
    if (existing) {
      existing.description = chooseUsefulText(existing.description, look?.description);
      existing.costume = chooseUsefulText(existing.costume, look?.costume);
      existing.hairstyle = chooseUsefulText(existing.hairstyle, look?.hairstyle);
      existing.accessories = uniqueStrings(existing.accessories, look?.accessories);
      existing.episodeNumbers = cleanNumbers(existing.episodeNumbers, look?.episodeNumbers);
      existing.sceneNames = uniqueStrings(existing.sceneNames, look?.sceneNames);
      existing.sourceEvidence = chooseUsefulText(existing.sourceEvidence, look?.sourceEvidence);
      existing.imageUrl = existing.imageUrl || look?.imageUrl;
      existing.fourViewImageUrl = existing.fourViewImageUrl || look?.fourViewImageUrl;
      return;
    }
    let id = cleanText(look?.id) || `look-${merged.length + 1}`;
    if (usedIds.has(id)) id = `${id}-merged-${merged.length + 1}`;
    usedIds.add(id);
    merged.push({ ...look, id, __mergeKey: key });
  });
  return merged.map(look => {
    const result = { ...look };
    Reflect.deleteProperty(result, '__mergeKey');
    return result;
  });
}

function mergeCharacters(characters: UnknownRecord[], groups: MergeGroup[]) {
  const aliases = groupAliasMap(groups);
  const handled = new Set<string>();
  const mergedCharacters: UnknownRecord[] = [];
  const assetAliases: Record<string, string> = {};

  characters.forEach(character => {
    const identity = normalizeIdentity(character?.name);
    const canonicalName = aliases.get(identity);
    if (!canonicalName) {
      mergedCharacters.push(character);
      return;
    }
    const canonicalIdentity = normalizeIdentity(canonicalName);
    if (handled.has(canonicalIdentity)) return;
    handled.add(canonicalIdentity);
    const group = groups.find(item => normalizeIdentity(item.canonicalName) === canonicalIdentity);
    const records = characters.filter(item => group?.aliases.some(alias => normalizeIdentity(alias) === normalizeIdentity(item?.name)));
    const base = records.find(item => normalizeIdentity(item?.name) === canonicalIdentity) || records[0];
    const merged: UnknownRecord = { ...base, name: canonicalName, aliases: uniqueStrings(group?.aliases, ...records.map(item => item?.aliases)) };
    merged.role = chooseUsefulText(...records.map(item => item?.role));
    merged.age = chooseUsefulText(...records.map(item => item?.age));
    merged.gender = chooseUsefulText(...records.map(item => item?.gender));
    merged.appearance = chooseUsefulText(...records.map(item => item?.appearance));
    merged.background = chooseUsefulText(...records.map(item => item?.background));
    merged.arc = chooseUsefulText(...records.map(item => item?.arc));
    merged.personality = uniqueStrings(...records.map(item => item?.personality));
    merged.keyScenes = uniqueStrings(...records.map(item => item?.keyScenes));
    merged.props = uniqueStrings(...records.map(item => item?.props));
    merged.costume = uniqueStrings(...records.map(item => item?.costume));
    merged.keyRelationships = records.flatMap(item => Array.isArray(item?.keyRelationships) ? item.keyRelationships : [])
      .filter((relationship, index, list) => list.findIndex(other => (
        normalizeIdentity(other?.target) === normalizeIdentity(relationship?.target) &&
        normalizeIdentity(other?.relationship) === normalizeIdentity(relationship?.relationship)
      )) === index);
    merged.looks = mergeCharacterLooks(records);
    merged.faceFeatures = records.reduce((result, item) => ({
      ...result,
      ...Object.fromEntries(Object.entries(item?.faceFeatures || {}).filter(([, value]) => cleanText(value))),
    }), {});
    merged.bodyProfile = records.reduce((result, item) => ({
      ...result,
      ...Object.fromEntries(Object.entries(item?.bodyProfile || {}).filter(([, value]) => cleanText(value))),
    }), {});
    const confirmedRecord = records.find(item => item?.identityImageConfirmed && cleanText(item?.confirmedFaceImageUrl));
    if (confirmedRecord) {
      merged.identityImageConfirmed = true;
      merged.confirmedFaceImageUrl = confirmedRecord.confirmedFaceImageUrl;
      merged.identityConfirmedAt = confirmedRecord.identityConfirmedAt;
    }
    records.forEach(item => {
      const oldName = cleanText(item?.name);
      if (oldName && oldName !== canonicalName) assetAliases[oldName] = canonicalName;
    });
    mergedCharacters.push(merged);
  });

  return { characters: mergedCharacters, aliases: assetAliases };
}

function mergeOccurrences(...values: unknown[]): UnknownRecord[] {
  const seen = new Set<string>();
  return values.flatMap(value => Array.isArray(value) ? value : []).filter(item => {
    const key = [
      item?.episodeNumber || item?.episodeLabel,
      item?.heading || item?.sceneName,
      item?.stateLabel,
    ].map(normalizeIdentity).join('::');
    if (!key.replace(/:/g, '') || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeProps(props: UnknownRecord[], groups: MergeGroup[]) {
  const aliases = groupAliasMap(groups);
  const affectedCanonicalNames = new Set(groups.map(group => normalizeIdentity(group.canonicalName)));
  const unaffected = props.filter(prop => !aliases.has(normalizeIdentity(prop?.mainPropName || prop?.sourcePropName || prop?.name)));
  const mergedAffected: UnknownRecord[] = [];
  const assetAliases: Record<string, string> = {};

  groups.forEach(group => {
    const records = props.filter(prop => group.aliases.some(alias => (
      normalizeIdentity(alias) === normalizeIdentity(prop?.mainPropName || prop?.sourcePropName || prop?.name)
    )));
    const stateGroups = new Map<string, UnknownRecord[]>();
    records.forEach(record => {
      const stateLabel = cleanText(record?.stateLabel || record?.stateVariants?.[0]?.stateName || '基准状态');
      const stateIdentity = normalizeIdentity(stateLabel.replace(/状态/g, '')) || 'baseline';
      stateGroups.set(stateIdentity, [...(stateGroups.get(stateIdentity) || []), record]);
    });
    const multipleStates = stateGroups.size > 1;
    const targetNames = new Map<string, string>();

    Array.from(stateGroups.entries()).forEach(([stateIdentity, stateRecords]) => {
      const base = stateRecords.find(item => normalizeIdentity(item?.mainPropName) === normalizeIdentity(group.canonicalName)) || stateRecords[0];
      const stateLabel = chooseUsefulText(...stateRecords.map(item => item?.stateLabel)) || '基准状态';
      const targetName = multipleStates || records.some(item => /[（(]/.test(cleanText(item?.name)))
        ? `${group.canonicalName}（${stateLabel}）`
        : group.canonicalName;
      targetNames.set(stateIdentity, targetName);
      const merged: UnknownRecord = {
        ...base,
        name: targetName,
        mainPropName: group.canonicalName,
        sourcePropName: group.canonicalName,
        aliases: uniqueStrings(group.aliases, ...stateRecords.map(item => item?.aliases)),
        stateLabel,
        episodeNumbers: cleanNumbers(...stateRecords.map(item => getRecordEpisodes(item))),
        occurrences: mergeOccurrences(...stateRecords.map(item => item?.occurrences)),
        appearanceScenes: uniqueStrings(...stateRecords.map(item => item?.appearanceScenes)),
        description: chooseUsefulText(...stateRecords.map(item => item?.description)),
        visualDescription: chooseUsefulText(...stateRecords.map(item => item?.visualDescription)),
        function: chooseUsefulText(...stateRecords.map(item => item?.function)),
        stateVisualChange: chooseUsefulText(...stateRecords.map(item => item?.stateVisualChange)),
        stateTransitionEvent: chooseUsefulText(...stateRecords.map(item => item?.stateTransitionEvent)),
        stateNarrativeFunction: chooseUsefulText(...stateRecords.map(item => item?.stateNarrativeFunction)),
        stateEvidence: chooseUsefulText(...stateRecords.map(item => item?.stateEvidence)),
        stateVariants: stateRecords.flatMap(item => Array.isArray(item?.stateVariants) ? item.stateVariants : []),
      };
      stateRecords.forEach(item => {
        const oldName = cleanText(item?.name);
        if (oldName && oldName !== targetName) assetAliases[oldName] = targetName;
      });
      mergedAffected.push(merged);
    });
  });

  const combined: UnknownRecord[] = ([...unaffected, ...mergedAffected] as UnknownRecord[])
    .sort((a, b) => Number(a?.id || 0) - Number(b?.id || 0))
    .map((prop: UnknownRecord): UnknownRecord => ({
      ...prop,
      referencePropName: assetAliases[cleanText(prop?.referencePropName)] || prop?.referencePropName,
    }));

  return {
    props: combined,
    aliases: assetAliases,
    affectedCanonicalNames: Array.from(affectedCanonicalNames),
  };
}

type LifecycleRepairSummary = {
  requiredCount: number;
  coveredBeforeRepair: number;
  repairedByModel: number;
  fallbackAdded: number;
  unresolvedCount: number;
  affectedCharacters: string[];
};

function getCharacterBaseLook(character: UnknownRecord): UnknownRecord {
  const looks = Array.isArray(character?.looks) ? character.looks : [];
  return looks.find((look: UnknownRecord) => look?.isBaseLook || look?.changeType === '基础造型') || looks[0] || {
    id: 'look-1',
    scene: '默认造型',
    stage: '主要叙事时期',
    description: `${cleanText(character?.name) || '该人物'}主要叙事时期的正常状态基础造型`,
    costume: '符合人物身份、时代背景与主要场景的基础服装',
    hairstyle: '保持人物辨识度的基础发型',
    accessories: [],
    makeup: '自然妆造',
    mood: '自然',
    changeType: '基础造型',
    ageStage: cleanText(character?.age) || '主要时期',
    physicalState: '正常状态',
    transformationState: '',
    episodeNumbers: [],
    sceneNames: ['默认造型'],
    sourceEvidence: '',
    referenceLookId: '',
    referenceReason: '直接参考已确认的人物正脸身份基准图',
    isBaseLook: true,
    generationPriority: 1,
  };
}

function normalizeCharacterLookTimelines(characters: UnknownRecord[]): UnknownRecord[] {
  return characters.map(character => {
    const bodyProfile = normalizeCharacterBodyProfile(character?.bodyProfile, character?.appearance);
    const looks = normalizeCharacterLooks(
      Array.isArray(character?.looks) ? character.looks : [],
      getCharacterBaseLook(character),
      cleanText(character?.age)
    );
    return {
      ...character,
      bodyProfile,
      looks: inheritBodyProfileForLooks(looks, bodyProfile),
    };
  });
}

type CharacterSemanticRepairSummary = {
  checkedCount: number;
  genderCorrectedCount: number;
  creatureCorrectedCount: number;
  correctedCharacters: string[];
};

function repairCharacterSemantics(
  characters: UnknownRecord[],
  subjectRegion: string
): { characters: UnknownRecord[]; summary: CharacterSemanticRepairSummary } {
  const correctedCharacters: string[] = [];
  let genderCorrectedCount = 0;
  let creatureCorrectedCount = 0;

  const repaired = characters.map(character => {
    const name = cleanText(character?.name) || '该人物';
    const entityKind = inferCharacterEntityKind(character);
    const previousGender = normalizeCharacterGender(character?.gender);
    const gender = resolveCharacterGenderByPolicy({
      name,
      currentGender: character?.gender,
      character,
    });
    const genderWasCorrected = previousGender !== gender;
    const isAnimalCreature = entityKind === 'animal-creature';
    if (genderWasCorrected) genderCorrectedCount += 1;

    let appearance = cleanText(character?.appearance);
    let faceFeatures = { ...(character?.faceFeatures || {}) };
    let looks = Array.isArray(character?.looks) ? character.looks.map((look: UnknownRecord) => ({ ...look })) : [];

    if (isAnimalCreature) {
      const appearanceIsHumanTemplate = /女性角色|男性角色|人类皮肤|面部线条柔和|眉眼灵动|人类发型|披发|马尾/.test(appearance);
      if (appearanceIsHumanTemplate || !/犬|狼|兽|动物|吻部|皮毛|兽毛|四足|爪|獠牙/.test(appearance)) {
        appearance = `${name}是动物特征占主导的奇幻生物。头骨、吻部、兽耳、眼睛、鼻头、牙齿和皮毛符合剧本物种设定，毛发顺应动物头骨与身体结构生长；不使用人类皮肤、人类五官比例、女性长发、披发、马尾或其他人类发型。`;
        creatureCorrectedCount += 1;
      }
      faceFeatures = {
        faceShape: cleanText(faceFeatures?.faceShape) && /犬|狼|兽|吻部/.test(cleanText(faceFeatures?.faceShape)) ? faceFeatures.faceShape : '符合物种的动物头骨与吻部轮廓，动物特征占主导',
        eyes: cleanText(faceFeatures?.eyes) || '符合剧情设定的兽类眼睛，目光与情绪清晰',
        nose: cleanText(faceFeatures?.nose) && /鼻头|吻部|兽/.test(cleanText(faceFeatures?.nose)) ? faceFeatures.nose : '动物鼻头与吻部结构清楚，不使用人类鼻型',
        mouth: cleanText(faceFeatures?.mouth) && /牙|口吻|兽|犬|狼/.test(cleanText(faceFeatures?.mouth)) ? faceFeatures.mouth : '兽类口吻与牙齿结构，不使用人类唇形',
        skinTone: cleanText(faceFeatures?.skinTone) && /毛|鳞|兽/.test(cleanText(faceFeatures?.skinTone)) ? faceFeatures.skinTone : '符合物种设定的皮毛、鳞片或兽类表面材质',
      };
      looks = looks.map((look: UnknownRecord) => ({
        ...look,
        costume: !cleanText(look?.costume) || /生活装|职业装|商务装/.test(cleanText(look?.costume))
          ? '无；除非剧本明确要求护甲、项圈或装饰'
          : look.costume,
        hairstyle: !cleanText(look?.hairstyle) || /披发|马尾|盘发|人类发型/.test(cleanText(look?.hairstyle))
          ? '毛发顺应动物头骨与身体结构生长，不使用任何人类发型'
          : look.hairstyle,
        makeup: !cleanText(look?.makeup) || /淡妆|浓妆|修饰/.test(cleanText(look?.makeup))
          ? '无；保持动物面部与皮毛自然材质'
          : look.makeup,
      }));
    } else if (genderWasCorrected) {
      const specificPrefix = appearance.split(new RegExp(`${name}是`))[0].replace(/[，。；;\s]+$/, '');
      const facialStyle = gender === '男'
        ? '发型干净利落，面部轮廓清晰稳定，眉眼有辨识度，鼻唇比例自然'
        : '发型轮廓自然清晰，面部线条柔和但有辨识度，眼神灵动，鼻唇比例协调';
      appearance = `${specificPrefix ? `${specificPrefix}。` : ''}${name}是${cleanText(character?.age) || '成年'}的${gender}性角色。${facialStyle}，肤色均匀，皮肤清爽并保留自然纹理。`;
      const usesFemaleDefaults = /鹅蛋脸或柔和椭圆脸/.test(cleanText(faceFeatures?.faceShape));
      const usesMaleDefaults = /椭圆脸或方中带圆/.test(cleanText(faceFeatures?.faceShape));
      if ((gender === '男' && usesFemaleDefaults) || (gender === '女' && usesMaleDefaults)) {
        faceFeatures = gender === '男'
          ? {
              faceShape: '椭圆脸或方中带圆的脸型，轮廓稳定',
              eyes: '眼神专注，眉眼有辨识度',
              nose: '鼻梁自然端正，符合人物身份与族裔特征',
              mouth: '唇线清楚，表情克制有力度',
              skinTone: '肤色均匀，保留自然皮肤质感',
            }
          : {
              faceShape: '鹅蛋脸或柔和椭圆脸，轮廓自然清晰',
              eyes: '眼型清晰有神，情绪表达明显',
              nose: '鼻梁自然端正，符合人物身份与族裔特征',
              mouth: '唇形自然，表情变化细腻',
              skinTone: '肤色均匀，保留自然皮肤质感',
            };
      }
      looks = looks.map((look: UnknownRecord) => gender === '男' ? {
        ...look,
        costume: /简洁生活装或职业装/.test(cleanText(look?.costume)) ? '简洁日常装或商务装，剪裁利落，贴合人物身份' : look.costume,
        hairstyle: /自然披发|低马尾|盘发/.test(cleanText(look?.hairstyle)) ? '干净短发或自然整理发型' : look.hairstyle,
        makeup: /自然淡妆|精致妆容/.test(cleanText(look?.makeup)) ? '自然无妆或轻微修饰' : look.makeup,
      } : look);
    }

    if (genderWasCorrected || isAnimalCreature) correctedCharacters.push(name);
    return {
      ...character,
      gender,
      appearance,
      faceFeatures,
      looks,
      entityKind,
      semanticAudit: {
        status: 'complete',
        gender,
        genderCorrected: genderWasCorrected,
        entityKind,
        subjectRegion: subjectRegion || '',
        checkedAt: Date.now(),
      },
    };
  });

  return {
    characters: repaired,
    summary: {
      checkedCount: characters.length,
      genderCorrectedCount,
      creatureCorrectedCount,
      correctedCharacters: Array.from(new Set(correctedCharacters)),
    },
  };
}

function buildLifecycleFallbackLook(
  character: UnknownRecord,
  requirement: CharacterLifecycleRequirement,
  index: number
): UnknownRecord {
  const baseLook = getCharacterBaseLook(character);
  const name = cleanText(character?.name) || requirement.characterName;
  const label = requirement.label || requirement.ageStage || requirement.physicalState || requirement.transformationState;
  const ageChange = requirement.changeType === '年龄时期' || requirement.changeType === '复合变化';
  const bodyChange = requirement.changeType === '身体状态' || requirement.changeType === '复合变化';
  return {
    id: `look-audit-${Date.now()}-${index + 1}`,
    scene: `${label}造型`,
    stage: label,
    description: `${name}在${label}剧情阶段的独立制作造型。严格依据关联集数与场次呈现该时期或状态，固定脸型、眼睛、鼻子、嘴巴、肤色及核心辨识特征与人物正脸保持一致。`,
    costume: '优先采用剧本在关联场次中明确写出的服装；原文未写明时，仅使用符合人物身份、创作圣经、年代与场景的服装，不虚构关键款式。',
    hairstyle: ageChange
      ? `保持核心发型辨识特征，并按${label}调整发量、发色和年龄质感`
      : cleanText(baseLook?.hairstyle) || '保持人物固定发型辨识特征',
    accessories: [],
    makeup: bodyChange ? `按${requirement.physicalState || label}呈现必要状态妆效` : '符合该时期的自然妆造',
    mood: '符合关联剧情',
    continuityNote: `由全文自动核验补齐；适用于${requirement.episodeNumbers.map(value => `第${value}集`).join('、') || '关联场次'}`,
    changeType: requirement.changeType,
    ageStage: requirement.ageStage || cleanText(character?.age) || '主要时期',
    physicalState: requirement.physicalState || '正常状态',
    transformationState: requirement.transformationState || '',
    bodyProfile: normalizeCharacterBodyProfile(character?.bodyProfile, character?.appearance),
    bodyChanges: ageChange
      ? `按${label}调整年龄感、体态成熟度与皮肤年龄特征，不改变人物身份`
      : bodyChange
        ? `按${requirement.physicalState || label}呈现剧情明确的身体状态变化`
        : '',
    episodeNumbers: requirement.episodeNumbers,
    sceneNames: requirement.sceneNames,
    sourceEvidence: requirement.sourceEvidence,
    referenceLookId: cleanText(baseLook?.id),
    referenceReason: `从主要时期基础造型推进到${label}，保持同一人物身份`,
    isBaseLook: false,
    generationPriority: requirement.changeType === '年龄时期' ? 2 : requirement.changeType === '身体状态' ? 4 : 5,
    isLifecycleFallback: true,
  };
}

function attachCharacterTimelineAudit(
  characters: UnknownRecord[],
  requirements: CharacterLifecycleRequirement[],
  modelAddedByName: Map<string, number>,
  fallbackAddedByName: Map<string, number>
): UnknownRecord[] {
  const auditedAt = Date.now();
  return characters.map(character => {
    const characterRequirements = requirements.filter(requirement => (
      normalizeIdentity(requirement.characterName) === normalizeIdentity(character?.name)
    ));
    const audit = auditCharacterLifecycleLooks([character], characterRequirements);
    return {
      ...character,
      timelineAudit: {
        status: audit.missingCount === 0 ? 'complete' : 'needs-review',
        requiredCount: audit.requiredCount,
        coveredCount: audit.coveredCount,
        modelAddedCount: modelAddedByName.get(normalizeIdentity(character?.name)) || 0,
        fallbackAddedCount: fallbackAddedByName.get(normalizeIdentity(character?.name)) || 0,
        missingLabels: audit.missing.map(item => item.label),
        auditedAt,
      },
    };
  });
}

async function repairCharacterLifecycleLooks(
  content: string,
  characters: UnknownRecord[]
): Promise<{ characters: UnknownRecord[]; summary: LifecycleRepairSummary }> {
  const requirements = buildCharacterLifecycleRequirements(content, characters);
  const beforeAudit = auditCharacterLifecycleLooks(characters, requirements);
  const affectedCharacters = Array.from(new Set(beforeAudit.missing.map(item => item.characterName)));
  const modelAddedByName = new Map<string, number>();
  const fallbackAddedByName = new Map<string, number>();

  if (beforeAudit.missingCount === 0) {
    return {
      characters: attachCharacterTimelineAudit(characters, requirements, modelAddedByName, fallbackAddedByName),
      summary: {
        requiredCount: beforeAudit.requiredCount,
        coveredBeforeRepair: beforeAudit.coveredCount,
        repairedByModel: 0,
        fallbackAdded: 0,
        unresolvedCount: 0,
        affectedCharacters: [],
      },
    };
  }

  let repairedCharacters = characters;
  try {
    const affectedRecords = characters.filter(character => affectedCharacters.some(name => (
      normalizeIdentity(name) === normalizeIdentity(character?.name)
    )));
    const messages = [
      {
        role: 'system' as const,
        content: `你是影视人物造型时间线补全师。程序已通读全文并检测出人物 looks 的明确漏项，你只补齐缺失造型，不重写人物资料，也不重复现有造型。

规则：
1. 每条缺失证据都必须被某个新增 looks 项覆盖；同一人物同一视觉时期的多集证据应合并为一套造型，并合并 episodeNumbers、sceneNames 和 sourceEvidence。
2. “1998年”和“十五年前/15年前”若剧本证明为同一时期，只生成一套较年轻时期造型。
3. 五年后、童年、青年、中年、老年、受伤、怀孕、病弱、虚弱、变身等真正影响画面的时期或状态必须独立；普通情绪、短动作、同场临时变化不得另建造型。
4. 不改人物姓名、性别、关系和固定脸型。年龄变化只调整年龄感、发色、皱纹、体态成熟度；必须保持同一人物可识别。
5. 服装有原文证据就按原文，没有就写符合人物身份、创作圣经、年代和场景的保守造型，不要虚构剧情关键服饰。
6. 每项必须填写 changeType、ageStage、physicalState、transformationState、episodeNumbers、sceneNames、sourceEvidence、referenceLookId、referenceReason。
7. 只返回 JSON：{"characters":[{"name":"人物名","looks":[新增造型]}]}。`,
      },
      {
        role: 'user' as const,
        content: `【程序检测到的缺失清单】\n${formatCharacterLifecycleChecklist(beforeAudit.missing)}\n\n【受影响人物的现有资料与造型】\n${JSON.stringify(affectedRecords.map(character => ({
          name: character?.name,
          age: character?.age,
          gender: character?.gender,
          role: character?.role,
          faceFeatures: character?.faceFeatures,
          bodyProfile: character?.bodyProfile,
          existingLooks: Array.isArray(character?.looks) ? character.looks.map((look: UnknownRecord) => ({
            id: look?.id,
            scene: look?.scene,
            stage: look?.stage,
            changeType: look?.changeType,
            ageStage: look?.ageStage,
            physicalState: look?.physicalState,
            transformationState: look?.transformationState,
            episodeNumbers: look?.episodeNumbers,
            sceneNames: look?.sceneNames,
            sourceEvidence: look?.sourceEvidence,
          })) : [],
        })), null, 2)}`,
      },
    ];
    const response = await oaiInvoke(messages, {
      temperature: 0.1,
      maxTokens: 16384,
      timeout: 240_000,
      billingLabel: '人物造型时间线缺项补全',
    });
    const parsed = tryExtractAndFixJSON(response);
    const additions = Array.isArray(parsed?.characters)
      ? parsed.characters
      : Array.isArray(parsed)
        ? parsed
        : [];
    repairedCharacters = characters.map(character => {
      const addition = additions.find((item: UnknownRecord) => (
        normalizeIdentity(item?.name) === normalizeIdentity(character?.name)
      ));
      const addedLooks = Array.isArray(addition?.looks) ? addition.looks : [];
      if (addedLooks.length === 0) return character;
      const baseLook = getCharacterBaseLook(character);
      const bodyProfile = normalizeCharacterBodyProfile(character?.bodyProfile, character?.appearance);
      modelAddedByName.set(normalizeIdentity(character?.name), addedLooks.length);
      return {
        ...character,
        looks: inheritBodyProfileForLooks(
          normalizeCharacterLooks([
            ...(Array.isArray(character?.looks) ? character.looks : []),
            ...addedLooks,
          ], baseLook, cleanText(character?.age)),
          bodyProfile
        ),
      };
    });
  } catch (error: any) {
    console.warn('[人物造型时间线核验] 模型补全失败，将使用受控兜底:', error?.message || error);
  }

  const afterModelAudit = auditCharacterLifecycleLooks(repairedCharacters, requirements);
  if (afterModelAudit.missingCount > 0) {
    repairedCharacters = repairedCharacters.map(character => {
      const missing = afterModelAudit.missing.filter(requirement => (
        normalizeIdentity(requirement.characterName) === normalizeIdentity(character?.name)
      ));
      if (missing.length === 0) return character;
      const baseLook = getCharacterBaseLook(character);
      const bodyProfile = normalizeCharacterBodyProfile(character?.bodyProfile, character?.appearance);
      fallbackAddedByName.set(normalizeIdentity(character?.name), missing.length);
      return {
        ...character,
        looks: inheritBodyProfileForLooks(
          normalizeCharacterLooks([
            ...(Array.isArray(character?.looks) ? character.looks : []),
            ...missing.map((requirement, index) => buildLifecycleFallbackLook(character, requirement, index)),
          ], baseLook, cleanText(character?.age)),
          bodyProfile
        ),
      };
    });
  }

  const finalAudit = auditCharacterLifecycleLooks(repairedCharacters, requirements);
  const repairedByModel = Math.max(0, afterModelAudit.coveredCount - beforeAudit.coveredCount);
  const fallbackAdded = Array.from(fallbackAddedByName.values()).reduce((sum, value) => sum + value, 0);
  return {
    characters: attachCharacterTimelineAudit(repairedCharacters, requirements, modelAddedByName, fallbackAddedByName),
    summary: {
      requiredCount: beforeAudit.requiredCount,
      coveredBeforeRepair: beforeAudit.coveredCount,
      repairedByModel,
      fallbackAdded,
      unresolvedCount: finalAudit.missingCount,
      affectedCharacters,
    },
  };
}

export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const content = typeof body?.content === 'string' ? body.content.trim() : '';
    const sourceType = cleanText(body?.sourceType);
    const scenes = Array.isArray(body?.scenes) ? body.scenes.filter(Boolean) : [];
    const characters = Array.isArray(body?.characters) ? body.characters.filter(Boolean) : [];
    const props = Array.isArray(body?.props) ? body.props.filter(Boolean) : [];
    const subjectRegion = cleanText(body?.creationBible?.subjectRegion);
    if (!content) return NextResponse.json({ error: '缺少用于核验的剧本内容' }, { status: 400 });
    if (sourceType !== 'execution-script') {
      return NextResponse.json({ error: '质量核验只接受已确认的执行剧本' }, { status: 400 });
    }

    const summaries = {
      scene: buildSceneSummaries(scenes),
      character: buildCharacterSummaries(characters),
      prop: buildPropSummaries(props),
    };
    const candidatesByType = (['scene', 'character', 'prop'] as const).map(type => (
      buildCandidates(summaries[type], type, content)
    ));
    const candidates = candidatesByType.flat();
    const batches = candidatesByType.flatMap(typeCandidates => (
      Array.from({ length: Math.ceil(typeCandidates.length / REVIEW_BATCH_SIZE) }, (_, index) => (
        typeCandidates.slice(index * REVIEW_BATCH_SIZE, (index + 1) * REVIEW_BATCH_SIZE)
      ))
    ));
    const reviewed = await mapWithConcurrency(batches, 2, reviewCandidateBatch);
    const decisions = reviewed.flat();
    const groups = (['scene', 'character', 'prop'] as const).flatMap(type => (
      createMergeGroups(summaries[type], type, decisions)
    ));
    const sceneGroups = groups.filter(group => group.type === 'scene');
    const characterGroups = groups.filter(group => group.type === 'character');
    const propGroups = groups.filter(group => group.type === 'prop');

    const sceneResult = mergeScenes(scenes, sceneGroups);
    const characterResult = mergeCharacters(characters, characterGroups);
    const semanticResult = repairCharacterSemantics(characterResult.characters, subjectRegion);
    const normalizedCharacters = normalizeCharacterLookTimelines(semanticResult.characters);
    const lifecycleResult = await repairCharacterLifecycleLooks(content, normalizedCharacters);
    const propResult = mergeProps(props, propGroups);
    const sceneMainCount = new Set(sceneResult.scenes.map(scene => normalizeSceneLocationIdentity(getSceneMainLocation(scene)))).size;
    const propMainCount = new Set(propResult.props.map((prop: UnknownRecord) => normalizeIdentity(prop?.mainPropName || prop?.name))).size;

    return NextResponse.json({
      success: true,
      data: {
        scenes: sceneResult.scenes,
        characters: lifecycleResult.characters,
        props: propResult.props,
        totalMainScenes: sceneMainCount,
        totalCharacters: lifecycleResult.characters.length,
        totalMainProps: propMainCount,
        totalPropStates: propResult.props.length,
      },
      aliases: {
        scenes: sceneResult.aliases,
        characters: characterResult.aliases,
        props: propResult.aliases,
      },
      review: {
        candidateCount: candidates.length,
        reviewedCount: candidates.length,
        mergedGroupCount: groups.length,
        removedCount: {
          scenes: Math.max(0, scenes.length - sceneResult.scenes.length),
          characters: Math.max(0, characters.length - characterResult.characters.length),
          props: Math.max(0, props.length - propResult.props.length),
        },
        groups,
        semantic: semanticResult.summary,
        lifecycle: lifecycleResult.summary,
        reviewedAt: Date.now(),
      },
    });
  } catch (error: any) {
    console.error('[提取结果核验] 失败:', error);
    return NextResponse.json({
      error: '人物、场景、道具重复核验失败',
      details: error?.message || String(error),
    }, { status: 500 });
  }
}
