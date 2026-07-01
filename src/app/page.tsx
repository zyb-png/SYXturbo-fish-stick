'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  Upload, 
  FileText, 
  Film, 
  Image as ImageIcon, 
  Video, 
  Sparkles,
  CheckCircle2,
  Circle,
  Loader2,
  ChevronRight,
  ChevronDown,
  Download,
  Edit,
  X,
  RefreshCw,
  Undo2,
  MapPin,
  Users,
  Package,
  BookOpen,
  Trash2,
  ImagePlus,
  Plus,
  Save,
  RotateCcw,
  AlertCircle,
  AlertTriangle,
  Copy,
  Eye,
  ZoomIn,
  ZoomOut,
  FolderOpen,
  Settings,
  ArrowRightCircle,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { AssetsFolderManager } from '@/components/assets-folder-manager';
import { ProjectExporter } from '@/components/project-exporter';
import { CreationPointsWallet } from '@/components/creation-points-wallet';
import { ImageLibrarySelector } from '@/components/image-library-selector';
import { StorageMonitor } from '@/components/storage-monitor';
import { WorkspaceModeSwitch } from '@/components/workspace-mode-switch';
import { PasswordInput } from '@/components/password-input';
import { usePersistentState, usePersistentStateManager, STORAGE_KEYS, TokenUsage, INITIAL_TOKEN_USAGE } from '@/hooks/usePersistentState';

interface Chapter {
  chapterNumber: number;
  title: string;
  summary: string;
  characters: string[];
  scenes: string[];
  content: string;
}

interface Outline {
  title: string;
  summary: string;
  totalChapters: number;
  chapters: Chapter[];
}

interface Scene {
  id: number;
  name: string;
  description: string;
  type: string;
  importance: string;
  timeOfDay: string;
  atmosphere: string;
  keyEvents: string[];
  visualElements: string[];
  estimatedDuration: string;
}

// 造型接口
interface CharacterLook {
  id: string;
  scene: string;
  stage?: string;
  description: string;
  costume: string;
  hairstyle: string;
  accessories: string[];
  makeup: string;
  mood: string;
  imageUrl?: string;
  isCustom?: boolean;
  isGenerating?: boolean;
  generatingStatus?: string;
  fourViewImageUrl?: string;
  isGeneratingFourView?: boolean;
  fourViewStatus?: string;
}

// 脸型特征接口
interface FaceFeatures {
  faceShape: string;
  eyes: string;
  nose: string;
  mouth: string;
  skinTone: string;
}

interface Character {
  id: number;
  name: string;
  role: string;
  age: string;
  gender: string;
  personality: string[];
  appearance: string;  // 基本外貌描述（脸型、五官等）
  faceFeatures: FaceFeatures;  // 脸型特征（保持一致性）
  background: string;
  keyRelationships: Array<{ target: string; relationship: string }>;
  arc: string;
  keyScenes: string[];
  looks: CharacterLook[];  // 所有造型
  costume: string[];  // 保留向后兼容
  costumeDetails?: {
    mainOutfit: string;
    accessories: string[];
    colorScheme: string;
    styleNotes: string;
  };
  props: string[];
}

const PLACEHOLDER_TEXT = /待补充|待完善|暂无|未知|默认造型|温和的性格体现在举止间|根据剧情需要，会有不同的服装搭配/;

function isUsefulText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !PLACEHOLDER_TEXT.test(value);
}

function isUsefulList(value: unknown): value is string[] {
  return Array.isArray(value) && value.some(item => isUsefulText(item));
}

function inferCharacterGender(name: string, current?: string): string {
  if (isUsefulText(current)) return current;
  if (/春梅|桂芳|张敏|晓晓|助理|负责人2/.test(name)) return '女';
  return '男';
}

function inferCharacterAge(name: string, current?: string): string {
  if (isUsefulText(current)) return current;
  if (/村长|王叔|老陈|老板|刘总|孙总|钱老板/.test(name)) return '45岁左右';
  if (/李春梅|赵桂芳/.test(name)) return '中年';
  if (/张敏|李晓晓|小助理/.test(name)) return '25岁左右';
  if (/方宇/.test(name)) return '28岁左右';
  return '30岁左右';
}

function inferCharacterRole(name: string, current?: string): string {
  if (isUsefulText(current)) {
    if (current.includes('龙套')) return '龙套';
    if (current.includes('路人')) return '路人';
    if (current.includes('背景') || current.includes('群众')) return '背景人物';
    return current;
  }
  if (name === '方宇') return '主角';
  if (/李春梅|赵桂芳|张敏|周特助|张村长/.test(name)) return '主要配角';
  return '次要配角';
}

function inferCharacterPersonality(name: string, current?: string[]): string[] {
  if (isUsefulList(current)) return current.filter(isUsefulText);
  if (name === '方宇') return ['冷静克制', '证据意识强', '外柔内刚'];
  if (/李春梅|赵桂芳/.test(name)) return ['贪婪算计', '情绪外放', '欺软怕硬'];
  if (/张敏/.test(name)) return ['真诚爽朗', '干练务实', '有分寸感'];
  if (/周特助|助理/.test(name)) return ['专业谨慎', '执行力强', '反应敏捷'];
  if (/老板|刘总|孙总|钱老板/.test(name)) return ['精明现实', '重视利益', '审时度势'];
  return ['性格鲜明', '行动直接', '服务剧情冲突'];
}

function buildCharacterAppearance(character: Partial<Character>): string {
  const name = character.name || '该人物';
  const gender = inferCharacterGender(name, character.gender);
  const age = inferCharacterAge(name, character.age);
  const personality = inferCharacterPersonality(name, character.personality)[0];
  const body = gender === '女' ? '身形匀称，姿态灵活，面部线条柔和但表情有辨识度' : '身材比例匀称，肩背有力，面部轮廓清晰';
  const styling = gender === '女' ? '服装以生活化或职业化搭配为主，颜色和材质随剧情阶段变化' : '服装以日常、商务或工作场景搭配为主，整体干净利落';
  return `${name}是${age}的${gender}性角色，${personality}。${body}，眼神和神态能体现人物当下情绪。${styling}，适合真人短剧写实风格，可根据场景切换不同造型。`;
}

function buildCharacterFaceFeatures(character: Partial<Character>): FaceFeatures {
  const name = character.name || '该人物';
  const gender = inferCharacterGender(name, character.gender);
  return {
    faceShape: gender === '女' ? '鹅蛋脸或柔和椭圆脸，轮廓自然清晰' : '椭圆脸或方中带圆的脸型，轮廓稳定',
    eyes: gender === '女' ? '眼型清晰有神，情绪表达明显' : '眼神专注，眉眼有辨识度',
    nose: '鼻梁自然端正，符合写实真人比例',
    mouth: gender === '女' ? '唇形自然，表情变化细腻' : '唇线清楚，表情克制有力度',
    skinTone: gender === '女' ? '自然肤色，质感干净' : '自然健康肤色，保留真实皮肤质感',
  };
}

function buildCharacterLook(character: Partial<Character>): CharacterLook {
  const name = character.name || '该人物';
  const gender = inferCharacterGender(name, character.gender);
  return {
    id: 'look-1',
    scene: '默认造型',
    description: `${name}的基础出场造型，保持脸型和五官一致，服装根据人物身份与剧情阶段呈现写实短剧质感。`,
    costume: gender === '女' ? '简洁生活装或职业装，颜色自然，方便在不同场景延展' : '简洁日常装或商务装，剪裁利落，贴合人物身份',
    hairstyle: gender === '女' ? '自然披发、低马尾或利落短发，根据场景微调' : '干净短发或自然整理发型',
    accessories: [],
    makeup: gender === '女' ? '自然淡妆' : '自然无妆或轻微修饰',
    mood: '自然',
  };
}

function normalizeCharacterVisualInfo(character: Character): Character {
  const normalized: Character = {
    ...character,
    role: inferCharacterRole(character.name, character.role),
    age: inferCharacterAge(character.name, character.age),
    gender: inferCharacterGender(character.name, character.gender),
    personality: inferCharacterPersonality(character.name, character.personality),
  };

  normalized.appearance = isUsefulText(character.appearance)
    ? character.appearance
    : buildCharacterAppearance(normalized);

  const defaultFaceFeatures = buildCharacterFaceFeatures(normalized);
  normalized.faceFeatures = {
    faceShape: isUsefulText(character.faceFeatures?.faceShape) ? character.faceFeatures.faceShape : defaultFaceFeatures.faceShape,
    eyes: isUsefulText(character.faceFeatures?.eyes) ? character.faceFeatures.eyes : defaultFaceFeatures.eyes,
    nose: isUsefulText(character.faceFeatures?.nose) ? character.faceFeatures.nose : defaultFaceFeatures.nose,
    mouth: isUsefulText(character.faceFeatures?.mouth) ? character.faceFeatures.mouth : defaultFaceFeatures.mouth,
    skinTone: isUsefulText(character.faceFeatures?.skinTone) ? character.faceFeatures.skinTone : defaultFaceFeatures.skinTone,
  };

  normalized.looks = Array.isArray(character.looks) && character.looks.length > 0
    ? character.looks.map((look, index) => {
        const defaultLook = buildCharacterLook(normalized);
        return {
          ...defaultLook,
          ...look,
          id: look.id || `look-${index + 1}`,
          scene: isUsefulText(look.scene) ? look.scene : defaultLook.scene,
          description: isUsefulText(look.description) ? look.description : defaultLook.description,
          costume: isUsefulText(look.costume) ? look.costume : defaultLook.costume,
          hairstyle: isUsefulText(look.hairstyle) ? look.hairstyle : defaultLook.hairstyle,
          accessories: Array.isArray(look.accessories) ? look.accessories.filter(isUsefulText) : [],
          makeup: isUsefulText(look.makeup) ? look.makeup : defaultLook.makeup,
          mood: isUsefulText(look.mood) ? look.mood : defaultLook.mood,
        };
      })
    : [buildCharacterLook(normalized)];

  normalized.background = isUsefulText(character.background)
    ? character.background
    : `${normalized.name}在剧情中承担${normalized.role}功能，主要围绕核心矛盾推进人物关系和事件冲突。`;
  normalized.arc = isUsefulText(character.arc)
    ? character.arc
    : `${normalized.name}随着剧情推进经历立场、情绪或处境变化，形象服务于故事冲突和反转。`;
  normalized.costume = isUsefulList(character.costume) ? character.costume.filter(isUsefulText) : [normalized.looks[0].costume];
  normalized.costumeDetails = {
    mainOutfit: isUsefulText(character.costumeDetails?.mainOutfit) ? character.costumeDetails.mainOutfit : normalized.looks[0].costume,
    accessories: isUsefulList(character.costumeDetails?.accessories) ? character.costumeDetails.accessories.filter(isUsefulText) : normalized.looks[0].accessories,
    colorScheme: isUsefulText(character.costumeDetails?.colorScheme) ? character.costumeDetails.colorScheme : '自然写实配色',
    styleNotes: isUsefulText(character.costumeDetails?.styleNotes) ? character.costumeDetails.styleNotes : '贴合人物身份和短剧现实题材风格',
  };

  return normalized;
}

interface Prop {
  id: number;
  name: string;
  type: string;
  importance: string;
  description: string;
  appearanceScenes: string[];
  owner: string;
  function: string;
  visualDescription: string;
  notes: string;
}

interface Shot {
  shotNumber: number;
  shotType: string;
  description: string;
  characters: Array<{
    name: string;
    dialogue: string;
    dialogueType?: string;
    reaction?: string;
    performance?: string;
    expression?: string;
    facialAction?: string;
    gesture?: string;
    action?: string;
    position?: string;
    actionChange?: string;
  }>;
  scene: {
    location: string;
    time: string;
    atmosphere: string;
    lighting?: string;
    props: string[];
  };
  cameraMovement: string;
  duration: string;
  notes: string;
  emotionalBeat?: string;
  focalLength?: string;
  aperture?: string;
  cameraPosition?: string;
  composition?: string;
  actionAndDialogue?: string;
  shotPurpose?: string;
  cameraAngle?: string;
  actorBlocking?: string;
  actionChange?: string;
  continuity?: string;
  restrictions?: string;
}

interface Storyboard {
  chapterTitle: string;
  wordCount?: number;
  totalShots?: number;
  targetShotCount?: number;
  actualShotCount?: number;
  shots: Shot[];
}

interface ImageStoryboard {
  shotNumber: number;
  originalShot: Shot;
  prompt: string;
  promptEndFrame?: string;  // 尾帧提示词
  imageUrl: string;         // 首帧图片
  imageUrlEndFrame?: string; // 尾帧图片
  imageKey: string;
  imageKeyEndFrame?: string; // 尾帧图片存储key
  chapterTitle?: string;
  error?: string;
  errorEndFrame?: string;   // 尾帧生成错误
}

// 分镜提示词预览
interface ShotPrompt {
  shotNumber: number;
  shotType: string;
  description: string;
  prompt: string;  // 兼容旧版，现在用于首帧提示词
  promptStart?: string;  // 首帧提示词
  promptEnd?: string;    // 尾帧提示词
  isEditing?: boolean;   // 兼容旧版
  isEditingStart?: boolean;  // 首帧是否正在编辑
  isEditingEnd?: boolean;    // 尾帧是否正在编辑
}

interface VideoResult {
  shotNumber: number;
  videoUrl: string;
  lastFrameUrl: string;
  duration: number;
  transition: string;
  error?: string;
  chapterTitle?: string;
}

// 生成任务状态
interface GenerationTask {
  taskId: string;
  type: 'storyboard' | 'imageStoryboard' | 'video';
  chapterNumber: number;
  chapterTitle: string;
  status: 'pending' | 'generating' | 'success' | 'error';
  progress: number;
  total: number;
  message: string;
  startTime: number;
  endTime?: number;
  error?: string;
}

// 分镜图像设置
interface ImageStoryboardSettings {
  ratios: ('16:9' | '9:16' | '4:3' | '1:1')[];  // 画面比例（可多选）
  styles: ('写实' | '超写实' | '科幻' | '文艺' | '浪漫' | '悬疑' | '恐怖' | '电影感' | '超现实' | '极简' | '时尚' | '复古' | '梦幻' | '胶片' | '奇幻' | '搞笑' | '少女' | '自拍' | '街拍' | '高定' | '人像' | '奢华' | '广告' | '黑白' | '霓虹' | '商业' | '电影光' | '性感' | '皮克斯' | '时尚大片' | '赛博朋克' | '高饱和' | '低饱和' | '高端' | '实施' | '俏皮' | '美食' | '摄影' | '高对比' | '动作' | '战斗' | '青春' | '温馨治愈' | '氛围感拉满' | '慵懒松弛' | '忧郁情绪' | '神秘高级' | '梦幻唯美' | '干净通透' | '暗黑压抑' | '8K超清' | '细腻皮肤' | '柔和虚化' | '高清细节' | '颗粒质感' | '色彩柔和' | '真人实拍' | '真人风格' | '写实风格' | '高清写实' | '8K画质')[];  // 画面风格（可多选）
  lighting: ('自然光' | '暖色调' | '冷色调' | '电影感' | '戏剧光效' | '弱冷光' | '弱暖光' | '强冷光' | '强暖光' | '窗边光' | '逆光' | '氛围感' | '正面光' | '侧面光' | '轮廓光' | '顶光' | '底光' | '伦勃朗光' | '昏暗无光' | '硬光' | '远光' | '柔光' | '漫射光' | '氛围感光影' | '电影感光影' | '黄金光' | '丁达尔光' | '光斑' | '高对比光影' | '低保和柔和光' | '发丝光' | '渐变光影')[];  // 光影效果（可多选）
}

// 故事版面板描述项
interface VideoPromptItem {
  shotNumber: number;
  duration: number;
  videoPrompt: string;
  performance?: string;
  isEditing?: boolean;
  imageUrl?: string;           // 首帧图片 URL（用于图生视频）
  imageUrlEndFrame?: string;   // 尾帧图片 URL（用于图生视频）
}

// 单个视频项
interface VideoItem {
  videoId: string;           // 唯一标识
  videoUrl: string;          // 视频URL
  videoKey?: string;         // 云端存储key
  taskId?: string;           // manfei 异步任务 ID
  duration: number;          // 时长（秒）
  shotNumber: number;        // 镜头编号
  prompt: string;            // 使用的提示词
  status: 'generating' | 'success' | 'error';  // 状态
  error?: string;            // 错误信息
  createdAt: number;         // 创建时间
}

// 镜头视频集合 - 每个镜头最多3个视频
interface ShotVideos {
  shotNumber: number;
  videos: VideoItem[];       // 最多3个
}

// 提示词组 - 3-4个镜头打包为一组（约15秒）
interface PromptGroup {
  groupIndex: number;
  shotNumbers: number[];
  combinedPrompt: string;      // 合并后的连冠故事版面板描述
  storyboardImageUrl?: string; // 故事板图片URL
  storyboardImageKey?: string; // 故事板图片存储key
  isGeneratingStoryboard?: boolean;  // 是否正在生成故事板
  storyboardStatus?: string;        // 生成进度文本
  isEditing?: boolean;
  // 两步流：先生成提示词，确认后再出图
  storyboardPromptText?: string;        // 生成的故事板专用提示词
  isGeneratingPrompt?: boolean;         // 是否正在生成提示词
  storyboardPromptConfirmed?: boolean;  // 提示词已确认
}

// 多章节分镜存储
interface ChapterStoryboard {
  chapterNumber: number;
  chapterTitle: string;
  storyboard: Storyboard | null;
  imageStoryboards: ImageStoryboard[];
  status: 'pending' | 'generating' | 'success' | 'error';
  error?: string;  // 错误信息
  // 新增：分步确认状态
  storyboardConfirmed: boolean;  // 文字分镜已确认
  assetsConfirmed: boolean;      // 素材已确认
  promptsConfirmed: boolean;     // 故事版面板描述已确认
  shotPrompts: ShotPrompt[];     // 每个分镜的提示词预览
  videoPrompts?: VideoPromptItem[];  // 故事版面板描述列表（单个镜头）
  promptGroups?: PromptGroup[];      // 3-4镜一组的提示词组（含故事板）
  shotVideos?: ShotVideos[];     // 每个镜头的视频列表
}
interface AssetSingleImage {
  imageId: string; // 唯一标识
  imageUrl: string;
  imageKey?: string; // 可选，云端存储的key
  isCustom?: boolean;
  isFromLibrary?: boolean; // 是否来自图片库
  originalName?: string; // 原始文件名
  isGenerating?: boolean;
  generatingStatus?: string;
  lookId?: string; // 新增：对应的造型ID（如：look-1, look-2）
  lookScene?: string; // 新增：对应的造型场景（如：初见、战斗）
}

// 素材图片集合 - 每个素材可以有多张图片
interface AssetImages {
  assetId: string; // scene-{id} 或 character-{id} 或 prop-{id}
  type: 'scene' | 'character' | 'prop';
  name: string;
  images: AssetSingleImage[];
  lookImages?: Record<string, AssetSingleImage[]>; // 新增：按造型ID存储图片（仅人物使用）
}

// 图片数量限制
const MAX_IMAGES_PER_ASSET = 10;
const BATCH_ASSET_IMAGE_CONCURRENCY = 10;

function normalizeManfeiDuration(value: unknown): number {
  const parsed = Number(value);
  const duration = Number.isFinite(parsed) ? Math.round(parsed) : 15;
  return Math.min(15, Math.max(4, duration));
}

interface ProviderConnectionSettings {
  apiKey: string;
  baseUrl: string;
}

interface LlmConnectionSettings extends ProviderConnectionSettings {
  model: string;
}

interface ManfeiConnectionSettings extends ProviderConnectionSettings {
  model: 'moon-manfei-new';
  resolution: '720p';
}

interface AssetStorageConnectionSettings {
  endpointUrl: string;
  region: string;
  bucketName: string;
  accessPointAlias: string;
  accessKeyId: string;
  secretAccessKey: string;
}

interface AppConnectionSettings {
  llm: LlmConnectionSettings;
  runninghub: ProviderConnectionSettings;
  manfei: ManfeiConnectionSettings;
  assetStorage: AssetStorageConnectionSettings;
}

const DEFAULT_APP_CONNECTION_SETTINGS: AppConnectionSettings = {
  llm: {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
  },
  runninghub: {
    apiKey: '',
    baseUrl: 'https://www.runninghub.cn/openapi/v2',
  },
  manfei: {
    apiKey: '',
    baseUrl: 'http://115.191.42.226:8001',
    model: 'moon-manfei-new',
    resolution: '720p',
  },
  assetStorage: {
    endpointUrl: 'https://tos-cn-beijing.volces.com',
    region: 'cn-beijing',
    bucketName: 'ark-auto-2119577522-cn-beijing-default',
    accessPointAlias: '20260605-019e97c351b07f01a81008cd82b9f393-tosalias',
    accessKeyId: '',
    secretAccessKey: '',
  },
};

const SHOW_DEVELOPER_SETTINGS = process.env.NEXT_PUBLIC_SHOW_DEVELOPER_SETTINGS === 'true';
const LOGIN_REQUIRED_PROMPT = '请先登录账号再继续使用。新账号首次登录赠送 500 创作点。';

// 提取状态接口
interface ExtractionStatus {
  scenes: 'pending' | 'loading' | 'success' | 'error' | 'batch_confirm';
  characters: 'pending' | 'loading' | 'success' | 'error' | 'batch_confirm';
  props: 'pending' | 'loading' | 'success' | 'error' | 'batch_confirm';
  outline: 'pending' | 'loading' | 'success' | 'error' | 'batch_confirm';
}

export default function StoryboardGenerator() {
  // 持久化管理器
  const { clearAll, checkStorageHealth } = usePersistentStateManager();
  
  // 当前激活的标签页（已持久化，刷新后回到之前的位置）
  const [activeTab, setActiveTab] = usePersistentState<string>('storyboard_active_tab', 'extraction');
  const [collapsedPromptChapters, setCollapsedPromptChapters] = usePersistentState<Record<string, boolean>>('storyboard_collapsed_prompt_chapters', {});
  const [collapsedStoryboardChapters, setCollapsedStoryboardChapters] = usePersistentState<Record<string, boolean>>('storyboard_collapsed_storyboard_chapters', {});
  const [collapsedStoryboardTotalChapters, setCollapsedStoryboardTotalChapters] = usePersistentState<Record<string, boolean>>('storyboard_collapsed_storyboard_total_chapters', {});
  
  // 资产刷新触发器（清除数据后递增此值以刷新资产管理组件）
  const [assetRefreshTrigger, setAssetRefreshTrigger] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appConnectionSettings, setAppConnectionSettings] = useState<AppConnectionSettings>(DEFAULT_APP_CONNECTION_SETTINGS);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [loginRequiredOpen, setLoginRequiredOpen] = useState(false);
  const [loginRequiredMessage, setLoginRequiredMessage] = useState(LOGIN_REQUIRED_PROMPT);

  const showLoginRequired = useCallback((message = LOGIN_REQUIRED_PROMPT) => {
    setLoginRequiredMessage(message);
    setLoginRequiredOpen(true);
  }, []);

  const openLoginFromRequired = useCallback(() => {
    setLoginRequiredOpen(false);
    window.dispatchEvent(new CustomEvent('manfei:open-login'));
  }, []);

  const requireLoginBeforePaidAction = useCallback(async () => {
    try {
      const response = await fetch('/api/creation-points', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result?.account?.id) {
        showLoginRequired(LOGIN_REQUIRED_PROMPT);
        return false;
      }
      return true;
    } catch {
      showLoginRequired('暂时无法确认登录状态，请先登录账号后再重试。新账号首次登录赠送 500 创作点。');
      return false;
    }
  }, [showLoginRequired]);

  const updateAppConnectionSetting = useCallback((
    section: keyof AppConnectionSettings,
    field: string,
    value: string
  ) => {
    setAppConnectionSettings(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value,
      },
    }));
  }, []);

  const loadAppConnectionSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const response = await fetch('/api/app-settings', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '读取设置失败');
      }
      setAppConnectionSettings({
        ...DEFAULT_APP_CONNECTION_SETTINGS,
        ...(result.settings || {}),
        llm: {
          ...DEFAULT_APP_CONNECTION_SETTINGS.llm,
          ...(result.settings?.llm || {}),
        },
        runninghub: {
          ...DEFAULT_APP_CONNECTION_SETTINGS.runninghub,
          ...(result.settings?.runninghub || {}),
        },
        manfei: {
          ...DEFAULT_APP_CONNECTION_SETTINGS.manfei,
          ...(result.settings?.manfei || {}),
          model: 'moon-manfei-new',
          resolution: '720p',
        },
        assetStorage: {
          ...DEFAULT_APP_CONNECTION_SETTINGS.assetStorage,
          ...(result.settings?.assetStorage || {}),
        },
      });
    } catch (error: any) {
      console.error('读取设置失败:', error);
      toast.error(error?.message || '读取设置失败');
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  const saveAppConnectionSettings = useCallback(async () => {
    setSettingsSaving(true);
    try {
      const response = await fetch('/api/app-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: appConnectionSettings }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '保存设置失败');
      }
      setAppConnectionSettings({
        ...DEFAULT_APP_CONNECTION_SETTINGS,
        ...(result.settings || {}),
        llm: {
          ...DEFAULT_APP_CONNECTION_SETTINGS.llm,
          ...(result.settings?.llm || {}),
        },
        runninghub: {
          ...DEFAULT_APP_CONNECTION_SETTINGS.runninghub,
          ...(result.settings?.runninghub || {}),
        },
        manfei: {
          ...DEFAULT_APP_CONNECTION_SETTINGS.manfei,
          ...(result.settings?.manfei || {}),
          model: 'moon-manfei-new',
          resolution: '720p',
        },
        assetStorage: {
          ...DEFAULT_APP_CONNECTION_SETTINGS.assetStorage,
          ...(result.settings?.assetStorage || {}),
        },
      });
      toast.success('设置已保存');
      setSettingsOpen(false);
    } catch (error: any) {
      console.error('保存设置失败:', error);
      toast.error(error?.message || '保存设置失败');
    } finally {
      setSettingsSaving(false);
    }
  }, [appConnectionSettings]);

  useEffect(() => {
    if (SHOW_DEVELOPER_SETTINGS) {
      loadAppConnectionSettings();
    }
  }, [loadAppConnectionSettings]);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      const requestHeaders = input instanceof Request ? input.headers : undefined;
      const initHeaders = init?.headers ? new Headers(init.headers) : undefined;
      const skipLoginPrompt =
        requestHeaders?.get('X-Skip-Login-Prompt') === '1' ||
        initHeaders?.get('X-Skip-Login-Prompt') === '1';
      if (response.status === 401) {
        void response.clone().json().then((result) => {
          if (result?.code === 'LOGIN_REQUIRED' && !skipLoginPrompt) {
            showLoginRequired(result.error || LOGIN_REQUIRED_PROMPT);
          }
        }).catch(() => undefined);
      }
      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [showLoginRequired]);
  
  // 列表展开/折叠状态（场景、人物、道具）
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    scenes: false,
    characters: false,
    props: false,
  });
  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const togglePromptChapterCollapsed = (chapterNumber: number) => {
    const key = String(chapterNumber);
    setCollapsedPromptChapters(prev => {
      const currentValue = prev[key] ?? true;
      return { ...prev, [key]: !currentValue };
    });
  };

  const toggleStoryboardChapterCollapsed = (chapterNumber: number) => {
    const key = String(chapterNumber);
    setCollapsedStoryboardChapters(prev => {
      const currentValue = prev[key] ?? true;
      return { ...prev, [key]: !currentValue };
    });
  };

  const toggleStoryboardTotalChapterCollapsed = (chapterNumber: number) => {
    const key = String(chapterNumber);
    setCollapsedStoryboardTotalChapters(prev => {
      const currentValue = prev[key] ?? true;
      return { ...prev, [key]: !currentValue };
    });
  };
  
  // 文字分镜分批生成状态（每4集一批）
  interface BatchInfo {
    active: boolean;
    batchSize: number;
    totalBatches: number;
    completedBatches: number;
  }
  const [batchInfo, setBatchInfo] = usePersistentState<BatchInfo>(STORAGE_KEYS.STORYBOARD_BATCH_INFO, {
    active: false,
    batchSize: 4,
    totalBatches: 0,
    completedBatches: 0,
  });
  
  // 检测是否有被中断的分批生成任务
  useEffect(() => {
    if (batchInfo.active && batchInfo.completedBatches < batchInfo.totalBatches) {
      toast.info(`检测到未完成的文字分镜生成（已完成 ${batchInfo.completedBatches}/${batchInfo.totalBatches} 批），可点击「继续生成第 ${batchInfo.completedBatches + 1} 批」恢复`);
    }
  }, []); // 仅在挂载时检测
  
  // 使用持久化的状态
  const [currentStep, setCurrentStep] = usePersistentState(STORAGE_KEYS.CURRENT_STEP, 0);
  const [uploadedFileName, setUploadedFileName] = usePersistentState<string | null>(STORAGE_KEYS.UPLOADED_FILE, null);
  const [fileContent, setFileContent] = usePersistentState(STORAGE_KEYS.FILE_CONTENT, '');
  
  // 四个并行提取结果
  const [scenesData, setScenesData] = usePersistentState<any>(STORAGE_KEYS.SCENES_DATA, null);
  const [charactersData, setCharactersData] = usePersistentState<any>(STORAGE_KEYS.CHARACTERS_DATA, null);
  const [propsData, setPropsData] = usePersistentState<any>(STORAGE_KEYS.PROPS_DATA, null);
  const [outline, setOutline] = usePersistentState<Outline | null>(STORAGE_KEYS.OUTLINE, null);
  
  // 大纲分批提取信息
  interface OutlineBatchInfo {
    currentBatch: number;
    totalBatches: number;
    hasMore: boolean;
    totalEpisodes: number;
    basicInfo: { title: string; summary: string } | null;
    allChapters: Chapter[];  // 已提取的所有章节
    episodeMarkers: Array<{ number: number; marker: string }> | number[];  // 所有集数标记数组
  }
  const [outlineBatchInfo, setOutlineBatchInfo] = usePersistentState<OutlineBatchInfo | null>(STORAGE_KEYS.OUTLINE_BATCH_INFO, null);
  const outlineAutoResumeRef = useRef(false);
  
  // 场景分批提取信息
  interface SceneBatchInfo {
    currentBatch: number;
    totalBatches: number;
    hasMore: boolean;
    sceneMarkers: string[];  // 所有场景名称
    allScenes: any[];  // 已提取的所有场景
  }
  const [sceneBatchInfo, setSceneBatchInfo] = usePersistentState<SceneBatchInfo | null>(STORAGE_KEYS.SCENE_BATCH_INFO, null);
  
  // 人物分批提取信息
  interface CharacterBatchInfo {
    currentBatch: number;
    totalBatches: number;
    hasMore: boolean;
    characterMarkers: string[];  // 所有人物名称
    allCharacters: any[];  // 已提取的所有人物
  }
  const [characterBatchInfo, setCharacterBatchInfo] = usePersistentState<CharacterBatchInfo | null>(STORAGE_KEYS.CHARACTER_BATCH_INFO, null);
  
  // 道具分批提取信息
  interface PropBatchInfo {
    currentBatch: number;
    totalBatches: number;
    hasMore: boolean;
    propMarkers: string[];  // 所有道具名称
    allProps: any[];  // 已提取的所有道具
  }
  const [propBatchInfo, setPropBatchInfo] = usePersistentState<PropBatchInfo | null>(STORAGE_KEYS.PROP_BATCH_INFO, null);
  
  // 提取状态
  const [extractionStatus, setExtractionStatus] = usePersistentState<ExtractionStatus>(
    STORAGE_KEYS.EXTRACTION_STATUS,
    {
      scenes: 'pending',
      characters: 'pending',
      props: 'pending',
      outline: 'pending',
    }
  );
  
  // Token 使用统计
  const [tokenUsage, setTokenUsage] = usePersistentState<TokenUsage>(
    STORAGE_KEYS.TOKEN_USAGE,
    INITIAL_TOKEN_USAGE
  );
  
  // 步骤确认状态
  const [stepConfirmed, setStepConfirmed] = usePersistentState<{
    upload: boolean;
    extraction: boolean;
    storyboard: boolean;
    assets: boolean;
    prompts: boolean;
    videos: boolean;
  }>(
    STORAGE_KEYS.STEP_CONFIRMED,
    {
      upload: false,
      extraction: false,
      storyboard: false,
      assets: false,
      prompts: false,
      videos: false,
    }
  );
  
  const [selectedChapter, setSelectedChapter] = usePersistentState<Chapter | null>(STORAGE_KEYS.SELECTED_CHAPTER, null);
  const [storyboard, setStoryboard] = usePersistentState<Storyboard | null>(STORAGE_KEYS.STORYBOARD, null);
  const [imageStoryboards, setImageStoryboards] = usePersistentState<ImageStoryboard[]>(STORAGE_KEYS.IMAGE_STORYBOARDS, []);
  const [connectingPrompts, setConnectingPrompts] = usePersistentState<any>(STORAGE_KEYS.CONNECTING_PROMPTS, null);
  const [videoResults, setVideoResults] = usePersistentState<VideoResult[]>(STORAGE_KEYS.VIDEO_RESULTS, []);
  const [videoTotalDuration, setVideoTotalDuration] = usePersistentState<number>(STORAGE_KEYS.VIDEO_TOTAL_DURATION, 0);
  const [progress, setProgress] = usePersistentState(STORAGE_KEYS.PROGRESS, 0);
  
  // 视频格式选择
  const [videoRatio, setVideoRatio] = usePersistentState<'16:9' | '9:16'>(STORAGE_KEYS.VIDEO_RATIO, '9:16');
  
  // 全局分镜提示词设置
  const [globalImageSettings, setGlobalImageSettings] = usePersistentState<ImageStoryboardSettings>(
    'globalImageSettings',
    {
      ratios: ['9:16'],
      styles: [],
      lighting: [],
    }
  );
  
  // 正在生成提示词的章节编号列表（支持多章节并行）- 不持久化，页面刷新后重置
  const [generatingPromptsChapters, setGeneratingPromptsChapters] = useState<number[]>([]);
  
  // 素材图片状态 - 转换为对象便于持久化
  const [assetImagesObj, setAssetImagesObj] = usePersistentState<Record<string, AssetImages>>(STORAGE_KEYS.ASSET_IMAGES, {});
  
  // 数据版本号 - 用于强制刷新旧数据
  const [dataVersion, setDataVersion] = usePersistentState<string>('storyboard_data_version', '5');
  
  // 多章节分镜存储（新增）
  const [chapterStoryboards, setChapterStoryboards] = usePersistentState<Record<number, ChapterStoryboard>>(
    'storyboard_chapter_storyboards' as any,
    {}
  );
  
  // 非持久化状态
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const storyboardAbortControllerRef = useRef<AbortController | null>(null);
  const storyboardBatchCancelledRef = useRef(false);
  const [editingPrompt, setEditingPrompt] = useState<{ type: 'image' | 'video'; shotNumber: number; prompt: string; chapterNumber?: number; frameType?: 'start' | 'end' } | null>(null);
  const [regeneratingShot, setRegeneratingShot] = useState<number | null>(null);
  
  // 人物描述编辑状态
  const [editingCharacterId, setEditingCharacterId] = useState<number | null>(null);
  const [editingCharacterAppearance, setEditingCharacterAppearance] = useState<string>('');
  // 造型提示词编辑状态
  const [editingLookKey, setEditingLookKey] = useState<string | null>(null);
  const [editingLookDescription, setEditingLookDescription] = useState<string>('');
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [batchAssetGeneration, setBatchAssetGeneration] = useState<{
    type: 'scene' | 'character' | 'prop' | null;
    current: number;
    total: number;
    currentName: string;
  }>({
    type: null,
    current: 0,
    total: 0,
    currentName: '',
  });
  
  // 场景描述编辑状态
  const [editingSceneId, setEditingSceneId] = useState<number | null>(null);
  const [editingSceneDescription, setEditingSceneDescription] = useState<string>('');
  
  // 生成任务状态（支持并行生成）
  const [generationTasks, setGenerationTasks] = useState<GenerationTask[]>([]);
  const [showRestoreToast, setShowRestoreToast] = useState(false);
  
  // 图片预览状态
  const [previewImage, setPreviewImage] = useState<{
    url: string;
    name: string;
    type: string;
  } | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  
  // 检查 localStorage 健康状态（仅开发环境）
  useEffect(() => {
    if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
      setTimeout(() => {
        console.log('[数据持久化] 检查 localStorage 健康状态...');
        const health = checkStorageHealth?.();
        if (health) {
          console.log('[数据持久化] localStorage 状态:', {
            总键数: health.totalKeys,
            分镜相关键数: health.storyboardKeys,
            总大小: `${(health.totalSize / 1024).toFixed(2)} KB`,
            配额使用: `${health.quotaUsed.toFixed(2)}%`,
            有效数据键数: health.keys.filter(k => k.hasData).length,
          });
          
          if (health.storyboardKeys === 0) {
            console.warn('[数据持久化] ⚠️ 未找到任何分镜数据！刷新后数据可能丢失');
          }
        }
      }, 1000);
    }
  }, [checkStorageHealth]);
  
  // 打开图片预览
  const openImagePreview = useCallback((url: string, name: string, type: string) => {
    setPreviewImage({ url, name, type });
    setPreviewZoom(1);
  }, []);
  
  // 关闭图片预览
  const closeImagePreview = useCallback(() => {
    setPreviewImage(null);
    setPreviewZoom(1);
  }, []);
  
  // 预览缩放控制
  const handlePreviewZoomIn = useCallback(() => {
    setPreviewZoom(prev => Math.min(prev + 0.25, 3));
  }, []);
  
  const handlePreviewZoomOut = useCallback(() => {
    setPreviewZoom(prev => Math.max(prev - 0.25, 0.25));
  }, []);
  
  // 键盘事件处理（预览）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (previewImage) {
        if (e.key === 'Escape') {
          closeImagePreview();
        } else if (e.key === '+' || e.key === '=') {
          handlePreviewZoomIn();
        } else if (e.key === '-') {
          handlePreviewZoomOut();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewImage, closeImagePreview, handlePreviewZoomIn, handlePreviewZoomOut]);
  
  // 图片库选择器状态
  const [imageLibraryOpen, setImageLibraryOpen] = useState(false);
  const [librarySelectTarget, setLibrarySelectTarget] = useState<{
    type: 'scene' | 'character' | 'prop';
    id: string;
    name: string;
  } | null>(null);
  
  // 安全的 API 响应处理函数
  const safeApiCall = useCallback(async (response: Response): Promise<any> => {
    if (!response.ok) {
      // 尝试解析错误信息
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const text = await response.text();
        // 尝试解析为 JSON
        try {
          const json = JSON.parse(text);
          if (json.error) {
            errorMessage = json.error;
          }
        } catch {
          // 如果不是 JSON，检查是否是 HTML
          if (text.includes('<!DOCTYPE') || text.includes('<html')) {
            // 504 通常是网关超时，提供更详细的建议
            if (response.status === 504) {
              errorMessage = `请求超时 (504 Gateway Timeout)\n\n故事版面板描述生成需要较长时间，服务器可能正在处理中。\n\n建议：\n1. 等待 30 秒后重新点击按钮\n2. 刷新页面后查看是否已生成成功\n3. 如果问题持续，请尝试减少分镜数量`;
            } else {
              errorMessage = `服务器错误 (${response.status})，请刷新页面后重试`;
            }
          } else {
            errorMessage = text.slice(0, 200);
          }
        }
      } catch {
        // 忽略解析错误
      }
      throw new Error(errorMessage);
    }
    return response.json();
  }, []);
  
  // 网络错误处理函数 - 提供更有用的错误信息
  const getNetworkErrorMessage = useCallback((error: unknown, operation: string): string => {
    // 检查是否是中止错误（超时）
    if (error instanceof Error && error.name === 'AbortError') {
      return `请求超时，${operation}耗时较长。\n\n建议：\n1. 请等待 30 秒后重新尝试\n2. 如果问题持续，请联系技术支持`;
    }
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      return `网络连接失败，无法${operation}。\n可能原因：\n1. 网络连接不稳定\n2. 服务暂时不可用\n\n建议：\n1. 检查网络连接\n2. 刷新页面后重试\n3. 如果问题持续，请稍后再试`;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return `${operation}失败`;
  }, []);
  
  // 打开图片库选择器
  const openImageLibrary = useCallback((type: 'scene' | 'character' | 'prop', id: number, name: string) => {
    setLibrarySelectTarget({ type, id: String(id), name });
    setImageLibraryOpen(true);
  }, []);
  
  // 从图片库选择图片后添加到素材
  const handleLibraryImageSelect = useCallback(async (imageUrl: string, imageName: string) => {
    if (!librarySelectTarget) return;
    
    const { type, id, name } = librarySelectTarget;
    // 使用素材名称作为 assetId，确保唯一性（名称是唯一的）
    const assetId = `${type}-${name}`;
    
    try {
      // 添加新图片
      const newImage = {
        imageId: `library-${Date.now()}`,
        imageUrl,
        isCustom: true,
        isFromLibrary: true,
        originalName: imageName,
      };
      
      // 统一通过 setAssetImages 更新状态（会自动持久化）
      // 在回调中获取现有图片并合并
      setAssetImages(prev => {
        const existing = prev.get(assetId);
        const existingImages = existing?.images || [];
        const updatedImages = [...existingImages, newImage];
        
        const newMap = new Map(prev);
        newMap.set(assetId, {
          assetId,
          type,
          name: name,
          images: updatedImages,
        });
        return newMap;
      });
      
      toast.success(`已从图片库添加图片到 ${name}`);
    } catch (error) {
      console.error('添加图片失败:', error);
      toast.error('添加图片失败');
    }
  }, [librarySelectTarget]);
  
  // 生成进度详情状态
  const [generationProgress, setGenerationProgress] = useState<{
    isGenerating: boolean;
    currentStep: string;
    current: number;
    total: number;
    message: string;
    completedItems: any[];
  }>({
    isGenerating: false,
    currentStep: '',
    current: 0,
    total: 0,
    message: '',
    completedItems: [],
  });
  
  const fileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});
  
  // Map 转换辅助函数
  const getAssetImagesMap = useCallback(() => {
    return new Map(Object.entries(assetImagesObj));
  }, [assetImagesObj]);
  
  const setAssetImagesFromMap = useCallback((map: Map<string, AssetImages>) => {
    setAssetImagesObj(Object.fromEntries(map));
  }, [setAssetImagesObj]);
  
  // 本地 Map 状态（用于操作），同步到持久化存储
  const [assetImages, setAssetImagesLocal] = useState<Map<string, AssetImages>>(new Map());
  
  // 使用 ref 追踪上一次的值，避免循环同步
  const lastSyncedRef = useRef<string>('');
  const hasInitializedRef = useRef(false); // 确保只初始化一次
  
  // 从持久化存储恢复到本地 Map（仅在初始化时）
  // 注意：这里直接从 localStorage 读取，避免与 usePersistentState 的 useEffect 执行顺序问题
  useEffect(() => {
    // 已经初始化过就不再执行
    if (hasInitializedRef.current) return;
    
    // 标记为已初始化
    hasInitializedRef.current = true;
    
    // 直接从 localStorage 读取数据，确保获取最新值
    const CURRENT_DATA_VERSION = '7';
    let storedVersion: string | null = null;
    let storedAssetImages: Record<string, AssetImages> = {};
    
    try {
      const versionItem = localStorage.getItem('storyboard_data_version');
      storedVersion = versionItem ? JSON.parse(versionItem) : null;
      const assetImagesItem = localStorage.getItem('storyboard_asset_images');
      storedAssetImages = assetImagesItem ? JSON.parse(assetImagesItem) : {};
    } catch (e) {
      console.error('[素材图片] 读取 localStorage 失败', e);
    }
    
    // 检查数据版本，不同版本只做兼容处理不清除数据
    if (storedVersion !== CURRENT_DATA_VERSION) {
      console.log(`[素材图片] 数据版本 (${storedVersion || '无'} -> ${CURRENT_DATA_VERSION})，进行兼容处理`);
      setDataVersion(CURRENT_DATA_VERSION);
    }
    
    // 无论版本是否匹配，只要 localStorage 中有素材图片数据就恢复
    if (Object.keys(storedAssetImages).length > 0) {
      hasInitializedRef.current = true;
      const objStr = JSON.stringify(storedAssetImages);
      // 只有当持久化数据与当前本地数据不同时才恢复
      if (lastSyncedRef.current !== objStr) {
        lastSyncedRef.current = objStr;
        
        // 去重处理：确保每个素材中的 imageId 唯一
        // 同时清除 isGenerating 状态（防止卡在加载中）
        const deduplicatedObj: Record<string, AssetImages> = {};
        
        for (const [key, value] of Object.entries(storedAssetImages)) {
          const asset = value as AssetImages;
          
          // 去重 URL 并重新生成 imageId，确保唯一性
          const seenUrls = new Set<string>();
          const uniqueImages: typeof asset.images = [];
          let idx = 0;
          
          for (const img of asset.images) {
            if (!seenUrls.has(img.imageUrl) && img.imageUrl) {
              seenUrls.add(img.imageUrl);
              uniqueImages.push({
                ...img,
                imageId: `${key}-${idx++}`, // 重新生成唯一的 imageId
                isGenerating: false, // 清除生成中状态
              });
            } else if (!img.imageUrl) {
              // 没有 URL 且正在生成的图片，跳过（可能是中断的生成任务）
              console.warn(`[素材图片] 跳过无 URL 的图片: ${img.imageId}`);
            } else {
              console.warn(`[素材图片] 跳过重复 URL: ${img.imageUrl}`);
            }
          }
          
          deduplicatedObj[key] = {
            ...asset,
            images: uniqueImages,
          };
        }
        
        setAssetImagesLocal(new Map(Object.entries(deduplicatedObj)));
        console.log('[素材图片] 从持久化存储恢复:', Object.keys(deduplicatedObj).length, '个素材');
      }
    }

    // 自动清理卡死的生成状态（刷新后恢复的 isGenerating 标记）
    try {
      const storedCharacters = localStorage.getItem('storyboard_characters_data');
      if (storedCharacters) {
        const parsed = JSON.parse(storedCharacters);
        if (parsed && Array.isArray(parsed.characters)) {
          let hasStaleState = false;
          const cleaned = parsed.characters.map((char: any) => ({
            ...char,
            looks: char.looks?.map((l: any) => {
              if (l.isGenerating || l.isGeneratingFourView) {
                hasStaleState = true;
                return { ...l, isGenerating: false, generatingStatus: undefined, isGeneratingFourView: false, fourViewStatus: undefined };
              }
              return l;
            }),
          }));
          if (hasStaleState) {
            setCharactersData((prev: any) => {
              if (!prev || !prev.characters) return prev;
              return { ...prev, characters: cleaned };
            });
            console.log('[自动修复] 清理了卡死的造型生成状态');
          }
        }
      }
    } catch (e) {
      console.warn('清理卡死状态失败:', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 空依赖项，只在组件挂载时执行一次

  useEffect(() => {
    if (!charactersData?.characters || !Array.isArray(charactersData.characters)) return;

    const normalizedCharacters = charactersData.characters.map((char: Character) => normalizeCharacterVisualInfo(char));
    const original = JSON.stringify(charactersData.characters);
    const normalized = JSON.stringify(normalizedCharacters);

    if (original !== normalized) {
      setCharactersData((prev: any) => {
        if (!prev || !Array.isArray(prev.characters)) return prev;
        return {
          ...prev,
          characters: prev.characters.map((char: Character) => normalizeCharacterVisualInfo(char)),
        };
      });

      if (characterBatchInfo?.allCharacters?.length) {
        setCharacterBatchInfo(prev => {
          if (!prev?.allCharacters?.length) return prev;
          return {
            ...prev,
            allCharacters: prev.allCharacters.map((char: Character) => normalizeCharacterVisualInfo(char)),
          };
        });
      }

      console.log('[人物形象] 已补全缺失的人物形象字段');
    }
  }, [charactersData, characterBatchInfo, setCharactersData, setCharacterBatchInfo]);
  
  // 本地 Map 变化时同步到持久化存储
  const setAssetImages = useCallback((updater: (prev: Map<string, AssetImages>) => Map<string, AssetImages>) => {
    setAssetImagesLocal(prev => {
      const newMap = updater(prev);
      const newObj = Object.fromEntries(newMap);
      const objStr = JSON.stringify(newObj);
      
      // 只有当数据真正变化时才同步
      if (lastSyncedRef.current !== objStr) {
        lastSyncedRef.current = objStr;
        setAssetImagesObj(newObj);
        console.log('[素材图片] 保存到持久化存储:', Object.keys(newObj).length, '个素材');
      }
      
      return newMap;
    });
  }, [setAssetImagesObj]);
  
  // 检测是否有恢复的数据
  useEffect(() => {
    if (fileContent && !showRestoreToast) {
      setShowRestoreToast(true);
      toast.success('已恢复上次的工作进度', {
        description: '所有数据已自动保存',
        action: {
          label: '重新开始',
          onClick: () => handleClearAllData(),
        },
      });
    }
  }, []);

  // 自动修复 storyboardConfirmed 状态
  // 用于取消角色造型图片生成的 AbortController
  const lookAbortControllers = useRef<Map<string, AbortController>>(new Map());

  const getLookGenerationKey = (character: any, lookId: string) => {
    return `${character?.id ?? character?.name ?? 'unknown'}-${character?.name ?? 'unknown'}-${lookId}`;
  };

  // 取消角色造型图片生成
  const cancelLookGeneration = (character: any, lookId: string) => {
    const generationKey = getLookGenerationKey(character, lookId);
    // 先中止正在进行的请求
    const controller = lookAbortControllers.current.get(generationKey);
    if (controller) {
      controller.abort();
      lookAbortControllers.current.delete(generationKey);
    }
    // 无论是否有 controller，都重置状态（防止点击时 controller 尚未注册的竞态）
    updateLookById(lookId, { isGenerating: false, generatingStatus: undefined }, character);
    toast.info('已取消造型图片生成');
  };

  // 当章节成功生成分镜但 storyboardConfirmed 为 false 时自动修复
  const storyboardFixAppliedRef = useRef(false);
  useEffect(() => {
    // 只在初始化时执行一次
    if (storyboardFixAppliedRef.current) return;
    
    const chaptersToFix = Object.values(chapterStoryboards).filter(
      cs => cs.status === 'success' && cs.storyboard?.shots && cs.storyboard.shots.length > 0 && !cs.storyboardConfirmed
    );
    
    if (chaptersToFix.length > 0) {
      storyboardFixAppliedRef.current = true;
      console.log(`[自动修复] 发现 ${chaptersToFix.length} 个章节的 storyboardConfirmed 状态需要修复`);
      
      setChapterStoryboards(prev => {
        const updated = { ...prev };
        Object.keys(updated).forEach(key => {
          const chapterNum = parseInt(key);
          const chapter = updated[chapterNum];
          if (chapter && chapter.status === 'success' && chapter.storyboard?.shots && chapter.storyboard.shots.length > 0 && !chapter.storyboardConfirmed) {
            updated[chapterNum] = {
              ...chapter,
              storyboardConfirmed: true,
            };
          }
        });
        return updated;
      });
    }
  }, [chapterStoryboards, setChapterStoryboards]);

  // 清除所有数据（包括本地状态和S3资产）
  const handleClearAllData = useCallback(async () => {
    if (!(await requireLoginBeforePaidAction())) return;

    try {
      // 先清除本地和云端资产文件
      const response = await fetch('/api/clear-assets', {
        method: 'POST',
      });
      const result = await response.json();
      
      if (result.success) {
        const localDeleted = result.local?.totalDeleted ?? 0;
        const s3Deleted = result.s3?.totalDeleted ?? 0;
        console.log(`已清除资产: 本地 ${localDeleted} 个文件，云端 ${s3Deleted} 个文件`);
      } else {
        console.warn('清除资产失败:', result.error);
      }
    } catch (error) {
      console.warn('清除资产请求失败:', error);
    }

    // 清除本地状态
    clearAll();
    setCurrentStep(0);
    setUploadedFileName(null);
    setFileContent('');
    setScenesData(null);
    setCharactersData(null);
    setPropsData(null);
    setOutline(null);
    setSelectedChapter(null);
    setStoryboard(null);
    setImageStoryboards([]);
    setConnectingPrompts(null);
    setVideoResults([]);
    setVideoTotalDuration(0);
    setProgress(0);
    setVideoRatio('9:16');
    setAssetImagesObj({});
    setAssetImagesLocal(new Map());
    setStepConfirmed({
      upload: false,
      extraction: false,
      storyboard: false,
      assets: false,
      prompts: false,
      videos: false,
    });
    setExtractionStatus({
      scenes: 'pending',
      characters: 'pending',
      props: 'pending',
      outline: 'pending',
    });
    // 触发资产管理组件刷新
    setAssetRefreshTrigger(prev => prev + 1);
    toast.success('已清除所有数据，可以重新开始');
  }, [clearAll, setCurrentStep, setUploadedFileName, setFileContent, setScenesData, 
      setCharactersData, setPropsData, setOutline, setSelectedChapter, setStoryboard,
      setImageStoryboards, setConnectingPrompts, setVideoResults, setVideoTotalDuration,
      setProgress, setVideoRatio, setAssetImagesObj, setStepConfirmed, setExtractionStatus,
      requireLoginBeforePaidAction]);

  const steps = [
    { title: '上传文件', icon: Upload },
    { title: '并行提取', icon: Sparkles },
    { title: '生成分镜', icon: Film },
    { title: '素材确认', icon: Package },
    { title: '提示词确认', icon: FileText },
    { title: '生成视频', icon: Video },
  ];

  // 导出项目
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [exportingPromptChapter, setExportingPromptChapter] = useState<number | null>(null);

  const getDownloadFilename = (contentDisposition: string | null, fallback: string) => {
    if (!contentDisposition) return fallback;

    const encodedMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (encodedMatch?.[1]) return decodeURIComponent(encodedMatch[1]);

    const plainMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
    return plainMatch?.[1] ? decodeURIComponent(plainMatch[1]) : fallback;
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }, 30_000);
  };

  const buildEditableProjectState = () => ({
    storyboard_active_tab: activeTab,
    storyboard_collapsed_prompt_chapters: collapsedPromptChapters,
    storyboard_collapsed_storyboard_chapters: collapsedStoryboardChapters,
    storyboard_collapsed_storyboard_total_chapters: collapsedStoryboardTotalChapters,
    storyboard_data_version: dataVersion,
    globalImageSettings,
    [STORAGE_KEYS.STORYBOARD_BATCH_INFO]: batchInfo,
    [STORAGE_KEYS.CURRENT_STEP]: currentStep,
    [STORAGE_KEYS.UPLOADED_FILE]: uploadedFileName,
    [STORAGE_KEYS.FILE_CONTENT]: fileContent,
    [STORAGE_KEYS.SCENES_DATA]: scenesData,
    [STORAGE_KEYS.CHARACTERS_DATA]: charactersData,
    [STORAGE_KEYS.PROPS_DATA]: propsData,
    [STORAGE_KEYS.OUTLINE]: outline,
    [STORAGE_KEYS.OUTLINE_BATCH_INFO]: outlineBatchInfo,
    [STORAGE_KEYS.SCENE_BATCH_INFO]: sceneBatchInfo,
    [STORAGE_KEYS.CHARACTER_BATCH_INFO]: characterBatchInfo,
    [STORAGE_KEYS.PROP_BATCH_INFO]: propBatchInfo,
    [STORAGE_KEYS.EXTRACTION_STATUS]: extractionStatus,
    [STORAGE_KEYS.TOKEN_USAGE]: tokenUsage,
    [STORAGE_KEYS.STEP_CONFIRMED]: stepConfirmed,
    [STORAGE_KEYS.SELECTED_CHAPTER]: selectedChapter,
    [STORAGE_KEYS.STORYBOARD]: storyboard,
    [STORAGE_KEYS.IMAGE_STORYBOARDS]: imageStoryboards,
    [STORAGE_KEYS.CONNECTING_PROMPTS]: connectingPrompts,
    [STORAGE_KEYS.VIDEO_RESULTS]: videoResults,
    [STORAGE_KEYS.VIDEO_TOTAL_DURATION]: videoTotalDuration,
    [STORAGE_KEYS.PROGRESS]: progress,
    [STORAGE_KEYS.VIDEO_RATIO]: videoRatio,
    [STORAGE_KEYS.ASSET_IMAGES]: assetImagesObj,
    [STORAGE_KEYS.CHAPTER_STORYBOARDS]: chapterStoryboards,
  });

  const handleExportChapterPrompts = async (cs: ChapterStoryboard) => {
    if (!(await requireLoginBeforePaidAction())) return;

    if (!cs.videoPrompts?.length && !cs.promptGroups?.length) {
      toast.error('这一集还没有可导出的提示词');
      return;
    }

    setExportingPromptChapter(cs.chapterNumber);
    const toastId = toast.loading(`正在导出第 ${cs.chapterNumber} 集提示词...`);
    try {
      const response = await fetch('/api/export-prompts-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyTitle: outline?.title || uploadedFileName || '',
          chapterNumber: cs.chapterNumber,
          chapterTitle: cs.chapterTitle,
          imageSettings: globalImageSettings,
          videoPrompts: cs.videoPrompts || [],
          promptGroups: cs.promptGroups || [],
          saveToDownloads: true,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || `导出失败：${response.status}`);
      }

      const contentType = response.headers.get('Content-Type') || '';
      if (contentType.includes('application/json')) {
        const data = await response.json();
        if (!data?.success) {
          throw new Error(data?.error || '导出失败');
        }

        toast.dismiss(toastId);
        toast.success(`第 ${cs.chapterNumber} 集提示词已保存到下载目录：${data.filename}`);
        if (data.filePath) {
          navigator.clipboard.writeText(data.filePath).catch(() => undefined);
          toast.info(`文件路径已复制：${data.filePath}`);
        }
        return;
      }

      const blob = await response.blob();
      if (blob.size === 0) throw new Error('导出文件为空，请重新尝试');
      const fallbackName = `第${cs.chapterNumber}集_${cs.chapterTitle || '提示词'}_提示词.docx`;
      const filename = getDownloadFilename(response.headers.get('Content-Disposition'), fallbackName);
      downloadBlob(blob, filename);
      toast.dismiss(toastId);
      toast.success(`第 ${cs.chapterNumber} 集提示词 Word 已导出`);
    } catch (error) {
      console.error('导出本集提示词失败:', error);
      toast.dismiss(toastId);
      toast.error(getNetworkErrorMessage(error, '导出本集提示词'));
    } finally {
      setExportingPromptChapter(null);
    }
  };

  const handleExportProject = async (projectName: string): Promise<boolean> => {
    if (!(await requireLoginBeforePaidAction())) return false;

    setIsExporting(true);
    const toastId = toast.loading('正在打包完整项目，请稍等...');
    try {
      const state = buildEditableProjectState();

      const response = await fetch('/api/project-export-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, projectName, saveToDownloads: true }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || '导出失败');
      }

      const contentType = response.headers.get('Content-Type') || '';
      if (contentType.includes('application/json')) {
        const data = await response.json();
        if (!data?.success) {
          throw new Error(data?.error || '导出失败');
        }

        toast.dismiss(toastId);
        toast.success(`完整项目已保存到下载目录：${data.fileName}`, {
          description: data.filePath,
          duration: 8000,
        });
        if (data.filePath) {
          navigator.clipboard.writeText(data.filePath).catch(() => undefined);
        }
        return true;
      }

      const blob = await response.blob();
      if (blob.size === 0) throw new Error('导出文件为空，请重新尝试');
      const filename = getDownloadFilename(response.headers.get('Content-Disposition'), `${projectName}.zip`);
      downloadBlob(blob, filename);
      toast.dismiss(toastId);
      toast.success(`完整项目已下载：${filename}`);
      return true;
    } catch (error) {
      console.error('导出失败:', error);
      toast.dismiss(toastId);
      toast.error(getNetworkErrorMessage(error, '导出项目'));
      return false;
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportProject = async (file: File): Promise<boolean> => {
    if (!(await requireLoginBeforePaidAction())) return false;

    setIsImporting(true);
    const toastId = toast.loading('正在导入项目，请稍等...');
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/project-import', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || '导入失败');
      }

      // 恢复项目状态到 localStorage
      if (data.projectState) {
        const restoredState: Record<string, string> = {};
        const legacyProjectStateKeyMap: Record<string, string> = {
          activeTab: 'storyboard_active_tab',
          collapsedPromptChapters: 'storyboard_collapsed_prompt_chapters',
          collapsedStoryboardChapters: 'storyboard_collapsed_storyboard_chapters',
          collapsedStoryboardTotalChapters: 'storyboard_collapsed_storyboard_total_chapters',
          dataVersion: 'storyboard_data_version',
          globalImageSettings: 'globalImageSettings',
          batchInfo: STORAGE_KEYS.STORYBOARD_BATCH_INFO,
          currentStep: STORAGE_KEYS.CURRENT_STEP,
          uploadedFileName: STORAGE_KEYS.UPLOADED_FILE,
          fileContent: STORAGE_KEYS.FILE_CONTENT,
          scenesData: STORAGE_KEYS.SCENES_DATA,
          charactersData: STORAGE_KEYS.CHARACTERS_DATA,
          propsData: STORAGE_KEYS.PROPS_DATA,
          outline: STORAGE_KEYS.OUTLINE,
          outlineBatchInfo: STORAGE_KEYS.OUTLINE_BATCH_INFO,
          sceneBatchInfo: STORAGE_KEYS.SCENE_BATCH_INFO,
          characterBatchInfo: STORAGE_KEYS.CHARACTER_BATCH_INFO,
          propBatchInfo: STORAGE_KEYS.PROP_BATCH_INFO,
          extractionStatus: STORAGE_KEYS.EXTRACTION_STATUS,
          tokenUsage: STORAGE_KEYS.TOKEN_USAGE,
          stepConfirmed: STORAGE_KEYS.STEP_CONFIRMED,
          selectedChapter: STORAGE_KEYS.SELECTED_CHAPTER,
          storyboard: STORAGE_KEYS.STORYBOARD,
          imageStoryboards: STORAGE_KEYS.IMAGE_STORYBOARDS,
          connectingPrompts: STORAGE_KEYS.CONNECTING_PROMPTS,
          videoResults: STORAGE_KEYS.VIDEO_RESULTS,
          videoTotalDuration: STORAGE_KEYS.VIDEO_TOTAL_DURATION,
          progress: STORAGE_KEYS.PROGRESS,
          videoRatio: STORAGE_KEYS.VIDEO_RATIO,
          assetImagesObj: STORAGE_KEYS.ASSET_IMAGES,
          chapterStoryboards: STORAGE_KEYS.CHAPTER_STORYBOARDS,
        };

        Object.entries(data.projectState).forEach(([key, value]) => {
          const targetKey = key.startsWith('storyboard_') || key === 'globalImageSettings'
            ? key
            : legacyProjectStateKeyMap[key];

          if (targetKey) {
            const serialized = JSON.stringify(value);
            localStorage.setItem(targetKey, serialized);
            if (targetKey.startsWith('storyboard_')) {
              restoredState[targetKey] = serialized;
            }
          }
        });

        if (Object.keys(restoredState).length > 0) {
          fetch('/api/project-state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: restoredState }),
          }).catch((error) => {
            console.warn('[项目导入] 写入本地状态备份失败:', error);
          });
        }
      }

      toast.dismiss(toastId);
      toast.success(`项目导入成功！\n场景: ${data.stats.scenes} | 人物: ${data.stats.characters} | 道具: ${data.stats.props} | 分镜: ${data.stats.storyboards} | 视频: ${data.stats.videos}`, {
        duration: 5000,
      });

      // 刷新页面恢复状态
      setTimeout(() => {
        window.location.reload();
      }, 1500);
      return true;
    } catch (error) {
      console.error('导入失败:', error);
      toast.dismiss(toastId);
      toast.error(getNetworkErrorMessage(error, '导入项目'));
      return false;
    } finally {
      setIsImporting(false);
    }
  };

  // 自动初始化资产文件夹
  useEffect(() => {
    const initAssetsFolder = async () => {
      try {
        // 检查是否已配置
        const response = await fetch('/api/assets-config');
        const data = await response.json();
        
        if (data.success && !data.assetsExist) {
          // 自动初始化
          await fetch('/api/assets-config', { method: 'PUT' });
          console.log('资产文件夹已自动初始化');
        }
      } catch (error) {
        console.error('初始化资产文件夹失败:', error);
      }
    };
    
    initAssetsFolder();
  }, []);
  
  // 标记是否已执行恢复
  const hasRestoredRef = useRef(false);

  // 从本地恢复资产图片 - 只在首次加载且没有持久化数据时从服务器恢复
  useEffect(() => {
    // 已经恢复过就不再执行
    if (hasRestoredRef.current) return;
    // 如果已有持久化的选中状态，不需要从服务器恢复
    if (Object.keys(assetImagesObj).length > 0) {
      console.log('[素材图片] 已有持久化的选中状态，跳过服务器恢复');
      hasRestoredRef.current = true;
      return;
    }
    // 确保有提取数据才执行恢复（这样才能正确匹配名称）
    if (!scenesData && !charactersData && !propsData) return;
    
    hasRestoredRef.current = true;
    
    const restoreAssets = async () => {
      try {
        console.log('[素材图片] 无持久化数据，从服务器恢复图片库...');
        const response = await fetch('/api/assets-restore?type=all');
        const data = await response.json();
        
        if (data.success && data.assetImages) {
          // 这里只是同步图片库信息，不自动添加到选中列表
          // 用户需要通过"从图片库选择"来添加图片
          console.log('[素材图片] 图片库同步完成，共', 
            Object.values(data.assetImages).flat().length, '张图片');
        }
      } catch (error) {
        console.error('恢复图片库失败:', error);
      }
    };
    
    restoreAssets();
  }, [assetImagesObj, scenesData, charactersData, propsData]);

  // 单独重试某个提取
  const retryExtraction = async (type: 'scenes' | 'characters' | 'props' | 'outline') => {
    if (!fileContent) {
      toast.error('请先上传文件');
      return;
    }
    if (!(await requireLoginBeforePaidAction())) return;
    
    setExtractionStatus(prev => ({ ...prev, [type]: 'loading' }));

    if (type === 'outline') {
      setOutlineBatchInfo(null);
      setOutline(null);
      await extractOutlineBatch(fileContent, uploadedFile?.name || uploadedFileName || '剧本', 1, null, [], undefined, true);
      return;
    }
    
    try {
      const endpoint = `/api/extract-${type}`;
      // 场景和人物提取需要传递 batch 参数
      const body: any = { content: fileContent, fileName: uploadedFile?.name || uploadedFileName };
      if (type === 'scenes' || type === 'characters' || type === 'props') {
        body.batch = 1;
      }
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      
      const data = await response.json();
      
      if (data.success) {
        switch (type) {
          case 'scenes':
            // 检查是否有分批信息
            if (data.batchInfo) {
              setSceneBatchInfo({
                currentBatch: data.batchInfo.currentBatch,
                totalBatches: data.batchInfo.totalBatches,
                hasMore: data.batchInfo.hasMore,
                sceneMarkers: data.batchInfo.sceneMarkers || [],
                allScenes: data.data.scenes || [],
              });
              setScenesData({
                totalScenes: data.batchInfo.sceneMarkers?.length || data.data.scenes?.length,
                scenes: data.data.scenes,
              });
              if (data.batchInfo.hasMore) {
                setExtractionStatus(prev => ({ ...prev, scenes: 'batch_confirm' as any }));
                toast.info(`已提取第 ${data.batchInfo.currentBatch}/${data.batchInfo.totalBatches} 批场景，请确认后继续`);
              } else {
                setExtractionStatus(prev => ({ ...prev, scenes: 'success' }));
              }
            } else {
              setScenesData(data.data);
              setExtractionStatus(prev => ({ ...prev, scenes: 'success' }));
            }
            break;
          case 'characters':
            // 检查是否有分批信息
            if (data.batchInfo) {
              setCharacterBatchInfo({
                currentBatch: data.batchInfo.currentBatch,
                totalBatches: data.batchInfo.totalBatches,
                hasMore: data.batchInfo.hasMore,
                characterMarkers: data.batchInfo.characterMarkers || [],
                allCharacters: data.data.characters || [],
              });
              setCharactersData({
                totalCharacters: data.batchInfo.characterMarkers?.length || data.data.characters?.length,
                characters: data.data.characters,
              });
              if (data.batchInfo.hasMore) {
                setExtractionStatus(prev => ({ ...prev, characters: 'batch_confirm' as any }));
                toast.info(`已提取第 ${data.batchInfo.currentBatch}/${data.batchInfo.totalBatches} 批人物，请确认后继续`);
                return; // 不执行后面的success状态设置
              }
            } else {
              setCharactersData(data.data);
            }
            break;
          case 'props':
            // 检查是否有分批信息
            if (data.batchInfo) {
              setPropBatchInfo({
                currentBatch: data.batchInfo.currentBatch,
                totalBatches: data.batchInfo.totalBatches,
                hasMore: data.batchInfo.hasMore,
                propMarkers: data.batchInfo.propMarkers || [],
                allProps: data.data.props || [],
              });
              setPropsData({
                totalProps: data.batchInfo.propMarkers?.length || data.data.props?.length,
                props: data.data.props,
              });
              if (data.batchInfo.hasMore) {
                setExtractionStatus(prev => ({ ...prev, props: 'batch_confirm' as any }));
                toast.info(`已提取第 ${data.batchInfo.currentBatch}/${data.batchInfo.totalBatches} 批道具，请确认后继续`);
                return; // 不执行后面的success状态设置
              }
            } else {
              setPropsData(data.data);
            }
            break;
        }
        setExtractionStatus(prev => ({ ...prev, [type]: 'success' }));
        toast.success(`${type === 'scenes' ? '场景' : type === 'characters' ? '人物' : type === 'props' ? '道具' : '大纲'}提取成功`);
      } else {
        setExtractionStatus(prev => ({ ...prev, [type]: 'error' }));
        toast.error(`${type === 'scenes' ? '场景' : type === 'characters' ? '人物' : type === 'props' ? '道具' : '大纲'}提取失败`);
      }
    } catch (error) {
      setExtractionStatus(prev => ({ ...prev, [type]: 'error' }));
      toast.error(getNetworkErrorMessage(error, `提取${type === 'scenes' ? '场景' : type === 'characters' ? '人物' : type === 'props' ? '道具' : '大纲'}`));
    }
  };

  // 全部重新提取
  const retryAllExtractions = async () => {
    if (!fileContent) {
      toast.error('请先上传文件');
      return;
    }
    if (!(await requireLoginBeforePaidAction())) return;
    
    toast.info('正在重新提取所有内容...');
    
    setExtractionStatus({
      scenes: 'loading',
      characters: 'loading',
      props: 'loading',
      outline: 'loading',
    });

    // 清空大纲批次信息和场景批次信息
    setOutlineBatchInfo(null);
    setSceneBatchInfo(null);
    setCharacterBatchInfo(null);
    setPropBatchInfo(null);

    // 并行调用场景、人物、道具 API，大纲单独分批处理
    const [scenesResult, charactersResult, propsResult] = await Promise.allSettled([
      fetch('/api/extract-scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: fileContent, fileName: uploadedFile?.name || uploadedFileName, batch: 1 }),
      }),
      fetch('/api/extract-characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: fileContent, fileName: uploadedFile?.name || uploadedFileName, batch: 1 }),
      }),
      fetch('/api/extract-props', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: fileContent, fileName: uploadedFile?.name || uploadedFileName, batch: 1 }),
      }),
    ]);

    // 处理场景结果
    if (scenesResult.status === 'fulfilled') {
      const data = await scenesResult.value.json();
      if (data.success) {
        // 检查是否有分批信息
        if (data.batchInfo) {
          // 保存场景批次信息
          setSceneBatchInfo({
            currentBatch: data.batchInfo.currentBatch,
            totalBatches: data.batchInfo.totalBatches,
            hasMore: data.batchInfo.hasMore,
            sceneMarkers: data.batchInfo.sceneMarkers || [],
            allScenes: data.data.scenes || [],
          });
          setScenesData({
            totalScenes: data.batchInfo.sceneMarkers?.length || data.data.scenes?.length,
            scenes: data.data.scenes,
          });
          
          if (data.batchInfo.hasMore) {
            setExtractionStatus(prev => ({ ...prev, scenes: 'batch_confirm' as any }));
            toast.info(`已提取第 ${data.batchInfo.currentBatch}/${data.batchInfo.totalBatches} 批场景，请确认后继续`);
          } else {
            setExtractionStatus(prev => ({ ...prev, scenes: 'success' }));
          }
        } else {
          setScenesData(data.data);
          setExtractionStatus(prev => ({ ...prev, scenes: 'success' }));
        }
        if (data.tokenUsage) {
          setTokenUsage(prev => ({ ...prev, extractScenes: data.tokenUsage }));
        }
      } else {
        setExtractionStatus(prev => ({ ...prev, scenes: 'error' }));
      }
    } else {
      setExtractionStatus(prev => ({ ...prev, scenes: 'error' }));
    }

    // 处理人物结果
    if (charactersResult.status === 'fulfilled') {
      const data = await charactersResult.value.json();
      if (data.success) {
        // 检查是否有分批信息
        if (data.batchInfo) {
          // 保存人物批次信息
          setCharacterBatchInfo({
            currentBatch: data.batchInfo.currentBatch,
            totalBatches: data.batchInfo.totalBatches,
            hasMore: data.batchInfo.hasMore,
            characterMarkers: data.batchInfo.characterMarkers || [],
            allCharacters: data.data.characters || [],
          });
          setCharactersData({
            totalCharacters: data.batchInfo.characterMarkers?.length || data.data.characters?.length,
            characters: data.data.characters,
          });
          
          if (data.batchInfo.hasMore) {
            setExtractionStatus(prev => ({ ...prev, characters: 'batch_confirm' as any }));
            toast.info(`已提取第 ${data.batchInfo.currentBatch}/${data.batchInfo.totalBatches} 批人物，请确认后继续`);
          } else {
            setExtractionStatus(prev => ({ ...prev, characters: 'success' }));
          }
        } else {
          setCharactersData(data.data);
          setExtractionStatus(prev => ({ ...prev, characters: 'success' }));
        }
        if (data.tokenUsage) {
          setTokenUsage(prev => ({ ...prev, extractCharacters: data.tokenUsage }));
        }
      } else {
        setExtractionStatus(prev => ({ ...prev, characters: 'error' }));
      }
    } else {
      setExtractionStatus(prev => ({ ...prev, characters: 'error' }));
    }

    // 处理道具结果
    if (propsResult.status === 'fulfilled') {
      const data = await propsResult.value.json();
      if (data.success) {
        // 检查是否有分批信息
        if (data.batchInfo) {
          // 保存道具批次信息
          setPropBatchInfo({
            currentBatch: data.batchInfo.currentBatch,
            totalBatches: data.batchInfo.totalBatches,
            hasMore: data.batchInfo.hasMore,
            propMarkers: data.batchInfo.propMarkers || [],
            allProps: data.data.props || [],
          });
          setPropsData({
            totalProps: data.batchInfo.propMarkers?.length || data.data.props?.length,
            props: data.data.props,
          });
          
          if (data.batchInfo.hasMore) {
            setExtractionStatus(prev => ({ ...prev, props: 'batch_confirm' as any }));
            toast.info(`已提取第 ${data.batchInfo.currentBatch}/${data.batchInfo.totalBatches} 批道具，请确认后继续`);
          } else {
            setExtractionStatus(prev => ({ ...prev, props: 'success' }));
          }
        } else {
          setPropsData(data.data);
          setExtractionStatus(prev => ({ ...prev, props: 'success' }));
        }
        if (data.tokenUsage) {
          setTokenUsage(prev => ({ ...prev, extractProps: data.tokenUsage }));
        }
      } else {
        setExtractionStatus(prev => ({ ...prev, props: 'error' }));
      }
    } else {
      setExtractionStatus(prev => ({ ...prev, props: 'error' }));
    }

    // 提取第一批大纲
    await extractOutlineBatch(fileContent, uploadedFile?.name || uploadedFileName || '剧本', 1, null, []);
  };

  // 提取大纲的一批章节
  const extractOutlineBatch = async (
    content: string, 
    fileName: string, 
    batch: number, 
    basicInfo: { title: string; summary: string } | null,
    existingChapters: Chapter[],
    episodeMarkers?: Array<{ number: number; marker: string }> | number[],
    autoContinue = true
  ) => {
    if (!(await requireLoginBeforePaidAction())) return;

    try {
      const response = await fetch('/api/extract-outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          content, 
          fileName, 
          batch,
          episodeMarkers: episodeMarkers || outlineBatchInfo?.episodeMarkers,  // 传递集数数组
          basicInfo: basicInfo || outlineBatchInfo?.basicInfo,
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        // 合并章节，并去除重复的 chapterNumber
        const combinedChapters = [...existingChapters, ...data.outline.chapters];
        const uniqueChapters = combinedChapters.reduce((acc: Chapter[], chapter: Chapter) => {
          if (!acc.find(c => c.chapterNumber === chapter.chapterNumber)) {
            acc.push(chapter);
          }
          return acc;
        }, []);
        const newChapters = uniqueChapters;
        
        const nextOutlineBatchInfo = {
          currentBatch: data.batchInfo.currentBatch,
          totalBatches: data.batchInfo.totalBatches,
          hasMore: data.batchInfo.hasMore,
          totalEpisodes: data.batchInfo.totalEpisodes,
          basicInfo: data.basicInfo,
          allChapters: newChapters,
          episodeMarkers: data.batchInfo.episodeMarkers || outlineBatchInfo?.episodeMarkers || [],
        };
        
        // 更新批次信息，保存 episodeMarkers
        setOutlineBatchInfo(nextOutlineBatchInfo);

        // 如果只有一批或者没有更多批次，直接完成
        if (!data.batchInfo.hasMore) {
          const finalOutline: Outline = {
            title: data.basicInfo?.title || fileName.replace(/\.[^.]+$/, ''),
            summary: data.basicInfo?.summary || '',
            totalChapters: newChapters.length,
            chapters: newChapters,
          };
          setOutline(finalOutline);
          setExtractionStatus(prev => ({ ...prev, outline: 'success' }));
          if (data.tokenUsage) {
            setTokenUsage(prev => ({ ...prev, extractOutline: data.tokenUsage }));
          }
          setProgress(40);
          toast.success('大纲提取完成');
        } else {
          // 更新部分大纲供预览
          const partialOutline: Outline = {
            title: data.basicInfo?.title || fileName.replace(/\.[^.]+$/, ''),
            summary: data.basicInfo?.summary || '',
            totalChapters: data.batchInfo.totalEpisodes,
            chapters: newChapters,
          };
          setOutline(partialOutline);
          if (autoContinue) {
            setExtractionStatus(prev => ({ ...prev, outline: 'loading' }));
            await extractOutlineBatch(
              content,
              fileName,
              data.batchInfo.currentBatch + 1,
              data.basicInfo || basicInfo,
              newChapters,
              nextOutlineBatchInfo.episodeMarkers,
              true
            );
          } else {
            // 状态设为 'batch_confirm' 表示等待确认
            setExtractionStatus(prev => ({ ...prev, outline: 'batch_confirm' as any }));
            toast.info(`已提取第 ${data.batchInfo.currentBatch}/${data.batchInfo.totalBatches} 批章节，请确认后继续`);
          }
        }
      } else {
        setExtractionStatus(prev => ({ ...prev, outline: 'error' }));
        toast.error('大纲提取失败');
      }
    } catch (error) {
      setExtractionStatus(prev => ({ ...prev, outline: 'error' }));
      toast.error(getNetworkErrorMessage(error, '提取大纲'));
    }
  };

  useEffect(() => {
    if (outlineAutoResumeRef.current || !fileContent || !outline) return;

    const expectedChapters = outlineBatchInfo?.totalEpisodes || outline.totalChapters || 0;
    const extractedChapters = Math.max(
      outline.chapters?.length || 0,
      outlineBatchInfo?.allChapters?.length || 0
    );

    if (expectedChapters > extractedChapters) {
      outlineAutoResumeRef.current = true;
      setStepConfirmed(prev => prev.extraction ? { ...prev, extraction: false } : prev);
      setCurrentStep(1);
      setProgress(25);
      setExtractionStatus(prev => ({ ...prev, outline: 'loading' }));
      toast.info(`检测到大纲只提取了 ${extractedChapters}/${expectedChapters} 章，正在自动补齐剩余章节...`);

      const startBatch = outlineBatchInfo?.hasMore
        ? outlineBatchInfo.currentBatch + 1
        : 1;
      const existingChapters = outlineBatchInfo?.allChapters?.length
        ? outlineBatchInfo.allChapters
        : outline.chapters || [];

      void extractOutlineBatch(
        fileContent,
        uploadedFile?.name || uploadedFileName || '剧本',
        startBatch,
        outlineBatchInfo?.basicInfo || null,
        outlineBatchInfo?.hasMore ? existingChapters : [],
        outlineBatchInfo?.episodeMarkers,
        true
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileContent, uploadedFileName, outline, outlineBatchInfo]);

  // 继续提取下一批场景
  const continueSceneExtraction = async () => {
    if (!fileContent || !sceneBatchInfo) {
      toast.error('无法继续提取场景');
      return;
    }
    if (!(await requireLoginBeforePaidAction())) return;
    
    const nextBatch = sceneBatchInfo.currentBatch + 1;
    
    // 先更新批次信息为"正在提取"状态
    setSceneBatchInfo({
      ...sceneBatchInfo,
      currentBatch: nextBatch,
    });
    
    setExtractionStatus(prev => ({ ...prev, scenes: 'loading' }));
    toast.info(`正在提取第 ${nextBatch}/${sceneBatchInfo.totalBatches} 批场景...`);
    
    try {
      const response = await fetch('/api/extract-scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: fileContent,
          fileName: uploadedFile?.name || uploadedFileName || '剧本',
          batch: nextBatch,
          sceneMarkers: sceneBatchInfo.sceneMarkers,
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        const newScenes = [...sceneBatchInfo.allScenes, ...data.data.scenes];
        
        setSceneBatchInfo({
          currentBatch: data.batchInfo.currentBatch,
          totalBatches: data.batchInfo.totalBatches,
          hasMore: data.batchInfo.hasMore,
          sceneMarkers: data.batchInfo.sceneMarkers,
          allScenes: newScenes,
        });
        
        setScenesData({
          totalScenes: newScenes.length,
          scenes: newScenes,
        });
        
        if (!data.batchInfo.hasMore) {
          setExtractionStatus(prev => ({ ...prev, scenes: 'success' }));
          toast.success('场景提取完成');
        } else {
          setExtractionStatus(prev => ({ ...prev, scenes: 'batch_confirm' }));
          toast.info(`已提取第 ${data.batchInfo.currentBatch}/${data.batchInfo.totalBatches} 批场景，请确认后继续`);
        }
        
        if (data.tokenUsage) {
          setTokenUsage(prev => ({ ...prev, extractScenes: data.tokenUsage }));
        }
      } else {
        setExtractionStatus(prev => ({ ...prev, scenes: 'error' }));
        toast.error('场景提取失败');
      }
    } catch (error) {
      setExtractionStatus(prev => ({ ...prev, scenes: 'error' }));
      toast.error(getNetworkErrorMessage(error, '提取场景'));
    }
  };

  // 继续提取下一批人物
  const continueCharacterExtraction = async () => {
    if (!fileContent || !characterBatchInfo) {
      toast.error('无法继续提取人物');
      return;
    }
    if (!(await requireLoginBeforePaidAction())) return;
    
    const nextBatch = characterBatchInfo.currentBatch + 1;
    
    // 先更新批次信息为"正在提取"状态
    setCharacterBatchInfo({
      ...characterBatchInfo,
      currentBatch: nextBatch,
    });
    
    setExtractionStatus(prev => ({ ...prev, characters: 'loading' }));
    toast.info(`正在提取第 ${nextBatch}/${characterBatchInfo.totalBatches} 批人物...`);
    
    try {
      const response = await fetch('/api/extract-characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: fileContent,
          fileName: uploadedFile?.name || uploadedFileName || '剧本',
          batch: nextBatch,
          characterMarkers: characterBatchInfo.characterMarkers,
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        const newCharacters = [...characterBatchInfo.allCharacters, ...data.data.characters];
        
        setCharacterBatchInfo({
          currentBatch: data.batchInfo.currentBatch,
          totalBatches: data.batchInfo.totalBatches,
          hasMore: data.batchInfo.hasMore,
          characterMarkers: data.batchInfo.characterMarkers,
          allCharacters: newCharacters,
        });
        
        setCharactersData({
          totalCharacters: newCharacters.length,
          characters: newCharacters,
        });
        
        if (!data.batchInfo.hasMore) {
          setExtractionStatus(prev => ({ ...prev, characters: 'success' }));
          toast.success('人物提取完成');
        } else {
          setExtractionStatus(prev => ({ ...prev, characters: 'batch_confirm' }));
          toast.info(`已提取第 ${data.batchInfo.currentBatch}/${data.batchInfo.totalBatches} 批人物，请确认后继续`);
        }
        
        if (data.tokenUsage) {
          setTokenUsage(prev => ({ ...prev, extractCharacters: data.tokenUsage }));
        }
      } else {
        setExtractionStatus(prev => ({ ...prev, characters: 'error' }));
        toast.error('人物提取失败');
      }
    } catch (error) {
      setExtractionStatus(prev => ({ ...prev, characters: 'error' }));
      toast.error(getNetworkErrorMessage(error, '提取人物'));
    }
  };

  // 继续提取下一批道具
  const continuePropExtraction = async () => {
    if (!fileContent || !propBatchInfo) {
      toast.error('无法继续提取道具');
      return;
    }
    if (!(await requireLoginBeforePaidAction())) return;
    
    const nextBatch = propBatchInfo.currentBatch + 1;
    
    // 先更新批次信息为"正在提取"状态
    setPropBatchInfo({
      ...propBatchInfo,
      currentBatch: nextBatch,
    });
    
    setExtractionStatus(prev => ({ ...prev, props: 'loading' }));
    toast.info(`正在提取第 ${nextBatch}/${propBatchInfo.totalBatches} 批道具...`);
    
    try {
      const response = await fetch('/api/extract-props', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: fileContent,
          fileName: uploadedFile?.name || uploadedFileName || '剧本',
          batch: nextBatch,
          propMarkers: propBatchInfo.propMarkers,
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        const newProps = [...propBatchInfo.allProps, ...data.data.props];
        
        setPropBatchInfo({
          currentBatch: data.batchInfo.currentBatch,
          totalBatches: data.batchInfo.totalBatches,
          hasMore: data.batchInfo.hasMore,
          propMarkers: data.batchInfo.propMarkers,
          allProps: newProps,
        });
        
        setPropsData({
          totalProps: newProps.length,
          props: newProps,
        });
        
        if (!data.batchInfo.hasMore) {
          setExtractionStatus(prev => ({ ...prev, props: 'success' }));
          toast.success('道具提取完成');
        } else {
          setExtractionStatus(prev => ({ ...prev, props: 'batch_confirm' }));
          toast.info(`已提取第 ${data.batchInfo.currentBatch}/${data.batchInfo.totalBatches} 批道具，请确认后继续`);
        }
        
        if (data.tokenUsage) {
          setTokenUsage(prev => ({ ...prev, extractProps: data.tokenUsage }));
        }
      } else {
        setExtractionStatus(prev => ({ ...prev, props: 'error' }));
        toast.error('道具提取失败');
      }
    } catch (error) {
      setExtractionStatus(prev => ({ ...prev, props: 'error' }));
      toast.error(getNetworkErrorMessage(error, '提取道具'));
    }
  };

  // 继续提取下一批大纲
  const continueOutlineExtraction = async () => {
    if (!fileContent || !outlineBatchInfo) {
      toast.error('无法继续提取');
      return;
    }
    if (!(await requireLoginBeforePaidAction())) return;
    
    const nextBatch = outlineBatchInfo.currentBatch + 1;
    
    // 先更新批次信息为"正在提取"状态，确保进度条显示正确
    setOutlineBatchInfo({
      ...outlineBatchInfo,
      currentBatch: nextBatch, // 更新为正在提取的批次
    });
    
    setExtractionStatus(prev => ({ ...prev, outline: 'loading' }));
    toast.info(`正在提取第 ${nextBatch}/${outlineBatchInfo.totalBatches} 批章节...`);
    
    await extractOutlineBatch(
      fileContent, 
      uploadedFile?.name || uploadedFileName || '剧本', 
      nextBatch,
      outlineBatchInfo.basicInfo,
      outlineBatchInfo.allChapters
    );
  };

  // 并行提取四个维度
  const extractAllParallel = async (content: string, fileName: string) => {
    if (!(await requireLoginBeforePaidAction())) return;

    setCurrentStep(1);
    setProgress(20);
    toast.info('正在并行提取场景、人物、道具和大纲，较长剧本可能需要几分钟...');
    
    // 初始化状态
    setExtractionStatus({
      scenes: 'loading',
      characters: 'loading',
      props: 'loading',
      outline: 'loading',
    });

    // 清空大纲批次信息
    setOutlineBatchInfo(null);
    setSceneBatchInfo(null);
    setCharacterBatchInfo(null);
    setPropBatchInfo(null);

    const parseExtractionResponse = async (response: Response, label: string) => {
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.details || data?.error || `${label}提取失败`);
      }
      return data;
    };

    const runScenesExtraction = async () => {
      try {
        const response = await fetch('/api/extract-scenes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, fileName, batch: 1 }),
        });
        const data = await parseExtractionResponse(response, '场景');
        // 检查是否有分批信息
        if (data.batchInfo) {
          // 保存场景批次信息
          setSceneBatchInfo({
            currentBatch: data.batchInfo.currentBatch,
            totalBatches: data.batchInfo.totalBatches,
            hasMore: data.batchInfo.hasMore,
            sceneMarkers: data.batchInfo.sceneMarkers || [],
            allScenes: data.data.scenes || [],
          });
          setScenesData({
            totalScenes: data.batchInfo.sceneMarkers?.length || data.data.scenes?.length,
            scenes: data.data.scenes,
          });
          
          if (data.batchInfo.hasMore) {
            setExtractionStatus(prev => ({ ...prev, scenes: 'batch_confirm' as any }));
            toast.info(`已提取第 ${data.batchInfo.currentBatch}/${data.batchInfo.totalBatches} 批场景，请确认后继续`);
          } else {
            setExtractionStatus(prev => ({ ...prev, scenes: 'success' }));
          }
        } else {
          setScenesData(data.data);
          setExtractionStatus(prev => ({ ...prev, scenes: 'success' }));
        }
        if (data.tokenUsage) {
          setTokenUsage(prev => ({ ...prev, extractScenes: data.tokenUsage }));
        }
      } catch (error) {
        setExtractionStatus(prev => ({ ...prev, scenes: 'error' }));
        toast.error(getNetworkErrorMessage(error, '提取场景'));
      }
    };

    const runCharactersExtraction = async () => {
      try {
        const response = await fetch('/api/extract-characters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, fileName, batch: 1 }),
        });
        const data = await parseExtractionResponse(response, '人物');
        // 检查是否有分批信息
        if (data.batchInfo) {
          // 保存人物批次信息
          setCharacterBatchInfo({
            currentBatch: data.batchInfo.currentBatch,
            totalBatches: data.batchInfo.totalBatches,
            hasMore: data.batchInfo.hasMore,
            characterMarkers: data.batchInfo.characterMarkers || [],
            allCharacters: data.data.characters || [],
          });
          setCharactersData({
            totalCharacters: data.batchInfo.characterMarkers?.length || data.data.characters?.length,
            characters: data.data.characters,
          });
          
          if (data.batchInfo.hasMore) {
            setExtractionStatus(prev => ({ ...prev, characters: 'batch_confirm' as any }));
            toast.info(`已提取第 ${data.batchInfo.currentBatch}/${data.batchInfo.totalBatches} 批人物，请确认后继续`);
          } else {
            setExtractionStatus(prev => ({ ...prev, characters: 'success' }));
          }
        } else {
          setCharactersData(data.data);
          setExtractionStatus(prev => ({ ...prev, characters: 'success' }));
        }
        if (data.tokenUsage) {
          setTokenUsage(prev => ({ ...prev, extractCharacters: data.tokenUsage }));
        }
      } catch (error) {
        setExtractionStatus(prev => ({ ...prev, characters: 'error' }));
        toast.error(getNetworkErrorMessage(error, '提取人物'));
      }
    };

    const runPropsExtraction = async () => {
      try {
        const response = await fetch('/api/extract-props', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, fileName, batch: 1 }),
        });
        const data = await parseExtractionResponse(response, '道具');
        // 检查是否有分批信息
        if (data.batchInfo) {
          // 保存道具批次信息
          setPropBatchInfo({
            currentBatch: data.batchInfo.currentBatch,
            totalBatches: data.batchInfo.totalBatches,
            hasMore: data.batchInfo.hasMore,
            propMarkers: data.batchInfo.propMarkers || [],
            allProps: data.data.props || [],
          });
          setPropsData({
            totalProps: data.batchInfo.propMarkers?.length || data.data.props?.length,
            props: data.data.props,
          });
          
          if (data.batchInfo.hasMore) {
            setExtractionStatus(prev => ({ ...prev, props: 'batch_confirm' as any }));
            toast.info(`已提取第 ${data.batchInfo.currentBatch}/${data.batchInfo.totalBatches} 批道具，请确认后继续`);
          } else {
            setExtractionStatus(prev => ({ ...prev, props: 'success' }));
          }
        } else {
          setPropsData(data.data);
          setExtractionStatus(prev => ({ ...prev, props: 'success' }));
        }
        if (data.tokenUsage) {
          setTokenUsage(prev => ({ ...prev, extractProps: data.tokenUsage }));
        }
      } catch (error) {
        setExtractionStatus(prev => ({ ...prev, props: 'error' }));
        toast.error(getNetworkErrorMessage(error, '提取道具'));
      }
    };

    await Promise.allSettled([
      runScenesExtraction(),
      runCharactersExtraction(),
      runPropsExtraction(),
      extractOutlineBatch(content, fileName, 1, null, []),
    ]);
  };

  // 确认章节文字分镜
  const confirmChapterStoryboard = (chapterNumber: number) => {
    const collapsedKey = String(chapterNumber);
    setChapterStoryboards(prev => {
      const updated = {
        ...prev,
        [chapterNumber]: {
          ...prev[chapterNumber],
          storyboardConfirmed: true,
        }
      };
      
      // 检查是否所有章节都确认了分镜
      const allChapters = Object.values(updated);
      const allConfirmed = allChapters.every(cs => cs.storyboardConfirmed);
      
      // 更新进度：只要确认了分镜就前进到素材确认步骤
      setCurrentStep(3);
      setProgress(50);
      
      // 如果所有章节都确认了分镜，更新全局确认状态
      if (allConfirmed && allChapters.length > 0) {
        setStepConfirmed(prevState => ({ ...prevState, storyboard: true }));
        // 跳转到素材确认标签页
        setActiveTab('assets');
      }
      
      return updated;
    });
    setCollapsedStoryboardChapters(prev => ({ ...prev, [collapsedKey]: true }));
    toast.success(`第 ${chapterNumber} 章文字分镜已确认`);
  };

  // 生成单个分镜的提示词（前端预览用，与后端API保持一致）
  const buildShotPrompt = (
    shot: Shot, 
    imageSettings?: ImageStoryboardSettings,
    hasSceneReference?: boolean,
    frameType: 'start' | 'end' = 'start'  // 帧类型：首帧或尾帧
  ): string => {
    const parts: string[] = [];

    // 帧类型说明
    if (frameType === 'start') {
      parts.push('【首帧】动作开始瞬间的画面');
    } else {
      parts.push('【尾帧】动作结束瞬间的画面');
    }

    // 如果有场景参考图片，强调保持场景一致性
    if (hasSceneReference) {
      parts.push('【重要】保持场景风格一致性');
      parts.push('场景布局、物品位置、背景细节必须与参考图片保持完全一致');
      parts.push('仅调整人物位置、表情、动作和镜头角度');
    }

    // 1. 镜头类型和景别
    if (shot.shotType) {
      parts.push(`景别：${shot.shotType}`);
    }
    if (shot.shotPurpose) {
      parts.push(`镜头作用：${shot.shotPurpose}`);
    }
    if (shot.cameraAngle) {
      parts.push(`镜头角度：${shot.cameraAngle}`);
    }

    // 2. 场景描述（包含位置、时间、氛围、光影）
    if (shot.scene) {
      if (shot.scene.location) {
        parts.push(`场景位置：${shot.scene.location}`);
      }
      if (shot.scene.time) {
        parts.push(`时间：${shot.scene.time}`);
      }
      if (shot.scene.atmosphere) {
        parts.push(`氛围：${shot.scene.atmosphere}`);
      }
      if (shot.scene.lighting) {
        parts.push(`光影：${shot.scene.lighting}`);
      }
    }

    // 3. 主要画面描述 - 根据帧类型调整
    if (shot.description) {
      if (frameType === 'start') {
        parts.push(`画面内容起始：${shot.description}`);
      } else {
        parts.push(`画面内容结束：${shot.description}`);
      }
    }
    if (shot.actorBlocking) {
      parts.push(`人物相对站位：${shot.actorBlocking}`);
    }
    if (shot.actionChange) {
      parts.push(`较上一镜动作变化：${shot.actionChange}`);
    }

    // 4. 人物描述（包含姓名、对白、反应、表演、表情、动作）
    if (shot.characters && shot.characters.length > 0) {
      shot.characters.forEach((char) => {
        const charDesc = [];
        
        // 人物姓名
        if (char.name) charDesc.push(`人物：${char.name}`);
        if (char.position) charDesc.push(`站位：${char.position}`);
        
        // 对白（重要：原句保留）
        if (char.dialogue) {
          const dialogueType = char.dialogueType || '对白';
          charDesc.push(`${dialogueType}："${char.dialogue}"`);
        }
        
        // 反应（重要：情绪反应）
        if (char.reaction) {
          charDesc.push(`反应：${char.reaction}`);
        }
        
        // 表演（重要：具体动作和神态）
        if (char.performance) {
          if (frameType === 'start') {
            charDesc.push(`表演起始：准备${char.performance}`);
          } else {
            charDesc.push(`表演结束：完成${char.performance}`);
          }
        }
        
        // 动作
        if (char.action) {
          if (frameType === 'start') {
            charDesc.push(`动作起始：准备${char.action}`);
          } else {
            charDesc.push(`动作结束：完成${char.action}`);
          }
        }
        
        // 表情
        if (char.expression) {
          if (frameType === 'start') {
            charDesc.push('表情变化前');
          } else {
            charDesc.push(`表情：${char.expression}`);
          }
        }
        if (char.facialAction) {
          charDesc.push(`脸部动作：${char.facialAction}`);
        }
        
        // 手势
        if (char.gesture) {
          charDesc.push(`手势：${char.gesture}`);
        }
        if (char.actionChange) {
          charDesc.push(`动作变化：${char.actionChange}`);
        }
        
        parts.push(charDesc.join('，'));
      });
    }

    // 5. 情感节拍 - 根据帧类型调整
    if (shot.emotionalBeat) {
      if (frameType === 'start') {
        parts.push(`情感基调铺垫：${shot.emotionalBeat}`);
      } else {
        parts.push(`情感基调呈现：${shot.emotionalBeat}`);
      }
    }

    // 6. 道具和细节
    if (shot.scene?.props && shot.scene.props.length > 0) {
      parts.push(`道具：${shot.scene.props.join('、')}`);
    }

    // 7. 镜头运动 - 根据帧类型调整
    if (shot.cameraMovement) {
      if (frameType === 'start') {
        parts.push(`镜头运动起始：${shot.cameraMovement}开始`);
      } else {
        parts.push(`镜头运动结束：${shot.cameraMovement}结束`);
      }
    }

    // 8. 持续时间
    if (shot.duration) {
      parts.push(`持续时间：${shot.duration}`);
    }

    // 9. 拍摄备注（重要）
    if (shot.notes) {
      parts.push(`备注：${shot.notes}`);
    }
    if (shot.continuity) {
      parts.push(`连续性：${shot.continuity}`);
    }

    // 10. 应用用户选择的风格
    if (imageSettings?.styles && imageSettings.styles.length > 0) {
      parts.push(`画面风格：${imageSettings.styles.join('、')}`);
    }

    // 11. 应用用户选择的光影效果
    if (imageSettings?.lighting && imageSettings.lighting.length > 0) {
      parts.push(`光影效果：${imageSettings.lighting.join('、')}`);
    }

    // 12. 艺术风格和质量要求
    parts.push('高质量，电影级画面，专业摄影，细节丰富');
    if (!hasSceneReference) {
      parts.push('场景设计大胆创新，画面极具吸引力，视觉冲击力强，构图独特，色彩鲜明');
    }

    return parts.join('。');
  };

  // 生成分镜提示词预览
  const generateShotPromptsPreview = (
    storyboard: Storyboard | null,
    imageSettings?: ImageStoryboardSettings
  ): ShotPrompt[] => {
    if (!storyboard || !storyboard.shots) return [];

    return storyboard.shots.map((shot) => {
      // 生成首帧和尾帧两个提示词
      const promptStart = buildShotPrompt(shot, imageSettings, undefined, 'start');
      const promptEnd = buildShotPrompt(shot, imageSettings, undefined, 'end');
      
      return {
        shotNumber: shot.shotNumber,
        shotType: shot.shotType,
        description: shot.description,
        prompt: promptStart, // 兼容旧版
        promptStart,
        promptEnd,
        isEditing: false,
        isEditingStart: false,
        isEditingEnd: false,
      };
    });
  };

  // 更新单个分镜的提示词 - 支持首帧和尾帧独立更新
  const updateShotPrompt = (chapterNumber: number, shotNumber: number, newPrompt: string, frameType: 'start' | 'end' = 'start') => {
    setChapterStoryboards(prev => ({
      ...prev,
      [chapterNumber]: {
        ...prev[chapterNumber],
        shotPrompts: (prev[chapterNumber].shotPrompts || []).map(sp =>
          sp.shotNumber === shotNumber 
            ? frameType === 'start'
              ? { ...sp, prompt: newPrompt, promptStart: newPrompt }
              : { ...sp, promptEnd: newPrompt }
            : sp
        ),
      }
    }));
  };

  // 确认章节素材
  const confirmChapterAssets = (chapterNumber: number) => {
    setChapterStoryboards(prev => {
      const cs = prev[chapterNumber];
      
      // 生成提示词预览（使用全局封面设置）
      const shotPrompts = generateShotPromptsPreview(cs.storyboard, globalImageSettings);
      
      const updated = {
        ...prev,
        [chapterNumber]: {
          ...prev[chapterNumber],
          assetsConfirmed: true,
          shotPrompts,
        }
      };
      
      // 检查是否所有已确认文字分镜的章节都确认了素材
      const allStoryboardConfirmed = Object.values(updated).filter(cs => cs.storyboardConfirmed);
      const allAssetsConfirmed = allStoryboardConfirmed.every(cs => cs.assetsConfirmed);
      
      // 只要确认了素材就前进到提示词确认步骤
      setCurrentStep(4);
      setProgress(65);
      
      // 如果所有章节素材都已确认，更新步骤确认状态
      if (allAssetsConfirmed && allStoryboardConfirmed.length > 0) {
        setStepConfirmed(prev => ({ ...prev, assets: true }));
        setProgress(70);
      }
      
      // 跳转到提示词标签页
      setActiveTab('prompts');
      
      return updated;
    });
    toast.success(`第 ${chapterNumber} 章素材已确认，请前往提示词标签页生成提示词`);
  };

  // 获取有效的视频比例（用于视频生成 API）
  // 视频生成 API 只支持 16:9 和 9:16
  const getEffectiveVideoRatio = (): '16:9' | '9:16' => {
    return videoRatio;
  };

  const getDisplayImageUrl = (url?: string) => {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    if (typeof window === 'undefined') return url;
    return `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  // 更新全局分镜提示词设置，并同步到所有章节的提示词预览
  const updateGlobalImageSettings = (settings: Partial<ImageStoryboardSettings>) => {
    const newSettings = {
      ...globalImageSettings,
      ...settings,
    };
    setGlobalImageSettings(newSettings);
    
    // 同步更新所有章节的提示词预览
    setChapterStoryboards(prev => {
      const updated = { ...prev };
      Object.keys(updated).forEach(key => {
        const chapterNum = parseInt(key);
        if (updated[chapterNum].storyboard) {
          updated[chapterNum] = {
            ...updated[chapterNum],
            shotPrompts: generateShotPromptsPreview(updated[chapterNum].storyboard!, newSettings),
          };
        }
      });
      return updated;
    });
  };

  // 获取章节关联的素材（人物、场景、道具）
  /** 获取当前提示词组涉及的人物/场景/道具图（只取提示词中提到的） */
  const getGroupAssetImages = (cs: ChapterStoryboard, pg: PromptGroup) => {
    const groupShots = pg.shotNumbers.map(sn =>
      cs.storyboard?.shots.find(s => s.shotNumber === sn)
    ).filter(Boolean) as Shot[];

    // 提取本组涉及的所有名称
    const charNames = new Set(groupShots.flatMap(s => (s.characters || []).map(c => c.name).filter(Boolean)));
    const sceneNames = new Set(groupShots.map(s => s.scene?.location).filter(Boolean));
    const propNames = new Set(groupShots.flatMap(s => s.scene?.props || []));

    const all = getChapterAssetImages(cs.chapterNumber);
    return all
      .filter(a => {
        if (a.type === 'character') return charNames.has(a.name);
        if (a.type === 'scene') return sceneNames.has(a.name);
        if (a.type === 'prop') return propNames.has(a.name);
        return false;
      })
      .flatMap(a => a.images.map(i => i.imageUrl));
  };

  const getChapterRelatedAssets = (chapterNumber: number) => {
    const cs = chapterStoryboards[chapterNumber];
    if (!cs?.storyboard?.shots) return { characters: [], scenes: [], props: [] };

    const characterNames = new Set<string>();
    const sceneNames = new Set<string>();
    const propNames = new Set<string>();

    cs.storyboard.shots.forEach(shot => {
      // 提取人物
      if (shot.characters) {
        shot.characters.forEach((char: any) => {
          if (char.name) characterNames.add(char.name);
        });
      }
      // 提取场景
      if (shot.scene?.location) {
        sceneNames.add(shot.scene.location);
      }
      // 提取道具
      if (shot.scene?.props) {
        shot.scene.props.forEach((prop: string) => propNames.add(prop));
      }
    });

    // 调试日志
    console.log('[getChapterRelatedAssets] 分镜中提取的名称:', {
      characterNames: Array.from(characterNames),
      sceneNames: Array.from(sceneNames),
      propNames: Array.from(propNames),
    });
    console.log('[getChapterRelatedAssets] 提取数据状态:', {
      hasCharactersData: !!charactersData?.characters,
      charactersCount: charactersData?.characters?.length || 0,
      hasScenesData: !!scenesData?.scenes,
      scenesCount: scenesData?.scenes?.length || 0,
      hasPropsData: !!propsData?.props,
      propsCount: propsData?.props?.length || 0,
    });

    // 从提取的数据中找到对应的素材详情
    // 如果提取数据为空，则直接从分镜中创建基础素材信息
    let characters, scenes, props;
    
    if (charactersData?.characters?.length) {
      characters = charactersData.characters.filter((c: any) => characterNames.has(c.name));
    } else {
      // 如果没有提取数据，直接从分镜创建
      characters = Array.from(characterNames).map((name, idx) => ({
        id: `char-from-shot-${idx}`,
        name,
        role: '角色',
      }));
    }
    
    if (scenesData?.scenes?.length) {
      scenes = scenesData.scenes.filter((s: any) => sceneNames.has(s.name));
    } else {
      scenes = Array.from(sceneNames).map((name, idx) => ({
        id: `scene-from-shot-${idx}`,
        name,
        type: '场景',
      }));
    }
    
    if (propsData?.props?.length) {
      props = propsData.props.filter((p: any) => propNames.has(p.name));
    } else {
      props = Array.from(propNames).map((name, idx) => ({
        id: `prop-from-shot-${idx}`,
        name,
        type: '道具',
      }));
    }

    console.log('[getChapterRelatedAssets] 匹配结果:', {
      characters: characters.length,
      scenes: scenes.length,
      props: props.length,
    });

    return { characters, scenes, props };
  };

  // 获取章节关联的素材图片（用于视频生成）
  const getChapterAssetImages = (chapterNumber: number): AssetImages[] => {
    const relatedAssets = getChapterRelatedAssets(chapterNumber);
    const result: AssetImages[] = [];
    
    // 收集人物图片（使用名称作为 key，确保唯一性）
    relatedAssets.characters.forEach((char: any) => {
      const assetData = getAssetImages('character', char.name, char.name);
      if (assetData && assetData.images.length > 0) {
        result.push(assetData);
      }
    });
    
    // 收集场景图片（使用名称作为 key，确保唯一性）
    relatedAssets.scenes.forEach((scene: any) => {
      const assetData = getAssetImages('scene', scene.name, scene.name);
      if (assetData && assetData.images.length > 0) {
        result.push(assetData);
      }
    });
    
    // 收集道具图片（使用名称作为 key，确保唯一性）
    relatedAssets.props.forEach((prop: any) => {
      const assetData = getAssetImages('prop', prop.name, prop.name);
      if (assetData && assetData.images.length > 0) {
        result.push(assetData);
      }
    });
    
    console.log(`[getChapterAssetImages] 章节${chapterNumber}获取到 ${result.length} 个素材的图片`);
    return result;
  };

  // 将 videoPrompts 分组为 3-4 镜一组的提示词组（约15秒/组）
  const groupShotsIntoPromptGroups = (
    videoPrompts: VideoPromptItem[],
    shots: Shot[]
  ): PromptGroup[] => {
    const groups: PromptGroup[] = [];
    const GROUP_SIZE = 4;

    for (let i = 0; i < videoPrompts.length; i += GROUP_SIZE) {
      const groupItems = videoPrompts.slice(i, i + GROUP_SIZE);
      const groupShots = groupItems.map(item => 
        shots.find(s => s.shotNumber === item.shotNumber)
      ).filter(Boolean) as Shot[];
      
      const shotNumbers = groupItems.map(item => item.shotNumber);
      const combinedPrompt = groupItems.map((item, idx) => {
        const prevTransition = idx > 0 ? '【衔接上一镜】过渡至\n' : '';
        return `${prevTransition}【镜头${item.shotNumber}】${item.videoPrompt}`;
      }).join('\n\n');
      
      const totalDuration = groupItems.reduce((sum, item) => sum + (item.duration || 4), 0);
      
      groups.push({
        groupIndex: groups.length + 1,
        shotNumbers,
        combinedPrompt: `【第${groups.length + 1}组 - ${totalDuration}秒连冠段落】\n${combinedPrompt}`,
        isGeneratingStoryboard: false,
        isEditing: false,
      });
    }

    console.log(`[groupShotsIntoPromptGroups] 将 ${videoPrompts.length} 个分镜分为 ${groups.length} 组`);
    return groups;
  }

  const getPromptGroupVideoKey = (pg: PromptGroup) => -Math.abs(pg.groupIndex || pg.shotNumbers[0] || 1);

  const getFirstUsableAssetImage = (asset?: AssetImages) => {
    return asset?.images?.find(image => image.imageUrl && !image.isGenerating)?.imageUrl || '';
  };

  const rankNamesByFrequency = (names: string[]) => {
    const counts = new Map<string, number>();
    names.filter(Boolean).forEach(name => counts.set(name, (counts.get(name) || 0) + 1));
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
  };

  const getPromptGroupShots = (cs: ChapterStoryboard, pg: PromptGroup) => {
    return pg.shotNumbers
      .map(sn => cs.storyboard?.shots.find(s => s.shotNumber === sn))
      .filter(Boolean) as Shot[];
  };

  type VideoReferenceType = 'storyboard' | 'character' | 'scene' | 'prop';

  interface VideoReferenceItem {
    type: VideoReferenceType;
    name: string;
    url: string;
  }

  interface VideoReferenceSelection {
    images: VideoReferenceItem[];
    entities: {
      characters: string[];
      scenes: string[];
      props: string[];
    };
    missingImageEntities: Array<{ type: Exclude<VideoReferenceType, 'storyboard'>; name: string }>;
    overflowEntities: Array<{ type: Exclude<VideoReferenceType, 'storyboard'>; name: string }>;
  }

  const getAllKnownAssetNames = (type: 'character' | 'scene' | 'prop') => {
    const extracted = type === 'character'
      ? [
          ...(charactersData?.characters || []),
          ...(characterBatchInfo?.allCharacters || []),
        ]
      : type === 'scene'
        ? [
            ...(scenesData?.scenes || []),
            ...(sceneBatchInfo?.allScenes || []),
          ]
        : [
            ...(propsData?.props || []),
            ...(propBatchInfo?.allProps || []),
          ];
    const stored = Array.from(assetImages.values())
      .filter(asset => asset.type === type)
      .map(asset => asset.name);

    return Array.from(new Set([
      ...extracted.map((item: any) => item?.name).filter(Boolean),
      ...stored.filter(Boolean),
    ] as string[]));
  };

  const normalizeEntitySearchText = (value: string) => {
    return String(value || '')
      .toLocaleLowerCase()
      .replace(/[\s\u3000"'“”‘’「」『』《》]/g, '');
  };

  const findPromptMentionedNames = (promptText: string, candidates: string[]) => {
    const normalizedPrompt = normalizeEntitySearchText(promptText);
    return candidates
      .filter(name => {
        const normalizedName = normalizeEntitySearchText(name);
        return normalizedName.length >= 2 && normalizedPrompt.includes(normalizedName);
      })
      .sort((a, b) => {
        const aIndex = normalizedPrompt.indexOf(normalizeEntitySearchText(a));
        const bIndex = normalizedPrompt.indexOf(normalizeEntitySearchText(b));
        return aIndex - bIndex;
      });
  };

  const mergeUniqueNames = (...groups: string[][]) => {
    const seen = new Set<string>();
    const result: string[] = [];
    groups.flat().filter(Boolean).forEach(name => {
      const normalized = normalizeEntitySearchText(name);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      result.push(name);
    });
    return result;
  };

  const getVideoReferenceSelection = (
    promptText: string,
    shots: Shot[],
    storyboardImageUrl?: string,
  ): VideoReferenceSelection => {
    const knownCharacters = getAllKnownAssetNames('character');
    const knownScenes = getAllKnownAssetNames('scene');
    const knownProps = getAllKnownAssetNames('prop');

    const shotCharacters = rankNamesByFrequency(
      shots.flatMap(shot => (shot.characters || []).map(char => char.name).filter(Boolean)),
    );
    const shotScenes = rankNamesByFrequency(
      shots.map(shot => shot.scene?.location).filter(Boolean) as string[],
    );
    const shotProps = rankNamesByFrequency(shots.flatMap(shot => shot.scene?.props || []));

    const entities = {
      characters: mergeUniqueNames(
        shotCharacters,
        findPromptMentionedNames(promptText, knownCharacters),
      ),
      scenes: mergeUniqueNames(
        shotScenes,
        findPromptMentionedNames(promptText, knownScenes),
      ),
      props: mergeUniqueNames(
        shotProps,
        findPromptMentionedNames(promptText, knownProps),
      ),
    };

    const selected: VideoReferenceItem[] = [];
    const seen = new Set<string>();
    const missingImageEntities: VideoReferenceSelection['missingImageEntities'] = [];
    const overflowEntities: VideoReferenceSelection['overflowEntities'] = [];

    const addImage = (type: VideoReferenceType, name: string, url?: string) => {
      const displayUrl = getDisplayImageUrl(url);
      if (!displayUrl) {
        if (type !== 'storyboard') missingImageEntities.push({ type, name });
        return;
      }
      if (seen.has(displayUrl)) return;
      if (selected.length >= 9) {
        if (type !== 'storyboard') overflowEntities.push({ type, name });
        return;
      }
      seen.add(displayUrl);
      selected.push({ type, name, url: displayUrl });
    };
    const addAsset = (type: 'scene' | 'character' | 'prop', name?: string) => {
      if (!name) return;
      addImage(type, name, getFirstUsableAssetImage(getAssetImages(type, name, name)));
    };

    if (storyboardImageUrl) {
      addImage('storyboard', '故事板总控图', storyboardImageUrl);
    }

    entities.characters.slice(0, 3).forEach(name => addAsset('character', name));
    entities.scenes.slice(0, 2).forEach(name => addAsset('scene', name));
    entities.characters.slice(3).forEach(name => addAsset('character', name));
    entities.props.forEach(name => addAsset('prop', name));
    entities.scenes.slice(2).forEach(name => addAsset('scene', name));

    return {
      images: selected,
      entities,
      missingImageEntities,
      overflowEntities,
    };
  };

  const getPromptGroupReferenceSelection = (cs: ChapterStoryboard, pg: PromptGroup) => {
    const groupShots = getPromptGroupShots(cs, pg);
    const storyboardPrompt = pg.storyboardPromptText || pg.combinedPrompt || '';
    const entitySearchText = [
      storyboardPrompt,
      ...groupShots.flatMap(shot => [
        shot.description || '',
        shot.actionAndDialogue || '',
        shot.actorBlocking || '',
        (shot.characters || []).map(char => char.name).join('、'),
        shot.scene?.location || '',
        (shot.scene?.props || []).join('、'),
      ]),
    ].join('\n');

    return getVideoReferenceSelection(entitySearchText, groupShots, pg.storyboardImageUrl);
  };

  const buildVideoReferenceManifest = (selection: VideoReferenceSelection) => {
    const entityLines = [
      `人物：${selection.entities.characters.join('、') || '无'}`,
      `场景：${selection.entities.scenes.join('、') || '无'}`,
      `道具：${selection.entities.props.join('、') || '无'}`,
    ];
    const imageLines = selection.images.map((item, index) => {
      const label = item.type === 'storyboard'
        ? item.name
        : `${item.type === 'character' ? '人物' : item.type === 'scene' ? '场景' : '道具'}「${item.name}」`;
      return `图${index + 1}：${label}`;
    });
    const notIndependentlyReferenced = [
      ...selection.missingImageEntities,
      ...selection.overflowEntities,
    ];

    return [
      `【本次必须关联的全部实体】\n${entityLines.join('\n')}`,
      imageLines.length > 0
        ? `【参考图序号对应关系】\n${imageLines.join('\n')}`
        : '【参考图序号对应关系】无独立参考图',
      notIndependentlyReferenced.length > 0
        ? `未单独传图的实体：${notIndependentlyReferenced.map(item => item.name).join('、')}。这些实体仍必须出现在对应镜头中，并严格沿用故事板总控图中的形象、空间和道具设计。`
        : '',
    ].filter(Boolean).join('\n\n');
  };

  const buildPromptGroupVideoPrompt = (
    cs: ChapterStoryboard,
    pg: PromptGroup,
    referenceSelection: VideoReferenceSelection,
  ) => {
    const groupShots = getPromptGroupShots(cs, pg);
    const storyboardPrompt = pg.storyboardPromptText || pg.combinedPrompt || '';
    const shotLines = groupShots.map(shot => {
      const characterText = (shot.characters || []).map(char => {
        return [char.name, char.position, char.action, char.expression].filter(Boolean).join('/');
      }).join('；');
      return `镜头${shot.shotNumber}：${shot.description || shot.actionAndDialogue || ''}；景别${shot.shotType || '中景'}；运镜${shot.cameraMovement || '稳定运镜'}；站位${shot.actorBlocking || characterText || '按故事版总控图执行'}；动作变化${shot.actionChange || '保持连续动作变化'}`;
    }).join('\n');

    return [
      `请生成第${cs.chapterNumber}集第${pg.groupIndex}组连续视频，时长约15秒。`,
      buildVideoReferenceManifest(referenceSelection),
      `核心参考：优先严格参考本组故事版总控图的角色形象、场景空间、人物站位、镜头顺序和画面构图。`,
      `本次会提供${referenceSelection.images.length}张参考图。提示词中出现的全部人物、场景、道具都必须参与对应镜头，不能因为没有独立参考图而遗漏。`,
      `【本组故事版提示词】\n${storyboardPrompt}`,
      `【本组镜头内容】\n${shotLines}`,
      `要求：画面连续、动作自然、人物表情和肢体动作要有变化；保持原剧情，台词必须与文字分镜/原剧本逐字一致，不出现字幕、水印、乱码文字，不新增无关人物。`,
    ].join('\n\n');
  };

  const getSingleShotVideoPayload = (
    cs: ChapterStoryboard,
    shot: Shot,
    promptText: string,
  ) => {
    const shotStoryboardImage = cs.imageStoryboards?.find(item => item.shotNumber === shot.shotNumber)?.imageUrl;
    const entitySearchText = [
      promptText,
      shot.description || '',
      shot.actionAndDialogue || '',
      shot.actorBlocking || '',
      (shot.characters || []).map(char => char.name).join('、'),
      shot.scene?.location || '',
      (shot.scene?.props || []).join('、'),
    ].join('\n');
    const referenceSelection = getVideoReferenceSelection(entitySearchText, [shot], shotStoryboardImage);

    return {
      prompt: [
        buildVideoReferenceManifest(referenceSelection),
        `【镜头生成提示词】\n${promptText}`,
        '提示词中出现的全部人物、场景、道具都必须参与画面，严格对应参考图，不得遗漏或自行替换。',
      ].join('\n\n'),
      imageUrls: referenceSelection.images.map(item => item.url),
      referenceSelection,
    };
  };

  // 删除存储中的图片文件
  const deleteStoredImages = async (imageKeys: string[], imageUrls: string[], folder?: string) => {
    if (imageKeys.length === 0 && imageUrls.length === 0) return;
    
    console.log(`[deleteStoredImages] 删除 ${imageKeys.length} 个图片文件`);
    
    // 批量删除，最多并发 5 个
    const batchSize = 5;
    for (let i = 0; i < imageKeys.length; i += batchSize) {
      const batch = imageKeys.slice(i, i + batchSize);
      await Promise.all(batch.map(async (imageKey) => {
        if (!imageKey) return;
        try {
          await fetch('/api/delete-asset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageKey, folder }),
          });
        } catch (e) {
          console.error('[deleteStoredImages] 删除失败:', imageKey, e);
        }
      }));
    }
    
    // 删除通过 URL 访问的文件
    for (let i = 0; i < imageUrls.length; i += batchSize) {
      const batch = imageUrls.slice(i, i + batchSize);
      await Promise.all(batch.map(async (imageUrl) => {
        if (!imageUrl) return;
        try {
          await fetch('/api/delete-asset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl, folder }),
          });
        } catch (e) {
          console.error('[deleteStoredImages] 删除 URL 文件失败:', imageUrl, e);
        }
      }));
    }
  };

  // 收集并删除分镜图片
  const cleanupStoryboardImages = async () => {
    const imageKeys: string[] = [];
    const imageUrls: string[] = [];
    
    // 收集单章节模式的分镜图片
    imageStoryboards.forEach(item => {
      if (item.imageKey) imageKeys.push(item.imageKey);
      if (item.imageKeyEndFrame) imageKeys.push(item.imageKeyEndFrame);
      if (item.imageUrl && !item.imageKey) {
        // 如果没有 key，尝试从 URL 中提取
        imageUrls.push(item.imageUrl);
      }
      if (item.imageUrlEndFrame && !item.imageKeyEndFrame) {
        imageUrls.push(item.imageUrlEndFrame);
      }
    });
    
    // 收集多章节模式的分镜图片
    Object.values(chapterStoryboards).forEach(cs => {
      cs.imageStoryboards?.forEach(item => {
        if (item.imageKey) imageKeys.push(item.imageKey);
        if (item.imageKeyEndFrame) imageKeys.push(item.imageKeyEndFrame);
        if (item.imageUrl && !item.imageKey) {
          imageUrls.push(item.imageUrl);
        }
        if (item.imageUrlEndFrame && !item.imageKeyEndFrame) {
          imageUrls.push(item.imageUrlEndFrame);
        }
      });
    });
    
    // 收集视频结果中的图片
    videoResults.forEach(v => {
      if (v.lastFrameUrl) {
        imageUrls.push(v.lastFrameUrl);
      }
    });
    
    if (imageKeys.length > 0 || imageUrls.length > 0) {
      console.log(`[cleanupStoryboardImages] 清理 ${imageKeys.length} 个图片key, ${imageUrls.length} 个图片URL`);
      await deleteStoredImages(imageKeys, imageUrls, '分镜图片');
    }
  };

  // 收集并删除素材图片
  const cleanupAssetImages = async () => {
    const imageKeys: string[] = [];
    const imageUrls: string[] = [];
    
    assetImages.forEach((asset) => {
      asset.images.forEach(img => {
        if (img.imageKey) imageKeys.push(img.imageKey);
        if (img.imageUrl && !img.imageKey) {
          imageUrls.push(img.imageUrl);
        }
      });
    });
    
    if (imageKeys.length > 0 || imageUrls.length > 0) {
      console.log(`[cleanupAssetImages] 清理 ${imageKeys.length} 个素材图片key`);
      await deleteStoredImages(imageKeys, imageUrls);
    }
  };

  // 确认当前步骤并进入下一步
  const confirmStep = async (step: 'upload' | 'extraction' | 'storyboard' | 'assets' | 'prompts' | 'videos') => {
    if (step === 'upload' && fileContent) {
      if (!(await requireLoginBeforePaidAction())) return;
    }

    if (step === 'extraction') {
      const expectedChapters = outlineBatchInfo?.totalEpisodes || outline?.totalChapters || 0;
      const extractedChapters = Math.max(
        outline?.chapters?.length || 0,
        outlineBatchInfo?.allChapters?.length || 0
      );
      const isOutlineComplete = expectedChapters === 0 || extractedChapters >= expectedChapters;
      const isExtractionComplete =
        extractionStatus.scenes === 'success' &&
        extractionStatus.characters === 'success' &&
        extractionStatus.props === 'success' &&
        extractionStatus.outline === 'success' &&
        isOutlineComplete;

      if (!isExtractionComplete) {
        if (!isOutlineComplete && fileContent) {
          if (!(await requireLoginBeforePaidAction())) return;
          setExtractionStatus(prev => ({ ...prev, outline: 'loading' }));
          toast.info(`大纲还没提取完：${extractedChapters}/${expectedChapters} 章，正在继续补齐...`);
          void extractOutlineBatch(
            fileContent,
            uploadedFile?.name || uploadedFileName || '剧本',
            outlineBatchInfo?.hasMore ? outlineBatchInfo.currentBatch + 1 : 1,
            outlineBatchInfo?.basicInfo || null,
            outlineBatchInfo?.hasMore ? (outlineBatchInfo.allChapters || outline?.chapters || []) : [],
            outlineBatchInfo?.episodeMarkers,
            true
          );
        } else {
          toast.info('提取结果还没全部完成，请稍等');
        }
        return;
      }
    }

    setStepConfirmed(prev => ({ ...prev, [step]: true }));
    
    // 根据步骤设置进度和进入下一步
    // 步骤索引: 0上传 1提取 2分镜 3素材 4提示词 5视频
    switch (step) {
      case 'upload':
        setCurrentStep(1);
        setProgress(15);
        if (fileContent) {
          void extractAllParallel(fileContent, uploadedFile?.name || uploadedFileName || '剧本');
        }
        break;
      case 'extraction':
        setCurrentStep(2);
        setProgress(30);
        toast.info('请选择章节生成分镜');
        break;
      case 'storyboard': {
        // 分镜确认后进入素材确认步骤
        // 为所有成功生成分镜的章节设置 storyboardConfirmed = true
        const confirmedStoryboardChapterKeys = Object.fromEntries(
          Object.values(chapterStoryboards)
            .filter(chapter => chapter.status === 'success' && chapter.storyboard?.shots && chapter.storyboard.shots.length > 0)
            .map(chapter => [String(chapter.chapterNumber), true])
        ) as Record<string, boolean>;
        setChapterStoryboards(prev => {
          const updated = { ...prev };
          Object.keys(updated).forEach(key => {
            const chapterNum = parseInt(key);
            const chapter = updated[chapterNum];
            if (chapter && chapter.status === 'success' && chapter.storyboard?.shots && chapter.storyboard.shots.length > 0) {
              updated[chapterNum] = {
                ...chapter,
                storyboardConfirmed: true,
              };
            }
          });
          return updated;
        });
        setCollapsedStoryboardChapters(prev => ({ ...prev, ...confirmedStoryboardChapterKeys }));
        setCurrentStep(3);
        setProgress(50);
        toast.info('请确认章节素材图片是否正确');
        break;
      }
      case 'assets':
        // 素材确认后进入提示词确认步骤
        setCurrentStep(4);
        setProgress(65);
        break;
      case 'prompts':
        // 提示词确认后进入生成视频步骤
        setCurrentStep(5);
        setProgress(80);
        toast.info('开始生成视频片段...');
        if (connectingPrompts && imageStoryboards.length > 0 && storyboard) {
          void generateVideos(connectingPrompts.shotPrompts, imageStoryboards, storyboard.chapterTitle);
        }
        break;
      case 'videos':
        setProgress(100);
        toast.success('全部流程已完成！');
        break;
    }
  };

  // 撤回到指定步骤
  const revertToStep = async (step: 'upload' | 'extraction' | 'storyboard' | 'assets' | 'prompts' | 'videos') => {
    const stepOrder = ['upload', 'extraction', 'storyboard', 'assets', 'prompts', 'videos'] as const;
    const stepIndex = stepOrder.indexOf(step);
    
    // 重置该步骤及之后所有步骤的确认状态
    setStepConfirmed(prev => {
      const newState = { ...prev };
      for (let i = stepIndex; i < stepOrder.length; i++) {
        newState[stepOrder[i]] = false;
      }
      return newState;
    });
    
    // 根据步骤清空相关数据并重置状态
    // 步骤索引: 0上传 1提取 2分镜 3素材 4提示词 5视频
    switch (step) {
      case 'upload':
        // 重新开始 - 删除所有生成的图片
        await cleanupStoryboardImages();
        await cleanupAssetImages();
        setUploadedFile(null);
        setFileContent('');
        setScenesData(null);
        setCharactersData(null);
        setPropsData(null);
        setOutline(null);
        setSelectedChapter(null);
        setStoryboard(null);
        setImageStoryboards([]);
        setConnectingPrompts(null);
        setVideoResults([]);
        setVideoTotalDuration(0);
        setAssetImages(() => new Map());
        setChapterStoryboards({});
        setCurrentStep(0);
        setProgress(0);
        toast.info('已撤回到初始状态，请重新上传文件');
        break;
      case 'extraction':
        // 重新提取 - 删除所有生成的图片
        await cleanupStoryboardImages();
        await cleanupAssetImages();
        setScenesData(null);
        setCharactersData(null);
        setPropsData(null);
        setOutline(null);
        setSelectedChapter(null);
        setStoryboard(null);
        setImageStoryboards([]);
        setConnectingPrompts(null);
        setVideoResults([]);
        setVideoTotalDuration(0);
        setAssetImages(() => new Map());
        setChapterStoryboards({});
        setCurrentStep(1);
        setProgress(15);
        toast.info('已撤回，将重新提取内容');
        if (fileContent && uploadedFile) {
          extractAllParallel(fileContent, uploadedFile.name);
        }
        break;
      case 'storyboard':
        // 重新选择章节 - 删除分镜图片
        await cleanupStoryboardImages();
        setSelectedChapter(null);
        setStoryboard(null);
        setImageStoryboards([]);
        setConnectingPrompts(null);
        setVideoResults([]);
        setVideoTotalDuration(0);
        setChapterStoryboards({});
        setCurrentStep(2);
        setProgress(30);
        toast.info('已撤回，请重新选择章节');
        break;
      case 'assets':
        // 重新确认素材 - 删除分镜图片
        await cleanupStoryboardImages();
        setImageStoryboards([]);
        setConnectingPrompts(null);
        setVideoResults([]);
        setVideoTotalDuration(0);
        // 重置章节的确认状态
        setChapterStoryboards(prev => {
          const updated = { ...prev };
          Object.keys(updated).forEach(key => {
            updated[parseInt(key)] = {
              ...updated[parseInt(key)],
              imageStoryboards: [],
              assetsConfirmed: false,
              promptsConfirmed: false,
              shotPrompts: [],
              videoPrompts: [],
              shotVideos: [],
            };
          });
          return updated;
        });
        setCurrentStep(3);
        setProgress(50);
        toast.info('已撤回，请重新确认素材');
        break;
      case 'prompts':
        // 重新生成提示词
        setVideoResults([]);
        setVideoTotalDuration(0);
        // 重置章节的视频状态
        setChapterStoryboards(prev => {
          const updated = { ...prev };
          Object.keys(updated).forEach(key => {
            updated[parseInt(key)] = {
              ...updated[parseInt(key)],
              shotVideos: [],
            };
          });
          return updated;
        });
        setCurrentStep(4);
        setProgress(65);
        toast.info('已撤回，请重新确认提示词');
        break;
      case 'videos':
        // 重新生成视频
        // 重置章节的视频状态
        setChapterStoryboards(prev => {
          const updated = { ...prev };
          Object.keys(updated).forEach(key => {
            updated[parseInt(key)] = {
              ...updated[parseInt(key)],
              shotVideos: [],
            };
          });
          return updated;
        });
        setCurrentStep(5);
        setProgress(80);
        toast.info('已撤回，正在重新生成视频');
        if (connectingPrompts && imageStoryboards.length > 0 && storyboard) {
          generateVideos(connectingPrompts.shotPrompts, imageStoryboards, storyboard.chapterTitle);
        }
        break;
    }
  };

  // 上传文件
  const handleFileUpload = async (file: File) => {
    if (!(await requireLoginBeforePaidAction())) return;

    setIsProcessing(true);
    setProgress(10);
    
    try {
      setUploadedFile(file);
      
      const formData = new FormData();
      formData.append('file', file);
      
      const uploadResponse = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      
      const uploadData = await uploadResponse.json();
      
      if (uploadData.success) {
        const content = uploadData.content;
        setFileContent(content);
        setUploadedFileName(file.name); // 持久化文件名
        toast.success(`文件上传成功 (${uploadData.fileType}格式)，请确认后继续`);
        
        // 上传完成，等待用户确认后再提取
        setProgress(10);
      } else {
        // 处理特定错误类型
        const errorMsg = uploadData.error || '上传失败';
        const suggestion = uploadData.suggestion || '';
        
        if (uploadData.error === '文档解析服务暂时不可用') {
          toast.error(`${errorMsg}\n${suggestion}`, { duration: 6000 });
        } else {
          toast.error(`${errorMsg}${suggestion ? `\n${suggestion}` : ''}`);
        }
        
        // 重置状态
        setUploadedFile(null);
        setFileContent('');
        setProgress(0);
      }
    } catch (error) {
      console.error('文件上传失败:', error);
      toast.error(getNetworkErrorMessage(error, '上传文件'));
      
      // 重置状态
      setUploadedFile(null);
      setFileContent('');
      setProgress(0);
    } finally {
      setIsProcessing(false);
    }
  };

  // 生成分镜脚本
  const generateStoryboard = async (chapter: Chapter) => {
    if (!(await requireLoginBeforePaidAction())) return;

    setIsProcessing(true);
    setProgress(50);
    setSelectedChapter(chapter);
    
    try {
      // 合并提取的数据到章节内容中
      const enhancedChapter = {
        ...chapter,
        scenesData,
        charactersData,
        propsData,
      };

      const response = await fetch('/api/generate-storyboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chapterContent: chapter.content,
          chapterTitle: chapter.title,
          characters: chapter.characters,
          scenes: chapter.scenes,
          scenesData,
          charactersData,
          propsData,
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        setStoryboard(data.storyboard);
        if (data.tokenUsage) {
          setTokenUsage(prev => ({ ...prev, generateStoryboard: data.tokenUsage }));
        }
        toast.success('分镜脚本生成成功，请确认后继续');
        setProgress(45);
        setCurrentStep(2);
        
        // 分镜生成完成，等待用户确认后再生成图片
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error('分镜脚本生成失败:', error);
      toast.error('分镜脚本生成失败');
    } finally {
      setIsProcessing(false);
    }
  };

  const stopStoryboardGeneration = () => {
    storyboardBatchCancelledRef.current = true;
    if (storyboardAbortControllerRef.current) {
      storyboardAbortControllerRef.current.abort();
      storyboardAbortControllerRef.current = null;
    }
    setIsProcessing(false);
    setGenerationTasks(prev => prev.map(task =>
      task.type === 'storyboard' && (task.status === 'generating' || task.status === 'pending')
        ? { ...task, status: 'error', error: '已手动停止，可继续生成未完成章节', endTime: Date.now(), message: `第 ${task.chapterNumber} 章已停止` }
        : task
    ));
    setChapterStoryboards(prev => {
      const next = { ...prev };
      Object.entries(next).forEach(([chapterNumber, chapter]) => {
        if (chapter.status === 'generating') {
          const shotCount = chapter.storyboard?.shots?.length ?? 0;
          next[Number(chapterNumber)] = {
            ...chapter,
            status: shotCount > 0 ? 'success' : 'error',
            error: shotCount > 0 ? undefined : '已手动停止，可重新生成',
            storyboard: shotCount > 0 ? chapter.storyboard : null,
          };
        }
      });
      return next;
    });
    toast.info('已停止文字分镜生成，可点击继续生成未完成章节');
  };

  // 生成单个章节的文字分镜（用于并行生成）- SSE流式版本，支持逐行显示
  const generateSingleStoryboard = async (chapter: Chapter): Promise<{ chapter: Chapter; storyboard: Storyboard | null; error?: string }> => {
    if (!(await requireLoginBeforePaidAction())) {
      return { chapter, storyboard: null, error: '请先登录账号后再生成文字分镜' };
    }

    const taskId = `storyboard-${chapter.chapterNumber}-${Date.now()}`;

    // 调试日志：检查章节内容
    console.log(`[生成分镜] 章节 ${chapter.chapterNumber} (${chapter.title})`);
    console.log(`[生成分镜] content长度: ${chapter.content?.length || 0}`);
    console.log(`[生成分镜] content前100字:`, chapter.content?.substring(0, 100));
    console.log(`[生成分镜] 完整章节对象:`, chapter);
    
    // 添加任务
    setGenerationTasks(prev => [...prev, {
      taskId,
      type: 'storyboard',
      chapterNumber: chapter.chapterNumber,
      chapterTitle: chapter.title,
      status: 'generating',
      progress: 0,
      total: 1,
      message: `正在生成第 ${chapter.chapterNumber} 章分镜...`,
      startTime: Date.now(),
    }]);

    // 初始化一个空的分镜数据
    let shots: any[] = [];
    let chapterTitleResult = chapter.title;
    const controller = new AbortController();
    storyboardAbortControllerRef.current = controller;

    try {
      const response = await fetch('/api/generate-storyboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          chapterContent: chapter.content,
          chapterTitle: chapter.title,
          chapterSummary: chapter.summary,  // 添加 summary 作为后备
          characters: chapter.characters,
          scenes: chapter.scenes,
          scenesData,
          charactersData,
          propsData,
        }),
      });

      // 检查响应状态
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: '未知错误' }));
        console.error(`[生成分镜] 第${chapter.chapterNumber}章请求失败:`, errorData);
        throw new Error(errorData.error || errorData.hint || `请求失败(${response.status})`);
      }

      // 处理SSE流式响应
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法读取响应流');
      }

      const decoder = new TextDecoder();
      let sseBuffer = '';

      const handleStoryboardEvent = (json: any) => {
        if (json.type === 'status' || json.type === 'segment_start' || json.type === 'segment_done') {
          return;
        }

        if (json.type === 'start') {
          // 更新任务进度
          setGenerationTasks(prev => prev.map(t => 
            t.taskId === taskId 
              ? { ...t, total: json.targetShotCount, message: `第 ${chapter.chapterNumber} 章开始生成分镜 (目标${json.targetShotCount}个)...` }
              : t
          ));
          
          // 初始化章节分镜状态
          setChapterStoryboards(prev => ({
            ...prev,
            [chapter.chapterNumber]: {
              chapterNumber: chapter.chapterNumber,
              chapterTitle: json.chapterTitle || chapter.title,
              storyboard: {
                chapterTitle: json.chapterTitle || chapter.title,
                shots: [],
                wordCount: json.wordCount,
                targetShotCount: json.targetShotCount,
              },
              imageStoryboards: [],
              status: 'generating',
              storyboardConfirmed: false,
              assetsConfirmed: false,
              promptsConfirmed: false,
              shotPrompts: [],
              videoPrompts: [],
            }
          }));
          
        } else if (json.type === 'shot') {
          // 收到单个分镜，实时追加显示
          shots.push(json.shot);
          
          // 更新任务进度
          setGenerationTasks(prev => prev.map(t => 
            t.taskId === taskId 
              ? { ...t, progress: json.progress / 100, message: `第 ${chapter.chapterNumber} 章分镜生成中 (${json.shotNumber}/${json.total})...` }
              : t
          ));
          
          // 实时更新章节分镜 - 逐行显示效果
          setChapterStoryboards(prev => {
            const existing = prev[chapter.chapterNumber];
            const existingShots = existing?.storyboard?.shots || [];
            return {
              ...prev,
              [chapter.chapterNumber]: {
                chapterNumber: chapter.chapterNumber,
                chapterTitle: chapter.title,
                storyboard: {
                  chapterTitle: chapter.title,
                  shots: [...existingShots, json.shot],
                },
                imageStoryboards: [],
                status: 'generating',
                storyboardConfirmed: false,
                assetsConfirmed: false,
                promptsConfirmed: false,
                shotPrompts: [],
                videoPrompts: [],
              }
            };
          });
          
        } else if (json.type === 'complete') {
          // 更新token统计
          if (json.tokenUsage) {
            setTokenUsage(prev => ({ ...prev, generateStoryboard: json.tokenUsage }));
          }
          
        } else if (json.type === 'error') {
          throw new Error(json.error || '服务端生成失败');
        }
      };

      const processSseEvent = (eventText: string) => {
        const dataText = eventText
          .split('\n')
          .filter(line => line.startsWith('data: '))
          .map(line => line.slice(6))
          .join('\n')
          .trim();

        if (!dataText || dataText === '[DONE]') return;

        try {
          const json = JSON.parse(dataText);
          handleStoryboardEvent(json);
        } catch (error) {
          if (error instanceof SyntaxError) {
            console.warn('[生成分镜] SSE事件解析失败，等待后续数据或跳过异常事件:', dataText.slice(0, 200));
            return;
          }
          throw error;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const events = sseBuffer.split('\n\n');
        sseBuffer = events.pop() || '';

        for (const eventText of events) {
          processSseEvent(eventText);
        }
      }

      sseBuffer += decoder.decode();
      if (sseBuffer.trim()) {
        processSseEvent(sseBuffer);
      }

      if (shots.length > 0) {
        // 更新任务状态
        setGenerationTasks(prev => prev.map(t => 
          t.taskId === taskId 
            ? { ...t, status: 'success', progress: 1, endTime: Date.now(), message: `第 ${chapter.chapterNumber} 章分镜生成完成 (${shots.length}个)` }
            : t
        ));
        
        // 最终更新章节分镜状态
        setChapterStoryboards(prev => ({
          ...prev,
          [chapter.chapterNumber]: {
            ...prev[chapter.chapterNumber],
            status: 'success',
            storyboard: {
              chapterTitle: chapterTitleResult,
              shots: shots,
              totalShots: shots.length,
            }
          }
        }));
        
        return { chapter, storyboard: { chapterTitle: chapterTitleResult, shots, totalShots: shots.length } };
      } else {
        throw new Error('未获取到分镜数据');
      }
    } catch (error: any) {
      const isAbort = error?.name === 'AbortError' || controller.signal.aborted || storyboardBatchCancelledRef.current;
      // 更新任务状态
      setGenerationTasks(prev => prev.map(t => 
        t.taskId === taskId 
          ? {
              ...t,
              status: 'error',
              error: isAbort ? '已停止生成，可稍后继续' : (error?.message || '生成失败'),
              endTime: Date.now(),
              message: isAbort ? `第 ${chapter.chapterNumber} 章已停止` : `第 ${chapter.chapterNumber} 章分镜生成失败`,
            }
          : t
      ));
      
      // 更新章节状态为失败
      setChapterStoryboards(prev => ({
        ...prev,
        [chapter.chapterNumber]: {
          ...prev[chapter.chapterNumber],
          status: 'error',
          error: isAbort ? '已停止生成，可重新生成' : (error?.message || '生成失败'),
          storyboard: null,
        }
      }));
      
      return { chapter, storyboard: null, error: isAbort ? '已停止生成' : error?.message };
    } finally {
      if (storyboardAbortControllerRef.current === controller) {
        storyboardAbortControllerRef.current = null;
      }
    }
  };

  // 重新生成单个章节的文字分镜
  const regenerateSingleStoryboard = async (chapterNumber: number) => {
    if (!outline?.chapters) return;
    if (!(await requireLoginBeforePaidAction())) return;
    
    const chapter = outline.chapters.find(c => c.chapterNumber === chapterNumber);
    if (!chapter) {
      toast.error('未找到该章节');
      return;
    }

    // 先清除该章节的分镜数据
    setCollapsedStoryboardChapters(prev => ({ ...prev, [String(chapterNumber)]: false }));
    setChapterStoryboards(prev => ({
      ...prev,
      [chapterNumber]: {
        chapterNumber,
        chapterTitle: chapter.title,
        storyboard: null,
        imageStoryboards: [],
        status: 'pending',
        storyboardConfirmed: false,
        assetsConfirmed: false,
        promptsConfirmed: false,
        shotPrompts: [],
        videoPrompts: [],
      }
    }));

    // 清除相关的生成任务
    setGenerationTasks(prev => prev.filter(t => 
      !(t.type === 'storyboard' && t.chapterNumber === chapterNumber)
    ));

    toast.info(`开始重新生成第 ${chapterNumber} 章分镜...`);

    // 调用生成函数
    const result = await generateSingleStoryboard(chapter);
    
    if (result.storyboard) {
      toast.success(`第 ${chapterNumber} 章分镜重新生成成功`);
    } else {
      toast.error(`第 ${chapterNumber} 章分镜重新生成失败: ${result.error}`);
    }
  };

  // 一键生成所有章节的文字分镜（每4集一批，分批生成）
  const generateAllStoryboards = async () => {
    if (!outline?.chapters || outline.chapters.length === 0) {
      toast.error('没有章节可生成分镜');
      return;
    }
    if (!(await requireLoginBeforePaidAction())) return;

    storyboardBatchCancelledRef.current = false;

    const chapters = outline.chapters;
    const BATCH_SIZE = batchInfo.batchSize || 4;
    const totalBatches = Math.ceil(chapters.length / BATCH_SIZE);
    const isSuccessfulStoryboard = (cs?: ChapterStoryboard) => {
      return cs?.status === 'success' && !!cs.storyboard?.shots?.length;
    };
    const successfulChapterNumbers = new Set(
      Object.values(chapterStoryboards)
        .filter(isSuccessfulStoryboard)
        .map(cs => cs.chapterNumber)
    );

    if (successfulChapterNumbers.size >= chapters.length) {
      toast.success(`全部 ${chapters.length} 个章节分镜已生成，无需重复生成`);
      setBatchInfo({ active: false, batchSize: BATCH_SIZE, totalBatches: 0, completedBatches: 0 });
      setStepConfirmed(prev => ({ ...prev, storyboard: true }));
      setCurrentStep(2);
      return;
    }

    const firstIncompleteIndex = chapters.findIndex(chapter => !successfulChapterNumbers.has(chapter.chapterNumber));
    const resumeBatch = Math.max(0, Math.floor(firstIncompleteIndex / BATCH_SIZE));

    if (Object.keys(chapterStoryboards).length === 0) {
      setCollapsedStoryboardChapters({});
    }

    // 初始化缺失章节为 pending，但保留已成功章节，避免断网后重跑已完成内容。
    setChapterStoryboards(prev => {
      const initialized: Record<number, ChapterStoryboard> = { ...prev };
      chapters.forEach(chapter => {
        if (!initialized[chapter.chapterNumber]) {
          initialized[chapter.chapterNumber] = {
            chapterNumber: chapter.chapterNumber,
            chapterTitle: chapter.title,
            storyboard: null,
            imageStoryboards: [],
            status: 'pending',
            storyboardConfirmed: false,
            assetsConfirmed: false,
            promptsConfirmed: false,
            shotPrompts: [],
            videoPrompts: [],
          };
        }
      });
      return initialized;
    });

    setIsProcessing(true);
    setGenerationTasks(prev => prev.filter(t => t.status === 'generating' || t.status === 'pending').slice(-8));
    
    const startIdx = resumeBatch * BATCH_SIZE;
    const endIdx = Math.min(startIdx + BATCH_SIZE, chapters.length);
    const batchLabel = `第 ${resumeBatch + 1}/${totalBatches} 批（${startIdx + 1}-${endIdx} 章）`;
    const loadingToast = toast.loading(`正在生成 ${batchLabel}...`);
    setBatchInfo({ active: true, batchSize: BATCH_SIZE, totalBatches, completedBatches: resumeBatch });

    const batchResults: { chapterNumber: number; success: boolean; skipped?: boolean; error?: string }[] = [];
    
    try {
      // 逐章串行生成（仅当前批次的章节）
      for (let i = startIdx; i < endIdx; i++) {
        if (storyboardBatchCancelledRef.current) {
          break;
        }

        const chapter = chapters[i];
        const chapterNum = chapter.chapterNumber;

        if (successfulChapterNumbers.has(chapterNum)) {
          batchResults.push({ chapterNumber: chapterNum, success: true, skipped: true });
          continue;
        }
        
        toast.loading(`正在生成第 ${chapterNum} 章...（${batchLabel}）`, { id: loadingToast });
        setCollapsedStoryboardChapters(prev => ({ ...prev, [String(chapterNum)]: false }));
        
        let lastError = '';
        let result = null;
        
        // 自动重试（最多 2 次）
        for (let attempt = 0; attempt < 3; attempt++) {
          if (storyboardBatchCancelledRef.current) {
            break;
          }

          if (attempt > 0) {
            toast.loading(`第 ${chapterNum} 章第 ${attempt + 1} 次重试...（${batchLabel}）`, { id: loadingToast });
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
          
          result = await generateSingleStoryboard(chapter);
          
          if (result.storyboard) {
            break;
          }
          if (storyboardBatchCancelledRef.current) {
            break;
          }
          lastError = result.error || '未知错误';
        }

        if (storyboardBatchCancelledRef.current) {
          break;
        }
        
        batchResults.push({
          chapterNumber: chapterNum,
          success: !!result!.storyboard,
          error: result!.storyboard ? undefined : lastError,
        });
        
        if (result!.storyboard) {
          successfulChapterNumbers.add(chapterNum);
          toast.success(`第 ${chapterNum} 章 ✅`, { id: loadingToast });
        } else {
          toast.error(`第 ${chapterNum} 章失败: ${lastError}`, { id: loadingToast });
        }
      }
      
      // 当前批次完成
      toast.dismiss(loadingToast);
      
      const batchSuccessCount = batchResults.filter(r => r.success).length;
      const skippedCount = batchResults.filter(r => r.skipped).length;
      const nextIncompleteIndex = chapters.findIndex(chapter => !successfulChapterNumbers.has(chapter.chapterNumber));
      const newCompletedBatches = nextIncompleteIndex === -1 ? totalBatches : Math.floor(nextIncompleteIndex / BATCH_SIZE);

      if (storyboardBatchCancelledRef.current) {
        toast.info('已停止生成，本批未完成章节下次会自动继续');
        setBatchInfo({ active: true, batchSize: BATCH_SIZE, totalBatches, completedBatches: resumeBatch });
      } else if (nextIncompleteIndex === -1) {
        // 全部批次完成
        const allSuccessCount = successfulChapterNumbers.size;
        const allFailCount = chapters.length - allSuccessCount;

        if (allSuccessCount === chapters.length) {
          toast.success(`全部 ${chapters.length} 个章节分镜生成成功 🎉`);
        } else if (allSuccessCount > 0) {
          toast.success(`共生成 ${allSuccessCount}/${chapters.length} 个章节分镜`);
          if (allFailCount > 0) toast.warning(`${allFailCount} 个章节生成失败，可点击章节旁的刷新按钮单独重试`);
        } else {
          toast.error(`全部 ${chapters.length} 个章节分镜生成失败，请检查网络后逐个重试`);
        }
        
        setStepConfirmed(prev => ({ ...prev, storyboard: allSuccessCount > 0 }));
        if (allSuccessCount > 0) setCurrentStep(2);
        setBatchInfo({ active: false, batchSize: BATCH_SIZE, totalBatches: 0, completedBatches: 0 });
      } else {
        // 还有下一批，等待用户确认
        const nextChapter = chapters[nextIncompleteIndex];
        const skipText = skippedCount > 0 ? `，已跳过 ${skippedCount} 章成功分镜` : '';
        toast.success(`第 ${resumeBatch + 1}/${totalBatches} 批已处理（${batchSuccessCount}/${endIdx - startIdx} 章成功${skipText}），下次从第 ${nextChapter.chapterNumber} 章继续`);
        setBatchInfo({ active: true, batchSize: BATCH_SIZE, totalBatches, completedBatches: newCompletedBatches });
      }
    } catch (error) {
      console.error('批量生成分镜失败:', error);
      toast.dismiss(loadingToast);
      toast.error('批量生成分镜失败');
      setBatchInfo({ active: true, batchSize: BATCH_SIZE, totalBatches, completedBatches: resumeBatch });
    } finally {
      setIsProcessing(false);
    }
  };

  // 清除已完成的任务
  const clearCompletedTasks = () => {
    setGenerationTasks(prev => prev.filter(t => t.status === 'generating' || t.status === 'pending'));
  };

  // 生成分镜串联提示词
  const generateConnectingPrompts = async (images: ImageStoryboard[], chapterTitle: string) => {
    if (!(await requireLoginBeforePaidAction())) return;

    setIsProcessing(true);
    setProgress(85);
    
    try {
      // 将素材图片转换为数组格式
      const assetImagesArray = Object.values(assetImagesObj);
      
      const response = await fetch('/api/generate-connecting-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageStoryboards: images,
          chapterTitle,
          imageSettings: globalImageSettings,
          assetImages: assetImagesArray,
          scenesData,
          charactersData,
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        setConnectingPrompts(data.connectingPrompts);
        if (data.tokenUsage) {
          setTokenUsage(prev => ({ ...prev, generateConnectingPrompts: data.tokenUsage }));
        }
        toast.success('串联提示词生成成功，请确认后继续');
        setProgress(90);
        
        // 串联提示词生成完成，等待用户确认后再生成视频
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error('串联提示词生成失败:', error);
      toast.error('串联提示词生成失败');
    } finally {
      setIsProcessing(false);
    }
  };

  // 基于文字分镜直接生成提示词（跳过图片分镜）
  const generateConnectingPromptsFromStoryboard = async (storyboardData: Storyboard, chapterTitle: string) => {
    if (!(await requireLoginBeforePaidAction())) return;

    setIsProcessing(true);
    setProgress(70);
    
    try {
      // 将素材图片转换为数组格式
      const assetImagesArray = Object.values(assetImagesObj);
      
      const response = await fetch('/api/generate-connecting-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyboard: storyboardData.shots || storyboardData,
          chapterTitle,
          imageSettings: globalImageSettings,
          assetImages: assetImagesArray,
          scenesData,
          charactersData,
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        setConnectingPrompts(data.connectingPrompts);
        if (data.tokenUsage) {
          setTokenUsage(prev => ({ ...prev, generateConnectingPrompts: data.tokenUsage }));
        }
        toast.success('提示词生成成功，请确认后生成视频');
        setProgress(80);
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error('提示词生成失败:', error);
      toast.error('提示词生成失败');
    } finally {
      setIsProcessing(false);
    }
  };

  // 生成视频
  // 从分镜数据中查找原始镜头描述（替代 videoPrompt）
  const getShotDescription = (shotNumber: number): string | undefined => {
    for (const cs of Object.values(chapterStoryboards)) {
      const shot = cs.storyboard?.shots?.find((s: any) => s.shotNumber === shotNumber);
      if (shot?.description) return shot.description;
    }
    return undefined;
  };

  const manfeiPollingTasksRef = useRef(new Set<string>());

  const pollManfeiVideoTask = async (taskId: string) => {
    const maxAttempts = 360;
    let transientErrors = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      try {
        const response = await fetch(`/api/generate-video?taskId=${encodeURIComponent(taskId)}`, {
          cache: 'no-store',
        });
        const data = await response.json();
        if (data.video?.url) return data.video;
        if (!response.ok && !data.pending) {
          throw new Error(data.error || '视频生成失败');
        }
        transientErrors = 0;
      } catch (error) {
        transientErrors++;
        if (transientErrors >= 6) throw error;
      }
    }

    throw new Error('视频生成等待超时，任务仍可通过任务 ID 继续查询');
  };

  const createAndWaitForManfeiVideo = async (
    payload: Record<string, unknown>,
    onTaskCreated?: (taskId: string) => void,
  ) => {
    if (!(await requireLoginBeforePaidAction())) {
      throw new Error('请先登录账号后再生成视频');
    }

    const response = await fetch('/api/generate-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || '创建视频任务失败');
    }
    if (data.video?.url) return data.video;

    const taskId = data.task?.id || data.taskId;
    if (!taskId) throw new Error('接口未返回视频任务 ID');
    onTaskCreated?.(taskId);
    manfeiPollingTasksRef.current.add(taskId);
    try {
      return await pollManfeiVideoTask(taskId);
    } finally {
      manfeiPollingTasksRef.current.delete(taskId);
    }
  };

  useEffect(() => {
    const pendingTasks = Object.values(chapterStoryboards).flatMap(cs =>
      (cs.shotVideos || []).flatMap(shotVideos =>
        shotVideos.videos
          .filter(video => video.status === 'generating' && video.taskId)
          .map(video => ({
            chapterNumber: cs.chapterNumber,
            shotNumber: shotVideos.shotNumber,
            videoId: video.videoId,
            taskId: video.taskId as string,
          }))
      )
    );

    pendingTasks.forEach(task => {
      if (manfeiPollingTasksRef.current.has(task.taskId)) return;
      manfeiPollingTasksRef.current.add(task.taskId);

      void pollManfeiVideoTask(task.taskId)
        .then(video => {
          setChapterStoryboards(prev => ({
            ...prev,
            [task.chapterNumber]: {
              ...prev[task.chapterNumber],
              shotVideos: (prev[task.chapterNumber].shotVideos || []).map(shotVideos =>
                shotVideos.shotNumber === task.shotNumber
                  ? {
                      ...shotVideos,
                      videos: shotVideos.videos.map(item =>
                        item.videoId === task.videoId
                          ? { ...item, videoUrl: video.url, status: 'success' as const, error: undefined }
                          : item
                      ),
                    }
                  : shotVideos
              ),
            },
          }));
          toast.success('后台视频任务已完成');
        })
        .catch((error: any) => {
          setChapterStoryboards(prev => ({
            ...prev,
            [task.chapterNumber]: {
              ...prev[task.chapterNumber],
              shotVideos: (prev[task.chapterNumber].shotVideos || []).map(shotVideos =>
                shotVideos.shotNumber === task.shotNumber
                  ? {
                      ...shotVideos,
                      videos: shotVideos.videos.map(item =>
                        item.videoId === task.videoId
                          ? { ...item, status: 'error' as const, error: error?.message || '视频任务查询失败' }
                          : item
                      ),
                    }
                  : shotVideos
              ),
            },
          }));
        })
        .finally(() => {
          manfeiPollingTasksRef.current.delete(task.taskId);
        });
    });
  }, [chapterStoryboards, setChapterStoryboards]);

  const generatePromptGroupVideo = async (cs: ChapterStoryboard, pg: PromptGroup, retryVideoId?: string) => {
    if (!(await requireLoginBeforePaidAction())) return;

    const groupKey = getPromptGroupVideoKey(pg);
    const existingVideos = cs.shotVideos?.find(sv => sv.shotNumber === groupKey)?.videos || [];
    const videoId = retryVideoId || `group-video-${cs.chapterNumber}-${pg.groupIndex}-${Date.now()}`;
    const referenceSelection = getPromptGroupReferenceSelection(cs, pg);
    const referenceImages = referenceSelection.images.map(item => item.url);
    const prompt = buildPromptGroupVideoPrompt(cs, pg, referenceSelection);
    const duration = normalizeManfeiDuration(pg.shotNumbers.length * 4);

    const newVideo: VideoItem = {
      videoId,
      videoUrl: '',
      duration,
      shotNumber: groupKey,
      prompt,
      status: 'generating',
      createdAt: Date.now(),
    };

    setChapterStoryboards(prev => {
      const existing = prev[cs.chapterNumber].shotVideos || [];
      const existingGroup = existing.find(sv => sv.shotNumber === groupKey);
      const nextVideos: ShotVideos[] = retryVideoId
        ? existing.map(sv =>
            sv.shotNumber === groupKey
              ? {
                  ...sv,
                  videos: sv.videos.map(v =>
                    v.videoId === retryVideoId
                      ? {
                          ...v,
                          duration,
                          prompt,
                          taskId: undefined,
                          status: 'generating' as const,
                          error: undefined,
                        }
                      : v
                  ),
                }
              : sv
          )
        : existingGroup
          ? existing.map(sv =>
              sv.shotNumber === groupKey
                ? { ...sv, videos: [...sv.videos, newVideo] }
                : sv
            )
          : [...existing, { shotNumber: groupKey, videos: [newVideo] }];

      return {
        ...prev,
        [cs.chapterNumber]: {
          ...prev[cs.chapterNumber],
          shotVideos: nextVideos,
        },
      };
    });

    toast.info(`第 ${cs.chapterNumber} 集第 ${pg.groupIndex} 组视频生成中...`);

    try {
      const generatedVideo = await createAndWaitForManfeiVideo({
          prompt,
          duration,
          chapterNumber: cs.chapterNumber,
          shotNumber: groupKey,
          groupIndex: pg.groupIndex,
          shotNumbers: pg.shotNumbers,
          videoRatio: getEffectiveVideoRatio(),
          imageUrl: referenceImages[0] || '',
          imageUrls: referenceImages,
          referenceImageLabels: referenceSelection.images.map(item => ({
            type: item.type,
            name: item.name,
          })),
          linkedEntities: referenceSelection.entities,
        }, (taskId) => {
          setChapterStoryboards(prev => ({
            ...prev,
            [cs.chapterNumber]: {
              ...prev[cs.chapterNumber],
              shotVideos: (prev[cs.chapterNumber].shotVideos || []).map(sv =>
                sv.shotNumber === groupKey
                  ? {
                      ...sv,
                      videos: sv.videos.map(video =>
                        video.videoId === videoId ? { ...video, taskId } : video
                      ),
                    }
                  : sv
              ),
            },
          }));
      });

      let finalVideoUrl = generatedVideo.url;
      let finalVideoKey = generatedVideo.key;

      try {
        const saveResponse = await fetch('/api/save-video-to-s3', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoUrl: generatedVideo.url,
            chapterNumber: cs.chapterNumber,
            shotNumber: `第${pg.groupIndex}组`,
            videoIndex: retryVideoId ? Math.max(existingVideos.findIndex(v => v.videoId === retryVideoId), 0) : existingVideos.length,
          }),
        });
        const saveData = await saveResponse.json();
        if (saveData.success) {
          finalVideoUrl = saveData.url;
          finalVideoKey = saveData.key;
        }
      } catch (saveError) {
        console.warn('保存视频到 S3 失败，使用原始 URL:', saveError);
      }

      setChapterStoryboards(prev => ({
        ...prev,
        [cs.chapterNumber]: {
          ...prev[cs.chapterNumber],
          shotVideos: (prev[cs.chapterNumber].shotVideos || []).map(sv =>
            sv.shotNumber === groupKey
              ? {
                  ...sv,
                  videos: sv.videos.map(v =>
                    v.videoId === videoId
                      ? {
                          ...v,
                          videoUrl: finalVideoUrl,
                          videoKey: finalVideoKey,
                          status: 'success',
                        }
                      : v
                  ),
                }
              : sv
          ),
        },
      }));

      toast.success(`第 ${cs.chapterNumber} 集第 ${pg.groupIndex} 组视频生成成功`);
    } catch (error: any) {
      const errorMessage = getNetworkErrorMessage(error, '生成视频');
      setChapterStoryboards(prev => ({
        ...prev,
        [cs.chapterNumber]: {
          ...prev[cs.chapterNumber],
          shotVideos: (prev[cs.chapterNumber].shotVideos || []).map(sv =>
            sv.shotNumber === groupKey
              ? {
                  ...sv,
                  videos: sv.videos.map(v =>
                    v.videoId === videoId
                      ? { ...v, status: 'error', error: errorMessage }
                      : v
                  ),
                }
              : sv
          ),
        },
      }));
      toast.error(errorMessage);
    }
  };

  const generateVideos = async (
    shotPrompts: any[], 
    images: ImageStoryboard[], 
    chapterTitle: string
  ) => {
    if (!(await requireLoginBeforePaidAction())) return;

    setIsProcessing(true);
    setProgress(95);
    
    try {
      const results: VideoResult[] = [];
      for (const promptItem of shotPrompts) {
        const image = images.find(item => item.shotNumber === promptItem.shotNumber);
        const duration = normalizeManfeiDuration(promptItem.duration);
        const video = await createAndWaitForManfeiVideo({
          prompt: promptItem.videoPrompt || promptItem.panelDescription || promptItem.prompt || '',
          imageUrl: image?.imageUrl || '',
          imageUrls: image?.imageUrl ? [image.imageUrl] : [],
          duration,
          videoRatio: getEffectiveVideoRatio(),
          chapterTitle,
          shotNumber: promptItem.shotNumber,
        });
        results.push({
          shotNumber: promptItem.shotNumber,
          videoUrl: video.url,
          lastFrameUrl: '',
          duration,
          transition: '',
          chapterTitle,
        });
      }

      const totalDuration = results.reduce((sum, item) => sum + item.duration, 0);
      setVideoResults(results);
      setVideoTotalDuration(totalDuration);
      toast.success(`成功生成 ${results.length} 个视频，总时长 ${Math.floor(totalDuration / 60)}分${totalDuration % 60}秒`);
      setProgress(95);
      setCurrentStep(5);
    } catch (error) {
      console.error('视频生成失败:', error);
      toast.error(getNetworkErrorMessage(error, '生成视频'));
    } finally {
      setIsProcessing(false);
    }
  };

  // 文件拖放处理
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      const supportedTypes = [
        'text/plain',
        'text/markdown',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ];
      
      if (supportedTypes.includes(file.type) || 
          file.name.endsWith('.txt') || 
          file.name.endsWith('.md') ||
          file.name.endsWith('.pdf') ||
          file.name.endsWith('.doc') ||
          file.name.endsWith('.docx')) {
        handleFileUpload(file);
      } else {
        toast.error('请上传 .txt, .md, .pdf, .doc 或 .docx 文件');
      }
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // 重新生成视频（带自定义提示词）
  const regenerateVideo = async (shotNumber: number, customPrompt?: string) => {
    if (!(await requireLoginBeforePaidAction())) return;

    const videoItem = videoResults.find(v => v.shotNumber === shotNumber);
    const imageStoryboard = imageStoryboards.find(s => s.shotNumber === shotNumber);
    if (!videoItem && !customPrompt) return;
    
    const promptItem = connectingPrompts?.shotPrompts?.find((p: any) => p.shotNumber === shotNumber);
    if (!promptItem && !customPrompt) {
      toast.error('找不到故事版面板描述');
      return;
    }
    
    setRegeneratingShot(shotNumber);
    try {
      const video = await createAndWaitForManfeiVideo({
        shotNumber,
        prompt: customPrompt || getShotDescription(shotNumber) || '',
        imageUrl: imageStoryboard?.imageUrl || '',
        imageUrls: imageStoryboard?.imageUrl ? [imageStoryboard.imageUrl] : [],
        duration: normalizeManfeiDuration(promptItem?.duration),
        videoRatio: getEffectiveVideoRatio(),
      });
      setVideoResults(prev => prev.map(v =>
        v.shotNumber === shotNumber
          ? { ...v, videoUrl: video.url, lastFrameUrl: '' }
          : v
      ));
      toast.success(`镜头 ${shotNumber} 视频已重新生成`);
      setEditingPrompt(null);
    } catch {
      toast.error('重新生成失败');
    } finally {
      setRegeneratingShot(null);
    }
  };

  // 批量重新生成所有视频
  const regenerateAllVideos = async () => {
    if (!(await requireLoginBeforePaidAction())) return;

    if (videoResults.length === 0 || !connectingPrompts?.shotPrompts) {
      toast.error('没有视频可重新生成');
      return;
    }
    
    setIsProcessing(true);
    toast.info('正在批量重新生成所有视频...');
    
    let successCount = 0;
    let failCount = 0;
    
    for (const promptItem of connectingPrompts.shotPrompts) {
      const imageStoryboard = imageStoryboards.find(s => s.shotNumber === promptItem.shotNumber);
      if (!imageStoryboard) continue;
      
      try {
        const video = await createAndWaitForManfeiVideo({
          shotNumber: promptItem.shotNumber,
          prompt: getShotDescription(promptItem.shotNumber) || '',
          imageUrl: imageStoryboard.imageUrl,
          imageUrls: [imageStoryboard.imageUrl],
          duration: normalizeManfeiDuration(promptItem.duration),
          videoRatio: getEffectiveVideoRatio(),
        });
        setVideoResults(prev => prev.map(v =>
          v.shotNumber === promptItem.shotNumber
            ? { ...v, videoUrl: video.url, lastFrameUrl: '' }
            : v
        ));
        successCount++;
      } catch {
        failCount++;
      }
    }
    
    setIsProcessing(false);
    if (failCount === 0) {
      toast.success(`成功重新生成 ${successCount} 个视频`);
    } else {
      toast.warning(`重新生成完成：成功 ${successCount} 个，失败 ${failCount} 个`);
    }
  };

  // 渲染提取状态图标
  const renderStatusIcon = (status: string) => {
    switch (status) {
      case 'loading':
        return <Loader2 className="w-5 h-5 animate-spin text-blue-500" />;
      case 'success':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'error':
        return <span className="text-red-500">✗</span>;
      case 'batch_confirm':
        return <span className="text-blue-500 text-sm font-medium">待确认</span>;
      default:
        return <Circle className="w-5 h-5 text-gray-300" />;
    }
  };

  // 获取素材图片列表（使用素材名称作为 key，确保唯一性）
  // 注意：之前的实现使用 id 作为 key，但如果 id 分配错误会导致图片共用
  // 现在改为使用名称作为主键，确保每个素材独立管理图片
  const getAssetImages = (type: 'scene' | 'character' | 'prop', idOrName: number | string | undefined, name?: string): AssetImages | undefined => {
    let key: string;
    
    // 优先使用名称作为 key（名称是唯一的）
    // 如果提供了名称参数，直接使用
    if (name) {
      key = `${type}-${name}`;
    } else if (typeof idOrName === 'string' && idOrName.length > 0) {
      // 如果 idOrName 是字符串（名称），直接使用
      key = `${type}-${idOrName}`;
    } else if (typeof idOrName === 'number') {
      // 如果是数字 ID，尝试查找对应的名称
      let found: any = null;
      if (type === 'scene') {
        // 先查 scenesData
        if (scenesData?.scenes) {
          found = scenesData.scenes.find((s: any) => s.id === idOrName);
        }
        // 再查 sceneBatchInfo.allScenes（分批提取的场景）
        if (!found && sceneBatchInfo?.allScenes) {
          found = sceneBatchInfo.allScenes.find((s: any) => s.id === idOrName);
        }
      } else if (type === 'character') {
        if (charactersData?.characters) {
          found = charactersData.characters.find((c: any) => c.id === idOrName);
        }
        if (!found && characterBatchInfo?.allCharacters) {
          found = characterBatchInfo.allCharacters.find((c: any) => c.id === idOrName);
        }
      } else if (type === 'prop') {
        if (propsData?.props) {
          found = propsData.props.find((p: any) => p.id === idOrName);
        }
        if (!found && propBatchInfo?.allProps) {
          found = propBatchInfo.allProps.find((p: any) => p.id === idOrName);
        }
      }
      // 找到则使用名称作为 key
      key = found ? `${type}-${found.name}` : `${type}-id-${idOrName}`;
    } else if (idOrName === undefined || idOrName === null) {
      console.warn(`[getAssetImages] 收到无效的 idOrName: ${idOrName}，类型: ${type}`);
      return undefined;
    } else {
      key = `${type}-${idOrName}`;
    }
    
    return assetImages.get(key);
  };

  // 获取当前章节关联的素材
  const getChapterAssets = () => {
    if (!storyboard || !scenesData || !charactersData || !propsData) {
      return { scenes: [], characters: [], props: [] };
    }

    // 从分镜中提取所有场景名称
    const sceneNames = new Set<string>();
    const characterNames = new Set<string>();
    const propNames = new Set<string>();

    storyboard.shots.forEach(shot => {
      if (shot.scene?.location) {
        sceneNames.add(shot.scene.location);
      }
      if (shot.scene?.props) {
        shot.scene.props.forEach((p: string) => propNames.add(p));
      }
      if (shot.characters) {
        shot.characters.forEach(char => {
          if (char.name) {
            characterNames.add(char.name);
          }
        });
      }
    });

    // 从提取数据中匹配对应的素材详情
    const scenes = (scenesData.scenes || []).filter((s: Scene) => sceneNames.has(s.name));
    const characters = (charactersData.characters || []).filter((c: Character) => characterNames.has(c.name));
    const props = (propsData.props || []).filter((p: Prop) => propNames.has(p.name));

    return { scenes, characters, props };
  };

  const getBatchAssetList = (type: 'scene' | 'character' | 'prop') => {
    const source =
      type === 'scene'
        ? ((sceneBatchInfo?.allScenes?.length ?? 0) > 0 ? sceneBatchInfo?.allScenes : scenesData?.scenes)
        : type === 'character'
          ? ((charactersData?.characters && charactersData.characters.length > 0) ? charactersData.characters : characterBatchInfo?.allCharacters)
          : ((propBatchInfo?.allProps?.length ?? 0) > 0 ? propBatchInfo?.allProps : propsData?.props);

    const uniqueByName = new Map<string, any>();
    (source || []).forEach((item: any) => {
      if (item?.name && !uniqueByName.has(item.name)) {
        uniqueByName.set(item.name, item);
      }
    });

    return Array.from(uniqueByName.values());
  };

  const isBatchAssetGenerating = batchAssetGeneration.type !== null;

  // 生成素材图片
  const generateAssetImage = async (
    type: 'scene' | 'character' | 'prop',
    data: any,
    options?: {
      silent?: boolean;
      tempImageId?: string;
      skipPlaceholder?: boolean;
      generatingStatus?: string;
    }
  ): Promise<boolean> => {
    if (!data?.name) {
      if (!options?.silent) toast.error('素材名称缺失，无法生成图片');
      return false;
    }
    if (!(await requireLoginBeforePaidAction())) return false;

    // 使用素材的名称作为 key，确保唯一性（名称是唯一的，id 可能在分批时重复）
    const assetId = `${type}-${data.name}`;
    const currentAsset = assetImages.get(assetId);
    const currentCount = currentAsset?.images.length || 0;

    // 检查数量限制
    if (currentCount >= MAX_IMAGES_PER_ASSET) {
      if (!options?.silent) toast.error(`每个素材最多支持 ${MAX_IMAGES_PER_ASSET} 张图片`);
      return false;
    }

    if (currentAsset?.images.some(img => img.isGenerating)) {
      if (!options?.silent) toast.warning(`${data.name} 正在生成中`);
      return false;
    }

    const tempImageId = options?.tempImageId || `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // 设置生成中状态
    setAssetImages(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(assetId);
      if (options?.skipPlaceholder) {
        if (existing) {
          newMap.set(assetId, {
            ...existing,
            images: existing.images.map(img =>
              img.imageId === tempImageId
                ? { ...img, isGenerating: true, generatingStatus: options?.generatingStatus || '生成中' }
                : img
            ),
          });
        }
        return newMap;
      }
      if (existing) {
        newMap.set(assetId, {
          ...existing,
          images: [...existing.images, {
            imageId: tempImageId,
            imageUrl: '',
            imageKey: '',
            isGenerating: true,
            generatingStatus: options?.generatingStatus || '生成中',
          }],
        });
      } else {
        newMap.set(assetId, {
          assetId,
          type,
          name: data.name,
          images: [{
            imageId: tempImageId,
            imageUrl: '',
            imageKey: '',
            isGenerating: true,
            generatingStatus: options?.generatingStatus || '生成中',
          }],
        });
      }
      return newMap;
    });

    try {
      const response = await fetch('/api/generate-asset-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, data, currentCount }),
      });

      const result = await response.json();

      if (result.success) {
        setAssetImages(prev => {
          const newMap = new Map(prev);
          const existing = newMap.get(assetId);
          if (existing) {
            newMap.set(assetId, {
              ...existing,
              images: existing.images.map(img =>
                img.imageId === tempImageId
                  ? {
                      imageId: `img-${Date.now()}`,
                      imageUrl: result.localUrl || result.imageUrl,
                      imageKey: result.imageKey,
                      isGenerating: false,
                      isCustom: false,
                    }
                  : img
              ),
            });
          }
          return newMap;
        });
        if (!options?.silent) toast.success(`${data.name} 图片生成成功`);
        return true;
      } else {
        // 移除生成中的占位图片
        setAssetImages(prev => {
          const newMap = new Map(prev);
          const existing = newMap.get(assetId);
          if (existing) {
            newMap.set(assetId, {
              ...existing,
              images: existing.images.filter(img => img.imageId !== tempImageId),
            });
          }
          return newMap;
        });
        if (!options?.silent) toast.error(result.error || '图片生成失败');
        return false;
      }
    } catch (error) {
      // 移除生成中的占位图片
      setAssetImages(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(assetId);
        if (existing) {
          newMap.set(assetId, {
            ...existing,
            images: existing.images.filter(img => img.imageId !== tempImageId),
          });
        }
        return newMap;
      });
      if (!options?.silent) toast.error(getNetworkErrorMessage(error, '生成图片'));
      return false;
    }
  };

  const generateAllAssetImages = async (type: 'scene' | 'character' | 'prop') => {
    if (!(await requireLoginBeforePaidAction())) return;

    if (stepConfirmed.assets) {
      toast.warning('素材已确认，如需重新生成请先撤回到素材确认步骤');
      return;
    }

    if (isBatchAssetGenerating) {
      toast.warning('已有批量生成任务正在进行');
      return;
    }

    const labelMap = {
      scene: '场景',
      character: '人物',
      prop: '道具',
    } as const;

    const allItems = getBatchAssetList(type);
    const candidates = allItems.filter((item: any) => {
      const assetData = getAssetImages(type, item.id, item.name);
      const images = assetData?.images || [];
      return images.length < MAX_IMAGES_PER_ASSET && !images.some(img => img.isGenerating);
    });

    if (allItems.length === 0) {
      toast.error(`暂无${labelMap[type]}数据可生成图片`);
      return;
    }

    if (candidates.length === 0) {
      toast.info(`${labelMap[type]}列表没有可继续生成的素材`);
      return;
    }

    const batchItems = candidates.map((item: any) => ({
      item,
      tempImageId: `batch-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    }));
    const loadingToast = toast.loading(`正在批量生成${labelMap[type]}图片 0/${candidates.length}`);
    setBatchAssetGeneration({
      type,
      current: 0,
      total: candidates.length,
      currentName: `已加入队列 ${candidates.length} 个`,
    });

    // 先给所有待生成素材插入占位图，让用户能立即看到整批任务已进入队列。
    setAssetImages(prev => {
      const newMap = new Map(prev);
      batchItems.forEach(({ item, tempImageId }) => {
        const assetId = `${type}-${item.name}`;
        const existing = newMap.get(assetId);
        const placeholder: AssetSingleImage = {
          imageId: tempImageId,
          imageUrl: '',
          imageKey: '',
          isGenerating: true,
          generatingStatus: '排队中',
        };

        if (existing) {
          if (existing.images.some(img => img.imageId === tempImageId || img.isGenerating)) return;
          newMap.set(assetId, {
            ...existing,
            images: [...existing.images, placeholder],
          });
        } else {
          newMap.set(assetId, {
            assetId,
            type,
            name: item.name,
            images: [placeholder],
          });
        }
      });
      return newMap;
    });

    let successCount = 0;
    let failCount = 0;
    let completedCount = 0;
    let activeCount = 0;
    let nextIndex = 0;

    const updateBatchProgress = (currentName?: string) => {
      setBatchAssetGeneration({
        type,
        current: completedCount,
        total: candidates.length,
        currentName: currentName || `并发生成中 ${activeCount} 个，排队 ${Math.max(candidates.length - completedCount - activeCount, 0)} 个`,
      });
      toast.loading(`正在批量生成${labelMap[type]}图片：已完成 ${completedCount}/${candidates.length}`, { id: loadingToast });
    };

    const workerCount = Math.min(BATCH_ASSET_IMAGE_CONCURRENCY, batchItems.length);
    const runWorker = async () => {
      while (nextIndex < batchItems.length) {
        const index = nextIndex++;
        const { item, tempImageId } = batchItems[index];
        activeCount++;
        updateBatchProgress(item.name);

        const success = await generateAssetImage(type, item, {
          silent: true,
          tempImageId,
          skipPlaceholder: true,
          generatingStatus: '生成中',
        });

        activeCount--;
        completedCount++;
        if (success) {
          successCount++;
        } else {
          failCount++;
        }
        updateBatchProgress(item.name);
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

    setBatchAssetGeneration({
      type: null,
      current: 0,
      total: 0,
      currentName: '',
    });

    if (failCount === 0) {
      toast.success(`${labelMap[type]}图片批量生成完成：成功 ${successCount} 个`, { id: loadingToast });
    } else {
      toast.warning(`${labelMap[type]}图片批量生成完成：成功 ${successCount} 个，失败/跳过 ${failCount} 个`, { id: loadingToast });
    }
  };

  // Helper: 按人物 + lookId 更新造型状态（lookId 在不同人物间会重复）
  const updateLookById = (targetLookId: string, updates: any, targetCharacter?: any) => {
    const matchesCharacter = (char: any) => {
      if (!targetCharacter) return true;
      if (targetCharacter.id !== undefined && char.id !== undefined) {
        return String(char.id) === String(targetCharacter.id);
      }
      return char.name === targetCharacter.name;
    };

    const searchAndUpdate = (characters: any[]) => {
      let found = false;
      const result = characters.map((char: any) => {
        if (found) return char;
        if (!matchesCharacter(char)) return char;
        let lookFound = false;
        const looks = char.looks?.map((l: any) => {
          if (l.id !== targetLookId) return l;
          lookFound = true;
          return { ...l, ...updates };
        });
        if (lookFound) found = true;
        return lookFound ? { ...char, looks } : char;
      });
      return found ? result : characters;
    };

    setCharactersData((prev: any) => {
      if (!prev?.characters) return prev;
      const newCharacters = searchAndUpdate(prev.characters);
      return newCharacters !== prev.characters
        ? { ...prev, characters: newCharacters }
        : prev;
    });

    setCharacterBatchInfo((prev: any) => {
      if (!prev?.allCharacters) return prev;
      const newAllCharacters = searchAndUpdate(prev.allCharacters);
      return newAllCharacters !== prev.allCharacters
        ? { ...prev, allCharacters: newAllCharacters }
        : prev;
    });
  };

  const getCharacterFaceReferenceImage = (character: any): string | undefined => {
    const assetKey = `character-${character?.name}`;
    const existingAsset = assetImages.get(assetKey);
    const faceImage = existingAsset?.images?.find((img: any) => img.imageUrl && !img.isGenerating)?.imageUrl;
    if (faceImage) return faceImage;

    for (const look of character?.looks || []) {
      if (look?.imageUrl) return look.imageUrl;
      if (look?.fourViewImageUrl) return look.fourViewImageUrl;
    }

    return undefined;
  };

  // 生成人物造型图片
  const handleGenerateCharacterLookImage = async (character: any, lookId: string) => {
    if (!(await requireLoginBeforePaidAction())) return;

    setIsGeneratingImage(true);
    const generationKey = getLookGenerationKey(character, lookId);
    let statusTimer1: ReturnType<typeof setTimeout> | undefined;
    let statusTimer2: ReturnType<typeof setTimeout> | undefined;
    let fetchTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const look = character.looks?.find((l: any) => l.id === lookId);
      if (!look) {
        toast.error('造型不存在');
        return;
      }

      updateLookById(lookId, { imageUrl: '', isGenerating: true, generatingStatus: '正在提交到 AI 绘图服务...' }, character);
      toast.info(`开始生成 ${character.name} - ${look.scene || lookId} 造型图片`);

      const referenceImageUrl = getCharacterFaceReferenceImage(character);
      if (!referenceImageUrl) {
        updateLookById(lookId, { isGenerating: false, generatingStatus: undefined }, character);
        toast.warning(`请先生成 ${character.name} 的基础人脸近景图，再进行换装`);
        return;
      }

      // 启动进度更新定时器
      statusTimer1 = setTimeout(() => updateLookById(lookId, { generatingStatus: 'AI 正在生成图片（约30~90秒）...' }, character), 5000);
      statusTimer2 = setTimeout(() => updateLookById(lookId, { generatingStatus: '生成中，请耐心等待...' }, character), 30000);

      // 添加超时控制并注册到取消列表
      const controller = new AbortController();
      fetchTimeout = setTimeout(() => controller.abort(), 120000);
      lookAbortControllers.current.set(generationKey, controller);

      const response = await fetch('/api/generate-asset-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'character',
          data: character,
          lookId,
          referenceImageUrl,
          imageVariant: 'character-look',
        }),
        signal: controller.signal,
      });

      clearTimeout(fetchTimeout);
      fetchTimeout = undefined;
      clearTimeout(statusTimer1);
      statusTimer1 = undefined;
      clearTimeout(statusTimer2);
      statusTimer2 = undefined;
      lookAbortControllers.current.delete(generationKey);

      const result = await response.json();

      if (result.success) {
        updateLookById(lookId, { imageUrl: result.localUrl || result.imageUrl, isGenerating: false, generatingStatus: undefined }, character);
        toast.success(`${character.name} - ${look.scene || lookId} 造型图片生成成功`);
      } else {
        updateLookById(lookId, { isGenerating: false, generatingStatus: undefined }, character);
        toast.error(result.error || '造型图片生成失败');
      }
    } catch (error: any) {
      if (fetchTimeout) clearTimeout(fetchTimeout);
      if (statusTimer1) clearTimeout(statusTimer1);
      if (statusTimer2) clearTimeout(statusTimer2);
      lookAbortControllers.current.delete(generationKey);
      updateLookById(lookId, { isGenerating: false, generatingStatus: undefined }, character);
      if (error?.name === 'AbortError') {
        toast.error('造型图片生成超时（超过2分钟），请重试');
      } else {
        console.error('生成造型图片失败:', error);
        toast.error('造型图片生成失败');
      }
    } finally {
      setIsGeneratingImage(false);
    }
  };

  // 生成人物指定造型的四视图
  const handleGenerateCharacterFourView = async (character: any, lookId: string) => {
    if (!(await requireLoginBeforePaidAction())) return;

    setIsGeneratingImage(true);
    let statusTimer1: ReturnType<typeof setTimeout> | undefined;
    let statusTimer2: ReturnType<typeof setTimeout> | undefined;
    let fetchTimeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const look = character.looks?.find((l: any) => l.id === lookId);
      if (!look) {
        toast.error('造型不存在');
        return;
      }

      const referenceImageUrl = look.imageUrl || getCharacterFaceReferenceImage(character);
      if (!referenceImageUrl) {
        toast.warning(`请先生成 ${character.name} 的基础人脸近景图，再生成四视图`);
        return;
      }

      updateLookById(lookId, {
        fourViewImageUrl: '',
        isGeneratingFourView: true,
        fourViewStatus: '正在提交四视图生成任务...',
      }, character);
      toast.info(`开始生成 ${character.name}的四视图`);

      statusTimer1 = setTimeout(() => updateLookById(lookId, { fourViewStatus: 'AI 正在生成四视图（约30~90秒）...' }, character), 5000);
      statusTimer2 = setTimeout(() => updateLookById(lookId, { fourViewStatus: '四视图生成中，请耐心等待...' }, character), 30000);

      const controller = new AbortController();
      fetchTimeout = setTimeout(() => controller.abort(), 120000);

      const response = await fetch('/api/generate-asset-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'character',
          data: character,
          lookId,
          referenceImageUrl,
          imageVariant: 'character-four-view',
          assetImageName: `${character.name}的四视图`,
        }),
        signal: controller.signal,
      });

      clearTimeout(fetchTimeout);
      fetchTimeout = undefined;
      clearTimeout(statusTimer1);
      statusTimer1 = undefined;
      clearTimeout(statusTimer2);
      statusTimer2 = undefined;

      const result = await response.json();

      if (result.success) {
        updateLookById(lookId, {
          fourViewImageUrl: result.localUrl || result.imageUrl,
          isGeneratingFourView: false,
          fourViewStatus: undefined,
        }, character);
        toast.success(`${character.name}的四视图生成成功`);
      } else {
        updateLookById(lookId, { isGeneratingFourView: false, fourViewStatus: undefined }, character);
        toast.error(result.error || '四视图生成失败');
      }
    } catch (error: any) {
      if (fetchTimeout) clearTimeout(fetchTimeout);
      if (statusTimer1) clearTimeout(statusTimer1);
      if (statusTimer2) clearTimeout(statusTimer2);
      updateLookById(lookId, { isGeneratingFourView: false, fourViewStatus: undefined }, character);
      if (error?.name === 'AbortError') {
        toast.error('四视图生成超时（超过2分钟），请重试');
      } else {
        console.error('生成四视图失败:', error);
        toast.error('四视图生成失败');
      }
    } finally {
      setIsGeneratingImage(false);
    }
  };

  // 删除人物造型图片
  const handleDeleteCharacterLookImage = (characterId: number, lookId: string) => {
    setCharactersData((prev: any) => {
      if (!prev || !prev.characters) return prev;
      return {
        ...prev,
        characters: prev.characters.map((char: any) => {
          if (char.id === characterId) {
            return {
              ...char,
              looks: char.looks?.map((l: any) =>
                l.id === lookId
                  ? { ...l, imageUrl: undefined }
                  : l
              ),
            };
          }
          return char;
        }),
      };
    });
    toast.success('造型图片已删除');
  };

  // 上传人物造型图片
  const handleUploadCharacterLookImage = (character: any, lookId: string, file: File) => {
    setIsGeneratingImage(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const imageUrl = e.target?.result as string;
        
        updateLookById(lookId, { imageUrl, isCustom: true, isGenerating: false }, character);
        toast.success(`${character.name} 造型图片上传成功`);
      } catch (error) {
        console.error('上传造型图片失败:', error);
        toast.error('造型图片上传失败');
      } finally {
        setIsGeneratingImage(false);
      }
    };
    reader.readAsDataURL(file);
  };

  // 复制生成新图（基于造型图片）
  const handleGenerateImageFromLook = async (character: any, lookId: string) => {
    const look = character.looks?.find((l: any) => l.id === lookId);
    if (!look || !look.imageUrl) {
      toast.error('请先生成或上传造型图片');
      return;
    }
    if (!(await requireLoginBeforePaidAction())) return;

    setIsGeneratingImage(true);
    try {
      updateLookById(lookId, { imageUrl: '', isGenerating: true }, character);

      const response = await fetch('/api/generate-asset-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'character',
          data: character,
          lookId,
          referenceImageUrl: look.imageUrl,
        }),
      });

      const result = await response.json();

      if (result.success) {
        updateLookById(lookId, { imageUrl: result.localUrl || result.imageUrl, isGenerating: false }, character);
        toast.success(`${character.name} 造型图片重新生成成功`);
      } else {
        updateLookById(lookId, { isGenerating: false }, character);
        toast.error(result.error || '造型图片重新生成失败');
      }
    } catch (error: any) {
      updateLookById(lookId, { isGenerating: false }, character);
      if (error?.name !== 'AbortError') {
        console.error('重新生成造型图片失败:', error);
      }
      toast.error('造型图片重新生成失败');
    } finally {
      setIsGeneratingImage(false);
    }
  };

  // 图生图 - 基于参考图片生成新图片
  const generateImageFromImage = async (
    type: 'scene' | 'character' | 'prop',
    data: any,
    referenceImageUrl: string,
    customPrompt?: string
  ) => {
    if (!(await requireLoginBeforePaidAction())) return;

    // 使用素材的名称作为 key，确保唯一性（名称是唯一的，id 可能在分批时重复）
    const assetId = `${type}-${data.name}`;
    const currentAsset = assetImages.get(assetId);
    const currentCount = currentAsset?.images.length || 0;

    // 检查数量限制
    if (currentCount >= MAX_IMAGES_PER_ASSET) {
      toast.error(`每个素材最多支持 ${MAX_IMAGES_PER_ASSET} 张图片`);
      return;
    }

    const tempImageId = `temp-img2img-${Date.now()}`;

    // 设置生成中状态
    setAssetImages(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(assetId);
      if (existing) {
        newMap.set(assetId, {
          ...existing,
          images: [...existing.images, {
            imageId: tempImageId,
            imageUrl: '',
            imageKey: '',
            isGenerating: true,
          }],
        });
      } else {
        newMap.set(assetId, {
          assetId,
          type,
          name: data.name,
          images: [{
            imageId: tempImageId,
            imageUrl: '',
            imageKey: '',
            isGenerating: true,
          }],
        });
      }
      return newMap;
    });

    try {
      const response = await fetch('/api/generate-asset-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          data,
          referenceImageUrl,
          customPrompt,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setAssetImages(prev => {
          const newMap = new Map(prev);
          const existing = newMap.get(assetId);
          if (existing) {
            newMap.set(assetId, {
              ...existing,
              images: existing.images.map(img =>
                img.imageId === tempImageId
                  ? {
                      imageId: `img2img-${Date.now()}`,
                      imageUrl: result.localUrl || result.imageUrl,
                      imageKey: result.imageKey,
                      isGenerating: false,
                      isCustom: false,
                      isImg2Img: true,
                    }
                  : img
              ),
            });
          }
          return newMap;
        });
        toast.success(`基于参考图片生成成功 (Seedream 模型)`);
      } else {
        // 移除生成中的占位图片
        setAssetImages(prev => {
          const newMap = new Map(prev);
          const existing = newMap.get(assetId);
          if (existing) {
            newMap.set(assetId, {
              ...existing,
              images: existing.images.filter(img => img.imageId !== tempImageId),
            });
          }
          return newMap;
        });
        toast.error(result.error || '图生图失败');
      }
    } catch (error) {
      // 移除生成中的占位图片
      setAssetImages(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(assetId);
        if (existing) {
          newMap.set(assetId, {
            ...existing,
            images: existing.images.filter(img => img.imageId !== tempImageId),
          });
        }
        return newMap;
      });
      toast.error('图生图失败');
    }
  };

  // 下载图片
  const downloadImage = async (imageUrl: string, fileName: string) => {
    try {
      const saveResponse = await fetch('/api/assets-save-to-downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl,
          fileName,
        }),
      });
      const saveData = await saveResponse.json().catch(() => null);
      if (saveResponse.ok && saveData?.success) {
        toast.success(`图片已保存到下载目录：${saveData.filename || fileName}`);
        return;
      }

      const response = await fetch(getDisplayImageUrl(imageUrl));
      if (!response.ok) {
        throw new Error(`下载失败: ${response.status}`);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${fileName}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast.success('图片下载成功');
    } catch (error) {
      console.error('图片下载失败:', error);
      toast.error('图片下载失败');
    }
  };

  const getStoryboardImageFileName = (chapterNumber: number, groupIndex: number) => {
    return `第${chapterNumber}章_第${groupIndex}组_故事版总控图`;
  };

  // 移除选中的图片（图片仍在图片库中）
  const removeSelectedImage = async (assetId: string, imageId: string) => {
    console.log('[removeSelectedImage] 参数 assetId:', assetId, 'imageId:', imageId);
    console.log('[removeSelectedImage] assetImages 所有 keys:', Array.from(assetImages.keys()));
    
    const asset = assetImages.get(assetId);
    console.log('[removeSelectedImage] 找到的素材:', asset?.name, '图片数量:', asset?.images.length);
    
    if (!asset) {
      toast.error('素材不存在');
      return;
    }
    
    const image = asset.images.find(img => img.imageId === imageId);
    console.log('[removeSelectedImage] 找到的图片:', image?.imageId, image?.imageUrl?.substring(0, 50));
    
    if (!image) {
      toast.error('图片不存在');
      return;
    }

    // 从选中列表中移除（不删除文件，图片仍在图片库中）
    setAssetImages(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(assetId);
      if (existing) {
        const newImages = existing.images.filter(img => img.imageId !== imageId);
        console.log('[removeSelectedImage] 过滤前图片数:', existing.images.length, '过滤后:', newImages.length);
        newMap.set(assetId, {
          ...existing,
          images: newImages,
        });
      }
      return newMap;
    });
    
    toast.success('已取消选中该图片');
  };

  // 上传自定义图片
  const uploadCustomImage = async (type: 'scene' | 'character' | 'prop', data: any, file: File) => {
    if (!(await requireLoginBeforePaidAction())) return;

    // 使用素材的名称作为 key，确保唯一性（名称是唯一的，id 可能在分批时重复）
    const assetId = `${type}-${data.name}`;
    const currentAsset = assetImages.get(assetId);
    const currentCount = currentAsset?.images.length || 0;

    // 检查数量限制
    if (currentCount >= MAX_IMAGES_PER_ASSET) {
      toast.error(`每个素材最多支持 ${MAX_IMAGES_PER_ASSET} 张图片`);
      return;
    }

    // 检查文件大小（支持 4K 高清图，最大 50MB）
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
    if (file.size > MAX_FILE_SIZE) {
      toast.error('图片文件过大，请上传 50MB 以内的图片');
      return;
    }

    // 显示文件大小提示
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
    console.log(`上传图片: ${file.name}, 大小: ${fileSizeMB}MB`);

    const tempImageId = `temp-${Date.now()}`;

    // 设置上传中状态
    setAssetImages(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(assetId);
      if (existing) {
        newMap.set(assetId, {
          ...existing,
          images: [...existing.images, {
            imageId: tempImageId,
            imageUrl: '',
            imageKey: '',
            isGenerating: true,
          }],
        });
      } else {
        newMap.set(assetId, {
          assetId,
          type,
          name: data.name,
          images: [{
            imageId: tempImageId,
            imageUrl: '',
            imageKey: '',
            isGenerating: true,
          }],
        });
      }
      return newMap;
    });

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', type);
      formData.append('id', String(data.id));
      formData.append('name', data.name);
      formData.append('currentCount', String(currentCount));

      const response = await fetch('/api/upload-asset', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        setAssetImages(prev => {
          const newMap = new Map(prev);
          const existing = newMap.get(assetId);
          if (existing) {
            newMap.set(assetId, {
              ...existing,
              images: existing.images.map(img =>
                img.imageId === tempImageId
                  ? {
                      imageId: `img-${Date.now()}`,
                      imageUrl: result.localUrl || result.imageUrl,
                      imageKey: result.imageKey,
                      isGenerating: false,
                      isCustom: true,
                    }
                  : img
              ),
            });
          }
          return newMap;
        });
        toast.success('自定义图片上传成功');
      } else {
        // 移除上传中的占位图片
        setAssetImages(prev => {
          const newMap = new Map(prev);
          const existing = newMap.get(assetId);
          if (existing) {
            newMap.set(assetId, {
              ...existing,
              images: existing.images.filter(img => img.imageId !== tempImageId),
            });
          }
          return newMap;
        });
        toast.error(result.error || '图片上传失败');
      }
    } catch (error) {
      // 移除上传中的占位图片
      setAssetImages(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(assetId);
        if (existing) {
          newMap.set(assetId, {
            ...existing,
            images: existing.images.filter(img => img.imageId !== tempImageId),
          });
        }
        return newMap;
      });
      toast.error('图片上传失败');
    }
  };

  return (
    <div className="black-mirror-shell min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <AlertDialog open={loginRequiredOpen} onOpenChange={setLoginRequiredOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>需要先登录账号</AlertDialogTitle>
            <AlertDialogDescription className="leading-6">
              {loginRequiredMessage}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>先不登录</AlertDialogCancel>
            <AlertDialogAction onClick={openLoginFromRequired}>
              去登录
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="black-mirror-lines" aria-hidden="true">
        <span className="mirror-line mirror-line-one" />
        <span className="mirror-line mirror-line-two" />
        <span className="mirror-line mirror-line-three" />
        <span className="mirror-line mirror-line-four" />
      </div>
      <div className="black-mirror-content relative z-10 mx-auto max-w-[1480px]">
        {/* Header */}
        <div className="black-mirror-header mb-8">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 text-left">
              <div className="black-mirror-brand">
                <span className="brand-star brand-star-left" aria-hidden="true">✦</span>
                <h1 className="black-mirror-title font-serif text-3xl font-semibold sm:text-4xl">
                  MM钰汐
                </h1>
                <span className="brand-star brand-star-right" aria-hidden="true">✧</span>
              </div>
              <p className="mt-2 text-sm text-stone-400 sm:text-base">
                seedance满血版，seedance海外版，从未有过的顺滑创作体验。
              </p>
              <div className="mt-3 flex items-start gap-2 text-left">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <p className="text-xs leading-5 text-amber-200/80">
                  重要：所有数据会自动保存到浏览器，并同步写入项目本地备份；只有点击“清除数据”才会删除
                </p>
              </div>
            </div>
            {/* 资产管理按钮 */}
            <div className="black-mirror-toolbar flex flex-wrap items-center gap-2 xl:max-w-[840px] xl:justify-end">
              <WorkspaceModeSwitch active="workflow" />
              {SHOW_DEVELOPER_SETTINGS && (
                <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
                  <DialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => loadAppConnectionSettings()}
                    >
                      <Settings className="w-4 h-4" />
                      设置
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>接口设置</DialogTitle>
                      <DialogDescription>
                        Key 保存在本机，接口地址默认使用当前推荐地址。
                      </DialogDescription>
                    </DialogHeader>

                  <div className="grid gap-5 py-2">
                    <div className="rounded-md border p-4 space-y-3">
                      <div className="font-medium">文本分析</div>
                      <div className="grid gap-2">
                        <Label htmlFor="llm-api-key">API Key</Label>
                        <PasswordInput
                          id="llm-api-key"
                          autoComplete="off"
                          value={appConnectionSettings.llm.apiKey}
                          onChange={(event) => updateAppConnectionSetting('llm', 'apiKey', event.target.value)}
                          placeholder="填写文本模型 Key"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="llm-base-url">接口地址</Label>
                        <Input
                          id="llm-base-url"
                          value={appConnectionSettings.llm.baseUrl}
                          onChange={(event) => updateAppConnectionSetting('llm', 'baseUrl', event.target.value)}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="llm-model">模型</Label>
                        <Input
                          id="llm-model"
                          value={appConnectionSettings.llm.model}
                          onChange={(event) => updateAppConnectionSetting('llm', 'model', event.target.value)}
                        />
                      </div>
                    </div>

                    <div className="rounded-md border p-4 space-y-3">
                      <div className="font-medium">图片生成 RunningHub</div>
                      <div className="grid gap-2">
                        <Label htmlFor="runninghub-api-key">API Key</Label>
                        <PasswordInput
                          id="runninghub-api-key"
                          autoComplete="off"
                          value={appConnectionSettings.runninghub.apiKey}
                          onChange={(event) => updateAppConnectionSetting('runninghub', 'apiKey', event.target.value)}
                          placeholder="填写 RunningHub Key"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="runninghub-base-url">接口地址</Label>
                        <Input
                          id="runninghub-base-url"
                          value={appConnectionSettings.runninghub.baseUrl}
                          onChange={(event) => updateAppConnectionSetting('runninghub', 'baseUrl', event.target.value)}
                        />
                      </div>
                    </div>

                    <div className="rounded-md border p-4 space-y-3">
                      <div className="font-medium">视频生成 manfei</div>
                      <div className="grid gap-2">
                        <Label htmlFor="manfei-api-key">Token</Label>
                        <PasswordInput
                          id="manfei-api-key"
                          autoComplete="off"
                          value={appConnectionSettings.manfei.apiKey}
                          onChange={(event) => updateAppConnectionSetting('manfei', 'apiKey', event.target.value)}
                          placeholder="填写 manfei Token"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="manfei-base-url">接口地址</Label>
                        <Input
                          id="manfei-base-url"
                          value={appConnectionSettings.manfei.baseUrl}
                          onChange={(event) => updateAppConnectionSetting('manfei', 'baseUrl', event.target.value)}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-2">
                          <Label htmlFor="manfei-model">模型</Label>
                          <Input id="manfei-model" value="moon-manfei-new" disabled />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="manfei-resolution">分辨率</Label>
                          <Input id="manfei-resolution" value="720p" disabled />
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border p-4 space-y-3">
                      <div className="font-medium">火山 TOS 素材存储</div>
                      <div className="grid gap-2">
                        <Label htmlFor="asset-storage-endpoint">Endpoint</Label>
                        <Input
                          id="asset-storage-endpoint"
                          value={appConnectionSettings.assetStorage.endpointUrl}
                          onChange={(event) => updateAppConnectionSetting('assetStorage', 'endpointUrl', event.target.value)}
                          placeholder="https://tos-cn-beijing.volces.com"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-2">
                          <Label htmlFor="asset-storage-region">Region</Label>
                          <Input
                            id="asset-storage-region"
                            value={appConnectionSettings.assetStorage.region}
                            onChange={(event) => updateAppConnectionSetting('assetStorage', 'region', event.target.value)}
                            placeholder="cn-beijing"
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="asset-storage-bucket">存储桶</Label>
                          <Input
                            id="asset-storage-bucket"
                            value={appConnectionSettings.assetStorage.bucketName}
                            onChange={(event) => updateAppConnectionSetting('assetStorage', 'bucketName', event.target.value)}
                          />
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="asset-storage-access-point">接入点别名</Label>
                        <Input
                          id="asset-storage-access-point"
                          value={appConnectionSettings.assetStorage.accessPointAlias}
                          onChange={(event) => updateAppConnectionSetting('assetStorage', 'accessPointAlias', event.target.value)}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="asset-storage-access-key">AK</Label>
                        <PasswordInput
                          id="asset-storage-access-key"
                          autoComplete="off"
                          value={appConnectionSettings.assetStorage.accessKeyId}
                          onChange={(event) => updateAppConnectionSetting('assetStorage', 'accessKeyId', event.target.value)}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="asset-storage-secret-key">SK</Label>
                        <PasswordInput
                          id="asset-storage-secret-key"
                          autoComplete="off"
                          value={appConnectionSettings.assetStorage.secretAccessKey}
                          onChange={(event) => updateAppConnectionSetting('assetStorage', 'secretAccessKey', event.target.value)}
                        />
                      </div>
                    </div>
                  </div>

                  <DialogFooter className="gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setAppConnectionSettings(prev => ({
                        llm: {
                          ...prev.llm,
                          baseUrl: DEFAULT_APP_CONNECTION_SETTINGS.llm.baseUrl,
                          model: DEFAULT_APP_CONNECTION_SETTINGS.llm.model,
                        },
                        runninghub: {
                          ...prev.runninghub,
                          baseUrl: DEFAULT_APP_CONNECTION_SETTINGS.runninghub.baseUrl,
                        },
                        manfei: {
                          ...prev.manfei,
                          baseUrl: DEFAULT_APP_CONNECTION_SETTINGS.manfei.baseUrl,
                          model: 'moon-manfei-new',
                          resolution: '720p',
                        },
                        assetStorage: {
                          ...prev.assetStorage,
                          endpointUrl: DEFAULT_APP_CONNECTION_SETTINGS.assetStorage.endpointUrl,
                          region: DEFAULT_APP_CONNECTION_SETTINGS.assetStorage.region,
                          bucketName: DEFAULT_APP_CONNECTION_SETTINGS.assetStorage.bucketName,
                          accessPointAlias: DEFAULT_APP_CONNECTION_SETTINGS.assetStorage.accessPointAlias,
                        },
                      }))}
                      disabled={settingsLoading || settingsSaving}
                    >
                      恢复默认地址
                    </Button>
                    <Button
                      variant="outline"
                      onClick={loadAppConnectionSettings}
                      disabled={settingsLoading || settingsSaving}
                    >
                      {settingsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      重新读取
                    </Button>
                    <Button onClick={saveAppConnectionSettings} disabled={settingsSaving}>
                      {settingsSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      保存设置
                    </Button>
                  </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
              {/* 保存状态指示器 */}
              <div className="flex items-center gap-1 px-2 py-1 text-xs text-green-600 dark:text-green-400">
                <Save className="w-3 h-3" />
                自动保存+本地备份
              </div>
              <AssetsFolderManager refreshTrigger={assetRefreshTrigger} />
              <CreationPointsWallet />
              {/* 清除数据按钮 */}
              <AlertDialog>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2 text-orange-600 hover:text-orange-700"
                      >
                        <RotateCcw className="w-4 h-4" />
                        清除数据
                      </Button>
                    </AlertDialogTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-72 leading-5">
                    清除后数据将彻底删除且无法恢复，请慎重点击。建议先点击“项目文件”提前打包备份。
                  </TooltipContent>
                </Tooltip>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                        <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
                      </div>
                      <AlertDialogTitle className="text-lg">确认清除所有数据？</AlertDialogTitle>
                    </div>
                    <div className="text-left pt-4 space-y-3 text-muted-foreground text-sm">
                      <div className="text-red-600 dark:text-red-400 font-medium">
                        ⚠️ 此操作将永久删除以下内容：
                      </div>
                      <ul className="list-disc list-inside space-y-1 text-gray-600 dark:text-gray-400">
                        <li>所有已上传的文件内容</li>
                        <li>场景、人物、道具提取结果</li>
                        <li>分镜脚本和图片</li>
                        <li>素材图片和视频</li>
                        <li>工作进度和确认状态</li>
                      </ul>
                      <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
                        <div className="text-sm text-yellow-800 dark:text-yellow-200">
                          💡 建议：清除前请先导出项目文件进行备份，以免丢失重要数据。
                        </div>
                      </div>
                    </div>
                  </AlertDialogHeader>
                  <AlertDialogFooter className="gap-2">
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-red-600 hover:bg-red-700 text-white"
                      onClick={handleClearAllData}
                    >
                      确认清除
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              {/* 项目导入导出 */}
              <ProjectExporter
                onExport={handleExportProject}
                onImport={handleImportProject}
                isExporting={isExporting}
                isImporting={isImporting}
              />
            </div>
          </div>
        </div>

        {/* Progress Steps */}
        <div className="black-mirror-steps mb-8">
          <div className="flex items-start justify-between gap-1 mb-3">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const isActive = index === currentStep;
              const isCompleted = index < currentStep;
              const stepKey = ['upload', 'extraction', 'storyboard', 'assets', 'prompts', 'videos'][index] as keyof typeof stepConfirmed;
              const isConfirmed = stepConfirmed[stepKey];
              
              return (
                <div
                  key={index}
                  className={`mirror-step relative flex min-w-0 flex-1 flex-col items-center ${
                    isCompleted ? 'is-completed' : isActive ? 'is-active' : ''
                  }`}
                >
                  <div
                    className={`
                      mirror-step-icon flex h-12 w-12 items-center justify-center rounded-full mb-2 relative
                      ${isCompleted ? 'mirror-step-completed' : ''}
                      ${isActive ? 'mirror-step-active' : ''}
                      ${!isActive && !isCompleted ? 'mirror-step-pending' : ''}
                    `}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="w-6 h-6" />
                    ) : isActive ? (
                      <Loader2 className="w-6 h-6 animate-spin" />
                    ) : (
                      <Icon className="w-6 h-6" />
                    )}
                    {/* 撤回按钮 - 已确认的步骤显示 */}
                    {isConfirmed && index < 5 && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="mirror-step-undo absolute -right-1 -top-1 w-5 h-5 rounded-full p-0"
                        title="撤回到此步骤"
                        onClick={() => revertToStep(stepKey)}
                      >
                        <Undo2 className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                  <span className={`mirror-step-label text-center text-xs sm:text-sm ${isActive ? 'is-active font-semibold' : ''}`}>
                    {step.title}
                  </span>
                </div>
              );
            })}
          </div>
          <Progress value={progress} className="mirror-progress h-2" />
        </div>

        {/* Main Content */}
        <div className="black-mirror-workspace grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left Panel - File Upload & Extraction Status */}
          <div className="lg:col-span-1 space-y-6">
            {/* File Upload Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="w-5 h-5" />
                  上传故事文件
                </CardTitle>
                <CardDescription>
                  支持 .txt、.md、.pdf、.doc、.docx 格式
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center hover:border-purple-500 transition-colors cursor-pointer"
                  onClick={() => {
                    if (uploadedFile && !stepConfirmed.upload) return; // 已上传未确认时不允许重新上传
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.txt,.md,.pdf,.doc,.docx';
                    input.onchange = (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (file) handleFileUpload(file);
                    };
                    input.click();
                  }}
                >
                  {uploadedFile || uploadedFileName ? (
                    <div className="space-y-2">
                      <FileText className="w-12 h-12 mx-auto text-green-500" />
                      <p className="font-medium">{uploadedFile?.name || uploadedFileName}</p>
                      {uploadedFile && (
                        <p className="text-sm text-gray-500">
                          {(uploadedFile.size / 1024).toFixed(2)} KB
                        </p>
                      )}
                      {uploadedFileName && !uploadedFile && (
                        <Badge variant="secondary" className="text-xs">
                          已恢复
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Upload className="w-12 h-12 mx-auto text-gray-400" />
                      <p className="text-gray-600 dark:text-gray-400">
                        拖拽文件到此处或点击上传
                      </p>
                      <p className="text-xs text-gray-400">
                        支持 TXT、Markdown、PDF、Word 文档
                      </p>
                    </div>
                  )}
                </div>
                {/* 上传确认按钮 */}
                {(uploadedFile || (uploadedFileName && fileContent)) && !stepConfirmed.upload && fileContent && (
                  <div className="mt-4 space-y-2">
                    <Button 
                      className="w-full" 
                      onClick={() => confirmStep('upload')}
                      disabled={isProcessing}
                    >
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      确认文件，开始提取
                    </Button>
                    <Button 
                      className="w-full" 
                      variant="outline"
                      onClick={() => {
                        setUploadedFile(null);
                        setFileContent('');
                        setUploadedFileName(null);
                        setProgress(0);
                        toast.info('已清除文件，请重新上传');
                      }}
                      disabled={isProcessing}
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      不满意，重新上传
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Parallel Extraction Status */}
            {(extractionStatus.scenes !== 'pending' || 
              extractionStatus.characters !== 'pending' || 
              extractionStatus.props !== 'pending' || 
              extractionStatus.outline !== 'pending') && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5" />
                    并行提取状态
                  </CardTitle>
                  <CardDescription>
                    四个维度同时分析中
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-2 rounded bg-gray-50 dark:bg-gray-800">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-blue-500" />
                        <span className="text-sm">场景提取</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {renderStatusIcon(extractionStatus.scenes)}
                        {extractionStatus.scenes !== 'loading' && extractionStatus.scenes !== 'pending' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2"
                            title="重新提取场景"
                            onClick={() => retryExtraction('scenes')}
                          >
                            <RefreshCw className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded bg-gray-50 dark:bg-gray-800">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-purple-500" />
                        <span className="text-sm">人物提取</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {renderStatusIcon(extractionStatus.characters)}
                        {extractionStatus.characters !== 'loading' && extractionStatus.characters !== 'pending' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2"
                            title="重新提取人物"
                            onClick={() => retryExtraction('characters')}
                          >
                            <RefreshCw className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded bg-gray-50 dark:bg-gray-800">
                      <div className="flex items-center gap-2">
                        <Package className="w-4 h-4 text-orange-500" />
                        <span className="text-sm">道具提取</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {renderStatusIcon(extractionStatus.props)}
                        {extractionStatus.props !== 'loading' && extractionStatus.props !== 'pending' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2"
                            title="重新提取道具"
                            onClick={() => retryExtraction('props')}
                          >
                            <RefreshCw className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded bg-gray-50 dark:bg-gray-800">
                      <div className="flex items-center gap-2">
                        <BookOpen className="w-4 h-4 text-green-500" />
                        <span className="text-sm">大纲提取</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {renderStatusIcon(extractionStatus.outline)}
                        {extractionStatus.outline !== 'loading' && extractionStatus.outline !== 'pending' && extractionStatus.outline !== 'batch_confirm' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2"
                            title="重新提取大纲"
                            onClick={() => retryExtraction('outline')}
                          >
                            <RefreshCw className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* 大纲分批提取进度和确认按钮 */}
                  {outlineBatchInfo && (extractionStatus.outline === 'batch_confirm' || extractionStatus.outline === 'loading') && (
                    <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-blue-700 dark:text-blue-400">
                          {extractionStatus.outline === 'loading' ? (
                            <span className="flex items-center gap-2">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              正在提取大纲...
                            </span>
                          ) : (
                            '大纲提取进度'
                          )}
                        </span>
                        <span className="text-sm text-blue-600 dark:text-blue-300">
                          {outlineBatchInfo.currentBatch} / {outlineBatchInfo.totalBatches} 批
                        </span>
                      </div>
                      <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2">
                        <div 
                          className={`bg-blue-600 h-2 rounded-full transition-all duration-300 ${extractionStatus.outline === 'loading' ? 'animate-pulse' : ''}`}
                          style={{ width: `${(outlineBatchInfo.currentBatch / outlineBatchInfo.totalBatches) * 100}%` }}
                        />
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        已提取 {outlineBatchInfo.allChapters.length} / {outlineBatchInfo.totalEpisodes} 个章节
                      </div>
                      {extractionStatus.outline === 'batch_confirm' && outlineBatchInfo.hasMore && (
                        <Button 
                          className="w-full" 
                          onClick={continueOutlineExtraction}
                          disabled={isProcessing}
                        >
                          <ArrowRightCircle className="w-4 h-4 mr-2" />
                          确认并继续提取下一批
                        </Button>
                      )}
                    </div>
                  )}
                  
                  {/* 提取完成确认按钮 */}
                  {extractionStatus.scenes === 'success' && 
                   extractionStatus.characters === 'success' && 
                   extractionStatus.props === 'success' && 
                   extractionStatus.outline === 'success' && 
                   !stepConfirmed.extraction && (
                    <div className="mt-4 space-y-2">
                      <Button 
                        className="w-full" 
                        onClick={() => confirmStep('extraction')}
                        disabled={isProcessing}
                      >
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        确认提取结果，选择章节
                      </Button>
                      <Button 
                        className="w-full" 
                        variant="outline"
                        onClick={() => retryAllExtractions()}
                        disabled={isProcessing}
                      >
                        <RefreshCw className="w-4 h-4 mr-2" />
                        不满意，全部重新提取
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Outline Card */}
            {outline && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BookOpen className="w-5 h-5" />
                    故事大纲
                  </CardTitle>
                  <CardDescription>
                    共 {outline.totalChapters} 个章节
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <h3 className="font-bold text-lg mb-2">{outline.title}</h3>
                      <p
                        className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2"
                        title={outline.summary || ''}
                      >
                        {outline.summary}
                      </p>
                    </div>

                    {/* 分步确认流程 - 步骤1：确认大纲和章节选择 */}
                    {stepConfirmed.extraction ? (
                      <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                            <CheckCircle2 className="w-4 h-4" />
                            <span className="text-sm font-medium">大纲和章节选择已确认</span>
                          </div>
                          <span className="text-xs text-gray-500">请前往"文字分镜"标签页继续下一步</span>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs">
                              1
                            </div>
                            <span className="text-sm font-medium">确认大纲和章节选择</span>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => confirmStep('extraction')}
                            disabled={isProcessing}
                          >
                            <CheckCircle2 className="w-4 h-4 mr-1" />
                            确认大纲
                          </Button>
                        </div>
                        <p className="text-xs text-gray-500 mt-2 pl-8">
                          确认后，系统将基于选定章节生成文字分镜
                        </p>
                      </div>
                    )}
                    
                    {/* 章节列表 */}
                    <div className="space-y-2 mt-4">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">章节列表：</p>
                      {outline.chapters.map((chapter, index) => (
                        <div
                          key={`chapter-list-${chapter.chapterNumber}-${index}`}
                          className="p-3 rounded-lg border border-gray-200 dark:border-gray-700"
                        >
                          <div className="flex items-start gap-3">
                            <Badge variant="outline" className="shrink-0 mt-0.5">
                              第 {chapter.chapterNumber} 章
                            </Badge>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-medium text-sm">{chapter.title}</h4>
                              <p
                                className="text-xs text-gray-500 mt-1 line-clamp-2"
                                title={chapter.summary || ''}
                              >
                                {chapter.summary}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Panel - Extraction Results & Storyboard */}
          <div className="lg:col-span-2">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-6">
                <TabsTrigger value="extraction">
                  <Sparkles className="w-4 h-4 mr-2" />
                  提取结果
                </TabsTrigger>
                <TabsTrigger value="storyboard">
                  <Film className="w-4 h-4 mr-2" />
                  文字分镜
                </TabsTrigger>
                <TabsTrigger value="assets">
                  <Package className="w-4 h-4 mr-2" />
                  素材确认
                </TabsTrigger>
                <TabsTrigger value="prompts">
                  <FileText className="w-4 h-4 mr-2" />
                  提示词
                </TabsTrigger>
                <TabsTrigger value="storyboard-total">
                  <ImageIcon className="w-4 h-4 mr-2" />
                  故事板
                </TabsTrigger>
                <TabsTrigger value="videos">
                  <Video className="w-4 h-4 mr-2" />
                  视频生成
                </TabsTrigger>
                
              </TabsList>

              {/* Extraction Results Tab */}
              <TabsContent value="extraction">
                <div className="space-y-4">
                  {/* Scenes */}
                  {scenesData && (
                    <Card>
                      <CardHeader>
                        <div className="flex items-center justify-between gap-3">
                          <CardTitle className="flex items-center gap-2 text-lg">
                            <MapPin className="w-5 h-5 text-blue-500" />
                            场景列表
                            <Badge variant="secondary">{sceneBatchInfo?.sceneMarkers?.length || scenesData.totalScenes} 个场景</Badge>
                          </CardTitle>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => generateAllAssetImages('scene')}
                            disabled={isProcessing || isBatchAssetGenerating || stepConfirmed.assets || getBatchAssetList('scene').length === 0}
                            title={stepConfirmed.assets ? '素材已确认，无法继续生成' : '一键为场景列表生成图片'}
                          >
                            {batchAssetGeneration.type === 'scene' ? (
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                              <Sparkles className="w-4 h-4 mr-2" />
                            )}
                            {batchAssetGeneration.type === 'scene'
                              ? `生成中 ${batchAssetGeneration.current}/${batchAssetGeneration.total}`
                              : '一键生成场景图'}
                          </Button>
                        </div>
                        {batchAssetGeneration.type === 'scene' && (
                          <CardDescription>
                            正在生成：{batchAssetGeneration.currentName || '准备中'}
                          </CardDescription>
                        )}
                      </CardHeader>
                      <CardContent>
                        {/* 场景分批提取进度和确认按钮 - 放在列表上方 */}
                        {sceneBatchInfo && (
                          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-blue-700 dark:text-blue-400">
                                {extractionStatus.scenes === 'loading' ? (
                                  <span className="flex items-center gap-2">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    正在提取场景...
                                  </span>
                                ) : sceneBatchInfo.hasMore ? (
                                  '场景提取进度（未完成）'
                                ) : (
                                  '场景提取完成'
                                )}
                              </span>
                              <span className="text-sm text-blue-600 dark:text-blue-300">
                                {sceneBatchInfo.currentBatch} / {sceneBatchInfo.totalBatches} 批
                              </span>
                            </div>
                            <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2">
                              <div 
                                className={`bg-blue-600 h-2 rounded-full transition-all duration-300 ${extractionStatus.scenes === 'loading' ? 'animate-pulse' : ''}`}
                                style={{ width: `${(sceneBatchInfo.currentBatch / sceneBatchInfo.totalBatches) * 100}%` }}
                              />
                            </div>
                            <div className="text-xs text-gray-600 dark:text-gray-400">
                              已提取 {sceneBatchInfo.allScenes?.length || 0} / {sceneBatchInfo.sceneMarkers?.length || 0} 个场景
                            </div>
                            {sceneBatchInfo.hasMore && extractionStatus.scenes !== 'loading' && (
                              <Button 
                                className="w-full" 
                                onClick={continueSceneExtraction}
                                disabled={isProcessing}
                              >
                                <ArrowRightCircle className="w-4 h-4 mr-2" />
                                确认并继续提取下一批
                              </Button>
                            )}
                          </div>
                        )}
                        
                        <div className={`grid grid-cols-1 2xl:grid-cols-2 gap-3 ${expandedSections.scenes ? '' : 'max-h-[400px]'} overflow-y-auto transition-all duration-300`}>
                          {(() => {
                            const scenesToDisplay = (sceneBatchInfo?.allScenes?.length ?? 0) > 0 ? sceneBatchInfo?.allScenes : scenesData.scenes;
                            
                            if (!scenesToDisplay || scenesToDisplay.length === 0) {
                              return (
                                <div className="col-span-2 text-center py-8 text-gray-400">
                                  <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                  <p className="text-sm">暂无场景数据</p>
                                </div>
                              );
                            }
                            
                            return scenesToDisplay.map((scene: Scene, index: number) => {
                            const assetData = getAssetImages('scene', scene.id);
                            const images = assetData?.images || [];
                            const canAddMore = images.length < MAX_IMAGES_PER_ASSET;
                            const isGenerating = images.some(img => img.isGenerating);
                            const currentAssetId = assetData?.assetId || `scene-${scene.name}`;
                            const isAssetsConfirmed = stepConfirmed.assets; // 素材是否已确认
                            
                            return (
                              <div key={`scene-${scene.name}-${index}`} className={`p-3 border rounded space-y-2 ${isAssetsConfirmed ? 'opacity-75' : ''}`}>
                                {/* 图片展示区域 - 支持多张图片 */}
                                <div className="grid grid-cols-3 gap-1.5 min-h-14">
                                  {images.map((img, imgIdx) => (
                                    <div key={img.imageId || `scene-${scene.id}-img-${imgIdx}`} className="relative group cursor-pointer overflow-hidden rounded border border-amber-400/10 bg-black/20">
                                      {img.isGenerating ? (
                                        <div className="w-full h-14 bg-gray-100 dark:bg-gray-800 rounded flex flex-col items-center justify-center gap-0.5">
                                          <Loader2 className="size-3 animate-spin text-gray-400" />
                                          <span className="text-[10px] leading-none text-gray-400">{img.generatingStatus || '生成中'}</span>
                                        </div>
                                      ) : img.imageUrl ? (
                                        <>
                                          <img
                                            src={img.imageUrl}
                                            alt={scene.name}
                                            className="w-full h-14 object-cover rounded hover:opacity-80 transition-opacity"
                                            onClick={() => openImagePreview(img.imageUrl, scene.name, 'scene')}
                                          />
                                          <div className={`absolute top-1 right-1 grid grid-cols-2 gap-0.5 transition-opacity ${isAssetsConfirmed ? 'hidden' : 'opacity-0 group-hover:opacity-100'}`}>
                                            <Button
                                              size="icon"
                                              variant="secondary"
                                              className="h-5 w-5 min-w-0 p-0"
                                              title="预览"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                openImagePreview(img.imageUrl, scene.name, 'scene');
                                              }}
                                            >
                                              <Eye className="size-2.5" />
                                            </Button>
                                            <Button
                                              size="icon"
                                              variant="secondary"
                                              className="h-5 w-5 min-w-0 p-0"
                                              title="以此图为参考生成新图"
                                              disabled={isAssetsConfirmed}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                if (!isAssetsConfirmed) generateImageFromImage('scene', scene, img.imageUrl);
                                              }}
                                            >
                                              <Copy className="size-2.5" />
                                            </Button>
                                            <Button
                                              size="icon"
                                              variant="secondary"
                                              className="h-5 w-5 min-w-0 p-0"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                downloadImage(img.imageUrl, scene.name);
                                              }}
                                            >
                                              <Download className="size-2.5" />
                                            </Button>
                                            <Button
                                              size="icon"
                                              variant="destructive"
                                              className="h-5 w-5 min-w-0 p-0"
                                              disabled={isAssetsConfirmed}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                if (!isAssetsConfirmed) removeSelectedImage(currentAssetId, img.imageId);
                                              }}
                                              title={isAssetsConfirmed ? "素材已确认，无法删除" : "取消选中（图片仍在图片库中）"}
                                            >
                                              <Trash2 className="size-2.5" />
                                            </Button>
                                          </div>
                                          {img.isCustom && (
                                            <Badge className="absolute bottom-0 left-0 text-xs" variant="secondary">
                                              自
                                            </Badge>
                                          )}
                                        </>
                                      ) : (
                                        <div className="w-full h-14 bg-gray-100 dark:bg-gray-800 rounded flex items-center justify-center">
                                          <span className="text-xs text-gray-400">图片加载中</span>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                  {/* 添加图片按钮 */}
                                  {canAddMore && !isGenerating && !isAssetsConfirmed && (
                                    <div className="col-span-full grid grid-cols-3 gap-1.5">
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-10 min-w-0 px-0"
                                        onClick={() => generateAssetImage('scene', scene)}
                                        title="AI生成图片"
                                      >
                                        <ImageIcon className="size-4" />
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-10 min-w-0 px-0"
                                        onClick={() => {
                                          const input = document.createElement('input');
                                          input.type = 'file';
                                          input.accept = 'image/*';
                                          input.onchange = (e) => {
                                            const file = (e.target as HTMLInputElement).files?.[0];
                                            if (file) uploadCustomImage('scene', scene, file);
                                          };
                                          input.click();
                                        }}
                                        title="上传本地图片"
                                      >
                                        <ImagePlus className="size-4" />
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-10 min-w-0 px-0"
                                        onClick={() => openImageLibrary('scene', scene.id, scene.name)}
                                        title="从图片库选择"
                                      >
                                        <FolderOpen className="size-4" />
                                      </Button>
                                    </div>
                                  )}
                                </div>
                                {/* 图片数量提示 */}
                                {images.length > 0 && (
                                  <p className="text-xs text-gray-500">{images.length}/{MAX_IMAGES_PER_ASSET} 张</p>
                                )}
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                  <span className="min-w-0 break-words font-medium text-sm">{scene.name}</span>
                                  <Badge variant="outline" className="text-xs">{scene.type}</Badge>
                                  <Badge className="text-xs">{scene.importance}</Badge>
                                </div>
                                {/* 场景描述 - 可编辑 */}
                                {editingSceneId === scene.id ? (
                                  <div className="space-y-1">
                                    <Textarea
                                      value={editingSceneDescription}
                                      onChange={(e) => setEditingSceneDescription(e.target.value)}
                                      className="text-xs min-h-[60px] resize-none"
                                      placeholder="输入场景描述..."
                                    />
                                    <div className="flex gap-1">
                                      <Button
                                        size="sm"
                                        variant="default"
                                        className="h-6 text-xs"
                                        onClick={() => {
                                          // 保存修改
                                          if (scenesData) {
                                            const updatedScenes = scenesData.scenes.map((s: Scene) => 
                                              s.id === scene.id 
                                                ? { ...s, description: editingSceneDescription }
                                                : s
                                            );
                                            setScenesData({
                                              ...scenesData,
                                              scenes: updatedScenes
                                            });
                                          }
                                          // 同时更新 sceneBatchInfo 中的场景
                                          if (sceneBatchInfo?.allScenes) {
                                            const updatedAllScenes = sceneBatchInfo.allScenes.map((s: Scene) =>
                                              s.id === scene.id
                                                ? { ...s, description: editingSceneDescription }
                                                : s
                                            );
                                            setSceneBatchInfo({
                                              ...sceneBatchInfo,
                                              allScenes: updatedAllScenes
                                            });
                                          }
                                          setEditingSceneId(null);
                                          toast.success('场景描述已更新');
                                        }}
                                      >
                                        <Check className="w-3 h-3 mr-1" />
                                        保存
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 text-xs"
                                        onClick={() => {
                                          setEditingSceneId(null);
                                          setEditingSceneDescription('');
                                        }}
                                      >
                                        取消
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <div 
                                    className="group cursor-pointer"
                                    onClick={() => {
                                      setEditingSceneId(scene.id);
                                      setEditingSceneDescription(scene.description || '');
                                    }}
                                  >
                                    <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                                      {scene.description || '点击添加场景描述...'}
                                    </p>
                                    <p className="text-xs text-gray-400 dark:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                      点击编辑描述
                                    </p>
                                  </div>
                                )}
                                <p className="text-xs text-gray-500">{scene.timeOfDay} | {scene.atmosphere}</p>
                                {scene.keyEvents && scene.keyEvents.length > 0 && (
                                  <div className="mt-1">
                                    <p className="text-xs text-gray-500 mb-1">关键事件：</p>
                                    <div className="flex flex-wrap gap-1">
                                      {scene.keyEvents.slice(0, 2).map((event: string, i: number) => (
                                        <Badge key={`scene-${scene.id}-event-${i}`} variant="secondary" className="text-xs">{event}</Badge>
                                      ))}
                                      {scene.keyEvents.length > 2 && (
                                        <span className="text-xs text-gray-400">+{scene.keyEvents.length - 2}</span>
                                      )}
                                    </div>
                                  </div>
                                )}
                                {scene.visualElements && scene.visualElements.length > 0 && (
                                  <div className="mt-1">
                                    <p className="text-xs text-gray-500 mb-1">视觉元素：</p>
                                    <div className="flex flex-wrap gap-1">
                                      {scene.visualElements.slice(0, 3).map((elem: string, i: number) => (
                                        <Badge key={`scene-${scene.id}-elem-${i}`} variant="outline" className="text-xs">{elem}</Badge>
                                      ))}
                                      {scene.visualElements.length > 3 && (
                                        <span className="text-xs text-gray-400">+{scene.visualElements.length - 3}</span>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          });
                          })()}
                        </div>
                        <div className="text-center mt-2">
                          <Button variant="ghost" size="sm" className="text-xs text-gray-500" onClick={() => toggleSection('scenes')}>
                            {expandedSections.scenes ? '收起' : '展开全部'} {sceneBatchInfo?.allScenes?.length || scenesData?.scenes?.length || 0} 个场景
                            <ChevronDown className={`w-3 h-3 ml-1 transition-transform ${expandedSections.scenes ? 'rotate-180' : ''}`} />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Characters */}
                  {charactersData && (
                    <Card>
                      <CardHeader>
                        <div className="flex items-center justify-between gap-3">
                          <CardTitle className="flex items-center gap-2 text-lg">
                            <Users className="w-5 h-5 text-purple-500" />
                            人物列表
                            <Badge variant="secondary">{characterBatchInfo?.characterMarkers?.length || charactersData.totalCharacters} 个人物</Badge>
                          </CardTitle>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => generateAllAssetImages('character')}
                            disabled={isProcessing || isBatchAssetGenerating || stepConfirmed.assets || getBatchAssetList('character').length === 0}
                            title={stepConfirmed.assets ? '素材已确认，无法继续生成' : '一键为人物列表生成图片'}
                          >
                            {batchAssetGeneration.type === 'character' ? (
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                              <Sparkles className="w-4 h-4 mr-2" />
                            )}
                            {batchAssetGeneration.type === 'character'
                              ? `生成中 ${batchAssetGeneration.current}/${batchAssetGeneration.total}`
                              : '一键生成人物图'}
                          </Button>
                        </div>
                        {batchAssetGeneration.type === 'character' && (
                          <CardDescription>
                            正在生成：{batchAssetGeneration.currentName || '准备中'}
                          </CardDescription>
                        )}
                      </CardHeader>
                      <CardContent>
                        {/* 人物分批提取进度和确认按钮 - 放在列表上方 */}
                        {characterBatchInfo && (
                          <div className="mb-4 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-purple-700 dark:text-purple-400">
                                {extractionStatus.characters === 'loading' ? (
                                  <span className="flex items-center gap-2">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    正在提取人物...
                                  </span>
                                ) : characterBatchInfo.hasMore ? (
                                  '人物提取进度（未完成）'
                                ) : (
                                  '人物提取完成'
                                )}
                              </span>
                              <span className="text-sm text-purple-600 dark:text-purple-300">
                                {characterBatchInfo.currentBatch} / {characterBatchInfo.totalBatches} 批
                              </span>
                            </div>
                            <div className="w-full bg-purple-200 dark:bg-purple-800 rounded-full h-2">
                              <div 
                                className={`bg-purple-600 h-2 rounded-full transition-all duration-300 ${extractionStatus.characters === 'loading' ? 'animate-pulse' : ''}`}
                                style={{ width: `${(characterBatchInfo.currentBatch / characterBatchInfo.totalBatches) * 100}%` }}
                              />
                            </div>
                            <div className="text-xs text-gray-600 dark:text-gray-400">
                              已提取 {characterBatchInfo.allCharacters?.length || 0} / {characterBatchInfo.characterMarkers?.length || 0} 个人物
                            </div>
                            {characterBatchInfo.hasMore && extractionStatus.characters !== 'loading' && (
                              <Button 
                                className="w-full" 
                                onClick={continueCharacterExtraction}
                                disabled={isProcessing}
                              >
                                <ArrowRightCircle className="w-4 h-4 mr-2" />
                                确认并继续提取下一批
                              </Button>
                            )}
                          </div>
                        )}
                        
                        <div className={`space-y-2 ${expandedSections.characters ? '' : 'max-h-[400px]'} overflow-y-auto transition-all duration-300`}>
                          {(() => {
                            const displayCharacters = (charactersData?.characters && charactersData.characters.length > 0)
                              ? charactersData.characters
                              : (characterBatchInfo?.allCharacters || []);
                            
                            if (displayCharacters.length === 0) {
                              return (
                                <div className="p-4 text-center text-gray-500">
                                  <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                  <p>暂无人物数据</p>
                                  {characterBatchInfo && (
                                    <p className="text-xs mt-1">已提取 {characterBatchInfo.allCharacters?.length || 0} 个人物</p>
                                  )}
                                </div>
                              );
                            }
                            
                            return displayCharacters.map((char: Character, index: number) => {
                            const assetData = getAssetImages('character', char.id);
                            const images = assetData?.images || [];
                            const canAddMore = images.length < MAX_IMAGES_PER_ASSET;
                            const isGenerating = images.some(img => img.isGenerating);
                            const currentAssetId = assetData?.assetId || `character-${char.name}`;
                            const isAssetsConfirmed = stepConfirmed.assets; // 素材是否已确认
                            const displayAge = isUsefulText(char.age) ? (char.age.includes('岁') ? char.age : `${char.age}岁`) : '年龄未知';
                            const displayGender = isUsefulText(char.gender) ? char.gender : '性别待定';
                            
                            return (
                              <div key={`char-${char.name}-${index}`} className={`p-3 border rounded-lg ${isAssetsConfirmed ? 'opacity-75' : ''}`}>
                                <div className="flex gap-3">
                                  {/* 人物图片区域 - 支持多张 */}
                                  <div className="shrink-0">
                                    <div className="grid grid-cols-2 gap-1 w-[104px]">
                                      {images.map((img, imgIdx) => (
                                        <div key={img.imageId || `char-${char.id}-img-${imgIdx}`} className="relative group cursor-pointer overflow-hidden rounded">
                                          {img.isGenerating ? (
                                            <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded flex flex-col items-center justify-center gap-0.5">
                                              <Loader2 className="w-3 h-3 animate-spin text-gray-400" />
                                              <span className="text-[10px] leading-none text-gray-400">{img.generatingStatus || '生成中'}</span>
                                            </div>
                                          ) : img.imageUrl ? (
                                            <>
                                              <img
                                                src={img.imageUrl}
                                                alt={char.name}
                                                className="w-12 h-12 object-cover rounded hover:opacity-80 transition-opacity"
                                                onClick={() => openImagePreview(img.imageUrl, char.name, 'character')}
                                              />
                                              <div className={`absolute top-1 right-1 grid grid-cols-2 gap-0.5 transition-opacity ${isAssetsConfirmed ? 'hidden' : 'opacity-0 group-hover:opacity-100'}`}>
                                                <Button
                                                  size="icon"
                                                  variant="secondary"
                                                  className="h-5 w-5 min-w-0 p-0"
                                                  title="预览"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    openImagePreview(img.imageUrl, char.name, 'character');
                                                  }}
                                                >
                                                  <Eye className="size-2.5" />
                                                </Button>
                                                <Button
                                                  size="icon"
                                                  variant="secondary"
                                                  className="h-5 w-5 min-w-0 p-0"
                                                  title="以此图为参考生成新图"
                                                  disabled={isAssetsConfirmed}
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (!isAssetsConfirmed) generateImageFromImage('character', char, img.imageUrl);
                                                  }}
                                                >
                                                  <Copy className="size-2.5" />
                                                </Button>
                                                <Button
                                                  size="icon"
                                                  variant="secondary"
                                                  className="h-5 w-5 min-w-0 p-0"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    downloadImage(img.imageUrl, char.name);
                                                  }}
                                                >
                                                  <Download className="size-2.5" />
                                                </Button>
                                                <Button
                                                  size="icon"
                                                  variant="destructive"
                                                  className="h-5 w-5 min-w-0 p-0"
                                                  disabled={isAssetsConfirmed}
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (!isAssetsConfirmed) removeSelectedImage(currentAssetId, img.imageId);
                                                  }}
                                                  title={isAssetsConfirmed ? "素材已确认，无法删除" : "取消选中（图片仍在图片库中）"}
                                                >
                                                  <Trash2 className="size-2.5" />
                                                </Button>
                                              </div>
                                              {img.isCustom && (
                                                <Badge className="absolute bottom-0 left-0 text-xs" variant="secondary">
                                                  自
                                                </Badge>
                                              )}
                                            </>
                                          ) : (
                                            <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded flex items-center justify-center">
                                              <span className="text-xs text-gray-400">图片加载中</span>
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                      {/* 添加按钮 */}
                                      {canAddMore && images.length < 4 && !isGenerating && !isAssetsConfirmed && (
                                        <div className="flex gap-0.5">
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="w-6 h-12 px-0"
                                            onClick={() => generateAssetImage('character', char)}
                                            title="AI生成图片"
                                          >
                                            <ImageIcon className="size-4" />
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="w-6 h-12 px-0"
                                            onClick={() => {
                                              const input = document.createElement('input');
                                              input.type = 'file';
                                              input.accept = 'image/*';
                                              input.onchange = (e) => {
                                                const file = (e.target as HTMLInputElement).files?.[0];
                                                if (file) uploadCustomImage('character', char, file);
                                              };
                                              input.click();
                                            }}
                                            title="上传本地图片"
                                          >
                                            <ImagePlus className="size-4" />
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="w-6 h-12 px-0"
                                            onClick={() => openImageLibrary('character', char.id, char.name)}
                                            title="从图片库选择"
                                          >
                                            <FolderOpen className="size-4" />
                                          </Button>
                                        </div>
                                      )}
                                    </div>
                                    {images.length > 0 && (
                                      <p className="text-xs text-gray-500 text-center mt-1">{images.length}/{MAX_IMAGES_PER_ASSET}</p>
                                    )}
                                  </div>
                                  {/* 人物信息 */}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-1">
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium">{char.name}</span>
                                        <Badge variant={char.role === '主角' ? 'default' : 'outline'} className="text-xs">
                                          {char.role}
                                        </Badge>
                                      </div>
                                      <span className="text-xs text-gray-500">{displayAge} | {displayGender}</span>
                                    </div>
                                    {/* 外貌描述 - 可编辑 */}
                                    {editingCharacterId === char.id ? (
                                      <div className="space-y-1">
                                        <Textarea
                                          value={editingCharacterAppearance}
                                          onChange={(e) => setEditingCharacterAppearance(e.target.value)}
                                          className="text-xs min-h-[60px] resize-none"
                                          placeholder="输入人物外貌描述..."
                                        />
                                        <div className="flex gap-1">
                                          <Button
                                            size="sm"
                                            variant="default"
                                            className="h-6 text-xs"
                                            onClick={() => {
                                              // 保存修改 - 使用函数式更新避免闭包过期
                                              if (charactersData && Array.isArray(charactersData.characters)) {
                                                setCharactersData((prev: any) => {
                                                  if (!prev || !Array.isArray(prev.characters)) return prev;
                                                  const updatedCharacters = prev.characters.map((c: Character) => 
                                                    c.id === char.id 
                                                      ? { ...c, appearance: editingCharacterAppearance }
                                                      : c
                                                  );
                                                  return { ...prev, characters: updatedCharacters };
                                                });
                                                setEditingCharacterId(null);
                                                toast.success('人物描述已更新');
                                              } else {
                                                toast.error('保存失败：人物数据结构异常，请重新提取');
                                              }
                                            }}
                                          >
                                            <Check className="w-3 h-3 mr-1" />
                                            保存
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-6 text-xs"
                                            onClick={() => {
                                              setEditingCharacterId(null);
                                              setEditingCharacterAppearance('');
                                            }}
                                          >
                                            取消
                                          </Button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div
                                        className="group cursor-pointer"
                                        onClick={() => {
                                          setEditingCharacterId(char.id);
                                          setEditingCharacterAppearance(char.appearance || '');
                                        }}
                                      >
                                        {/* 人物描述标签 */}
                                        <div className="text-xs text-gray-500 mb-1 font-medium">人物描述：</div>
                                        <p className="text-xs text-gray-600 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                                          {char.appearance && char.appearance.trim() ? (
                                            char.appearance
                                          ) : (
                                            <span className="text-gray-400 italic">暂无描述，点击添加</span>
                                          )}
                                        </p>
                                        <p className="text-xs text-gray-400 dark:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                          点击编辑描述
                                        </p>
                                      </div>
                                    )}
                                    {/* 人物弧光 */}
                                    {char.arc && char.arc.trim() && (
                                      <div className="mt-1">
                                        <span className="text-xs text-gray-500 shrink-0 font-medium">人物弧光：</span>
                                        <p className="text-xs text-gray-600 dark:text-gray-400">{char.arc}</p>
                                      </div>
                                    )}
                                    {/* 相关道具 */}
                                    {char.props && char.props.length > 0 && (
                                      <div className="mt-1">
                                        <div className="flex flex-wrap gap-1 items-center">
                                          <span className="text-xs text-gray-500 shrink-0 font-medium">相关道具：</span>
                                          {char.props.map((prop: string, i: number) => (
                                            <Badge key={`char-${char.id}-prop-${i}`} variant="outline" className="text-xs bg-blue-50 dark:bg-blue-900/20">{prop}</Badge>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {/* 脸型特征 */}
                                    {char.faceFeatures && (
                                      <div className="mt-2 p-2 bg-gray-50 dark:bg-gray-800 rounded">
                                        <span className="text-xs text-gray-500 font-medium">脸型特征（固定）：</span>
                                        <div className="grid grid-cols-2 gap-1 mt-1 text-xs text-gray-600 dark:text-gray-400">
                                          <div>脸型：{char.faceFeatures.faceShape || '待补充'}</div>
                                          <div>眼睛：{char.faceFeatures.eyes || '待补充'}</div>
                                          <div>鼻子：{char.faceFeatures.nose || '待补充'}</div>
                                          <div>嘴巴：{char.faceFeatures.mouth || '待补充'}</div>
                                          <div className="col-span-2">肤色：{char.faceFeatures.skinTone || '待补充'}</div>
                                        </div>
                                      </div>
                                    )}
                                    {/* 造型列表 */}
                                    {char.looks && char.looks.length > 0 && (
                                      <div className="mt-2">
                                        <span className="text-xs text-gray-500 font-medium">造型变化：</span>
                                        <div className="mt-1 space-y-1 max-h-[200px] overflow-y-auto">
                                          {char.looks.map((look: any, lookIndex: number) => (
                                            <div key={look.id || lookIndex} className="p-2 border rounded bg-purple-50 dark:bg-purple-900/20">
                                              <div className="flex items-center justify-between mb-1">
                                                <div className="flex items-center gap-2">
                                                  <Badge variant="secondary" className="text-xs">
                                                    {look.scene || '造型'}
                                                  </Badge>
                                                  {look.stage && (
                                                    <Badge variant="outline" className="text-xs">
                                                      {look.stage}
                                                    </Badge>
                                                  )}
                                                  <span className="text-xs text-gray-500">{look.mood || '自然'}</span>
                                                </div>
                                                {look.isGenerating ? (
                                                  <Button
                                                    size="sm"
                                                    variant="destructive"
                                                    className="h-6 text-xs"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      cancelLookGeneration(char, look.id);
                                                    }}
                                                  >
                                                    ✕ 取消
                                                  </Button>
                                                ) : look.isGeneratingFourView ? (
                                                  <Button
                                                    size="sm"
                                                    variant="secondary"
                                                    className="h-6 text-xs"
                                                    disabled
                                                  >
                                                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                                    四视图
                                                  </Button>
                                                ) : (
                                                  <div className="flex gap-1">
                                                    <Button
                                                      size="sm"
                                                      variant="ghost"
                                                      className="h-6 text-xs"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleGenerateCharacterLookImage(char, look.id);
                                                      }}
                                                      disabled={Boolean(look.isGenerating || isBatchAssetGenerating)}
                                                    >
                                                      换装
                                                    </Button>
                                                    <Button
                                                      size="sm"
                                                      variant="outline"
                                                      className="h-6 text-xs"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleGenerateCharacterFourView(char, look.id);
                                                      }}
                                                      disabled={Boolean(look.isGeneratingFourView || isBatchAssetGenerating)}
                                                      title="一键生成该套衣服的四视图"
                                                    >
                                                      四视图
                                                    </Button>
                                                  </div>
                                                )}
                                              </div>
                                              {editingLookKey === `${char.id}-${look.id}` ? (
                                                <div className="space-y-1 mb-1">
                                                  <Textarea
                                                    value={editingLookDescription}
                                                    onChange={(e) => setEditingLookDescription(e.target.value)}
                                                    className="text-xs min-h-[50px] resize-none"
                                                    placeholder="输入该造型的提示词..."
                                                  />
                                                  <div className="flex gap-1">
                                                    <Button
                                                      size="sm"
                                                      variant="default"
                                                      className="h-5 text-xs"
                                                      onClick={() => {
                                                        // 保存造型提示词
                                                        setCharactersData((prev: any) => {
                                                          if (!prev || !Array.isArray(prev.characters)) return prev;
                                                          return {
                                                            ...prev,
                                                            characters: prev.characters.map((c: any) => {
                                                              if (c.id !== char.id) return c;
                                                              return {
                                                                ...c,
                                                                looks: c.looks?.map((l: any) =>
                                                                  l.id === look.id
                                                                    ? { ...l, description: editingLookDescription }
                                                                    : l
                                                                ),
                                                              };
                                                            }),
                                                          };
                                                        });
                                                        setEditingLookKey(null);
                                                        toast.success('造型提示词已更新');
                                                      }}
                                                    >
                                                      <Check className="w-3 h-3 mr-1" />
                                                      保存
                                                    </Button>
                                                    <Button
                                                      size="sm"
                                                      variant="ghost"
                                                      className="h-5 text-xs"
                                                      onClick={() => {
                                                        setEditingLookKey(null);
                                                      }}
                                                    >
                                                      取消
                                                    </Button>
                                                  </div>
                                                </div>
                                              ) : (
                                                <div
                                                  className="group/desc cursor-pointer mb-1"
                                                  onClick={() => {
                                                    setEditingLookKey(`${char.id}-${look.id}`);
                                                    setEditingLookDescription(look.description || '');
                                                  }}
                                                >
                                                  {look.description ? (
                                                    <p className="text-xs text-gray-600 dark:text-gray-400">{look.description}</p>
                                                  ) : (
                                                    <p className="text-xs text-gray-400 italic">暂无提示词，点击添加</p>
                                                  )}
                                                  <p className="text-xs text-gray-400 dark:text-gray-500 opacity-0 group-hover/desc:opacity-100 transition-opacity">
                                                    点击编辑提示词
                                                  </p>
                                                </div>
                                              )}
                                              <div className="space-y-0.5 text-xs text-gray-500">
                                                <div>服装：{look.costume || '待补充'}</div>
                                                <div>发型：{look.hairstyle || '待补充'}</div>
                                                {look.accessories && look.accessories.length > 0 && (
                                                  <div>配饰：{look.accessories.join('、')}</div>
                                                )}
                                                <div>化妆：{look.makeup || '淡妆'}</div>
                                              </div>
                                              {/* 显示该造型的图片 */}
                                              {look.isGenerating ? (
                                                <div className="mt-2">
                                                  <div className="w-full h-24 bg-gray-100 dark:bg-gray-800 rounded flex items-center justify-center">
                                                    <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                                                  </div>
                                                  {look.generatingStatus && (
                                                    <p className="text-xs text-center text-gray-500 mt-1">{look.generatingStatus}</p>
                                                  )}
                                                </div>
                                              ) : look.imageUrl ? (
                                                <div className="mt-2 relative group/look-image">
                                                  <img
                                                    src={look.imageUrl}
                                                    alt={`${char.name} - ${look.scene || look.id}`}
                                                    className="w-full h-auto object-contain rounded max-h-64"
                                                    onClick={() => openImagePreview(look.imageUrl, `${char.name} - ${look.scene || look.id}`, 'character')}
                                                  />
                                                  {/* 操作按钮组 */}
                                                  <div className={`absolute top-0 right-0 flex gap-0.5 transition-opacity ${isAssetsConfirmed ? 'hidden' : 'opacity-0 group-hover/look-image:opacity-100'}`}>
                                                    <Button
                                                      size="icon"
                                                      variant="secondary"
                                                      className="h-4 w-4 bg-white/90"
                                                      title="预览"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        openImagePreview(look.imageUrl, `${char.name} - ${look.scene || look.id}`, 'character');
                                                      }}
                                                    >
                                                      <Eye className="w-2 h-2" />
                                                    </Button>
                                                    <Button
                                                      size="icon"
                                                      variant="secondary"
                                                      className="h-4 w-4 bg-white/90"
                                                      title="下载"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        downloadImage(look.imageUrl, `${char.name}_${look.scene || look.id}`);
                                                      }}
                                                    >
                                                      <Download className="w-2 h-2" />
                                                    </Button>
                                                    <Button
                                                      size="icon"
                                                      variant="destructive"
                                                      className="h-4 w-4 bg-white/90"
                                                      title="删除"
                                                      disabled={isAssetsConfirmed || isGeneratingImage}
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (!isAssetsConfirmed) handleDeleteCharacterLookImage(char.id, look.id);
                                                      }}
                                                    >
                                                      <Trash2 className="w-2 h-2" />
                                                    </Button>
                                                  </div>
                                                  {look.isCustom && (
                                                    <Badge className="absolute bottom-0 left-0 text-[10px]" variant="secondary">
                                                      自
                                                    </Badge>
                                                  )}
                                                </div>
                                              ) : null}
                                              {/* 显示该造型的四视图 */}
                                              {look.isGeneratingFourView ? (
                                                <div className="mt-2">
                                                  <div className="w-full h-24 bg-gray-100 dark:bg-gray-800 rounded flex items-center justify-center">
                                                    <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                                                  </div>
                                                  <p className="text-xs text-center text-gray-500 mt-1">{look.fourViewStatus || '四视图生成中'}</p>
                                                </div>
                                              ) : look.fourViewImageUrl ? (
                                                <div className="mt-2 relative group/four-view">
                                                  <div className="mb-1 text-xs font-medium text-gray-500">{char.name}的四视图</div>
                                                  <img
                                                    src={look.fourViewImageUrl}
                                                    alt={`${char.name}的四视图`}
                                                    className="w-full h-auto object-contain rounded max-h-64"
                                                    onClick={() => openImagePreview(look.fourViewImageUrl, `${char.name}的四视图`, 'character')}
                                                  />
                                                  <div className={`absolute top-5 right-0 flex gap-0.5 transition-opacity ${isAssetsConfirmed ? 'hidden' : 'opacity-0 group-hover/four-view:opacity-100'}`}>
                                                    <Button
                                                      size="icon"
                                                      variant="secondary"
                                                      className="h-4 w-4 bg-white/90"
                                                      title="预览"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        openImagePreview(look.fourViewImageUrl, `${char.name}的四视图`, 'character');
                                                      }}
                                                    >
                                                      <Eye className="w-2 h-2" />
                                                    </Button>
                                                    <Button
                                                      size="icon"
                                                      variant="secondary"
                                                      className="h-4 w-4 bg-white/90"
                                                      title="下载"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        downloadImage(look.fourViewImageUrl, `${char.name}的四视图`);
                                                      }}
                                                    >
                                                      <Download className="w-2 h-2" />
                                                    </Button>
                                                    <Button
                                                      size="icon"
                                                      variant="destructive"
                                                      className="h-4 w-4 bg-white/90"
                                                      title="删除"
                                                      disabled={isAssetsConfirmed || isGeneratingImage}
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        updateLookById(look.id, { fourViewImageUrl: undefined }, char);
                                                      }}
                                                    >
                                                      <Trash2 className="w-2 h-2" />
                                                    </Button>
                                                  </div>
                                                </div>
                                              ) : null}
                                              {/* 上传按钮（没有图片时显示） */}
                                              {!look.imageUrl && !look.isGenerating && !isAssetsConfirmed && (
                                                <div className="mt-2 flex gap-1">
                                                  <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="flex-1 h-8 text-xs"
                                                    onClick={() => {
                                                      const input = document.createElement('input');
                                                      input.type = 'file';
                                                      input.accept = 'image/*';
                                                      input.onchange = (e) => {
                                                        const file = (e.target as HTMLInputElement).files?.[0];
                                                        if (file) handleUploadCharacterLookImage(char, look.id, file);
                                                      };
                                                      input.click();
                                                    }}
                                                    title="上传本地图片"
                                                  >
                                                    <ImagePlus className="w-3 h-3 mr-1" />
                                                    上传
                                                  </Button>
                                                </div>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {/* 服装信息（保留向后兼容） */}
                                    {char.costume && char.costume.length > 0 && char.looks === undefined && (
                                      <div className="mt-1">
                                        <div className="flex flex-wrap gap-1 items-center">
                                          <span className="text-xs text-gray-500 shrink-0">服装：</span>
                                          {char.costume.map((c: string, i: number) => (
                                            <Badge key={`char-${char.id}-costume-${i}`} variant="outline" className="text-xs bg-purple-50 dark:bg-purple-900/20">{c}</Badge>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {/* 性格特点 */}
                                    {char.personality && char.personality.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-2">
                                        {char.personality.slice(0, 3).map((p, i) => (
                                          <Badge key={`char-${char.id}-personality-${i}`} variant="secondary" className="text-xs">{p}</Badge>
                                        ))}
                                      </div>
                                    )}
                                    {/* 背景故事 */}
                                    {char.background && (
                                      <p className="text-xs text-gray-500 mt-2">
                                        <span className="font-medium text-gray-600 dark:text-gray-400">背景：</span>
                                        {char.background}
                                      </p>
                                    )}
                                    {/* 人物弧光 */}
                                    {char.arc && (
                                      <p className="text-xs text-gray-500 mt-2">
                                        <span className="font-medium text-gray-600 dark:text-gray-400">成长线：</span>
                                        {char.arc}
                                      </p>
                                    )}
                                    {/* 服装细节 */}
                                    {char.costumeDetails && (
                                      <div className="mt-2 p-2 bg-purple-50 dark:bg-purple-900/20 rounded text-xs text-gray-600 dark:text-gray-400 space-y-1">
                                        <div className="font-medium text-gray-500 dark:text-gray-400">服装细节：</div>
                                        {char.costumeDetails.mainOutfit && (
                                          <div>主服装：{char.costumeDetails.mainOutfit}</div>
                                        )}
                                        {char.costumeDetails.colorScheme && (
                                          <div>配色：{char.costumeDetails.colorScheme}</div>
                                        )}
                                        {char.costumeDetails.accessories && char.costumeDetails.accessories.length > 0 && (
                                          <div>配饰：{char.costumeDetails.accessories.join('、')}</div>
                                        )}
                                        {char.costumeDetails.styleNotes && (
                                          <div>风格：{char.costumeDetails.styleNotes}</div>
                                        )}
                                      </div>
                                    )}
                                    {/* 关键场景 */}
                                    {char.keyScenes && char.keyScenes.length > 0 && (
                                      <div className="mt-2">
                                        <p className="text-xs text-gray-500 mb-1">关键场景：</p>
                                        <div className="flex flex-wrap gap-1">
                                          {char.keyScenes.slice(0, 5).map((scene, i) => (
                                            <Badge key={`char-${char.id}-scene-${i}`} variant="outline" className="text-xs">
                                              {scene}
                                            </Badge>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {/* 关键关系 */}
                                    {char.keyRelationships && char.keyRelationships.length > 0 && (
                                      <div className="mt-2">
                                        <p className="text-xs text-gray-500 mb-1">关键关系：</p>
                                        <div className="flex flex-wrap gap-1">
                                          {char.keyRelationships.slice(0, 3).map((rel, i) => (
                                            <Badge key={`char-${char.id}-rel-${i}`} variant="outline" className="text-xs">
                                              {rel.target} ({rel.relationship})
                                            </Badge>
                                          ))}
                                          {char.keyRelationships.length > 3 && (
                                            <span className="text-xs text-gray-400">+{char.keyRelationships.length - 3}</span>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                    {/* 关键出场场景 */}
                                    {char.keyScenes && char.keyScenes.length > 0 && (
                                      <div className="mt-2">
                                        <p className="text-xs text-gray-500 mb-1">关键场景：</p>
                                        <div className="flex flex-wrap gap-1">
                                          {char.keyScenes.slice(0, 3).map((scene, i) => (
                                            <Badge key={`char-${char.id}-scene-${i}`} variant="secondary" className="text-xs">{scene}</Badge>
                                          ))}
                                          {char.keyScenes.length > 3 && (
                                            <span className="text-xs text-gray-400">+{char.keyScenes.length - 3}</span>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                    {/* 相关道具 */}
                                    {char.props && char.props.length > 0 && (
                                      <div className="mt-2">
                                        <p className="text-xs text-gray-500 mb-1">相关道具：</p>
                                        <div className="flex flex-wrap gap-1">
                                          {char.props.slice(0, 3).map((prop, i) => (
                                            <Badge key={`char-${char.id}-prop-${i}`} variant="outline" className="text-xs">{prop}</Badge>
                                          ))}
                                          {char.props.length > 3 && (
                                            <span className="text-xs text-gray-400">+{char.props.length - 3}</span>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          });
                        })()}
                        </div>
                        <div className="text-center mt-2">
                          <Button variant="ghost" size="sm" className="text-xs text-gray-500" onClick={() => toggleSection('characters')}>
                            {expandedSections.characters ? '收起' : '展开全部'} {characterBatchInfo?.characterMarkers?.length || charactersData?.totalCharacters || 0} 个人物
                            <ChevronDown className={`w-3 h-3 ml-1 transition-transform ${expandedSections.characters ? 'rotate-180' : ''}`} />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Props */}
                  {propsData && (
                    <Card>
                      <CardHeader>
                        <div className="flex items-center justify-between gap-3">
                          <CardTitle className="flex items-center gap-2 text-lg">
                            <Package className="w-5 h-5 text-orange-500" />
                            道具列表
                            <Badge variant="secondary">{propBatchInfo?.propMarkers?.length || propsData.totalProps} 个道具</Badge>
                          </CardTitle>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => generateAllAssetImages('prop')}
                            disabled={isProcessing || isBatchAssetGenerating || stepConfirmed.assets || getBatchAssetList('prop').length === 0}
                            title={stepConfirmed.assets ? '素材已确认，无法继续生成' : '一键为道具列表生成图片'}
                          >
                            {batchAssetGeneration.type === 'prop' ? (
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                              <Sparkles className="w-4 h-4 mr-2" />
                            )}
                            {batchAssetGeneration.type === 'prop'
                              ? `生成中 ${batchAssetGeneration.current}/${batchAssetGeneration.total}`
                              : '一键生成道具图'}
                          </Button>
                        </div>
                        {batchAssetGeneration.type === 'prop' && (
                          <CardDescription>
                            正在生成：{batchAssetGeneration.currentName || '准备中'}
                          </CardDescription>
                        )}
                      </CardHeader>
                      <CardContent>
                        {/* 道具分批提取进度和确认按钮 - 放在列表上方 */}
                        {propBatchInfo && (
                          <div className="mb-4 p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-orange-700 dark:text-orange-400">
                                {extractionStatus.props === 'loading' ? (
                                  <span className="flex items-center gap-2">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    正在提取道具...
                                  </span>
                                ) : propBatchInfo.hasMore ? (
                                  '道具提取进度（未完成）'
                                ) : (
                                  '道具提取完成'
                                )}
                              </span>
                              <span className="text-sm text-orange-600 dark:text-orange-300">
                                {propBatchInfo.currentBatch} / {propBatchInfo.totalBatches} 批
                              </span>
                            </div>
                            <div className="w-full bg-orange-200 dark:bg-orange-800 rounded-full h-2">
                              <div 
                                className={`bg-orange-600 h-2 rounded-full transition-all duration-300 ${extractionStatus.props === 'loading' ? 'animate-pulse' : ''}`}
                                style={{ width: `${(propBatchInfo.currentBatch / propBatchInfo.totalBatches) * 100}%` }}
                              />
                            </div>
                            <div className="text-xs text-gray-600 dark:text-gray-400">
                              已提取 {propBatchInfo.allProps?.length || 0} / {propBatchInfo.propMarkers?.length || 0} 个道具
                            </div>
                            {propBatchInfo.hasMore && extractionStatus.props !== 'loading' && (
                              <Button 
                                className="w-full" 
                                onClick={continuePropExtraction}
                                disabled={isProcessing}
                              >
                                <ArrowRightCircle className="w-4 h-4 mr-2" />
                                确认并继续提取下一批
                              </Button>
                            )}
                          </div>
                        )}
                        
                        <div className={`grid grid-cols-1 2xl:grid-cols-2 gap-3 ${expandedSections.props ? '' : 'max-h-[400px]'} overflow-y-auto transition-all duration-300`}>
                          {(() => {
                            const propsToDisplay = (propBatchInfo?.allProps?.length ?? 0) > 0 ? propBatchInfo?.allProps : propsData.props;
                            
                            if (!propsToDisplay || propsToDisplay.length === 0) {
                              return (
                                <div className="col-span-2 text-center py-8 text-gray-400">
                                  <Package className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                  <p className="text-sm">暂无道层数据</p>
                                </div>
                              );
                            }
                            
                            return propsToDisplay.map((prop: Prop, index: number) => {
                            const assetData = getAssetImages('prop', prop.id);
                            const images = assetData?.images || [];
                            const canAddMore = images.length < MAX_IMAGES_PER_ASSET;
                            const isGenerating = images.some(img => img.isGenerating);
                            const currentAssetId = assetData?.assetId || `prop-${prop.name}`;
                            const isAssetsConfirmed = stepConfirmed.assets; // 素材是否已确认
                            
                            return (
                              <div key={`prop-${prop.name}-${index}`} className={`p-3 border rounded space-y-2 ${isAssetsConfirmed ? 'opacity-75' : ''}`}>
                                {/* 道具图片区域 - 支持多张 */}
                                <div className="grid grid-cols-3 gap-1.5 min-h-14">
                                  {images.map((img, imgIdx) => (
                                    <div key={img.imageId || `prop-${prop.id}-img-${imgIdx}`} className="relative group cursor-pointer overflow-hidden rounded border border-amber-400/10 bg-black/20">
                                      {img.isGenerating ? (
                                        <div className="w-full h-14 bg-gray-100 dark:bg-gray-800 rounded flex flex-col items-center justify-center gap-0.5">
                                          <Loader2 className="size-3 animate-spin text-gray-400" />
                                          <span className="text-[10px] leading-none text-gray-400">{img.generatingStatus || '生成中'}</span>
                                        </div>
                                      ) : img.imageUrl ? (
                                        <>
                                          <img
                                            src={img.imageUrl}
                                            alt={prop.name}
                                            className="w-full h-14 object-cover rounded hover:opacity-80 transition-opacity"
                                            onClick={() => openImagePreview(img.imageUrl, prop.name, 'prop')}
                                          />
                                          <div className={`absolute top-1 right-1 grid grid-cols-2 gap-0.5 transition-opacity ${isAssetsConfirmed ? 'hidden' : 'opacity-0 group-hover:opacity-100'}`}>
                                            <Button
                                              size="icon"
                                              variant="secondary"
                                              className="h-5 w-5 min-w-0 p-0"
                                              title="预览"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                openImagePreview(img.imageUrl, prop.name, 'prop');
                                              }}
                                            >
                                              <Eye className="size-2.5" />
                                            </Button>
                                            <Button
                                              size="icon"
                                              variant="secondary"
                                              className="h-5 w-5 min-w-0 p-0"
                                              title="以此图为参考生成新图"
                                              disabled={isAssetsConfirmed}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                if (!isAssetsConfirmed) generateImageFromImage('prop', prop, img.imageUrl);
                                              }}
                                            >
                                              <Copy className="size-2.5" />
                                            </Button>
                                            <Button
                                              size="icon"
                                              variant="secondary"
                                              className="h-5 w-5 min-w-0 p-0"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                downloadImage(img.imageUrl, prop.name);
                                              }}
                                            >
                                              <Download className="size-2.5" />
                                            </Button>
                                            <Button
                                              size="icon"
                                              variant="destructive"
                                              className="h-5 w-5 min-w-0 p-0"
                                              disabled={isAssetsConfirmed}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                if (!isAssetsConfirmed) removeSelectedImage(currentAssetId, img.imageId);
                                              }}
                                              title={isAssetsConfirmed ? "素材已确认，无法删除" : "取消选中（图片仍在图片库中）"}
                                            >
                                              <Trash2 className="size-2.5" />
                                            </Button>
                                          </div>
                                          {img.isCustom && (
                                            <Badge className="absolute bottom-0 left-0 text-xs" variant="secondary">
                                              自定义
                                            </Badge>
                                          )}
                                        </>
                                      ) : (
                                        <div className="w-full h-14 bg-gray-100 dark:bg-gray-800 rounded flex items-center justify-center">
                                          <span className="text-xs text-gray-400">图片加载中</span>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                  {/* 添加按钮 */}
                                  {canAddMore && !isGenerating && !isAssetsConfirmed && (
                                    <div className="col-span-full grid grid-cols-3 gap-1.5">
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-10 min-w-0 px-0"
                                        onClick={() => generateAssetImage('prop', prop)}
                                        title="AI生成图片"
                                      >
                                        <ImageIcon className="size-4" />
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-10 min-w-0 px-0"
                                        onClick={() => {
                                          const input = document.createElement('input');
                                          input.type = 'file';
                                          input.accept = 'image/*';
                                          input.onchange = (e) => {
                                            const file = (e.target as HTMLInputElement).files?.[0];
                                            if (file) uploadCustomImage('prop', prop, file);
                                          };
                                          input.click();
                                        }}
                                        title="上传本地图片"
                                      >
                                        <ImagePlus className="size-4" />
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-10 min-w-0 px-0"
                                        onClick={() => openImageLibrary('prop', prop.id, prop.name)}
                                        title="从图片库选择"
                                      >
                                        <FolderOpen className="size-4" />
                                      </Button>
                                    </div>
                                  )}
                                </div>
                                {images.length > 0 && (
                                  <p className="text-xs text-gray-500">{images.length}/{MAX_IMAGES_PER_ASSET} 张</p>
                                )}
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                  <span className="min-w-0 break-words font-medium text-sm">{prop.name}</span>
                                  <Badge variant="outline" className="text-xs">{prop.type}</Badge>
                                  {prop.importance && (
                                    <Badge className="text-xs">{prop.importance}</Badge>
                                  )}
                                </div>
                                {prop.description && (
                                  <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">{prop.description}</p>
                                )}
                                {prop.function && (
                                  <p className="text-xs text-gray-500">功能：{prop.function}</p>
                                )}
                                {prop.owner && (
                                  <p className="text-xs text-gray-500">归属：{prop.owner}</p>
                                )}
                                {prop.appearanceScenes && prop.appearanceScenes.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {prop.appearanceScenes.slice(0, 2).map((scene: string, i: number) => (
                                      <Badge key={`prop-${prop.id}-scene-${i}`} variant="secondary" className="text-xs">{scene}</Badge>
                                    ))}
                                    {prop.appearanceScenes.length > 2 && (
                                      <span className="text-xs text-gray-400">+{prop.appearanceScenes.length - 2}</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          });
                          })()}
                        </div>
                        <div className="text-center mt-2">
                          <Button variant="ghost" size="sm" className="text-xs text-gray-500" onClick={() => toggleSection('props')}>
                            {expandedSections.props ? '收起' : '展开全部'} {propBatchInfo?.propMarkers?.length || propsData?.totalProps || 0} 个道具
                            <ChevronDown className={`w-3 h-3 ml-1 transition-transform ${expandedSections.props ? 'rotate-180' : ''}`} />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Empty State */}
                  {!scenesData && !charactersData && !propsData && (
                    <Card>
                      <CardContent className="flex items-center justify-center h-64">
                        <div className="text-center text-gray-500">
                          <Sparkles className="w-16 h-16 mx-auto mb-4 opacity-50" />
                          <p>上传文件后将自动提取场景、人物、道具、大纲</p>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </TabsContent>

              {/* Storyboard Tab */}
              <TabsContent value="storyboard">
                {/* 一键生成所有文字分镜按钮 */}
                {stepConfirmed.extraction && outline && (
                  <div className="space-y-3 mb-4">
                    {/* 生成任务进度显示 */}
                    {generationTasks.filter(t => t.type === 'storyboard').slice(-8).length > 0 && (
                      <div className="space-y-2">
                        {generationTasks.filter(t => t.type === 'storyboard').slice(-8).map(task => (
                          <div 
                            key={task.taskId}
                            className={`p-3 rounded-lg text-sm ${
                              task.status === 'generating' ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800' :
                              task.status === 'success' ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800' :
                              task.status === 'error' ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800' :
                              'bg-gray-50 dark:bg-gray-800'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {task.status === 'generating' && <Loader2 className="w-4 h-4 animate-spin text-blue-500" />}
                                {task.status === 'success' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                                {task.status === 'error' && <AlertCircle className="w-4 h-4 text-red-500" />}
                                <span className="font-medium">第 {task.chapterNumber} 章</span>
                              </div>
                              <Badge variant={task.status === 'success' ? 'default' : task.status === 'error' ? 'destructive' : 'secondary'}>
                                {task.status === 'generating' ? '生成中' : task.status === 'success' ? '完成' : task.status === 'error' ? '失败' : '等待中'}
                              </Badge>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">{task.message}</p>
                            {task.status === 'error' && task.error && (
                              <div className="mt-2 p-2 bg-red-100 dark:bg-red-900/30 rounded text-xs text-red-700 dark:text-red-400">
                                <strong>错误详情：</strong>{task.error}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    
                    <Button 
                      className="w-full" 
                      onClick={generateAllStoryboards}
                      disabled={isProcessing}
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          正在生成文字分镜...
                        </>
                      ) : batchInfo.active ? (
                        <>
                          <ArrowRightCircle className="w-4 h-4 mr-2" />
                          继续生成第 {batchInfo.completedBatches + 1}/{batchInfo.totalBatches} 批（第 {batchInfo.completedBatches * batchInfo.batchSize + 1}-{Math.min((batchInfo.completedBatches + 1) * batchInfo.batchSize, outline?.chapters?.length || 0)} 章）
                        </>
                      ) : (
                        <>
                          <Film className="w-4 h-4 mr-2" />
                          {(() => {
                            const totalChapters = outline?.chapters?.length || 0;
                            const successCount = Object.values(chapterStoryboards).filter(cs => cs.status === 'success' && !!cs.storyboard?.shots?.length).length;
                            if (successCount > 0 && successCount < totalChapters) {
                              return `继续生成未完成章节文字分镜（已完成 ${successCount}/${totalChapters}）`;
                            }
                            if (successCount >= totalChapters && totalChapters > 0) {
                              return '全部章节文字分镜已生成';
                            }
                            return '一键生成所有章节文字分镜';
                          })()}
                        </>
                      )}
                    </Button>
                    {isProcessing && (
                      <Button
                        className="w-full"
                        variant="outline"
                        onClick={stopStoryboardGeneration}
                      >
                        <X className="w-4 h-4 mr-2" />
                        停止生成并解锁按钮
                      </Button>
                    )}
                    
                    {/* 显示已生成的章节分镜状态 */}
                    {Object.keys(chapterStoryboards).length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">已生成的文字分镜：</p>
                        {Object.values(chapterStoryboards).map(cs => (
                          <div 
                            key={`storyboard-status-${cs.chapterNumber}`}
                            className={`flex items-center justify-between p-2 rounded ${
                              cs.status === 'error' 
                                ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800' 
                                : 'bg-gray-50 dark:bg-gray-800'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {cs.status === 'success' ? (
                                <CheckCircle2 className="w-4 h-4 text-green-500" />
                              ) : cs.status === 'error' ? (
                                <AlertCircle className="w-4 h-4 text-red-500" />
                              ) : cs.status === 'generating' ? (
                                <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                              ) : (
                                <Circle className="w-4 h-4 text-gray-400" />
                              )}
                              <span className="text-sm">第 {cs.chapterNumber} 章：{cs.chapterTitle}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {cs.storyboard && (
                                <Badge variant="secondary" className="text-xs">
                                  {cs.storyboard.shots.length} 个分镜
                                </Badge>
                              )}
                              {cs.status === 'error' && (
                                <Badge variant="destructive" className="text-xs">
                                  失败
                                </Badge>
                              )}
                              {/* 刷新按钮 - 成功或失败时都显示 */}
                              {(cs.status === 'success' || cs.status === 'error') && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0"
                                  onClick={() => regenerateSingleStoryboard(cs.chapterNumber)}
                                  disabled={isProcessing}
                                  title={cs.status === 'error' ? '重新生成' : '刷新'}
                                >
                                  <RefreshCw className="w-3 h-3" />
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {Object.values(chapterStoryboards).some(cs => (cs.storyboard && cs.storyboard.shots.length > 0) || cs.status === 'error') ? (
                  <div className="space-y-4">
                    {Object.values(chapterStoryboards)
                      .filter(cs => (cs.storyboard && cs.storyboard.shots.length > 0) || cs.status === 'error')
                      .sort((a, b) => a.chapterNumber - b.chapterNumber)
                      .map((cs) => {
                        const isStoryboardChapterCollapsed = collapsedStoryboardChapters[String(cs.chapterNumber)] ?? true;

                        return (
                      <Card key={`storyboard-card-${cs.chapterNumber}`}>
                        <CardHeader>
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <CardTitle>第 {cs.chapterNumber} 章：{cs.chapterTitle}</CardTitle>
                              <CardDescription>
                                已生成 {cs.storyboard?.shots.length || 0} 个分镜
                              </CardDescription>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                              {cs.status === 'generating' && (
                                <Badge variant="outline" className="text-blue-500">
                                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                  生成中...
                                </Badge>
                              )}
                              {cs.status === 'success' && (
                                <Badge variant="default" className="bg-green-500">
                                  <CheckCircle2 className="w-3 h-3 mr-1" />
                                  已完成
                                </Badge>
                              )}
                              {cs.status === 'error' && (
                                <Badge variant="destructive">
                                  <AlertCircle className="w-3 h-3 mr-1" />
                                  失败
                                </Badge>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => toggleStoryboardChapterCollapsed(cs.chapterNumber)}
                              >
                                <ChevronDown className={`w-4 h-4 mr-1 transition-transform ${isStoryboardChapterCollapsed ? '' : 'rotate-180'}`} />
                                {isStoryboardChapterCollapsed ? '展开' : '收起'}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => regenerateSingleStoryboard(cs.chapterNumber)}
                                disabled={isProcessing || cs.status === 'generating'}
                              >
                                <RefreshCw className={`w-4 h-4 mr-1 ${cs.status === 'generating' ? 'animate-spin' : ''}`} />
                                刷新
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-4">
                            {isStoryboardChapterCollapsed ? (
                              <div className="flex flex-col gap-3 rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <div className="font-medium text-gray-900 dark:text-gray-100">
                                    第 {cs.chapterNumber} 章文字分镜已收起
                                  </div>
                                  <div className="text-xs">
                                    共 {cs.storyboard?.shots.length || 0} 个镜头，可随时展开查看或继续修改。
                                  </div>
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => toggleStoryboardChapterCollapsed(cs.chapterNumber)}
                                  className="self-start sm:self-auto"
                                >
                                  <ChevronDown className="w-4 h-4 mr-1" />
                                  展开查看
                                </Button>
                              </div>
                            ) : (
                              <>
                            {/* 文字分镜内容 */}
                            <div className="max-h-[400px] overflow-y-auto space-y-4">
                              {cs.status === 'error' ? (
                                <div className="text-center py-8 px-4">
                                  <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                                    <AlertCircle className="w-6 h-6 text-red-500" />
                                  </div>
                                  <h4 className="text-base font-semibold text-red-600 dark:text-red-400 mb-1">
                                    第 {cs.chapterNumber} 章分镜生成失败
                                  </h4>
                                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                                    请检查网络连接后点击下方按钮重新生成
                                  </p>
                                  {cs.error && (
                                    <div className="mb-4 p-2 bg-red-50 dark:bg-red-900/10 rounded text-xs text-red-600 dark:text-red-400 max-w-md mx-auto">
                                      错误详情：{cs.error}
                                    </div>
                                  )}
                                  <Button
                                    variant="outline"
                                    onClick={() => regenerateSingleStoryboard(cs.chapterNumber)}
                                    disabled={isProcessing}
                                  >
                                    <RefreshCw className={`w-4 h-4 mr-2 ${isProcessing ? 'animate-spin' : ''}`} />
                                    重新生成
                                  </Button>
                                </div>
                              ) : cs.storyboard?.shots.map((shot) => (
                                <div
                                  key={`shot-${cs.chapterNumber}-${shot.shotNumber}`}
                                  className="p-4 border rounded-lg space-y-3"
                                >
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Badge>镜头 {shot.shotNumber}</Badge>
                                    <Badge variant="outline">{shot.shotType}</Badge>
                                    {shot.shotPurpose && (
                                      <Badge variant="secondary">{shot.shotPurpose}</Badge>
                                    )}
                                    {shot.cameraAngle && (
                                      <Badge variant="outline">{shot.cameraAngle}</Badge>
                                    )}
                                    {shot.duration && (
                                      <Badge variant="secondary">{shot.duration}</Badge>
                                    )}
                                    {shot.emotionalBeat && (
                                      <Badge variant="destructive">{shot.emotionalBeat}</Badge>
                                    )}
                                  </div>
                                  
                                  <p className="text-sm">{shot.description}</p>

                                  {(shot.actorBlocking || shot.actionChange || shot.continuity) && (
                                    <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1 bg-blue-50 dark:bg-blue-900/10 p-3 rounded">
                                      {shot.actorBlocking && (
                                        <div><span className="font-medium">人物站位：</span>{shot.actorBlocking}</div>
                                      )}
                                      {shot.actionChange && (
                                        <div><span className="font-medium">动作变化：</span>{shot.actionChange}</div>
                                      )}
                                      {shot.continuity && (
                                        <div><span className="font-medium">连续性：</span>{shot.continuity}</div>
                                      )}
                                    </div>
                                  )}
                                  
                                  {shot.characters && shot.characters.length > 0 && (
                                    <div className="space-y-2 bg-gray-50 dark:bg-gray-800 p-3 rounded">
                                      {shot.characters.map((char, i) => (
                                        <div key={`shot-${cs.chapterNumber}-${shot.shotNumber}-char-${i}`} className="space-y-1">
                                          <div className="font-medium text-sm text-purple-600 dark:text-purple-400">
                                            {char.name}
                                          </div>

                                          {char.position && (
                                            <div className="text-sm pl-3 text-gray-600 dark:text-gray-400">
                                              <span className="text-gray-500 text-xs">站位：</span>
                                              {char.position}
                                            </div>
                                          )}
                                          
                                          {char.dialogue && (
                                            <div className="text-sm pl-3 border-l-2 border-purple-300">
                                              <span className="text-gray-500 text-xs">
                                                {char.dialogueType || '台词'}：
                                              </span>
                                              <span className="italic">"{char.dialogue}"</span>
                                            </div>
                                          )}
                                          
                                          {char.reaction && (
                                            <div className="text-sm pl-3 text-gray-600 dark:text-gray-400">
                                              <span className="text-gray-500 text-xs">反应：</span>
                                              {char.reaction}
                                            </div>
                                          )}
                                          
                                          {char.performance && (
                                            <div className="text-sm pl-3 text-gray-600 dark:text-gray-400">
                                              <span className="text-gray-500 text-xs">表演：</span>
                                              {char.performance}
                                            </div>
                                          )}
                                          
                                          {(char.action || char.expression || char.facialAction) && (
                                            <div className="text-sm pl-3 text-gray-600 dark:text-gray-400">
                                              {char.action && <span>动作：{char.action}</span>}
                                              {char.expression && <span className="ml-2">表情：{char.expression}</span>}
                                              {char.facialAction && <span className="ml-2">脸部：{char.facialAction}</span>}
                                            </div>
                                          )}
                                          
                                          {char.gesture && (
                                            <div className="text-sm pl-3 text-gray-600 dark:text-gray-400">
                                              <span className="text-gray-500 text-xs">手势：</span>
                                              {char.gesture}
                                            </div>
                                          )}

                                          {char.actionChange && (
                                            <div className="text-sm pl-3 text-gray-600 dark:text-gray-400">
                                              <span className="text-gray-500 text-xs">动作变化：</span>
                                              {char.actionChange}
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  
                                  {shot.scene && (
                                    <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                                      <div>
                                        <span className="font-medium">场景：</span>
                                        {shot.scene.location} | {shot.scene.time} | {shot.scene.atmosphere}
                                        {shot.scene.lighting && ` | ${shot.scene.lighting}`}
                                      </div>
                                      {shot.scene.props && shot.scene.props.length > 0 && (
                                        <div>
                                          <span className="font-medium">道具：</span>
                                          {shot.scene.props.join('、')}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  
                                  {shot.cameraMovement && (
                                    <div className="text-sm text-gray-600 dark:text-gray-400">
                                      <span className="font-medium">镜头运动：</span>
                                      {shot.cameraMovement}
                                    </div>
                                  )}
                                  
                                  {shot.notes && (
                                    <div className="text-xs text-gray-500 italic">
                                      备注：{shot.notes}
                                    </div>
                                  )}

                                  {/* Skill 5 影视级字段展示 */}
                                  {(shot.focalLength || shot.aperture || shot.cameraPosition || shot.composition || shot.actionAndDialogue) && (
                                    <div className="border-t pt-2 mt-2">
                                      <div className="text-xs font-semibold text-gray-400 mb-1">🎬 影视级分镜参数</div>
                                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
                                        {shot.focalLength && (
                                          <div><span className="font-medium">焦段：</span>{shot.focalLength}</div>
                                        )}
                                        {shot.aperture && (
                                          <div><span className="font-medium">光圈：</span>{shot.aperture}</div>
                                        )}
                                        {shot.cameraPosition && (
                                          <div className="col-span-2"><span className="font-medium">机位：</span>{shot.cameraPosition}</div>
                                        )}
                                        {shot.composition && (
                                          <div className="col-span-2"><span className="font-medium">构图：</span>{shot.composition}</div>
                                        )}
                                        {shot.actionAndDialogue && (
                                          <div className="col-span-2"><span className="font-medium">动作/台词：</span>{shot.actionAndDialogue}</div>
                                        )}
                                        {shot.restrictions && (
                                          <div className="col-span-2 text-amber-600"><span className="font-medium">限制：</span>{shot.restrictions}</div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>

                            {/* 分步确认流程 */}
                            {cs.status === 'success' && (
                              <div className="border-t pt-4 space-y-4">
                                {/* 步骤1: 确认文字分镜 */}
                                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${cs.storyboardConfirmed ? 'bg-green-500' : 'bg-blue-500'} text-white`}>
                                        {cs.storyboardConfirmed ? <CheckCircle2 className="w-3 h-3" /> : '1'}
                                      </div>
                                      <span className="text-sm font-medium">文字分镜</span>
                                    </div>
                                    {!cs.storyboardConfirmed ? (
                                      <Button
                                        size="sm"
                                        onClick={() => confirmChapterStoryboard(cs.chapterNumber)}
                                      >
                                        <CheckCircle2 className="w-4 h-4 mr-1" />
                                        确认文字分镜
                                      </Button>
                                    ) : (
                                      <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                                        <CheckCircle2 className="w-4 h-4" />
                                        <span className="text-sm">文字分镜已确认</span>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* 提示：确认后前往素材确认Tab */}
                                {cs.storyboardConfirmed && (
                                  <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                                        <CheckCircle2 className="w-4 h-4" />
                                        <span className="text-sm">文字分镜已确认</span>
                                      </div>
                                      <span className="text-xs text-gray-500">请前往"素材确认"标签页继续下一步</span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                              </>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                        );
                      })}
                    
                    {/* 移除全局确认按钮 - 每个章节单独确认 */}
                  </div>
                ) : (
                  <Card>
                    <CardContent className="flex items-center justify-center h-64">
                      <div className="text-center text-gray-500">
                        {!stepConfirmed.extraction ? (
                          <>
                            <BookOpen className="w-16 h-16 mx-auto mb-4 opacity-50" />
                            <p>请先在"提取结果"标签页确认大纲和章节选择</p>
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-4"
                              onClick={() => setActiveTab('extraction')}
                            >
                              前往提取结果
                            </Button>
                          </>
                        ) : (
                          <>
                            <Film className="w-16 h-16 mx-auto mb-4 opacity-50" />
                            <p>点击上方按钮生成文字分镜</p>
                          </>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Assets Confirmation Tab */}
              <TabsContent value="assets">
                {Object.values(chapterStoryboards).some(cs => cs.storyboardConfirmed) ? (
                  <div className="space-y-4">
                    {/* 返回按钮 */}
                    <div className="flex items-center justify-between">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          revertToStep('storyboard');
                          setActiveTab('storyboard');
                        }}
                      >
                        <Undo2 className="w-4 h-4 mr-1" />
                        返回文字分镜
                      </Button>
                      <span className="text-sm text-gray-500">
                        确认素材后可在提示词标签页查看和生成提示词
                      </span>
                    </div>
                    
                    {Object.values(chapterStoryboards)
                      .filter(cs => cs.storyboardConfirmed)
                      .sort((a, b) => a.chapterNumber - b.chapterNumber)
                      .map((cs) => (
                      <Card key={`assets-card-${cs.chapterNumber}`}>
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <div>
                              <CardTitle>第 {cs.chapterNumber} 章：{cs.chapterTitle}</CardTitle>
                              <CardDescription>
                                素材确认
                              </CardDescription>
                            </div>
                            <div className="flex items-center gap-2">
                              {cs.assetsConfirmed && (
                                <Badge variant="default" className="bg-green-500">
                                  <CheckCircle2 className="w-3 h-3 mr-1" />
                                  素材已确认
                                </Badge>
                              )}
                              {cs.imageStoryboards.length > 0 && (
                                <Badge variant="default" className="bg-orange-500">
                                  <ImageIcon className="w-3 h-3 mr-1" />
                                  已生成分镜图像
                                </Badge>
                              )}
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-4">
                            {/* 步骤1: 素材确认 */}
                            <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${cs.assetsConfirmed ? 'bg-green-500' : 'bg-purple-500'} text-white`}>
                                    {cs.assetsConfirmed ? <CheckCircle2 className="w-3 h-3" /> : '1'}
                                  </div>
                                  <span className="text-sm font-medium">素材确认（本章涉及的人物、场景、道具）</span>
                                </div>
                                {cs.assetsConfirmed && (
                                  <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                                    <CheckCircle2 className="w-4 h-4" />
                                    <span className="text-sm">素材已确认</span>
                                  </div>
                                )}
                              </div>

                              {!cs.assetsConfirmed && (() => {
                                const assets = getChapterRelatedAssets(cs.chapterNumber);
                                const hasAnyAssets = assets.characters.length > 0 || assets.scenes.length > 0 || assets.props.length > 0;
                                
                                return (
                                  <div className="space-y-3 pl-8">
                                    {!hasAnyAssets && (
                                      <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm text-gray-500">
                                        <p>暂未找到本章涉及的素材信息。</p>
                                        <p className="text-xs mt-1">请确保已完成"并行提取"步骤，且分镜中包含人物、场景或道具信息。</p>
                                      </div>
                                    )}
                                    
                                    {/* 人物 */}
                                    {assets.characters.length > 0 && (
                                      <div className="space-y-2">
                                        <h5 className="text-xs font-medium text-gray-500 flex items-center gap-1">
                                          <Users className="w-3 h-3" />
                                          人物 ({assets.characters.length})
                                        </h5>
                                        <div className="grid grid-cols-1 gap-2">
                                          {assets.characters.map((char: any) => {
                                            const assetData = getAssetImages('character', char.id);
                                            const images = assetData?.images || [];
                                            const currentAssetId = assetData?.assetId || `character-${char.id}`;
                                            
                                            return (
                                              <div key={`character-${char.id}`} className="p-2 border rounded">
                                                <div className="flex items-center justify-between mb-1">
                                                  <div>
                                                    <span className="font-medium text-sm">{char.name}</span>
                                                    <span className="text-xs text-gray-500 ml-2">{char.role || '角色'}</span>
                                                  </div>
                                                  <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-6 px-2"
                                                    onClick={() => openImageLibrary('character', char.id, char.name)}
                                                  >
                                                    <FolderOpen className="w-3 h-3 mr-1" />
                                                    选图
                                                  </Button>
                                                </div>
                                                <div className="flex gap-1 flex-wrap">
                                                  {images.length > 0 ? (
                                                    images.map((img: any, idx: number) => (
                                                      img.imageUrl ? (
                                                        <div key={`img-${img.imageId}-${idx}`} className="relative group">
                                                          <img 
                                                            src={img.imageUrl} 
                                                            className="w-10 h-10 object-cover rounded cursor-pointer hover:opacity-80" 
                                                            onClick={() => openImagePreview(img.imageUrl, char.name, 'character')}
                                                          />
                                                          <div className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <Button
                                                              size="icon"
                                                              variant="destructive"
                                                              className="h-4 w-4"
                                                              onClick={() => removeSelectedImage(currentAssetId, img.imageId)}
                                                            >
                                                              <Trash2 className="w-2 h-2" />
                                                            </Button>
                                                          </div>
                                                        </div>
                                                      ) : null
                                                    ))
                                                  ) : (
                                                    <span className="text-orange-500 text-xs">待选择图片</span>
                                                  )}
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}

                                    {/* 场景 */}
                                    {assets.scenes.length > 0 && (
                                      <div className="space-y-2">
                                        <h5 className="text-xs font-medium text-gray-500 flex items-center gap-1">
                                          <MapPin className="w-3 h-3" />
                                          场景 ({assets.scenes.length})
                                        </h5>
                                        <div className="grid grid-cols-1 gap-2">
                                          {assets.scenes.map((scene: any) => {
                                            const assetData = getAssetImages('scene', scene.id);
                                            const images = assetData?.images || [];
                                            const currentAssetId = assetData?.assetId || `scene-${scene.id}`;
                                            
                                            return (
                                              <div key={`scene-${scene.id}`} className="p-2 border rounded">
                                                <div className="flex items-center justify-between mb-1">
                                                  <span className="font-medium text-sm">{scene.name}</span>
                                                  <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-6 px-2"
                                                    onClick={() => openImageLibrary('scene', scene.id, scene.name)}
                                                  >
                                                    <FolderOpen className="w-3 h-3 mr-1" />
                                                    选图
                                                  </Button>
                                                </div>
                                                <div className="flex gap-1 flex-wrap">
                                                  {images.length > 0 ? (
                                                    images.map((img: any, idx: number) => (
                                                      img.imageUrl ? (
                                                        <div key={`scene-img-${img.imageId}-${idx}`} className="relative group">
                                                          <img 
                                                            src={img.imageUrl} 
                                                            className="w-10 h-10 object-cover rounded cursor-pointer hover:opacity-80" 
                                                            onClick={() => openImagePreview(img.imageUrl, scene.name, 'scene')}
                                                          />
                                                          <div className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <Button
                                                              size="icon"
                                                              variant="destructive"
                                                              className="h-4 w-4"
                                                              onClick={() => removeSelectedImage(currentAssetId, img.imageId)}
                                                            >
                                                              <Trash2 className="w-2 h-2" />
                                                            </Button>
                                                          </div>
                                                        </div>
                                                      ) : null
                                                    ))
                                                  ) : (
                                                    <span className="text-orange-500 text-xs">待选择图片</span>
                                                  )}
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}

                                    {/* 道具 */}
                                    {assets.props.length > 0 && (
                                      <div className="space-y-2">
                                        <h5 className="text-xs font-medium text-gray-500 flex items-center gap-1">
                                          <Package className="w-3 h-3" />
                                          道具 ({assets.props.length})
                                        </h5>
                                        <div className="grid grid-cols-2 gap-2">
                                          {assets.props.map((prop: any) => {
                                            const assetData = getAssetImages('prop', prop.id);
                                            const images = assetData?.images || [];
                                            const currentAssetId = assetData?.assetId || `prop-${prop.id}`;
                                            
                                            return (
                                              <div key={`prop-${prop.id}`} className="p-2 border rounded">
                                                <div className="flex items-center justify-between mb-1">
                                                  <span className="font-medium text-xs">{prop.name}</span>
                                                  <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-5 px-1"
                                                    onClick={() => openImageLibrary('prop', prop.id, prop.name)}
                                                  >
                                                    <FolderOpen className="w-2 h-2" />
                                                  </Button>
                                                </div>
                                                <div className="flex gap-1 flex-wrap">
                                                  {images.length > 0 ? (
                                                    images.map((img: any, idx: number) => (
                                                      img.imageUrl ? (
                                                        <div key={`prop-img-${img.imageId}-${idx}`} className="relative group">
                                                          <img 
                                                            src={img.imageUrl} 
                                                            className="w-8 h-8 object-cover rounded cursor-pointer hover:opacity-80" 
                                                            onClick={() => openImagePreview(img.imageUrl, prop.name, 'prop')}
                                                          />
                                                          <div className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <Button
                                                              size="icon"
                                                              variant="destructive"
                                                              className="h-4 w-4"
                                                              onClick={() => removeSelectedImage(currentAssetId, img.imageId)}
                                                            >
                                                              <Trash2 className="w-2 h-2" />
                                                            </Button>
                                                          </div>
                                                        </div>
                                                      ) : null
                                                    ))
                                                  ) : (
                                                    <span className="text-orange-500 text-[10px]">待选择</span>
                                                  )}
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}

                                    <div className="flex items-center justify-between pt-2">
                                      <span className="text-xs text-gray-500">点击"选图"从图片库选择，或去"素材管理"标签页生成图片</span>
                                      <Button
                                        size="sm"
                                        onClick={() => confirmChapterAssets(cs.chapterNumber)}
                                      >
                                        <CheckCircle2 className="w-4 h-4 mr-1" />
                                        确认素材
                                      </Button>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Card>
                    <CardContent className="flex items-center justify-center h-64">
                      <div className="text-center text-gray-500">
                        <Package className="w-16 h-16 mx-auto mb-4 opacity-50" />
                        <p>请先在"文字分镜"标签页确认文字分镜</p>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Prompts Tab */}
              <TabsContent value="prompts">
                {/* 分镜提示词设置模块 */}
                <Card className="mb-4">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Settings className="w-4 h-4" />
                      分镜提示词设置
                    </CardTitle>
                    <CardDescription>
                      设置故事版面板描述的画面比例、风格和光影效果（全局设置，应用于所有章节）
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {/* 画面比例多选 */}
                      <div>
                        <label className="text-xs font-medium text-gray-500 block mb-2">画面比例（横屏/竖屏单选）</label>
                        <div className="flex flex-wrap gap-2">
                          {[
                            { value: '16:9', label: '横屏 16:9' },
                            { value: '9:16', label: '竖屏 9:16' },
                            { value: '4:3', label: '标准 4:3' },
                            { value: '1:1', label: '方形 1:1' },
                          ].map(ratio => (
                            <Button
                              key={ratio.value}
                              size="sm"
                              variant={globalImageSettings.ratios.includes(ratio.value as any) ? 'default' : 'outline'}
                              onClick={() => {
                                const current = globalImageSettings.ratios;
                                const isVideoRatio = ratio.value === '16:9' || ratio.value === '9:16';
                                const newRatios = isVideoRatio
                                  ? [
                                      ratio.value as '16:9' | '9:16',
                                      ...current.filter(r => r !== '16:9' && r !== '9:16'),
                                    ]
                                  : current.includes(ratio.value as any)
                                    ? current.filter(r => r !== ratio.value)
                                    : [...current, ratio.value as any];
                                updateGlobalImageSettings({ ratios: newRatios });
                                if (isVideoRatio) {
                                  setVideoRatio(ratio.value as '16:9' | '9:16');
                                }
                              }}
                            >
                              {ratio.label}
                            </Button>
                          ))}
                        </div>
                      </div>

                      {/* 画面风格多选 */}
                      <div>
                        <label className="text-xs font-medium text-gray-500 block mb-2">画面风格（可多选）</label>
                        <div className="flex flex-wrap gap-2 max-h-[150px] overflow-y-auto">
                          {['写实', '超写实', '科幻', '文艺', '浪漫', '悬疑', '恐怖', '电影感', '超现实', '极简', '时尚', '复古', '梦幻', '胶片', '奇幻', '搞笑', '少女', '自拍', '街拍', '高定', '人像', '奢华', '广告', '黑白', '霓虹', '商业', '电影光', '性感', '皮克斯', '时尚大片', '赛博朋克', '高饱和', '低饱和', '高端', '实施', '俏皮', '美食', '摄影', '高对比', '动作', '战斗', '青春', '温馨治愈', '氛围感拉满', '慵懒松弛', '忧郁情绪', '神秘高级', '梦幻唯美', '干净通透', '暗黑压抑', '8K超清', '细腻皮肤', '柔和虚化', '高清细节', '颗粒质感', '色彩柔和', '真人实拍', '真人风格', '写实风格', '高清写实', '8K画质'].map(style => (
                            <Button
                              key={style}
                              size="sm"
                              variant={globalImageSettings.styles.includes(style as any) ? 'default' : 'outline'}
                              onClick={() => {
                                const current = globalImageSettings.styles;
                                const newStyles = current.includes(style as any)
                                  ? current.filter(s => s !== style)
                                  : [...current, style as any];
                                updateGlobalImageSettings({ styles: newStyles });
                              }}
                            >
                              {style}
                            </Button>
                          ))}
                        </div>
                      </div>

                      {/* 光影效果多选 */}
                      <div>
                        <label className="text-xs font-medium text-gray-500 block mb-2">光影效果（可多选）</label>
                        <div className="flex flex-wrap gap-2 max-h-[150px] overflow-y-auto">
                          {['自然光', '暖色调', '冷色调', '电影感', '戏剧光效', '弱冷光', '弱暖光', '强冷光', '强暖光', '窗边光', '逆光', '氛围感', '正面光', '侧面光', '轮廓光', '顶光', '底光', '伦勃朗光', '昏暗无光', '硬光', '远光', '柔光', '漫射光', '氛围感光影', '电影感光影', '黄金光', '丁达尔光', '光斑', '高对比光影', '低保和柔和光', '发丝光', '渐变光影'].map(light => (
                            <Button
                              key={light}
                              size="sm"
                              variant={globalImageSettings.lighting.includes(light as any) ? 'default' : 'outline'}
                              onClick={() => {
                                const current = globalImageSettings.lighting;
                                const newLighting = current.includes(light as any)
                                  ? current.filter(l => l !== light)
                                  : [...current, light as any];
                                updateGlobalImageSettings({ lighting: newLighting });
                              }}
                            >
                              {light}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* 故事版面板描述确认模块 */}
                {Object.values(chapterStoryboards).some(cs => cs.assetsConfirmed) ? (
                  <Card className="mb-4">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Video className="w-4 h-4" />
                        故事版面板描述确认
                      </CardTitle>
                      <CardDescription>
                        基于分镜数据和素材生成故事版面板描述，确认后可生成视频
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {Object.values(chapterStoryboards)
                        .filter(cs => cs.assetsConfirmed)
                        .sort((a, b) => a.chapterNumber - b.chapterNumber)
                        .map(cs => {
                          // 检查是否有分镜数据
                          const hasShots = cs.storyboard?.shots && cs.storyboard.shots.length > 0;
                          const isPromptChapterCollapsed = collapsedPromptChapters[String(cs.chapterNumber)] ?? true;
                          const hasExportablePrompts = (cs.videoPrompts?.length ?? 0) > 0 || (cs.promptGroups?.length ?? 0) > 0;
                          
                          return (
                            <div key={`prompts-section-${cs.chapterNumber}`} className="mb-4 last:mb-0">
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                  <Badge variant="secondary">第 {cs.chapterNumber} 章</Badge>
                                  <span className="text-sm font-medium">{cs.chapterTitle}</span>
                                  {cs.videoPrompts && cs.videoPrompts.length > 0 && (
                                    <span className="text-xs text-gray-500">({cs.videoPrompts.length} 个镜头)</span>
                                  )}
	                                </div>
	                                <div className="flex items-center gap-2">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => togglePromptChapterCollapsed(cs.chapterNumber)}
                                    >
                                      {isPromptChapterCollapsed ? (
                                        <ChevronRight className="w-4 h-4 mr-1" />
                                      ) : (
                                        <ChevronDown className="w-4 h-4 mr-1" />
                                      )}
                                      {isPromptChapterCollapsed ? '展开' : '收起'}
                                    </Button>
	                                  {hasExportablePrompts && (
	                                    <Button
	                                      size="sm"
	                                      variant="outline"
                                      disabled={exportingPromptChapter === cs.chapterNumber}
                                      onClick={() => handleExportChapterPrompts(cs)}
                                    >
                                      {exportingPromptChapter === cs.chapterNumber ? (
                                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                                      ) : (
                                        <Download className="w-4 h-4 mr-1" />
                                      )}
                                      导出本集提示词
                                    </Button>
                                  )}
                                  {cs.promptsConfirmed ? (
                                    <Badge className="bg-green-500">
                                      <CheckCircle2 className="w-3 h-3 mr-1" />
                                      已确认
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline">待确认</Badge>
                                  )}
                                </div>
                              </div>
                              
                              {/* 显示当前章节应用的分镜提示词设置 */}
                              <div className={`mb-3 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 ${isPromptChapterCollapsed ? 'hidden' : ''}`}>
                                <div className="flex items-center gap-2 text-xs">
                                  <Settings className="w-3 h-3 text-blue-500" />
                                  <span className="font-medium text-blue-700 dark:text-blue-400">应用设置：</span>
                                  <div className="flex flex-wrap gap-1">
                                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                      比例: {globalImageSettings.ratios.join(' / ')}
                                    </Badge>
                                    {globalImageSettings.styles.length > 0 && (
                                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                        风格: {globalImageSettings.styles.slice(0, 3).join('、')}{globalImageSettings.styles.length > 3 ? '...' : ''}
                                      </Badge>
                                    )}
                                    {globalImageSettings.lighting.length > 0 && (
                                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                        光影: {globalImageSettings.lighting.slice(0, 3).join('、')}{globalImageSettings.lighting.length > 3 ? '...' : ''}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              </div>
                              
                              {/* 检查是否有分镜数据 */}
                              {isPromptChapterCollapsed ? (
                                <div className="p-3 rounded-lg border bg-gray-50 text-sm text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                                  本集提示词已收起。
                                </div>
                              ) : !hasShots ? (
                                <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-center">
                                  <AlertTriangle className="w-5 h-5 mx-auto mb-2 text-yellow-500" />
                                  <p className="text-yellow-700 dark:text-yellow-400 text-sm mb-2">该章节没有分镜数据</p>
                                  <p className="text-xs text-yellow-600 dark:text-yellow-500">请先在"文字分镜"标签页重新生成分镜</p>
                                </div>
	                              ) : cs.videoPrompts && cs.videoPrompts.length > 0 ? (
	                            <>
	                              {/* 故事版面板描述分组展示区域 */}
	                              {(cs.promptGroups?.length ?? 0) > 0 && (
                                <div className="mb-4 space-y-3">
                                  <div className="flex items-center gap-2 mb-2">
                                    <Film className="w-4 h-4 text-purple-500" />
                                    <h4 className="text-sm font-semibold text-purple-700 dark:text-purple-400">
                                      故事板分组（{(cs.promptGroups?.length ?? 0)}组 · 每组4个镜头 · ~15秒连冠段落）
                                    </h4>
                                  </div>
                                  {(cs.promptGroups ?? []).map((pg, gi) => (
                                    <Card key={`pg-${cs.chapterNumber}-${pg.groupIndex}`} className="border-purple-200 dark:border-purple-800">
                                      <CardHeader className="pb-2">
                                        <div className="flex items-center justify-between">
                                          <div className="flex items-center gap-2">
                                            <span className="text-sm font-semibold">第{pg.groupIndex}组</span>
                                            <Badge variant="secondary" className="text-xs">
                                              镜头 {pg.shotNumbers.join('、')}
                                            </Badge>
                                            <Badge variant="outline" className="text-xs">
                                              {pg.shotNumbers.length * 4}秒连冠
                                            </Badge>
                                          </div>
                                          <div className="flex items-center gap-1">
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              disabled={pg.isGeneratingPrompt}
                                              onClick={async (e) => {
                                                e.stopPropagation();
                                                setChapterStoryboards(prev => ({
                                                  ...prev,
                                                  [cs.chapterNumber]: {
                                                    ...prev[cs.chapterNumber],
                                                    promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                      idx === gi ? { ...g, isGeneratingPrompt: true } : g
                                                    ),
                                                  }
                                                }));
                                                try {
                                                  const refImages = getGroupAssetImages(cs, pg);
                                                  const resp = await fetch('/api/generate-storyboard-prompt', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({
                                                      chapterTitle: cs.chapterTitle,
                                                      groupIndex: pg.groupIndex,
                                                      shots: pg.shotNumbers.map(sn => 
                                                        cs.storyboard?.shots.find(s => s.shotNumber === sn)
                                                      ).filter(Boolean),
                                                      referenceImages: refImages,
                                                      imageSettings: globalImageSettings,
                                                    }),
                                                  });
                                                  const data = await resp.json();
                                                  if (data.success && data.storyboardPrompt) {
                                                    setChapterStoryboards(prev => ({
                                                      ...prev,
                                                      [cs.chapterNumber]: {
                                                        ...prev[cs.chapterNumber],
                                                        promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                          idx === gi ? { ...g, storyboardPromptText: data.storyboardPrompt, isGeneratingPrompt: false } : g
                                                        ),
                                                      }
                                                    }));
                                                  } else {
                                                    throw new Error(data.error || '生成失败');
                                                  }
                                                } catch (err: any) {
                                                  console.error('刷新提示词失败:', err);
                                                  toast.error(err.message || '刷新提示词失败');
                                                  setChapterStoryboards(prev => ({
                                                    ...prev,
                                                    [cs.chapterNumber]: {
                                                      ...prev[cs.chapterNumber],
                                                      promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                        idx === gi ? { ...g, isGeneratingPrompt: false } : g
                                                      ),
                                                    }
                                                  }));
                                                }
                                              }}
                                            >
                                              <RotateCcw className={`w-3 h-3 ${pg.isGeneratingPrompt ? 'animate-spin' : ''}`} />
                                            </Button>
                                          </div>
                                        </div>
                                      </CardHeader>
                                      <CardContent className="pb-2">
                                        {/* 合并提示词 */}
                                        <div className="mb-3">
                                          <label className="block text-xs font-medium text-gray-500 mb-1">连冠故事版面板描述</label>
                                          <Textarea
                                            value={pg.combinedPrompt}
                                            onChange={(e) => {
                                              setChapterStoryboards(prev => ({
                                                ...prev,
                                                [cs.chapterNumber]: {
                                                  ...prev[cs.chapterNumber],
                                                  promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                    idx === gi ? { ...g, combinedPrompt: e.target.value } : g
                                                  ),
                                                }
                                              }));
                                            }}
                                            className="min-h-[80px] text-xs"
                                          />
                                        </div>
                                        
                                        {/* 故事板总控图出图入口在独立「故事板」标签页，这里只保留提示词正文。 */}
                                        {false && (
                                        <div className="mb-2">
                                          <label className="block text-xs font-medium text-gray-500 mb-1">故事板总控图</label>
                                          {pg.storyboardImageUrl ? (
                                            <>
                                            <div className="relative group">
                                              <img
                                                src={pg.storyboardImageUrl}
                                                alt={`故事板第${pg.groupIndex}组`}
                                                className="w-full rounded-lg border shadow-sm max-h-[300px] object-cover"
                                              />
                                              <Button
                                                size="sm"
                                                variant="secondary"
                                                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                                                onClick={async () => {
                                                  setChapterStoryboards(prev => ({
                                                    ...prev,
                                                    [cs.chapterNumber]: {
                                                      ...prev[cs.chapterNumber],
                                                      promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                        idx === gi ? { ...g, isGeneratingStoryboard: true, storyboardStatus: '正在提交到 AI 绘图服务...' } : g
                                                      ),
                                                    }
                                                  }));
                                                  await new Promise(r => setTimeout(r, 50));
                                                  setChapterStoryboards(prev => ({
                                                    ...prev,
                                                    [cs.chapterNumber]: {
                                                      ...prev[cs.chapterNumber],
                                                      promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                        idx === gi ? { ...g, storyboardStatus: '正在快速生成预览图（通常20~90秒）...' } : g
                                                      ),
                                                    }
                                                  }));
                                                  try {
                                                    const refImages = getGroupAssetImages(cs, pg);
                                                    const resp = await fetch('/api/generate-storyboard-image', {
                                                      method: 'POST',
                                                      headers: { 'Content-Type': 'application/json' },
                                                      body: JSON.stringify({
                                                        chapterTitle: cs.chapterTitle,
                                                        groupIndex: pg.groupIndex,
                                                        shots: pg.shotNumbers.map(sn => 
                                                          cs.storyboard?.shots.find(s => s.shotNumber === sn)
                                                        ).filter(Boolean),
                                                        referenceImages: refImages,
                                                        imageSettings: globalImageSettings,
                                                        customPrompt: pg.storyboardPromptText,
                                                      }),
                                                    });
                                                    const data = await resp.json();
                                                    if (data.success && data.imageUrl) {
                                                      setChapterStoryboards(prev => ({
                                                        ...prev,
                                                        [cs.chapterNumber]: {
                                                          ...prev[cs.chapterNumber],
                                                          promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                            idx === gi ? { ...g, storyboardImageUrl: data.imageUrl, storyboardImageKey: data.imageKey, isGeneratingStoryboard: false, storyboardStatus: '' } : g
                                                          ),
                                                        }
                                                      }));
                                                      toast.success(`第${pg.groupIndex}组故事板生成成功`);
                                                    } else {
                                                      throw new Error(data.error || '生成失败');
                                                    }
                                                  } catch (err: any) {
                                                    console.error('生成故事板失败:', err);
                                                    toast.error(err.message || '生成故事板失败');
                                                    setChapterStoryboards(prev => ({
                                                      ...prev,
                                                      [cs.chapterNumber]: {
                                                        ...prev[cs.chapterNumber],
                                                        promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                          idx === gi ? { ...g, isGeneratingStoryboard: false, storyboardStatus: '' } : g
                                                        ),
                                                      }
                                                    }));
                                                  }
                                                }}
                                              >
                                                <RotateCcw className="w-3 h-3 mr-1" />
                                                重新生成
	                                        </Button>
	                                      </div>
	                                      <div className="mt-2 rounded-lg border bg-gray-50 p-2 dark:bg-gray-900">
	                                        <div className="flex items-center justify-between gap-2">
	                                          <div className="min-w-0">
	                                            <p className="text-xs font-medium text-gray-600 dark:text-gray-300">
	                                              图片生成位置：当前应用端口
	                                            </p>
	                                            <code className="block truncate text-[11px] text-gray-500 dark:text-gray-400">
	                                              {getDisplayImageUrl(pg.storyboardImageUrl)}
	                                            </code>
	                                          </div>
	                                          <div className="flex shrink-0 gap-1">
	                                            <Button
	                                              size="sm"
	                                              variant="outline"
	                                              onClick={() => {
	                                                navigator.clipboard.writeText(getDisplayImageUrl(pg.storyboardImageUrl));
	                                                toast.success('已复制图片地址');
	                                              }}
	                                            >
	                                              <Copy className="w-3 h-3 mr-1" />
	                                              复制地址
	                                            </Button>
	                                            <Button size="sm" variant="outline" asChild>
	                                              <a href={getDisplayImageUrl(pg.storyboardImageUrl)} target="_blank" rel="noreferrer">
	                                                <Eye className="w-3 h-3 mr-1" />
	                                                打开图片
	                                              </a>
	                                            </Button>
	                                          </div>
	                                        </div>
	                                      </div>
	                                      {pg.storyboardPromptText && (
	                                        <details className="mt-2">
                                                <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">查看使用的提示词</summary>
                                                <textarea
                                                  className="w-full mt-1 min-h-[80px] text-xs p-2 border rounded bg-gray-50 dark:bg-gray-800 font-mono text-gray-600 cursor-default"
                                                  value={pg.storyboardPromptText}
                                                  readOnly
                                                  onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                                                />
                                              </details>
                                            )}
                                            </>
                                          ) : pg.storyboardPromptText && !pg.storyboardPromptConfirmed ? (
                                            <div className="space-y-2 border border-purple-200 dark:border-purple-800 rounded-lg p-2 bg-purple-50/30 dark:bg-purple-950/20">
                                              <label className="block text-xs font-medium text-purple-600 dark:text-purple-400">故事版专用提示词（确认后出图）</label>
                                              <textarea
                                                className="w-full min-h-[120px] text-xs p-2 border rounded bg-white dark:bg-gray-900 font-mono"
                                                value={pg.storyboardPromptText}
                                                onChange={(e) => {
                                                  setChapterStoryboards(prev => ({
                                                    ...prev,
                                                    [cs.chapterNumber]: {
                                                      ...prev[cs.chapterNumber],
                                                      promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                        idx === gi ? { ...g, storyboardPromptText: e.target.value } : g
                                                      ),
                                                    }
                                                  }));
                                                }}
                                              />
                                              <div className="flex gap-2">
                                                <Button
                                                  size="sm"
                                                  disabled={pg.isGeneratingStoryboard}
                                                  onClick={async () => {
                                                    setChapterStoryboards(prev => ({
                                                      ...prev,
                                                      [cs.chapterNumber]: {
                                                        ...prev[cs.chapterNumber],
                                                        promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                          idx === gi ? { ...g, isGeneratingStoryboard: true, storyboardPromptConfirmed: true, storyboardStatus: '正在提交到 AI 绘图服务...' } : g
                                                        ),
                                                      }
                                                    }));
                                                    // 等一帧渲染后更新进度
                                                    await new Promise(r => setTimeout(r, 50));
                                                    setChapterStoryboards(prev => ({
                                                      ...prev,
                                                      [cs.chapterNumber]: {
                                                        ...prev[cs.chapterNumber],
                                                        promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                          idx === gi ? { ...g, storyboardStatus: '正在快速生成预览图（通常20~90秒）...' } : g
                                                        ),
                                                      }
                                                    }));
                                                    try {
                                                      const refImages = getGroupAssetImages(cs, pg);
                                                      const resp = await fetch('/api/generate-storyboard-image', {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({
                                                          chapterTitle: cs.chapterTitle,
                                                          groupIndex: pg.groupIndex,
                                                          shots: pg.shotNumbers.map(sn => 
                                                            cs.storyboard?.shots.find(s => s.shotNumber === sn)
                                                          ).filter(Boolean),
                                                          referenceImages: refImages,
                                                          imageSettings: globalImageSettings,
                                                          customPrompt: pg.storyboardPromptText,
                                                        }),
                                                      });
                                                      const data = await resp.json();
                                                      if (data.success && data.imageUrl) {
                                                        setChapterStoryboards(prev => ({
                                                          ...prev,
                                                          [cs.chapterNumber]: {
                                                            ...prev[cs.chapterNumber],
                                                            promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                              idx === gi ? { ...g, storyboardImageUrl: data.imageUrl, storyboardImageKey: data.imageKey, isGeneratingStoryboard: false, storyboardStatus: '' } : g
                                                            ),
                                                          }
                                                        }));
                                                        toast.success('第' + pg.groupIndex + '组故事板总控图生成成功');
                                                      } else {
                                                        throw new Error(data.error || '生成失败');
                                                      }
                                                    } catch (err: any) {
                                                      console.error('生成故事板失败:', err);
                                                      toast.error(err.message || '生成故事板失败');
                                                      setChapterStoryboards(prev => ({
                                                        ...prev,
                                                        [cs.chapterNumber]: {
                                                          ...prev[cs.chapterNumber],
                                                          promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                            idx === gi ? { ...g, isGeneratingStoryboard: false, storyboardPromptConfirmed: false, storyboardStatus: '' } : g
                                                          ),
                                                        }
                                                      }));
                                                    }
                                                  }}
                                                >
                                                  {pg.isGeneratingStoryboard ? (
                                                    <><Loader2 className="w-3 h-3 mr-1 animate-spin" />生成中...</>
                                                  ) : (
                                                    <><Check className="w-3 h-3 mr-1" />确认出图</>
                                                  )}
                                                </Button>
                                                <Button
                                                  size="sm"
                                                  variant="outline"
                                                  disabled={pg.isGeneratingPrompt}
                                                  onClick={async () => {
                                                    setChapterStoryboards(prev => ({
                                                      ...prev,
                                                      [cs.chapterNumber]: {
                                                        ...prev[cs.chapterNumber],
                                                        promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                          idx === gi ? { ...g, isGeneratingPrompt: true } : g
                                                        ),
                                                      }
                                                    }));
                                                    try {
                                                      const refImages = getGroupAssetImages(cs, pg);
                                                      const resp = await fetch('/api/generate-storyboard-prompt', {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({
                                                          chapterTitle: cs.chapterTitle,
                                                          groupIndex: pg.groupIndex,
                                                          shots: pg.shotNumbers.map(sn => 
                                                            cs.storyboard?.shots.find(s => s.shotNumber === sn)
                                                          ).filter(Boolean),
                                                          referenceImages: refImages,
                                                          imageSettings: globalImageSettings,
                                                        }),
                                                      });
                                                      const data = await resp.json();
                                                      if (data.success && data.storyboardPrompt) {
                                                        setChapterStoryboards(prev => ({
                                                          ...prev,
                                                          [cs.chapterNumber]: {
                                                            ...prev[cs.chapterNumber],
                                                            promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                              idx === gi ? { ...g, storyboardPromptText: data.storyboardPrompt, isGeneratingPrompt: false } : g
                                                            ),
                                                          }
                                                        }));
                                                      } else {
                                                        throw new Error(data.error || '生成失败');
                                                      }
                                                    } catch (err: any) {
                                                      console.error('生成提示词失败:', err);
                                                      toast.error(err.message || '生成提示词失败');
                                                      setChapterStoryboards(prev => ({
                                                        ...prev,
                                                        [cs.chapterNumber]: {
                                                          ...prev[cs.chapterNumber],
                                                          promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                            idx === gi ? { ...g, isGeneratingPrompt: false } : g
                                                          ),
                                                        }
                                                      }));
                                                    }
                                                  }}
                                                >
                                                  {pg.isGeneratingPrompt ? (
                                                    <><Loader2 className="w-3 h-3 mr-1 animate-spin" />生成中...</>
                                                  ) : (
                                                    <><RotateCcw className="w-3 h-3 mr-1" />重新生成提示词</>
                                                  )}
                                                </Button>
                                              </div>
                                            </div>
                                          ) : pg.isGeneratingStoryboard && pg.storyboardPromptConfirmed ? (
                                            <div className="flex flex-col items-center gap-1">
                                              <div className="flex items-center gap-2">
                                                <Loader2 className="w-5 h-5 animate-spin text-purple-500" />
                                                <span className="text-sm text-purple-600">{pg.storyboardStatus || '正在生成故事板总控图...'}</span>
                                              </div>
                                            </div>
                                          ) : (
                                            <div className="flex items-center gap-2">
                                              <Button
                                                size="sm"
                                                disabled={pg.isGeneratingPrompt}
                                                onClick={async () => {
                                                  setChapterStoryboards(prev => ({
                                                    ...prev,
                                                    [cs.chapterNumber]: {
                                                      ...prev[cs.chapterNumber],
                                                      promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                        idx === gi ? { ...g, isGeneratingPrompt: true } : g
                                                      ),
                                                    }
                                                  }));
                                                  try {
                                                    const refImages2 = getGroupAssetImages(cs, pg);
                                                    const resp = await fetch('/api/generate-storyboard-prompt', {
                                                      method: 'POST',
                                                      headers: { 'Content-Type': 'application/json' },
                                                      body: JSON.stringify({
                                                        chapterTitle: cs.chapterTitle,
                                                        groupIndex: pg.groupIndex,
                                                        shots: pg.shotNumbers.map(sn => 
                                                          cs.storyboard?.shots.find(s => s.shotNumber === sn)
                                                        ).filter(Boolean),
                                                        referenceImages: refImages2,
                                                        imageSettings: globalImageSettings,
                                                      }),
                                                    });
                                                    const data = await resp.json();
                                                    if (data.success && data.storyboardPrompt) {
                                                      setChapterStoryboards(prev => ({
                                                        ...prev,
                                                        [cs.chapterNumber]: {
                                                          ...prev[cs.chapterNumber],
                                                          promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                            idx === gi ? { ...g, storyboardPromptText: data.storyboardPrompt, isGeneratingPrompt: false } : g
                                                          ),
                                                        }
                                                      }));
                                                      toast.success('第' + pg.groupIndex + '组故事版专用提示词生成成功');
                                                    } else {
                                                      throw new Error(data.error || '生成失败');
                                                    }
                                                  } catch (err: any) {
                                                    console.error('生成提示词失败:', err);
                                                    toast.error(err.message || '生成提示词失败');
                                                    setChapterStoryboards(prev => ({
                                                      ...prev,
                                                      [cs.chapterNumber]: {
                                                        ...prev[cs.chapterNumber],
                                                        promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                          idx === gi ? { ...g, isGeneratingPrompt: false } : g
                                                        ),
                                                      }
                                                    }));
                                                  }
                                                }}
                                              >
                                                {pg.isGeneratingPrompt ? (
                                                  <>
                                                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                                                    生成中（约30~90秒）...
                                                  </>
                                                ) : (
                                                  <>
                                                    <FileText className="w-4 h-4 mr-1" />
                                                    生成故事版专用提示词
                                                  </>
                                                )}
                                              </Button>
                                            </div>
                                          )}
                                        </div>
                                        )}
                                      </CardContent>
                                    </Card>
                                  ))}
                                </div>
                              )}
                              


                              {/* 确认按钮 */}
                              {!cs.promptsConfirmed && (
                                <Button
                                  size="sm"
                                  className="w-full"
                                  onClick={() => {
                                    setChapterStoryboards(prev => {
                                      const updated = {
                                        ...prev,
                                        [cs.chapterNumber]: {
                                          ...prev[cs.chapterNumber],
                                          promptsConfirmed: true,
                                        }
                                      };
                                      
                                      // 检查是否所有已确认素材的章节都确认了提示词
                                      const allAssetsConfirmed = Object.values(updated).filter(c => c.assetsConfirmed);
                                      const allPromptsConfirmed = allAssetsConfirmed.every(c => c.promptsConfirmed);
                                      
                                      // 只要确认了提示词就前进到生成视频步骤
                                      setCurrentStep(5);
                                      setProgress(80);
                                      
                                      // 如果所有章节提示词都已确认，更新全局确认状态
                                      if (allPromptsConfirmed && allAssetsConfirmed.length > 0) {
                                        setStepConfirmed(prevState => ({ ...prevState, prompts: true }));
                                        setProgress(90);
                                      }
                                      
                                      return updated;
                                    });
                                    toast.success(`第 ${cs.chapterNumber} 章故事版面板描述已确认`);
                                  }}
                                >
                                  <CheckCircle2 className="w-4 h-4 mr-1" />
                                  确认本章故事版面板描述
                                </Button>
                              )}
                              
                              {/* 重新生成按钮 */}
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="w-full mt-2"
                                    disabled={generatingPromptsChapters.includes(cs.chapterNumber)}
                                  >
                                    <RefreshCw className="w-4 h-4 mr-1" />
                                    重新生成故事版面板描述
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>确认重新生成故事版面板描述？</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      此操作将清空当前章节的故事版面板描述数据并重新生成。已生成的视频不会受影响。此操作不可撤销。
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>取消</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={async () => {
                                        const shots = cs.storyboard?.shots || [];
                                        if (shots.length === 0) {
                                          toast.error('没有分镜数据');
                                          return;
                                        }
                                        
                                        // 清空现有提示词
                                        setChapterStoryboards(prev => ({
                                          ...prev,
                                          [cs.chapterNumber]: {
                                            ...prev[cs.chapterNumber],
                                            videoPrompts: [],
                                            promptsConfirmed: false,
                                          }
                                        }));
                                        
                                        // 添加当前章节到生成中列表
                                        setGeneratingPromptsChapters(prev => 
                                          prev.includes(cs.chapterNumber) ? prev : [...prev, cs.chapterNumber]
                                        );
                                        toast.info(`正在重新生成第 ${cs.chapterNumber} 章故事版面板描述...`);
                                        
                                        try {
                                          // 设置 10 分钟超时（大于 API maxDuration，让 API 优先返回 504）
                                          const controller = new AbortController();
                                          const timeoutId = setTimeout(() => {
                                            controller.abort();
                                          }, 10 * 60 * 1000);
                                          
                                          // 获取本章相关的素材图片
                                          const chapterAssetImages = getChapterAssetImages(cs.chapterNumber);
                                          
                                          // 获取章节故事内容
                                          const chapterInfo = outline?.chapters?.find(c => c.chapterNumber === cs.chapterNumber);
                                          
                                          const response = await fetch('/api/generate-connecting-prompts', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({
                                              storyboard: shots,
                                              chapterTitle: cs.chapterTitle,
                                              chapterSummary: chapterInfo?.summary || '',
                                              storyTitle: outline?.title || '',
                                              storySummary: outline?.summary || '',
                                              imageSettings: globalImageSettings,
                                              imageStoryboards: cs.imageStoryboards,
                                              assetImages: chapterAssetImages,
                                              scenesData,
                                              charactersData,
                                              propsData,
                                            }),
                                            signal: controller.signal,
                                          }).finally(() => {
                                            clearTimeout(timeoutId);
                                          });
                                          
                                          if (!response.ok) {
                                            if (response.status === 504) {
                                              throw new Error('请求超时，故事版面板描述生成需要较长时间。\n\n建议：\n1. 请等待 30 秒后重新点击生成按钮\n2. 如果问题持续，请尝试减少分镜数量\n3. 或者联系技术支持');
                                            }
                                            throw new Error(`API 请求失败: ${response.status}`);
                                          }
                                          
                                          const data = await response.json();
                                          if (data.success && data.connectingPrompts) {
                                            setChapterStoryboards(prev => ({
                                              ...prev,
                                              [cs.chapterNumber]: {
                                                ...prev[cs.chapterNumber],
                                                videoPrompts: data.connectingPrompts.shotPrompts.map((sp: any) => ({ ...sp, videoPrompt: sp.panelDescription || sp.videoPrompt || '' })),
                                                promptGroups: groupShotsIntoPromptGroups(data.connectingPrompts.shotPrompts.map((sp: any) => ({ ...sp, videoPrompt: sp.panelDescription || sp.videoPrompt || '' })), shots),
                                              }
                                            }));
                                            toast.success(`第 ${cs.chapterNumber} 章故事版面板描述重新生成成功`);
                                          } else {
                                            toast.error(data.error || '生成失败');
                                          }
                                        } catch (error) {
                                          console.error('重新生成故事版面板描述失败:', error);
                                          const errorMessage = getNetworkErrorMessage(error, '重新生成故事版面板描述');
                                          toast.error(errorMessage);
                                        } finally {
                                          setGeneratingPromptsChapters(prev => 
                                            prev.filter(n => n !== cs.chapterNumber)
                                          );
                                        }
                                      }}
                                    >
                                      确认重新生成
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              className="w-full"
                              onClick={async () => {
                                const shots = cs.storyboard?.shots || [];
                                if (shots.length === 0) {
                                  toast.error('没有分镜数据');
                                  return;
                                }
                                
                                // 添加当前章节到生成中列表
                                setGeneratingPromptsChapters(prev => 
                                  prev.includes(cs.chapterNumber) ? prev : [...prev, cs.chapterNumber]
                                );
                                toast.info(`正在生成第 ${cs.chapterNumber} 章故事版面板描述...`);
                                try {
                                  // 设置 10 分钟超时（大于 API maxDuration，让 API 优先返回 504）
                                  const controller = new AbortController();
                                  const timeoutId = setTimeout(() => {
                                    controller.abort();
                                  }, 10 * 60 * 1000);
                                  
                                  // 获取本章相关的素材图片
                                  const chapterAssetImages = getChapterAssetImages(cs.chapterNumber);
                                  
                                  // 获取章节故事内容
                                  const chapterInfo = outline?.chapters?.find(c => c.chapterNumber === cs.chapterNumber);
                                  
                                  const response = await fetch('/api/generate-connecting-prompts', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      storyboard: shots,
                                      chapterTitle: cs.chapterTitle,
                                      chapterSummary: chapterInfo?.summary || '',  // 章节故事概要
                                      storyTitle: outline?.title || '',  // 整体故事标题
                                      storySummary: outline?.summary || '',  // 整体故事概要
                                      imageSettings: globalImageSettings,
                                      imageStoryboards: cs.imageStoryboards, // 传递图片分镜数据
                                      assetImages: chapterAssetImages, // 传递本章相关的素材图片
                                      scenesData,   // 传递场景数据（用于匹配 ID）
                                      charactersData, // 传递人物数据（用于匹配 ID）
                                      propsData,    // 传递道具数据（用于匹配 ID）
                                    }),
                                    signal: controller.signal,
                                  }).finally(() => {
                                    clearTimeout(timeoutId);
                                  });
                                  
                                  // 检查响应状态
                                  if (!response.ok) {
                                    const errorText = await response.text().catch(() => '');
                                    if (response.status === 504) {
                                      throw new Error('请求超时，故事版面板描述生成需要较长时间。\n\n建议：\n1. 请等待 30 秒后重新点击生成按钮\n2. 如果问题持续，请尝试减少分镜数量\n3. 或者联系技术支持');
                                    }
                                    throw new Error(`API 请求失败: ${response.status}`);
                                  }
                                  
                                  const data = await response.json();
                                  if (data.success && data.connectingPrompts) {
                                    setChapterStoryboards(prev => ({
                                      ...prev,
                                      [cs.chapterNumber]: {
                                        ...prev[cs.chapterNumber],
                                        videoPrompts: data.connectingPrompts.shotPrompts.map((sp: any) => ({ ...sp, videoPrompt: sp.panelDescription || sp.videoPrompt || '' })),
                                        promptGroups: groupShotsIntoPromptGroups(data.connectingPrompts.shotPrompts.map((sp: any) => ({ ...sp, videoPrompt: sp.panelDescription || sp.videoPrompt || '' })), shots),
                                      }
                                    }));
                                    toast.success(`第 ${cs.chapterNumber} 章故事版面板描述生成成功`);
                                  } else {
                                    toast.error(data.error || '生成失败');
                                  }
                                } catch (error) {
                                  console.error('生成故事版面板描述失败:', error);
                                  const errorMessage = getNetworkErrorMessage(error, '生成故事版面板描述');
                                  toast.error(errorMessage);
                                } finally {
                                  // 从生成中列表移除当前章节
                                  setGeneratingPromptsChapters(prev => 
                                    prev.filter(n => n !== cs.chapterNumber)
                                  );
                                }
                              }}
                              disabled={generatingPromptsChapters.includes(cs.chapterNumber)}
                            >
                              {generatingPromptsChapters.includes(cs.chapterNumber) ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                  正在生成提示词...
                                </>
                              ) : (
                                <>
                                  <Sparkles className="w-4 h-4 mr-2" />
                                  生成故事版面板描述
                                </>
                              )}
                            </Button>
                          )}
                            </div>
                          );
                        })}
                    </CardContent>
                  </Card>
                ) : (
                  <Card className="mb-4">
                    <CardContent className="flex items-center justify-center h-32">
                      <div className="text-center text-gray-500">
                        <Video className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                        <p>请先完成素材确认</p>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* 故事板总控图 Tab */}
              <TabsContent value="storyboard-total" className="space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <ImageIcon className="w-5 h-5 text-purple-500" />
                    <h3 className="text-base font-semibold">故事板总控图</h3>
                  </div>
                  <Badge variant="secondary">
                    {Object.values(chapterStoryboards).reduce((sum, cs) => 
                      sum + (cs.promptGroups?.length ?? 0), 0
                    )} 组分镜
                  </Badge>
                </div>

                {Object.values(chapterStoryboards).some(cs => (cs.promptGroups?.length ?? 0) > 0) ? (
                  <div className="space-y-4">
                    {Object.values(chapterStoryboards)
                      .filter(cs => (cs.promptGroups?.length ?? 0) > 0)
                      .map(cs => {
                        const isStoryboardTotalChapterCollapsed = collapsedStoryboardTotalChapters[String(cs.chapterNumber)] ?? true;
                        const generatedGroupCount = (cs.promptGroups ?? []).filter(pg => pg.storyboardImageUrl).length;

                        return (
                        <Card key={`storyboard-chapter-${cs.chapterNumber}`} className="overflow-hidden">
                          <CardHeader className="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-950/30 dark:to-indigo-950/30 py-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold">第{cs.chapterNumber}章</span>
                                <Badge variant="outline" className="text-xs">
                                  {(cs.promptGroups ?? []).length}组
                                </Badge>
                                {generatedGroupCount > 0 && (
                                  <Badge variant="secondary" className="text-xs">
                                    已出图 {generatedGroupCount} 组
                                  </Badge>
                                )}
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => toggleStoryboardTotalChapterCollapsed(cs.chapterNumber)}
                              >
                                {isStoryboardTotalChapterCollapsed ? (
                                  <ChevronRight className="w-4 h-4 mr-1" />
                                ) : (
                                  <ChevronDown className="w-4 h-4 mr-1" />
                                )}
                                {isStoryboardTotalChapterCollapsed ? '展开' : '收起'}
                              </Button>
                            </div>
                          </CardHeader>
                          <CardContent className="pt-3">
                            {isStoryboardTotalChapterCollapsed ? (
                              <div className="rounded-lg border border-dashed p-3 text-sm text-gray-500 dark:text-gray-400">
                                本章故事板已收起，包含 {(cs.promptGroups ?? []).length} 组，已生成 {generatedGroupCount} 张图。
                              </div>
                            ) : (
                              <div className="space-y-3">
                              {(cs.promptGroups ?? []).map((pg, gi) => (
                                <div key={`pg-${cs.chapterNumber}-${pg.groupIndex}`} className="border border-purple-200 dark:border-purple-800 rounded-lg p-3">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-semibold">第{pg.groupIndex}组</span>
                                      <Badge variant="secondary" className="text-xs">
                                        镜头 {pg.shotNumbers.join('、')}
                                      </Badge>
                                      <Badge variant="outline" className="text-xs">
                                        {pg.shotNumbers.length * 4}秒连冠
                                      </Badge>
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      disabled={pg.isGeneratingPrompt}
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        setChapterStoryboards(prev => ({
                                          ...prev,
                                          [cs.chapterNumber]: {
                                            ...prev[cs.chapterNumber],
                                            promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                              idx === gi ? { ...g, isGeneratingPrompt: true } : g
                                            ),
                                          }
                                        }));
                                        try {
                                          const refImages = getGroupAssetImages(cs, pg);
                                          const resp = await fetch('/api/generate-storyboard-prompt', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({
                                              chapterTitle: cs.chapterTitle,
                                              groupIndex: pg.groupIndex,
                                              shots: pg.shotNumbers.map(sn => 
                                                cs.storyboard?.shots.find(s => s.shotNumber === sn)
                                              ).filter(Boolean),
                                              referenceImages: refImages,
                                              imageSettings: globalImageSettings,
                                            }),
                                          });
                                          const data = await resp.json();
                                          if (data.success && data.storyboardPrompt) {
                                            setChapterStoryboards(prev => ({
                                              ...prev,
                                              [cs.chapterNumber]: {
                                                ...prev[cs.chapterNumber],
                                                promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                  idx === gi ? { ...g, storyboardPromptText: data.storyboardPrompt, isGeneratingPrompt: false } : g
                                                ),
                                              }
                                            }));
                                          } else {
                                            throw new Error(data.error || '生成失败');
                                          }
                                        } catch (err: any) {
                                          console.error('刷新提示词失败:', err);
                                          toast.error(err.message || '刷新提示词失败');
                                          setChapterStoryboards(prev => ({
                                            ...prev,
                                            [cs.chapterNumber]: {
                                              ...prev[cs.chapterNumber],
                                              promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                idx === gi ? { ...g, isGeneratingPrompt: false } : g
                                              ),
                                            }
                                          }));
                                        }
                                      }}
                                    >
                                      <RotateCcw className={`w-3 h-3 ${pg.isGeneratingPrompt ? 'animate-spin' : ''}`} />
                                    </Button>
                                  </div>
                                  
                                  {/* 故事板图片 */}
                                  <div className="mb-2">
                                    {pg.storyboardImageUrl ? (
                                      <>
                                      <div className="relative group">
                                        <img
                                          src={getDisplayImageUrl(pg.storyboardImageUrl)}
                                          alt={`故事板第${pg.groupIndex}组`}
                                          className="w-full cursor-zoom-in rounded-lg border shadow-sm max-h-[400px] object-cover"
                                          onClick={() => openImagePreview(
                                            getDisplayImageUrl(pg.storyboardImageUrl),
                                            getStoryboardImageFileName(cs.chapterNumber, pg.groupIndex),
                                            'storyboard'
                                          )}
                                          onError={(e) => {
                                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                                            toast.error('故事版图片加载失败，请点击下方“打开图片”或重新生成');
                                          }}
                                        />
                                        <Button
                                          size="sm"
                                          variant="secondary"
                                          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                                          disabled={pg.isGeneratingStoryboard}
                                          onClick={async () => {
                                            setChapterStoryboards(prev => ({
                                              ...prev,
                                              [cs.chapterNumber]: {
                                                ...prev[cs.chapterNumber],
                                                promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                  idx === gi ? { ...g, isGeneratingStoryboard: true, storyboardStatus: '正在提交到 AI 绘图服务...' } : g
                                                ),
                                              }
                                            }));
                                            await new Promise(r => setTimeout(r, 50));
                                            setChapterStoryboards(prev => ({
                                              ...prev,
                                              [cs.chapterNumber]: {
                                                ...prev[cs.chapterNumber],
                                                promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                  idx === gi ? { ...g, storyboardStatus: '正在快速生成预览图（通常20~90秒）...' } : g
                                                ),
                                              }
                                            }));
                                            try {
                                              const refImages = getGroupAssetImages(cs, pg);
                                              const resp = await fetch('/api/generate-storyboard-image', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({
                                                  chapterTitle: cs.chapterTitle,
                                                  groupIndex: pg.groupIndex,
                                                  shots: pg.shotNumbers.map(sn => 
                                                    cs.storyboard?.shots.find(s => s.shotNumber === sn)
                                                  ).filter(Boolean),
                                                  referenceImages: refImages,
                                                  imageSettings: {
                                                    ratios: globalImageSettings.ratios,
                                                    styles: globalImageSettings.styles,
                                                    lighting: globalImageSettings.lighting,
                                                  },
                                                  customPrompt: pg.storyboardPromptText,
                                                }),
                                              });
                                              const data = await resp.json();
                                              if (data.success && data.imageUrl) {
                                                setChapterStoryboards(prev => ({
                                                  ...prev,
                                                  [cs.chapterNumber]: {
                                                    ...prev[cs.chapterNumber],
                                                    promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                      idx === gi ? { ...g, storyboardImageUrl: data.imageUrl, storyboardImageKey: data.imageKey, isGeneratingStoryboard: false, storyboardStatus: '' } : g
                                                    ),
                                                  }
                                                }));
                                              } else {
                                                throw new Error(data.error || '生成失败');
                                              }
                                            } catch (err: any) {
                                              console.error('生成故事板失败:', err);
                                              toast.error(err.message || '生成故事板失败');
                                              setChapterStoryboards(prev => ({
                                                ...prev,
                                                [cs.chapterNumber]: {
                                                  ...prev[cs.chapterNumber],
                                                  promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                    idx === gi ? { ...g, isGeneratingStoryboard: false, storyboardStatus: '' } : g
                                                  ),
                                                }
                                              }));
                                            }
                                          }}
                                        >
                                          <RotateCcw className="w-3 h-3 mr-1" />
                                          重新生成
                                        </Button>
                                      </div>
                                      <div className="mt-2 rounded-lg border bg-gray-50 p-2 dark:bg-gray-900">
                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                          <div className="min-w-0">
                                            <p className="text-xs font-medium text-gray-600 dark:text-gray-300">
                                              故事版图片已保存到资产库 / 分镜图片
                                            </p>
                                            <code className="block truncate text-[11px] text-gray-500 dark:text-gray-400">
                                              {getDisplayImageUrl(pg.storyboardImageUrl)}
                                            </code>
                                          </div>
                                          <div className="flex shrink-0 flex-wrap gap-1">
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() => openImagePreview(
                                                getDisplayImageUrl(pg.storyboardImageUrl),
                                                getStoryboardImageFileName(cs.chapterNumber, pg.groupIndex),
                                                'storyboard'
                                              )}
                                            >
                                              <Eye className="w-3 h-3 mr-1" />
                                              查看大图
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() => downloadImage(
                                                pg.storyboardImageUrl || '',
                                                getStoryboardImageFileName(cs.chapterNumber, pg.groupIndex)
                                              )}
                                            >
                                              <Download className="w-3 h-3 mr-1" />
                                              下载
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() => {
                                                navigator.clipboard.writeText(getDisplayImageUrl(pg.storyboardImageUrl));
                                                toast.success('已复制图片地址');
                                              }}
                                            >
                                              <Copy className="w-3 h-3 mr-1" />
                                              复制地址
                                            </Button>
                                          </div>
                                        </div>
                                      </div>
                                      {pg.storyboardPromptText && (
                                        <details className="mt-2">
                                          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">查看使用的提示词</summary>
                                          <textarea
                                            className="w-full mt-1 min-h-[80px] text-xs p-2 border rounded bg-gray-50 dark:bg-gray-800 font-mono text-gray-600 cursor-default"
                                            value={pg.storyboardPromptText}
                                            readOnly
                                            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                                          />
                                        </details>
                                      )}
                                      </>
                                    ) : (
                                      <div className="flex flex-col items-center justify-center py-4 bg-gray-50 dark:bg-gray-800 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600">
                                        {pg.storyboardPromptText && !pg.storyboardPromptConfirmed ? (
                                          <div className="w-full space-y-2 p-2">
                                            <label className="block text-xs font-medium text-purple-600 dark:text-purple-400">故事版专用提示词（确认后出图）</label>
                                            <textarea
                                              className="w-full min-h-[120px] text-xs p-2 border rounded bg-white dark:bg-gray-900 font-mono"
                                              value={pg.storyboardPromptText}
                                              onChange={(e) => {
                                                setChapterStoryboards(prev => ({
                                                  ...prev,
                                                  [cs.chapterNumber]: {
                                                    ...prev[cs.chapterNumber],
                                                    promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                      idx === gi ? { ...g, storyboardPromptText: e.target.value } : g
                                                    ),
                                                  }
                                                }));
                                              }}
                                            />
                                            <div className="flex gap-2">
                                              <Button
                                                size="sm"
                                                disabled={pg.isGeneratingStoryboard}
                                                onClick={async () => {
                                                  setChapterStoryboards(prev => ({
                                                    ...prev,
                                                    [cs.chapterNumber]: {
                                                      ...prev[cs.chapterNumber],
                                                      promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                        idx === gi ? { ...g, isGeneratingStoryboard: true, storyboardPromptConfirmed: true, storyboardStatus: '正在提交到 AI 绘图服务...' } : g
                                                      ),
                                                    }
                                                  }));
                                                  await new Promise(r => setTimeout(r, 50));
                                                  setChapterStoryboards(prev => ({
                                                    ...prev,
                                                    [cs.chapterNumber]: {
                                                      ...prev[cs.chapterNumber],
                                                      promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                        idx === gi ? { ...g, storyboardStatus: '正在快速生成预览图（通常20~90秒）...' } : g
                                                      ),
                                                    }
                                                  }));
                                                  try {
                                                    const refImages = getGroupAssetImages(cs, pg);
                                                    const resp = await fetch('/api/generate-storyboard-image', {
                                                      method: 'POST',
                                                      headers: { 'Content-Type': 'application/json' },
                                                      body: JSON.stringify({
                                                        chapterTitle: cs.chapterTitle,
                                                        groupIndex: pg.groupIndex,
                                                        shots: pg.shotNumbers.map(sn => 
                                                          cs.storyboard?.shots.find(s => s.shotNumber === sn)
                                                        ).filter(Boolean),
                                                        referenceImages: refImages,
                                                        imageSettings: {
                                                          ratios: globalImageSettings.ratios,
                                                          styles: globalImageSettings.styles,
                                                          lighting: globalImageSettings.lighting,
                                                        },
                                                        customPrompt: pg.storyboardPromptText,
                                                      }),
                                                    });
                                                    const data = await resp.json();
                                                    if (data.success && data.imageUrl) {
                                                      setChapterStoryboards(prev => ({
                                                        ...prev,
                                                        [cs.chapterNumber]: {
                                                          ...prev[cs.chapterNumber],
                                                          promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                            idx === gi ? { ...g, storyboardImageUrl: data.imageUrl, storyboardImageKey: data.imageKey, isGeneratingStoryboard: false, storyboardStatus: '' } : g
                                                          ),
                                                        }
                                                      }));
                                                    } else {
                                                      throw new Error(data.error || '生成失败');
                                                    }
                                                  } catch (err: any) {
                                                    console.error('生成故事板失败:', err);
                                                    toast.error(err.message || '生成故事板失败');
                                                    setChapterStoryboards(prev => ({
                                                      ...prev,
                                                      [cs.chapterNumber]: {
                                                        ...prev[cs.chapterNumber],
                                                        promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                          idx === gi ? { ...g, isGeneratingStoryboard: false, storyboardPromptConfirmed: false, storyboardStatus: '' } : g
                                                        ),
                                                      }
                                                    }));
                                                  }
                                                }}
                                              >
                                                {pg.isGeneratingStoryboard ? (
                                                  <><Loader2 className="w-3 h-3 mr-1 animate-spin" />生成中...</>
                                                ) : (
                                                  <><Check className="w-3 h-3 mr-1" />确认出图</>
                                                )}
                                              </Button>
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={pg.isGeneratingPrompt}
                                                onClick={async () => {
                                                  setChapterStoryboards(prev => ({
                                                    ...prev,
                                                    [cs.chapterNumber]: {
                                                      ...prev[cs.chapterNumber],
                                                      promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                        idx === gi ? { ...g, isGeneratingPrompt: true } : g
                                                      ),
                                                    }
                                                  }));
                                                  try {
                                                    const refImages = getGroupAssetImages(cs, pg);
                                                    const resp = await fetch('/api/generate-storyboard-prompt', {
                                                      method: 'POST',
                                                      headers: { 'Content-Type': 'application/json' },
                                                      body: JSON.stringify({
                                                        chapterTitle: cs.chapterTitle,
                                                        groupIndex: pg.groupIndex,
                                                        shots: pg.shotNumbers.map(sn => 
                                                          cs.storyboard?.shots.find(s => s.shotNumber === sn)
                                                        ).filter(Boolean),
                                                        referenceImages: refImages,
                                                        imageSettings: globalImageSettings,
                                                      }),
                                                    });
                                                    const data = await resp.json();
                                                    if (data.success && data.storyboardPrompt) {
                                                      setChapterStoryboards(prev => ({
                                                        ...prev,
                                                        [cs.chapterNumber]: {
                                                          ...prev[cs.chapterNumber],
                                                          promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                            idx === gi ? { ...g, storyboardPromptText: data.storyboardPrompt, isGeneratingPrompt: false } : g
                                                          ),
                                                        }
                                                      }));
                                                    } else {
                                                      throw new Error(data.error || '生成失败');
                                                    }
                                                  } catch (err: any) {
                                                    console.error('生成提示词失败:', err);
                                                    toast.error(err.message || '生成提示词失败');
                                                    setChapterStoryboards(prev => ({
                                                      ...prev,
                                                      [cs.chapterNumber]: {
                                                        ...prev[cs.chapterNumber],
                                                        promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                          idx === gi ? { ...g, isGeneratingPrompt: false } : g
                                                        ),
                                                      }
                                                    }));
                                                  }
                                                }}
                                              >
                                                {pg.isGeneratingPrompt ? (
                                                  <><Loader2 className="w-3 h-3 mr-1 animate-spin" />生成中...</>
                                                ) : (
                                                  <><RotateCcw className="w-3 h-3 mr-1" />重新生成提示词</>
                                                )}
                                              </Button>
                                            </div>
                                          </div>
                                        ) : pg.isGeneratingStoryboard && pg.storyboardPromptConfirmed ? (
                                          <div className="flex flex-col items-center gap-1">
                                            <div className="flex items-center gap-2">
                                              <Loader2 className="w-5 h-5 animate-spin text-purple-500" />
                                              <span className="text-sm text-purple-600">{pg.storyboardStatus || '正在生成故事板总控图...'}</span>
                                            </div>
                                          </div>
                                        ) : (
                                          <>
                                            <ImageIcon className="w-8 h-8 text-gray-400 mb-2" />
                                            <p className="text-xs text-gray-500 mb-2">等待生成故事版专用提示词</p>
                                            <Button
                                              size="sm"
                                              disabled={pg.isGeneratingPrompt}
                                              onClick={async () => {
                                                setChapterStoryboards(prev => ({
                                                  ...prev,
                                                  [cs.chapterNumber]: {
                                                    ...prev[cs.chapterNumber],
                                                    promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                      idx === gi ? { ...g, isGeneratingPrompt: true } : g
                                                    ),
                                                  }
                                                }));
                                                try {
                                                  const refImages = getGroupAssetImages(cs, pg);
                                                  const resp = await fetch('/api/generate-storyboard-prompt', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({
                                                      chapterTitle: cs.chapterTitle,
                                                      groupIndex: pg.groupIndex,
                                                      shots: pg.shotNumbers.map(sn => 
                                                        cs.storyboard?.shots.find(s => s.shotNumber === sn)
                                                      ).filter(Boolean),
                                                      referenceImages: refImages,
                                                      imageSettings: globalImageSettings,
                                                    }),
                                                  });
                                                  const data = await resp.json();
                                                  if (data.success && data.storyboardPrompt) {
                                                    setChapterStoryboards(prev => ({
                                                      ...prev,
                                                      [cs.chapterNumber]: {
                                                        ...prev[cs.chapterNumber],
                                                        promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                          idx === gi ? { ...g, storyboardPromptText: data.storyboardPrompt, isGeneratingPrompt: false } : g
                                                        ),
                                                      }
                                                    }));
                                                  } else {
                                                    throw new Error(data.error || '生成失败');
                                                  }
                                                } catch (err: any) {
                                                  console.error('生成提示词失败:', err);
                                                  toast.error(err.message || '生成提示词失败');
                                                  setChapterStoryboards(prev => ({
                                                    ...prev,
                                                    [cs.chapterNumber]: {
                                                      ...prev[cs.chapterNumber],
                                                      promptGroups: prev[cs.chapterNumber].promptGroups?.map((g, idx) =>
                                                        idx === gi ? { ...g, isGeneratingPrompt: false } : g
                                                      ),
                                                    }
                                                  }));
                                                }
                                              }}
                                            >
                                              {pg.isGeneratingPrompt ? (
                                                <>
                                                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                                                  生成提示词中...
                                                </>
                                              ) : (
                                                <>
                                                  <FileText className="w-4 h-4 mr-1" />
                                                  生成故事版专用提示词
                                                </>
                                              )}
                                            </Button>
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                        );
                      })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <ImageIcon className="w-12 h-12 text-gray-300 mb-3" />
                    <p className="text-sm text-gray-500 mb-1">暂无故事板分组数据</p>
                    <p className="text-xs text-gray-400">请先在「提示词」标签页生成故事版面板描述后，自动创建故事板分组</p>
                  </div>
                )}
              </TabsContent>

              {/* Videos Tab */}
              <TabsContent value="videos">
                {/* 视频格式选择 */}
                <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">视频格式：</span>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant={videoRatio === '16:9' ? 'default' : 'outline'}
                        onClick={() => {
                          setVideoRatio('16:9');
                          updateGlobalImageSettings({
                            ratios: [
                              '16:9',
                              ...globalImageSettings.ratios.filter(ratio => ratio !== '16:9' && ratio !== '9:16'),
                            ],
                          });
                        }}
                      >
                        横屏 16:9
                      </Button>
                      <Button
                        size="sm"
                        variant={videoRatio === '9:16' ? 'default' : 'outline'}
                        onClick={() => {
                          setVideoRatio('9:16');
                          updateGlobalImageSettings({
                            ratios: [
                              '9:16',
                              ...globalImageSettings.ratios.filter(ratio => ratio !== '16:9' && ratio !== '9:16'),
                            ],
                          });
                        }}
                      >
                        竖屏 9:16
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    切换格式后生成的新视频将使用新格式
                  </p>
                </div>

                {Object.values(chapterStoryboards).some(cs => (cs.promptGroups?.length ?? 0) > 0) && (
                  <div className="space-y-4 mb-4">
                    {Object.values(chapterStoryboards)
                      .filter(cs => (cs.promptGroups?.length ?? 0) > 0)
                      .sort((a, b) => a.chapterNumber - b.chapterNumber)
                      .map(cs => {
                        const groupVideos = (cs.shotVideos || []).filter(sv => sv.shotNumber < 0).flatMap(sv => sv.videos);
                        const successCount = groupVideos.filter(v => v.status === 'success').length;
                        const generatingCount = groupVideos.filter(v => v.status === 'generating').length;
                        const totalDuration = groupVideos
                          .filter(v => v.status === 'success')
                          .reduce((sum, v) => sum + v.duration, 0);

                        return (
                          <Card key={`group-videos-card-${cs.chapterNumber}`} className="mb-4">
                            <CardHeader className="pb-2">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <CardTitle className="text-base">第 {cs.chapterNumber} 章：{cs.chapterTitle}</CardTitle>
                                  <CardDescription>
                                    按故事板分组生成视频，每组使用故事版提示词、故事版总控图和最多9张关联素材图
                                  </CardDescription>
                                </div>
                                <div className="text-sm text-gray-500">
                                  <span>{successCount} 个视频</span>
                                  {generatingCount > 0 && (
                                    <span className="text-blue-500 ml-2">{generatingCount} 个生成中</span>
                                  )}
                                  {totalDuration > 0 && (
                                    <span className="ml-2">| 总时长 {Math.floor(totalDuration / 60)}分{totalDuration % 60}秒</span>
                                  )}
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent>
                              <div className="space-y-3">
                                {(cs.promptGroups || []).map(pg => {
                                  const groupKey = getPromptGroupVideoKey(pg);
                                  const videos = cs.shotVideos?.find(sv => sv.shotNumber === groupKey)?.videos || [];
                                  const generating = videos.some(v => v.status === 'generating');
                                  const referenceSelection = getPromptGroupReferenceSelection(cs, pg);
                                  const referenceImages = referenceSelection.images;
                                  const linkedEntityCount =
                                    referenceSelection.entities.characters.length +
                                    referenceSelection.entities.scenes.length +
                                    referenceSelection.entities.props.length;
                                  const canGenerate = !!pg.storyboardPromptText || !!pg.combinedPrompt;

                                  return (
                                    <div key={`group-video-${cs.chapterNumber}-${pg.groupIndex}`} className="border rounded-lg p-3">
                                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="min-w-0 space-y-1">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <Badge>第 {pg.groupIndex} 组</Badge>
                                            <Badge variant="outline">镜头 {pg.shotNumbers.join('、')}</Badge>
                                            <Badge variant="secondary">参考图 {referenceImages.length}/9</Badge>
                                            <Badge variant="outline">关联实体 {linkedEntityCount}</Badge>
                                            {pg.storyboardImageUrl ? (
                                              <Badge className="bg-green-500">已有关联故事版图</Badge>
                                            ) : (
                                              <Badge variant="destructive">缺少故事版图</Badge>
                                            )}
                                          </div>
                                          <p className="text-xs text-gray-500 line-clamp-2">
                                            {(pg.storyboardPromptText || pg.combinedPrompt || '').slice(0, 180)}
                                          </p>
                                          {referenceImages.length > 0 && (
                                            <div className="flex flex-wrap gap-1 pt-1">
                                              {referenceImages.map((reference, idx) => (
                                                <button
                                                  key={`${reference.url}-${idx}`}
                                                  type="button"
                                                  className="h-10 w-10 overflow-hidden rounded border bg-gray-100"
                                                  title={`图${idx + 1}：${reference.name}`}
                                                  onClick={() => openImagePreview(reference.url, `第${pg.groupIndex}组 图${idx + 1} ${reference.name}`, 'storyboard')}
                                                >
                                                  <img src={reference.url} alt={reference.name} className="h-full w-full object-cover" />
                                                </button>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                        <Button
                                          size="sm"
                                          disabled={generating || !canGenerate}
                                          onClick={() => generatePromptGroupVideo(cs, pg)}
                                        >
                                          {generating ? (
                                            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                                          ) : (
                                            <Video className="w-4 h-4 mr-1" />
                                          )}
                                          {videos.length > 0 ? '再生成一个' : '生成本组视频'}
                                        </Button>
                                      </div>

                                      {videos.length > 0 && (
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                                          {videos.map(video => (
                                            <div key={video.videoId} className="relative group">
                                              {video.status === 'generating' ? (
                                                <div className="aspect-video bg-gray-100 dark:bg-gray-800 rounded flex items-center justify-center">
                                                  <div className="text-center">
                                                    <Loader2 className="w-6 h-6 animate-spin text-blue-500 mx-auto mb-2" />
                                                    <p className="text-xs text-gray-500">生成中...</p>
                                                  </div>
                                                </div>
                                              ) : video.status === 'error' ? (
                                                <div className="aspect-video bg-red-50 dark:bg-red-900/20 rounded flex flex-col items-center justify-center p-2">
                                                  <AlertCircle className="w-6 h-6 text-red-500 mb-2" />
                                                  <p className="text-xs text-red-500 text-center line-clamp-3">{video.error || '生成失败'}</p>
                                                  <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="mt-2"
                                                    onClick={() => generatePromptGroupVideo(cs, pg, video.videoId)}
                                                  >
                                                    重试
                                                  </Button>
                                                </div>
                                              ) : (
                                                <div className="relative">
                                                  <video
                                                    src={video.videoUrl}
                                                    controls
                                                    className="w-full aspect-video rounded"
                                                    style={{ aspectRatio: videoRatio === '16:9' ? '16/9' : '9/16' }}
                                                  />
                                                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <Button size="sm" variant="secondary" className="h-7" asChild>
                                                      <a href={video.videoUrl} download target="_blank" rel="noopener noreferrer">
                                                        <Download className="w-3 h-3" />
                                                      </a>
                                                    </Button>
                                                    <Button
                                                      size="sm"
                                                      variant="destructive"
                                                      className="h-7"
                                                      onClick={() => {
                                                        setChapterStoryboards(prev => ({
                                                          ...prev,
                                                          [cs.chapterNumber]: {
                                                            ...prev[cs.chapterNumber],
                                                            shotVideos: (prev[cs.chapterNumber].shotVideos || []).map(sv =>
                                                              sv.shotNumber === groupKey
                                                                ? { ...sv, videos: sv.videos.filter(v => v.videoId !== video.videoId) }
                                                                : sv
                                                            ),
                                                          },
                                                        }));
                                                        toast.success('视频已删除');
                                                      }}
                                                    >
                                                      <Trash2 className="w-3 h-3" />
                                                    </Button>
                                                  </div>
                                                </div>
                                              )}
                                              <div className="mt-1 text-xs text-gray-500 text-center">{video.duration}秒</div>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                  </div>
                )}
                
                {Object.values(chapterStoryboards).some(cs => cs.promptsConfirmed || (cs.shotVideos && cs.shotVideos.length > 0)) ? (
                  Object.values(chapterStoryboards)
                    .filter(cs => (cs.promptsConfirmed || (cs.shotVideos && cs.shotVideos.length > 0)) && (cs.promptGroups?.length ?? 0) === 0)
                    .sort((a, b) => a.chapterNumber - b.chapterNumber)
                    .map(cs => {
                      // 统计该章节的视频数量
                      const allVideos = cs.shotVideos?.flatMap(sv => sv.videos) || [];
                      const successCount = allVideos.filter(v => v.status === 'success').length;
                      const generatingCount = allVideos.filter(v => v.status === 'generating').length;
                      const totalDuration = allVideos
                        .filter(v => v.status === 'success')
                        .reduce((sum, v) => sum + v.duration, 0);
                      
                      return (
                        <Card key={`videos-card-${cs.chapterNumber}`} className="mb-4">
                          <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <CardTitle className="text-base">第 {cs.chapterNumber} 章</CardTitle>
                                <span className="text-sm font-normal text-gray-500">{cs.chapterTitle}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="text-sm text-gray-500">
                                  <span>{successCount} 个视频</span>
                                  {generatingCount > 0 && (
                                    <span className="text-blue-500 ml-2">{generatingCount} 个生成中</span>
                                  )}
                                  {totalDuration > 0 && (
                                    <span className="ml-2">| 总时长 {Math.floor(totalDuration / 60)}分{totalDuration % 60}秒</span>
                                  )}
                                </div>
                                {/* 清空内容重新编辑按钮 */}
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                                    >
                                      <RotateCcw className="w-3 h-3 mr-1" />
                                      清空重置
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>确认清空章节内容？</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        此操作将清空第 {cs.chapterNumber} 章的所有视频和提示词数据，您可以重新生成故事版面板描述。此操作不可撤销。
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>取消</AlertDialogCancel>
                                      <AlertDialogAction
                                        className="bg-orange-600 hover:bg-orange-700"
                                        onClick={() => {
                                          setChapterStoryboards(prev => ({
                                            ...prev,
                                            [cs.chapterNumber]: {
                                              ...prev[cs.chapterNumber],
                                              shotVideos: [],
                                              videoPrompts: [],
                                              promptsConfirmed: false,
                                            }
                                          }));
                                          toast.success(`第 ${cs.chapterNumber} 章内容已清空`);
                                        }}
                                      >
                                        确认清空
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <div className="space-y-4">
                              {(cs.storyboard?.shots || [])
                                ?.sort((a, b) => a.shotNumber - b.shotNumber)
                                .map(shot => {
                                  const shotDesc = getShotDescription(shot.shotNumber) || shot.description || '';
                                  const shotVideoPayload = getSingleShotVideoPayload(cs, shot, shotDesc);
                                  const shotDuration = normalizeManfeiDuration(
                                    cs.videoPrompts?.find(vp => vp.shotNumber === shot.shotNumber)?.duration,
                                  );
                                  // 从 shotVideos 中获取该镜头的视频
                                  const shotVideo = cs.shotVideos?.find(sv => sv.shotNumber === shot.shotNumber);
                                  const videos = shotVideo?.videos || [];
                                  const successVideosCount = videos.filter(v => v.status === 'success').length;
                                  const generatingVideosCount = videos.filter(v => v.status === 'generating').length;
                                  
                                  return (
                                  <div key={`vp-${cs.chapterNumber}-shot-${shot.shotNumber}`} className="border rounded-lg p-3">
                                    <div className="flex items-center gap-2 mb-3">
                                      <Badge>镜头 {shot.shotNumber}</Badge>
                                      <Badge variant="outline">{15}秒</Badge>
                                      <span className="text-xs text-gray-500">
                                        {successVideosCount}/3 视频
                                        {generatingVideosCount > 0 && ` (${generatingVideosCount}个生成中)`}
                                      </span>
                                    </div>
                                    
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                      {videos.map(video => (
                                        <div key={video.videoId} className="relative group">
                                          {video.status === 'generating' ? (
                                            <div className="aspect-video bg-gray-100 dark:bg-gray-800 rounded flex items-center justify-center">
                                              <div className="text-center">
                                                <Loader2 className="w-6 h-6 animate-spin text-blue-500 mx-auto mb-2" />
                                                <p className="text-xs text-gray-500">生成中...</p>
                                              </div>
                                            </div>
                                          ) : video.status === 'error' ? (
                                            <div className="aspect-video bg-red-50 dark:bg-red-900/20 rounded flex flex-col items-center justify-center p-2">
                                              <AlertCircle className="w-6 h-6 text-red-500 mb-2" />
                                              <p className="text-xs text-red-500 text-center">{video.error || '生成失败'}</p>
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                className="mt-2"
                                                onClick={async () => {
                                                  // 重新生成
                                                  setChapterStoryboards(prev => ({
                                                    ...prev,
                                                    [cs.chapterNumber]: {
                                                      ...prev[cs.chapterNumber],
                                                      shotVideos: (prev[cs.chapterNumber].shotVideos || []).map(sv =>
                                                        sv.shotNumber === shot.shotNumber
                                                          ? {
                                                              ...sv,
                                                              videos: sv.videos.map(v =>
                                                                v.videoId === video.videoId
                                                                  ? { ...v, status: 'generating', error: undefined }
                                                                  : v
                                                              ),
                                                            }
                                                          : sv
                                                      ),
                                                    }
                                                  }));
                                                  
                                                  try {
                                                    const generatedVideo = await createAndWaitForManfeiVideo({
                                                        prompt: shotVideoPayload.prompt,
                                                        duration: shotDuration,
                                                        chapterNumber: cs.chapterNumber,
                                                        shotNumber: shot.shotNumber,
                                                        videoRatio: getEffectiveVideoRatio(),
                                                        imageUrl: shotVideoPayload.imageUrls[0] || "",
                                                        imageUrls: shotVideoPayload.imageUrls,
                                                        referenceImageLabels: shotVideoPayload.referenceSelection.images.map(item => ({
                                                          type: item.type,
                                                          name: item.name,
                                                        })),
                                                        linkedEntities: shotVideoPayload.referenceSelection.entities,
                                                        imageUrlEndFrame: cs.imageStoryboards?.find(s => s.shotNumber === shot.shotNumber)?.imageUrlEndFrame || "",
                                                      }, (taskId) => {
                                                        setChapterStoryboards(prev => ({
                                                          ...prev,
                                                          [cs.chapterNumber]: {
                                                            ...prev[cs.chapterNumber],
                                                            shotVideos: (prev[cs.chapterNumber].shotVideos || []).map(sv =>
                                                              sv.shotNumber === shot.shotNumber
                                                                ? {
                                                                    ...sv,
                                                                    videos: sv.videos.map(v =>
                                                                      v.videoId === video.videoId ? { ...v, taskId } : v
                                                                    ),
                                                                  }
                                                                : sv
                                                            ),
                                                          },
                                                        }));
                                                    });
                                                      // 保存视频到 S3
                                                      let s3VideoUrl = generatedVideo.url;
                                                      let s3VideoKey = generatedVideo.key;
                                                      
                                                      try {
                                                        const saveResponse = await fetch('/api/save-video-to-s3', {
                                                          method: 'POST',
                                                          headers: { 'Content-Type': 'application/json' },
                                                          body: JSON.stringify({
                                                            videoUrl: generatedVideo.url,
                                                            chapterNumber: cs.chapterNumber,
                                                            shotNumber: shot.shotNumber,
                                                            videoIndex: videos.findIndex(v => v.videoId === video.videoId),
                                                          }),
                                                        });
                                                        const saveData = await saveResponse.json();
                                                        
                                                        if (saveData.success) {
                                                          s3VideoUrl = saveData.url;
                                                          s3VideoKey = saveData.key;
                                                          console.log(`视频已保存到 S3: ${saveData.key}`);
                                                        }
                                                      } catch (saveError) {
                                                        console.warn('保存视频到 S3 失败，使用原始 URL:', saveError);
                                                      }
                                                      
                                                      const finalVideoUrl = s3VideoUrl;
                                                      const finalVideoKey = s3VideoKey;
                                                      
                                                      setChapterStoryboards(prev => ({
                                                        ...prev,
                                                        [cs.chapterNumber]: {
                                                          ...prev[cs.chapterNumber],
                                                          shotVideos: (prev[cs.chapterNumber].shotVideos || []).map(sv =>
                                                            sv.shotNumber === shot.shotNumber
                                                              ? {
                                                                  ...sv,
                                                                  videos: sv.videos.map(v =>
                                                                    v.videoId === video.videoId
                                                                      ? {
                                                                          ...v,
                                                                          videoUrl: finalVideoUrl,
                                                                          videoKey: finalVideoKey,
                                                                          status: 'success',
                                                                        }
                                                                      : v
                                                                  ),
                                                                }
                                                              : sv
                                                          ),
                                                        }
                                                      }));
                                                      toast.success('视频重新生成成功');
                                                  } catch (error: any) {
                                                    setChapterStoryboards(prev => ({
                                                      ...prev,
                                                      [cs.chapterNumber]: {
                                                        ...prev[cs.chapterNumber],
                                                        shotVideos: (prev[cs.chapterNumber].shotVideos || []).map(sv =>
                                                          sv.shotNumber === shot.shotNumber
                                                            ? {
                                                                ...sv,
                                                                videos: sv.videos.map(v =>
                                                                  v.videoId === video.videoId
                                                                    ? { ...v, status: 'error', error: error.message }
                                                                    : v
                                                                ),
                                                              }
                                                            : sv
                                                        ),
                                                      }
                                                    }));
                                                    toast.error('视频重新生成失败');
                                                  }
                                                }}
                                              >
                                                重试
                                              </Button>
                                            </div>
                                          ) : (
                                            <div className="relative">
                                              <video
                                                src={video.videoUrl}
                                                controls
                                                className="w-full aspect-video rounded"
                                                style={{ aspectRatio: videoRatio === '16:9' ? '16/9' : '9/16' }}
                                              />
                                              
                                              {/* 操作按钮 */}
                                              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Button
                                                  size="sm"
                                                  variant="secondary"
                                                  className="h-7"
                                                  asChild
                                                >
                                                  <a href={video.videoUrl} download target="_blank" rel="noopener noreferrer">
                                                    <Download className="w-3 h-3" />
                                                  </a>
                                                </Button>
                                                <Button
                                                  size="sm"
                                                  variant="destructive"
                                                  className="h-7"
                                                  onClick={() => {
                                                    setChapterStoryboards(prev => ({
                                                      ...prev,
                                                      [cs.chapterNumber]: {
                                                        ...prev[cs.chapterNumber],
                                                        shotVideos: (prev[cs.chapterNumber].shotVideos || []).map(sv =>
                                                          sv.shotNumber === shot.shotNumber
                                                            ? {
                                                                ...sv,
                                                                videos: sv.videos.filter(v => v.videoId !== video.videoId),
                                                              }
                                                            : sv
                                                        ),
                                                      }
                                                    }));
                                                    toast.success('视频已删除');
                                                  }}
                                                >
                                                  <Trash2 className="w-3 h-3" />
                                                </Button>
                                              </div>
                                            </div>
                                          )}
                                          
                                          {/* 视频时长 */}
                                          <div className="mt-1 text-xs text-gray-500 text-center">
                                            {video.duration}秒
                                          </div>
                                        </div>
                                      ))}
                                      
                                      {/* 添加更多视频按钮 */}
                                      {videos.length < 3 && (() => {
                                        const generating = videos.some(v => v.status === 'generating');
                                        
                                        return (
                                          <button
                                            className="aspect-video border-2 border-dashed border-gray-300 dark:border-gray-700 rounded flex items-center justify-center hover:border-gray-400 dark:hover:border-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            disabled={generating}
                                            onClick={async () => {
                                              const videoId = `video-${cs.chapterNumber}-${shot.shotNumber}-${Date.now()}`;
                                              const newVideo: VideoItem = {
                                                videoId,
                                                videoUrl: '',
                                                duration: shotDuration,
                                                shotNumber: shot.shotNumber,
                                                prompt: shotDesc,
                                                status: 'generating',
                                                createdAt: Date.now(),
                                              };
                                              
                                              // 初始化或更新 shotVideos
                                              setChapterStoryboards(prev => {
                                                const existing = prev[cs.chapterNumber].shotVideos || [];
                                                const existingShot = existing.find(sv => sv.shotNumber === shot.shotNumber);
                                                
                                                let newShotVideos: ShotVideos[];
                                                if (existingShot) {
                                                  newShotVideos = existing.map(sv =>
                                                    sv.shotNumber === shot.shotNumber
                                                      ? { ...sv, videos: [...sv.videos, newVideo] }
                                                      : sv
                                                  );
                                                } else {
                                                  newShotVideos = [...existing, { shotNumber: shot.shotNumber, videos: [newVideo] }];
                                                }
                                                
                                                return {
                                                  ...prev,
                                                  [cs.chapterNumber]: {
                                                    ...prev[cs.chapterNumber],
                                                    shotVideos: newShotVideos,
                                                  }
                                                };
                                              });
                                              
                                              toast.info(`镜头 ${shot.shotNumber} 视频生成中...`);
                                              
                                              try {
                                                const generatedVideo = await createAndWaitForManfeiVideo({
                                                    prompt: shotVideoPayload.prompt,
                                                    duration: shotDuration,
                                                    chapterNumber: cs.chapterNumber,
                                                    shotNumber: shot.shotNumber,
                                                    videoRatio: getEffectiveVideoRatio(),
                                                    imageUrl: shotVideoPayload.imageUrls[0] || "",
                                                    imageUrls: shotVideoPayload.imageUrls,
                                                    referenceImageLabels: shotVideoPayload.referenceSelection.images.map(item => ({
                                                      type: item.type,
                                                      name: item.name,
                                                    })),
                                                    linkedEntities: shotVideoPayload.referenceSelection.entities,
                                                    imageUrlEndFrame: cs.imageStoryboards?.find(s => s.shotNumber === shot.shotNumber)?.imageUrlEndFrame || "",
                                                  }, (taskId) => {
                                                    setChapterStoryboards(prev => ({
                                                      ...prev,
                                                      [cs.chapterNumber]: {
                                                        ...prev[cs.chapterNumber],
                                                        shotVideos: (prev[cs.chapterNumber].shotVideos || []).map(sv =>
                                                          sv.shotNumber === shot.shotNumber
                                                            ? {
                                                                ...sv,
                                                                videos: sv.videos.map(v =>
                                                                  v.videoId === videoId ? { ...v, taskId } : v
                                                                ),
                                                              }
                                                            : sv
                                                        ),
                                                      },
                                                    }));
                                                });
                                                  // 保存视频到 S3
                                                  let s3VideoUrl = generatedVideo.url;
                                                  let s3VideoKey = generatedVideo.key;
                                                  
                                                  // 获取当前视频索引
                                                  const currentShotVideos = cs.shotVideos?.find(sv => sv.shotNumber === shot.shotNumber);
                                                  const videoIndex = currentShotVideos?.videos.length || 0;
                                                  
                                                  try {
                                                    const saveResponse = await fetch('/api/save-video-to-s3', {
                                                      method: 'POST',
                                                      headers: { 'Content-Type': 'application/json' },
                                                      body: JSON.stringify({
                                                        videoUrl: generatedVideo.url,
                                                        chapterNumber: cs.chapterNumber,
                                                        shotNumber: shot.shotNumber,
                                                        videoIndex,
                                                      }),
                                                    });
                                                    const saveData = await saveResponse.json();
                                                    
                                                    if (saveData.success) {
                                                      s3VideoUrl = saveData.url;
                                                      s3VideoKey = saveData.key;
                                                      console.log(`视频已保存到 S3: ${saveData.key}`);
                                                    }
                                                  } catch (saveError) {
                                                    console.warn('保存视频到 S3 失败，使用原始 URL:', saveError);
                                                  }
                                                  
                                                  const finalVideoUrl = s3VideoUrl;
                                                  const finalVideoKey = s3VideoKey;
                                                  
                                                  setChapterStoryboards(prev => ({
                                                    ...prev,
                                                    [cs.chapterNumber]: {
                                                      ...prev[cs.chapterNumber],
                                                      shotVideos: (prev[cs.chapterNumber].shotVideos || []).map(sv =>
                                                        sv.shotNumber === shot.shotNumber
                                                          ? {
                                                              ...sv,
                                                              videos: sv.videos.map(v =>
                                                                v.videoId === videoId
                                                                  ? {
                                                                      ...v,
                                                                      videoUrl: finalVideoUrl,
                                                                      videoKey: finalVideoKey,
                                                                      status: 'success',
                                                                    }
                                                                  : v
                                                              ),
                                                            }
                                                          : sv
                                                      ),
                                                    }
                                                  }));
                                                  toast.success(`镜头 ${shot.shotNumber} 视频生成成功`);
                                              } catch (error: any) {
                                                setChapterStoryboards(prev => ({
                                                  ...prev,
                                                  [cs.chapterNumber]: {
                                                    ...prev[cs.chapterNumber],
                                                    shotVideos: (prev[cs.chapterNumber].shotVideos || []).map(sv =>
                                                      sv.shotNumber === shot.shotNumber
                                                        ? {
                                                            ...sv,
                                                            videos: sv.videos.map(v =>
                                                              v.videoId === videoId
                                                                ? { ...v, status: 'error', error: getNetworkErrorMessage(error, '生成视频') }
                                                                : v
                                                            ),
                                                          }
                                                        : sv
                                                    ),
                                                  }
                                                }));
                                                toast.error(getNetworkErrorMessage(error, '生成视频'));
                                              }
                                            }}
                                          >
                                            <div className="text-center">
                                              <Plus className="w-6 h-6 text-gray-400 mx-auto mb-1" />
                                              <span className="text-xs text-gray-400">
                                                {generating ? '生成中...' : '生成视频'}
                                              </span>
                                            </div>
                                          </button>
                                        );
                                      })()}
                                    </div>
                                    
                                    {/* 提示词显示 */}
                                    <div className="mt-3 pt-3 border-t">
                                      <p className="text-xs text-gray-500 line-clamp-2">
                                        <span className="font-medium">提示词：</span>
                                        {shotDesc}
                                      </p>
                                    </div>
                                  </div>
                                  );
                                })}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })
                ) : (
                  <Card>
                    <CardContent className="flex items-center justify-center h-64">
                      <div className="text-center text-gray-500">
                        <Video className="w-16 h-16 mx-auto mb-4 opacity-50" />
                        <p className="mb-2">暂无视频</p>
                        <p className="text-sm">请在提示词模块为每个镜头生成视频</p>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              </Tabs>
          </div>
        </div>
      </div>

      {/* 图片库选择器 */}
      <ImageLibrarySelector
        open={imageLibraryOpen}
        onClose={() => {
          setImageLibraryOpen(false);
          setLibrarySelectTarget(null);
        }}
        onSelect={handleLibraryImageSelect}
        currentType={librarySelectTarget?.type}
      />

      {/* 图片预览模态框 */}
      {previewImage && (
        <div 
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90"
          onClick={closeImagePreview}
        >
          <div 
            className="relative w-[90vw] h-[90vh] flex flex-col bg-gray-900 rounded-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 工具栏 */}
            <div className="flex items-center justify-between p-3 bg-gray-800 border-b border-gray-700 shrink-0">
              <div className="flex items-center gap-2 text-white">
                <Eye className="w-4 h-4" />
                <span className="text-sm truncate max-w-[300px]" title={previewImage.name}>
                  {previewImage.name}
                </span>
                <Badge variant="secondary" className="text-xs">
                  {previewImage.type === 'scene' ? '场景' : previewImage.type === 'character' ? '人物' : previewImage.type === 'prop' ? '道具' : '故事版'}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                {/* 缩放控制 */}
                <div className="flex items-center gap-1 mr-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handlePreviewZoomOut}
                    className="text-white hover:bg-white/20 h-8 w-8 p-0"
                    disabled={previewZoom <= 0.25}
                  >
                    <ZoomOut className="w-4 h-4" />
                  </Button>
                  <span className="text-white text-xs w-12 text-center">
                    {Math.round(previewZoom * 100)}%
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handlePreviewZoomIn}
                    className="text-white hover:bg-white/20 h-8 w-8 p-0"
                    disabled={previewZoom >= 3}
                  >
                    <ZoomIn className="w-4 h-4" />
                  </Button>
                </div>
                {/* 下载按钮 */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => downloadImage(previewImage.url, previewImage.name)}
                  className="text-white hover:bg-white/20 h-8 w-8 p-0"
                >
                  <Download className="w-4 h-4" />
                </Button>
                {/* 关闭按钮 */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={closeImagePreview}
                  className="text-white hover:bg-white/20 h-8 w-8 p-0"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
            
            {/* 图片容器 */}
            <div className="flex-1 overflow-auto flex items-center justify-center p-4">
              {previewImage.url ? (
                <img
                  src={getDisplayImageUrl(previewImage.url)}
                  alt={previewImage.name}
                  className="max-w-full max-h-full object-contain transition-transform duration-200"
                  style={{ transform: `scale(${previewZoom})` }}
                />
              ) : (
                <div className="text-gray-400">暂无图片</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 存储空间监控 */}
      <StorageMonitor />
    </div>
  );
}
