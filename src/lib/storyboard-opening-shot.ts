export const OPENING_SHOT_ACTION_CHANGE =
  '首镜建立当前动作、表情和人物站位，作为本集后续镜头的动作基准';

export const OPENING_CHARACTER_ACTION_CHANGE =
  '首镜建立人物当前动作、表情和身体朝向';

export const OPENING_SHOT_CONTINUITY =
  '首镜建立人物站位、道具状态和视线方向，作为本集后续镜头的连续性基准';

const CONTINUING_SHOT_ACTION_CHANGE =
  '较上一镜：动作保持连续，眼神、呼吸或手部细节发生细微变化';

const CONTINUING_CHARACTER_ACTION_CHANGE =
  '较上一镜：人物动作、表情或身体朝向发生细微变化';

const CONTINUING_SHOT_CONTINUITY =
  '保持上一镜人物站位、道具状态和视线方向连续';

const PRIOR_SHOT_REFERENCE_PATTERN =
  /(上一(?:个)?镜(?:头)?|前一(?:个)?镜(?:头)?|上个镜头|前序镜头|上一(?:个)?画面|前一(?:个)?画面)/;

const OPENING_SHOT_REFERENCE_PATTERN = /(首镜|第一镜)/;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOpeningShotText(
  shotNumber: number,
  value: unknown,
  openingFallback: string,
  continuingFallback: string,
): string {
  const text = normalizeText(value);
  if (shotNumber === 1) {
    return text && !PRIOR_SHOT_REFERENCE_PATTERN.test(text)
      ? text
      : openingFallback;
  }
  return text && !OPENING_SHOT_REFERENCE_PATTERN.test(text)
    ? text
    : continuingFallback;
}

export function normalizeOpeningShotActionChange(
  shotNumber: number,
  value: unknown,
  scope: 'shot' | 'character' = 'shot',
): string {
  return normalizeOpeningShotText(
    shotNumber,
    value,
    scope === 'character'
      ? OPENING_CHARACTER_ACTION_CHANGE
      : OPENING_SHOT_ACTION_CHANGE,
    scope === 'character'
      ? CONTINUING_CHARACTER_ACTION_CHANGE
      : CONTINUING_SHOT_ACTION_CHANGE,
  );
}

export function normalizeOpeningShotContinuity(
  shotNumber: number,
  value: unknown,
): string {
  return normalizeOpeningShotText(
    shotNumber,
    value,
    OPENING_SHOT_CONTINUITY,
    CONTINUING_SHOT_CONTINUITY,
  );
}
