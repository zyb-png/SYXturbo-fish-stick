export type CanonicalCharacterGender = '男' | '女' | '待定';
export type CharacterEntityKind = 'human' | 'animal-creature';

type CharacterLike = Record<string, any>;

const FEMALE_NAME_PATTERN = /女仆|女佣|女侍|女护卫|女卫兵|女保镖|贵族女|女爵|女王|王后|王妃|公主|圣女|修女|母亲|妈妈|妈咪|妻子|老婆|未婚妻|新娘|姐姐|妹妹|嫂子|阿姨|夫人|太太|小姐|姑娘|女孩|女儿|老板娘/;
const MALE_NAME_PATTERN = /男仆|男佣|男侍|男护卫|男卫兵|男保镖|贵族男|男爵|国王|王子|公爵|伯爵|骑士|父亲|爸爸|爹|丈夫|老公|未婚夫|新郎|哥哥|弟弟|叔叔|伯伯|爷爷|先生|少爷|老爷|公子|男孩|儿子|看守男/;
const DEFAULT_MALE_ROLE_PATTERN = /^(?:护卫|侍卫|卫兵|保镖|守卫|门卫|看守|士兵|佣兵|骑士|仆从|男仆|贵族男)(?:[A-Za-z甲乙丙丁一二三四五六七八九十\d]*)$/;
const ANIMAL_NAME_PATTERN = /地狱犬|hellhound|狼人|狼兽|犬人|犬兽|狐人|狐妖|猫妖|猫人|虎人|熊人|豹人|兽人|魔兽|妖兽|灵兽|巨狼|魔狼/i;
const ANIMAL_ANATOMY_PATTERN = /犬类|狼类|猫科|兽类|吻部|兽吻|皮毛|兽毛|四足|前爪|后爪|爪子|尾巴|獠牙|肩高|狗头|狼头/;

export function normalizeCharacterGender(value: unknown): CanonicalCharacterGender | '' {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text) return '';
  if (/待定|未知|不明/.test(text)) return '待定';
  const hasFemale = /女|女性|女生|女孩|女人/.test(text);
  const hasMale = /男|男性|男生|男孩|男人/.test(text);
  if (hasFemale && !hasMale) return '女';
  if (hasMale && !hasFemale) return '男';
  return '';
}

export function inferExplicitGenderFromName(name: unknown): '男' | '女' | '' {
  const text = typeof name === 'string' ? name.trim() : '';
  if (!text) return '';
  if (FEMALE_NAME_PATTERN.test(text)) return '女';
  if (MALE_NAME_PATTERN.test(text)) return '男';
  if (text.includes('女') && !text.includes('男')) return '女';
  if (text.includes('男') && !text.includes('女')) return '男';
  if (/母|妈|姐姐|妹妹|阿姨|嫂|妻|夫人|太太|小姐|姑娘|女孩|女儿|新娘|老板娘/.test(text)) return '女';
  if (/父|爸|叔|伯|哥|爷|儿子|先生|少爷|老爷|公子|男孩/.test(text)) return '男';
  if (/[婷娜娟芳梅兰雪霞莉丽敏婧妍媛瑶琳倩萍慧颖]$/.test(text)) return '女';
  if (/[伟强刚勇军杰磊鹏涛斌龙峰]$/.test(text)) return '男';
  return '';
}

export function inferCharacterEntityKind(character: CharacterLike): CharacterEntityKind {
  const name = typeof character?.name === 'string' ? character.name : '';
  const evidence = [
    character?.appearance,
    character?.faceFeatures,
    character?.bodyProfile,
    Array.isArray(character?.looks)
      ? character.looks.map((look: CharacterLike) => [look?.description, look?.hairstyle, look?.bodyProfile])
      : null,
  ];
  const evidenceText = JSON.stringify(evidence);
  if (ANIMAL_NAME_PATTERN.test(name)) return 'animal-creature';
  if (ANIMAL_ANATOMY_PATTERN.test(evidenceText) && /皮毛|兽毛|四足|爪子|吻部|兽吻|犬类|狼类|猫科/.test(evidenceText)) {
    return 'animal-creature';
  }
  return 'human';
}

export function resolveCharacterGenderByPolicy(input: {
  name: unknown;
  currentGender?: unknown;
  evidenceGender?: unknown;
  character?: CharacterLike;
}): CanonicalCharacterGender {
  const nameHint = inferExplicitGenderFromName(input.name);
  if (nameHint) return nameHint;

  const character = input.character || { name: input.name };
  if (inferCharacterEntityKind(character) === 'animal-creature') return '男';

  const evidenceGender = normalizeCharacterGender(input.evidenceGender);
  if (evidenceGender && evidenceGender !== '待定') return evidenceGender;

  const nameText = typeof input.name === 'string' ? input.name.trim() : '';
  if (DEFAULT_MALE_ROLE_PATTERN.test(nameText)) return '男';

  const currentGender = normalizeCharacterGender(input.currentGender);
  if (currentGender && currentGender !== '待定') return currentGender;

  // 产品规则：剧本没有足够证据时，以男性作为制作默认值，避免把泛称角色随机生成为女性。
  return '男';
}

export function getAnimalCreaturePromptDirectives(character: CharacterLike): string[] {
  if (inferCharacterEntityKind(character) !== 'animal-creature') return [];
  const bodyText = JSON.stringify(character?.bodyProfile || {});
  const isQuadruped = /四足|肩高|前爪|后爪/.test(bodyText);
  return [
    '【非人角色锁定】这是动物特征占主导的奇幻生物，不是普通人类，也不是戴动物面具的人类。头骨、吻部、鼻头、耳朵、牙齿、皮毛、爪与身体轮廓必须保持明确的动物解剖特征',
    isQuadruped
      ? '【形态锁定】剧本和身体档案明确为四足动物体态，必须保持完整四足犬科/兽类结构，不得改成人类躯干或双足人形'
      : '【拟人规则】只有剧本明确要求人形时才允许拟人；即使拟人也必须保持动物头部、兽耳、吻部、全身皮毛、爪和尾巴，动物特征必须明显强于人类特征',
    '【毛发规则】毛发必须是顺应动物头骨和身体结构生长的兽毛、鬃毛或短硬毛，不得出现人类头皮发际线、女性长发、披肩发、马尾、盘发或人类发型',
    '【禁止人类化】不要人类脸、不要女性妆容、不要人类皮肤、不要人类鼻唇、不要假发、不要把动物角色生成成普通男人或女人',
  ];
}
