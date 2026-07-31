type SpatialScene = {
  location?: unknown;
  time?: unknown;
};

type SpatialCharacter = {
  name?: unknown;
  position?: unknown;
  relativePosition?: unknown;
  blocking?: unknown;
};

export type SpatialShot = {
  shotNumber?: unknown;
  scene?: SpatialScene;
  characters?: SpatialCharacter[];
  actorBlocking?: unknown;
  continuity?: unknown;
  actionChange?: unknown;
  videoUnitStartState?: unknown;
};

export type FrameSpatialSnapshot = {
  actorBlocking: string;
  characters: Array<{ name: string; position: string }>;
  continuity: string;
  inheritsPreviousFrame: boolean;
};

const GENERIC_SCENE_PATTERN = /^(?:未知|未知场景|未知环境|未指定|未识别|待定|无|场景|环境|地点|当前场景|当前剧情场景|当前剧情环境)$/;
const PREVIOUS_STATE_PATTERN = /(?:上一镜|前一镜|上镜|上一单元|前一单元|承接|继承|延续前)/;

function cleanText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getScene(value: unknown): SpatialScene {
  if (typeof value === 'string') return { location: value };
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  if (record.scene && typeof record.scene === 'object') return record.scene as SpatialScene;
  return record as SpatialScene;
}

function getSceneTimeBucket(value: unknown): 'day' | 'night' | '' {
  const text = cleanText(value);
  if (/夜|晚|凌晨|黄昏|傍晚/.test(text)) return 'night';
  if (/日|昼|白天|清晨|早晨|上午|中午|下午/.test(text)) return 'day';
  return '';
}

function getInteriorBucket(value: unknown): 'interior' | 'exterior' | '' {
  const text = cleanText(value);
  if (/\bEXT\.?\b|外景|室外|\[外\]|【外】|（外）|\(外\)/i.test(text)) return 'exterior';
  if (/\bINT\.?\b|内景|室内|\[内\]|【内】|（内）|\(内\)/i.test(text)) return 'interior';
  return '';
}

function normalizeSceneLocation(value: unknown): string {
  const text = cleanText(value)
    .replace(/^(?:场景|地点|环境)\s*[：:]\s*/i, '')
    .replace(/^\s*(?:第?\d+\s*[集章]\s*)?\d+\s*[-—–.]\s*\d+\s*[：:]?\s*/, '')
    .replace(/[\[【（(]\s*(?:内|外|内景|外景|室内|室外|日|夜|白天|夜晚|清晨|黄昏|傍晚)(?:\s*[/|、]\s*(?:内|外|内景|外景|室内|室外|日|夜|白天|夜晚|清晨|黄昏|傍晚))*\s*[\]】）)]/gi, '')
    .replace(/\b(?:INT|EXT)\.?\b/gi, '')
    .replace(/[\s，,。；;：:、/|【】[\]（）()《》"'“”‘’\-—–_]/g, '')
    .toLowerCase();
  return !text || GENERIC_SCENE_PATTERN.test(text) ? '' : text;
}

export function areSameSpatialScenes(left: unknown, right: unknown): boolean {
  const leftScene = getScene(left);
  const rightScene = getScene(right);
  const leftLocation = normalizeSceneLocation(leftScene.location);
  const rightLocation = normalizeSceneLocation(rightScene.location);
  if (!leftLocation || !rightLocation || leftLocation !== rightLocation) return false;

  const leftTime = getSceneTimeBucket(`${cleanText(leftScene.location)} ${cleanText(leftScene.time)}`);
  const rightTime = getSceneTimeBucket(`${cleanText(rightScene.location)} ${cleanText(rightScene.time)}`);
  if (leftTime && rightTime && leftTime !== rightTime) return false;

  const leftInterior = getInteriorBucket(`${cleanText(leftScene.location)} ${cleanText(leftScene.time)}`);
  const rightInterior = getInteriorBucket(`${cleanText(rightScene.location)} ${cleanText(rightScene.time)}`);
  if (leftInterior && rightInterior && leftInterior !== rightInterior) return false;
  return true;
}

function characterName(character: SpatialCharacter): string {
  return cleanText(character?.name);
}

function isUsefulPosition(value: unknown): boolean {
  const text = cleanText(value);
  return Boolean(text) && !/^(?:无|未知|未指定|待定|保持不变|位置不变)$/.test(text);
}

function cleanPosition(value: unknown, name = ''): string {
  let text = cleanText(value).replace(/[。；;]+$/g, '');
  if (name) {
    text = text.replace(new RegExp(`^${escapeRegExp(name)}\\s*(?:位于|站在|处于|在|坐在|躺在)?\\s*`), '');
  }
  return text.replace(/^(?:位于|站在|处于)\s*/, '').trim();
}

function extractBlockingPosition(actorBlocking: unknown, name: string): string {
  const blocking = cleanText(actorBlocking);
  if (!blocking || !name) return '';
  const clauses = blocking
    .replace(/[，,]/g, '；')
    .split(/[；;。\n]/)
    .map(item => item.trim())
    .filter(Boolean);
  const direct = clauses.find(clause => clause.includes(name));
  if (!direct) return '';
  const position = cleanPosition(direct, name);
  return isUsefulPosition(position) ? position : '';
}

function getFallbackPosition(index: number, total: number): string {
  if (total <= 1) {
    return '场景参考图中的主要可站立行动区，避开固定家具、墙体和通道，身体朝向主要行动方向';
  }
  if (total === 2) {
    return index === 0
      ? '场景参考图主要可通行区域内、靠近本镜动作起点的位置，面向对手或行动目标'
      : '同一可通行区域内与第一人物保持清晰对手关系的位置，不占用固定家具或通道';
  }
  const positions = [
    '场景参考图主要可通行区域内、靠近本镜动作起点的位置',
    '同一可通行区域内与第一人物形成清晰行动关系的位置',
    '场景参考图中不遮挡前两人的次要可站立区域，保持在行动轴线内',
    '场景参考图中不遮挡主要人物和固定标志物的可见区域',
  ];
  return positions[index] || `场景参考图中第${index + 1}个可站立区域，不遮挡主要人物和固定通道`;
}

function buildActorBlocking(characters: Array<{ name: string; position: string }>, fallback = ''): string {
  if (characters.length === 0) return cleanText(fallback);
  return `${characters.map(character => `${character.name}位于${cleanPosition(character.position, character.name)}`).join('；')}。人物位置、朝向和视线均以此处为唯一空间基准。`;
}

function canonicalizeShot<T extends SpatialShot>(shot: T, previousShot?: SpatialShot | null): T {
  const characters = Array.isArray(shot.characters) ? shot.characters : [];
  const namedCharacters = characters
    .map(character => ({ character, name: characterName(character) }))
    .filter(item => item.name);
  const sameScene = Boolean(previousShot && areSameSpatialScenes(previousShot, shot));
  const previousPositions = new Map<string, string>();
  if (sameScene && Array.isArray(previousShot?.characters)) {
    previousShot.characters.forEach(character => {
      const name = characterName(character);
      const position = cleanPosition(character.position || character.relativePosition || character.blocking, name);
      if (name && isUsefulPosition(position)) previousPositions.set(name, position);
    });
  }

  const blockingPositions = new Map<string, string>();
  namedCharacters.forEach(({ name }) => {
    const position = extractBlockingPosition(shot.actorBlocking, name);
    if (position) blockingPositions.set(name, position);
  });
  const blockingIsComplete = namedCharacters.length > 0
    && namedCharacters.every(({ name }) => blockingPositions.has(name));

  const canonicalCharacters = namedCharacters.map(({ character, name }, index) => {
    const ownPosition = cleanPosition(
      character.position || character.relativePosition || character.blocking,
      name,
    );
    const position = (blockingIsComplete ? blockingPositions.get(name) : '')
      || (isUsefulPosition(ownPosition) ? ownPosition : '')
      || previousPositions.get(name)
      || getFallbackPosition(index, namedCharacters.length);
    return {
      ...character,
      name,
      position,
    };
  });
  const canonicalPositions = canonicalCharacters.map(character => ({
    name: characterName(character),
    position: cleanPosition(character.position, characterName(character)),
  }));

  const location = cleanText(shot.scene?.location) || '当前剧情场景';
  const originalContinuity = cleanText(shot.continuity);
  const originalActionChange = cleanText(shot.actionChange);
  let continuity = originalContinuity;
  let actionChange = originalActionChange;
  let videoUnitStartState = cleanText(shot.videoUnitStartState);

  if (!previousShot) {
    if (!continuity || PREVIOUS_STATE_PATTERN.test(continuity)) {
      continuity = `本镜建立${location}的初始空间关系，人物站位、朝向、视线和道具位置以本镜为准。`;
    }
    if (!actionChange || PREVIOUS_STATE_PATTERN.test(actionChange)) {
      actionChange = '首镜建立动作、人物站位和视线关系，无上一镜动作可比较。';
    }
  } else if (!sameScene) {
    continuity = `场景或时段切换至${location}，本镜重新建立人物站位、行动轴线、视线和道具位置，不继承上一场空间坐标。`;
    if (!actionChange || PREVIOUS_STATE_PATTERN.test(actionChange) || /较上一镜/.test(actionChange)) {
      actionChange = '切换场景后重新建立本镜动作和人物位置，不与上一场空间坐标比较。';
    }
    if (!videoUnitStartState || PREVIOUS_STATE_PATTERN.test(videoUnitStartState)) {
      videoUnitStartState = `${location}内重新建立人物站位、身体朝向、视线、动作和道具归属。`;
    }
  } else if (!continuity) {
    continuity = '承接上一镜末态；同名人物沿用上一镜位置，只有本镜明确动作造成的位移才发生变化。';
  }

  return {
    ...shot,
    characters: canonicalCharacters,
    actorBlocking: buildActorBlocking(canonicalPositions, cleanText(shot.actorBlocking)),
    continuity,
    actionChange,
    ...(videoUnitStartState ? { videoUnitStartState } : {}),
  } as T;
}

export function reconcileStoryboardSpatialContinuity<T extends SpatialShot>(
  shots: T[],
  initialPreviousShot?: SpatialShot | null,
): T[] {
  let previousShot = initialPreviousShot || null;
  return (Array.isArray(shots) ? shots : []).map(shot => {
    const canonical = canonicalizeShot(shot, previousShot);
    previousShot = canonical;
    return canonical;
  });
}

export function getFrameSpatialSnapshot(
  shot: SpatialShot,
  previousShot: SpatialShot | null | undefined,
  frameType: 'start' | 'end',
): FrameSpatialSnapshot {
  const canonicalShot = canonicalizeShot(shot, previousShot);
  const sameScene = Boolean(previousShot && areSameSpatialScenes(previousShot, canonicalShot));
  const previousPositions = new Map<string, string>();
  if (sameScene && Array.isArray(previousShot?.characters)) {
    previousShot.characters.forEach(character => {
      const name = characterName(character);
      const position = cleanPosition(character.position || character.relativePosition || character.blocking, name);
      if (name && isUsefulPosition(position)) previousPositions.set(name, position);
    });
  }

  const characters = (Array.isArray(canonicalShot.characters) ? canonicalShot.characters : [])
    .map(character => {
      const name = characterName(character);
      const currentPosition = cleanPosition(character.position, name);
      return {
        name,
        position: frameType === 'start'
          ? previousPositions.get(name) || currentPosition
          : currentPosition,
      };
    })
    .filter(character => character.name && character.position);

  const location = cleanText(canonicalShot.scene?.location) || '当前剧情场景';
  const continuity = frameType === 'start'
    ? sameScene
      ? '首帧承接上一镜末态；同名人物从上一镜结束位置起步，新增入画人物按本镜位置进入。'
      : `首帧在${location}重新建立空间关系，不沿用上一场的人物坐标。`
    : '尾帧以本镜动作完成后的准确人物位置、朝向、视线和道具归属为准，供下一镜承接。';

  return {
    actorBlocking: buildActorBlocking(characters, cleanText(canonicalShot.actorBlocking)),
    characters,
    continuity,
    inheritsPreviousFrame: frameType === 'start' && sameScene,
  };
}
