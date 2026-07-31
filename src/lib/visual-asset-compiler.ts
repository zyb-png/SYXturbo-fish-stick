import sharp from 'sharp';

export type VisualAssetSourceType = 'character' | 'scene' | 'prop';
export type VisualAssetType = VisualAssetSourceType | 'effect';
export type VisualAssetVariant =
  | 'character-face'
  | 'character-look'
  | 'character-four-view'
  | 'scene-base'
  | 'scene-state'
  | 'prop-base'
  | 'prop-state'
  | 'effect';

export type VisualAssetCheckStatus = 'passed' | 'warning' | 'manual';

export interface VisualAssetCheck {
  code: string;
  label: string;
  status: VisualAssetCheckStatus;
  detail: string;
}

export interface VisualAssetPromptCompilation {
  prompt: string;
  assetType: VisualAssetType;
  variant: VisualAssetVariant;
  version: 'visual-assets-v1.0';
  checks: VisualAssetCheck[];
  warnings: string[];
}

export interface VisualAssetQualityReview {
  status: 'passed' | 'warning';
  assetType: VisualAssetType;
  format: string;
  width: number;
  height: number;
  aspectRatio: number;
  expectedAspectRatio: string;
  checks: VisualAssetCheck[];
  warnings: string[];
  manualChecks: string[];
}

export class VisualAssetValidationError extends Error {
  readonly reasons: string[];

  constructor(message: string, reasons: string[] = []) {
    super(message);
    this.name = 'VisualAssetValidationError';
    this.reasons = reasons;
  }
}

interface CompileVisualAssetPromptInput {
  type: string;
  imageVariant?: string;
  rawPrompt: string;
  data?: Record<string, unknown>;
  hasReferenceImage: boolean;
  referenceImageCount?: number;
  isAnimalCreature?: boolean;
  isVisibleEffect?: boolean;
}

interface InspectGeneratedVisualAssetInput {
  buffer: Buffer;
  expectedAspectRatio: string;
  assetType: VisualAssetType;
  variant: VisualAssetVariant;
}

const SUPPORTED_IMAGE_FORMATS = new Set([
  'avif',
  'gif',
  'heif',
  'jpeg',
  'jpg',
  'png',
  'tiff',
  'webp',
]);

const QUALITY_NOISE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\b(?:2K|4K|8K|UHD|HDR)\b/gi, ''],
  [/(?:超高清|高清分辨率|电影级画质|极致细腻的画面细节|极致细腻|极致细节|照片级锐利|细节锐利|线稿锐利|复杂繁复|超多细节)/g, ''],
  [/(?:画面细腻有质感|产品细节清晰可见)/g, '视觉信息清晰'],
];

function normalizePromptQualityLanguage(prompt: string): string {
  let normalized = prompt.trim();
  for (const [pattern, replacement] of QUALITY_NOISE_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/，\s*，+/g, '，')
    .replace(/；\s*；+/g, '；')
    .replace(/；\s*，/g, '；')
    .replace(/，\s*；/g, '；')
    .replace(/^[，；、\s]+|[，；、\s]+$/g, '')
    .trim();
}

function resolveAssetType(input: CompileVisualAssetPromptInput): VisualAssetType {
  if (input.type === 'prop' && input.isVisibleEffect) return 'effect';
  if (input.type === 'character' || input.type === 'scene' || input.type === 'prop') return input.type;
  throw new VisualAssetValidationError(`不支持的视觉资产类型：${input.type || '空'}`);
}

function resolveVariant(
  input: CompileVisualAssetPromptInput,
  assetType: VisualAssetType
): VisualAssetVariant {
  if (assetType === 'effect') return 'effect';
  if (assetType === 'character') {
    if (input.imageVariant === 'character-four-view') return 'character-four-view';
    if (input.imageVariant === 'character-look') return 'character-look';
    return 'character-face';
  }
  if (assetType === 'scene') return input.hasReferenceImage ? 'scene-state' : 'scene-base';
  return input.hasReferenceImage ? 'prop-state' : 'prop-base';
}

function getBoundaryDirective(
  assetType: VisualAssetType,
  variant: VisualAssetVariant,
  isAnimalCreature: boolean
): string {
  if (assetType === 'character') {
    if (variant === 'character-four-view') {
      return isAnimalCreature
        ? '【资产边界·动物四视图】四列只允许重复呈现同一只目标动物，不得出现第二个动物身份、人物、陪同者、场景叙事或独立道具'
        : '【资产边界·人物四视图】四列只允许重复呈现同一个目标人物身份，不得出现第二个人、陌生人脸、陪同者、场景叙事或独立道具';
    }
    return isAnimalCreature
      ? '【资产边界·动物】画面仅呈现一只目标动物，不得出现第二个主体、人物、陪同者、叙事场景或无关道具'
      : '【资产边界·人物】画面仅呈现一位目标人物本人，不得出现第二个人、陌生人脸、陪同者、叙事场景或无关独立道具；服装、发饰及人物佩戴物可以保留';
  }
  if (assetType === 'scene') {
    return '【资产边界·场景】只展示固定空间本身，必须是无人空镜；不得出现人物、人脸、人影、人形轮廓、群众或角色表演，不把临时动作和人物状态写入场景资产';
  }
  if (assetType === 'effect') {
    return '【资产边界·视觉特效】只展示单一可见特效或法术效果本身，不得出现施法者、受术者、人物、身体部位、武器持有动作或完整叙事场景';
  }
  return '【资产边界·道具】只展示同一件道具的一种当前状态，不得出现人物、人脸、手、身体部位、持有者、使用动作、场景表演或第二件完整道具';
}

function getConsistencyDirective(
  assetType: VisualAssetType,
  variant: VisualAssetVariant,
  hasReferenceImage: boolean
): string {
  if (assetType === 'character') {
    if (variant === 'character-face') {
      return '【一致性锚点·人物】建立稳定的人脸身份基准：固定脸型骨骼、眼型与间距、鼻型、嘴型、基础肤色和核心辨识特征，供后续造型与四视图继承';
    }
    if (variant === 'character-four-view') {
      return '【一致性锚点·四视图】人脸身份只继承正脸基准图；服装、发型、身体状态、年龄阶段和整体造型只继承当前造型图；四列必须属于同一身份';
    }
    return '【一致性锚点·人物变体】严格继承参考图的人脸身份与未要求改变的特征，只改变当前造型明确要求的服装、发型、年龄、身体状态或特殊形态';
  }
  if (assetType === 'scene') {
    return hasReferenceImage
      ? '【一致性锚点·场景状态】严格继承参考图的空间结构、固定建筑、装修、主陈设、材质关系、标志物和镜头方向，只改变本状态有剧本依据的日夜、年代或重大持久变化'
      : '【一致性锚点·场景基准】建立稳定可复用的空间结构、材质关系、主陈设和标志物，作为同一地点后续状态的基准';
  }
  if (assetType === 'effect') {
    return '【一致性锚点·视觉特效】固定特效的主色、能量形态、纹样、透明度、边缘光、粒子密度和运动方向，形成可重复识别的视觉规则';
  }
  return hasReferenceImage
    ? '【一致性锚点·道具状态】严格继承参考图的外形、尺寸比例、主体结构、材质、颜色、纹样和识别特征，只改变当前状态明确要求的部分'
    : '【一致性锚点·道具基准】建立稳定可复用的外形、尺寸比例、主体结构、材质、颜色、纹样和识别特征，供后续状态继承';
}

function getStateDirective(assetType: VisualAssetType, variant: VisualAssetVariant): string {
  if (variant === 'scene-state') {
    return '【状态判定】只表现已持续到不同场次并影响后续剧情的明确空间变化；人物进出、镜头变化、情绪、临时天气细节或临时增加少量道具，不得重新设计为场景新状态';
  }
  if (variant === 'prop-state') {
    return '【状态判定】只表现已持续到不同场次、会被后续复用并推动剧情的道具状态；同一场戏中可由视频完成的开合、移动、持握或瞬时变化，不拆成新资产';
  }
  if (variant === 'character-look') {
    return '【状态判定】只改变剧情明确要求且需要后续复用的人物时期、服装、身体或特殊形态，未说明部分继续继承身份基准和父级造型';
  }
  if (assetType === 'effect') {
    return '【状态判定】特效作为独立视觉资产呈现稳定、可复用的完成形态，不描绘人物施放动作或完整镜头过程';
  }
  return '【状态判定】本图建立该资产的首个稳定制作状态，不在同一张图里并列多个状态或变化过程';
}

function getCompositionDirective(
  assetType: VisualAssetType,
  variant: VisualAssetVariant,
  isAnimalCreature: boolean
): string {
  if (variant === 'character-face') {
    return isAnimalCreature
      ? '【构图】1:1身份基准图，单只动物主体完整可辨，背景干净，主体不裁切'
      : '【构图】1:1正脸身份基准图，单人正面近景，五官完整、无遮挡，背景干净';
  }
  if (variant === 'character-look') {
    return isAnimalCreature
      ? '【构图】9:16单主体完整全身设定，动物四肢、爪和尾巴全部可见，背景干净'
      : '【构图】9:16单人完整全身设定，从头到脚全部可见，背景干净';
  }
  if (variant === 'character-four-view') {
    return '【构图】16:9四列技术设定图，特写、正面、左侧面和背面分栏清楚、尺寸一致、地面线对齐，不裁切、不重叠';
  }
  if (assetType === 'scene') {
    return '【构图】16:9无人环境横图，空间结构和前中后景清楚，固定标志物完整可辨，不用人物填充画面';
  }
  if (assetType === 'effect') {
    return '【构图】16:9独立特效参考图，效果主体完整、轮廓和层次清楚，使用干净中性背景，不出现人物或场景叙事';
  }
  return '【构图】16:9单一道具横图，道具居中完整展示、轮廓清楚、不裁切；破碎状态只展示属于同一件道具的必要碎片';
}

function getHardExclusionDirective(assetType: VisualAssetType, variant: VisualAssetVariant): string {
  if (assetType === 'character') {
    return variant === 'character-four-view'
      ? '【必要排除】无第二身份、无陌生人脸、无陪同者、无裁脚、无重叠面板、无文字、无水印'
      : '【必要排除】无第二个人、无陌生人脸、无陪同者、无多余肢体、无文字、无水印';
  }
  if (assetType === 'scene') {
    return '【必要排除】无人物、无人脸、无人影、无人形轮廓、无群众、无字幕、无水印';
  }
  if (assetType === 'effect') {
    return '【必要排除】无施法者、无受术者、无人物、无身体部位、无文字、无水印';
  }
  return '【必要排除】无人物、无人脸、无手、无身体部位、无持有动作、无对比排版、无文字、无水印';
}

function buildPreflightChecks(
  input: CompileVisualAssetPromptInput,
  assetType: VisualAssetType,
  variant: VisualAssetVariant
): VisualAssetCheck[] {
  const checks: VisualAssetCheck[] = [];
  const referenceCount = input.referenceImageCount || 0;

  if (variant === 'character-look' && !input.hasReferenceImage) {
    throw new VisualAssetValidationError('人物造型缺少已确认的正脸或父级造型参考图');
  }
  if (variant === 'character-four-view' && referenceCount < 2) {
    throw new VisualAssetValidationError('人物四视图必须同时提供正脸身份图和当前造型图');
  }
  if ((variant === 'scene-state' || variant === 'prop-state') && !input.hasReferenceImage) {
    throw new VisualAssetValidationError(
      variant === 'scene-state' ? '场景状态缺少基准场景参考图' : '道具状态缺少基准道具参考图'
    );
  }

  checks.push({
    code: 'asset-boundary',
    label: '资产类别边界',
    status: 'passed',
    detail: `已按${assetType === 'effect' ? '视觉特效' : assetType}资产规则隔离人物、场景、道具和特效内容`,
  });
  checks.push({
    code: 'reference-chain',
    label: '参考图依赖',
    status: 'passed',
    detail: input.hasReferenceImage
      ? `已锁定 ${referenceCount || 1} 张参考图并仅改变当前状态`
      : '当前为基准资产，后续状态必须从本图继承',
  });

  const data = input.data || {};
  if (variant === 'scene-state' && !String(data.stateVisualDifference || '').trim()) {
    checks.push({
      code: 'scene-state-evidence',
      label: '场景状态依据',
      status: 'warning',
      detail: '当前场景状态没有独立的视觉差异说明，将严格限制为只继承基准空间并表现已有描述',
    });
  }
  if (variant === 'prop-state' && !String(data.stateVisualChange || '').trim()) {
    checks.push({
      code: 'prop-state-evidence',
      label: '道具状态依据',
      status: 'warning',
      detail: '当前道具状态没有独立的视觉变化说明，将严格限制为只继承基准道具并表现已有描述',
    });
  }

  return checks;
}

export function compileVisualAssetPrompt(
  input: CompileVisualAssetPromptInput
): VisualAssetPromptCompilation {
  const rawPrompt = normalizePromptQualityLanguage(input.rawPrompt || '');
  if (!rawPrompt) {
    throw new VisualAssetValidationError('视觉资产提示词为空，已阻止提交生图');
  }

  const assetType = resolveAssetType(input);
  const variant = resolveVariant(input, assetType);
  const checks = buildPreflightChecks(input, assetType, variant);
  const warnings = checks
    .filter(check => check.status === 'warning')
    .map(check => check.detail);
  const directives = [
    getBoundaryDirective(assetType, variant, Boolean(input.isAnimalCreature)),
    getConsistencyDirective(assetType, variant, input.hasReferenceImage),
    getStateDirective(assetType, variant),
    getCompositionDirective(assetType, variant, Boolean(input.isAnimalCreature)),
    getHardExclusionDirective(assetType, variant),
    '【统一质量语言】结构清楚、材质统一、轮廓自然、细节克制、视觉信息清晰；实际像素与分辨率由接口参数控制，不用画质口号替代资产设计',
  ];

  return {
    prompt: [rawPrompt, ...directives].filter(Boolean).join('；'),
    assetType,
    variant,
    version: 'visual-assets-v1.0',
    checks,
    warnings,
  };
}

function parseAspectRatio(value: string): number | null {
  const match = value.trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) return null;
  return width / height;
}

function getManualChecks(assetType: VisualAssetType, variant: VisualAssetVariant): string[] {
  if (assetType === 'character') {
    if (variant === 'character-four-view') {
      return ['四个面板是否为同一身份', '正脸是否继承身份基准图', '服装和身体状态是否继承当前造型图', '是否出现第二个人或多余身体'];
    }
    return ['画面是否只有一个目标身份', '是否出现陌生人脸或陪同者', '身份锚点是否与参考图一致'];
  }
  if (assetType === 'scene') {
    return ['场景是否为无人空镜', '空间结构和固定标志物是否连续', '是否把临时人物或道具变化误做成新场景'];
  }
  if (assetType === 'effect') {
    return ['是否只展示视觉特效本身', '是否夹带施法者、受术者或身体部位', '特效主色和形态是否可重复识别'];
  }
  return ['是否只展示同一件道具', '是否夹带人物、身体部位或使用动作', '道具形制和材质是否继承基准状态'];
}

export async function inspectGeneratedVisualAsset(
  input: InspectGeneratedVisualAssetInput
): Promise<VisualAssetQualityReview> {
  if (!Buffer.isBuffer(input.buffer) || input.buffer.byteLength < 4_096) {
    throw new VisualAssetValidationError('上游返回的图片文件为空或体积异常，未保存本次结果');
  }

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(input.buffer, { failOn: 'error', animated: false }).metadata();
  } catch (error) {
    throw new VisualAssetValidationError(
      `上游返回的图片无法解析，未保存本次结果：${error instanceof Error ? error.message : '未知格式错误'}`
    );
  }

  const width = metadata.width || 0;
  const height = metadata.height || 0;
  const format = String(metadata.format || '').toLowerCase();
  if (!width || !height) {
    throw new VisualAssetValidationError('上游返回的图片缺少有效宽高，未保存本次结果');
  }
  if (width < 256 || height < 256) {
    throw new VisualAssetValidationError(`上游返回的图片尺寸过小（${width}×${height}），未保存本次结果`);
  }
  if (!SUPPORTED_IMAGE_FORMATS.has(format)) {
    throw new VisualAssetValidationError(`上游返回了不支持的图片格式“${format || '未知'}”，未保存本次结果`);
  }

  const actualRatio = width / height;
  const expectedRatio = parseAspectRatio(input.expectedAspectRatio);
  const checks: VisualAssetCheck[] = [
    {
      code: 'image-decode',
      label: '文件可用性',
      status: 'passed',
      detail: `${format.toUpperCase()} 图片可正常解析`,
    },
    {
      code: 'image-dimensions',
      label: '图片尺寸',
      status: 'passed',
      detail: `${width}×${height}`,
    },
  ];
  const warnings: string[] = [];

  if (expectedRatio) {
    const deviation = Math.abs(actualRatio - expectedRatio) / expectedRatio;
    if (deviation > 0.25) {
      throw new VisualAssetValidationError(
        `上游返回的图片比例为 ${width}:${height}，与请求的 ${input.expectedAspectRatio} 偏差过大，已阻止保存`
      );
    }
    if (deviation > 0.1) {
      const warning = `上游返回的图片比例为 ${width}:${height}，与请求的 ${input.expectedAspectRatio} 略有偏差`;
      warnings.push(warning);
      checks.push({
        code: 'image-aspect-ratio',
        label: '画面比例',
        status: 'warning',
        detail: warning,
      });
    } else {
      checks.push({
        code: 'image-aspect-ratio',
        label: '画面比例',
        status: 'passed',
        detail: `与请求的 ${input.expectedAspectRatio} 一致`,
      });
    }
  }

  checks.push({
    code: 'semantic-review',
    label: '语义边界复核',
    status: 'manual',
    detail: '人物数量、陌生人脸和资产串类属于图像语义，当前先用强提示词约束并列入结果复核项',
  });

  return {
    status: warnings.length > 0 ? 'warning' : 'passed',
    assetType: input.assetType,
    format,
    width,
    height,
    aspectRatio: Number(actualRatio.toFixed(4)),
    expectedAspectRatio: input.expectedAspectRatio,
    checks,
    warnings,
    manualChecks: getManualChecks(input.assetType, input.variant),
  };
}
