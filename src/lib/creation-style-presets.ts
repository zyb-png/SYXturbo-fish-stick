export type CreationStyleCategory = '2D' | '3D';

export type CreationStyleId =
  | 'jp-tv-anime-2d'
  | 'cn-chibi-2d'
  | 'healing-handdrawn-2d'
  | 'jp-chibi-2d'
  | 'classic-american-2d'
  | 'dramatic-adventure-3d'
  | 'toy-model-3d'
  | 'warm-cinematic-3d';

export interface CreationStylePreset {
  id: CreationStyleId;
  name: string;
  category: CreationStyleCategory;
  summary: string;
  image: string;
  prompt: string;
}

export interface CreationBibleWithStyle {
  creativeStyle?: string;
}

export const CREATION_STYLE_PRESETS: CreationStylePreset[] = [
  {
    id: 'jp-tv-anime-2d',
    name: '日式TV动画卡通风',
    category: '2D',
    summary: '自然动漫比例、清晰线稿、赛璐璐平涂与轻盈电视动画质感',
    image: '/creation-style-presets/01-日式TV动画卡通风.jpg',
    prompt: '日式电视动画二维风格，人物采用自然协调的动漫比例，动物、物体和环境保持统一的动画化造型。线稿清晰流畅，轮廓准确简洁，发型、服装、道具和场景具有明确的二维动画设计感。使用赛璐璐平涂上色，色块边界清楚，以一至两层硬边阴影塑造体积，光影方向统一。角色眼神、嘴型和姿态具有清晰的情绪表现，背景细节经过适度概括，整体像高质量日本电视动画中的静帧画面。干净、轻盈、自然。',
  },
  {
    id: 'cn-chibi-2d',
    name: '国漫Q版卡通风',
    category: '2D',
    summary: '东方审美、精致Q版比例、明快平涂与现代国漫气质',
    image: '/creation-style-presets/02-国漫Q版卡通风.jpg',
    prompt: '国漫Q版二维卡通风格，人物和动物采用可爱但不过度幼化的Q版比例，头部偏大、身体短小、脸型圆润，五官细腻灵动。线条干净流畅，造型兼顾萌感与精致度；根据题材自然融入东方配色、服饰结构、建筑轮廓或装饰纹样。采用明快清爽的平涂色彩和层次简洁的赛璐璐阴影，场景与道具同步进行Q版化概括。整体可爱、清雅、精致，具有现代国产动画的东方审美特征。',
  },
  {
    id: 'healing-handdrawn-2d',
    name: '手绘治愈动画风',
    category: '2D',
    summary: '温暖手绘笔触、生活气息、自然光线与童话般治愈氛围',
    image: '/creation-style-presets/03-手绘治愈动画风.jpg',
    prompt: '手绘治愈二维动画风格，人物、动物、建筑和自然环境采用朴素柔和的手绘造型，比例自然，轮廓圆润，细节带有生活气息。使用温暖克制的自然配色，结合轻柔的传统动画笔触、纸张绘制感和细腻的色彩层次。背景重点表现天空、植物、街道、房屋和自然光线，通过远近虚实、空气透视与环境色营造空间感。画面光影柔和，整体安静、温暖、清新，具有童话故事般的生活感和叙事氛围。',
  },
  {
    id: 'jp-chibi-2d',
    name: '日式Q版卡通风',
    category: '2D',
    summary: '头大身小、萌系表演、柔和配色与清晰易识别的日式Q版造型',
    image: '/creation-style-presets/05-日式Q版卡通风.jpg',
    prompt: '日式Q版二维卡通风格，人物和动物采用头大身小的超变形比例，头部占据视觉主体，身体短小圆润，物体和场景同步进行可爱化、圆润化处理。五官集中简化，眼睛大而明亮，通过眉眼、嘴型和小幅肢体动作清晰表达情绪。采用干净细腻的动漫线稿、清晰平涂色块和轻微赛璐璐阴影，配色柔和明快，造型简洁且易于识别。整体轻松、可爱、亲切，具有日式萌系角色设计的治愈感。',
  },
  {
    id: 'classic-american-2d',
    name: '美式经典卡通风',
    category: '2D',
    summary: '粗黑轮廓、夸张表演、高饱和纯色与经典欧美电视动画节奏',
    image: '/creation-style-presets/06-美式经典卡通风.jpg',
    prompt: '美式经典二维卡通风格，采用粗黑轮廓线和清晰有力的漫画线条，人物、动物、物体和场景均使用简洁、易识别的夸张造型。涉及角色时，放大眼睛、嘴型、眉毛和肢体动作的表演幅度，动作富有弹性、惯性与戏剧张力。画面使用高饱和明亮配色和大面积纯色色块，以简洁明确的硬边卡通阴影表现体积。背景同步进行二维卡通化概括，通过倾斜角度、大小对比和动作线增强节奏，整体轻松幽默、活泼欢乐，具有经典欧美电视动画般的喜剧表现力。',
  },
  {
    id: 'dramatic-adventure-3d',
    name: '戏剧化冒险3D卡通风',
    category: '3D',
    summary: '夸张造型、强动作表演、鲜明灯光与充满冲击力的冒险电影感',
    image: '/creation-style-presets/04-戏剧化冒险3D卡通风.jpg',
    prompt: '戏剧化冒险三维卡通风格，人物、动物、物体和场景具有鲜明、夸张且易识别的造型特征。角色眉眼、嘴型和面部结构富有变化，动作姿态开放有力，肢体语言强调方向、速度和喜剧节奏。采用高品质三维建模与细腻动画材质，轮廓保持卡通化，灯光对比鲜明，构图具有明显的前后层次和动势。场景可通过夸张透视、倾斜角度和大小对比强化冒险感，整体活泼、幽默、充满冲击力和舞台表现力。',
  },
  {
    id: 'toy-model-3d',
    name: '玩具模型摄影风',
    category: '3D',
    summary: '收藏手办质感、微缩模型布景、浅景深与专业棚拍灯光',
    image: '/creation-style-presets/07-玩具模型摄影风.jpg',
    prompt: '玩具模型摄影卡通风格，人物、动物和物体呈现为精致收藏手办，造型适度夸张，结构简洁且具有清楚的角色辨识度。表面使用塑料、树脂或PVC材质，带有细腻涂装、轻微反光和真实模型接缝，服装与道具像经过精细制作的玩具配件。场景采用统一比例的微缩模型布景，通过近距离摄影视角、浅景深和前后虚化突出主体。灯光模拟专业摄影棚或微缩场景拍摄效果，整体像真实拍摄的高品质卡通手办展示画面。',
  },
  {
    id: 'warm-cinematic-3d',
    name: '温暖电影级3D卡通风',
    category: '3D',
    summary: '圆润亲切造型、细腻材质、温暖电影灯光与情感叙事氛围',
    image: '/creation-style-presets/08-温暖电影级3D卡通风.jpg',
    prompt: '温暖电影级三维卡通风格，人物、动物和物体采用圆润饱满、亲切可爱的造型，比例经过适度夸张，轮廓清晰易识别。涉及角色时，使用大而灵动的眼睛、柔和的面部结构和自然丰富的表情变化，突出情绪交流。皮肤、毛发、布料和环境材质细腻柔软，保持明确的动画化特征。画面使用温暖明亮的电影灯光、舒适配色和柔和景深，场景细节丰富但层级清楚，整体温馨、友好、富有情感与故事氛围。',
  },
];

export function getCreationStylePreset(value: unknown): CreationStylePreset | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return CREATION_STYLE_PRESETS.find(preset => preset.id === value.trim());
}

export function getCreationStylePrompt(value: unknown): string {
  return getCreationStylePreset(value)?.prompt || '';
}

export function buildCreationStyleInstruction(value: unknown): string {
  const preset = getCreationStylePreset(value);
  if (!preset) return '';
  return [
    `【固定创作风格：${preset.name}（${preset.category}）】`,
    preset.prompt,
    '这是整部作品的固定视觉风格锁。人物、人物造型、场景、道具、分镜提示词、故事版图片和视频都必须使用同一套造型语言、线条或建模方式、材质、上色、光影与调色；剧情内容只能决定画面里出现什么，不得覆盖、弱化或改写该风格。',
  ].join('\n');
}

export function isCreationStyleCompatible(creationType: unknown, styleId: unknown): boolean {
  const preset = getCreationStylePreset(styleId);
  if (!preset) return true;
  if (creationType === '动漫') return preset.category === '2D';
  if (creationType === '3D') return preset.category === '3D';
  return false;
}
