export type VoiceVariantKind = 'base' | 'age' | 'transformation';
export type VoiceSpeakerCategory = 'character' | 'system' | 'third_party';

export interface VoiceTraits {
  genderPresentation: string;
  agePresentation: string;
  pitch: string;
  timbre: string;
  pace: string;
  energy: string;
  diction: string;
  emotionRange: string;
  accent: string;
}

export interface CharacterVoiceVariant {
  id: string;
  label: string;
  kind: VoiceVariantKind;
  ageStage?: string;
  transformationState?: string;
  stageKeywords: string[];
  episodeNumbers: number[];
  dialogueCount: number;
  sampleDialogues: string[];
  traits: VoiceTraits;
  recommendedVoiceId: string;
  boundVoiceId?: string;
  boundAt?: number;
}

export interface CharacterVoiceProfile {
  id: string;
  characterId?: number;
  characterName: string;
  speakerCategory?: VoiceSpeakerCategory;
  aliases: string[];
  totalDialogueCount: number;
  variants: CharacterVoiceVariant[];
}

export interface CharacterVoiceExtraction {
  sourceType: 'execution-script';
  totalSpeakers: number;
  totalDialogueLines: number;
  profiles: CharacterVoiceProfile[];
  extractedAt: number;
  warning?: string;
}

export interface VoiceLibraryItem {
  id: string;
  name: string;
  gender: '女' | '男' | '中性';
  ageRange: string;
  description: string;
  tags: string[];
  source: 'preset' | 'builtin' | 'custom';
  language?: string;
  category?: string;
  fileName?: string;
  fileSize?: number;
  createdAt?: string;
  providerVoiceId?: string;
  referenceAudioUrl?: string;
}

export interface VideoVoiceAssignment {
  characterName: string;
  variantId: string;
  variantLabel: string;
  voiceId: string;
  voiceName: string;
  voiceDescription: string;
  referenceAudioUrl?: string;
  providerVoiceId?: string;
  dialogueLines: string[];
}

export interface VoiceShotLike {
  description?: string;
  actionAndDialogue?: string;
  notes?: string;
  characters?: Array<{
    name?: string;
    dialogue?: string;
    dialogueType?: string;
    lookId?: string;
  }>;
}

export interface VideoVoiceResolution {
  speakingCharacters: string[];
  assignments: VideoVoiceAssignment[];
  missingCharacters: string[];
  instruction: string;
}

export const DEFAULT_VOICE_LIBRARY: VoiceLibraryItem[] = [
  {
    id: 'preset-girl-clear',
    name: '女童·清亮自然',
    gender: '女',
    ageRange: '幼年/童年',
    description: '自然女童声，音高偏高，清亮柔软，咬字清楚，语速自然，保留真实儿童呼吸感。',
    tags: ['女童', '清亮', '自然', '稚嫩'],
    source: 'preset',
  },
  {
    id: 'preset-boy-clear',
    name: '男童·清脆自然',
    gender: '男',
    ageRange: '幼年/童年',
    description: '自然男童声，清脆明快，略带稚气，情绪反应直接，避免成人化低沉声线。',
    tags: ['男童', '清脆', '自然', '稚气'],
    source: 'preset',
  },
  {
    id: 'preset-teen-female-bright',
    name: '少女·清澈灵动',
    gender: '女',
    ageRange: '少年/少女',
    description: '清澈灵动的少女声线，音高偏中高，语速轻快，情绪细腻而有活力。',
    tags: ['少女', '清澈', '灵动', '轻快'],
    source: 'preset',
  },
  {
    id: 'preset-young-female-soft',
    name: '青年女·温柔清晰',
    gender: '女',
    ageRange: '青年',
    description: '温柔清晰的青年女性声线，中高音域，吐字自然，亲和但不甜腻，适合生活化对白。',
    tags: ['青年女', '温柔', '清晰', '亲和'],
    source: 'preset',
  },
  {
    id: 'preset-young-female-crisp',
    name: '青年女·干练冷静',
    gender: '女',
    ageRange: '青年',
    description: '干练冷静的青年女性声线，中音域，咬字利落，节奏稳定，情绪克制而有力量。',
    tags: ['青年女', '干练', '冷静', '利落'],
    source: 'preset',
  },
  {
    id: 'preset-mature-female-steady',
    name: '成熟女·沉稳有力',
    gender: '女',
    ageRange: '中年',
    description: '成熟沉稳的女性声线，中低音域，语速从容，吐字清楚，具备生活阅历和情绪张力。',
    tags: ['中年女', '沉稳', '有力', '成熟'],
    source: 'preset',
  },
  {
    id: 'preset-elder-female-warm',
    name: '老年女·温厚沧桑',
    gender: '女',
    ageRange: '老年',
    description: '温厚而略带沧桑的老年女性声线，语速偏缓，气息自然，情绪含蓄且有岁月感。',
    tags: ['老年女', '温厚', '沧桑', '缓慢'],
    source: 'preset',
  },
  {
    id: 'preset-young-male-clear',
    name: '青年男·清朗自然',
    gender: '男',
    ageRange: '青年',
    description: '清朗自然的青年男性声线，中音域，吐字清楚，节奏自然，适合日常和青春题材对白。',
    tags: ['青年男', '清朗', '自然', '清楚'],
    source: 'preset',
  },
  {
    id: 'preset-young-male-low',
    name: '青年男·低沉克制',
    gender: '男',
    ageRange: '青年',
    description: '低沉克制的青年男性声线，中低音域，语速稳定，情绪内敛，适合冷静或强势角色。',
    tags: ['青年男', '低沉', '克制', '稳定'],
    source: 'preset',
  },
  {
    id: 'preset-mature-male-steady',
    name: '中年男·沉稳厚实',
    gender: '男',
    ageRange: '中年',
    description: '沉稳厚实的中年男性声线，中低音域，咬字有分量，节奏从容，具备可信度和压迫感。',
    tags: ['中年男', '沉稳', '厚实', '有分量'],
    source: 'preset',
  },
  {
    id: 'preset-elder-male-warm',
    name: '老年男·温厚沧桑',
    gender: '男',
    ageRange: '老年',
    description: '温厚沧桑的老年男性声线，音域偏低，语速偏缓，气息自然，带有阅历和岁月感。',
    tags: ['老年男', '温厚', '沧桑', '低缓'],
    source: 'preset',
  },
  {
    id: 'preset-narrator-cinematic',
    name: '旁白·中性电影感',
    gender: '中性',
    ageRange: '成年',
    description: '中性克制的电影旁白声线，音域适中，吐字清楚，节奏稳定，不抢夺角色对白的情绪重心。',
    tags: ['旁白', '中性', '电影感', '克制'],
    source: 'preset',
  },
  {
    id: 'preset-system-neutral',
    name: '系统·中性电子提示',
    gender: '中性',
    ageRange: '无年龄',
    description: '清晰克制的中性系统提示音，节奏均匀，咬字准确，带轻微电子质感，不模拟具体真人身份。',
    tags: ['系统', '导航', '智能助手', '电子提示'],
    source: 'preset',
  },
  {
    id: 'preset-third-party-neutral',
    name: '第三方·自然通用',
    gender: '中性',
    ageRange: '成年',
    description: '自然清楚的第三方通用声线，情绪不过度突出，适合客服、广播、接线员、电话另一端和临时发声角色。',
    tags: ['第三方', '客服', '广播', '电话声音'],
    source: 'preset',
  },
];

const STATE_KEYWORDS = [
  '婴儿', '幼年', '童年', '儿童', '少年', '少女', '青年', '年轻', '中年', '老年', '年迈',
  '变身', '觉醒', '魔化', '妖化', '兽化', '黑化', '附身', '灵魂', '机器人', '机械化',
];

export function normalizeVoiceCharacterName(value: unknown): string {
  return String(value || '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/(?:VO|OS|V\.O\.|O\.S\.)$/i, '')
    .replace(/[\s，,。；;：:、·]+/g, '')
    .trim()
    .toLocaleLowerCase();
}

function isDialogue(value: unknown): value is string {
  const text = String(value || '').trim();
  return text.length > 0 && !/^(无|暂无|没有|—|-|\.\.\.|……)$/.test(text);
}

const BLOCKED_INLINE_SPEAKERS = new Set([
  '人物', '角色', '场景', '地点', '时间', '画面', '镜头', '动作', '表情', '音效',
  '字幕', '备注', '说明', '对白', '台词', '旁白内容', '运镜', '景别', '角度',
]);

function collectInlineDialogues(value: unknown): Array<{ name: string; dialogue: string }> {
  const text = String(value || '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return [];

  const dialogues: Array<{ name: string; dialogue: string }> = [];
  const pattern = /(?:^|\n|[。；;])\s*([\p{Script=Han}A-Za-z0-9·]{1,16})(?:[（(](?:VO|OS|V\.O\.|O\.S\.)[）)])?\s*[：:]\s*[“"]?([^\n“”"]{1,240})[”"]?/gu;
  for (const match of text.matchAll(pattern)) {
    const name = String(match[1] || '').trim();
    const dialogue = String(match[2] || '').trim().replace(/[。；;]\s*$/, '');
    if (!name || BLOCKED_INLINE_SPEAKERS.has(name) || !isDialogue(dialogue)) continue;
    dialogues.push({ name, dialogue });
  }
  return dialogues;
}

function findVoiceProfile(
  name: string,
  profiles: CharacterVoiceProfile[],
): CharacterVoiceProfile | undefined {
  const identity = normalizeVoiceCharacterName(name);
  if (!identity) return undefined;

  const exact = profiles.find(profile => [profile.characterName, ...profile.aliases]
    .some(alias => normalizeVoiceCharacterName(alias) === identity));
  if (exact) return exact;

  return profiles.find(profile => [profile.characterName, ...profile.aliases].some(alias => {
    const aliasIdentity = normalizeVoiceCharacterName(alias);
    return aliasIdentity.length >= 2 && identity.length >= 2 &&
      (aliasIdentity.includes(identity) || identity.includes(aliasIdentity));
  }));
}

function chooseVoiceVariant(
  profile: CharacterVoiceProfile,
  chapterNumber: number | undefined,
  cueText: string,
): CharacterVoiceVariant | undefined {
  const normalizedCue = cueText.toLocaleLowerCase();
  const scored = profile.variants.map(variant => {
    let score = variant.kind === 'base' ? 1 : 2;
    if (chapterNumber && variant.episodeNumbers.includes(chapterNumber)) score += 8;
    for (const keyword of [variant.label, variant.ageStage, variant.transformationState, ...variant.stageKeywords]) {
      const normalized = String(keyword || '').trim().toLocaleLowerCase();
      if (normalized && normalizedCue.includes(normalized)) score += 12;
    }
    for (const keyword of STATE_KEYWORDS) {
      if (normalizedCue.includes(keyword) && variant.label.includes(keyword)) score += 10;
    }
    return { variant, score };
  });

  scored.sort((a, b) => b.score - a.score || a.variant.id.localeCompare(b.variant.id));
  return scored[0]?.variant;
}

export function formatVideoVoiceInstruction(assignments: VideoVoiceAssignment[]): string {
  if (assignments.length === 0) return '';
  const lines = assignments.map(assignment => {
    const dialogue = assignment.dialogueLines.length > 0
      ? `；本组台词：${assignment.dialogueLines.map(line => `“${line}”`).join('、')}`
      : '';
    return `- ${assignment.characterName}（${assignment.variantLabel}）使用「${assignment.voiceName}」：${assignment.voiceDescription}${dialogue}`;
  });

  return [
    '【人物音色绑定】',
    ...lines,
    '强制要求：谁说台词就只使用该人物当前时期/状态所绑定的音色；同一人物同一状态的音高、音色、语速和口音必须前后一致，不得串音、换声或把台词分配给其他人物。台词内容必须逐字保持原文。',
  ].join('\n');
}

export function resolveVideoVoiceAssignments(
  shots: VoiceShotLike[],
  chapterNumber: number | undefined,
  extraction: CharacterVoiceExtraction | null | undefined,
  library: VoiceLibraryItem[],
): VideoVoiceResolution {
  const speaking = new Map<string, { displayName: string; dialogues: string[]; cueText: string[] }>();

  for (const shot of shots) {
    const shotCue = [shot.description, shot.actionAndDialogue, shot.notes].filter(Boolean).join(' ');
    const structuredSpeakerKeys = new Set<string>();
    for (const character of shot.characters || []) {
      if (!isDialogue(character.dialogue)) continue;
      const displayName = String(character.name || '').trim();
      const identity = normalizeVoiceCharacterName(displayName);
      if (!identity) continue;
      structuredSpeakerKeys.add(identity);
      const current = speaking.get(identity) || { displayName, dialogues: [], cueText: [] };
      if (!current.dialogues.includes(character.dialogue.trim())) current.dialogues.push(character.dialogue.trim());
      current.cueText.push(shotCue, character.lookId || '', character.dialogueType || '');
      speaking.set(identity, current);
    }

    for (const inlineDialogue of collectInlineDialogues([shot.actionAndDialogue, shot.description].filter(Boolean).join('\n'))) {
      const identity = normalizeVoiceCharacterName(inlineDialogue.name);
      if (!identity) continue;
      const current = speaking.get(identity) || {
        displayName: inlineDialogue.name,
        dialogues: [],
        cueText: [],
      };
      if (!current.dialogues.includes(inlineDialogue.dialogue)) current.dialogues.push(inlineDialogue.dialogue);
      current.cueText.push(shotCue, structuredSpeakerKeys.has(identity) ? '结构化台词已识别' : '动作描述内台词');
      speaking.set(identity, current);
    }
  }

  const profiles = extraction?.profiles || [];
  const assignments: VideoVoiceAssignment[] = [];
  const missingCharacters: string[] = [];

  for (const speaker of speaking.values()) {
    const profile = findVoiceProfile(speaker.displayName, profiles);
    const variant = profile ? chooseVoiceVariant(profile, chapterNumber, speaker.cueText.join(' ')) : undefined;
    const voice = variant?.boundVoiceId
      ? library.find(item => item.id === variant.boundVoiceId)
      : undefined;

    if (!profile || !variant || !voice) {
      missingCharacters.push(speaker.displayName);
      continue;
    }

    assignments.push({
      characterName: speaker.displayName,
      variantId: variant.id,
      variantLabel: variant.label,
      voiceId: voice.id,
      voiceName: voice.name,
      voiceDescription: voice.description,
      referenceAudioUrl: voice.referenceAudioUrl,
      providerVoiceId: voice.providerVoiceId,
      dialogueLines: speaker.dialogues,
    });
  }

  const speakingCharacters = Array.from(speaking.values()).map(item => item.displayName);
  return {
    speakingCharacters,
    assignments,
    missingCharacters: Array.from(new Set(missingCharacters)),
    instruction: formatVideoVoiceInstruction(assignments),
  };
}

export function recommendVoicePresetId(traits: Partial<VoiceTraits>, label = ''): string {
  const text = [
    traits.genderPresentation,
    traits.agePresentation,
    traits.pitch,
    traits.timbre,
    label,
  ].filter(Boolean).join(' ');

  if (/系统|导航|智能助手|自动语音|电子音|机器音|语音提示/.test(text)) return 'preset-system-neutral';
  if (/旁白|解说/.test(text)) return 'preset-narrator-cinematic';
  if (/第三方|客服|接线员|广播|播报|主持人|电话那头|电话声音|陌生人/.test(text)) return 'preset-third-party-neutral';
  if (/女/.test(text) && /幼|童|儿童/.test(text)) return 'preset-girl-clear';
  if (/男/.test(text) && /幼|童|儿童/.test(text)) return 'preset-boy-clear';
  if (/女/.test(text) && /少年|少女/.test(text)) return 'preset-teen-female-bright';
  if (/女/.test(text) && /老年|年迈/.test(text)) return 'preset-elder-female-warm';
  if (/男/.test(text) && /老年|年迈/.test(text)) return 'preset-elder-male-warm';
  if (/女/.test(text) && /中年|成熟/.test(text)) return 'preset-mature-female-steady';
  if (/男/.test(text) && /中年|成熟/.test(text)) return 'preset-mature-male-steady';
  if (/女/.test(text) && /冷|干练|利落|低沉/.test(text)) return 'preset-young-female-crisp';
  if (/男/.test(text) && /低沉|克制|冷/.test(text)) return 'preset-young-male-low';
  if (/男/.test(text)) return 'preset-young-male-clear';
  return 'preset-young-female-soft';
}
