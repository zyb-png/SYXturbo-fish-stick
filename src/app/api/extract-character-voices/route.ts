import { NextRequest, NextResponse } from 'next/server';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import {
  MIN_DIALOGUE_LINES_FOR_VOICE_PROFILE,
  recommendVoicePresetId,
  type CharacterVoiceExtraction,
  type CharacterVoiceProfile,
  type CharacterVoiceVariant,
  type VoiceSpeakerCategory,
  type VoiceTraits,
  type VoiceVariantKind,
} from '@/lib/character-voice';
import { tryExtractAndFixJSON } from '@/lib/json-utils';
import { invoke as oaiInvoke, type LlmTokenUsage } from '@/lib/openai-client';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

interface DialogueOccurrence {
  sourceName: string;
  canonicalCandidate: string;
  episodeNumber: number | null;
  dialogue: string;
  dialogueType: string;
  stateHint: string;
  context: string;
}

interface KnownCharacter {
  id?: number;
  name?: string;
  aliases?: string[];
  age?: string;
  gender?: string;
  looks?: Array<{
    stage?: string;
    ageStage?: string;
    transformationState?: string;
    physicalState?: string;
    episodeNumbers?: number[];
  }>;
}

const BLOCKED_SPEAKERS = new Set([
  '人物', '角色', '场景', '地点', '时间', '画面', '镜头', '动作', '音效', '转场',
  '字幕', '剧情', '道具', '备注', '说明', '退货单内容', '短信内容', '文件内容', 'A版', 'B版',
]);

const AGE_STATE_PATTERN = /(婴儿|幼年|童年|儿童|少年|少女|青年|年轻时|中年|老年|年迈)/;
const TRANSFORMATION_PATTERN = /(变身|觉醒|魔化|妖化|兽化|黑化|附身|灵魂状态|机器人状态|机械化)/;
const SYSTEM_SPEAKER_PATTERN = /(系统|导航|智能助手|AI助手|自动语音|电子音|机器音|语音提示)/i;
const THIRD_PARTY_SPEAKER_PATTERN = /(第三方|旁白|解说|客服|接线员|广播|播报|主持人|记者|电话那头|电话声音|陌生人|路人|群众|店员|服务员)/;
const NON_CHARACTER_SPEAKER_PATTERN = new RegExp(`${SYSTEM_SPEAKER_PATTERN.source}|${THIRD_PARTY_SPEAKER_PATTERN.source}`, 'i');

function chineseNumberToInt(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = {
    零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9,
  };
  let total = 0;
  let current = 0;
  for (const char of value) {
    if (char === '百') {
      total += (current || 1) * 100;
      current = 0;
    } else if (char === '十') {
      total += (current || 1) * 10;
      current = 0;
    } else if (char in digits) {
      current = digits[char];
    }
  }
  return total + current;
}

function stableId(prefix: string, value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function cleanSpeaker(raw: string): { sourceName: string; canonicalCandidate: string; dialogueType: string; stateHint: string } | null {
  let value = raw.replace(/^[△▲●○\-—\s]+/, '').trim();
  if (!value || value.length > 28) return null;

  let dialogueType = '';
  const typeMatch = value.match(/(?:[（(]\s*(VO|OS|V\.O\.|O\.S\.)\s*[）)]|(VO|OS|V\.O\.|O\.S\.))$/i);
  if (typeMatch) {
    dialogueType = (typeMatch[1] || typeMatch[2] || '').toUpperCase();
    value = value.slice(0, typeMatch.index).trim();
  }

  const parenthetical = Array.from(value.matchAll(/[（(]([^）)]+)[）)]/g)).map(match => match[1]).join(' ');
  const prefixState = value.match(new RegExp(`^${AGE_STATE_PATTERN.source}|^${TRANSFORMATION_PATTERN.source}`))?.[0] || '';
  const stateHint = [parenthetical.match(AGE_STATE_PATTERN)?.[0], parenthetical.match(TRANSFORMATION_PATTERN)?.[0], prefixState]
    .filter(Boolean)
    .join('·');

  const sourceName = value.trim();
  let canonicalCandidate = value
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(new RegExp(`^${AGE_STATE_PATTERN.source}`), '')
    .replace(new RegExp(`^${TRANSFORMATION_PATTERN.source}`), '')
    .trim();

  if (!canonicalCandidate) canonicalCandidate = sourceName;
  if (
    BLOCKED_SPEAKERS.has(sourceName) ||
    BLOCKED_SPEAKERS.has(canonicalCandidate) ||
    /^(第.+集|\d+[\-—]\d+|内|外|日|夜)$/.test(sourceName) ||
    !/^[\p{Script=Han}A-Za-z0-9·\s]+$/u.test(canonicalCandidate)
  ) {
    return null;
  }

  return { sourceName, canonicalCandidate, dialogueType, stateHint };
}

function detectContextState(context: string, characterName: string): string {
  const lines = context.split('\n').map(line => line.trim()).filter(Boolean);
  const characterLines = lines.filter(line => line.includes(characterName));
  for (const line of characterLines) {
    const state = line.match(TRANSFORMATION_PATTERN)?.[0] || line.match(AGE_STATE_PATTERN)?.[0];
    if (state) return state;
  }

  const explicitStageLine = lines.find(line => (
    !/^[^：:\n]{1,28}[：:]/.test(line) &&
    /(?:闪回|回忆|时期|阶段|年(?:前|后)|[（(【[][^）)】\]]*(?:婴儿|幼年|童年|儿童|少年|少女|青年|中年|老年|年迈))/.test(line)
  ));
  return explicitStageLine?.match(TRANSFORMATION_PATTERN)?.[0]
    || explicitStageLine?.match(AGE_STATE_PATTERN)?.[0]
    || '';
}

function collectDialogueOccurrences(content: string): DialogueOccurrence[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const occurrences: DialogueOccurrence[] = [];
  let episodeNumber: number | null = null;

  lines.forEach((line, index) => {
    const episodeMatch = line.match(/第\s*([0-9零〇一二两三四五六七八九十百]+)\s*集/);
    if (episodeMatch) episodeNumber = chineseNumberToInt(episodeMatch[1]);

    const colonDialogueMatch = line.match(/^\s*([^：:\n]{1,28})\s*[：:]\s*(.+?)\s*$/);
    const bracketDialogueMatch = line.match(/^\s*[【\[]([^】\]]{1,28})[】\]]\s*[“"]?(.+?)[”"]?\s*$/);
    const dialogueMatch = colonDialogueMatch || (
      bracketDialogueMatch && NON_CHARACTER_SPEAKER_PATTERN.test(bracketDialogueMatch[1])
        ? bracketDialogueMatch
        : null
    );
    if (!dialogueMatch) return;
    const speaker = cleanSpeaker(dialogueMatch[1]);
    const dialogue = dialogueMatch[2].trim();
    if (!speaker || dialogue.length < 1) return;

    const context = lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 3)).join('\n').slice(0, 700);
    const contextState = detectContextState(context, speaker.canonicalCandidate);
    occurrences.push({
      ...speaker,
      episodeNumber,
      dialogue: dialogue.slice(0, 300),
      stateHint: speaker.stateHint || contextState,
      context,
    });
  });

  return occurrences;
}

function normalizeText(value: unknown, fallback = ''): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text || fallback;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(item => normalizeText(item)).filter(Boolean)));
}

function normalizeNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(Number).filter(number => Number.isInteger(number) && number > 0))).sort((a, b) => a - b);
}

function canonicalAgeStage(value: unknown): string {
  const text = String(value || '').replace(/\s+/g, '');
  const match = text.match(AGE_STATE_PATTERN)?.[0] || '';
  if (/婴儿/.test(match)) return '婴儿时期';
  if (/幼年/.test(match)) return '幼年时期';
  if (/童年|儿童/.test(match)) return '童年时期';
  if (/少年|少女/.test(match)) return '少年时期';
  if (/青年|年轻时/.test(match)) return '青年时期';
  if (/中年/.test(match)) return '中年时期';
  if (/老年|年迈/.test(match)) return '老年时期';
  return '';
}

function canonicalVariantLabel(label: string, kind: VoiceVariantKind): string {
  const cleaned = normalizeText(label, kind === 'base' ? '主要时期' : '状态');
  if (kind === 'age') return canonicalAgeStage(cleaned) || cleaned;
  if (kind === 'transformation') {
    const transformation = cleaned.match(TRANSFORMATION_PATTERN)?.[0];
    if (transformation) return transformation.endsWith('状态') ? transformation : `${transformation}状态`;
  }
  return cleaned;
}

function equivalentStateTerms(label: string, kind: VoiceVariantKind, keywords: string[] = []): string[] {
  const terms = new Set([label, ...keywords].map(item => normalizeText(item)).filter(Boolean));
  if (kind === 'transformation') {
    const transformation = normalizeText(label).match(TRANSFORMATION_PATTERN)?.[0];
    if (transformation) {
      terms.add(transformation);
      terms.add(transformation.endsWith('状态') ? transformation : `${transformation}状态`);
    }
    return Array.from(terms);
  }
  if (kind !== 'age') return Array.from(terms);

  const canonical = canonicalAgeStage([label, ...keywords].join(' '));
  const aliases: Record<string, string[]> = {
    婴儿时期: ['婴儿', '婴儿时期'],
    幼年时期: ['幼年', '幼年时期'],
    童年时期: ['童年', '童年时期', '儿童', '儿童时期'],
    少年时期: ['少年', '少年时期', '少女', '少女时期'],
    青年时期: ['青年', '青年时期', '年轻时', '年轻时期'],
    中年时期: ['中年', '中年时期'],
    老年时期: ['老年', '老年时期', '年迈', '年迈时期'],
  };
  for (const alias of aliases[canonical] || []) terms.add(alias);
  if (canonical) terms.add(canonical);
  return Array.from(terms);
}

function variantStateKey(label: string, kind: VoiceVariantKind): string {
  return `${kind}:${canonicalVariantLabel(label, kind)}`;
}

function inferVariantKind(label: string, requestedKind?: string): VoiceVariantKind {
  if (requestedKind === 'transformation' || TRANSFORMATION_PATTERN.test(label)) return 'transformation';
  if (requestedKind === 'age' || AGE_STATE_PATTERN.test(label)) return 'age';
  return 'base';
}

function defaultTraits(character?: KnownCharacter, stateLabel = '主要时期'): VoiceTraits {
  return {
    genderPresentation: normalizeText(character?.gender, '按人物身份自然呈现'),
    agePresentation: stateLabel,
    pitch: /幼|童|少年|少女/.test(stateLabel) ? '中高音域' : /老年|年迈/.test(stateLabel) ? '中低音域' : '中音域',
    timbre: '自然、清晰、有辨识度',
    pace: '自然语速',
    energy: '随剧情情绪变化',
    diction: '普通话咬字清楚',
    emotionRange: '保留角色真实情绪起伏',
    accent: '无明确证据时使用自然普通话',
  };
}

function normalizeTraits(value: unknown, character?: KnownCharacter, stateLabel = '主要时期'): VoiceTraits {
  const fallback = defaultTraits(character, stateLabel);
  const traits = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    genderPresentation: normalizeText(traits.genderPresentation, fallback.genderPresentation),
    agePresentation: normalizeText(traits.agePresentation, fallback.agePresentation),
    pitch: normalizeText(traits.pitch, fallback.pitch),
    timbre: normalizeText(traits.timbre, fallback.timbre),
    pace: normalizeText(traits.pace, fallback.pace),
    energy: normalizeText(traits.energy, fallback.energy),
    diction: normalizeText(traits.diction, fallback.diction),
    emotionRange: normalizeText(traits.emotionRange, fallback.emotionRange),
    accent: normalizeText(traits.accent, fallback.accent),
  };
}

function findKnownCharacter(name: string, characters: KnownCharacter[]): KnownCharacter | undefined {
  const normalized = name.replace(/\s+/g, '').toLocaleLowerCase();
  return characters.find(character => [character.name, ...(character.aliases || [])]
    .some(alias => String(alias || '').replace(/\s+/g, '').toLocaleLowerCase() === normalized));
}

function classifySpeakerCategory(name: string, characters: KnownCharacter[]): VoiceSpeakerCategory {
  if (findKnownCharacter(name, characters)) return 'character';
  if (SYSTEM_SPEAKER_PATTERN.test(name)) return 'system';
  if (THIRD_PARTY_SPEAKER_PATTERN.test(name)) return 'third_party';
  return 'character';
}

function fallbackVariant(
  profileName: string,
  label: string,
  kind: VoiceVariantKind,
  occurrences: DialogueOccurrence[],
  character?: KnownCharacter,
): CharacterVoiceVariant {
  const canonicalLabel = canonicalVariantLabel(label, kind);
  const traits = defaultTraits(character, canonicalLabel);
  return {
    id: stableId('voice-variant', `${profileName}:${variantStateKey(canonicalLabel, kind)}`),
    label: canonicalLabel,
    kind,
    ageStage: kind === 'age' ? canonicalLabel : undefined,
    transformationState: kind === 'transformation' ? canonicalLabel : undefined,
    stageKeywords: equivalentStateTerms(label, kind, [canonicalLabel]),
    episodeNumbers: normalizeNumberArray(occurrences.map(item => item.episodeNumber)),
    dialogueCount: occurrences.length,
    sampleDialogues: Array.from(new Set(occurrences.map(item => item.dialogue))).slice(0, 4),
    traits,
    recommendedVoiceId: recommendVoicePresetId(traits, `${profileName} ${canonicalLabel}`),
  };
}

function mergeEquivalentVoiceVariants(
  profileName: string,
  variants: CharacterVoiceVariant[],
): CharacterVoiceVariant[] {
  const merged = new Map<string, CharacterVoiceVariant>();

  for (const variant of variants) {
    const canonicalLabel = canonicalVariantLabel(variant.label, variant.kind);
    const key = variantStateKey(canonicalLabel, variant.kind);
    const normalized: CharacterVoiceVariant = {
      ...variant,
      id: stableId('voice-variant', `${profileName}:${key}`),
      label: canonicalLabel,
      ageStage: variant.kind === 'age' ? canonicalLabel : variant.ageStage,
      transformationState: variant.kind === 'transformation' ? canonicalLabel : variant.transformationState,
      stageKeywords: equivalentStateTerms(
        variant.label,
        variant.kind,
        [canonicalLabel, ...variant.stageKeywords],
      ),
      episodeNumbers: normalizeNumberArray(variant.episodeNumbers),
      sampleDialogues: normalizeStringArray(variant.sampleDialogues).slice(0, 4),
    };
    const current = merged.get(key);
    if (!current) {
      merged.set(key, normalized);
      continue;
    }

    const sampleDialogues = Array.from(new Set([
      ...current.sampleDialogues,
      ...normalized.sampleDialogues,
    ])).slice(0, 4);
    merged.set(key, {
      ...current,
      stageKeywords: Array.from(new Set([...current.stageKeywords, ...normalized.stageKeywords])),
      episodeNumbers: normalizeNumberArray([...current.episodeNumbers, ...normalized.episodeNumbers]),
      dialogueCount: Math.max(current.dialogueCount, normalized.dialogueCount, sampleDialogues.length),
      sampleDialogues,
      boundVoiceId: current.boundVoiceId || normalized.boundVoiceId,
      boundAt: current.boundAt || normalized.boundAt,
    });
  }

  return Array.from(merged.values());
}

function createFallbackProfile(
  name: string,
  occurrences: DialogueOccurrence[],
  characters: KnownCharacter[],
): CharacterVoiceProfile {
  const character = findKnownCharacter(name, characters);
  const speakerCategory = classifySpeakerCategory(name, characters);
  const grouped = new Map<string, DialogueOccurrence[]>();
  for (const occurrence of occurrences) {
    const rawLabel = occurrence.stateHint || (speakerCategory === 'system'
      ? '系统语音'
      : speakerCategory === 'third_party'
        ? '通用音色'
        : '主要时期');
    const kind = inferVariantKind(rawLabel);
    const label = canonicalVariantLabel(rawLabel, kind);
    grouped.set(label, [...(grouped.get(label) || []), occurrence]);
  }
  const variants = Array.from(grouped.entries()).map(([label, items]) => {
    const kind = inferVariantKind(label);
    return fallbackVariant(name, label, kind, items, character);
  });
  return {
    id: stableId('voice-profile', name),
    characterId: character?.id,
    characterName: character?.name || name,
    speakerCategory,
    aliases: Array.from(new Set(occurrences.map(item => item.sourceName).filter(alias => alias !== name))),
    totalDialogueCount: occurrences.length,
    variants: mergeEquivalentVoiceVariants(character?.name || name, variants),
  };
}

function buildLocalProfiles(occurrences: DialogueOccurrence[], characters: KnownCharacter[]): CharacterVoiceProfile[] {
  const grouped = new Map<string, DialogueOccurrence[]>();
  for (const occurrence of occurrences) {
    const key = occurrence.canonicalCandidate;
    grouped.set(key, [...(grouped.get(key) || []), occurrence]);
  }
  return Array.from(grouped.entries()).map(([name, items]) => createFallbackProfile(name, items, characters));
}

function buildModelPayload(occurrences: DialogueOccurrence[], characters: KnownCharacter[]) {
  const grouped = new Map<string, DialogueOccurrence[]>();
  occurrences.forEach(occurrence => {
    grouped.set(occurrence.sourceName, [...(grouped.get(occurrence.sourceName) || []), occurrence]);
  });
  return {
    dialogueSpeakers: Array.from(grouped.entries()).map(([sourceName, items]) => ({
      sourceName,
      canonicalCandidate: items[0]?.canonicalCandidate || sourceName,
      dialogueCount: items.length,
      stateHints: Array.from(new Set(items.map(item => item.stateHint).filter(Boolean))),
      episodes: normalizeNumberArray(items.map(item => item.episodeNumber)),
      samples: items.slice(0, 8).map(item => ({
        episodeNumber: item.episodeNumber,
        dialogue: item.dialogue,
        context: item.context,
      })),
    })),
    knownCharacters: characters.map(character => ({
      id: character.id,
      name: character.name,
      aliases: character.aliases || [],
      age: character.age,
      gender: character.gender,
      looks: (character.looks || []).map(look => ({
        stage: look.stage,
        ageStage: look.ageStage,
        transformationState: look.transformationState,
        episodeNumbers: look.episodeNumbers || [],
      })),
    })),
  };
}

function normalizeModelProfiles(
  value: unknown,
  occurrences: DialogueOccurrence[],
  characters: KnownCharacter[],
): CharacterVoiceProfile[] {
  const root = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rawProfiles = Array.isArray(value) ? value : Array.isArray(root.profiles) ? root.profiles : [];
  const represented = new Set<string>();
  const profiles: CharacterVoiceProfile[] = [];

  rawProfiles.forEach((rawProfile, profileIndex) => {
    if (!rawProfile || typeof rawProfile !== 'object') return;
    const profileValue = rawProfile as Record<string, unknown>;
    const characterName = normalizeText(profileValue.characterName || profileValue.name);
    if (!characterName) return;
    const sourceNames = normalizeStringArray(profileValue.sourceNames || profileValue.aliases);
    const matchingOccurrences = occurrences.filter(item =>
      sourceNames.includes(item.sourceName) ||
      item.canonicalCandidate === characterName ||
      item.sourceName === characterName
    );
    matchingOccurrences.forEach(item => represented.add(item.sourceName));
    const character = findKnownCharacter(characterName, characters);
    const requestedCategory = normalizeText(profileValue.speakerCategory);
    const speakerCategory: VoiceSpeakerCategory = requestedCategory === 'system' || requestedCategory === 'third_party'
      ? requestedCategory
      : classifySpeakerCategory(characterName, characters);
    const rawVariants = Array.isArray(profileValue.variants) ? profileValue.variants : [];
    const variants = rawVariants.map((rawVariant, variantIndex): CharacterVoiceVariant | null => {
      const variantValue = rawVariant && typeof rawVariant === 'object' ? rawVariant as Record<string, unknown> : {};
      const rawLabel = normalizeText(variantValue.label, variantIndex === 0 ? '主要时期' : `状态${variantIndex + 1}`);
      const kindValue = normalizeText(variantValue.kind);
      const kind = inferVariantKind(rawLabel, kindValue);
      const label = canonicalVariantLabel(rawLabel, kind);
      const modelStageKeywords = normalizeStringArray(variantValue.stageKeywords);
      const evidenceTerms = equivalentStateTerms(rawLabel, kind);
      const relatedOccurrences = matchingOccurrences.filter(item => {
        if (kind === 'base') return !item.stateHint || item.stateHint === '主要时期';
        const itemKind = inferVariantKind(item.stateHint);
        const sameDetectedState = Boolean(item.stateHint) && variantStateKey(item.stateHint, itemKind) === variantStateKey(label, kind);
        return sameDetectedState || evidenceTerms.some(term => item.context.includes(term));
      });
      const evidence = relatedOccurrences;
      if (evidence.length === 0) return null;

      const stageKeywords = equivalentStateTerms(rawLabel, kind, modelStageKeywords);
      const traits = normalizeTraits(variantValue.traits, character, label);
      return {
        id: stableId('voice-variant', `${characterName}:${variantStateKey(label, kind)}`),
        label,
        kind,
        ageStage: kind === 'age' ? label : undefined,
        transformationState: normalizeText(variantValue.transformationState) || (kind === 'transformation' ? label : undefined),
        stageKeywords,
        episodeNumbers: normalizeNumberArray(evidence.map(item => item.episodeNumber)),
        dialogueCount: evidence.length,
        sampleDialogues: Array.from(new Set(evidence.map(item => item.dialogue))).slice(0, 4),
        traits,
        recommendedVoiceId: recommendVoicePresetId(traits, `${characterName} ${label}`),
      };
    }).filter((variant): variant is CharacterVoiceVariant => variant !== null);

    let completedVariants = mergeEquivalentVoiceVariants(
      character?.name || characterName,
      variants.length > 0
        ? variants
        : createFallbackProfile(characterName, matchingOccurrences, characters).variants,
    );
    const coveredStateKeys = new Set(completedVariants.map(variant => variantStateKey(variant.label, variant.kind)));
    const missingStateGroups = new Map<string, {
      label: string;
      kind: VoiceVariantKind;
      items: DialogueOccurrence[];
    }>();
    matchingOccurrences.forEach(item => {
      if (!item.stateHint) return;
      const kind = inferVariantKind(item.stateHint);
      const label = canonicalVariantLabel(item.stateHint, kind);
      const key = variantStateKey(label, kind);
      if (coveredStateKeys.has(key)) return;
      const group = missingStateGroups.get(key) || { label, kind, items: [] };
      group.items.push(item);
      missingStateGroups.set(key, group);
    });
    missingStateGroups.forEach(group => {
      completedVariants.push(fallbackVariant(
        characterName,
        group.label,
        group.kind,
        group.items,
        character,
      ));
    });
    completedVariants = mergeEquivalentVoiceVariants(character?.name || characterName, completedVariants);

    profiles.push({
      id: stableId('voice-profile', `${characterName}:${profileIndex}`),
      characterId: character?.id,
      characterName: character?.name || characterName,
      speakerCategory,
      aliases: Array.from(new Set([...sourceNames, ...matchingOccurrences.map(item => item.sourceName)]))
        .filter(alias => alias !== characterName && alias !== character?.name),
      totalDialogueCount: matchingOccurrences.length || Number(profileValue.totalDialogueCount) || 0,
      variants: completedVariants,
    });
  });

  const unrepresentedGroups = new Map<string, DialogueOccurrence[]>();
  occurrences.forEach(item => {
    if (represented.has(item.sourceName)) return;
    unrepresentedGroups.set(item.canonicalCandidate, [...(unrepresentedGroups.get(item.canonicalCandidate) || []), item]);
  });
  unrepresentedGroups.forEach((items, name) => profiles.push(createFallbackProfile(name, items, characters)));
  return profiles;
}

function normalizeSpeakerKey(value: unknown): string {
  return normalizeText(value).replace(/\s+/g, '').toLocaleLowerCase();
}

function findProfileOccurrences(
  profile: CharacterVoiceProfile,
  occurrences: DialogueOccurrence[],
): DialogueOccurrence[] {
  const names = new Set([
    profile.characterName,
    ...profile.aliases,
  ].map(normalizeSpeakerKey).filter(Boolean));
  return occurrences.filter(item => (
    names.has(normalizeSpeakerKey(item.sourceName)) ||
    names.has(normalizeSpeakerKey(item.canonicalCandidate))
  ));
}

function occurrenceSupportsVariant(
  occurrence: DialogueOccurrence,
  label: string,
  kind: VoiceVariantKind,
): boolean {
  if (kind === 'base') return !occurrence.stateHint || occurrence.stateHint === '主要时期';
  if (occurrence.stateHint) {
    const occurrenceKind = inferVariantKind(occurrence.stateHint);
    if (variantStateKey(occurrence.stateHint, occurrenceKind) === variantStateKey(label, kind)) return true;
  }
  const speakerLines = occurrence.context.split('\n').filter(line => (
    line.includes(occurrence.sourceName) || line.includes(occurrence.canonicalCandidate)
  ));
  return equivalentStateTerms(label, kind).some(term => speakerLines.some(line => line.includes(term)));
}

function auditExtractedVoiceProfiles(
  profiles: CharacterVoiceProfile[],
  occurrences: DialogueOccurrence[],
  characters: KnownCharacter[],
): {
  profiles: CharacterVoiceProfile[];
  mergedVariantCount: number;
  removedUnsupportedVariantCount: number;
} {
  let mergedVariantCount = 0;
  let removedUnsupportedVariantCount = 0;

  const audited = profiles.map(profile => {
    const matchingOccurrences = findProfileOccurrences(profile, occurrences);
    const validatedVariants = profile.variants.flatMap<CharacterVoiceVariant>(variant => {
      const kind = inferVariantKind(variant.label, variant.kind);
      const label = canonicalVariantLabel(variant.label, kind);
      const evidence = matchingOccurrences.filter(item => occurrenceSupportsVariant(item, label, kind));
      if (evidence.length === 0) {
        removedUnsupportedVariantCount += 1;
        return [];
      }
      return [{
        ...variant,
        id: stableId('voice-variant', `${profile.characterName}:${variantStateKey(label, kind)}`),
        label,
        kind,
        ageStage: kind === 'age' ? label : undefined,
        transformationState: kind === 'transformation' ? label : undefined,
        stageKeywords: equivalentStateTerms(variant.label, kind, variant.stageKeywords),
        episodeNumbers: normalizeNumberArray(evidence.map(item => item.episodeNumber)),
        dialogueCount: evidence.length,
        sampleDialogues: Array.from(new Set(evidence.map(item => item.dialogue))).slice(0, 4),
      }];
    });

    const coveredStateKeys = new Set(validatedVariants.map(variant => variantStateKey(variant.label, variant.kind)));
    const missingStateGroups = new Map<string, {
      label: string;
      kind: VoiceVariantKind;
      items: DialogueOccurrence[];
    }>();
    matchingOccurrences.forEach(item => {
      if (!item.stateHint) return;
      const kind = inferVariantKind(item.stateHint);
      const label = canonicalVariantLabel(item.stateHint, kind);
      const key = variantStateKey(label, kind);
      if (coveredStateKeys.has(key)) return;
      const group = missingStateGroups.get(key) || { label, kind, items: [] };
      group.items.push(item);
      missingStateGroups.set(key, group);
    });
    const character = findKnownCharacter(profile.characterName, characters);
    missingStateGroups.forEach(group => {
      validatedVariants.push(fallbackVariant(
        profile.characterName,
        group.label,
        group.kind,
        group.items,
        character,
      ));
    });

    const beforeMerge = validatedVariants.length;
    let variants = mergeEquivalentVoiceVariants(profile.characterName, validatedVariants);
    mergedVariantCount += beforeMerge - variants.length;
    if (variants.length === 0 && matchingOccurrences.length > 0) {
      variants = createFallbackProfile(profile.characterName, matchingOccurrences, characters).variants;
    }

    return {
      ...profile,
      totalDialogueCount: matchingOccurrences.length || profile.totalDialogueCount,
      variants,
    };
  }).filter(profile => profile.variants.length > 0);

  return {
    profiles: audited,
    mergedVariantCount,
    removedUnsupportedVariantCount,
  };
}

function parseModelResponse(response: string): unknown {
  const cleaned = response.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return tryExtractAndFixJSON(response);
  }
}

function removeLowDialogueProfiles(profiles: CharacterVoiceProfile[]): {
  profiles: CharacterVoiceProfile[];
  removedCount: number;
} {
  const retained = profiles.filter(profile => (
    Number(profile.totalDialogueCount) >= MIN_DIALOGUE_LINES_FOR_VOICE_PROFILE
  ));
  return {
    profiles: retained,
    removedCount: profiles.length - retained.length,
  };
}

export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    if (body.sourceType !== 'execution-script') {
      return NextResponse.json({ error: '人物音色提取仅允许使用当前执行剧本' }, { status: 400 });
    }
    const content = typeof body.content === 'string'
      ? body.content.replace(/\r\n?/g, '\n').trim()
      : '';
    if (!content) return NextResponse.json({ error: '执行剧本内容为空' }, { status: 400 });

    const characters: KnownCharacter[] = Array.isArray(body.characters) ? body.characters : [];
    const occurrences = collectDialogueOccurrences(content);
    if (occurrences.length === 0) {
      const emptyData: CharacterVoiceExtraction = {
        sourceType: 'execution-script',
        totalSpeakers: 0,
        totalDialogueLines: 0,
        profiles: [],
        extractedAt: Date.now(),
        warning: '执行剧本中没有识别到“人物名：台词”格式的对白',
      };
      return NextResponse.json({ success: true, type: 'character-voices', data: emptyData });
    }

    const payload = buildModelPayload(occurrences, characters);
    let modelProfiles: CharacterVoiceProfile[] = [];
    const usageBox: { current: LlmTokenUsage | null } = { current: null };
    let warning = '';
    try {
      const response = await oaiInvoke([
        {
          role: 'system',
          content: `你是影视声音导演。请根据执行剧本中已扫描出的全部对白人物和上下文，建立人物音色档案。

规则：
1. 先合并同一人物的别名、称谓和不同时期，再统计该发声主体在完整执行剧本中的台词总句数；合并后少于 ${MIN_DIALOGUE_LINES_FOR_VOICE_PROFILE} 句的一律不要输出，累计至少 ${MIN_DIALOGUE_LINES_FOR_VOICE_PROFILE} 句才建立 profile。
2. 符合至少 ${MIN_DIALOGUE_LINES_FOR_VOICE_PROFILE} 句台词条件的发声主体必须完整覆盖，不能遗漏 sourceName；即使不在人物列表中也必须保留。
3. 同一人物的别名、称谓和不同时期必须合并到同一个人物 profile；sourceNames 必须列出被合并的原始说话人名称。
4. 系统提示、导航、智能助手、自动语音等归类为 speakerCategory=system；广播、客服、接线员、电话另一端、旁白和其他第三方发声者归类为 speakerCategory=third_party；普通人物为 character。不得把符合句数条件的系统或第三方台词当作字幕、音效而删除。
5. 幼年、童年、少年、青年、中年、老年，以及会明显改变声音的变身/魔化/附身等，作为该人物下面的独立 variants。
6. 年龄状态统一命名为“婴儿时期、幼年时期、童年时期、少年时期、青年时期、中年时期、老年时期”。“童年”和“童年时期”属于同一状态，“少年”和“少年时期”属于同一状态，分别只能保留一个，其他同义写法也必须合并。
7. 每个 age 或 transformation 状态必须能在该人物的原台词上下文中找到年龄/变身证据，并填写真实关联集数；不能仅因人物资料中出现某个年龄就盲目创建没有台词证据的音色状态。
8. 普通换装、场景变化、受伤但声音没有明显改变时，不要创建新的音色状态。
9. variant.kind 只能是 base、age、transformation。
10. episodeNumbers 必须根据证据填写；sampleDialogues 保留原台词，不能改写。
11. traits 必须包含 genderPresentation、agePresentation、pitch、timbre、pace、energy、diction、emotionRange、accent。
12. 不要虚构具体配音演员、平台音色 ID 或声音克隆结果，只描述可供视频模型参考的音色特征。

只输出 JSON：
{
  "profiles": [
    {
      "characterName": "规范人物名",
      "speakerCategory": "character|system|third_party",
      "sourceNames": ["剧本中的说话人写法"],
      "variants": [
        {
          "label": "主要时期/童年时期/老年时期/变身状态",
          "kind": "base|age|transformation",
          "ageStage": "",
          "transformationState": "",
          "stageKeywords": ["用于匹配镜头上下文的关键词"],
          "episodeNumbers": [1],
          "sampleDialogues": ["原台词"],
          "traits": {
            "genderPresentation": "",
            "agePresentation": "",
            "pitch": "",
            "timbre": "",
            "pace": "",
            "energy": "",
            "diction": "",
            "emotionRange": "",
            "accent": ""
          }
        }
      ]
    }
  ]
}`,
        },
        {
          role: 'user',
          content: `文件名：${normalizeText(body.fileName, '未命名执行剧本')}\n\n以下数据由程序通读执行剧本后逐行收集，请完整整理：\n${JSON.stringify(payload)}`,
        },
      ], {
        temperature: 0.1,
        maxTokens: 20_000,
        timeout: 240_000,
        maxRetries: 2,
        includeUsage: true,
        billingLabel: '人物音色提取',
        onUsage: value => { usageBox.current = value; },
      });
      modelProfiles = normalizeModelProfiles(parseModelResponse(response), occurrences, characters);
      if (modelProfiles.length === 0) throw new Error('模型未返回可用人物音色档案');
    } catch (error) {
      console.warn('[人物音色提取] 模型整理失败，使用全文本地扫描结果:', error);
      modelProfiles = buildLocalProfiles(occurrences, characters);
      warning = '模型整理暂时失败，已保留全文对白扫描结果，可稍后重新提取以完善音色特征';
    }

    const audited = auditExtractedVoiceProfiles(modelProfiles, occurrences, characters);
    modelProfiles = audited.profiles;
    if (audited.mergedVariantCount > 0 || audited.removedUnsupportedVariantCount > 0) {
      console.log(
        `[人物音色提取] 提取后复核：合并 ${audited.mergedVariantCount} 个同义状态，移除 ${audited.removedUnsupportedVariantCount} 个无剧本证据状态`,
      );
    }

    const filtered = removeLowDialogueProfiles(modelProfiles);
    modelProfiles = filtered.profiles;
    if (filtered.removedCount > 0) {
      console.log(
        `[人物音色提取] 已忽略 ${filtered.removedCount} 个全剧台词少于 ${MIN_DIALOGUE_LINES_FOR_VOICE_PROFILE} 句的发声主体`,
      );
      if (modelProfiles.length === 0) {
        warning = [warning, `已识别到的发声主体在全剧均少于 ${MIN_DIALOGUE_LINES_FOR_VOICE_PROFILE} 句台词，按规则不建立人物音色档案`]
          .filter(Boolean)
          .join('；');
      }
    }

    const data: CharacterVoiceExtraction = {
      sourceType: 'execution-script',
      totalSpeakers: modelProfiles.length,
      totalDialogueLines: occurrences.length,
      profiles: modelProfiles,
      extractedAt: Date.now(),
      warning: warning || undefined,
    };

    return NextResponse.json({
      success: true,
      type: 'character-voices',
      data,
      tokenUsage: usageBox.current ? {
        input: usageBox.current.inputTokens,
        output: usageBox.current.outputTokens,
        timestamp: Date.now(),
      } : undefined,
    });
  } catch (error) {
    console.error('人物音色提取失败:', error);
    return NextResponse.json({
      error: '人物音色提取失败',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
