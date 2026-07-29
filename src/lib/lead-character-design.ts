export type LeadCharacterDesignBible = {
  creationType?: string;
  subjectRegion?: string;
  creationBackground?: string;
};

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isLeadCharacterRole(value: unknown): boolean {
  const role = normalize(value).toLowerCase().replace(/[\s_\-/（）()【】\[\]]+/g, '');
  if (!role) return false;
  if (/(主要配角|次要配角|配角|龙套|路人|背景人物|群众演员)/.test(role)) return false;
  return role.includes('主角') ||
    role.includes('主人公') ||
    role.includes('男主') ||
    role.includes('女主') ||
    role.includes('男一') ||
    role.includes('女一') ||
    role.includes('protagonist') ||
    role === 'lead' ||
    role === 'maincharacter';
}

function getStyleLabel(creationBible?: LeadCharacterDesignBible): string {
  const creationType = normalize(creationBible?.creationType);
  if (creationType === '3D') return '院线级风格化3D动画电影';
  if (creationType === '动漫') return '高品质二维动画电影';
  return '真人电影或精品短剧';
}

function getContextLabel(creationBible?: LeadCharacterDesignBible): string {
  const region = normalize(creationBible?.subjectRegion) || '剧本指定地域';
  const background = normalize(creationBible?.creationBackground) || '剧本指定时代';
  return `${region}、${background}`;
}

type LeadGender = '男' | '女' | '';

function normalizeLeadGender(value: unknown): LeadGender {
  const gender = normalize(value);
  if (gender.includes('女')) return '女';
  if (gender.includes('男')) return '男';
  return '';
}

function selectLeadArchetype(gender: LeadGender, characterText: string): {
  label: string;
  directive: string;
} {
  const text = normalize(characterText);

  if (gender === '女') {
    if (/(强势|果断|英气|勇敢|将军|警察|战士|复仇|凌厉|坚韧)/.test(text)) {
      return { label: '英气高级型', directive: '骨相利落、眉眼坚定、气场有力量，漂亮但不柔弱，保留明确女性结构与高级感' };
    }
    if (/(贵族|名媛|女王|总裁|成熟|优雅|端庄|权威|沉稳|高贵)/.test(text)) {
      return { label: '成熟贵气型', directive: '轮廓舒展、仪态从容、眼神稳定，呈现克制贵气与成熟魅力，不显老气或刻薄' };
    }
    if (/(清冷|疏离|冷静|理性|神秘|孤独|克制|冷艳)/.test(text)) {
      return { label: '清冷明艳型', directive: '五官清晰精致、眼神克制而有故事感，冷感与明艳并存，不做苍白寡淡或攻击性网红脸' };
    }
    return { label: '温柔灵动型', directive: '眉眼鲜活、神态亲和而有情绪流动，甜美但不幼态，柔和中保留电影女主的辨识度与气质' };
  }

  if (gender === '男') {
    if (/(强势|果断|战士|警察|军人|硬朗|勇敢|复仇|凌厉|危险|坚韧)/.test(text)) {
      return { label: '硬朗英气型', directive: '眉骨、鼻梁、下颌与颈部结构清楚，眼神有力量，硬朗但不粗糙油腻' };
    }
    if (/(总裁|权威|成熟|沉稳|父亲|领导|上位者|贵族|帝王|掌控)/.test(text)) {
      return { label: '成熟权威型', directive: '骨相稳重、眼神笃定、仪态克制，呈现可靠权威与成熟魅力，不显疲惫老气' };
    }
    if (/(温柔|治愈|善良|体贴|文艺|医生|老师|暖|少年感)/.test(text)) {
      return { label: '温柔苏感型', directive: '眉眼温和有情绪交流，轮廓清爽利落，温柔而不女性化，具有自然亲近感与男主魅力' };
    }
    return { label: '清俊矜贵型', directive: '五官利落、比例舒展、眼神清醒克制，清俊但保留男性骨相，具有高级、从容的银幕气质' };
  }

  return { label: '电影主角型', directive: '依据人物身份建立协调骨相、情绪眼神和鲜明记忆点，确保主角存在感与自然可信度' };
}

function getRegionalCastingDirective(
  gender: LeadGender,
  creationBible?: LeadCharacterDesignBible
): string {
  const region = normalize(creationBible?.subjectRegion);
  const isForeign = region === '国外';

  if (isForeign && gender === '女') {
    return '【地域选角】采用西方电影女主的自然骨相逻辑：眼窝、鼻梁、颧面、唇部与下颌结构立体协调，肤色与发色符合剧本族裔；不得默认生成东亚面孔。剧本明确族裔时以剧本为最高优先级';
  }
  if (isForeign && gender === '男') {
    return '【地域选角】采用西方电影男主的自然骨相逻辑：眉骨眼窝、鼻梁、颧面、下颌与颈部层次清楚，肤色与发色符合剧本族裔；不得默认生成东亚面孔。剧本明确族裔时以剧本为最高优先级';
  }
  if (!isForeign && gender === '女') {
    return '【地域选角】采用东方电影女主的骨相与审美逻辑：面部留白舒展、眉眼含情、鼻唇精致、轮廓流畅，漂亮而有东方辨识度；不得套用西式深眼窝模板。剧本明确族裔时以剧本为最高优先级';
  }
  if (!isForeign && gender === '男') {
    return '【地域选角】采用东方电影男主的骨相与审美逻辑：眉眼清楚、鼻梁利落、颧面与下颌自然有层次，帅气而有东方辨识度；不得生成女性化模板脸。剧本明确族裔时以剧本为最高优先级';
  }
  return `【地域选角】严格依据${region || '剧本指定地域'}与剧本明确族裔设计面孔，不擅自使用通用亚洲脸或通用西方脸`;
}

/**
 * Rules distilled from the user's curated lead-face reference library.
 * The library is treated as an aesthetic grammar, never as an identity source.
 */
export function buildLeadCharacterExtractionInstruction(
  creationBible?: LeadCharacterDesignBible
): string {
  const style = getStyleLabel(creationBible);
  const context = getContextLabel(creationBible);

  return `【主角形象设计规则】
1. 仅用于 role=主角 的人类角色。参考的是爆款主角脸的审美结构，不得复制现实演员、网红或参考图中的具体身份；必须结合人物性格、阶层、经历和剧情重新设计独立面孔。
2. 主角脸的核心不是单纯大眼、白皮或尖下巴，而是：三庭比例协调、眼距自然、眉眼关系清楚、鼻唇下巴衔接顺畅、骨相轮廓可识别，正脸和轻微侧转都稳定上镜。
3. appearance 必须写出“整体气质 + 发型轮廓 + 脸型骨相 + 眉眼神态 + 鼻唇关系 + 真实皮肤质感”；faceFeatures 必须给出可重复生成的具体结构，避免只写“很帅、很美、高颜值”。
4. 每位主角保留1至2个身份记忆点，例如独特眼型、眉骨走势、鼻尖形态、唇峰、酒窝、痣或下颌转折。记忆点要美观、克制、可跨造型继承，不得堆满稀有特征。
5. 女主方向：颜值目标为漂亮、惊艳、高级、灵动、上镜，必须具有清楚的女性面部表达。轮廓流畅但保留颧面结构，下颌收束自然，不使用宽重男性方颌；眉眼明亮有情绪且比例自然，鼻梁鼻尖精致，唇形与唇峰清楚。美貌必须来自协调骨相与鲜活神态，不是幼态娃娃脸、男性化硬朗脸或同质化网红脸。
6. 男主方向：颜值目标为帅气、英俊、高级、有魅力、上镜，必须具有清楚的男性面部表达。眉骨、眼窝、鼻梁、颧面与下颌线形成自然骨相层次，下巴和颈部结构利落；眉形不做细弯女妆眉，嘴唇不使用明显唇妆。根据人物性格区分清冷、温柔、成熟或危险气质；帅气必须来自协调骨相、眼神和人物气场，温柔男主仍保持男性骨相，不得生成女性化妆面或苍白尖脸。
7. 皮肤必须均匀、清爽、哑光，保留细微纹理和自然血色；允许符合年龄与剧情的轻微瑕疵，但禁止油亮、脏斑、蜡像皮、重磨皮、浓重网红妆和医美塑料感。
8. 必须服从${context}和剧本明确的年龄、性别、族裔、伤病与身份；以${style}的造型语言呈现。创作类型只改变表现媒介，不得把3D/动漫主角重新套成无辨识度的通用模板脸。
9. 提取时必须结合性格、职业、阶层和人物弧光，为主角确定一个清楚的气质原型。女主优先从“清冷明艳、温柔灵动、英气高级、成熟贵气”中选择最匹配的一类；男主优先从“清俊矜贵、硬朗英气、温柔苏感、成熟权威”中选择最匹配的一类，并把该原型落实到 appearance、personality 与 faceFeatures 的具体描述中，不要把互相冲突的气质全部堆在一起。
10. 目标是导演选角级、第一眼有吸引力且经得住近景的主角形象，不是普通证件照、路人脸或网红模板；禁止极端V脸、刀削尖下巴、夸张大眼、眼距失衡、鼻梁过窄、嘴唇过度填充、左右脸机械对称、千篇一律白幼瘦、套用明星姓名或“像某某演员”。
11. looks 中每个有效造型都必须分别填写 costume、hairstyle、accessories、makeup，不能只写“日常装、职场装、古装、自然发型”。服装至少明确外轮廓、上下装结构、腰线或肩线、主辅色、材质和一个签名细节；发型至少明确分缝/刘海、长度、卷直、蓬松度、束发方式及发饰。描述必须能直接用于生图。
12. 现代女主发型按人物气质与场合从以下设计语法中择一深化：中分蓬松短卷发、湿发背头短卷发、超短齐刘海直发、中分八字刘海及胸长发、深侧分长直发、姬发式双侧发髻、中分高马尾、无刘海湿发背头黑长直。现代男主可从：两侧推短狼尾、纹理侧分短发、高颅顶侧分短发、鲻鱼头层次碎发、中分垂顺短发、微分碎盖、利落寸头、低束马尾、侧背油头、摩根碎短发、羊毛卷短发、半扎层次短发、湿发纹理背头、纹理侧分长发、顶部蓬松飞机头、偏分微卷短发、中分锁骨长发、轻薄前刺短发中择一深化。不得机械轮换；必须服从年龄、职业、脸型、性格和剧情阶段。
13. 古代女主发髻与发饰按身份等级选择，可使用金步摇流苏、珍珠垂链发冠、凤凰金冠、玉兰花簪、红绸发带、白羽仙鹤发饰、翡翠牡丹发钗、梅花银簪等设计语法；古代男主可使用束发金冠、玉梁发冠、盘龙冠、竹节银冠、云纹宝冠、翎羽冠饰、山字金冠、花丝冠梁。发饰必须符合身份、礼制和场合，只设一个视觉中心，禁止影楼式满头堆饰。
14. 主角服装要形成“人物衣橱系统”：先固定一种主轮廓、一组主辅色和1至2个签名元素，再随居家、通勤、工作、社交、旅行、行动、高光节点改变剪裁、层次和材质。日常不等于普通，不得反复使用白衬衫配黑裤、普通西装或无结构T恤；每套有效换装至少在廓形、层次、材质、色彩焦点中有两项变化，同时仍能看出属于同一人物。`;
}

export function buildLeadCharacterGenerationDirectives(options: {
  gender?: string;
  creationBible?: LeadCharacterDesignBible;
  name?: string;
  role?: string;
  personality?: string | string[];
  appearance?: string;
  background?: string;
  arc?: string;
}): string[] {
  const gender = normalizeLeadGender(options.gender);
  const style = getStyleLabel(options.creationBible);
  const context = getContextLabel(options.creationBible);
  const characterText = [
    options.name,
    options.role,
    Array.isArray(options.personality) ? options.personality.join('、') : options.personality,
    options.appearance,
    options.background,
    options.arc,
  ].map(normalize).filter(Boolean).join('；');
  const archetype = selectLeadArchetype(gender, characterText);
  const shared = [
    `【主角选角目标】以${style}导演选角与定妆照标准设计独立面孔：第一眼漂亮或帅气、有明星级银幕存在感和主角光环，同时自然可信、耐看且具有故事感；不要普通证件照、素人路人脸、无记忆点商务头像或批量网红脸`,
    '【角色层级必须可见】这张脸必须明显高于普通配角和背景人物的完成度：轮廓更利落、眉眼更有情绪、五官关系更精致、头部轮廓更有记忆点；不能只是端正或普通好看，必须达到剧集封面与海报中心人物的选角等级',
    `【气质原型：${archetype.label}】${archetype.directive}。所有五官、神态和妆发围绕这一种核心气质统一设计，不混搭互相冲突的审美标签`,
    `【面部结构】三庭协调、眼距自然、眉眼关系清楚、鼻唇下巴衔接顺畅，正脸与轻微侧转都稳定上镜；美感来自骨相比例、神态和人物气场，不靠夸张五官`,
    '【身份记忆点】只设置1至2个清楚且可继承的美观特征，例如独特眼型、眉骨走势、鼻尖、唇峰、酒窝、痣或下颌转折；不要把多个网红特征机械拼接在一张脸上',
    `【语境约束】严格符合${context}以及剧本中的年龄、族裔、身份、性格和经历；只借鉴审美结构，不复制任何现实人物或参考图身份`,
    getRegionalCastingDirective(gender, options.creationBible),
    '【皮肤与妆面】肤色均匀、清爽、自然哑光，保留细微皮肤纹理和自然血色；妆容服务人物，不用重磨皮、油亮皮肤、脏斑、蜡像质感或浓重网红妆',
  ];

  if (gender === '女') {
    shared.push('【女主高颜值强约束】漂亮、惊艳、高级、灵动、非常上镜，具有主角光环和独特辨识度；必须一眼识别为女性角色。颧面柔和而有结构，下颌自然收束，不使用宽重男性方颌；眉眼明亮有情绪，鼻尖精致，唇形与唇峰清楚，使用自然克制的女性妆面。美貌来自协调骨相、鲜活神态和人物气质，拒绝男性化硬朗脸、幼态娃娃脸、蛇精脸和批量网红脸');
  } else if (gender === '男') {
    shared.push('【男主高颜值强约束】帅气、英俊、高级、有魅力、非常上镜，具有主角光环和独特辨识度；必须一眼识别为男性角色。眉骨、眼窝、鼻梁、颧面、下颌和颈部形成自然清楚的男性骨相，眉形利落而不做细弯女妆眉，嘴唇不使用明显唇妆。帅气来自协调骨相、专注眼神和人物气场；温柔或清秀仍须保留男性结构，拒绝女性化妆面、油腻硬汉模板和千篇一律的苍白尖脸');
  } else {
    shared.push('【主角脸设计】在不擅自改变性别表达的前提下，以清楚骨相、协调五官、情绪眼神和稳定记忆点建立主角存在感，拒绝模板脸');
  }

  shared.push('【构图与主体】只生成目标主角一人，白色干净背景，正面近景定妆照，85mm人像镜头观感，双眼清晰对焦，脸部无遮挡；不要第二个人、多人合影、拼图、文字或水印');
  shared.push('【审美禁止项】不要普通证件照、路人脸、无记忆点商务头像、极端V脸、刀削尖下巴、夸张大眼、失衡眼距、过窄鼻梁、过度填充嘴唇、机械左右对称、明星仿脸、同质化白幼瘦');
  return shared;
}

export function buildLeadCharacterFinalFaceLock(options: {
  gender?: string;
  creationBible?: LeadCharacterDesignBible;
  name?: string;
  role?: string;
  personality?: string | string[];
  appearance?: string;
  background?: string;
  arc?: string;
}): string[] {
  const gender = normalizeLeadGender(options.gender);
  const style = getStyleLabel(options.creationBible);
  const context = getContextLabel(options.creationBible);
  const characterText = [
    options.name,
    options.role,
    Array.isArray(options.personality) ? options.personality.join('、') : options.personality,
    options.appearance,
    options.background,
    options.arc,
  ].map(normalize).filter(Boolean).join('；');
  const archetype = selectLeadArchetype(gender, characterText);
  const genderTarget = gender === '女'
    ? '一眼明确是漂亮、惊艳、有气质的女主，女性骨相与自然妆面清楚'
    : gender === '男'
      ? '一眼明确是帅气、英俊、有气质的男主，男性骨相与干净妆面清楚'
      : '一眼明确具有中心人物的银幕吸引力与身份辨识度';

  return [
    `【最终主角脸锁·最高优先级】前文所有画风、地域和时代要求都必须服务于主角选角，不得把主角降级为普通路人或模板角色。输出必须是${style}的海报中心人物：${genderTarget}`,
    `【最终气质锁】只强化“${archetype.label}”：${archetype.directive}。必须符合${context}与剧本年龄身份，但不能因为真实、朴素、日常、素颜或白背景而降低颜值与镜头吸引力`,
    '【定妆照而非证件照】采用高端影视选角定妆与美妆杂志肖像的精致布光、眼神塑造、发型轮廓和面部层次；背景保持干净白色，但成片不能像身份证、员工照、普通自拍或电商模特头像',
    '【生成前自检】如果第一眼更像配角、路人、普通商务头像、无记忆点网红脸，或男女主气质不明确，则视为不合格，重新优化骨相比例、眉眼神态、鼻唇关系、发型轮廓和1至2个身份记忆点后再输出；禁止使用现实明星姓名或复制具体真人身份',
  ];
}
