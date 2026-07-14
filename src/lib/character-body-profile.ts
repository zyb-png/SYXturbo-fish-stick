export interface CharacterBodyProfile {
  height: string;
  weight: string;
  bodyType: string;
  shoulderWaist: string;
  limbProportions: string;
  posture: string;
}

type BodyProfileSource = Partial<CharacterBodyProfile> & Record<string, unknown>;

const BODY_DETAIL_PATTERN = /(身高|体重|身形|身材|体型|体格|骨架|肩宽|肩线|肩背|肩腰|腰线|腰身|四肢|腿长|腿部|手臂|头身比|上下身比例|身材比例|身体比例|体态|站姿|姿态|步态|高挑|矮小|瘦削|偏瘦|健壮|壮实|魁梧|丰满|身形纤细|身材纤细|四肢修长|双腿修长)/;
const WARDROBE_DETAIL_PATTERN = /(穿着|衣着|服装|装束|穿搭|搭配|学生装|职业装|工装|制服|西装|衬衫|长裤|短裤|裙装|连衣裙|礼服|家居服|睡衣|外套|鞋履)/;
const PLACEHOLDER_PATTERN = /^(待补充|待完善|暂无|未知|未明确|剧本未明确)$/;

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function usefulText(value: unknown): string {
  const text = cleanText(value);
  return text && !PLACEHOLDER_PATTERN.test(text) ? text : '';
}

function getRecord(value: unknown): BodyProfileSource {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as BodyProfileSource
    : {};
}

function bodyClauses(text: unknown): string[] {
  return cleanText(text)
    .split(/[。；;，,、]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .filter(item => BODY_DETAIL_PATTERN.test(item));
}

export function inferCharacterBodyProfile(text: unknown): CharacterBodyProfile {
  const clauses = bodyClauses(text);
  const find = (pattern: RegExp) => clauses.find(clause => pattern.test(clause)) || '';
  const numericHeight = cleanText(text).match(/(?:身高\s*)?((?:约|大约)?\s*\d{2,3}(?:\.\d+)?\s*(?:cm|厘米|公分))/i)?.[1]?.trim() || '';
  const numericWeight = cleanText(text).match(/(?:体重\s*)?((?:约|大约)?\s*\d{2,3}(?:\.\d+)?\s*(?:kg|公斤|千克|斤))/i)?.[1]?.trim() || '';

  return {
    height: numericHeight || find(/身高|高挑|矮小/),
    weight: numericWeight || find(/体重/),
    bodyType: find(/身形|身材|体型|体格|骨架|瘦削|偏瘦|健壮|壮实|魁梧|丰满/),
    shoulderWaist: find(/肩宽|肩线|肩背|肩腰|腰线|腰身|骨架/),
    limbProportions: find(/四肢|腿长|腿部|手臂|头身比|上下身比例|身材比例|身体比例/),
    posture: find(/体态|站姿|姿态|步态/),
  };
}

export function normalizeCharacterBodyProfile(
  value: unknown,
  legacyDescription: unknown = ''
): CharacterBodyProfile {
  const source = getRecord(value);
  const inferred = inferCharacterBodyProfile(legacyDescription);

  return {
    height: usefulText(source.height || source.stature) || inferred.height,
    weight: usefulText(source.weight || source.bodyWeight) || inferred.weight,
    bodyType: usefulText(source.bodyType || source.build || source.physique) || inferred.bodyType,
    shoulderWaist: usefulText(source.shoulderWaist || source.shoulderAndWaist || source.frame) || inferred.shoulderWaist,
    limbProportions: usefulText(source.limbProportions || source.proportions || source.bodyProportions) || inferred.limbProportions,
    posture: usefulText(source.posture || source.stance || source.bodyPosture) || inferred.posture,
  };
}

export function mergeCharacterBodyProfiles(
  preferred: unknown,
  fallback: unknown
): CharacterBodyProfile {
  const primary = normalizeCharacterBodyProfile(preferred);
  const secondary = normalizeCharacterBodyProfile(fallback);
  return {
    height: primary.height || secondary.height,
    weight: primary.weight || secondary.weight,
    bodyType: primary.bodyType || secondary.bodyType,
    shoulderWaist: primary.shoulderWaist || secondary.shoulderWaist,
    limbProportions: primary.limbProportions || secondary.limbProportions,
    posture: primary.posture || secondary.posture,
  };
}

export function hasCharacterBodyProfile(value: unknown): boolean {
  return Object.values(normalizeCharacterBodyProfile(value)).some(Boolean);
}

export function formatCharacterBodyProfile(value: unknown): string {
  const profile = normalizeCharacterBodyProfile(value);
  return [
    profile.height ? `身高：${profile.height}` : '',
    profile.weight ? `体重：${profile.weight}` : '',
    profile.bodyType ? `体型：${profile.bodyType}` : '',
    profile.shoulderWaist ? `肩腰与骨架：${profile.shoulderWaist}` : '',
    profile.limbProportions ? `四肢比例：${profile.limbProportions}` : '',
    profile.posture ? `体态：${profile.posture}` : '',
  ].filter(Boolean).join('；');
}

export function stripBodyDetailsFromAppearance(value: unknown): string {
  const source = cleanText(value);
  if (!source) return '';

  const retained = source
    .split(/[。；;，,、]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .filter(item => !BODY_DETAIL_PATTERN.test(item) && !WARDROBE_DETAIL_PATTERN.test(item));

  return retained.join('，').replace(/[，。；]+$/, '').trim();
}

export function inheritBodyProfileForLooks<T extends Record<string, any>>(
  looks: T[],
  characterBodyProfile: unknown
): T[] {
  const canonicalProfile = normalizeCharacterBodyProfile(characterBodyProfile);
  return looks.map(look => {
    const lookProfile = mergeCharacterBodyProfiles(
      normalizeCharacterBodyProfile(look.bodyProfile, look.description),
      canonicalProfile
    );
    const explicitChanges = usefulText(look.bodyChanges || look.physicalChanges);
    const physicalState = usefulText(look.physicalState);
    const transformationState = usefulText(look.transformationState);
    const ageStage = usefulText(look.ageStage);
    const changeType = usefulText(look.changeType);
    const bodyChanges = explicitChanges || (
      physicalState && physicalState !== '正常状态'
        ? physicalState
        : transformationState
          ? transformationState
          : /年龄时期|复合变化/.test(changeType) && ageStage
            ? `按${ageStage}阶段呈现自然体态变化，身份骨架保持可追溯`
            : ''
    );

    return {
      ...look,
      bodyProfile: lookProfile,
      bodyChanges,
    };
  });
}
