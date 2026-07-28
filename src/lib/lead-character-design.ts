export type LeadCharacterDesignBible = {
  creationType?: string;
  subjectRegion?: string;
  creationBackground?: string;
};

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
5. 女主方向：轮廓流畅但保留颧面与下颌结构，眼睛明亮有情绪但比例自然，鼻梁鼻尖精致，唇形清楚、唇峰自然；漂亮、灵动、有故事感，而不是幼态娃娃脸或同质化网红脸。
6. 男主方向：眉骨、眼窝、鼻梁、颧面与下颌线形成清楚而自然的骨相层次；眼神有专注力，唇形和下巴利落，兼顾力量感与青年感。根据人物性格区分清冷、温柔、成熟或危险气质，不得全部生成同一张苍白尖脸。
7. 皮肤必须均匀、清爽、哑光，保留细微纹理和自然血色；允许符合年龄与剧情的轻微瑕疵，但禁止油亮、脏斑、蜡像皮、重磨皮、浓重网红妆和医美塑料感。
8. 必须服从${context}和剧本明确的年龄、性别、族裔、伤病与身份；以${style}的造型语言呈现。创作类型只改变表现媒介，不得把3D/动漫主角重新套成无辨识度的通用模板脸。
9. 禁止项：极端V脸、刀削尖下巴、夸张大眼、眼距失衡、鼻梁过窄、嘴唇过度填充、左右脸机械对称、千篇一律白幼瘦、套用明星姓名或“像某某演员”。`;
}

export function buildLeadCharacterGenerationDirectives(options: {
  gender?: string;
  creationBible?: LeadCharacterDesignBible;
}): string[] {
  const gender = normalize(options.gender);
  const style = getStyleLabel(options.creationBible);
  const context = getContextLabel(options.creationBible);
  const shared = [
    `【主角形象总控】以${style}主角标准重新设计独立面孔：外形惊艳但自然可信，三庭协调、眼距自然、眉眼关系清楚、鼻唇下巴衔接顺畅，正脸与轻微侧转都具有稳定辨识度`,
    '【身份记忆点】只设置1至2个清楚且可继承的美观特征，例如独特眼型、眉骨走势、鼻尖、唇峰、酒窝、痣或下颌转折；不要把多个网红特征机械拼接在一张脸上',
    `【语境约束】严格符合${context}以及剧本中的年龄、族裔、身份、性格和经历；只借鉴审美结构，不复制任何现实人物或参考图身份`,
    '【皮肤与妆面】肤色均匀、清爽、自然哑光，保留细微皮肤纹理和自然血色；妆容服务人物，不用重磨皮、油亮皮肤、脏斑、蜡像质感或浓重网红妆',
  ];

  if (gender === '女') {
    shared.push('【女主脸设计】轮廓流畅但保留颧面和下颌结构，眼睛明亮有情绪且比例自然，鼻梁鼻尖精致，唇形与唇峰清楚；漂亮、灵动、有故事感，拒绝幼态娃娃脸、蛇精脸和批量网红脸');
  } else if (gender === '男') {
    shared.push('【男主脸设计】眉骨、眼窝、鼻梁、颧面和下颌形成自然清楚的骨相层次，眼神专注，唇形与下巴利落；按性格呈现清冷、温柔、成熟或危险气质，拒绝油腻硬汉模板和千篇一律的苍白尖脸');
  } else {
    shared.push('【主角脸设计】在不擅自改变性别表达的前提下，以清楚骨相、协调五官、情绪眼神和稳定记忆点建立主角存在感，拒绝模板脸');
  }

  shared.push('【审美禁止项】不要极端V脸、刀削尖下巴、夸张大眼、失衡眼距、过窄鼻梁、过度填充嘴唇、机械左右对称、明星仿脸、同质化白幼瘦');
  return shared;
}
