'use client';

import { Fragment, useState, useCallback, useRef, useEffect, useMemo } from 'react';
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
  Layers3,
  Volume2,
} from 'lucide-react';
import { toast } from 'sonner';
import { AssetsFolderManager } from '@/components/assets-folder-manager';
import { ProjectExporter } from '@/components/project-exporter';
import { CreationPointsWallet } from '@/components/creation-points-wallet';
import { ImageLibrarySelector } from '@/components/image-library-selector';
import { StorageMonitor } from '@/components/storage-monitor';
import { WorkspaceModeSwitch } from '@/components/workspace-mode-switch';
import { PasswordInput } from '@/components/password-input';
import { CharacterVoiceLibrary, type VoiceUploadInput } from '@/components/character-voice-library';
import { OnDemandCollection } from '@/components/on-demand-collection';
import { getAssetPreviewUrl, getAssetThumbnailUrl } from '@/lib/asset-image-url';
import { usePersistentState, usePersistentStateManager, STORAGE_KEYS, TokenUsage, INITIAL_TOKEN_USAGE } from '@/hooks/usePersistentState';
import {
  MIN_DIALOGUE_LINES_FOR_VOICE_PROFILE,
  normalizeVoiceCharacterName,
  resolveVideoVoiceAssignments,
  type CharacterVoiceExtraction,
  type VoiceLibraryItem,
} from '@/lib/character-voice';
import { normalizeExecutionScriptText } from '@/lib/execution-script-format';
import { normalizeCharacterLooks, type CharacterLookChangeType } from '@/lib/character-look-utils';
import {
  formatCharacterBodyProfile,
  hasCharacterBodyProfile,
  inheritBodyProfileForLooks,
  mergeCharacterBodyProfiles,
  normalizeCharacterBodyProfile,
  stripBodyDetailsFromAppearance,
  type CharacterBodyProfile,
} from '@/lib/character-body-profile';
import { getCanonicalEpisodeTitle, normalizeEpisodeChapterTitles } from '@/lib/outline-utils';
import {
  inferCharacterEntityKind,
  normalizeCharacterGender,
  resolveCharacterGenderByPolicy,
} from '@/lib/character-semantic-rules';
import { expandPropStateUnits } from '@/lib/prop-state-utils';
import {
  getSceneMainLocation,
  getSceneStateReasonLabel,
  normalizeSceneLocationIdentity,
  normalizeSceneMarkerIdentity,
  normalizeSceneStateUnits,
} from '@/lib/scene-state-utils';
import {
  formatStoryboardDurationSeconds,
  groupContiguousItemsByDuration,
  STORYBOARD_DURATION_GROUPING_STRATEGY,
  STORYBOARD_GROUP_MAX_SECONDS,
  sumStoryboardDurations,
} from '@/lib/storyboard-duration-groups';

const STORYBOARD_BATCH_CONCURRENCY = 4;

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
  physicalLocation?: string;
  mainSceneName?: string;
  stateLabel?: string;
  stateReason?: string;
  stateReasonLabel?: string;
  stateChangeEvidence?: string;
  stateVisualDifference?: string;
  isIndependentState?: boolean;
  stateSequence?: number;
  totalStates?: number;
  referenceSceneName?: string;
  imageMode?: 'text-to-image' | 'image-to-image' | string;
  episodeNumbers?: number[];
  occurrences?: Array<{
    episodeNumber?: number | null;
    episodeLabel?: string;
    heading?: string;
    stateLabel?: string;
  }>;
  aliases?: string[];
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
  continuityNote?: string;
  changeType?: CharacterLookChangeType;
  ageStage?: string;
  physicalState?: string;
  transformationState?: string;
  bodyProfile?: CharacterBodyProfile;
  bodyChanges?: string;
  episodeNumbers?: number[];
  sceneNames?: string[];
  sourceEvidence?: string;
  referenceLookId?: string;
  referenceReason?: string;
  isBaseLook?: boolean;
  generationPriority?: number;
  identitySourceUrl?: string;
  identityNeedsReview?: boolean;
  imageUrl?: string;
  alternateImageUrls?: string[];
  imagePrompt?: string;
  isCustom?: boolean;
  isGenerating?: boolean;
  generatingStatus?: string;
  generationError?: string;
  fourViewImageUrl?: string;
  fourViewPrompt?: string;
  fourViewIdentitySourceUrl?: string;
  fourViewLookSourceUrl?: string;
  fourViewIdentityNeedsReview?: boolean;
  isGeneratingFourView?: boolean;
  fourViewStatus?: string;
  fourViewError?: string;
  isLifecycleFallback?: boolean;
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
  appearance: string;  // 正脸近景描述（发型、脸型、五官、肤色等）
  faceFeatures: FaceFeatures;  // 脸型特征（保持一致性）
  bodyProfile?: CharacterBodyProfile;  // 全身体态档案，仅用于造型图和四视图
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
  identityImageConfirmed?: boolean;
  confirmedFaceImageUrl?: string;
  identityConfirmedAt?: number;
  aliases?: string[];
  timelineAudit?: {
    status: 'complete' | 'needs-review';
    requiredCount: number;
    coveredCount: number;
    modelAddedCount: number;
    fallbackAddedCount: number;
    missingLabels: string[];
    auditedAt: number;
  };
}

const CHARACTER_LOOK_PRIORITY_STYLES = {
  1: {
    label: 'P1 身份基础',
    cardClass: 'border-emerald-400/35 border-l-4 border-l-emerald-400 bg-emerald-500/[0.04]',
    badgeClass: 'border-emerald-300/45 bg-emerald-500/15 text-emerald-100',
  },
  2: {
    label: 'P2 年龄时期',
    cardClass: 'border-sky-400/35 border-l-4 border-l-sky-400 bg-sky-500/[0.04]',
    badgeClass: 'border-sky-300/45 bg-sky-500/15 text-sky-100',
  },
  3: {
    label: 'P3 场景换装',
    cardClass: 'border-amber-400/35 border-l-4 border-l-amber-400 bg-amber-500/[0.04]',
    badgeClass: 'border-amber-300/45 bg-amber-500/15 text-amber-100',
  },
  4: {
    label: 'P4 身体状态',
    cardClass: 'border-orange-400/35 border-l-4 border-l-orange-400 bg-orange-500/[0.04]',
    badgeClass: 'border-orange-300/45 bg-orange-500/15 text-orange-100',
  },
  5: {
    label: 'P5 特殊/复合',
    cardClass: 'border-fuchsia-400/35 border-l-4 border-l-fuchsia-400 bg-fuchsia-500/[0.04]',
    badgeClass: 'border-fuchsia-300/45 bg-fuchsia-500/15 text-fuchsia-100',
  },
} as const;

function getCharacterLookPriorityStyle(look: CharacterLook) {
  const priority = Math.min(5, Math.max(1, Math.round(Number(look.generationPriority) || 3))) as keyof typeof CHARACTER_LOOK_PRIORITY_STYLES;
  return CHARACTER_LOOK_PRIORITY_STYLES[priority];
}

const PLACEHOLDER_TEXT = /待补充|待完善|暂无|未知|默认造型|温和的性格体现在举止间|根据剧情需要，会有不同的服装搭配/;

function isUsefulText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !PLACEHOLDER_TEXT.test(value);
}

function isUsefulList(value: unknown): value is string[] {
  return Array.isArray(value) && value.some(item => isUsefulText(item));
}

function normalizeDisplayText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function compactDisplayText(value: unknown, maxChars = 36): string {
  const text = normalizeDisplayText(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

function CompactBadge({
  text,
  maxChars = 18,
  className = '',
  variant = 'outline',
}: {
  text: unknown;
  maxChars?: number;
  className?: string;
  variant?: 'default' | 'secondary' | 'destructive' | 'outline';
}) {
  const fullText = normalizeDisplayText(text);
  if (!fullText) return null;

  return (
    <Badge
      variant={variant}
      className={`max-w-full shrink overflow-hidden text-xs ${className}`}
      title={fullText}
    >
      <span className="min-w-0 truncate">{compactDisplayText(fullText, maxChars)}</span>
    </Badge>
  );
}

function AssetGenerationPlaceholder({ status }: { status?: string }) {
  return (
    <div
      className="relative flex h-full min-h-[150px] w-full flex-col items-center justify-center overflow-hidden bg-black/45 px-4 text-center"
      role="status"
      aria-live="polite"
    >
      <div className="absolute inset-2 rounded-md border border-amber-300/20 animate-pulse" />
      <div className="absolute inset-x-8 top-1/2 h-px bg-amber-300/20 animate-pulse" />
      <div className="relative flex size-12 items-center justify-center rounded-full border border-amber-300/35 bg-amber-400/10 shadow-[0_0_24px_rgba(251,191,36,0.18)]">
        <Loader2 className="size-6 animate-spin text-amber-200" />
      </div>
      <div className="relative mt-3 text-sm font-medium text-amber-100">图片生成处理中</div>
      <div className="relative mt-1 max-w-full truncate text-xs text-amber-100/60" title={status || '请求已提交，正在处理'}>
        {status || '请求已提交，正在处理'}
      </div>
      <div className="relative mt-3 flex items-center gap-1">
        <span className="size-1.5 animate-pulse rounded-full bg-amber-300/45" />
        <span className="size-1.5 animate-pulse rounded-full bg-amber-300/70 [animation-delay:180ms]" />
        <span className="size-1.5 animate-pulse rounded-full bg-amber-200 [animation-delay:360ms]" />
      </div>
    </div>
  );
}

async function readImageGenerationResponse(response: Response, fallback: string): Promise<any> {
  const responseText = await response.text();
  let payload: any = null;
  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch {
    payload = null;
  }

  if (payload && typeof payload === 'object') {
    if (!payload.success && !payload.error && payload.details) {
      return { ...payload, error: String(payload.details) };
    }
    return payload;
  }

  const statusReason = response.status === 401
    ? '登录状态已失效，请重新登录后再试'
    : response.status === 402
      ? '创作点不足，无法开始图片生成'
      : response.status === 408 || response.status === 504
        ? '图片服务等待超时，请稍后重试'
        : response.status === 429
          ? '图片服务请求过于频繁，请稍后再试'
          : response.status >= 500
            ? `图片服务异常（HTTP ${response.status}）`
            : response.status >= 400
              ? `图片请求被拒绝（HTTP ${response.status}）`
              : fallback;

  return { success: false, error: statusReason };
}

function getImageRequestFailureReason(error: unknown, operation: string): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return `${operation}等待超时，后台任务可能仍在处理，系统会继续检查结果`;
  }
  if (error instanceof TypeError) {
    return `${operation}时网络连接中断，请检查网络；后台若已完成，图片会自动补回`;
  }
  if (error instanceof Error && error.message.trim()) {
    return `${operation}失败：${error.message.trim()}`;
  }
  return `${operation}失败：未知错误`;
}

function AssetGenerationFailure({ reason }: { reason: string }) {
  return (
    <div
      className="flex max-w-full items-start gap-2 rounded-md border border-red-400/35 bg-red-950/35 px-3 py-2 text-left text-xs leading-5 text-red-100"
      role="alert"
      title={reason}
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red-300" />
      <div className="min-w-0">
        <div className="font-medium text-red-200">图片生成失败</div>
        <div className="break-words text-red-100/80 [overflow-wrap:anywhere]">{reason}</div>
      </div>
    </div>
  );
}

function AssetImageStack({
  images,
  name,
  type,
  generationStatus,
  failureReason,
  isGenerating,
  isAssetsConfirmed,
  onOpenChooser,
  onPreview,
  onGenerateFromImage,
  onDownload,
  onRemove,
}: {
  images: AssetSingleImage[];
  name: string;
  type: 'scene' | 'character' | 'prop';
  generationStatus?: string;
  failureReason?: string;
  isGenerating: boolean;
  isAssetsConfirmed: boolean;
  onOpenChooser: () => void;
  onPreview: (image: AssetSingleImage) => void;
  onGenerateFromImage: (image: AssetSingleImage) => void;
  onDownload: (image: AssetSingleImage) => void;
  onRemove: (image: AssetSingleImage) => void;
}) {
  const [showHoverPreviews, setShowHoverPreviews] = useState(false);
  const completedImages = images.filter(image => Boolean(image.imageUrl) && !image.isGenerating);
  const primaryImage = completedImages[0];
  const ghostImages = completedImages.slice(1, MAX_IMAGES_PER_ASSET);
  const isPortrait = type === 'character';
  const frameClass = isPortrait
    ? 'aspect-[4/5] min-h-[260px] w-full'
    : 'aspect-video min-h-[150px] w-full sm:min-h-[180px]';
  const objectClass = isPortrait ? 'object-cover object-top' : 'object-cover';
  const typeLabel = type === 'scene' ? '场景' : type === 'character' ? '人物' : '道具';
  const EmptyIcon = type === 'scene' ? ImageIcon : type === 'character' ? Users : Package;

  if (!primaryImage) {
    if (isGenerating) {
      return (
        <div className={`overflow-hidden rounded-md border border-amber-300/35 bg-black/35 ${frameClass}`}>
          <AssetGenerationPlaceholder status={generationStatus} />
        </div>
      );
    }
    return (
      <div className="space-y-2">
        <div className={`flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-amber-400/25 bg-black/20 text-amber-100/45 ${frameClass}`}>
          <EmptyIcon className="size-9" />
          <span className="text-xs">尚未生成{typeLabel}图</span>
        </div>
        {failureReason && <AssetGenerationFailure reason={failureReason} />}
      </div>
    );
  }

  return (
    <div
      className={`group/stack relative ${ghostImages.length > 0 ? 'mb-4 mr-2' : ''}`}
      onMouseEnter={() => setShowHoverPreviews(true)}
      onMouseLeave={() => setShowHoverPreviews(false)}
    >
      <div className={`relative ${frameClass}`}>
        {ghostImages.map((image, index) => (
          <div
            key={`ghost-${image.imageId}`}
            className={`pointer-events-none absolute inset-0 overflow-hidden rounded-md border border-amber-300/30 bg-[linear-gradient(145deg,rgba(251,191,36,0.12),rgba(0,0,0,0.92))] shadow-[0_8px_24px_rgba(0,0,0,0.55)] transition-all duration-300 ${
              index === 0
                ? 'translate-x-1 translate-y-2 opacity-55 group-hover/stack:translate-x-2 group-hover/stack:translate-y-3 group-hover/stack:opacity-80'
                : 'translate-x-2 translate-y-4 opacity-30 group-hover/stack:translate-x-4 group-hover/stack:translate-y-5 group-hover/stack:opacity-60'
            }`}
            style={{ zIndex: 10 - index }}
            aria-hidden="true"
          />
        ))}

        <button
          type="button"
          className="relative z-20 block h-full w-full overflow-hidden rounded-md border border-amber-400/25 bg-black/35 text-left shadow-[0_12px_32px_rgba(0,0,0,0.42)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          onClick={() => completedImages.length > 1 ? onOpenChooser() : onPreview(primaryImage)}
          title={completedImages.length > 1 ? `点击选择「${name}」主图` : `预览「${name}」`}
          aria-label={completedImages.length > 1 ? `选择${name}主图` : `预览${name}图片`}
        >
          <img
            src={getAssetThumbnailUrl(primaryImage.imageUrl, isPortrait ? 640 : 960)}
            alt={name}
            loading="lazy"
            decoding="async"
            fetchPriority="low"
            className={`h-full w-full transition duration-300 group-hover/stack:brightness-90 ${objectClass}`}
            onError={(event) => {
              const image = event.currentTarget;
              if (image.dataset.originalFallback === 'true') return;
              image.dataset.originalFallback = 'true';
              image.src = primaryImage.imageUrl;
            }}
          />
          {completedImages.length > 1 && (
            <>
              <div className="absolute bottom-2 right-2 rounded border border-amber-300/30 bg-black/75 px-2 py-1 text-[11px] font-medium text-amber-100 backdrop-blur-sm">
                主图 · 共 {completedImages.length} 张
              </div>
              {showHoverPreviews && (
              <div className="pointer-events-none absolute bottom-2 left-2 z-30 flex max-w-[70%] gap-1.5 opacity-0 transition-all duration-200 group-hover/stack:opacity-100">
                {completedImages.map((image, index) => (
                  <div
                    key={`hover-preview-${image.imageId}`}
                    className={`h-10 w-14 overflow-hidden rounded border bg-black/80 shadow-lg ${index === 0 ? 'border-amber-300' : 'border-white/30'}`}
                  >
                    <img
                      src={getAssetThumbnailUrl(image.imageUrl, 240, 66)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className={`h-full w-full ${objectClass}`}
                    />
                  </div>
                ))}
              </div>
              )}
            </>
          )}
          {primaryImage.isCustom && completedImages.length === 1 && (
            <Badge className="absolute bottom-2 left-2 text-[10px]" variant="secondary">
              自定义
            </Badge>
          )}
        </button>

        {isGenerating && (
          <div className="pointer-events-none absolute left-2 top-2 z-30 flex max-w-[60%] items-center gap-1.5 rounded border border-amber-300/30 bg-black/75 px-2 py-1 text-[11px] text-amber-100 backdrop-blur-sm">
            <Loader2 className="size-3 animate-spin" />
            <span className="truncate">{generationStatus || '正在生成新图'}</span>
          </div>
        )}

        <div className="absolute right-2 top-2 z-40 flex gap-1 rounded-md border border-amber-300/20 bg-black/75 p-1 opacity-100 shadow-lg backdrop-blur-sm transition-opacity sm:opacity-0 sm:group-hover/stack:opacity-100">
          <Button
            size="icon"
            variant="secondary"
            className="h-7 w-7 min-w-0 border-0 bg-transparent p-0 text-amber-50 hover:bg-amber-400/20"
            title="预览主图"
            aria-label={`预览${typeLabel}主图`}
            onClick={() => onPreview(primaryImage)}
          >
            <Eye className="size-3.5" />
          </Button>
          {!isAssetsConfirmed && (
            <Button
              size="icon"
              variant="secondary"
              className="h-7 w-7 min-w-0 border-0 bg-transparent p-0 text-amber-50 hover:bg-amber-400/20"
              title="以主图为参考生成新图"
              aria-label={`以此${typeLabel}主图为参考生成新图`}
              onClick={() => onGenerateFromImage(primaryImage)}
            >
              <Copy className="size-3.5" />
            </Button>
          )}
          <Button
            size="icon"
            variant="secondary"
            className="h-7 w-7 min-w-0 border-0 bg-transparent p-0 text-amber-50 hover:bg-amber-400/20"
            title="下载主图"
            aria-label={`下载${typeLabel}主图`}
            onClick={() => onDownload(primaryImage)}
          >
            <Download className="size-3.5" />
          </Button>
          {!isAssetsConfirmed && (
            <Button
              size="icon"
              variant="destructive"
              className="h-7 w-7 min-w-0 border-0 bg-transparent p-0 text-red-200 hover:bg-red-500/20"
              title="取消选中主图（图片仍在图片库中）"
              aria-label={`移除${typeLabel}主图`}
              onClick={() => onRemove(primaryImage)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      {failureReason && !isGenerating && (
        <div className="mt-2">
          <AssetGenerationFailure reason={failureReason} />
        </div>
      )}
    </div>
  );
}

function normalizeGenderValue(value?: string): string {
  return normalizeCharacterGender(value);
}

function inferCharacterGender(name: string, current?: string): string {
  return resolveCharacterGenderByPolicy({
    name,
    currentGender: current,
    character: { name },
  });
}

function characterTextContradictsGender(value: unknown, gender: string): boolean {
  if (gender !== '男' && gender !== '女') return false;
  const text = Array.isArray(value) || (value && typeof value === 'object')
    ? JSON.stringify(value)
    : String(value || '');
  if (gender === '女') return /男性角色|男士|男装|男人|男孩|男生/.test(text);
  return /女性角色|女士|女装|女人|女孩|女生/.test(text);
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
  if (inferCharacterEntityKind(character as Record<string, any>) === 'animal-creature') {
    return `${name}是动物特征占主导的奇幻生物。头骨、吻部、兽耳、眼睛、鼻头、牙齿和皮毛符合剧本物种设定，毛发顺应动物头骨与身体结构生长；不使用人类皮肤、人类五官比例、女性长发、披发、马尾或其他人类发型。`;
  }
  const gender = inferCharacterGender(name, character.gender);
  const age = inferCharacterAge(name, character.age);
  const personality = inferCharacterPersonality(name, character.personality)[0];
  const genderRole = gender === '男' || gender === '女' ? `${gender}性角色` : '角色';
  const facialStyle = gender === '女'
    ? '发型轮廓自然清晰，面部线条柔和且有辨识度，眼神灵动，鼻唇比例协调'
    : gender === '男'
      ? '发型干净利落，面部轮廓清晰稳定，眉眼有辨识度，鼻唇比例自然'
      : '发型与面部轮廓清晰稳定，固定五官具有辨识度，神态自然';
  return `${name}是${age}的${genderRole}，${personality}。${facialStyle}，肤色均匀，皮肤清爽并保留自然纹理；正脸近景中的表情和眼神符合人物身份，固定面部辨识特征清晰稳定。`;
}

function buildCharacterBodyProfile(character: Partial<Character>): CharacterBodyProfile {
  const isAnimalCreature = inferCharacterEntityKind(character as Record<string, any>) === 'animal-creature';
  const gender = inferCharacterGender(character.name || '该人物', character.gender);
  const defaults: CharacterBodyProfile = isAnimalCreature ? {
    height: '',
    weight: '',
    bodyType: '动物特征占主导的奇幻生物体型，解剖结构符合剧本物种设定',
    shoulderWaist: '肩背、胸腔与腰腹结构符合动物或兽类解剖',
    limbProportions: '四肢、爪、尾巴与头身比例符合物种设定',
    posture: '按剧本保持四足或明确的人形兽类姿态',
  } : {
    height: '',
    weight: '',
    bodyType: gender === '女'
      ? '自然匀称，体型与年龄和身份协调'
      : gender === '男'
        ? '自然匀称，体格与年龄和身份协调'
        : '自然比例，体型与年龄和身份协调',
    shoulderWaist: gender === '男' ? '肩腰比例自然，骨架稳定' : '肩腰比例自然，骨架协调',
    limbProportions: '四肢比例自然，符合人物年龄阶段',
    posture: '体态自然，站姿符合人物身份与剧情状态',
  };
  return mergeCharacterBodyProfiles(
    normalizeCharacterBodyProfile(character.bodyProfile, character.appearance),
    defaults
  );
}

function buildCharacterFaceFeatures(character: Partial<Character>): FaceFeatures {
  const name = character.name || '该人物';
  if (inferCharacterEntityKind(character as Record<string, any>) === 'animal-creature') {
    return {
      faceShape: '符合物种的动物头骨与吻部轮廓，动物特征占主导',
      eyes: '符合剧情设定的兽类眼睛，目光与情绪清晰',
      nose: '动物鼻头与吻部结构清楚，不使用人类鼻型',
      mouth: '兽类口吻与牙齿结构，不使用人类唇形',
      skinTone: '符合物种设定的皮毛、鳞片或兽类表面材质',
    };
  }
  const gender = inferCharacterGender(name, character.gender);
  return {
    faceShape: gender === '女' ? '鹅蛋脸或柔和椭圆脸，轮廓自然清晰' : gender === '男' ? '椭圆脸或方中带圆的脸型，轮廓稳定' : '自然写实脸型，轮廓清晰稳定',
    eyes: gender === '女' ? '眼型清晰有神，情绪表达明显' : gender === '男' ? '眼神专注，眉眼有辨识度' : '眼神清晰，情绪表达自然',
    nose: '鼻梁自然端正，符合写实真人比例',
    mouth: gender === '女' ? '唇形自然，表情变化细腻' : gender === '男' ? '唇线清楚，表情克制有力度' : '唇形自然，表情变化符合剧情',
    skinTone: gender === '女' ? '自然肤色，质感干净' : gender === '男' ? '自然健康肤色，保留真实皮肤质感' : '自然肤色，保留真实皮肤质感',
  };
}

function buildCharacterLook(character: Partial<Character>): CharacterLook {
  const name = character.name || '该人物';
  const isAnimalCreature = inferCharacterEntityKind(character as Record<string, any>) === 'animal-creature';
  const gender = inferCharacterGender(name, character.gender);
  return {
    id: 'look-1',
    scene: '默认造型',
    description: `${name}的基础出场造型，保持脸型和五官一致，服装根据人物身份与剧情阶段呈现写实短剧质感。`,
    costume: isAnimalCreature ? '无；除非剧本明确要求护甲、项圈或装饰' : gender === '女' ? '简洁生活装或职业装，颜色自然，方便在不同场景延展' : gender === '男' ? '简洁日常装或商务装，剪裁利落，贴合人物身份' : '简洁写实服装，颜色自然，贴合人物身份',
    hairstyle: isAnimalCreature ? '毛发顺应动物头骨与身体结构生长，不使用任何人类发型' : gender === '女' ? '自然披发、低马尾或利落短发，根据场景微调' : gender === '男' ? '干净短发或自然整理发型' : '自然整理发型，贴合人物身份',
    accessories: [],
    makeup: isAnimalCreature ? '无；保持动物面部与皮毛自然材质' : gender === '女' ? '自然淡妆' : gender === '男' ? '自然无妆或轻微修饰' : '自然妆造',
    mood: '自然',
    changeType: '基础造型',
    ageStage: character.age || '主要时期',
    physicalState: '正常状态',
    transformationState: '',
    bodyProfile: buildCharacterBodyProfile(character),
    bodyChanges: '',
    episodeNumbers: [],
    sceneNames: ['默认造型'],
    referenceLookId: '',
    referenceReason: '直接参考已确认的人物正脸身份基准图',
    isBaseLook: true,
    generationPriority: 1,
  };
}

function repairCharacterLookSemanticDefaults(
  look: CharacterLook,
  gender: string,
  isAnimalCreature: boolean,
  genderWasCorrected: boolean
): CharacterLook {
  if (isAnimalCreature) {
    return {
      ...look,
      costume: !isUsefulText(look.costume) || /生活装|职业装|商务装/.test(look.costume)
        ? '无；除非剧本明确要求护甲、项圈或装饰'
        : look.costume,
      hairstyle: !isUsefulText(look.hairstyle) || /披发|马尾|盘发|短发|人类发型/.test(look.hairstyle)
        ? '毛发顺应动物头骨与身体结构生长，不使用任何人类发型'
        : look.hairstyle,
      makeup: !isUsefulText(look.makeup) || /淡妆|浓妆|修饰/.test(look.makeup)
        ? '无；保持动物面部与皮毛自然材质'
        : look.makeup,
    };
  }
  if (!genderWasCorrected) return look;
  if (gender === '男') {
    return {
      ...look,
      costume: /简洁生活装或职业装/.test(look.costume || '')
        ? '简洁日常装或商务装，剪裁利落，贴合人物身份'
        : look.costume,
      hairstyle: /自然披发|低马尾|盘发/.test(look.hairstyle || '')
        ? '干净短发或自然整理发型'
        : look.hairstyle,
      makeup: /自然淡妆|精致妆容/.test(look.makeup || '')
        ? '自然无妆或轻微修饰'
        : look.makeup,
    };
  }
  return look;
}

function normalizeCharacterVisualInfo(character: Character): Character {
  const isAnimalCreature = inferCharacterEntityKind(character as unknown as Record<string, any>) === 'animal-creature';
  const normalized: Character = {
    ...character,
    role: inferCharacterRole(character.name, character.role),
    age: inferCharacterAge(character.name, character.age),
    gender: inferCharacterGender(character.name, character.gender),
    personality: inferCharacterPersonality(character.name, character.personality),
  };
  const originalGender = normalizeGenderValue(character.gender);
  const genderWasCorrected = Boolean(originalGender && originalGender !== '待定' && originalGender !== normalized.gender);

  const faceOnlyAppearance = stripBodyDetailsFromAppearance(character.appearance);
  const hasUsableAnimalAppearance = isAnimalCreature && /犬|狼|兽|动物|吻部|皮毛|兽毛|四足|爪|獠牙/.test(faceOnlyAppearance) && !/女性角色|人类皮肤|女性长发/.test(faceOnlyAppearance);
  normalized.appearance = isUsefulText(faceOnlyAppearance) && !genderWasCorrected && (hasUsableAnimalAppearance || (!isAnimalCreature && !characterTextContradictsGender(faceOnlyAppearance, normalized.gender)))
    ? faceOnlyAppearance
    : buildCharacterAppearance(normalized);

  normalized.bodyProfile = buildCharacterBodyProfile({
    ...normalized,
    bodyProfile: character.bodyProfile,
    appearance: character.appearance,
  });

  const defaultFaceFeatures = buildCharacterFaceFeatures(normalized);
  normalized.faceFeatures = {
    faceShape: !genderWasCorrected && isUsefulText(character.faceFeatures?.faceShape) ? character.faceFeatures.faceShape : defaultFaceFeatures.faceShape,
    eyes: !genderWasCorrected && isUsefulText(character.faceFeatures?.eyes) ? character.faceFeatures.eyes : defaultFaceFeatures.eyes,
    nose: !genderWasCorrected && isUsefulText(character.faceFeatures?.nose) ? character.faceFeatures.nose : defaultFaceFeatures.nose,
    mouth: !genderWasCorrected && isUsefulText(character.faceFeatures?.mouth) ? character.faceFeatures.mouth : defaultFaceFeatures.mouth,
    skinTone: !genderWasCorrected && isUsefulText(character.faceFeatures?.skinTone) ? character.faceFeatures.skinTone : defaultFaceFeatures.skinTone,
  };

  const defaultLook = buildCharacterLook(normalized);
  const sourceLooks = (normalizeCharacterLooks(character.looks, defaultLook, normalized.age) as CharacterLook[])
    .map(look => repairCharacterLookSemanticDefaults(look, normalized.gender, isAnimalCreature, genderWasCorrected));
  normalized.looks = inheritBodyProfileForLooks(
    sourceLooks,
    normalized.bodyProfile
  );

  normalized.identityImageConfirmed = Boolean(
    character.identityImageConfirmed && isUsefulText(character.confirmedFaceImageUrl)
  );
  normalized.confirmedFaceImageUrl = normalized.identityImageConfirmed
    ? character.confirmedFaceImageUrl
    : undefined;
  normalized.identityConfirmedAt = normalized.identityImageConfirmed
    ? character.identityConfirmedAt
    : undefined;

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
  mainPropName?: string;
  sourcePropName?: string;
  isStateUnit?: boolean;
  stateUnitId?: string;
  stateSequence?: number;
  totalStates?: number;
  type: string;
  importance: string;
  description: string;
  appearanceScenes: string[];
  owner: string;
  function: string;
  visualDescription: string;
  stateLabel?: string;
  referencePropName?: string;
  referenceStateId?: string;
  stateVisualChange?: string;
  stateTransitionEvent?: string;
  stateNarrativeFunction?: string;
  stateEvidence?: string;
  imageMode?: 'text-to-image' | 'image-to-image' | string;
  episodeNumbers?: number[];
  occurrences?: Array<{
    episodeNumber?: number | null;
    episodeLabel?: string;
    sceneName?: string;
    heading?: string;
    stateLabel?: string;
  }>;
  stateVariants?: Array<{
    id: string;
    stateName: string;
    scene: string;
    stage: string;
    description: string;
    visualChange: string;
    transitionEvent?: string;
    narrativeFunction?: string;
    evidence?: string;
    referenceFromStateId: string;
    imageMode: 'text-to-image' | 'image-to-image' | string;
    episodeNumbers?: number[];
    occurrences?: Array<{
      episodeNumber?: number | null;
      episodeLabel?: string;
      sceneName?: string;
      heading?: string;
      stateLabel?: string;
    }>;
  }>;
  notes: string;
  aliases?: string[];
}

interface SceneRenderItem {
  scene: Scene;
  sourceIndex: number;
  mainSceneName: string;
  shouldShowMainSceneHeader: boolean;
  siblingStateCount: number;
  siblingStateIndex: number;
  siblingEpisodeNumbers: number[];
}

interface PropRenderItem {
  prop: Prop;
  sourceIndex: number;
  mainPropName: string;
  shouldShowMainPropHeader: boolean;
  siblingStateCount: number;
  siblingEpisodeNumbers: number[];
}

const getSceneMainSceneName = (scene: Scene) => getSceneMainLocation(scene) || scene.name;

const getSceneEpisodeNumbers = (scene: Scene): number[] => {
  const fromEpisodes = Array.isArray(scene.episodeNumbers)
    ? scene.episodeNumbers.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
    : [];
  const fromOccurrences = Array.isArray(scene.occurrences)
    ? scene.occurrences
      .map(item => item.episodeNumber)
      .filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
    : [];
  return Array.from(new Set([...fromEpisodes, ...fromOccurrences])).sort((a, b) => a - b);
};

const formatSceneEpisodeText = (scene: Scene) => {
  const episodeNumbers = getSceneEpisodeNumbers(scene);
  if (episodeNumbers.length > 0) {
    return episodeNumbers.length <= 4
      ? episodeNumbers.map(item => `第${item}集`).join('、')
      : `${episodeNumbers.slice(0, 4).map(item => `第${item}集`).join('、')} 等${episodeNumbers.length}集`;
  }
  const labels = Array.isArray(scene.occurrences)
    ? scene.occurrences
      .map(item => item.episodeLabel)
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  return Array.from(new Set(labels)).join('、') || '未关联集数';
};

const getPropMainPropName = (prop: Prop) => (
  prop.mainPropName ||
  String(prop.name || '')
    .replace(/[【\[]\s*(?:完整|基准|原始|破碎|碎裂|损坏|破损|裂开|断裂|旧化|陈旧|老旧|沾血|染血|血迹|烧毁|焦黑|修复|修好|打开|关闭|空的|空置|空瓶|空盒|空状态|装满|改造前|改造后|十年前|10年前|十年后|10年后|遗失|失效)\s*[】\]]/g, '')
    .replace(/（\s*(?:完整|基准|原始|破碎|碎裂|损坏|破损|裂开|断裂|旧化|陈旧|老旧|沾血|染血|血迹|烧毁|焦黑|修复|修好|打开|关闭|空的|空置|空瓶|空盒|空状态|装满|改造前|改造后|十年前|10年前|十年后|10年后|遗失|失效)(?:状态)?\s*）/g, '')
    .replace(/\(\s*(?:完整|基准|原始|破碎|碎裂|损坏|破损|裂开|断裂|旧化|陈旧|老旧|沾血|染血|血迹|烧毁|焦黑|修复|修好|打开|关闭|空的|空置|空瓶|空盒|空状态|装满|改造前|改造后|十年前|10年前|十年后|10年后|遗失|失效)(?:状态)?\s*\)/g, '')
    .replace(/^(?:完整|基准|原始|破碎|碎裂|损坏|破损|裂开|断裂|旧化|陈旧|老旧|沾血|染血|血迹|烧毁|焦黑|修复|修好|打开|关闭|空的|空置|空瓶|空盒|空状态|装满|改造前|改造后|十年前|10年前|十年后|10年后|遗失|失效)的?/g, '')
    .replace(/(?:完整|基准|原始|破碎|碎裂|损坏|破损|裂开|断裂|旧化|陈旧|老旧|沾血|染血|血迹|烧毁|焦黑|修复|修好|打开|关闭|空的|空置|空瓶|空盒|空状态|装满|改造前|改造后|十年前|10年前|十年后|10年后|遗失|失效)(?:状态|版|后|前)?$/g, '')
    .replace(/\s+/g, '')
    .trim() ||
  prop.name
);

const getPropEpisodeNumbers = (prop: Prop): number[] => {
  const fromEpisodes = Array.isArray(prop.episodeNumbers)
    ? prop.episodeNumbers.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
    : [];
  const fromOccurrences = Array.isArray(prop.occurrences)
    ? prop.occurrences
      .map(item => item.episodeNumber)
      .filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
    : [];
  const fromStates = !prop.isStateUnit && Array.isArray(prop.stateVariants)
    ? prop.stateVariants.flatMap(state => (
        Array.isArray(state.episodeNumbers)
          ? state.episodeNumbers.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
          : []
      ))
    : [];
  return Array.from(new Set([...fromEpisodes, ...fromOccurrences, ...fromStates])).sort((a, b) => a - b);
};

const formatPropEpisodeText = (prop: Prop) => {
  const episodeNumbers = getPropEpisodeNumbers(prop);
  if (episodeNumbers.length > 0) {
    return episodeNumbers.length <= 4
      ? episodeNumbers.map(item => `第${item}集`).join('、')
      : `${episodeNumbers.slice(0, 4).map(item => `第${item}集`).join('、')} 等${episodeNumbers.length}集`;
  }
  const labels = [
    ...(Array.isArray(prop.occurrences)
      ? prop.occurrences
        .map(item => item.episodeLabel)
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : []),
    ...(!prop.isStateUnit && Array.isArray(prop.stateVariants)
      ? prop.stateVariants.flatMap(state => (
          Array.isArray(state.occurrences)
            ? state.occurrences
              .map(item => item.episodeLabel)
              .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            : []
        ))
      : []),
  ];
  return Array.from(new Set(labels)).join('、') || '未关联集数';
};

const getPropStateCount = (prop: Prop) => (
  prop.isStateUnit ? 1 : (Array.isArray(prop.stateVariants) && prop.stateVariants.length > 0 ? prop.stateVariants.length : 1)
);

function buildSceneRenderItems(scenes: Scene[]): SceneRenderItem[] {
  const groups = new Map<string, { stateCount: number; episodeNumbers: Set<number> }>();
  const prepared = scenes.map((scene, sourceIndex) => {
    const mainSceneName = getSceneMainSceneName(scene);
    const group = groups.get(mainSceneName) || { stateCount: 0, episodeNumbers: new Set<number>() };
    const siblingStateIndex = group.stateCount;
    group.stateCount += 1;
    getSceneEpisodeNumbers(scene).forEach(episode => group.episodeNumbers.add(episode));
    groups.set(mainSceneName, group);
    return { scene, sourceIndex, mainSceneName, siblingStateIndex };
  });

  return prepared.map((entry, index) => {
    const group = groups.get(entry.mainSceneName)!;
    return {
      ...entry,
      shouldShowMainSceneHeader: index === 0 || prepared[index - 1].mainSceneName !== entry.mainSceneName,
      siblingStateCount: group.stateCount,
      siblingEpisodeNumbers: Array.from(group.episodeNumbers).sort((a, b) => a - b),
    };
  });
}

function buildPropRenderItems(props: Prop[]): PropRenderItem[] {
  type PreparedProp = {
    prop: Prop;
    sourceIndex: number;
    mainPropName: string;
    groupKey: string;
  };
  type PropGroup = {
    mainPropName: string;
    stateCount: number;
    episodeNumbers: Set<number>;
    entries: PreparedProp[];
  };

  const groups = new Map<string, PropGroup>();
  const groupOrder: string[] = [];

  props.forEach((prop, sourceIndex) => {
    const mainPropName = getPropMainPropName(prop);
    const groupKey = mainPropName.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase();
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        mainPropName,
        stateCount: 0,
        episodeNumbers: new Set<number>(),
        entries: [],
      };
      groups.set(groupKey, group);
      groupOrder.push(groupKey);
    }
    group.stateCount += getPropStateCount(prop);
    getPropEpisodeNumbers(prop).forEach(episode => group.episodeNumbers.add(episode));
    group.entries.push({ prop, sourceIndex, mainPropName: group.mainPropName, groupKey });
  });

  const prepared = groupOrder.flatMap(groupKey => {
    const group = groups.get(groupKey)!;
    return [...group.entries].sort((a, b) => {
      const aHasReference = Boolean(a.prop.referencePropName?.trim());
      const bHasReference = Boolean(b.prop.referencePropName?.trim());
      const aSequence = typeof a.prop.stateSequence === 'number' && Number.isFinite(a.prop.stateSequence)
        ? a.prop.stateSequence
        : aHasReference ? Number.MAX_SAFE_INTEGER : 1;
      const bSequence = typeof b.prop.stateSequence === 'number' && Number.isFinite(b.prop.stateSequence)
        ? b.prop.stateSequence
        : bHasReference ? Number.MAX_SAFE_INTEGER : 1;
      if (aSequence !== bSequence) return aSequence - bSequence;
      if (aHasReference !== bHasReference) return aHasReference ? 1 : -1;

      const aFirstEpisode = getPropEpisodeNumbers(a.prop)[0] ?? Number.MAX_SAFE_INTEGER;
      const bFirstEpisode = getPropEpisodeNumbers(b.prop)[0] ?? Number.MAX_SAFE_INTEGER;
      if (aFirstEpisode !== bFirstEpisode) return aFirstEpisode - bFirstEpisode;
      return a.sourceIndex - b.sourceIndex;
    });
  });

  return prepared.map((entry, index) => {
    const group = groups.get(entry.groupKey)!;
    return {
      ...entry,
      shouldShowMainPropHeader: index === 0 || prepared[index - 1].groupKey !== entry.groupKey,
      siblingStateCount: group.stateCount,
      siblingEpisodeNumbers: Array.from(group.episodeNumbers).sort((a, b) => a - b),
    };
  });
}

interface Shot {
  shotNumber: number;
  shotType: string;
  description: string;
  characters: Array<{
    name: string;
    lookId?: string;
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

type CreationType = '仿真人' | '3D' | '动漫';
type CreationRegion = '国内' | '国外';
type CreationBackground = '近代' | '现代' | '古代';

interface CreationBibleSettings {
  creationType: CreationType | '';
  subjectRegion: CreationRegion | '';
  creationBackground: CreationBackground | '';
  confirmed: boolean;
}

type CreationBiblePayload = Pick<
  CreationBibleSettings,
  'creationType' | 'subjectRegion' | 'creationBackground'
>;

const DEFAULT_CREATION_BIBLE: CreationBibleSettings = {
  creationType: '',
  subjectRegion: '',
  creationBackground: '',
  confirmed: false,
};

const CREATION_TYPE_OPTIONS: Array<{ value: CreationType; label: string; description: string }> = [
  { value: '仿真人', label: '仿真人', description: '真人实拍质感，真实皮肤、材质和电影摄影' },
  { value: '3D', label: '3D', description: 'CG 立体角色与空间，模型感和材质统一' },
  { value: '动漫', label: '动漫', description: '动画镜头语言，线条、色块和造型更明确' },
];

const CREATION_REGION_OPTIONS: Array<{ value: CreationRegion; label: string; description: string }> = [
  { value: '国内', label: '国内', description: '中国语境、中文生活空间、服饰和社会关系' },
  { value: '国外', label: '国外', description: '海外语境、国际化空间、服饰和文化细节' },
];

const CREATION_BACKGROUND_OPTIONS: Array<{ value: CreationBackground; label: string; description: string }> = [
  { value: '近代', label: '近代', description: '近代社会语境，服饰、建筑、交通和器物体现年代质感' },
  { value: '现代', label: '现代', description: '现代生活语境，空间、服装、设备和社会细节贴近当代' },
  { value: '古代', label: '古代', description: '古代历史语境，服饰、建筑、礼制和器物符合传统时代' },
];

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

// 提示词组 - 连续镜头按实际时长打包，单组不超过15秒
interface PromptGroup {
  groupIndex: number;
  shotNumbers: number[];
  totalDuration?: number;        // 本组镜头实际总时长（兼容旧项目时可缺省）
  groupingStrategy?: string;     // 新分组使用 duration-14-15-v1
  combinedPrompt: string;      // 合并后的连贯故事版面板描述
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
  promptGroups?: PromptGroup[];      // 按连续镜头实际时长分组（含故事板）
  shotVideos?: ShotVideos[];     // 每个镜头的视频列表
}
interface AssetSingleImage {
  imageId: string; // 唯一标识
  imageUrl: string;
  imageKey?: string; // 可选，云端存储的key
  isCustom?: boolean;
  isFromLibrary?: boolean; // 是否来自图片库
  originalName?: string; // 原始文件名
  prompt?: string; // 图片生成时接口实际使用的提示词
  promptSource?: 'actual' | 'rebuilt' | 'uploaded';
  isGenerating?: boolean;
  generatingStatus?: string;
  lookId?: string; // 新增：对应的造型ID（如：look-1, look-2）
  lookScene?: string; // 新增：对应的造型场景（如：初见、战斗）
  isImg2Img?: boolean;
}

// 素材图片集合 - 每个素材可以有多张图片
interface AssetImages {
  assetId: string; // scene-{id} 或 character-{id} 或 prop-{id}
  type: 'scene' | 'character' | 'prop';
  name: string;
  images: AssetSingleImage[];
  lookImages?: Record<string, AssetSingleImage[]>; // 新增：按造型ID存储图片（仅人物使用）
}

interface RestoredAssetImage {
  name: string;
  url: string;
  timestamp: number;
}

function getAssetStorageFileBase(value: unknown): string {
  return String(value || '')
    .replace(/[<>:"/\\|?*\s]+/g, '_')
    .slice(0, 80);
}

function normalizeAssetIdentity(value: unknown): string {
  return String(value || '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_<>:"/\\|?*]+/g, '');
}

function getLinkedEpisodeNumbers(value: any): number[] {
  const direct = Array.isArray(value?.episodeNumbers) ? value.episodeNumbers : [];
  const occurrences = Array.isArray(value?.occurrences)
    ? value.occurrences.map((item: any) => item?.episodeNumber)
    : [];
  return Array.from(new Set([...direct, ...occurrences]
    .map(item => Number(item))
    .filter(item => Number.isFinite(item) && item > 0)))
    .sort((a, b) => a - b);
}

function getShotReferenceText(shot: Shot): string {
  return [
    shot.description,
    shot.actionAndDialogue,
    shot.actorBlocking,
    shot.actionChange,
    shot.scene?.location,
    shot.scene?.time,
    shot.scene?.atmosphere,
    ...(shot.scene?.props || []),
    ...(shot.characters || []).flatMap(character => [
      character.name,
      character.action,
      character.expression,
      character.performance,
    ]),
  ].filter(Boolean).join(' ');
}

function scoreLinkedName(query: string, labels: unknown[]): number {
  const normalizedQuery = normalizeAssetIdentity(query);
  if (!normalizedQuery) return 0;
  return labels.reduce<number>((best, label) => {
    const normalizedLabel = normalizeAssetIdentity(label);
    if (!normalizedLabel) return best;
    if (normalizedLabel === normalizedQuery) return Math.max(best, 120);
    if (normalizedLabel.includes(normalizedQuery) || normalizedQuery.includes(normalizedLabel)) {
      return Math.max(best, 75 - Math.min(Math.abs(normalizedLabel.length - normalizedQuery.length), 20));
    }
    return best;
  }, 0);
}

function getSceneTimeBucket(value: unknown): 'day' | 'night' | '' {
  const text = String(value || '');
  if (/夜|晚|凌晨|黄昏|傍晚/.test(text)) return 'night';
  if (/日|昼|白天|清晨|早晨|上午|中午|下午/.test(text)) return 'day';
  return '';
}

function findSceneStateForShot(sceneItems: Scene[], shot: Shot, chapterNumber: number): Scene | undefined {
  const location = shot.scene?.location || '';
  const shotText = normalizeAssetIdentity(getShotReferenceText(shot));
  const shotTimeBucket = getSceneTimeBucket(shot.scene?.time || shot.scene?.location);
  return sceneItems
    .map(scene => {
      const nameScore = scoreLinkedName(location, [
        scene.name,
        scene.mainSceneName,
        scene.physicalLocation,
        getSceneMainLocation(scene),
        ...(scene.aliases || []),
      ]);
      const episodes = getLinkedEpisodeNumbers(scene);
      const episodeScore = episodes.includes(chapterNumber) ? 80 : episodes.length > 0 ? -25 : 0;
      const sceneTimeBucket = getSceneTimeBucket([scene.timeOfDay, scene.stateLabel, scene.name].filter(Boolean).join(' '));
      const timeScore = shotTimeBucket && sceneTimeBucket
        ? (shotTimeBucket === sceneTimeBucket ? 25 : -20)
        : 0;
      const stateScore = [scene.stateLabel, scene.stateVisualDifference]
        .filter(Boolean)
        .some(value => shotText.includes(normalizeAssetIdentity(value))) ? 15 : 0;
      return { scene, nameScore, score: nameScore + episodeScore + timeScore + stateScore };
    })
    .filter(candidate => candidate.nameScore > 0)
    .sort((a, b) => b.score - a.score)[0]?.scene;
}

function findPropStateForShot(propItems: Prop[], propName: string, shot: Shot, chapterNumber: number): Prop | undefined {
  const sceneLocation = normalizeAssetIdentity(shot.scene?.location || '');
  const shotText = normalizeAssetIdentity(getShotReferenceText(shot));
  return propItems
    .map(prop => {
      const nameScore = scoreLinkedName(propName, [prop.name, prop.mainPropName, prop.sourcePropName, ...(prop.aliases || [])]);
      const episodes = getLinkedEpisodeNumbers(prop);
      const episodeScore = episodes.includes(chapterNumber) ? 80 : episodes.length > 0 ? -25 : 0;
      const sceneScore = (prop.appearanceScenes || []).some(scene => {
        const normalizedScene = normalizeAssetIdentity(scene);
        return normalizedScene && sceneLocation && (
          normalizedScene.includes(sceneLocation) || sceneLocation.includes(normalizedScene)
        );
      }) ? 15 : 0;
      const stateScore = [prop.stateLabel, prop.stateEvidence, prop.stateTransitionEvent]
        .filter(Boolean)
        .some(value => shotText.includes(normalizeAssetIdentity(value))) ? 15 : 0;
      return { prop, nameScore, score: nameScore + episodeScore + sceneScore + stateScore };
    })
    .filter(candidate => candidate.nameScore > 0)
    .sort((a, b) => b.score - a.score)[0]?.prop;
}

function findCharacterByShotName(characterItems: Character[], name: string): Character | undefined {
  const identity = normalizeAssetIdentity(name);
  return characterItems.find(character => (
    normalizeAssetIdentity(character.name) === identity ||
    (character.aliases || []).some(alias => normalizeAssetIdentity(alias) === identity)
  ));
}

function findCharacterLookForShot(character: Character, shotCharacter: Shot['characters'][number], shot: Shot, chapterNumber: number): CharacterLook | undefined {
  const looks = Array.isArray(character.looks) ? character.looks : [];
  const explicitLookId = String(shotCharacter.lookId || '').trim();
  const explicitLook = explicitLookId ? looks.find(look => String(look.id) === explicitLookId) : undefined;
  if (explicitLook) return explicitLook;

  const shotText = normalizeAssetIdentity(getShotReferenceText(shot));
  const location = normalizeAssetIdentity(shot.scene?.location || '');
  const rankedLooks = looks
    .map(look => {
      const episodes = Array.isArray(look.episodeNumbers) ? look.episodeNumbers : [];
      const episodeScore = episodes.includes(chapterNumber) ? 90 : episodes.length > 0 ? -20 : 0;
      const sceneScore = (look.sceneNames || []).some(sceneName => {
        const normalizedScene = normalizeAssetIdentity(sceneName);
        return normalizedScene && location && (
          normalizedScene.includes(location) || location.includes(normalizedScene)
        );
      }) ? 35 : 0;
      const stateScore = [look.ageStage, look.physicalState, look.transformationState, look.scene, look.stage]
        .filter(Boolean)
        .reduce((score, value) => score + (shotText.includes(normalizeAssetIdentity(value)) ? 18 : 0), 0);
      const baseScore = look.isBaseLook ? 5 : 0;
      return { look, score: episodeScore + sceneScore + stateScore + baseScore };
    })
    .sort((a, b) => b.score - a.score);
  return rankedLooks[0]?.score > 0
    ? rankedLooks[0].look
    : (looks.find(look => look.isBaseLook) || looks[0]);
}

// 图片数量限制
const MAX_IMAGES_PER_ASSET = 3;
// 后台图片任务默认最多等待 10 分钟；前端需覆盖完整后台等待窗口，避免后台已保存、页面先断开。
const CHARACTER_IMAGE_REQUEST_TIMEOUT_MS = 660_000;
// Paid API routes perform their own login checks. Keep the client-side preflight
// cached so long-running image batches cannot starve it behind browser connections.
const PAID_ACTION_AUTH_CACHE_MS = 30 * 60_000;
const PAID_ACTION_AUTH_TIMEOUT_MS = 8_000;
const ASSET_RECOVERY_SYNC_DELAYS_MS = [0, 15_000, 60_000, 180_000, 360_000, 660_000] as const;
const BATCH_ASSET_IMAGE_CONCURRENCY = 10;
const INITIAL_BATCH_ASSET_GENERATION_HISTORY = {
  scene: false,
  character: false,
  prop: false,
};

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
  voices: 'pending' | 'loading' | 'success' | 'error' | 'batch_confirm';
  props: 'pending' | 'loading' | 'success' | 'error' | 'batch_confirm';
  outline: 'pending' | 'loading' | 'success' | 'error' | 'batch_confirm';
}

interface ExtractionReviewState {
  status: 'idle' | 'pending' | 'reviewing' | 'success' | 'error';
  candidateCount: number;
  mergedGroupCount: number;
  removedCount: {
    scenes: number;
    characters: number;
    props: number;
  };
  groups: Array<{
    type: 'scene' | 'character' | 'prop';
    canonicalName: string;
    aliases: string[];
    reason: string;
  }>;
  lifecycle?: {
    requiredCount: number;
    coveredBeforeRepair: number;
    repairedByModel: number;
    fallbackAdded: number;
    unresolvedCount: number;
    affectedCharacters: string[];
  };
  reviewedAt: number;
  error?: string;
}

const INITIAL_EXTRACTION_REVIEW: ExtractionReviewState = {
  status: 'idle',
  candidateCount: 0,
  mergedGroupCount: 0,
  removedCount: { scenes: 0, characters: 0, props: 0 },
  groups: [],
  reviewedAt: 0,
};

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
  const [assetRestoreRevision, setAssetRestoreRevision] = useState(0);
  const requestAssetLibrarySync = useCallback(() => {
    setAssetRestoreRevision(previous => previous + 1);
  }, []);
  const assetRecoverySyncTimersRef = useRef<number[]>([]);
  const scheduleAssetLibraryRecovery = useCallback(() => {
    assetRecoverySyncTimersRef.current.forEach(timer => window.clearTimeout(timer));
    assetRecoverySyncTimersRef.current = ASSET_RECOVERY_SYNC_DELAYS_MS.map(delay => window.setTimeout(
      requestAssetLibrarySync,
      delay
    ));
  }, [requestAssetLibrarySync]);

  useEffect(() => () => {
    assetRecoverySyncTimersRef.current.forEach(timer => window.clearTimeout(timer));
    assetRecoverySyncTimersRef.current = [];
  }, []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appConnectionSettings, setAppConnectionSettings] = useState<AppConnectionSettings>(DEFAULT_APP_CONNECTION_SETTINGS);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [loginRequiredOpen, setLoginRequiredOpen] = useState(false);
  const [loginRequiredMessage, setLoginRequiredMessage] = useState(LOGIN_REQUIRED_PROMPT);
  const paidActionAuthCacheRef = useRef<{ accountId: string; checkedAt: number } | null>(null);
  const paidActionAuthRequestRef = useRef<Promise<boolean> | null>(null);

  const showLoginRequired = useCallback((message = LOGIN_REQUIRED_PROMPT) => {
    setLoginRequiredMessage(message);
    setLoginRequiredOpen(true);
  }, []);

  const openLoginFromRequired = useCallback(() => {
    setLoginRequiredOpen(false);
    window.dispatchEvent(new CustomEvent('manfei:open-login'));
  }, []);

  const requireLoginBeforePaidAction = useCallback(async () => {
    const cachedAuth = paidActionAuthCacheRef.current;
    if (cachedAuth && Date.now() - cachedAuth.checkedAt < PAID_ACTION_AUTH_CACHE_MS) {
      return true;
    }

    if (paidActionAuthRequestRef.current) return paidActionAuthRequestRef.current;

    const authRequest = (async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), PAID_ACTION_AUTH_TIMEOUT_MS);
      try {
        const response = await fetch('/api/auth/session', {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { 'X-Skip-Login-Prompt': '1' },
          signal: controller.signal,
        });
        const result = await response.json().catch(() => null);
        const explicitlyLoggedOut =
          response.status === 401 ||
          (response.ok && result?.authenticated === false);

        if (explicitlyLoggedOut) {
          paidActionAuthCacheRef.current = null;
          showLoginRequired(LOGIN_REQUIRED_PROMPT);
          return false;
        }

        if (!response.ok || !result?.authenticated || !result?.account?.id) {
          if (cachedAuth?.accountId) return true;
          toast.error('网络繁忙，暂时无法确认登录状态，请稍后重试');
          return false;
        }

        paidActionAuthCacheRef.current = {
          accountId: result.account.id,
          checkedAt: Date.now(),
        };
        return true;
      } catch (error) {
        if (cachedAuth?.accountId) return true;
        const timedOut = error instanceof DOMException && error.name === 'AbortError';
        toast.error(timedOut
          ? '网络繁忙，登录状态校验排队超时，请稍后重试'
          : '网络连接异常，暂时无法确认登录状态，请稍后重试');
        return false;
      } finally {
        window.clearTimeout(timeout);
      }
    })();

    paidActionAuthRequestRef.current = authRequest;
    try {
      return await authRequest;
    } finally {
      if (paidActionAuthRequestRef.current === authRequest) {
        paidActionAuthRequestRef.current = null;
      }
    }
  }, [showLoginRequired]);

  useEffect(() => {
    const invalidatePaidActionAuth = () => {
      paidActionAuthCacheRef.current = null;
    };
    window.addEventListener('manfei:wallet-updated', invalidatePaidActionAuth);
    return () => window.removeEventListener('manfei:wallet-updated', invalidatePaidActionAuth);
  }, []);

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
  const hasExpandedExtractionCollection =
    activeTab === 'extraction' &&
    (expandedSections.scenes || expandedSections.characters || expandedSections.props);

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
  const [executionScript, setExecutionScript] = usePersistentState(STORAGE_KEYS.EXECUTION_SCRIPT, '');
  const [executionScriptSourceSignature, setExecutionScriptSourceSignature] = usePersistentState(
    STORAGE_KEYS.EXECUTION_SCRIPT_SOURCE_SIGNATURE,
    ''
  );
  const normalizedExecutionScript = useMemo(
    () => normalizeExecutionScriptText(executionScript),
    [executionScript]
  );
  const [creationBible, setCreationBible] = usePersistentState<CreationBibleSettings>(
    STORAGE_KEYS.CREATION_BIBLE,
    DEFAULT_CREATION_BIBLE
  );

  // 五个并行提取结果
  const [scenesData, setScenesData] = usePersistentState<any>(STORAGE_KEYS.SCENES_DATA, null);
  const [charactersData, setCharactersData] = usePersistentState<any>(STORAGE_KEYS.CHARACTERS_DATA, null);
  const [characterVoiceData, setCharacterVoiceData] = usePersistentState<CharacterVoiceExtraction | null>(
    STORAGE_KEYS.CHARACTER_VOICE_DATA,
    null
  );
  const [voiceLibrary, setVoiceLibrary] = usePersistentState<VoiceLibraryItem[]>(
    STORAGE_KEYS.VOICE_LIBRARY,
    []
  );
  const [voiceLibraryLoading, setVoiceLibraryLoading] = useState(false);
  const [propsData, setPropsData] = usePersistentState<any>(STORAGE_KEYS.PROPS_DATA, null);
  const [outline, setOutline] = usePersistentState<Outline | null>(STORAGE_KEYS.OUTLINE, null);

  useEffect(() => {
    if (!characterVoiceData?.profiles?.length) return;
    const retainedProfiles = characterVoiceData.profiles.filter(profile => (
      Number(profile.totalDialogueCount) >= MIN_DIALOGUE_LINES_FOR_VOICE_PROFILE
    ));
    if (retainedProfiles.length === characterVoiceData.profiles.length) return;

    setCharacterVoiceData(previous => {
      if (!previous) return previous;
      const profiles = previous.profiles.filter(profile => (
        Number(profile.totalDialogueCount) >= MIN_DIALOGUE_LINES_FOR_VOICE_PROFILE
      ));
      if (profiles.length === previous.profiles.length) return previous;
      return {
        ...previous,
        totalSpeakers: profiles.length,
        profiles,
      };
    });
  }, [characterVoiceData, setCharacterVoiceData]);

  useEffect(() => {
    setVoiceLibrary(previous => {
      const audioVoices = (previous || []).filter(item => item.source !== 'preset');
      return audioVoices.length === (previous || []).length ? previous : audioVoices;
    });
  }, [setVoiceLibrary]);

  useEffect(() => {
    if (!characterVoiceData?.profiles?.some(profile => (
      profile.variants.some(variant => variant.boundVoiceId?.startsWith('preset-'))
    ))) return;

    setCharacterVoiceData(previous => previous ? {
      ...previous,
      profiles: previous.profiles.map(profile => ({
        ...profile,
        variants: profile.variants.map(variant => variant.boundVoiceId?.startsWith('preset-')
          ? { ...variant, boundVoiceId: undefined, boundAt: undefined }
          : variant),
      })),
    } : previous);
  }, [characterVoiceData, setCharacterVoiceData]);

  const syncVoiceLibrary = useCallback(async (showError = false) => {
    setVoiceLibraryLoading(true);
    try {
      const response = await fetch('/api/voice-library', {
        cache: 'no-store',
        headers: { 'X-Skip-Login-Prompt': '1' },
      });
      const result = await response.json();
      if (response.status === 401) return;
      if (!response.ok || !result.success || !Array.isArray(result.voices)) {
        throw new Error(result.error || '读取音色库失败');
      }
      const externalVoices = (result.voices as VoiceLibraryItem[])
        .filter(voice => voice?.source === 'builtin' || voice?.source === 'custom');
      setVoiceLibrary(externalVoices);
    } catch (error) {
      console.error('同步音色库失败:', error);
      if (showError) toast.error(error instanceof Error ? error.message : '同步音色库失败');
    } finally {
      setVoiceLibraryLoading(false);
    }
  }, [setVoiceLibrary]);

  useEffect(() => {
    void syncVoiceLibrary(false);
    const handleWalletUpdated = () => void syncVoiceLibrary(false);
    window.addEventListener('manfei:wallet-updated', handleWalletUpdated);
    return () => window.removeEventListener('manfei:wallet-updated', handleWalletUpdated);
  }, [syncVoiceLibrary]);

  const uploadVoiceToLibrary = useCallback(async (input: VoiceUploadInput): Promise<boolean> => {
    if (!(await requireLoginBeforePaidAction())) return false;

    const formData = new FormData();
    formData.append('file', input.file);
    formData.append('name', input.name);
    formData.append('language', input.language);
    formData.append('category', input.category);
    formData.append('gender', input.gender);
    formData.append('ageRange', input.ageRange);
    formData.append('description', input.description);

    try {
      const response = await fetch('/api/voice-library', { method: 'POST', body: formData });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '上传音色失败');
      await syncVoiceLibrary(false);
      toast.success(`音色“${result.voice?.name || input.name}”已保存到当前账号`);
      return true;
    } catch (error) {
      console.error('上传音色失败:', error);
      toast.error(error instanceof Error ? error.message : '上传音色失败');
      return false;
    }
  }, [requireLoginBeforePaidAction, syncVoiceLibrary]);

  const deleteVoiceFromLibrary = useCallback(async (voiceId: string): Promise<boolean> => {
    if (!(await requireLoginBeforePaidAction())) return false;
    try {
      const response = await fetch(`/api/voice-library?id=${encodeURIComponent(voiceId)}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '删除音色失败');

      setVoiceLibrary(previous => previous.filter(voice => voice.id !== voiceId));
      setCharacterVoiceData(previous => previous ? {
        ...previous,
        profiles: previous.profiles.map(profile => ({
          ...profile,
          variants: profile.variants.map(variant => variant.boundVoiceId === voiceId
            ? { ...variant, boundVoiceId: undefined, boundAt: undefined }
            : variant),
        })),
      } : previous);
      toast.success('个人音色已删除，相关人物绑定已解除');
      return true;
    } catch (error) {
      console.error('删除音色失败:', error);
      toast.error(error instanceof Error ? error.message : '删除音色失败');
      return false;
    }
  }, [requireLoginBeforePaidAction, setCharacterVoiceData, setVoiceLibrary]);

  useEffect(() => {
    const characters = (charactersData?.characters || []) as Character[];
    if (!characterVoiceData?.profiles?.length || characters.length === 0) return;

    setCharacterVoiceData(previous => {
      if (!previous) return previous;
      let changed = false;
      const profiles = previous.profiles.map(profile => {
        const profileNames = [profile.characterName, ...profile.aliases].map(normalizeVoiceCharacterName);
        const character = characters.find(item => [item.name, ...(item.aliases || [])]
          .map(normalizeVoiceCharacterName)
          .some(name => profileNames.includes(name)));
        if (!character || profile.characterId === character.id) return profile;
        changed = true;
        return {
          ...profile,
          characterId: character.id,
          characterName: character.name,
          aliases: Array.from(new Set([...profile.aliases, ...(character.aliases || [])]))
            .filter(alias => normalizeVoiceCharacterName(alias) !== normalizeVoiceCharacterName(character.name)),
        };
      });
      return changed ? { ...previous, profiles } : previous;
    });
  }, [characterVoiceData?.profiles?.length, charactersData?.characters, setCharacterVoiceData]);

  const bindCharacterVoice = useCallback((profileId: string, variantId: string, voiceId: string) => {
    if (!voiceLibrary.some(voice => voice.id === voiceId)) {
      toast.error('所选音色不存在，请重新选择');
      return;
    }
    setCharacterVoiceData(previous => {
      if (!previous) return previous;
      return {
        ...previous,
        profiles: previous.profiles.map(profile => profile.id !== profileId
          ? profile
          : {
              ...profile,
              variants: profile.variants.map(variant => variant.id !== variantId
                ? variant
                : { ...variant, boundVoiceId: voiceId, boundAt: Date.now() }
              ),
            }
        ),
      };
    });
    toast.success('音色已绑定，后续视频会按说话人物自动引用');
  }, [setCharacterVoiceData, voiceLibrary]);

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

  // 修复旧版本把上一集结尾台词、动作或转场标记保存成分集标题的数据。
  useEffect(() => {
    if (!outline?.chapters?.length) return;
    const normalized = normalizeEpisodeChapterTitles(outline.chapters);
    if (normalized.changed) {
      setOutline({ ...outline, chapters: normalized.chapters });
    }
  }, [outline, setOutline]);

  useEffect(() => {
    if (!outlineBatchInfo?.allChapters?.length) return;
    const normalized = normalizeEpisodeChapterTitles(outlineBatchInfo.allChapters);
    if (normalized.changed) {
      setOutlineBatchInfo({ ...outlineBatchInfo, allChapters: normalized.chapters });
    }
  }, [outlineBatchInfo, setOutlineBatchInfo]);

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
    propInventory?: any[];  // 大模型通读全文后建立的物品实体与状态总表
    allProps: any[];  // 已提取的所有道具
  }
  const [propBatchInfo, setPropBatchInfo] = usePersistentState<PropBatchInfo | null>(STORAGE_KEYS.PROP_BATCH_INFO, null);
  const sceneRenderItems = useMemo(() => {
    const source = (sceneBatchInfo?.allScenes?.length ?? 0) > 0
      ? sceneBatchInfo?.allScenes
      : scenesData?.scenes;
    return buildSceneRenderItems((source || []) as Scene[]);
  }, [sceneBatchInfo?.allScenes, scenesData?.scenes]);
  const characterRenderItems = useMemo(() => {
    const source = (charactersData?.characters?.length ?? 0) > 0
      ? charactersData?.characters
      : characterBatchInfo?.allCharacters;
    return (source || []) as Character[];
  }, [characterBatchInfo?.allCharacters, charactersData?.characters]);
  const propRenderItems = useMemo(() => {
    const source = (propBatchInfo?.allProps?.length ?? 0) > 0
      ? propBatchInfo?.allProps
      : propsData?.props;
    return buildPropRenderItems((source || []) as Prop[]);
  }, [propBatchInfo?.allProps, propsData?.props]);
  const [extractionReview, setExtractionReview] = usePersistentState<ExtractionReviewState>(
    STORAGE_KEYS.EXTRACTION_REVIEW,
    INITIAL_EXTRACTION_REVIEW
  );
  const assetExtractionChainRef = useRef({
    scenes: false,
    characters: false,
    props: false,
  });
  const extractionReviewRequestedRef = useRef(false);
  const extractionReviewRunningRef = useRef(false);

  // 提取状态
  const [extractionStatus, setExtractionStatus] = usePersistentState<ExtractionStatus>(
    STORAGE_KEYS.EXTRACTION_STATUS,
    {
      scenes: 'pending',
      characters: 'pending',
      voices: 'pending',
      props: 'pending',
      outline: 'pending',
    }
  );
  const hasSceneExtractionResult = Array.isArray(scenesData?.scenes) && scenesData.scenes.length > 0;
  const hasCharacterExtractionResult = Array.isArray(charactersData?.characters) && charactersData.characters.length > 0;
  const hasVoiceExtractionResult = Array.isArray(characterVoiceData?.profiles);
  const hasPropExtractionResult = Array.isArray(propsData?.props) && propsData.props.length > 0;
  const hasOutlineExtractionResult = Array.isArray(outline?.chapters) && outline.chapters.length > 0;
  const getEffectiveExtractionStatus = (
    status: ExtractionStatus[keyof ExtractionStatus],
    hasResult: boolean
  ): ExtractionStatus[keyof ExtractionStatus] => {
    return status === 'pending' && hasResult ? 'success' : status;
  };
  const effectiveExtractionStatus: ExtractionStatus = {
    scenes: getEffectiveExtractionStatus(extractionStatus.scenes, hasSceneExtractionResult),
    characters: getEffectiveExtractionStatus(extractionStatus.characters, hasCharacterExtractionResult),
    voices: getEffectiveExtractionStatus(extractionStatus.voices ?? 'pending', hasVoiceExtractionResult),
    props: getEffectiveExtractionStatus(extractionStatus.props, hasPropExtractionResult),
    outline: getEffectiveExtractionStatus(extractionStatus.outline, hasOutlineExtractionResult),
  };
  const hasExtractionStatusToShow =
    effectiveExtractionStatus.scenes !== 'pending' ||
    effectiveExtractionStatus.characters !== 'pending' ||
    effectiveExtractionStatus.voices !== 'pending' ||
    effectiveExtractionStatus.props !== 'pending' ||
    effectiveExtractionStatus.outline !== 'pending';
  const isEffectiveExtractionSuccess =
    effectiveExtractionStatus.scenes === 'success' &&
    effectiveExtractionStatus.characters === 'success' &&
    effectiveExtractionStatus.voices === 'success' &&
    effectiveExtractionStatus.props === 'success' &&
    effectiveExtractionStatus.outline === 'success';

  useEffect(() => {
    setExtractionStatus(prev => {
      const next = { ...prev };
      let changed = false;

      if (prev.scenes === 'pending' && hasSceneExtractionResult) {
        next.scenes = 'success';
        changed = true;
      }
      if (prev.characters === 'pending' && hasCharacterExtractionResult) {
        next.characters = 'success';
        changed = true;
      }
      if ((prev.voices ?? 'pending') === 'pending' && hasVoiceExtractionResult) {
        next.voices = 'success';
        changed = true;
      }
      if (prev.props === 'pending' && hasPropExtractionResult) {
        next.props = 'success';
        changed = true;
      }
      if (prev.outline === 'pending' && hasOutlineExtractionResult) {
        next.outline = 'success';
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [
    hasSceneExtractionResult,
    hasCharacterExtractionResult,
    hasVoiceExtractionResult,
    hasPropExtractionResult,
    hasOutlineExtractionResult,
    setExtractionStatus,
  ]);

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
  const [batchAssetGenerationHistory, setBatchAssetGenerationHistory] = usePersistentState<Record<'scene' | 'character' | 'prop', boolean>>(
    STORAGE_KEYS.BATCH_ASSET_GENERATION_HISTORY,
    INITIAL_BATCH_ASSET_GENERATION_HISTORY
  );

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
  const [isGeneratingExecutionScript, setIsGeneratingExecutionScript] = useState(false);
  const [executionScriptElapsedSeconds, setExecutionScriptElapsedSeconds] = useState(0);
  const [executionScriptProgressMessage, setExecutionScriptProgressMessage] = useState('DeepSeek 正在通读全文并规范剧本结构');
  const [executionScriptError, setExecutionScriptError] = useState<string | null>(null);
  const [showExecutionScriptPreview, setShowExecutionScriptPreview] = useState(false);
  const [showExecutionScriptSuccessDialog, setShowExecutionScriptSuccessDialog] = useState(false);
  const storyboardAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const storyboardBatchCancelledRef = useRef(false);
  const [editingPrompt, setEditingPrompt] = useState<{ type: 'image' | 'video'; shotNumber: number; prompt: string; chapterNumber?: number; frameType?: 'start' | 'end' } | null>(null);
  const [regeneratingShot, setRegeneratingShot] = useState<number | null>(null);

  useEffect(() => {
    if (!isGeneratingExecutionScript) return;

    const timer = window.setInterval(() => {
      setExecutionScriptElapsedSeconds(previous => previous + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isGeneratingExecutionScript]);

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
  const [exportingAssetListType, setExportingAssetListType] = useState<'scene' | 'character' | 'prop' | null>(null);
  const [assetPackageExportSuccess, setAssetPackageExportSuccess] = useState<{
    typeLabel: string;
    fileName: string;
    workbookFileName: string;
    rowCount: number;
    imageCount: number;
    originalImageCount: number;
    failedImageCount: number;
    savedToDownloads: boolean;
    savedPath: string;
  } | null>(null);
  const batchAssetGenerationGuardRef = useRef(false);
  const [batchRegenerationConfirmType, setBatchRegenerationConfirmType] = useState<'scene' | 'character' | 'prop' | null>(null);
  const [assetImageLimitNotice, setAssetImageLimitNotice] = useState<{
    type: 'scene' | 'character' | 'prop';
    name: string;
  } | null>(null);
  const [assetImageChooserTarget, setAssetImageChooserTarget] = useState<{
    assetId: string;
    type: 'scene' | 'character' | 'prop';
    name: string;
  } | null>(null);
  const [pendingCharacterFaceChange, setPendingCharacterFaceChange] = useState<{
    assetId: string;
    imageId: string;
    characterName: string;
    imageUrl: string;
    affectedLookCount: number;
  } | null>(null);

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
  const [isPreviewImageLoading, setIsPreviewImageLoading] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);

  const buildExecutionScriptSourceSignature = useCallback((content: string, fileName: string) => {
    const head = content.slice(0, 160);
    const tail = content.slice(-160);
    return `${fileName || '剧本'}::${content.length}::${head}::${tail}`;
  }, []);

  const getCurrentFileName = useCallback(() => (
    uploadedFile?.name || uploadedFileName || '剧本'
  ), [uploadedFile, uploadedFileName]);

  const getCurrentExecutionScriptSignature = useCallback(() => (
    buildExecutionScriptSourceSignature(fileContent, getCurrentFileName())
  ), [buildExecutionScriptSourceSignature, fileContent, getCurrentFileName]);

  const hasCurrentExecutionScript = useCallback(() => (
    !!normalizedExecutionScript.trim() &&
    executionScriptSourceSignature === getCurrentExecutionScriptSignature()
  ), [normalizedExecutionScript, executionScriptSourceSignature, getCurrentExecutionScriptSignature]);

  const getExtractionSourceContent = useCallback(() => (
    hasCurrentExecutionScript() ? normalizedExecutionScript : ''
  ), [normalizedExecutionScript, hasCurrentExecutionScript]);

  const hasConfirmedCreationBible = useCallback(() => (
    creationBible.confirmed &&
    !!creationBible.creationType &&
    !!creationBible.subjectRegion &&
    !!creationBible.creationBackground
  ), [creationBible]);

  const getCreationBiblePayload = useCallback(() => ({
    creationType: creationBible.creationType,
    subjectRegion: creationBible.subjectRegion,
    creationBackground: creationBible.creationBackground,
  }), [creationBible.creationBackground, creationBible.creationType, creationBible.subjectRegion]);

  const playExecutionScriptSuccessSound = useCallback(() => {
    if (typeof window === 'undefined') return;

    try {
      const AudioContextClass = window.AudioContext || (
        window as typeof window & { webkitAudioContext?: typeof AudioContext }
      ).webkitAudioContext;
      if (!AudioContextClass) return;

      const audioContext = new AudioContextClass();
      const startAt = audioContext.currentTime;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, startAt);
      oscillator.frequency.exponentialRampToValueAtTime(1320, startAt + 0.16);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.08, startAt + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.26);

      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.28);
      oscillator.onended = () => {
        audioContext.close().catch(() => undefined);
      };
    } catch (error) {
      console.warn('播放执行剧本完成提示音失败:', error);
    }
  }, []);

  // 网络错误处理函数 - 提供更有用的错误信息
  const getNetworkErrorMessage = useCallback((error: unknown, operation: string): string => {
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

  const ensureExecutionScript = useCallback(async (forceRegenerate = false): Promise<string | null> => {
    if (!fileContent.trim()) {
      toast.error('请先上传剧本文件');
      return null;
    }

    if (!forceRegenerate && hasCurrentExecutionScript()) {
      return normalizedExecutionScript;
    }

    if (!(await requireLoginBeforePaidAction())) return null;

    setExecutionScriptElapsedSeconds(0);
    setExecutionScriptProgressMessage('正在连接执行剧本服务');
    setExecutionScriptError(null);
    setIsGeneratingExecutionScript(true);
    const toastId = toast.loading(forceRegenerate ? '正在重新拉执行剧本...' : '正在拉执行剧本...');

    try {
      const response = await fetch('/api/generate-execution-script', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/x-ndjson',
        },
        body: JSON.stringify({
          content: fileContent,
          fileName: getCurrentFileName(),
        }),
      });

      let data: any = null;
      const contentType = response.headers.get('content-type') || '';

      if (response.ok && contentType.includes('application/x-ndjson')) {
        const reader = response.body?.getReader();
        if (!reader) throw new Error('无法读取执行剧本生成进度');

        const decoder = new TextDecoder();
        let buffer = '';

        const processLine = (line: string) => {
          const trimmed = line.trim();
          if (!trimmed) return;

          const event = JSON.parse(trimmed);
          if (event.type === 'progress') {
            if (typeof event.message === 'string' && event.message.trim()) {
              setExecutionScriptProgressMessage(event.message.trim());
            }
            if (Number.isFinite(event.elapsedSeconds)) {
              setExecutionScriptElapsedSeconds(previous => Math.max(previous, Number(event.elapsedSeconds)));
            }
            return;
          }
          if (event.type === 'error') {
            throw new Error(event.details || event.error || '拉执行剧本失败');
          }
          if (event.type === 'complete') {
            data = event;
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) processLine(line);
        }

        buffer += decoder.decode();
        if (buffer.trim()) processLine(buffer);
        if (!data) throw new Error('执行剧本生成连接已结束，但未收到完整结果');
      } else {
        data = await response.json().catch(() => null);
      }

      if (response.status === 401) {
        showLoginRequired(LOGIN_REQUIRED_PROMPT);
      }

      if (!response.ok || !data?.success || !data.executionScript) {
        throw new Error(data?.details || data?.error || '拉执行剧本失败');
      }

      const nextExecutionScript = normalizeExecutionScriptText(String(data.executionScript));
      setExecutionScript(nextExecutionScript);
      setExecutionScriptSourceSignature(getCurrentExecutionScriptSignature());
      if (data.tokenUsage) {
        setTokenUsage(prev => ({ ...prev, executionScript: data.tokenUsage }));
      }

      toast.dismiss(toastId);
      toast.success(forceRegenerate ? '执行剧本已重新生成' : '执行剧本已生成');
      playExecutionScriptSuccessSound();
      setShowExecutionScriptSuccessDialog(true);
      return nextExecutionScript;
    } catch (error) {
      console.error('拉执行剧本失败:', error);
      toast.dismiss(toastId);
      const errorMessage = getNetworkErrorMessage(error, '拉执行剧本');
      setExecutionScriptError(errorMessage);
      toast.error(errorMessage, { duration: 10000 });
      return null;
    } finally {
      setIsGeneratingExecutionScript(false);
    }
  }, [
    normalizedExecutionScript,
    fileContent,
    getCurrentExecutionScriptSignature,
    getCurrentFileName,
    getNetworkErrorMessage,
    hasCurrentExecutionScript,
    playExecutionScriptSuccessSound,
    requireLoginBeforePaidAction,
    showLoginRequired,
    setExecutionScript,
    setExecutionScriptSourceSignature,
    setTokenUsage,
  ]);

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
    setIsPreviewImageLoading(true);
    setPreviewZoom(1);
  }, []);

  // 关闭图片预览
  const closeImagePreview = useCallback(() => {
    setPreviewImage(null);
    setIsPreviewImageLoading(false);
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

  // 打开图片库选择器
  const openImageLibrary = useCallback((type: 'scene' | 'character' | 'prop', id: number, name: string) => {
    const assetId = `${type}-${name}`;
    const currentCount = assetImagesObj[assetId]?.images?.length || 0;
    if (currentCount >= MAX_IMAGES_PER_ASSET) {
      setAssetImageLimitNotice({ type, name });
      return;
    }
    setLibrarySelectTarget({ type, id: String(id), name });
    setImageLibraryOpen(true);
  }, [assetImagesObj]);

  // 从图片库选择图片后添加到素材
  const handleLibraryImageSelect = useCallback(async (imageUrl: string, imageName: string) => {
    if (!librarySelectTarget) return;

    const { type, id, name } = librarySelectTarget;
    // 使用素材名称作为 assetId，确保唯一性（名称是唯一的）
    const assetId = `${type}-${name}`;
    const currentCount = assetImagesObj[assetId]?.images?.length || 0;

    if (currentCount >= MAX_IMAGES_PER_ASSET) {
      setImageLibraryOpen(false);
      setLibrarySelectTarget(null);
      setAssetImageLimitNotice({ type, name });
      return;
    }

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
  }, [librarySelectTarget, assetImagesObj]);

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
  // 生成反馈独立于持久化图片，避免无 URL 的临时占位被同步清理后界面失去进度提示。
  const [assetGenerationStatuses, setAssetGenerationStatuses] = useState<Record<string, string>>({});
  const [assetGenerationErrors, setAssetGenerationErrors] = useState<Record<string, string>>({});
  const activeAssetGenerationIdsRef = useRef<Set<string>>(new Set());

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
            images: uniqueImages.slice(0, MAX_IMAGES_PER_ASSET),
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

  // usePersistentState 会在账号状态恢复完成后异步更新对象；同步回本地 Map，
  // 避免页面初次挂载时读取到空值后，后续恢复的图片仍无法显示。
  useEffect(() => {
    const persistedEntries = Object.entries(assetImagesObj || {});
    if (persistedEntries.length === 0) return;

    const deduplicatedObj: Record<string, AssetImages> = {};
    for (const [key, asset] of persistedEntries) {
      const seenUrls = new Set<string>();
      const uniqueImages = (asset.images || []).flatMap((image, index) => {
        if (!image.imageUrl || seenUrls.has(image.imageUrl)) return [];
        seenUrls.add(image.imageUrl);
        return [{
          ...image,
          imageId: image.imageId || `${key}-${index}`,
          isGenerating: false,
          generatingStatus: undefined,
        }];
      });
      deduplicatedObj[key] = {
        ...asset,
        images: uniqueImages.slice(0, MAX_IMAGES_PER_ASSET),
      };
    }

    const normalizedString = JSON.stringify(deduplicatedObj);
    if (lastSyncedRef.current === normalizedString) return;

    lastSyncedRef.current = normalizedString;
    setAssetImagesLocal(new Map(Object.entries(deduplicatedObj)));
    console.log('[素材图片] 账号持久化状态已同步到页面:', persistedEntries.length, '个素材');
  }, [assetImagesObj]);

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

  useEffect(() => {
    const sourceProps = Array.isArray(propsData?.props) ? propsData.props : [];
    const sourceBatchProps = Array.isArray(propBatchInfo?.allProps) ? propBatchInfo.allProps : [];
    if (sourceProps.length === 0 && sourceBatchProps.length === 0) return;

    const appendMissingInventoryProps = (rawProps: unknown[]) => {
      const inventory = Array.isArray(propBatchInfo?.propInventory) ? propBatchInfo.propInventory : [];
      if (inventory.length === 0) return rawProps;
      const normalizeIdentity = (value: unknown) => String(value || '').replace(/\s+/g, '').toLocaleLowerCase();
      const existingIdentities = new Set((rawProps as any[]).map(prop => (
        normalizeIdentity(prop?.mainPropName || prop?.sourcePropName || prop?.name)
      )));
      const restoredProps = inventory.flatMap((item: any, index: number) => {
        const name = String(item?.name || '').trim();
        const identity = normalizeIdentity(name);
        if (!name || existingIdentities.has(identity)) return [];
        existingIdentities.add(identity);

        const inventoryStates = Array.isArray(item?.states) ? item.states : [];
        const stateVariants = inventoryStates.length > 0
          ? inventoryStates.map((state: any, stateIndex: number) => {
              const episodeNumber = Number.isFinite(Number(state?.episodeNumber)) ? Number(state.episodeNumber) : null;
              const occurrences = Array.isArray(state?.occurrences) && state.occurrences.length > 0
                ? state.occurrences
                : (episodeNumber || state?.sceneName)
                  ? [{
                      episodeNumber,
                      episodeLabel: state?.episodeLabel || (episodeNumber ? `第${episodeNumber}集` : '未标注集数'),
                      sceneName: state?.sceneName || '',
                      heading: state?.sceneName || '',
                      stateLabel: state?.stateName || '基准状态',
                    }]
                  : [];
              return {
                id: `state-${stateIndex + 1}`,
                stateName: state?.stateName || '基准状态',
                scene: state?.sceneName || occurrences[0]?.sceneName || '',
                stage: state?.episodeLabel || occurrences[0]?.episodeLabel || '',
                description: state?.evidence || state?.visualChange || item?.visualSummary || '',
                visualChange: stateIndex === 0 ? (state?.visualChange || '基准状态') : (state?.visualChange || ''),
                transitionEvent: state?.transitionEvent || (stateIndex === 0 ? '基准状态' : ''),
                narrativeFunction: state?.narrativeFunction || state?.storyFunction || '',
                evidence: state?.evidence || '',
                referenceFromStateId: stateIndex === 0 ? '' : `state-${stateIndex}`,
                imageMode: stateIndex === 0 ? 'text-to-image' : 'image-to-image',
                episodeNumbers: Array.from(new Set([
                  ...(Array.isArray(state?.episodeNumbers) ? state.episodeNumbers : []),
                  episodeNumber,
                  ...occurrences.map((occurrence: any) => occurrence?.episodeNumber),
                ].map(Number).filter(number => Number.isFinite(number) && number > 0))),
                occurrences,
              };
            })
          : [{
              id: 'state-1',
              stateName: '基准状态',
              description: item?.visualSummary || item?.functionSummary || `${name}的基准外观`,
              visualChange: '基准状态',
              transitionEvent: '基准状态',
              narrativeFunction: item?.functionSummary || '',
              referenceFromStateId: '',
              imageMode: 'text-to-image',
              episodeNumbers: item?.episodeNumbers || [],
              occurrences: [],
            }];
        const occurrences = stateVariants.flatMap((state: any) => state.occurrences || []);
        return [{
          id: 900000 + index,
          name,
          mainPropName: name,
          type: item?.type || '普通道具',
          importance: item?.type === '背景道具' ? '背景道具' : '普通道具',
          description: item?.visualSummary || item?.functionSummary || `${name}的外观待补充`,
          appearanceScenes: item?.appearanceScenes || [],
          owner: item?.owner || '公共/场景',
          function: item?.functionSummary || '按剧本场次使用',
          visualDescription: item?.visualSummary || '',
          stateLabel: stateVariants[0]?.stateName || '基准状态',
          imageMode: 'text-to-image',
          episodeNumbers: item?.episodeNumbers || [],
          occurrences,
          stateVariants,
          notes: '由全文道具盘点记录自动补回',
        }];
      });
      return [...rawProps, ...restoredProps];
    };

    const normalizePayload = (rawProps: unknown[]) => {
      const props = expandPropStateUnits(appendMissingInventoryProps(rawProps)) as unknown as Prop[];
      const totalMainProps = new Set(props.map(prop => prop.mainPropName || prop.name)).size;
      return {
        props,
        totalProps: totalMainProps,
        totalMainProps,
        totalPropStates: props.length,
      };
    };

    if (sourceProps.length > 0) {
      const normalized = normalizePayload(sourceProps);
      const currentSignature = JSON.stringify({
        props: sourceProps,
        totalProps: propsData?.totalProps,
        totalMainProps: propsData?.totalMainProps,
        totalPropStates: propsData?.totalPropStates,
      });
      if (currentSignature !== JSON.stringify(normalized)) {
        setPropsData((previous: any) => ({ ...previous, ...normalized }));
      }
    }

    if (sourceBatchProps.length > 0) {
      const normalizedBatchProps = expandPropStateUnits(appendMissingInventoryProps(sourceBatchProps)) as unknown as Prop[];
      if (JSON.stringify(sourceBatchProps) !== JSON.stringify(normalizedBatchProps)) {
        setPropBatchInfo(previous => previous ? {
          ...previous,
          allProps: normalizedBatchProps,
        } : previous);
      }
    }
  }, [propsData, propBatchInfo, setPropsData, setPropBatchInfo]);

  // 本地 Map 变化时同步到持久化存储
  const setAssetImages = useCallback((updater: (prev: Map<string, AssetImages>) => Map<string, AssetImages>) => {
    setAssetImagesLocal(prev => {
      const updatedMap = updater(prev);
      const newMap = new Map<string, AssetImages>();
      updatedMap.forEach((asset, key) => {
        newMap.set(key, {
          ...asset,
          images: (asset.images || []).slice(0, MAX_IMAGES_PER_ASSET),
        });
      });
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

  // 统一整理新旧场景数据：只保留真正需要单独制作的状态，并把重复卡片的图片迁移到保留状态。
  useEffect(() => {
    const sourceScenes = (sceneBatchInfo?.allScenes?.length ?? 0) > 0
      ? sceneBatchInfo?.allScenes
      : scenesData?.scenes;
    if (!Array.isArray(sourceScenes) || sourceScenes.length === 0) return;

    const normalized = normalizeSceneStateUnits(sourceScenes);
    if (normalized.scenes.length === 0) return;

    const sourceJson = JSON.stringify(sourceScenes);
    const normalizedJson = JSON.stringify(normalized.scenes);
    if (sourceJson === normalizedJson) return;

    setScenesData((previous: any) => previous ? {
      ...previous,
      totalScenes: normalized.scenes.length,
      totalMainScenes: Array.from(new Set(normalized.scenes.map(scene => getSceneMainLocation(scene)))).length,
      scenes: normalized.scenes,
    } : previous);

    if (sceneBatchInfo?.allScenes) {
      setSceneBatchInfo(previous => previous ? {
        ...previous,
        allScenes: normalized.scenes,
      } : previous);
    }

    const aliasEntries = Object.entries(normalized.aliases).filter(([fromName, toName]) => (
      fromName && toName && fromName !== toName
    ));
    if (aliasEntries.length > 0) {
      setAssetImages(previous => {
        const next = new Map(previous);
        aliasEntries.forEach(([fromName, toName]) => {
          const sourceKey = `scene-${fromName}`;
          const targetKey = `scene-${toName}`;
          const sourceAsset = next.get(sourceKey);
          if (!sourceAsset) return;

          const targetAsset = next.get(targetKey);
          const seen = new Set<string>();
          const mergedImages = [
            ...(targetAsset?.images || []),
            ...(sourceAsset.images || []),
          ].filter(image => {
            const identity = image.imageUrl || image.imageId;
            if (!identity || seen.has(identity)) return false;
            seen.add(identity);
            return true;
          }).slice(0, MAX_IMAGES_PER_ASSET).map((image, index) => ({
            ...image,
            imageId: `${targetKey}-${index}`,
          }));

          next.set(targetKey, {
            ...(targetAsset || sourceAsset),
            assetId: targetKey,
            type: 'scene',
            name: toName,
            images: mergedImages,
          });
          next.delete(sourceKey);
        });
        return next;
      });
    }

    console.log(`[场景状态整理] ${sourceScenes.length} 条识别结果整理为 ${normalized.scenes.length} 个有效制作状态`);
  }, [
    scenesData,
    sceneBatchInfo,
    setAssetImages,
    setSceneBatchInfo,
    setScenesData,
  ]);

  const selectPrimaryAssetImage = useCallback((
    assetId: string,
    imageId: string,
    assetName: string,
    assetType: 'scene' | 'character' | 'prop',
    selectedImageUrl: string
  ) => {
    setAssetImages(prev => {
      const asset = prev.get(assetId);
      if (!asset) return prev;
      const selectedImage = asset.images.find(image => image.imageId === imageId);
      if (!selectedImage) return prev;

      const next = new Map(prev);
      next.set(assetId, {
        ...asset,
        images: [selectedImage, ...asset.images.filter(image => image.imageId !== imageId)],
      });
      return next;
    });

    if (assetType === 'character') {
      const invalidateChangedIdentity = (characters: Character[]) => characters.map(character => {
        if (character.name !== assetName || character.confirmedFaceImageUrl === selectedImageUrl) return character;
        return {
          ...character,
          identityImageConfirmed: false,
          confirmedFaceImageUrl: undefined,
          identityConfirmedAt: undefined,
          looks: character.looks?.map(look => (
            look.imageUrl || look.fourViewImageUrl
              ? {
                  ...look,
                  identityNeedsReview: Boolean(look.imageUrl),
                  fourViewIdentityNeedsReview: Boolean(look.fourViewImageUrl),
                }
              : look
          )),
        };
      });
      setCharactersData((prev: any) => prev?.characters
        ? { ...prev, characters: invalidateChangedIdentity(prev.characters) }
        : prev);
      setCharacterBatchInfo((prev: any) => prev?.allCharacters
        ? { ...prev, allCharacters: invalidateChangedIdentity(prev.allCharacters) }
        : prev);
    }

    setAssetImageChooserTarget(null);
    toast.success(
      assetType === 'character'
        ? `已将所选图片设为「${assetName}」正脸主图；如身份基准未确认，请完成确认`
        : `已将「${assetName}」所选图片设为主图`
    );
  }, [setAssetImages, setCharactersData, setCharacterBatchInfo]);

  const requestPrimaryAssetImageSelection = useCallback((
    assetId: string,
    imageId: string,
    assetName: string,
    assetType: 'scene' | 'character' | 'prop',
    selectedImageUrl: string
  ) => {
    if (assetType === 'character') {
      const characterSource = charactersData?.characters?.length
        ? charactersData.characters
        : (characterBatchInfo?.allCharacters || []);
      const character = characterSource.find((item: Character) => item.name === assetName);
      if (
        character?.identityImageConfirmed &&
        character.confirmedFaceImageUrl &&
        character.confirmedFaceImageUrl !== selectedImageUrl
      ) {
        setPendingCharacterFaceChange({
          assetId,
          imageId,
          characterName: assetName,
          imageUrl: selectedImageUrl,
          affectedLookCount: (character.looks || []).filter((look: CharacterLook) => (
            look.imageUrl || look.fourViewImageUrl
          )).length,
        });
        setAssetImageChooserTarget(null);
        return;
      }
    }

    selectPrimaryAssetImage(assetId, imageId, assetName, assetType, selectedImageUrl);
  }, [charactersData, characterBatchInfo, selectPrimaryAssetImage]);

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
  const manuallyStoppedLookGenerations = useRef<Set<string>>(new Set());
  const pendingLookGenerationRequests = useRef<Set<string>>(new Set());

  const getLookGenerationKey = (character: any, lookId: string) => {
    return `${character?.id ?? character?.name ?? 'unknown'}-${character?.name ?? 'unknown'}-${lookId}`;
  };

  // 仅停止当前页面等待；外部任务提交后无法在这里真正撤销
  const cancelLookGeneration = (character: any, lookId: string) => {
    const generationKey = getLookGenerationKey(character, lookId);
    const wasPendingSubmission = pendingLookGenerationRequests.current.delete(generationKey);
    // 先中止正在进行的请求
    const controller = lookAbortControllers.current.get(generationKey);
    if (controller) {
      manuallyStoppedLookGenerations.current.add(generationKey);
      controller.abort();
      lookAbortControllers.current.delete(generationKey);
    }
    // 无论是否有 controller，都重置状态（防止点击时 controller 尚未注册的竞态）
    updateLookById(lookId, {
      isGenerating: false,
      generatingStatus: undefined,
      generationError: undefined,
    }, character);
    toast.warning(wasPendingSubmission
      ? '已取消本次造型任务提交'
      : '已停止在当前页面等待。外部生图任务可能仍会在后台完成并按成功结果扣点，请稍后到资产管理查看');
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
    setExecutionScript('');
    setExecutionScriptSourceSignature('');
    setCreationBible(DEFAULT_CREATION_BIBLE);
    setScenesData(null);
    setCharactersData(null);
    setCharacterVoiceData(null);
    setVoiceLibrary([]);
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
    setBatchAssetGenerationHistory({ ...INITIAL_BATCH_ASSET_GENERATION_HISTORY });
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
      voices: 'pending',
      props: 'pending',
      outline: 'pending',
    });
    setExtractionReview(INITIAL_EXTRACTION_REVIEW);
    extractionReviewRequestedRef.current = false;
    extractionReviewRunningRef.current = false;
    void syncVoiceLibrary(false);
    // 触发资产管理组件刷新
    setAssetRefreshTrigger(prev => prev + 1);
    toast.success('已清除所有数据，可以重新开始');
  }, [clearAll, setCurrentStep, setUploadedFileName, setFileContent, setExecutionScript,
      setExecutionScriptSourceSignature, setCreationBible, setScenesData,
      setCharactersData, setCharacterVoiceData, setVoiceLibrary, setPropsData, setOutline, setSelectedChapter, setStoryboard,
      setImageStoryboards, setConnectingPrompts, setVideoResults, setVideoTotalDuration,
      setProgress, setVideoRatio, setAssetImagesObj, setStepConfirmed, setExtractionStatus,
      setBatchAssetGenerationHistory, setExtractionReview,
      requireLoginBeforePaidAction, syncVoiceLibrary]);

  // 导出项目
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [exportingPromptChapter, setExportingPromptChapter] = useState<number | null>(null);
  const [isExportingExecutionScript, setIsExportingExecutionScript] = useState(false);

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

  const shouldSaveToServerDownloads = () => {
    if (typeof window === 'undefined') return true;
    return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
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
    [STORAGE_KEYS.EXECUTION_SCRIPT]: normalizedExecutionScript,
    [STORAGE_KEYS.EXECUTION_SCRIPT_SOURCE_SIGNATURE]: executionScriptSourceSignature,
    [STORAGE_KEYS.CREATION_BIBLE]: creationBible,
    [STORAGE_KEYS.SCENES_DATA]: scenesData,
    [STORAGE_KEYS.CHARACTERS_DATA]: charactersData,
    [STORAGE_KEYS.CHARACTER_VOICE_DATA]: characterVoiceData,
    [STORAGE_KEYS.VOICE_LIBRARY]: voiceLibrary,
    [STORAGE_KEYS.PROPS_DATA]: propsData,
    [STORAGE_KEYS.OUTLINE]: outline,
    [STORAGE_KEYS.OUTLINE_BATCH_INFO]: outlineBatchInfo,
    [STORAGE_KEYS.SCENE_BATCH_INFO]: sceneBatchInfo,
    [STORAGE_KEYS.CHARACTER_BATCH_INFO]: characterBatchInfo,
    [STORAGE_KEYS.PROP_BATCH_INFO]: propBatchInfo,
    [STORAGE_KEYS.EXTRACTION_REVIEW]: extractionReview,
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
    [STORAGE_KEYS.BATCH_ASSET_GENERATION_HISTORY]: batchAssetGenerationHistory,
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
          saveToDownloads: shouldSaveToServerDownloads(),
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

  const handleExportExecutionScript = async () => {
    if (!(await requireLoginBeforePaidAction())) return;

    if (!hasCurrentExecutionScript()) {
      toast.error('还没有可导出的执行剧本');
      return;
    }

    setIsExportingExecutionScript(true);
    const toastId = toast.loading('正在导出执行剧本 Word...');
    try {
      const response = await fetch('/api/export-execution-script-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyTitle: outline?.title || uploadedFileName || getCurrentFileName(),
          sourceFileName: getCurrentFileName(),
          executionScript: normalizedExecutionScript,
          saveToDownloads: false,
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
        toast.success(`执行剧本已保存到下载目录：${data.filename}`);
        if (data.filePath) {
          navigator.clipboard.writeText(data.filePath).catch(() => undefined);
          toast.info(`文件路径已复制：${data.filePath}`);
        }
        return;
      }

      const blob = await response.blob();
      if (blob.size === 0) throw new Error('导出文件为空，请重新尝试');
      const fallbackName = `${outline?.title || uploadedFileName || '执行剧本'}_执行剧本.docx`;
      const filename = getDownloadFilename(response.headers.get('Content-Disposition'), fallbackName);
      downloadBlob(blob, filename);
      toast.dismiss(toastId);
      toast.success(`执行剧本 Word 已导出：${filename}`);
    } catch (error) {
      console.error('导出执行剧本失败:', error);
      toast.dismiss(toastId);
      toast.error(getNetworkErrorMessage(error, '导出执行剧本'));
    } finally {
      setIsExportingExecutionScript(false);
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
      body: JSON.stringify({ state, projectName, saveToDownloads: shouldSaveToServerDownloads() }),
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
          executionScript: STORAGE_KEYS.EXECUTION_SCRIPT,
          executionScriptSourceSignature: STORAGE_KEYS.EXECUTION_SCRIPT_SOURCE_SIGNATURE,
          creationBible: STORAGE_KEYS.CREATION_BIBLE,
          scenesData: STORAGE_KEYS.SCENES_DATA,
          charactersData: STORAGE_KEYS.CHARACTERS_DATA,
          characterVoiceData: STORAGE_KEYS.CHARACTER_VOICE_DATA,
          voiceLibrary: STORAGE_KEYS.VOICE_LIBRARY,
          propsData: STORAGE_KEYS.PROPS_DATA,
          outline: STORAGE_KEYS.OUTLINE,
          outlineBatchInfo: STORAGE_KEYS.OUTLINE_BATCH_INFO,
          sceneBatchInfo: STORAGE_KEYS.SCENE_BATCH_INFO,
          characterBatchInfo: STORAGE_KEYS.CHARACTER_BATCH_INFO,
          propBatchInfo: STORAGE_KEYS.PROP_BATCH_INFO,
          extractionReview: STORAGE_KEYS.EXTRACTION_REVIEW,
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
          batchAssetGenerationHistory: STORAGE_KEYS.BATCH_ASSET_GENERATION_HISTORY,
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
        const response = await fetch('/api/assets-config', {
          headers: { 'X-Skip-Login-Prompt': '1' },
        });
        if (response.status === 401) return;
        const data = await response.json();

        if (data.success && !data.assetsExist) {
          // 自动初始化
          await fetch('/api/assets-config', {
            method: 'PUT',
            headers: { 'X-Skip-Login-Prompt': '1' },
          });
          console.log('资产文件夹已自动初始化');
        }
      } catch (error) {
        console.error('初始化资产文件夹失败:', error);
      }
    };

    initAssetsFolder();
  }, []);

  // 不同类型的提取数据可能分时恢复；按已知素材名称签名分别增量同步。
  const assetRestoreSignatureRef = useRef('');

  // 从本地资产文件夹恢复图片，并按素材名称重新关联到场景/人物/道具卡片。
  useEffect(() => {
    const knownAssets: Record<'scene' | 'character' | 'prop', any[]> = {
      scene: [
        ...(scenesData?.scenes || []),
        ...(sceneBatchInfo?.allScenes || []),
      ],
      character: [
        ...(charactersData?.characters || []),
        ...(characterBatchInfo?.allCharacters || []),
      ],
      prop: [
        ...(propsData?.props || []),
        ...(propBatchInfo?.allProps || []),
      ],
    };
    const restoreSignature = (['scene', 'character', 'prop'] as const)
      .map(type => {
        const identities = knownAssets[type]
          .map(item => {
            const assetIdentity = normalizeAssetIdentity(item?.name);
            if (type !== 'character') return assetIdentity;
            const lookIds = Array.isArray(item?.looks)
              ? item.looks.map((look: CharacterLook) => String(look?.id || '').trim()).filter(Boolean).sort()
              : [];
            return `${assetIdentity}[${lookIds.join('|')}]`;
          })
          .filter(Boolean);
        return `${type}:${Array.from(new Set(identities)).sort().join('|')}`;
      })
      .join('::') + `::revision:${assetRestoreRevision}`;

    if (!Object.values(knownAssets).some(items => items.length > 0)) return;
    if (assetRestoreSignatureRef.current === restoreSignature) return;
    assetRestoreSignatureRef.current = restoreSignature;

    const restoreAssets = async () => {
      try {
        console.log('[素材图片] 正在从账号资产目录增量同步图片库...');
        const response = await fetch('/api/assets-restore?type=all');
        const data = await response.json();

        if (data.success && data.assetImages) {
          const knownNameMaps = Object.fromEntries(
            (['scene', 'character', 'prop'] as const).map(type => {
              const nameMap = new Map<string, string>();
              knownAssets[type].forEach(item => {
                if (!item?.name) return;
                const normalized = normalizeAssetIdentity(item.name);
                if (normalized && !nameMap.has(`asset:${normalized}`)) nameMap.set(`asset:${normalized}`, item.name);
                if (type === 'scene') {
                  const stateIdentity = normalizeSceneMarkerIdentity(item.name);
                  if (stateIdentity && !nameMap.has(`state:${stateIdentity}`)) {
                    nameMap.set(`state:${stateIdentity}`, item.name);
                  }
                  if (!item.referenceSceneName && item.imageMode !== 'image-to-image') {
                    const locationIdentity = normalizeSceneLocationIdentity(item.name);
                    if (locationIdentity && !nameMap.has(`location:${locationIdentity}`)) {
                      nameMap.set(`location:${locationIdentity}`, item.name);
                    }
                  }
                }
              });
              return [type, nameMap];
            })
          ) as Record<'scene' | 'character' | 'prop', Map<string, string>>;

          const restoredMatches: Array<{
            type: 'scene' | 'character' | 'prop';
            assetName: string;
            file: RestoredAssetImage;
            index: number;
          }> = [];

          const characterFiles = Array.isArray(data.assetImages.character)
            ? data.assetImages.character as RestoredAssetImage[]
            : [];
          const validAssetFileUrls = Object.fromEntries(
            (['scene', 'character', 'prop'] as const).map(type => [
              type,
              new Set(
                (Array.isArray(data.assetImages[type]) ? data.assetImages[type] as RestoredAssetImage[] : [])
                  .map(file => file.url)
                  .filter(Boolean)
              ),
            ])
          ) as Record<'scene' | 'character' | 'prop', Set<string>>;
          const validCharacterFileUrls = new Set(characterFiles.map(file => file.url).filter(Boolean));
          const latestCharacterFileByBase = new Map<string, RestoredAssetImage>();
          characterFiles.forEach(file => {
            if (file?.name && file?.url && !latestCharacterFileByBase.has(file.name)) {
              latestCharacterFileByBase.set(file.name, file);
            }
          });

          const restoredCharacterLooks = new Map<string, {
            image?: RestoredAssetImage;
            fourView?: RestoredAssetImage;
          }>();
          knownAssets.character.forEach((character: Character) => {
            if (!character?.name || !Array.isArray(character.looks)) return;
            const characterName = String(character.name);
            const normalBase = getAssetStorageFileBase(characterName);
            const fourViewBase = getAssetStorageFileBase(`${characterName}的四视图`);
            character.looks.forEach((look: CharacterLook) => {
              const lookId = String(look?.id || '').trim();
              if (!lookId) return;
              const matchKey = `${characterName}\u0000${lookId}`;
              const existing = restoredCharacterLooks.get(matchKey) || {};
              const image = existing.image || latestCharacterFileByBase.get(`${normalBase}_${lookId}`);
              const fourView = existing.fourView || latestCharacterFileByBase.get(`${fourViewBase}_${lookId}`);
              restoredCharacterLooks.set(matchKey, {
                image,
                fourView,
              });
            });
          });

          (['scene', 'character', 'prop'] as const).forEach(type => {
            const files = Array.isArray(data.assetImages[type])
              ? data.assetImages[type] as RestoredAssetImage[]
              : [];
            files.forEach((file, index) => {
              if (!file?.url || !file?.name) return;
              const assetName = knownNameMaps[type].get(`asset:${normalizeAssetIdentity(file.name)}`)
                || (type === 'scene'
                  ? knownNameMaps.scene.get(`state:${normalizeSceneMarkerIdentity(file.name)}`)
                    || knownNameMaps.scene.get(`location:${normalizeSceneLocationIdentity(file.name)}`)
                  : undefined);
              if (assetName) restoredMatches.push({ type, assetName, file, index });
            });
          });

          setAssetImages(prev => {
            const next = new Map(prev);
            let changed = false;
            next.forEach((asset, assetId) => {
              const validUrls = validAssetFileUrls[asset.type];
              const images = (asset.images || []).filter(image => (
                !image.imageUrl?.includes('/api/assets-view?') || validUrls.has(image.imageUrl)
              ));
              if (images.length !== (asset.images || []).length) {
                next.set(assetId, { ...asset, images });
                changed = true;
              }
            });
            restoredMatches.forEach(({ type, assetName, file, index }) => {
              const assetId = `${type}-${assetName}`;
              const existing = next.get(assetId);
              const existingImages = existing?.images || [];
              if (existingImages.some(image => image.imageUrl === file.url)) return;

              const restoredImage: AssetSingleImage = {
                imageId: `restored-${type}-${file.timestamp || Date.now()}-${index}`,
                imageUrl: file.url,
                isCustom: false,
                isFromLibrary: true,
                originalName: file.name,
                isGenerating: false,
              };
              next.set(assetId, {
                assetId,
                type,
                name: assetName,
                images: [...existingImages, restoredImage].slice(0, MAX_IMAGES_PER_ASSET),
              });
              changed = true;
            });
            return changed ? next : prev;
          });
          if (restoredMatches.length > 0) {
            setAssetGenerationErrors(prev => {
              const next = { ...prev };
              let changed = false;
              restoredMatches.forEach(({ type, assetName }) => {
                const assetId = `${type}-${assetName}`;
                if (assetId in next) {
                  delete next[assetId];
                  changed = true;
                }
              });
              return changed ? next : prev;
            });
          }

          const resolveRestoredLocalUrl = (currentUrl: string | undefined, restored?: RestoredAssetImage) => {
            const currentLocalFileIsMissing = Boolean(
              currentUrl?.includes('/api/assets-view?') && !validCharacterFileUrls.has(currentUrl)
            );
            if (restored?.url && (!currentUrl || currentLocalFileIsMissing)) return restored.url;
            if (currentLocalFileIsMissing) return undefined;
            return currentUrl;
          };
          const restoreCharacterLookImages = (characters: Character[]) => {
            let changed = false;
            const nextCharacters = characters.map(character => {
              if (!Array.isArray(character.looks) || character.looks.length === 0) return character;
              let characterChanged = false;
              const looks = character.looks.map(look => {
                const restored = restoredCharacterLooks.get(`${character.name}\u0000${look.id}`);
                if (!restored) return look;

                const nextImageUrl = resolveRestoredLocalUrl(look.imageUrl, restored.image);
                const nextFourViewUrl = resolveRestoredLocalUrl(look.fourViewImageUrl, restored.fourView);
                const imageChanged = nextImageUrl !== look.imageUrl;
                const fourViewChanged = nextFourViewUrl !== look.fourViewImageUrl;
                const imageErrorChanged = Boolean(restored.image?.url && look.generationError);
                const fourViewErrorChanged = Boolean(restored.fourView?.url && look.fourViewError);
                if (!imageChanged && !fourViewChanged && !imageErrorChanged && !fourViewErrorChanged) return look;

                characterChanged = true;
                return {
                  ...look,
                  ...(imageChanged ? {
                    imageUrl: nextImageUrl,
                    isGenerating: false,
                    generatingStatus: undefined,
                  } : {}),
                  ...(imageErrorChanged ? { generationError: undefined } : {}),
                  ...(fourViewChanged ? {
                    fourViewImageUrl: nextFourViewUrl,
                    isGeneratingFourView: false,
                    fourViewStatus: undefined,
                  } : {}),
                  ...(fourViewErrorChanged ? { fourViewError: undefined } : {}),
                };
              });
              if (!characterChanged) return character;
              changed = true;
              return { ...character, looks };
            });
            return changed ? nextCharacters : characters;
          };

          if (restoredCharacterLooks.size > 0) {
            setCharactersData((previous: any) => {
              if (!Array.isArray(previous?.characters)) return previous;
              const characters = restoreCharacterLookImages(previous.characters);
              return characters === previous.characters ? previous : { ...previous, characters };
            });
            setCharacterBatchInfo((previous: any) => {
              if (!Array.isArray(previous?.allCharacters)) return previous;
              const allCharacters = restoreCharacterLookImages(previous.allCharacters);
              return allCharacters === previous.allCharacters ? previous : { ...previous, allCharacters };
            });
          }

          console.log('[素材图片] 图片库同步完成，共',
            Object.values(data.assetImages as Record<string, RestoredAssetImage[]>).flat().length,
            '张图片，自动关联', restoredMatches.length, '张基础图、',
            Array.from(restoredCharacterLooks.values()).filter(match => match.image || match.fourView).length,
            '个造型槽位');
        }
      } catch (error) {
        console.error('恢复图片库失败:', error);
        assetRestoreSignatureRef.current = '';
      }
    };

    restoreAssets();
  }, [
    scenesData,
    charactersData,
    propsData,
    sceneBatchInfo,
    characterBatchInfo,
    propBatchInfo,
    assetRestoreRevision,
    setAssetImages,
    setCharactersData,
    setCharacterBatchInfo,
  ]);

  // 单独重试某个提取
  const retryExtraction = async (type: 'scenes' | 'characters' | 'voices' | 'props' | 'outline') => {
    if (!fileContent) {
      toast.error('请先上传文件');
      return;
    }
    if (!(await requireLoginBeforePaidAction())) return;

    if (type === 'scenes' || type === 'characters' || type === 'props') {
      extractionReviewRequestedRef.current = true;
      setExtractionReview({
        ...INITIAL_EXTRACTION_REVIEW,
        status: 'pending',
      });
    }

    setExtractionStatus(prev => ({ ...prev, [type]: 'loading' }));
    const extractionContent = getExtractionSourceContent();
    if (!extractionContent) {
      setExtractionStatus(prev => ({ ...prev, [type]: 'pending' }));
      toast.error('执行剧本未就绪，请先重新拉取执行剧本再提取');
      return;
    }

    if (type === 'outline') {
      setOutlineBatchInfo(null);
      setOutline(null);
      await extractOutlineBatch(extractionContent, getCurrentFileName(), 1, null, [], undefined, true);
      return;
    }

    try {
      const endpoint = type === 'voices' ? '/api/extract-character-voices' : `/api/extract-${type}`;
      // 场景和人物提取需要传递 batch 参数
      const body: any = {
        content: extractionContent,
        fileName: getCurrentFileName(),
        sourceType: 'execution-script',
      };
      if (type === 'scenes' || type === 'characters' || type === 'props') {
        body.batch = 1;
        body.creationBible = getCreationBiblePayload();
      }
      if (type === 'voices') {
        body.characters = charactersData?.characters || characterBatchInfo?.allCharacters || [];
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
                setExtractionStatus(prev => ({ ...prev, scenes: 'loading' }));
                await continueSceneExtraction({
                  currentBatch: data.batchInfo.currentBatch,
                  totalBatches: data.batchInfo.totalBatches,
                  hasMore: data.batchInfo.hasMore,
                  sceneMarkers: data.batchInfo.sceneMarkers || [],
                  allScenes: data.data.scenes || [],
                });
                return;
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
                setExtractionStatus(prev => ({ ...prev, characters: 'loading' }));
                await continueCharacterExtraction({
                  currentBatch: data.batchInfo.currentBatch,
                  totalBatches: data.batchInfo.totalBatches,
                  hasMore: data.batchInfo.hasMore,
                  characterMarkers: data.batchInfo.characterMarkers || [],
                  allCharacters: data.data.characters || [],
                });
                return;
              }
            } else {
              setCharactersData(data.data);
            }
            break;
          case 'voices':
            setCharacterVoiceData(data.data);
            if (data.tokenUsage) {
              setTokenUsage(prev => ({ ...prev, extractVoices: data.tokenUsage }));
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
                propInventory: data.batchInfo.propInventory || [],
                allProps: data.data.props || [],
              });
              setPropsData({
                totalProps: data.batchInfo.propMarkers?.length || data.data.props?.length,
                props: data.data.props,
              });
              if (data.batchInfo.hasMore) {
                setExtractionStatus(prev => ({ ...prev, props: 'loading' }));
                await continuePropExtraction({
                  currentBatch: data.batchInfo.currentBatch,
                  totalBatches: data.batchInfo.totalBatches,
                  hasMore: data.batchInfo.hasMore,
                  propMarkers: data.batchInfo.propMarkers || [],
                  propInventory: data.batchInfo.propInventory || [],
                  allProps: data.data.props || [],
                });
                return;
              }
            } else {
              setPropsData(data.data);
            }
            break;
        }
        setExtractionStatus(prev => ({ ...prev, [type]: 'success' }));
        toast.success(`${type === 'scenes' ? '场景' : type === 'characters' ? '人物' : type === 'voices' ? '人物音色' : type === 'props' ? '道具' : '大纲'}提取成功`);
      } else {
        setExtractionStatus(prev => ({ ...prev, [type]: 'error' }));
        toast.error(`${type === 'scenes' ? '场景' : type === 'characters' ? '人物' : type === 'voices' ? '人物音色' : type === 'props' ? '道具' : '大纲'}提取失败`);
      }
    } catch (error) {
      setExtractionStatus(prev => ({ ...prev, [type]: 'error' }));
      toast.error(getNetworkErrorMessage(error, `提取${type === 'scenes' ? '场景' : type === 'characters' ? '人物' : type === 'voices' ? '人物音色' : type === 'props' ? '道具' : '大纲'}`));
    }
  };

  // 全部重新提取
  const retryAllExtractions = async () => {
    if (!fileContent) {
      toast.error('请先上传文件');
      return;
    }
    if (!(await requireLoginBeforePaidAction())) return;
    extractionReviewRequestedRef.current = true;
    setExtractionReview({
      ...INITIAL_EXTRACTION_REVIEW,
      status: 'pending',
    });

    const extractionContent = getExtractionSourceContent();
    if (!extractionContent) {
      toast.error('执行剧本未就绪，请先重新拉取执行剧本再提取');
      return;
    }
    toast.info('正在重新提取所有内容...');
    const fileName = getCurrentFileName();
    const creationBiblePayload = getCreationBiblePayload();

    setExtractionStatus({
      scenes: 'loading',
      characters: 'loading',
      voices: 'loading',
      props: 'loading',
      outline: 'loading',
    });

    // 清空大纲批次信息和场景批次信息
    setOutlineBatchInfo(null);
    setSceneBatchInfo(null);
    setCharacterBatchInfo(null);
    setPropBatchInfo(null);
    setCharacterVoiceData(null);

    // 并行调用场景、人物、人物音色、道具 API，大纲单独分批处理
    const [scenesResult, charactersResult, voicesResult, propsResult] = await Promise.allSettled([
      fetch('/api/extract-scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: extractionContent,
          fileName,
          batch: 1,
          creationBible: creationBiblePayload,
          sourceType: 'execution-script',
        }),
      }),
      fetch('/api/extract-characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: extractionContent,
          fileName,
          batch: 1,
          creationBible: creationBiblePayload,
          sourceType: 'execution-script',
        }),
      }),
      fetch('/api/extract-character-voices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: extractionContent,
          fileName,
          characters: charactersData?.characters || [],
          sourceType: 'execution-script',
        }),
      }),
      fetch('/api/extract-props', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: extractionContent,
          fileName,
          batch: 1,
          creationBible: creationBiblePayload,
          sourceType: 'execution-script',
        }),
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
            setExtractionStatus(prev => ({ ...prev, scenes: 'loading' }));
            void continueSceneExtraction({
              currentBatch: data.batchInfo.currentBatch,
              totalBatches: data.batchInfo.totalBatches,
              hasMore: data.batchInfo.hasMore,
              sceneMarkers: data.batchInfo.sceneMarkers || [],
              allScenes: data.data.scenes || [],
            });
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
            setExtractionStatus(prev => ({ ...prev, characters: 'loading' }));
            void continueCharacterExtraction({
              currentBatch: data.batchInfo.currentBatch,
              totalBatches: data.batchInfo.totalBatches,
              hasMore: data.batchInfo.hasMore,
              characterMarkers: data.batchInfo.characterMarkers || [],
              allCharacters: data.data.characters || [],
            });
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

    // 处理人物音色结果
    if (voicesResult.status === 'fulfilled') {
      const data = await voicesResult.value.json();
      if (data.success) {
        setCharacterVoiceData(data.data);
        setExtractionStatus(prev => ({ ...prev, voices: 'success' }));
        if (data.tokenUsage) {
          setTokenUsage(prev => ({ ...prev, extractVoices: data.tokenUsage }));
        }
      } else {
        setExtractionStatus(prev => ({ ...prev, voices: 'error' }));
      }
    } else {
      setExtractionStatus(prev => ({ ...prev, voices: 'error' }));
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
            propInventory: data.batchInfo.propInventory || [],
            allProps: data.data.props || [],
          });
          setPropsData({
            totalProps: data.batchInfo.propMarkers?.length || data.data.props?.length,
            props: data.data.props,
          });

          if (data.batchInfo.hasMore) {
            setExtractionStatus(prev => ({ ...prev, props: 'loading' }));
            void continuePropExtraction({
              currentBatch: data.batchInfo.currentBatch,
              totalBatches: data.batchInfo.totalBatches,
              hasMore: data.batchInfo.hasMore,
              propMarkers: data.batchInfo.propMarkers || [],
              propInventory: data.batchInfo.propInventory || [],
              allProps: data.data.props || [],
            });
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
    await extractOutlineBatch(extractionContent, fileName, 1, null, []);
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
          sourceType: 'execution-script',
          episodeMarkers: episodeMarkers || outlineBatchInfo?.episodeMarkers,  // 传递集数数组
          basicInfo: basicInfo || outlineBatchInfo?.basicInfo,
        }),
      });

      const data = await response.json();

      if (data.success) {
        // 合并章节，并去除重复的 chapterNumber
        const combinedChapters = [...existingChapters, ...data.outline.chapters].map((chapter: Chapter) => ({
          ...chapter,
          title: getCanonicalEpisodeTitle(chapter.chapterNumber),
        }));
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
            toast.info(`已提取第 ${data.batchInfo.currentBatch}/${data.batchInfo.totalBatches} 批分集，请确认后继续`);
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
    if (!hasConfirmedCreationBible()) return;

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
      toast.info(`检测到大纲只提取了 ${extractedChapters}/${expectedChapters} 集，正在自动补齐剩余分集...`);

      const startBatch = outlineBatchInfo?.hasMore
        ? outlineBatchInfo.currentBatch + 1
        : 1;
      const existingChapters = outlineBatchInfo?.allChapters?.length
        ? outlineBatchInfo.allChapters
        : outline.chapters || [];

      void extractOutlineBatch(
        getExtractionSourceContent(),
        getCurrentFileName(),
        startBatch,
        outlineBatchInfo?.basicInfo || null,
        outlineBatchInfo?.hasMore ? existingChapters : [],
        outlineBatchInfo?.episodeMarkers,
        true
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileContent, uploadedFileName, outline, outlineBatchInfo, getCurrentFileName, getExtractionSourceContent]);

  // 继续提取下一批场景
  const continueSceneExtraction = async (
    batchState: SceneBatchInfo | null = sceneBatchInfo,
    isContinuation = false
  ) => {
    if (!fileContent || !batchState) {
      toast.error('无法继续提取场景');
      return;
    }
    if (!isContinuation) {
      if (assetExtractionChainRef.current.scenes) return;
      assetExtractionChainRef.current.scenes = true;
    }
    if (!(await requireLoginBeforePaidAction())) {
      if (!isContinuation) assetExtractionChainRef.current.scenes = false;
      return;
    }

    const nextBatch = batchState.currentBatch + 1;
    setExtractionStatus(prev => ({ ...prev, scenes: 'loading' }));

    try {
      const response = await fetch('/api/extract-scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: getExtractionSourceContent(),
          fileName: getCurrentFileName(),
          batch: nextBatch,
          sceneMarkers: batchState.sceneMarkers,
          creationBible: getCreationBiblePayload(),
          sourceType: 'execution-script',
        }),
      });

      const data = await response.json();

      if (data.success) {
        const newScenes = [...batchState.allScenes, ...data.data.scenes];
        const nextBatchState: SceneBatchInfo = {
          currentBatch: data.batchInfo.currentBatch,
          totalBatches: data.batchInfo.totalBatches,
          hasMore: data.batchInfo.hasMore,
          sceneMarkers: data.batchInfo.sceneMarkers,
          allScenes: newScenes,
        };

        setSceneBatchInfo(nextBatchState);

        setScenesData({
          totalScenes: newScenes.length,
          scenes: newScenes,
        });

        if (data.tokenUsage) {
          setTokenUsage(prev => ({ ...prev, extractScenes: data.tokenUsage }));
        }

        if (!data.batchInfo.hasMore) {
          setExtractionStatus(prev => ({ ...prev, scenes: 'success' }));
          toast.success(`场景已全部提取完成，正在整理有效制作状态`);
        } else {
          setExtractionStatus(prev => ({ ...prev, scenes: 'loading' }));
          await continueSceneExtraction(nextBatchState, true);
        }
      } else {
        setExtractionStatus(prev => ({ ...prev, scenes: 'error' }));
        toast.error('场景提取失败');
      }
    } catch (error) {
      setExtractionStatus(prev => ({ ...prev, scenes: 'error' }));
      toast.error(getNetworkErrorMessage(error, '提取场景'));
    } finally {
      if (!isContinuation) assetExtractionChainRef.current.scenes = false;
    }
  };

  // 继续提取下一批人物
  const continueCharacterExtraction = async (
    batchState: CharacterBatchInfo | null = characterBatchInfo,
    isContinuation = false
  ) => {
    if (!fileContent || !batchState) {
      toast.error('无法继续提取人物');
      return;
    }
    if (!isContinuation) {
      if (assetExtractionChainRef.current.characters) return;
      assetExtractionChainRef.current.characters = true;
    }
    if (!(await requireLoginBeforePaidAction())) {
      if (!isContinuation) assetExtractionChainRef.current.characters = false;
      return;
    }

    const nextBatch = batchState.currentBatch + 1;
    setExtractionStatus(prev => ({ ...prev, characters: 'loading' }));

    try {
      const response = await fetch('/api/extract-characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: getExtractionSourceContent(),
          fileName: getCurrentFileName(),
          batch: nextBatch,
          characterMarkers: batchState.characterMarkers,
          creationBible: getCreationBiblePayload(),
          sourceType: 'execution-script',
        }),
      });

      const data = await response.json();

      if (data.success) {
        const newCharacters = [...batchState.allCharacters, ...data.data.characters];
        const nextBatchState: CharacterBatchInfo = {
          currentBatch: data.batchInfo.currentBatch,
          totalBatches: data.batchInfo.totalBatches,
          hasMore: data.batchInfo.hasMore,
          characterMarkers: data.batchInfo.characterMarkers,
          allCharacters: newCharacters,
        };

        setCharacterBatchInfo(nextBatchState);

        setCharactersData({
          totalCharacters: newCharacters.length,
          characters: newCharacters,
        });

        if (data.tokenUsage) {
          setTokenUsage(prev => ({ ...prev, extractCharacters: data.tokenUsage }));
        }

        if (!data.batchInfo.hasMore) {
          setExtractionStatus(prev => ({ ...prev, characters: 'success' }));
          toast.success(`人物已全部提取完成，共 ${newCharacters.length} 人`);
        } else {
          setExtractionStatus(prev => ({ ...prev, characters: 'loading' }));
          await continueCharacterExtraction(nextBatchState, true);
        }
      } else {
        setExtractionStatus(prev => ({ ...prev, characters: 'error' }));
        toast.error('人物提取失败');
      }
    } catch (error) {
      setExtractionStatus(prev => ({ ...prev, characters: 'error' }));
      toast.error(getNetworkErrorMessage(error, '提取人物'));
    } finally {
      if (!isContinuation) assetExtractionChainRef.current.characters = false;
    }
  };

  // 继续提取下一批道具
  const continuePropExtraction = async (
    batchState: PropBatchInfo | null = propBatchInfo,
    isContinuation = false
  ) => {
    if (!fileContent || !batchState) {
      toast.error('无法继续提取道具');
      return;
    }
    if (!isContinuation) {
      if (assetExtractionChainRef.current.props) return;
      assetExtractionChainRef.current.props = true;
    }
    if (!(await requireLoginBeforePaidAction())) {
      if (!isContinuation) assetExtractionChainRef.current.props = false;
      return;
    }

    const nextBatch = batchState.currentBatch + 1;
    setExtractionStatus(prev => ({ ...prev, props: 'loading' }));

    try {
      const response = await fetch('/api/extract-props', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: getExtractionSourceContent(),
          fileName: getCurrentFileName(),
          batch: nextBatch,
          propMarkers: batchState.propMarkers,
          propInventory: batchState.propInventory || [],
          creationBible: getCreationBiblePayload(),
          sourceType: 'execution-script',
        }),
      });

      const data = await response.json();

      if (data.success) {
        const newProps = [...batchState.allProps, ...data.data.props];
        const mainPropCount = new Set(newProps.map((prop: Prop) => prop.mainPropName || prop.name)).size;
        const nextBatchState: PropBatchInfo = {
          currentBatch: data.batchInfo.currentBatch,
          totalBatches: data.batchInfo.totalBatches,
          hasMore: data.batchInfo.hasMore,
          propMarkers: data.batchInfo.propMarkers,
          propInventory: data.batchInfo.propInventory || batchState.propInventory || [],
          allProps: newProps,
        };

        setPropBatchInfo(nextBatchState);

        setPropsData({
          totalProps: mainPropCount,
          totalMainProps: mainPropCount,
          totalPropStates: newProps.length,
          props: newProps,
        });

        if (data.tokenUsage) {
          setTokenUsage(prev => ({ ...prev, extractProps: data.tokenUsage }));
        }

        if (!data.batchInfo.hasMore) {
          setExtractionStatus(prev => ({ ...prev, props: 'success' }));
          toast.success(`道具已全部提取完成，共 ${mainPropCount} 个物品、${newProps.length} 个制作状态`);
        } else {
          setExtractionStatus(prev => ({ ...prev, props: 'loading' }));
          await continuePropExtraction(nextBatchState, true);
        }
      } else {
        setExtractionStatus(prev => ({ ...prev, props: 'error' }));
        toast.error('道具提取失败');
      }
    } catch (error) {
      setExtractionStatus(prev => ({ ...prev, props: 'error' }));
      toast.error(getNetworkErrorMessage(error, '提取道具'));
    } finally {
      if (!isContinuation) assetExtractionChainRef.current.props = false;
    }
  };

  const migrateReviewedAssetAliases = useCallback((aliases: {
    scenes?: Record<string, string>;
    characters?: Record<string, string>;
    props?: Record<string, string>;
  }) => {
    const aliasGroups = [
      ['scene', aliases.scenes || {}],
      ['character', aliases.characters || {}],
      ['prop', aliases.props || {}],
    ] as const;
    if (!aliasGroups.some(([, entries]) => Object.keys(entries).length > 0)) return;

    setAssetImages(previous => {
      const next = new Map(previous);
      aliasGroups.forEach(([type, entries]) => {
        Object.entries(entries).forEach(([fromName, toName]) => {
          if (!fromName || !toName || fromName === toName) return;
          const sourceKey = `${type}-${fromName}`;
          const targetKey = `${type}-${toName}`;
          const sourceAsset = next.get(sourceKey);
          if (!sourceAsset) return;
          const targetAsset = next.get(targetKey);
          const seen = new Set<string>();
          const images = [
            ...(targetAsset?.images || []),
            ...(sourceAsset.images || []),
          ].filter(image => {
            const identity = image.imageUrl || image.imageId;
            if (!identity || seen.has(identity)) return false;
            seen.add(identity);
            return true;
          }).slice(0, MAX_IMAGES_PER_ASSET).map((image, index) => ({
            ...image,
            imageId: `${targetKey}-${index}`,
          }));
          next.set(targetKey, {
            ...(targetAsset || sourceAsset),
            assetId: targetKey,
            type,
            name: toName,
            images,
          });
          next.delete(sourceKey);
        });
      });
      return next;
    });
  }, [setAssetImages]);

  const runExtractionQualityReview = useCallback(async (manual = false) => {
    if (extractionReviewRunningRef.current) return;
    if (!fileContent) {
      toast.error('缺少原剧本，无法进行全文复核');
      return;
    }
    if (!(await requireLoginBeforePaidAction())) return;

    const scenes = ((sceneBatchInfo?.allScenes?.length ?? 0) > 0
      ? sceneBatchInfo?.allScenes
      : scenesData?.scenes) || [];
    const characters = ((characterBatchInfo?.allCharacters?.length ?? 0) > 0
      ? characterBatchInfo?.allCharacters
      : charactersData?.characters) || [];
    const props = ((propBatchInfo?.allProps?.length ?? 0) > 0
      ? propBatchInfo?.allProps
      : propsData?.props) || [];
    if (scenes.length === 0 || characters.length === 0 || props.length === 0) {
      if (manual) toast.error('请先完成人物、场景和道具提取');
      return;
    }
    const reviewContent = getExtractionSourceContent();
    if (!reviewContent) {
      toast.error('执行剧本未就绪，已停止质量核验；请先重新拉取执行剧本');
      return;
    }

    extractionReviewRunningRef.current = true;
    extractionReviewRequestedRef.current = false;
    setExtractionReview(previous => ({
      ...previous,
      status: 'reviewing',
      error: undefined,
    }));
    const toastId = toast.loading('正在通读执行剧本，核验重复项、人物性别、角色形态与造型时间线...');

    try {
      const response = await fetch('/api/review-extractions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: reviewContent,
          sourceType: 'execution-script',
          scenes,
          characters,
          props,
          creationBible: getCreationBiblePayload(),
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        throw new Error(result?.details || result?.error || '提取结果复核失败');
      }

      const reviewedScenes = Array.isArray(result.data?.scenes) ? result.data.scenes : scenes;
      const reviewedCharacters = Array.isArray(result.data?.characters) ? result.data.characters : characters;
      const reviewedProps = Array.isArray(result.data?.props) ? result.data.props : props;

      setScenesData((previous: any) => ({
        ...(previous || {}),
        totalScenes: reviewedScenes.length,
        totalMainScenes: result.data?.totalMainScenes ?? new Set(reviewedScenes.map((scene: Scene) => getSceneMainLocation(scene))).size,
        scenes: reviewedScenes,
        qualityReview: result.review,
      }));
      setSceneBatchInfo(previous => previous ? {
        ...previous,
        currentBatch: previous.totalBatches,
        hasMore: false,
        sceneMarkers: Array.from(new Set<string>(reviewedScenes.map((scene: Scene) => getSceneMainLocation(scene))))
          .filter((name): name is string => Boolean(name)),
        allScenes: reviewedScenes,
      } : previous);

      setCharactersData((previous: any) => ({
        ...(previous || {}),
        totalCharacters: reviewedCharacters.length,
        characters: reviewedCharacters,
        qualityReview: result.review,
      }));
      setCharacterBatchInfo(previous => previous ? {
        ...previous,
        currentBatch: previous.totalBatches,
        hasMore: false,
        characterMarkers: reviewedCharacters.map((character: Character) => character.name),
        allCharacters: reviewedCharacters,
      } : previous);

      const totalMainProps = result.data?.totalMainProps ?? new Set(
        reviewedProps.map((prop: Prop) => prop.mainPropName || prop.name)
      ).size;
      setPropsData((previous: any) => ({
        ...(previous || {}),
        totalProps: totalMainProps,
        totalMainProps,
        totalPropStates: reviewedProps.length,
        props: reviewedProps,
        qualityReview: result.review,
      }));
      setPropBatchInfo(previous => previous ? {
        ...previous,
        currentBatch: previous.totalBatches,
        hasMore: false,
        propMarkers: Array.from(new Set(reviewedProps.map((prop: Prop) => prop.mainPropName || prop.name))),
        propInventory: [],
        allProps: reviewedProps,
      } : previous);

      migrateReviewedAssetAliases(result.aliases || {});
      const nextReview: ExtractionReviewState = {
        status: 'success',
        candidateCount: Number(result.review?.candidateCount || 0),
        mergedGroupCount: Number(result.review?.mergedGroupCount || 0),
        removedCount: {
          scenes: Number(result.review?.removedCount?.scenes || 0),
          characters: Number(result.review?.removedCount?.characters || 0),
          props: Number(result.review?.removedCount?.props || 0),
        },
        groups: Array.isArray(result.review?.groups) ? result.review.groups : [],
        lifecycle: result.review?.lifecycle ? {
          requiredCount: Number(result.review.lifecycle.requiredCount || 0),
          coveredBeforeRepair: Number(result.review.lifecycle.coveredBeforeRepair || 0),
          repairedByModel: Number(result.review.lifecycle.repairedByModel || 0),
          fallbackAdded: Number(result.review.lifecycle.fallbackAdded || 0),
          unresolvedCount: Number(result.review.lifecycle.unresolvedCount || 0),
          affectedCharacters: Array.isArray(result.review.lifecycle.affectedCharacters)
            ? result.review.lifecycle.affectedCharacters.filter(Boolean)
            : [],
        } : undefined,
        reviewedAt: Number(result.review?.reviewedAt || Date.now()),
      };
      setExtractionReview(nextReview);
      toast.dismiss(toastId);
      const lifecycleAdded = (nextReview.lifecycle?.repairedByModel || 0) + (nextReview.lifecycle?.fallbackAdded || 0);
      const semanticCorrected = Number(result.review?.semantic?.genderCorrectedCount || 0)
        + Number(result.review?.semantic?.creatureCorrectedCount || 0);
      const reviewDescription = [
        nextReview.mergedGroupCount > 0
          ? `合并 ${nextReview.mergedGroupCount} 组重复项（场景 ${nextReview.removedCount.scenes}、人物 ${nextReview.removedCount.characters}、道具 ${nextReview.removedCount.props}）`
          : '未发现可确认的重复项',
        lifecycleAdded > 0
          ? `补齐 ${lifecycleAdded} 项人物时期/状态造型`
          : `人物造型时间线已覆盖 ${nextReview.lifecycle?.requiredCount || 0} 项明确证据`,
        semanticCorrected > 0
          ? `修正 ${semanticCorrected} 项人物性别或非人角色形态`
          : '人物性别与角色形态核验通过',
        (nextReview.lifecycle?.unresolvedCount || 0) > 0
          ? `仍有 ${nextReview.lifecycle?.unresolvedCount} 项需人工复核`
          : '',
      ].filter(Boolean).join('；');
      toast.success('全文质量核验完成', {
        description: reviewDescription,
        duration: 9000,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '提取结果复核失败';
      console.error('[全文提取复核] 失败:', error);
      setExtractionReview(previous => ({
        ...previous,
        status: 'error',
        error: message,
      }));
      toast.dismiss(toastId);
      toast.error(message);
    } finally {
      extractionReviewRunningRef.current = false;
    }
  }, [
    fileContent,
    sceneBatchInfo,
    characterBatchInfo,
    propBatchInfo,
    scenesData,
    charactersData,
    propsData,
    getCreationBiblePayload,
    getExtractionSourceContent,
    requireLoginBeforePaidAction,
    migrateReviewedAssetAliases,
    setScenesData,
    setSceneBatchInfo,
    setCharactersData,
    setCharacterBatchInfo,
    setPropsData,
    setPropBatchInfo,
    setExtractionReview,
  ]);

  useEffect(() => {
    if (!extractionReviewRequestedRef.current || extractionReviewRunningRef.current) return;
    const allAssetExtractionsFinished =
      extractionStatus.scenes === 'success' &&
      extractionStatus.characters === 'success' &&
      extractionStatus.props === 'success' &&
      !sceneBatchInfo?.hasMore &&
      !characterBatchInfo?.hasMore &&
      !propBatchInfo?.hasMore;
    if (!allAssetExtractionsFinished) return;
    void runExtractionQualityReview(false);
  }, [
    extractionStatus.scenes,
    extractionStatus.characters,
    extractionStatus.props,
    sceneBatchInfo?.hasMore,
    characterBatchInfo?.hasMore,
    propBatchInfo?.hasMore,
    runExtractionQualityReview,
  ]);

  // 旧版本若停在“等待下一批”，升级后自动接着完成，无需用户再次确认。
  useEffect(() => {
    if (!fileContent || !hasCurrentExecutionScript() || !hasConfirmedCreationBible()) return;

    if (
      sceneBatchInfo?.hasMore &&
      (extractionStatus.scenes === 'loading' || extractionStatus.scenes === 'batch_confirm') &&
      !assetExtractionChainRef.current.scenes
    ) {
      void continueSceneExtraction(sceneBatchInfo);
    }
    if (
      characterBatchInfo?.hasMore &&
      (extractionStatus.characters === 'loading' || extractionStatus.characters === 'batch_confirm') &&
      !assetExtractionChainRef.current.characters
    ) {
      void continueCharacterExtraction(characterBatchInfo);
    }
    if (
      propBatchInfo?.hasMore &&
      (extractionStatus.props === 'loading' || extractionStatus.props === 'batch_confirm') &&
      !assetExtractionChainRef.current.props
    ) {
      void continuePropExtraction(propBatchInfo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fileContent,
    sceneBatchInfo,
    characterBatchInfo,
    propBatchInfo,
    extractionStatus.scenes,
    extractionStatus.characters,
    extractionStatus.props,
    hasCurrentExecutionScript,
  ]);

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
    toast.info(`正在提取第 ${nextBatch}/${outlineBatchInfo.totalBatches} 批分集...`);

    await extractOutlineBatch(
      getExtractionSourceContent(),
      getCurrentFileName(),
      nextBatch,
      outlineBatchInfo.basicInfo,
      outlineBatchInfo.allChapters
    );
  };

  // 并行提取五个维度
  const extractAllParallel = async (
    content: string,
    fileName: string,
    bible: CreationBiblePayload = getCreationBiblePayload()
  ) => {
    if (!(await requireLoginBeforePaidAction())) return;
    extractionReviewRequestedRef.current = true;
    setExtractionReview({
      ...INITIAL_EXTRACTION_REVIEW,
      status: 'pending',
    });
    const creationBiblePayload = bible;

    setCurrentStep(1);
    setProgress(20);
    toast.info('正在并行提取场景、人物、人物音色、道具和大纲，较长剧本可能需要几分钟...');

    // 初始化状态
    setExtractionStatus({
      scenes: 'loading',
      characters: 'loading',
      voices: 'loading',
      props: 'loading',
      outline: 'loading',
    });

    // 清空大纲批次信息
    setOutlineBatchInfo(null);
    setSceneBatchInfo(null);
    setCharacterBatchInfo(null);
    setPropBatchInfo(null);
    setCharacterVoiceData(null);

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
          body: JSON.stringify({
            content,
            fileName,
            batch: 1,
            creationBible: creationBiblePayload,
            sourceType: 'execution-script',
          }),
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
            setExtractionStatus(prev => ({ ...prev, scenes: 'loading' }));
            await continueSceneExtraction({
              currentBatch: data.batchInfo.currentBatch,
              totalBatches: data.batchInfo.totalBatches,
              hasMore: data.batchInfo.hasMore,
              sceneMarkers: data.batchInfo.sceneMarkers || [],
              allScenes: data.data.scenes || [],
            });
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
          body: JSON.stringify({
            content,
            fileName,
            batch: 1,
            creationBible: creationBiblePayload,
            sourceType: 'execution-script',
          }),
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
            setExtractionStatus(prev => ({ ...prev, characters: 'loading' }));
            await continueCharacterExtraction({
              currentBatch: data.batchInfo.currentBatch,
              totalBatches: data.batchInfo.totalBatches,
              hasMore: data.batchInfo.hasMore,
              characterMarkers: data.batchInfo.characterMarkers || [],
              allCharacters: data.data.characters || [],
            });
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

    const runVoicesExtraction = async () => {
      try {
        const response = await fetch('/api/extract-character-voices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
            fileName,
            characters: charactersData?.characters || [],
            sourceType: 'execution-script',
          }),
        });
        const data = await parseExtractionResponse(response, '人物音色');
        setCharacterVoiceData(data.data);
        setExtractionStatus(prev => ({ ...prev, voices: 'success' }));
        if (data.tokenUsage) {
          setTokenUsage(prev => ({ ...prev, extractVoices: data.tokenUsage }));
        }
        if (data.data?.warning) toast.warning(data.data.warning);
      } catch (error) {
        setExtractionStatus(prev => ({ ...prev, voices: 'error' }));
        toast.error(getNetworkErrorMessage(error, '提取人物音色'));
      }
    };

    const runPropsExtraction = async () => {
      try {
        const response = await fetch('/api/extract-props', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
            fileName,
            batch: 1,
            creationBible: creationBiblePayload,
            sourceType: 'execution-script',
          }),
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
            propInventory: data.batchInfo.propInventory || [],
            allProps: data.data.props || [],
          });
          setPropsData({
            totalProps: data.batchInfo.propMarkers?.length || data.data.props?.length,
            props: data.data.props,
          });

          if (data.batchInfo.hasMore) {
            setExtractionStatus(prev => ({ ...prev, props: 'loading' }));
            await continuePropExtraction({
              currentBatch: data.batchInfo.currentBatch,
              totalBatches: data.batchInfo.totalBatches,
              hasMore: data.batchInfo.hasMore,
              propMarkers: data.batchInfo.propMarkers || [],
              propInventory: data.batchInfo.propInventory || [],
              allProps: data.data.props || [],
            });
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
      runVoicesExtraction(),
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
    toast.success(`第 ${chapterNumber} 集文字分镜已确认`);
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
    toast.success(`第 ${chapterNumber} 集素材已确认，请前往提示词标签页生成提示词`);
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
  const getCurrentCharacterItems = (): Character[] => (
    (charactersData?.characters && charactersData.characters.length > 0)
      ? charactersData.characters
      : (characterBatchInfo?.allCharacters || [])
  );

  const getCurrentSceneItems = (): Scene[] => (
    ((sceneBatchInfo?.allScenes?.length ?? 0) > 0)
      ? (sceneBatchInfo?.allScenes || [])
      : (scenesData?.scenes || [])
  );

  const getCurrentPropItems = (): Prop[] => (
    ((propBatchInfo?.allProps?.length ?? 0) > 0)
      ? (propBatchInfo?.allProps || [])
      : (propsData?.props || [])
  );

  const getShotCharacterReference = (shot: Shot, characterName: string, chapterNumber: number) => {
    const character = findCharacterByShotName(getCurrentCharacterItems(), characterName);
    const shotCharacter = shot.characters?.find(item => normalizeAssetIdentity(item.name) === normalizeAssetIdentity(characterName));
    const look = character && shotCharacter
      ? findCharacterLookForShot(character, shotCharacter, shot, chapterNumber)
      : undefined;
    const lookImageUrl = look?.imageUrl?.trim() || '';
    const faceImageUrl = character?.confirmedFaceImageUrl?.trim()
      || getAssetImages('character', characterName, characterName)?.images.find(image => image.imageUrl && !image.isGenerating)?.imageUrl
      || '';
    return {
      character,
      look,
      lookId: look?.id,
      variantImageUrl: look ? lookImageUrl : faceImageUrl,
      imageUrl: lookImageUrl || faceImageUrl,
      label: look ? `${characterName} · ${look.scene || look.ageStage || look.id}` : characterName,
    };
  };

  const getShotSceneReference = (shot: Shot, chapterNumber: number) => {
    const scene = findSceneStateForShot(getCurrentSceneItems(), shot, chapterNumber);
    const variantImageUrl = scene
      ? getAssetImages('scene', scene.name, scene.name)?.images.find(image => image.imageUrl && !image.isGenerating)?.imageUrl || ''
      : '';
    const fallbackImageUrl = scene?.referenceSceneName
      ? getAssetImages('scene', scene.referenceSceneName, scene.referenceSceneName)?.images.find(image => image.imageUrl && !image.isGenerating)?.imageUrl || ''
      : '';
    return {
      scene,
      variantImageUrl,
      imageUrl: variantImageUrl || fallbackImageUrl,
    };
  };

  const getShotPropReference = (shot: Shot, propName: string, chapterNumber: number) => {
    const prop = findPropStateForShot(getCurrentPropItems(), propName, shot, chapterNumber);
    const variantImageUrl = prop
      ? getAssetImages('prop', prop.name, prop.name)?.images.find(image => image.imageUrl && !image.isGenerating)?.imageUrl || ''
      : '';
    const fallbackImageUrl = prop?.referencePropName
      ? getAssetImages('prop', prop.referencePropName, prop.referencePropName)?.images.find(image => image.imageUrl && !image.isGenerating)?.imageUrl || ''
      : '';
    return {
      prop,
      variantImageUrl,
      imageUrl: variantImageUrl || fallbackImageUrl,
    };
  };

  /** 获取当前提示词组涉及的人物/场景/道具图（只取提示词中提到的） */
  const getGroupAssetImages = (cs: ChapterStoryboard, pg: PromptGroup) => {
    const groupShots = pg.shotNumbers.map(sn =>
      cs.storyboard?.shots.find(s => s.shotNumber === sn)
    ).filter(Boolean) as Shot[];
    const urls: string[] = [];
    const seen = new Set<string>();
    const addUrl = (url?: string) => {
      const value = String(url || '').trim();
      if (!value || seen.has(value) || urls.length >= 9) return;
      seen.add(value);
      urls.push(value);
    };

    groupShots.forEach(shot => {
      (shot.characters || []).forEach(character => {
        addUrl(getShotCharacterReference(shot, character.name, cs.chapterNumber).imageUrl);
      });
    });
    groupShots.forEach(shot => {
      const sceneReference = getShotSceneReference(shot, cs.chapterNumber);
      addUrl(sceneReference.imageUrl);
    });
    groupShots.forEach(shot => {
      (shot.scene?.props || []).forEach(propName => {
        addUrl(getShotPropReference(shot, propName, cs.chapterNumber).imageUrl);
      });
    });

    return urls;
  };

  const getChapterRelatedAssets = (chapterNumber: number) => {
    const cs = chapterStoryboards[chapterNumber];
    if (!cs?.storyboard?.shots) return { characters: [], scenes: [], props: [] };

    const charactersByName = new Map<string, any>();
    const scenesByName = new Map<string, any>();
    const propsByName = new Map<string, any>();

    cs.storyboard.shots.forEach((shot, shotIndex) => {
      (shot.characters || []).forEach((shotCharacter, characterIndex) => {
        const character = findCharacterByShotName(getCurrentCharacterItems(), shotCharacter.name) || {
          id: `char-from-shot-${shotIndex}-${characterIndex}`,
          name: shotCharacter.name,
          role: '角色',
        };
        charactersByName.set(normalizeAssetIdentity(character.name), character);
      });

      if (shot.scene?.location) {
        const scene = findSceneStateForShot(getCurrentSceneItems(), shot, chapterNumber) || {
          id: `scene-from-shot-${shotIndex}`,
          name: shot.scene.location,
          type: '场景',
        };
        scenesByName.set(normalizeAssetIdentity(scene.name), scene);
      }

      (shot.scene?.props || []).forEach((propName, propIndex) => {
        const prop = findPropStateForShot(getCurrentPropItems(), propName, shot, chapterNumber) || {
          id: `prop-from-shot-${shotIndex}-${propIndex}`,
          name: propName,
          type: '道具',
        };
        propsByName.set(normalizeAssetIdentity(prop.name), prop);
      });
    });

    const characters = Array.from(charactersByName.values());
    const scenes = Array.from(scenesByName.values());
    const props = Array.from(propsByName.values());

    console.log('[getChapterRelatedAssets] 匹配结果:', {
      characters: characters.length,
      scenes: scenes.length,
      props: props.length,
    });

    return { characters, scenes, props };
  };

  // 获取章节关联的素材图片（用于视频生成）
  const getChapterAssetImages = (chapterNumber: number): AssetImages[] => {
    const cs = chapterStoryboards[chapterNumber];
    if (!cs?.storyboard?.shots) return [];
    const result: AssetImages[] = [];
    const seen = new Set<string>();
    const addAsset = (asset?: AssetImages) => {
      if (!asset || asset.images.length === 0 || seen.has(asset.assetId)) return;
      seen.add(asset.assetId);
      result.push(asset);
    };
    const addSyntheticImage = (type: AssetImages['type'], name: string, imageUrl: string, suffix: string) => {
      if (!imageUrl) return;
      const assetId = `${type}-${name}-${suffix}`;
      addAsset({
        assetId,
        type,
        name,
        images: [{ imageId: assetId, imageUrl, isGenerating: false }],
      });
    };

    cs.storyboard.shots.forEach(shot => {
      const sceneReference = getShotSceneReference(shot, chapterNumber);
      if (sceneReference.scene) {
        const sceneAsset = getAssetImages('scene', sceneReference.scene.name, sceneReference.scene.name)
          || (sceneReference.scene.referenceSceneName
            ? getAssetImages('scene', sceneReference.scene.referenceSceneName, sceneReference.scene.referenceSceneName)
            : undefined);
        addAsset(sceneAsset);
      }

      (shot.characters || []).forEach(shotCharacter => {
        const reference = getShotCharacterReference(shot, shotCharacter.name, chapterNumber);
        if (reference.look?.imageUrl) {
          addSyntheticImage('character', shotCharacter.name, reference.look.imageUrl, `look-${reference.look.id}`);
        } else {
          addAsset(getAssetImages('character', shotCharacter.name, shotCharacter.name));
        }
      });

      (shot.scene?.props || []).forEach(propName => {
        const reference = getShotPropReference(shot, propName, chapterNumber);
        if (reference.prop) {
          const propAsset = getAssetImages('prop', reference.prop.name, reference.prop.name)
            || (reference.prop.referencePropName
              ? getAssetImages('prop', reference.prop.referencePropName, reference.prop.referencePropName)
              : undefined);
          addAsset(propAsset);
        }
      });
    });

    console.log(`[getChapterAssetImages] 章节${chapterNumber}获取到 ${result.length} 个素材的图片`);
    return result;
  };

  type ChapterAssetReference = {
    type: 'character' | 'scene' | 'prop';
    entityName: string;
    label: string;
    imageUrl: string;
    episodeNumber: number;
    variantId?: string;
  };

  const getChapterAssetReferences = (cs: ChapterStoryboard): ChapterAssetReference[] => {
    const references = new Map<string, ChapterAssetReference>();
    const addReference = (reference: ChapterAssetReference) => {
      const key = `${reference.type}:${normalizeAssetIdentity(reference.entityName)}:${reference.variantId || normalizeAssetIdentity(reference.label)}`;
      const existing = references.get(key);
      if (!existing || (!existing.imageUrl && reference.imageUrl)) references.set(key, reference);
    };

    (cs.storyboard?.shots || []).forEach(shot => {
      (shot.characters || []).forEach(shotCharacter => {
        const reference = getShotCharacterReference(shot, shotCharacter.name, cs.chapterNumber);
        addReference({
          type: 'character',
          entityName: shotCharacter.name,
          label: reference.label,
          imageUrl: reference.variantImageUrl,
          episodeNumber: cs.chapterNumber,
          variantId: reference.lookId,
        });
      });

      if (shot.scene?.location) {
        const reference = getShotSceneReference(shot, cs.chapterNumber);
        addReference({
          type: 'scene',
          entityName: reference.scene?.name || shot.scene.location,
          label: reference.scene?.name || shot.scene.location,
          imageUrl: reference.variantImageUrl,
          episodeNumber: cs.chapterNumber,
        });
      }

      (shot.scene?.props || []).forEach(propName => {
        const reference = getShotPropReference(shot, propName, cs.chapterNumber);
        addReference({
          type: 'prop',
          entityName: reference.prop?.name || propName,
          label: reference.prop?.name || propName,
          imageUrl: reference.variantImageUrl,
          episodeNumber: cs.chapterNumber,
        });
      });
    });

    return Array.from(references.values());
  };

  // 按原镜头顺序累计实际时长：以14-15秒为目标，且单组绝不超过15秒。
  const groupShotsIntoPromptGroups = (
    videoPrompts: VideoPromptItem[],
    shots: Shot[]
  ): PromptGroup[] => {
    const shotByNumber = new Map(shots.map(shot => [shot.shotNumber, shot]));
    const shotOrder = new Map(shots.map((shot, index) => [shot.shotNumber, index]));
    const orderedPrompts = videoPrompts
      .map((item, inputIndex) => ({ item, inputIndex }))
      .sort((left, right) => {
        const leftOrder = shotOrder.get(left.item.shotNumber) ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = shotOrder.get(right.item.shotNumber) ?? Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder || left.inputIndex - right.inputIndex;
      })
      .map(entry => entry.item);

    const durationGroups = groupContiguousItemsByDuration(
      orderedPrompts,
      item => item.duration ?? shotByNumber.get(item.shotNumber)?.duration,
    );

    const groups = durationGroups.map((durationGroup, groupIndex): PromptGroup => {
      const shotNumbers = durationGroup.entries.map(entry => entry.item.shotNumber);
      const combinedPrompt = durationGroup.entries.map((entry, idx) => {
        const item = entry.item;
        const prevTransition = idx > 0 ? '【衔接上一镜】过渡至\n' : '';
        return `${prevTransition}【镜头${item.shotNumber} · ${formatStoryboardDurationSeconds(entry.duration)}秒】${item.videoPrompt}`;
      }).join('\n\n');

      return {
        groupIndex: groupIndex + 1,
        shotNumbers,
        totalDuration: durationGroup.totalDuration,
        groupingStrategy: STORYBOARD_DURATION_GROUPING_STRATEGY,
        combinedPrompt: `【第${groupIndex + 1}组 · ${formatStoryboardDurationSeconds(durationGroup.totalDuration)}秒连贯段落】\n${combinedPrompt}`,
        isGeneratingStoryboard: false,
        isEditing: false,
      };
    });

    console.log(
      `[groupShotsIntoPromptGroups] 将 ${videoPrompts.length} 个分镜按实际时长分为 ${groups.length} 组：`,
      groups.map(group => `${formatStoryboardDurationSeconds(group.totalDuration || 0)}秒`).join(' / '),
    );
    return groups;
  };

  const getPromptGroupDurationSeconds = (cs: ChapterStoryboard, pg: PromptGroup): number => {
    if (typeof pg.totalDuration === 'number' && Number.isFinite(pg.totalDuration) && pg.totalDuration > 0) {
      return Math.round(pg.totalDuration * 10) / 10;
    }

    const promptByShotNumber = new Map(
      (cs.videoPrompts || []).map(prompt => [prompt.shotNumber, prompt]),
    );
    const storyboardShotByNumber = new Map(
      (cs.storyboard?.shots || []).map(shot => [shot.shotNumber, shot]),
    );

    return sumStoryboardDurations(
      pg.shotNumbers.map(shotNumber => (
        promptByShotNumber.get(shotNumber)?.duration
        ?? storyboardShotByNumber.get(shotNumber)?.duration
      )),
    );
  };

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
    chapterNumber = 0,
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
    const findShotForCharacter = (name: string) => shots.find(shot => (
      (shot.characters || []).some(character => normalizeAssetIdentity(character.name) === normalizeAssetIdentity(name))
    ));
    const findShotForScene = (name: string) => shots.find(shot => (
      scoreLinkedName(name, [shot.scene?.location]) > 0
    ));
    const findShotForProp = (name: string) => shots.find(shot => (
      (shot.scene?.props || []).some(propName => scoreLinkedName(name, [propName]) > 0)
    ));
    const addCharacter = (name: string) => {
      const shot = findShotForCharacter(name);
      if (!shot) {
        addImage('character', name, getFirstUsableAssetImage(getAssetImages('character', name, name)));
        return;
      }
      const reference = getShotCharacterReference(shot, name, chapterNumber);
      addImage('character', reference.label, reference.imageUrl);
    };
    const addScene = (name: string) => {
      const shot = findShotForScene(name);
      const reference = shot ? getShotSceneReference(shot, chapterNumber) : undefined;
      const referenceName = reference?.scene?.name || name;
      addImage('scene', referenceName, reference?.imageUrl || getFirstUsableAssetImage(getAssetImages('scene', name, name)));
    };
    const addProp = (name: string) => {
      const shot = findShotForProp(name);
      const reference = shot ? getShotPropReference(shot, name, chapterNumber) : undefined;
      const referenceName = reference?.prop?.name || name;
      addImage('prop', referenceName, reference?.imageUrl || getFirstUsableAssetImage(getAssetImages('prop', name, name)));
    };

    if (storyboardImageUrl) {
      addImage('storyboard', '故事板总控图', storyboardImageUrl);
    }

    entities.characters.slice(0, 3).forEach(addCharacter);
    entities.scenes.slice(0, 2).forEach(addScene);
    entities.characters.slice(3).forEach(addCharacter);
    entities.props.forEach(addProp);
    entities.scenes.slice(2).forEach(addScene);

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

    return getVideoReferenceSelection(entitySearchText, groupShots, pg.storyboardImageUrl, cs.chapterNumber);
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
    const voiceResolution = resolveVideoVoiceAssignments(
      groupShots,
      cs.chapterNumber,
      characterVoiceData,
      voiceLibrary,
    );
    const groupDuration = getPromptGroupDurationSeconds(cs, pg);
    const storyboardPrompt = pg.storyboardPromptText || pg.combinedPrompt || '';
    const shotLines = groupShots.map(shot => {
      const characterText = (shot.characters || []).map(char => {
        return [char.name, char.position, char.action, char.expression].filter(Boolean).join('/');
      }).join('；');
      return `镜头${shot.shotNumber}：${shot.description || shot.actionAndDialogue || ''}；景别${shot.shotType || '中景'}；运镜${shot.cameraMovement || '稳定运镜'}；站位${shot.actorBlocking || characterText || '按故事版总控图执行'}；动作变化${shot.actionChange || '保持连续动作变化'}`;
    }).join('\n');

    return [
      `请生成第${cs.chapterNumber}集第${pg.groupIndex}组连续视频，本组${pg.shotNumbers.length}个连续镜头的实际总时长为${formatStoryboardDurationSeconds(groupDuration)}秒，成片时长按本组实际总时长执行。`,
      buildVideoReferenceManifest(referenceSelection),
      `核心参考：优先严格参考本组故事版总控图的角色形象、场景空间、人物站位、镜头顺序和画面构图。`,
      `本次会提供${referenceSelection.images.length}张参考图。提示词中出现的全部人物、场景、道具都必须参与对应镜头，不能因为没有独立参考图而遗漏。`,
      `【本组故事版提示词】\n${storyboardPrompt}`,
      `【本组镜头内容】\n${shotLines}`,
      voiceResolution.instruction,
      `要求：画面连续、动作自然、人物表情和肢体动作要有变化；保持原剧情，台词必须与文字分镜/原剧本逐字一致，不出现字幕、水印、乱码文字，不新增无关人物。`,
    ].filter(Boolean).join('\n\n');
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
    const referenceSelection = getVideoReferenceSelection(entitySearchText, [shot], shotStoryboardImage, cs.chapterNumber);
    const voiceResolution = resolveVideoVoiceAssignments(
      [shot],
      cs.chapterNumber,
      characterVoiceData,
      voiceLibrary,
    );

    return {
      prompt: [
        buildVideoReferenceManifest(referenceSelection),
        `【镜头生成提示词】\n${promptText}`,
        voiceResolution.instruction,
        '提示词中出现的全部人物、场景、道具都必须参与画面，严格对应参考图，不得遗漏或自行替换。',
      ].filter(Boolean).join('\n\n'),
      imageUrls: referenceSelection.images.map(item => item.url),
      referenceSelection,
      voiceResolution,
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
      const preparedScript = await ensureExecutionScript();
      if (!preparedScript) return;
    }

    if (step === 'extraction') {
      const expectedChapters = outlineBatchInfo?.totalEpisodes || outline?.totalChapters || 0;
      const extractedChapters = Math.max(
        outline?.chapters?.length || 0,
        outlineBatchInfo?.allChapters?.length || 0
      );
      const isOutlineComplete = expectedChapters === 0 || extractedChapters >= expectedChapters;
      const isExtractionComplete =
        effectiveExtractionStatus.scenes === 'success' &&
        effectiveExtractionStatus.characters === 'success' &&
        effectiveExtractionStatus.voices === 'success' &&
        effectiveExtractionStatus.props === 'success' &&
        effectiveExtractionStatus.outline === 'success' &&
        isOutlineComplete;

      if (!isExtractionComplete) {
        if (!isOutlineComplete && fileContent) {
          if (!(await requireLoginBeforePaidAction())) return;
          setExtractionStatus(prev => ({ ...prev, outline: 'loading' }));
          toast.info(`大纲还没提取完：${extractedChapters}/${expectedChapters} 章，正在继续补齐...`);
          void extractOutlineBatch(
            getExtractionSourceContent(),
            getCurrentFileName(),
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
        toast.info('执行剧本已就绪，请确认创作圣经后开始提取');
        break;
      case 'extraction':
        setCurrentStep(2);
        setProgress(30);
        toast.info('请选择分集生成分镜');
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
        toast.info('请确认本集素材图片是否正确');
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
        setExecutionScript('');
        setExecutionScriptSourceSignature('');
        setCreationBible(DEFAULT_CREATION_BIBLE);
        setScenesData(null);
        setCharactersData(null);
        setCharacterVoiceData(null);
        setPropsData(null);
        setExtractionReview(INITIAL_EXTRACTION_REVIEW);
        extractionReviewRequestedRef.current = false;
        setOutline(null);
        setSelectedChapter(null);
        setStoryboard(null);
        setImageStoryboards([]);
        setConnectingPrompts(null);
        setVideoResults([]);
        setVideoTotalDuration(0);
        setAssetImages(() => new Map());
        setBatchAssetGenerationHistory({ ...INITIAL_BATCH_ASSET_GENERATION_HISTORY });
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
        setExtractionReview(INITIAL_EXTRACTION_REVIEW);
        extractionReviewRequestedRef.current = false;
        setOutline(null);
        setSelectedChapter(null);
        setStoryboard(null);
        setImageStoryboards([]);
        setConnectingPrompts(null);
        setVideoResults([]);
        setVideoTotalDuration(0);
        setAssetImages(() => new Map());
        setBatchAssetGenerationHistory({ ...INITIAL_BATCH_ASSET_GENERATION_HISTORY });
        setChapterStoryboards({});
        setCurrentStep(1);
        setProgress(15);
        toast.info('已撤回，将重新提取内容');
        if (fileContent) {
          if (hasConfirmedCreationBible()) {
            extractAllParallel(getExtractionSourceContent(), getCurrentFileName(), getCreationBiblePayload());
          } else {
            toast.info('请先确认创作圣经后再重新提取内容');
          }
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
        toast.info('已撤回，请重新选择分集');
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
        setExecutionScript('');
        setExecutionScriptSourceSignature('');
        setCreationBible(DEFAULT_CREATION_BIBLE);
        setScenesData(null);
        setCharactersData(null);
        setPropsData(null);
        setOutline(null);
        setOutlineBatchInfo(null);
        setSceneBatchInfo(null);
        setCharacterBatchInfo(null);
        setPropBatchInfo(null);
        setExtractionReview(INITIAL_EXTRACTION_REVIEW);
        extractionReviewRequestedRef.current = false;
        setBatchAssetGenerationHistory({ ...INITIAL_BATCH_ASSET_GENERATION_HISTORY });
        setStepConfirmed(prev => ({ ...prev, upload: false, extraction: false }));
        setExtractionStatus({
          scenes: 'pending',
          characters: 'pending',
          voices: 'pending',
          props: 'pending',
          outline: 'pending',
        });
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
        setExecutionScript('');
        setExecutionScriptSourceSignature('');
        setCreationBible(DEFAULT_CREATION_BIBLE);
        setProgress(0);
      }
    } catch (error) {
      console.error('文件上传失败:', error);
      toast.error(getNetworkErrorMessage(error, '上传文件'));

      // 重置状态
      setUploadedFile(null);
      setFileContent('');
      setExecutionScript('');
      setExecutionScriptSourceSignature('');
      setCreationBible(DEFAULT_CREATION_BIBLE);
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
          chapterNumber: chapter.chapterNumber,
          characters: chapter.characters,
          scenes: chapter.scenes,
          scenesData,
          charactersData,
          propsData,
          creationBible: getCreationBiblePayload(),
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
    storyboardAbortControllersRef.current.forEach(controller => controller.abort());
    storyboardAbortControllersRef.current.clear();
    setGenerationTasks(prev => prev.map(task =>
      task.type === 'storyboard' && (task.status === 'generating' || task.status === 'pending')
        ? { ...task, status: 'error', error: '已手动停止，可继续生成未完成分集', endTime: Date.now(), message: `第 ${task.chapterNumber} 集已停止` }
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
    toast.info('正在停止全部文字分镜任务，请稍候...');
  };

  // 生成单个章节的文字分镜（用于并行生成）- SSE流式版本，支持逐行显示
  const generateSingleStoryboard = async (
    chapter: Chapter,
    options: { skipLoginCheck?: boolean } = {}
  ): Promise<{ chapter: Chapter; storyboard: Storyboard | null; error?: string }> => {
    if (!options.skipLoginCheck && !(await requireLoginBeforePaidAction())) {
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
      message: `正在生成第 ${chapter.chapterNumber} 集分镜...`,
      startTime: Date.now(),
    }]);

    // 初始化一个空的分镜数据
    let shots: any[] = [];
    let chapterTitleResult = chapter.title;
    const controller = new AbortController();
    storyboardAbortControllersRef.current.set(taskId, controller);

    try {
      const response = await fetch('/api/generate-storyboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          chapterContent: chapter.content,
          chapterTitle: chapter.title,
          chapterNumber: chapter.chapterNumber,
          chapterSummary: chapter.summary,  // 添加 summary 作为后备
          characters: chapter.characters,
          scenes: chapter.scenes,
          scenesData,
          charactersData,
          propsData,
          creationBible: getCreationBiblePayload(),
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
              ? { ...t, total: json.targetShotCount, message: `第 ${chapter.chapterNumber} 集开始生成分镜 (目标${json.targetShotCount}个)...` }
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
              ? { ...t, progress: json.progress / 100, message: `第 ${chapter.chapterNumber} 集分镜生成中 (${json.shotNumber}/${json.total})...` }
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
            setTokenUsage(prev => ({
              ...prev,
              generateStoryboard: {
                input: prev.generateStoryboard.input + (Number(json.tokenUsage.input) || 0),
                output: prev.generateStoryboard.output + (Number(json.tokenUsage.output) || 0),
                timestamp: Number(json.tokenUsage.timestamp) || Date.now(),
              },
            }));
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
            ? { ...t, status: 'success', progress: 1, endTime: Date.now(), message: `第 ${chapter.chapterNumber} 集分镜生成完成 (${shots.length}个)` }
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
              message: isAbort ? `第 ${chapter.chapterNumber} 集已停止` : `第 ${chapter.chapterNumber} 集分镜生成失败`,
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
      storyboardAbortControllersRef.current.delete(taskId);
    }
  };

  // 重新生成单个章节的文字分镜
  const regenerateSingleStoryboard = async (chapterNumber: number) => {
    if (!outline?.chapters) return;
    if (!(await requireLoginBeforePaidAction())) return;

    const chapter = outline.chapters.find(c => c.chapterNumber === chapterNumber);
    if (!chapter) {
      toast.error('未找到该分集');
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

    toast.info(`开始重新生成第 ${chapterNumber} 集分镜...`);

    // 调用生成函数
    const result = await generateSingleStoryboard(chapter);

    if (result.storyboard) {
      toast.success(`第 ${chapterNumber} 集分镜重新生成成功`);
    } else {
      toast.error(`第 ${chapterNumber} 集分镜重新生成失败: ${result.error}`);
    }
  };

  // 一键生成所有章节的文字分镜（每4集一批，分批生成）
  const generateAllStoryboards = async () => {
    if (!outline?.chapters || outline.chapters.length === 0) {
      toast.error('没有分集可生成分镜');
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
      toast.success(`全部 ${chapters.length} 集分镜已生成，无需重复生成`);
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
    const batchLabel = `第 ${resumeBatch + 1}/${totalBatches} 批（${startIdx + 1}-${endIdx} 集）`;
    const loadingToast = toast.loading(
      `正在生成 ${batchLabel}，最多 ${STORYBOARD_BATCH_CONCURRENCY} 集同时进行...`
    );
    setBatchInfo({ active: true, batchSize: BATCH_SIZE, totalBatches, completedBatches: resumeBatch });

    const batchResults: { chapterNumber: number; success: boolean; skipped?: boolean; error?: string }[] = [];

    try {
      const batchChapters = chapters.slice(startIdx, endIdx);
      const processChapter = async (
        chapter: Chapter
      ): Promise<{ chapterNumber: number; success: boolean; skipped?: boolean; error?: string }> => {
        const chapterNum = chapter.chapterNumber;

        if (successfulChapterNumbers.has(chapterNum)) {
          return { chapterNumber: chapterNum, success: true, skipped: true };
        }

        const chapterToast = toast.loading(`第 ${chapterNum} 集正在生成...`);
        setCollapsedStoryboardChapters(prev => ({ ...prev, [String(chapterNum)]: false }));

        let lastError = '';
        let result: Awaited<ReturnType<typeof generateSingleStoryboard>> | null = null;

        // 自动重试（最多 2 次）
        for (let attempt = 0; attempt < 3; attempt++) {
          if (storyboardBatchCancelledRef.current) {
            break;
          }

          if (attempt > 0) {
            toast.loading(`第 ${chapterNum} 集第 ${attempt + 1} 次重试...`, { id: chapterToast });
            setGenerationTasks(prev => prev.filter(task =>
              !(task.type === 'storyboard'
                && task.chapterNumber === chapterNum
                && task.status === 'error')
            ));
            await new Promise(resolve => setTimeout(resolve, 3000));
          }

          result = await generateSingleStoryboard(chapter, { skipLoginCheck: true });

          if (result.storyboard) {
            break;
          }
          if (storyboardBatchCancelledRef.current) {
            break;
          }
          lastError = result.error || '未知错误';
        }

        if (storyboardBatchCancelledRef.current || !result) {
          toast.dismiss(chapterToast);
          return { chapterNumber: chapterNum, success: false, error: '已停止生成' };
        }

        const chapterResult = {
          chapterNumber: chapterNum,
          success: !!result.storyboard,
          error: result.storyboard ? undefined : lastError,
        };

        if (result.storyboard) {
          successfulChapterNumbers.add(chapterNum);
          toast.success(`第 ${chapterNum} 集生成成功`, { id: chapterToast });
        } else {
          toast.error(`第 ${chapterNum} 集失败: ${lastError}`, { id: chapterToast });
        }

        return chapterResult;
      };

      let nextChapterIndex = 0;
      const concurrentResults: Array<{
        chapterNumber: number;
        success: boolean;
        skipped?: boolean;
        error?: string;
      } | undefined> = new Array(batchChapters.length);

      const runWorker = async () => {
        while (!storyboardBatchCancelledRef.current) {
          const chapterIndex = nextChapterIndex;
          if (chapterIndex >= batchChapters.length) return;
          nextChapterIndex += 1;
          concurrentResults[chapterIndex] = await processChapter(batchChapters[chapterIndex]);
        }
      };

      const workerCount = Math.min(STORYBOARD_BATCH_CONCURRENCY, batchChapters.length);
      await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
      batchResults.push(...concurrentResults.filter(
        (result): result is NonNullable<typeof result> => Boolean(result)
      ));

      // 当前批次完成
      toast.dismiss(loadingToast);

      const batchSuccessCount = batchResults.filter(r => r.success).length;
      const skippedCount = batchResults.filter(r => r.skipped).length;
      const nextIncompleteIndex = chapters.findIndex(chapter => !successfulChapterNumbers.has(chapter.chapterNumber));
      const newCompletedBatches = nextIncompleteIndex === -1 ? totalBatches : Math.floor(nextIncompleteIndex / BATCH_SIZE);

      if (storyboardBatchCancelledRef.current) {
        toast.info('已停止生成，本批未完成分集下次会自动继续');
        setBatchInfo({ active: true, batchSize: BATCH_SIZE, totalBatches, completedBatches: resumeBatch });
      } else if (nextIncompleteIndex === -1) {
        // 全部批次完成
        const allSuccessCount = successfulChapterNumbers.size;
        const allFailCount = chapters.length - allSuccessCount;

        if (allSuccessCount === chapters.length) {
          toast.success(`全部 ${chapters.length} 集分镜生成成功 🎉`);
        } else if (allSuccessCount > 0) {
          toast.success(`共生成 ${allSuccessCount}/${chapters.length} 集分镜`);
          if (allFailCount > 0) toast.warning(`${allFailCount} 集生成失败，可点击对应分集旁的刷新按钮单独重试`);
        } else {
          toast.error(`全部 ${chapters.length} 集分镜生成失败，请检查网络后逐集重试`);
        }

        setStepConfirmed(prev => ({ ...prev, storyboard: allSuccessCount > 0 }));
        if (allSuccessCount > 0) setCurrentStep(2);
        setBatchInfo({ active: false, batchSize: BATCH_SIZE, totalBatches: 0, completedBatches: 0 });
      } else {
        // 还有下一批，等待用户确认
        const nextChapter = chapters[nextIncompleteIndex];
        const skipText = skippedCount > 0 ? `，已跳过 ${skippedCount} 章成功分镜` : '';
        toast.success(`第 ${resumeBatch + 1}/${totalBatches} 批已处理（${batchSuccessCount}/${endIdx - startIdx} 集成功${skipText}），下次从第 ${nextChapter.chapterNumber} 集继续`);
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
          propsData,
          chapterNumber: selectedChapter?.chapterNumber,
          creationBible: getCreationBiblePayload(),
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
          propsData,
          chapterNumber: selectedChapter?.chapterNumber,
          creationBible: getCreationBiblePayload(),
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

    const preciseDuration = getPromptGroupDurationSeconds(cs, pg);
    if (preciseDuration > STORYBOARD_GROUP_MAX_SECONDS) {
      toast.error(
        `本组实际总时长为 ${formatStoryboardDurationSeconds(preciseDuration)} 秒，超过 15 秒。请先重新生成本集故事版面板描述，系统会按实际时长重新分组。`,
      );
      return;
    }

    const groupKey = getPromptGroupVideoKey(pg);
    const existingVideos = cs.shotVideos?.find(sv => sv.shotNumber === groupKey)?.videos || [];
    const videoId = retryVideoId || `group-video-${cs.chapterNumber}-${pg.groupIndex}-${Date.now()}`;
    const referenceSelection = getPromptGroupReferenceSelection(cs, pg);
    const referenceImages = referenceSelection.images.map(item => item.url);
    const voiceResolution = resolveVideoVoiceAssignments(
      getPromptGroupShots(cs, pg),
      cs.chapterNumber,
      characterVoiceData,
      voiceLibrary,
    );
    if (voiceResolution.missingCharacters.length > 0) {
      toast.error(`请先为以下说话人物捆绑音色：${voiceResolution.missingCharacters.join('、')}`);
      setActiveTab('extraction');
      return;
    }
    const prompt = buildPromptGroupVideoPrompt(cs, pg, referenceSelection);
    const duration = normalizeManfeiDuration(preciseDuration);

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
          speakingCharacters: voiceResolution.speakingCharacters,
          voiceAssignments: voiceResolution.assignments,
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
        const voiceResolution = resolveVideoVoiceAssignments(
          image?.originalShot ? [image.originalShot] : [],
          selectedChapter?.chapterNumber,
          characterVoiceData,
          voiceLibrary,
        );
        if (voiceResolution.missingCharacters.length > 0) {
          throw new Error(`请先为以下说话人物捆绑音色：${voiceResolution.missingCharacters.join('、')}`);
        }
        const video = await createAndWaitForManfeiVideo({
          prompt: [
            promptItem.videoPrompt || promptItem.panelDescription || promptItem.prompt || '',
            voiceResolution.instruction,
          ].filter(Boolean).join('\n\n'),
          imageUrl: image?.imageUrl || '',
          imageUrls: image?.imageUrl ? [image.imageUrl] : [],
          duration,
          videoRatio: getEffectiveVideoRatio(),
          chapterTitle,
          shotNumber: promptItem.shotNumber,
          speakingCharacters: voiceResolution.speakingCharacters,
          voiceAssignments: voiceResolution.assignments,
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
      const voiceResolution = resolveVideoVoiceAssignments(
        imageStoryboard?.originalShot ? [imageStoryboard.originalShot] : [],
        selectedChapter?.chapterNumber,
        characterVoiceData,
        voiceLibrary,
      );
      if (voiceResolution.missingCharacters.length > 0) {
        throw new Error(`请先为以下说话人物捆绑音色：${voiceResolution.missingCharacters.join('、')}`);
      }
      const video = await createAndWaitForManfeiVideo({
        shotNumber,
        prompt: [customPrompt || getShotDescription(shotNumber) || '', voiceResolution.instruction].filter(Boolean).join('\n\n'),
        imageUrl: imageStoryboard?.imageUrl || '',
        imageUrls: imageStoryboard?.imageUrl ? [imageStoryboard.imageUrl] : [],
        duration: normalizeManfeiDuration(promptItem?.duration),
        videoRatio: getEffectiveVideoRatio(),
        speakingCharacters: voiceResolution.speakingCharacters,
        voiceAssignments: voiceResolution.assignments,
      });
      setVideoResults(prev => prev.map(v =>
        v.shotNumber === shotNumber
          ? { ...v, videoUrl: video.url, lastFrameUrl: '' }
          : v
      ));
      toast.success(`镜头 ${shotNumber} 视频已重新生成`);
      setEditingPrompt(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重新生成失败');
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
        const voiceResolution = resolveVideoVoiceAssignments(
          imageStoryboard.originalShot ? [imageStoryboard.originalShot] : [],
          selectedChapter?.chapterNumber,
          characterVoiceData,
          voiceLibrary,
        );
        if (voiceResolution.missingCharacters.length > 0) {
          throw new Error(`请先为以下说话人物捆绑音色：${voiceResolution.missingCharacters.join('、')}`);
        }
        const video = await createAndWaitForManfeiVideo({
          shotNumber: promptItem.shotNumber,
          prompt: [getShotDescription(promptItem.shotNumber) || '', voiceResolution.instruction].filter(Boolean).join('\n\n'),
          imageUrl: imageStoryboard.imageUrl,
          imageUrls: [imageStoryboard.imageUrl],
          duration: normalizeManfeiDuration(promptItem.duration),
          videoRatio: getEffectiveVideoRatio(),
          speakingCharacters: voiceResolution.speakingCharacters,
          voiceAssignments: voiceResolution.assignments,
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

  const getPrimaryCompletedAssetImage = (
    type: 'scene' | 'character' | 'prop',
    name: string
  ): AssetSingleImage | undefined => {
    const asset = getAssetImages(type, name);
    return asset?.images.find(image => !image.isGenerating && typeof image.imageUrl === 'string' && image.imageUrl.trim().length > 0);
  };

  const getSceneReferenceImage = (scene: Scene): AssetSingleImage | undefined => {
    const referenceName = scene.referenceSceneName?.trim();
    if (!referenceName || referenceName === scene.name.trim()) return undefined;
    return getPrimaryCompletedAssetImage('scene', referenceName);
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
      skipAuthCheck?: boolean;
      generatingStatus?: string;
      referenceImageUrl?: string;
      onSuccess?: (image: AssetSingleImage) => void;
    }
  ): Promise<boolean> => {
    if (!data?.name) {
      if (!options?.silent) toast.error('素材名称缺失，无法生成图片');
      return false;
    }

    // 使用素材的名称作为 key，确保唯一性（名称是唯一的，id 可能在分批时重复）
    const assetId = `${type}-${data.name}`;
    const currentAsset = assetImages.get(assetId);
    const currentCount = currentAsset?.images.length || 0;

    // 在调用付费接口前拦截第 4 张图片，避免产生无效扣费。
    if (currentCount >= MAX_IMAGES_PER_ASSET) {
      if (!options?.silent) setAssetImageLimitNotice({ type, name: data.name });
      return false;
    }
    if (!options?.skipAuthCheck && !(await requireLoginBeforePaidAction())) return false;

    const referenceType: 'scene' | 'prop' | null = type === 'scene' ? 'scene' : type === 'prop' ? 'prop' : null;
    const referenceAssetName = type === 'scene' && typeof data.referenceSceneName === 'string'
      ? data.referenceSceneName.trim()
      : type === 'prop' && typeof data.referencePropName === 'string'
        ? data.referencePropName.trim()
        : '';
    const referenceLabel = type === 'prop' ? '道具状态' : '场景';
    let referenceImageUrl = options?.referenceImageUrl?.trim() || '';

    if (referenceAssetName && referenceType && !referenceImageUrl) {
      const referenceImage = getPrimaryCompletedAssetImage(referenceType, referenceAssetName);
      referenceImageUrl = referenceImage?.imageUrl?.trim() || '';
      if (!referenceImageUrl) {
        const referenceAsset = getAssetImages(referenceType, referenceAssetName);
        const referenceIsGenerating = referenceAsset?.images.some(image => image.isGenerating);
        if (!options?.silent) {
          if (referenceIsGenerating) {
            toast.info(`参考${referenceLabel}「${referenceAssetName}」正在生成，请完成后再生成当前变体`);
          } else {
            toast.warning(`请先生成参考${referenceLabel}「${referenceAssetName}」的基准图`);
          }
        }
        return false;
      }
    }

    if (activeAssetGenerationIdsRef.current.has(assetId)) {
      if (!options?.silent) toast.warning(`${data.name} 正在生成中`);
      return false;
    }

    const hasOtherGeneratingImage = currentAsset?.images.some(img => (
      img.isGenerating && !(options?.skipPlaceholder && img.imageId === options.tempImageId)
    ));
    if (hasOtherGeneratingImage) {
      if (!options?.silent) toast.warning(`${data.name} 正在生成中`);
      return false;
    }

    const tempImageId = options?.tempImageId || `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const initialGeneratingStatus = options?.generatingStatus || (
      referenceImageUrl && referenceAssetName
        ? `正在参考「${referenceAssetName}」进行图生图`
        : '请求已提交，正在连接图像模型'
    );

    activeAssetGenerationIdsRef.current.add(assetId);
    setAssetGenerationErrors(prev => {
      if (!(assetId in prev)) return prev;
      const next = { ...prev };
      delete next[assetId];
      return next;
    });
    setAssetGenerationStatuses(prev => ({ ...prev, [assetId]: initialGeneratingStatus }));
    const processingStatusTimer = window.setTimeout(() => {
      setAssetGenerationStatuses(prev => (
        prev[assetId] ? { ...prev, [assetId]: 'API 正在处理并生成图片，请耐心等待' } : prev
      ));
    }, 1800);
    const longProcessingStatusTimer = window.setTimeout(() => {
      setAssetGenerationStatuses(prev => (
        prev[assetId] ? { ...prev, [assetId]: '图片仍在生成，页面可以继续操作' } : prev
      ));
    }, 30000);

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
                ? { ...img, isGenerating: true, generatingStatus: initialGeneratingStatus }
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
            generatingStatus: initialGeneratingStatus,
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
            generatingStatus: initialGeneratingStatus,
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
          currentCount,
          referenceImageUrl: referenceImageUrl || undefined,
          creationBible: getCreationBiblePayload(),
        }),
      });

      const result = await readImageGenerationResponse(response, '图片服务没有返回有效结果');

      if (result.success) {
        const generatedImage: AssetSingleImage = {
          imageId: `img-${Date.now()}`,
          imageUrl: result.localUrl || result.imageUrl,
          imageKey: result.imageKey,
          prompt: result.prompt,
          promptSource: result.prompt ? 'actual' : 'rebuilt',
          isGenerating: false,
          isCustom: false,
        };
        setAssetImages(prev => {
          const newMap = new Map(prev);
          const existing = newMap.get(assetId);
          if (existing) {
            let replacedPlaceholder = false;
            const nextImages = existing.images.map(img => {
              if (img.imageId !== tempImageId) return img;
              replacedPlaceholder = true;
              return generatedImage;
            });
            if (!replacedPlaceholder && !nextImages.some(img => img.imageUrl === generatedImage.imageUrl)) {
              nextImages.push(generatedImage);
            }
            newMap.set(assetId, {
              ...existing,
              images: nextImages,
            });
          } else {
            newMap.set(assetId, {
              assetId,
              type,
              name: data.name,
              images: [generatedImage],
            });
          }
          return newMap;
        });
        setAssetGenerationErrors(prev => {
          if (!(assetId in prev)) return prev;
          const next = { ...prev };
          delete next[assetId];
          return next;
        });
        requestAssetLibrarySync();
        options?.onSuccess?.(generatedImage);
        if (!options?.silent) toast.success(`${data.name} 图片生成成功`);
        return true;
      } else {
        const failureReason = result.error || '图片生成失败：接口没有返回原因';
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
        setAssetGenerationErrors(prev => ({ ...prev, [assetId]: failureReason }));
        if (!options?.silent) toast.error(`${data.name}：${failureReason}`);
        return false;
      }
    } catch (error) {
      const failureReason = getImageRequestFailureReason(error, '生成图片');
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
      setAssetGenerationErrors(prev => ({ ...prev, [assetId]: failureReason }));
      // 浏览器连接中断并不代表上游任务失败；后台若稍后落盘，自动把文件补回当前卡片。
      scheduleAssetLibraryRecovery();
      if (!options?.silent) toast.error(`${data.name}：${failureReason}`);
      return false;
    } finally {
      window.clearTimeout(processingStatusTimer);
      window.clearTimeout(longProcessingStatusTimer);
      activeAssetGenerationIdsRef.current.delete(assetId);
      setAssetGenerationStatuses(prev => {
        if (!(assetId in prev)) return prev;
        const next = { ...prev };
        delete next[assetId];
        return next;
      });
    }
  };

  const generateAllAssetImages = async (
    type: 'scene' | 'character' | 'prop',
    repeatConfirmed = false
  ) => {
    if (batchAssetGenerationGuardRef.current) {
      toast.warning('批量生成任务正在启动或运行，请勿重复点击');
      return;
    }

    batchAssetGenerationGuardRef.current = true;
    try {
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
      const assetId = `${type}-${item.name}`;
      return images.length < MAX_IMAGES_PER_ASSET && !images.some(img => img.isGenerating) && !assetGenerationStatuses[assetId];
    });

    if (allItems.length === 0) {
      toast.error(`暂无${labelMap[type]}数据可生成图片`);
      return;
    }

    if (candidates.length === 0) {
      const itemAtLimit = allItems.find((item: any) => {
        const assetData = getAssetImages(type, item.id, item.name);
        return (assetData?.images?.length || 0) >= MAX_IMAGES_PER_ASSET;
      });
      if (itemAtLimit) {
        setAssetImageLimitNotice({
          type,
          name: allItems.length === 1 ? itemAtLimit.name : `${labelMap[type]}列表中的素材`,
        });
        return;
      }
      toast.info(`${labelMap[type]}列表没有可继续生成的素材`);
      return;
    }

    if (batchAssetGenerationHistory[type] && !repeatConfirmed) {
      setBatchRegenerationConfirmType(type);
      return;
    }

    setBatchAssetGenerationHistory(prev => ({
      ...INITIAL_BATCH_ASSET_GENERATION_HISTORY,
      ...prev,
      [type]: true,
    }));

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

    setAssetGenerationStatuses(prev => {
      const next = { ...prev };
      batchItems.forEach(({ item }) => {
        next[`${type}-${item.name}`] = '已进入队列，等待 API 处理';
      });
      return next;
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
    const generatedReferenceUrls = new Map<string, string>();

    const resolveCanonicalAssetName = (rawName: string) => {
      const normalizedName = normalizeAssetIdentity(rawName);
      const matched = allItems.find((item: any) => normalizeAssetIdentity(item?.name) === normalizedName);
      return matched?.name || rawName;
    };

    const getReferenceAssetName = (item: any) => {
      const rawName = type === 'scene'
        ? item?.referenceSceneName
        : type === 'prop'
          ? item?.referencePropName
          : '';
      return typeof rawName === 'string' && rawName.trim()
        ? resolveCanonicalAssetName(rawName.trim())
        : '';
    };

    const resolveBatchReferenceUrl = (item: any) => {
      const referenceName = getReferenceAssetName(item);
      if (!referenceName || (type !== 'scene' && type !== 'prop')) return '';
      if (referenceName === item.name) return '';
      return generatedReferenceUrls.get(`${type}-${referenceName}`)
        || getPrimaryCompletedAssetImage(type, referenceName)?.imageUrl
        || '';
    };

    const updateBatchProgress = (currentName?: string) => {
      setBatchAssetGeneration({
        type,
        current: completedCount,
        total: candidates.length,
        currentName: currentName || `并发生成中 ${activeCount} 个，排队 ${Math.max(candidates.length - completedCount - activeCount, 0)} 个`,
      });
      toast.loading(`正在批量生成${labelMap[type]}图片：已完成 ${completedCount}/${candidates.length}`, { id: loadingToast });
    };

    const runBatchWave = async (waveItems: typeof batchItems) => {
      let waveIndex = 0;
      const workerCount = Math.min(BATCH_ASSET_IMAGE_CONCURRENCY, waveItems.length);
      const runWorker = async () => {
        while (waveIndex < waveItems.length) {
          const index = waveIndex++;
          const { item, tempImageId } = waveItems[index];
          const referenceImageUrl = resolveBatchReferenceUrl(item);
          const referenceAssetName = getReferenceAssetName(item);

          activeCount++;
          updateBatchProgress(item.name);

          const success = await generateAssetImage(type, item, {
            silent: true,
            tempImageId,
            skipPlaceholder: true,
            skipAuthCheck: true,
            referenceImageUrl: referenceImageUrl || undefined,
            generatingStatus: referenceImageUrl
              ? `正在参考「${referenceAssetName}」进行图生图`
              : '生成中',
            onSuccess: image => {
              generatedReferenceUrls.set(`${type}-${item.name}`, image.imageUrl);
            },
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
    };

    if (type === 'scene' || type === 'prop') {
      let pendingItems = [...batchItems];
      while (pendingItems.length > 0) {
        const readyItems = pendingItems.filter(({ item }) => (
          !getReferenceAssetName(item) || Boolean(resolveBatchReferenceUrl(item))
        ));

        if (readyItems.length === 0) {
          failCount += pendingItems.length;
          completedCount += pendingItems.length;
          setAssetImages(prev => {
            const next = new Map(prev);
            pendingItems.forEach(({ item, tempImageId }) => {
              const assetId = `${type}-${item.name}`;
              const existing = next.get(assetId);
              if (!existing) return;
              next.set(assetId, {
                ...existing,
                images: existing.images.filter(image => image.imageId !== tempImageId),
              });
            });
            return next;
          });
          const missingNames = pendingItems
            .slice(0, 3)
            .map(({ item }) => getReferenceAssetName(item) || item.name)
            .join('、');
          toast.warning(`以下${labelMap[type]}状态缺少可用基准图，已跳过：${missingNames}${pendingItems.length > 3 ? ' 等' : ''}`);
          updateBatchProgress(`等待基准图的${labelMap[type]}已跳过`);
          break;
        }

        await runBatchWave(readyItems);
        const readySet = new Set(readyItems);
        pendingItems = pendingItems.filter(item => !readySet.has(item));
      }
    } else {
      await runBatchWave(batchItems);
    }

    setAssetGenerationStatuses(prev => {
      const next = { ...prev };
      batchItems.forEach(({ item }) => {
        delete next[`${type}-${item.name}`];
      });
      return next;
    });

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
    } finally {
      batchAssetGenerationGuardRef.current = false;
    }
  };

  const updateCharacterIdentityByName = useCallback((characterName: string, updates: Partial<Character>) => {
    const updateCharacters = (characters: Character[]) => characters.map(character => (
      character.name === characterName ? { ...character, ...updates } : character
    ));

    setCharactersData((prev: any) => prev?.characters
      ? { ...prev, characters: updateCharacters(prev.characters) }
      : prev);
    setCharacterBatchInfo((prev: any) => prev?.allCharacters
      ? { ...prev, allCharacters: updateCharacters(prev.allCharacters) }
      : prev);
  }, [setCharactersData, setCharacterBatchInfo]);

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

  const getCharacterFaceReferenceImage = (character: Character): string | undefined => {
    if (!character?.identityImageConfirmed || !character.confirmedFaceImageUrl) return undefined;
    const assetKey = `character-${character?.name}`;
    const existingAsset = assetImages.get(assetKey);
    const confirmedImage = existingAsset?.images?.find((image: AssetSingleImage) => (
      image.imageUrl === character.confirmedFaceImageUrl && !image.isGenerating
    ));
    return confirmedImage?.imageUrl;
  };

  const getCharacterLookReference = (character: Character, look: CharacterLook) => {
    const confirmedFaceImageUrl = getCharacterFaceReferenceImage(character);
    if (!confirmedFaceImageUrl) {
      return {
        imageUrl: undefined,
        label: '人物正脸身份基准图',
        missingMessage: `请先选择并确认 ${character.name} 的正脸身份基准图`,
      };
    }

    if (look.isBaseLook) {
      return {
        imageUrl: confirmedFaceImageUrl,
        label: '已确认正脸身份基准图',
        missingMessage: '',
      };
    }

    if (!look.referenceLookId) {
      return {
        imageUrl: undefined,
        label: '缺少父级造型',
        missingMessage: `造型依赖关系异常：「${look.scene || look.id}」没有父级造型，请重新提取人物信息`,
      };
    }

    const referenceLook = character.looks?.find(candidate => candidate.id === look.referenceLookId);
    if (!referenceLook) {
      return {
        imageUrl: undefined,
        label: look.referenceLookId,
        missingMessage: `造型依赖关系异常：未找到父级造型 ${look.referenceLookId}`,
      };
    }
    if (!referenceLook.imageUrl) {
      return {
        imageUrl: undefined,
        label: referenceLook.scene || referenceLook.id,
        missingMessage: `请先生成父级造型「${referenceLook.scene || referenceLook.id}」`,
      };
    }
    if (referenceLook.identityNeedsReview) {
      return {
        imageUrl: undefined,
        label: referenceLook.scene || referenceLook.id,
        missingMessage: `父级造型「${referenceLook.scene || referenceLook.id}」基于旧正脸，请先重新生成该父级造型`,
      };
    }

    return {
      imageUrl: referenceLook.imageUrl,
      label: referenceLook.scene || referenceLook.id,
      missingMessage: '',
    };
  };

  const confirmCharacterFaceIdentity = (character: Character, faceImageUrl: string) => {
    if (!faceImageUrl) {
      toast.warning(`请先为 ${character.name} 生成或上传人物正脸`);
      return;
    }
    updateCharacterIdentityByName(character.name, {
      identityImageConfirmed: true,
      confirmedFaceImageUrl: faceImageUrl,
      identityConfirmedAt: Date.now(),
      looks: character.looks?.map(look => ({
        ...look,
        identityNeedsReview: Boolean(look.imageUrl && look.identitySourceUrl !== faceImageUrl),
        fourViewIdentityNeedsReview: Boolean(
          look.fourViewImageUrl && (
            look.fourViewIdentitySourceUrl !== faceImageUrl ||
            !look.imageUrl ||
            look.fourViewLookSourceUrl !== look.imageUrl
          )
        ),
      })),
    });
    toast.success(`${character.name} 的正脸身份基准已确认，造型图生图已解锁`);
  };

  // 生成人物造型图片
  const handleGenerateCharacterLookImage = async (character: any, lookId: string) => {
    const look = character.looks?.find((candidate: CharacterLook) => candidate.id === lookId) as CharacterLook | undefined;
    if (!look) {
      toast.error('造型不存在');
      return;
    }
    const reference = getCharacterLookReference(character, look);
    if (!reference.imageUrl) {
      toast.warning(reference.missingMessage);
      return;
    }
    const generationKey = getLookGenerationKey(character, lookId);
    if (
      pendingLookGenerationRequests.current.has(generationKey) ||
      lookAbortControllers.current.has(generationKey)
    ) {
      toast.info(`${character.name} - ${look.scene || lookId} 正在提交或生成，请勿重复点击`);
      return;
    }

    pendingLookGenerationRequests.current.add(generationKey);
    updateLookById(lookId, {
      isGenerating: true,
      generatingStatus: '正在校验账号并准备提交造型任务...',
      generationError: undefined,
    }, character);

    const loginReady = await requireLoginBeforePaidAction();
    const submissionStillActive = pendingLookGenerationRequests.current.delete(generationKey);
    if (!submissionStillActive) return;
    if (!loginReady) {
      updateLookById(lookId, {
        isGenerating: false,
        generatingStatus: undefined,
      }, character);
      return;
    }

    setIsGeneratingImage(true);
    let statusTimer1: ReturnType<typeof setTimeout> | undefined;
    let statusTimer2: ReturnType<typeof setTimeout> | undefined;
    let fetchTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      updateLookById(lookId, {
        isGenerating: true,
        generatingStatus: `账号已确认，正在参考「${reference.label}」提交图生图任务...`,
        generationError: undefined,
      }, character);
      toast.info(`开始生成 ${character.name} - ${look.scene || lookId} 造型图片`);

      // 启动进度更新定时器
      statusTimer1 = setTimeout(() => updateLookById(lookId, { generatingStatus: 'AI 正在生成图片（约30~90秒）...' }, character), 5000);
      statusTimer2 = setTimeout(() => updateLookById(lookId, { generatingStatus: '生成中，请耐心等待...' }, character), 30000);

      // 添加超时控制并注册到取消列表
      const controller = new AbortController();
      fetchTimeout = setTimeout(() => controller.abort(), CHARACTER_IMAGE_REQUEST_TIMEOUT_MS);
      lookAbortControllers.current.set(generationKey, controller);

      const response = await fetch('/api/generate-asset-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'character',
          data: character,
          lookId,
          referenceImageUrl: reference.imageUrl,
          imageVariant: 'character-look',
          creationBible: getCreationBiblePayload(),
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

      const result = await readImageGenerationResponse(response, '造型图片服务没有返回有效结果');

      if (result.success) {
        updateLookById(lookId, {
          imageUrl: result.localUrl || result.imageUrl,
          imagePrompt: result.prompt,
          isGenerating: false,
          generatingStatus: undefined,
          generationError: undefined,
          identitySourceUrl: character.confirmedFaceImageUrl,
          identityNeedsReview: false,
          fourViewIdentityNeedsReview: Boolean(look.fourViewImageUrl),
        }, character);
        requestAssetLibrarySync();
        toast.success(`${character.name} - ${look.scene || lookId} 造型图片生成成功`);
      } else {
        const failureReason = result.error || '造型图片生成失败：接口没有返回原因';
        updateLookById(lookId, {
          isGenerating: false,
          generatingStatus: undefined,
          generationError: failureReason,
        }, character);
        toast.error(`${character.name} - ${look.scene || lookId}：${failureReason}`);
      }
    } catch (error: any) {
      if (fetchTimeout) clearTimeout(fetchTimeout);
      if (statusTimer1) clearTimeout(statusTimer1);
      if (statusTimer2) clearTimeout(statusTimer2);
      lookAbortControllers.current.delete(generationKey);
      const manuallyStopped = manuallyStoppedLookGenerations.current.delete(generationKey);
      const failureReason = getImageRequestFailureReason(error, '造型图片生成');
      updateLookById(lookId, {
        isGenerating: false,
        generatingStatus: undefined,
        generationError: manuallyStopped ? undefined : failureReason,
      }, character);
      scheduleAssetLibraryRecovery();
      if (error?.name === 'AbortError') {
        if (!manuallyStopped) {
          toast.error(`${character.name} - ${look.scene || lookId}：${failureReason}`);
        }
      } else {
        console.error('生成造型图片失败:', error);
        toast.error(`${character.name} - ${look.scene || lookId}：${failureReason}`);
      }
    } finally {
      setIsGeneratingImage(false);
    }
  };

  // 生成人物指定造型的四视图
  const handleGenerateCharacterFourView = async (character: any, lookId: string) => {
    const look = character.looks?.find((candidate: CharacterLook) => candidate.id === lookId) as CharacterLook | undefined;
    if (!look) {
      toast.error('造型不存在');
      return;
    }
    if (!getCharacterFaceReferenceImage(character)) {
      toast.warning(`请先选择并确认 ${character.name} 的正脸身份基准图`);
      return;
    }
    if (!look.imageUrl) {
      toast.warning(`请先生成或上传「${look.scene || look.id}」造型图，再生成对应四视图`);
      return;
    }
    if (look.identityNeedsReview) {
      toast.warning(`「${look.scene || look.id}」基于旧正脸，请先重新生成造型图`);
      return;
    }
    if (!(await requireLoginBeforePaidAction())) return;

    setIsGeneratingImage(true);
    let statusTimer1: ReturnType<typeof setTimeout> | undefined;
    let statusTimer2: ReturnType<typeof setTimeout> | undefined;
    let fetchTimeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const referenceImageUrl = look.imageUrl;

      updateLookById(lookId, {
        isGeneratingFourView: true,
        fourViewStatus: '正在提交四视图生成任务...',
        fourViewError: undefined,
      }, character);
      toast.info(`开始生成 ${character.name}的四视图`);

      statusTimer1 = setTimeout(() => updateLookById(lookId, { fourViewStatus: 'AI 正在生成四视图（约30~90秒）...' }, character), 5000);
      statusTimer2 = setTimeout(() => updateLookById(lookId, { fourViewStatus: '四视图生成中，请耐心等待...' }, character), 30000);

      const controller = new AbortController();
      fetchTimeout = setTimeout(() => controller.abort(), CHARACTER_IMAGE_REQUEST_TIMEOUT_MS);

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
          creationBible: getCreationBiblePayload(),
        }),
        signal: controller.signal,
      });

      clearTimeout(fetchTimeout);
      fetchTimeout = undefined;
      clearTimeout(statusTimer1);
      statusTimer1 = undefined;
      clearTimeout(statusTimer2);
      statusTimer2 = undefined;

      const result = await readImageGenerationResponse(response, '四视图服务没有返回有效结果');

      if (result.success) {
        updateLookById(lookId, {
          fourViewImageUrl: result.localUrl || result.imageUrl,
          fourViewPrompt: result.prompt,
          isGeneratingFourView: false,
          fourViewStatus: undefined,
          fourViewError: undefined,
          fourViewIdentitySourceUrl: character.confirmedFaceImageUrl,
          fourViewLookSourceUrl: referenceImageUrl,
          fourViewIdentityNeedsReview: false,
        }, character);
        requestAssetLibrarySync();
        toast.success(`${character.name}的四视图生成成功`);
      } else {
        const failureReason = result.error || '四视图生成失败：接口没有返回原因';
        updateLookById(lookId, {
          isGeneratingFourView: false,
          fourViewStatus: undefined,
          fourViewError: failureReason,
        }, character);
        toast.error(`${character.name}的四视图：${failureReason}`);
      }
    } catch (error: any) {
      if (fetchTimeout) clearTimeout(fetchTimeout);
      if (statusTimer1) clearTimeout(statusTimer1);
      if (statusTimer2) clearTimeout(statusTimer2);
      const failureReason = getImageRequestFailureReason(error, '四视图生成');
      updateLookById(lookId, {
        isGeneratingFourView: false,
        fourViewStatus: undefined,
        fourViewError: failureReason,
      }, character);
      scheduleAssetLibraryRecovery();
      if (error?.name === 'AbortError') {
        toast.error(`${character.name}的四视图：${failureReason}`);
      } else {
        console.error('生成四视图失败:', error);
        toast.error(`${character.name}的四视图：${failureReason}`);
      }
    } finally {
      setIsGeneratingImage(false);
    }
  };

  // 删除人物造型图片
  const handleDeleteCharacterLookImage = (character: Character, lookId: string) => {
    const look = character.looks?.find(candidate => candidate.id === lookId);
    updateLookById(lookId, {
      imageUrl: undefined,
      identitySourceUrl: undefined,
      identityNeedsReview: false,
      generationError: undefined,
      fourViewIdentityNeedsReview: Boolean(look?.fourViewImageUrl),
    }, character);
    toast.success('造型图片已删除');
  };

  // 上传人物造型图片
  const handleUploadCharacterLookImage = (character: any, lookId: string, file: File) => {
    if (!getCharacterFaceReferenceImage(character)) {
      toast.warning(`请先选择并确认 ${character.name} 的正脸身份基准图，再上传造型图片`);
      return;
    }
    setIsGeneratingImage(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const imageUrl = e.target?.result as string;

        updateLookById(lookId, {
          imageUrl,
          isCustom: true,
          isGenerating: false,
          generationError: undefined,
          identitySourceUrl: character.confirmedFaceImageUrl,
          identityNeedsReview: false,
          fourViewIdentityNeedsReview: Boolean(
            character.looks?.find((look: CharacterLook) => look.id === lookId)?.fourViewImageUrl
          ),
        }, character);
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
    if (!getCharacterFaceReferenceImage(character)) {
      toast.warning(`请先选择并确认 ${character.name} 的正脸身份基准图`);
      return;
    }
    if (look.identityNeedsReview) {
      toast.warning('该造型基于旧正脸，请从父级造型重新生成，不能继续沿用旧图');
      return;
    }
    if (!(await requireLoginBeforePaidAction())) return;

    setIsGeneratingImage(true);
    try {
      updateLookById(lookId, {
        isGenerating: true,
        generatingStatus: '正在参考当前造型重新生成...',
        generationError: undefined,
      }, character);

      const response = await fetch('/api/generate-asset-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'character',
          data: character,
          lookId,
          referenceImageUrl: look.imageUrl,
          imageVariant: 'character-look',
          creationBible: getCreationBiblePayload(),
        }),
      });

      const result = await readImageGenerationResponse(response, '造型图片服务没有返回有效结果');

      if (result.success) {
        updateLookById(lookId, {
          imageUrl: result.localUrl || result.imageUrl,
          imagePrompt: result.prompt,
          isGenerating: false,
          generatingStatus: undefined,
          generationError: undefined,
          identitySourceUrl: character.confirmedFaceImageUrl,
          identityNeedsReview: false,
          fourViewIdentityNeedsReview: Boolean(look.fourViewImageUrl),
        }, character);
        requestAssetLibrarySync();
        toast.success(`${character.name} 造型图片重新生成成功`);
      } else {
        const failureReason = result.error || '造型图片重新生成失败：接口没有返回原因';
        updateLookById(lookId, {
          isGenerating: false,
          generatingStatus: undefined,
          generationError: failureReason,
        }, character);
        toast.error(`${character.name} - ${look.scene || lookId}：${failureReason}`);
      }
    } catch (error: any) {
      const failureReason = getImageRequestFailureReason(error, '造型图片重新生成');
      updateLookById(lookId, {
        isGenerating: false,
        generatingStatus: undefined,
        generationError: failureReason,
      }, character);
      scheduleAssetLibraryRecovery();
      if (error?.name !== 'AbortError') {
        console.error('重新生成造型图片失败:', error);
      }
      toast.error(`${character.name} - ${look.scene || lookId}：${failureReason}`);
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
    // 使用素材的名称作为 key，确保唯一性（名称是唯一的，id 可能在分批时重复）
    const assetId = `${type}-${data.name}`;
    const currentAsset = assetImages.get(assetId);
    const currentCount = currentAsset?.images.length || 0;

    // 检查数量限制，拦截后不调用付费接口。
    if (currentCount >= MAX_IMAGES_PER_ASSET) {
      setAssetImageLimitNotice({ type, name: data.name });
      return;
    }
    if (!(await requireLoginBeforePaidAction())) return;

    const tempImageId = `temp-img2img-${Date.now()}`;

    setAssetGenerationErrors(prev => {
      if (!(assetId in prev)) return prev;
      const next = { ...prev };
      delete next[assetId];
      return next;
    });

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
          creationBible: getCreationBiblePayload(),
        }),
      });

      const result = await readImageGenerationResponse(response, '图生图服务没有返回有效结果');

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
                      prompt: result.prompt,
                      promptSource: result.prompt ? 'actual' : 'rebuilt',
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
        setAssetGenerationErrors(prev => {
          if (!(assetId in prev)) return prev;
          const next = { ...prev };
          delete next[assetId];
          return next;
        });
        requestAssetLibrarySync();
        toast.success(`基于参考图片生成成功 (Seedream 模型)`);
      } else {
        const failureReason = result.error || '图生图失败：接口没有返回原因';
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
        setAssetGenerationErrors(prev => ({ ...prev, [assetId]: failureReason }));
        toast.error(`${data.name}：${failureReason}`);
      }
    } catch (error) {
      const failureReason = getImageRequestFailureReason(error, '图生图');
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
      setAssetGenerationErrors(prev => ({ ...prev, [assetId]: failureReason }));
      scheduleAssetLibraryRecovery();
      toast.error(`${data.name}：${failureReason}`);
    }
  };

  // 下载/保存媒体到本机下载目录
  const saveMediaToDownloads = async (mediaUrl: string, fileName: string, mediaLabel: '图片' | '视频') => {
    if (!(await requireLoginBeforePaidAction())) return;

    try {
      const saveToDownloads = shouldSaveToServerDownloads();
      const saveResponse = await fetch('/api/assets-save-to-downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: mediaUrl,
          fileName,
          saveToDownloads,
        }),
      });

      if (!saveToDownloads && saveResponse.ok) {
        const blob = await saveResponse.blob();
        if (blob.size === 0) throw new Error(`${mediaLabel}文件为空，请重新尝试`);
        const fallbackName = `${fileName}.${mediaLabel === '视频' ? 'mp4' : 'png'}`;
        const filename = getDownloadFilename(saveResponse.headers.get('Content-Disposition'), fallbackName);
        downloadBlob(blob, filename);
        toast.success(`${mediaLabel}已开始下载：${filename}`);
        return;
      }

      const saveData = await saveResponse.json().catch(() => null);
      if (saveResponse.ok && saveData?.success) {
        toast.success(`${mediaLabel}已保存到下载目录：${saveData.filename || fileName}`, {
          description: saveData.targetPath,
          duration: 6000,
        });
        return;
      }

      if (saveResponse.status === 401 && saveData?.code === 'LOGIN_REQUIRED') {
        showLoginRequired(saveData.error || LOGIN_REQUIRED_PROMPT);
        return;
      }

      throw new Error(saveData?.error || `${mediaLabel}保存失败`);
    } catch (error) {
      console.error(`${mediaLabel}下载失败:`, error);
      toast.error(getNetworkErrorMessage(error, `下载${mediaLabel}`));
    }
  };

  // 下载图片
  const downloadImage = async (imageUrl: string, fileName: string) => {
    await saveMediaToDownloads(imageUrl, fileName, '图片');
  };

  // 下载视频
  const downloadVideo = async (videoUrl: string, fileName: string) => {
    await saveMediaToDownloads(videoUrl, fileName, '视频');
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

    if (asset.type === 'character' && image.imageUrl) {
      const clearRemovedIdentity = (characters: Character[]) => characters.map(character => (
        character.name === asset.name && character.confirmedFaceImageUrl === image.imageUrl
          ? {
              ...character,
              identityImageConfirmed: false,
              confirmedFaceImageUrl: undefined,
              identityConfirmedAt: undefined,
              looks: character.looks?.map(look => (
                look.imageUrl || look.fourViewImageUrl
                  ? {
                      ...look,
                      identityNeedsReview: Boolean(look.imageUrl),
                      fourViewIdentityNeedsReview: Boolean(look.fourViewImageUrl),
                    }
                  : look
              )),
            }
          : character
      ));
      setCharactersData((prev: any) => prev?.characters
        ? { ...prev, characters: clearRemovedIdentity(prev.characters) }
        : prev);
      setCharacterBatchInfo((prev: any) => prev?.allCharacters
        ? { ...prev, allCharacters: clearRemovedIdentity(prev.allCharacters) }
        : prev);
    }

    toast.success('已取消选中该图片');
  };

  // 上传自定义图片
  const uploadCustomImage = async (type: 'scene' | 'character' | 'prop', data: any, file: File) => {
    // 使用素材的名称作为 key，确保唯一性（名称是唯一的，id 可能在分批时重复）
    const assetId = `${type}-${data.name}`;
    const currentAsset = assetImages.get(assetId);
    const currentCount = currentAsset?.images.length || 0;

    // 检查数量限制
    if (currentCount >= MAX_IMAGES_PER_ASSET) {
      setAssetImageLimitNotice({ type, name: data.name });
      return;
    }
    if (!(await requireLoginBeforePaidAction())) return;

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

  const executionScriptReady = hasCurrentExecutionScript();
  const uploadedStoryReady = !!((uploadedFile || (uploadedFileName && fileContent)) && fileContent);
  const creationBibleReady = hasConfirmedCreationBible();
  const canShowExtractionResults = !uploadedStoryReady || (executionScriptReady && creationBibleReady);
  const hasLegacyExtractionResultsPendingExecutionScript =
    uploadedStoryReady && (!executionScriptReady || !creationBibleReady) && hasExtractionStatusToShow;

  const resetExtractionOutputsForFreshRun = () => {
    setScenesData(null);
    setCharactersData(null);
    setCharacterVoiceData(null);
    setPropsData(null);
    setOutline(null);
    setOutlineBatchInfo(null);
    setSceneBatchInfo(null);
    setCharacterBatchInfo(null);
    setPropBatchInfo(null);
    setExtractionReview(INITIAL_EXTRACTION_REVIEW);
    extractionReviewRequestedRef.current = false;
    setSelectedChapter(null);
    setStoryboard(null);
    setImageStoryboards([]);
    setConnectingPrompts(null);
    setVideoResults([]);
    setVideoTotalDuration(0);
    setAssetImages(() => new Map());
    setBatchAssetGenerationHistory({ ...INITIAL_BATCH_ASSET_GENERATION_HISTORY });
    setChapterStoryboards({});
    setStepConfirmed(prev => ({
      ...prev,
      extraction: false,
      storyboard: false,
      assets: false,
      prompts: false,
      videos: false,
    }));
    setExtractionStatus({
      scenes: 'pending',
      characters: 'pending',
      voices: 'pending',
      props: 'pending',
      outline: 'pending',
    });
  };

  type AssetListExportType = 'scene' | 'character' | 'prop';
  type AssetListExportImage = {
    url?: string;
    label?: string;
    fileName?: string;
  };
  type AssetListExportRow = {
    group: string;
    assetName: string;
    assetLookId?: string;
    cells: Record<string, string | number>;
    images: AssetListExportImage[];
  };

  const joinExportValues = (values: unknown, separator = '、') => {
    const flattenValues = (value: unknown): unknown[] => (
      Array.isArray(value) ? value.flatMap(item => flattenValues(item)) : [value]
    );
    return Array.from(new Set(
      flattenValues(values)
        .map(value => normalizeDisplayText(value))
        .filter(Boolean)
    )).join(separator);
  };

  const formatExportEpisodeNumbers = (numbers: number[]) => (
    numbers.length > 0 ? numbers.map(number => `第${number}集`).join('、') : '未关联集数'
  );

  const getExportImageFileName = (imageUrl: string, fallback: string) => {
    try {
      const url = new URL(imageUrl, window.location.origin);
      const localFileName = url.searchParams.get('filename');
      if (localFileName) return localFileName;
      const pathName = decodeURIComponent(url.pathname.split('/').pop() || '');
      if (pathName) return pathName;
    } catch {
      // data URL 或旧格式地址没有可读文件名时使用下方默认名称。
    }
    return fallback;
  };

  const makeExportImage = (
    imageUrl: string | undefined,
    label: string,
    fallbackName: string
  ): AssetListExportImage => ({
    url: imageUrl || undefined,
    label,
    fileName: imageUrl ? getExportImageFileName(imageUrl, fallbackName) : fallbackName,
  });

  const getCreationBibleExportText = () => (
    `创作类型：${creationBible.creationType || '未选择'}；创作题材：${creationBible.subjectRegion || '未选择'}；创作背景：${creationBible.creationBackground || '未选择'}`
  );

  const getPromptExportText = (
    promptItems: Array<{ label: string; prompt?: string }>,
    rebuiltPrompt: string
  ) => {
    const actualPrompts = promptItems
      .map(item => ({ label: item.label, prompt: normalizeDisplayText(item.prompt) }))
      .filter(item => item.prompt.length > 0);
    const uniquePrompts = actualPrompts.filter((item, index, list) => (
      list.findIndex(candidate => candidate.prompt === item.prompt) === index
    ));
    if (uniquePrompts.length === 1) {
      return `${uniquePrompts[0].prompt}\n\n【提示词来源】图片生成接口实际提示词`;
    }
    if (uniquePrompts.length > 1) {
      return `${uniquePrompts.map(item => `【${item.label}】${item.prompt}`).join('\n\n')}\n\n【提示词来源】图片生成接口实际提示词`;
    }
    return `${rebuiltPrompt}\n\n【提示词来源】历史图片未保存实际提示词，已根据当前创作圣经和本行资料重建`;
  };

  const buildSceneExportPrompt = (scene: Scene) => joinExportValues([
    getCreationBibleExportText(),
    `场景名称：${scene.name}`,
    scene.physicalLocation ? `物理地点：${scene.physicalLocation}` : '',
    scene.stateLabel ? `场景状态：${scene.stateLabel}` : '',
    scene.stateReason ? `状态成立原因：${getSceneStateReasonLabel(scene.stateReason)}` : '',
    scene.stateChangeEvidence ? `剧本依据：${scene.stateChangeEvidence}` : '',
    scene.stateVisualDifference ? `本状态唯一变化：${scene.stateVisualDifference}` : '',
    scene.description,
    scene.type ? `场景类型：${scene.type}` : '',
    scene.timeOfDay ? `时间：${scene.timeOfDay}` : '',
    scene.atmosphere ? `氛围：${scene.atmosphere}` : '',
    scene.visualElements?.length ? `视觉元素：${scene.visualElements.join('、')}` : '',
    scene.referenceSceneName ? `严格参考基准状态「${scene.referenceSceneName}」，保留同一地点的空间结构和视觉身份，只改变剧本明确要求的日夜、年代或重大持久变化` : '',
    '纯场景环境，无人物、无人影、无字幕、无文字、水印',
  ], '；');

  const buildCharacterExportPrompt = (character: Character, look?: CharacterLook) => {
    const faceFeatures = character.faceFeatures
      ? joinExportValues([
        character.faceFeatures.faceShape && `脸型：${character.faceFeatures.faceShape}`,
        character.faceFeatures.eyes && `眼睛：${character.faceFeatures.eyes}`,
        character.faceFeatures.nose && `鼻子：${character.faceFeatures.nose}`,
        character.faceFeatures.mouth && `嘴巴：${character.faceFeatures.mouth}`,
        character.faceFeatures.skinTone && `肤色：${character.faceFeatures.skinTone}`,
      ], '，')
      : '';
    return joinExportValues([
      getCreationBibleExportText(),
      `人物：${character.name}`,
      character.role ? `角色：${character.role}` : '',
      character.age ? `年龄：${character.age}` : '',
      character.gender ? `性别：${character.gender}` : '',
      character.appearance ? `正脸外貌：${stripBodyDetailsFromAppearance(character.appearance)}` : '',
      faceFeatures ? `固定面部特征：${faceFeatures}` : '',
      look ? `造型名称：${look.scene || look.stage || look.id}` : '正脸身份基准图',
      look?.description,
      look?.changeType ? `变化类型：${look.changeType}` : '',
      look?.ageStage ? `人物时期：${look.ageStage}` : '',
      look?.physicalState ? `身体状态：${look.physicalState}` : '',
      look?.transformationState ? `特殊形态：${look.transformationState}` : '',
      look?.costume ? `服装：${look.costume}` : '',
      look?.hairstyle ? `发型：${look.hairstyle}` : '',
      look?.accessories?.length ? `配饰：${look.accessories.join('、')}` : '',
      look ? `全身体态档案：${formatCharacterBodyProfile(mergeCharacterBodyProfiles(look.bodyProfile, character.bodyProfile)) || '按人物档案保持一致'}` : '',
      look ? '全身完整造型图，严格保持已确认正脸身份一致' : '正面人脸近景，纯白背景，不读取身高体重和全身体型信息',
      '无字幕、无文字、无水印',
    ], '；');
  };

  const buildPropExportPrompt = (prop: Prop) => joinExportValues([
    getCreationBibleExportText(),
    `道具名称：${prop.name}`,
    prop.mainPropName ? `同一道具身份：${prop.mainPropName}` : '',
    prop.stateLabel ? `本次唯一状态：${prop.stateLabel}` : '',
    prop.description,
    prop.visualDescription && prop.visualDescription !== prop.description ? `当前状态视觉：${prop.visualDescription}` : '',
    prop.stateVisualChange ? `相对前一状态的变化：${prop.stateVisualChange}` : '',
    prop.stateTransitionEvent ? `状态形成原因：${prop.stateTransitionEvent}` : '',
    prop.stateNarrativeFunction ? `剧情识别重点：${prop.stateNarrativeFunction}` : '',
    prop.referencePropName ? `严格参考前一状态「${prop.referencePropName}」，保留同一件道具的结构、材质、颜色和识别特征` : '建立该道具的首张身份基准图',
    '单个道具、单一稳定状态、纯白背景，禁止完整与损坏状态同图对比，无人物、无字幕、无文字、水印',
  ], '；');

  const getCompletedImages = (asset?: AssetImages) => (
    (asset?.images || []).filter(image => Boolean(image.imageUrl) && !image.isGenerating)
  );

  const buildSceneExportRows = (): AssetListExportRow[] => {
    const scenes = getBatchAssetList('scene') as Scene[];
    const totals = new Map<string, number>();
    scenes.forEach(scene => {
      const mainName = getSceneMainSceneName(scene);
      totals.set(mainName, (totals.get(mainName) || 0) + 1);
    });
    const counters = new Map<string, number>();

    return scenes.map((scene, index) => {
      const mainName = getSceneMainSceneName(scene);
      const stateSequence = (counters.get(mainName) || 0) + 1;
      counters.set(mainName, stateSequence);
      const asset = getAssetImages('scene', scene.id, scene.name);
      const images = getCompletedImages(asset).slice(0, MAX_IMAGES_PER_ASSET);
      const occurrenceText = joinExportValues((scene.occurrences || []).map(item => (
        joinExportValues([
          item.episodeNumber ? `第${item.episodeNumber}集` : item.episodeLabel,
          item.heading,
          item.stateLabel,
        ], ' · ')
      )), '\n');
      const rebuiltPrompt = buildSceneExportPrompt(scene);
      const prompt = getPromptExportText(
        images.map((image, imageIndex) => ({ label: imageIndex === 0 ? '主图' : `图片${imageIndex + 1}`, prompt: image.prompt })),
        rebuiltPrompt
      );

      return {
        group: mainName,
        assetName: scene.name,
        cells: {
          sequence: index + 1,
          mainName,
          stateName: scene.stateLabel || scene.name,
          stateSequence: `${stateSequence} / ${totals.get(mainName) || 1}`,
          episodes: formatExportEpisodeNumbers(getSceneEpisodeNumbers(scene)),
          occurrences: occurrenceText || '未记录具体场次',
          timePeriod: joinExportValues([scene.timeOfDay, scene.stateLabel]),
          description: scene.description || '',
          events: joinExportValues(scene.keyEvents || [], '\n'),
          visualElements: joinExportValues(scene.visualElements || [], '、'),
          prompt,
          generationMode: scene.imageMode === 'image-to-image' || scene.referenceSceneName ? '图生图' : '文生图',
          reference: scene.referenceSceneName || '无（基准状态）',
        },
        images: [0, 1, 2].map(imageIndex => makeExportImage(
          images[imageIndex]?.imageUrl,
          imageIndex === 0 ? '主图' : `图片 ${imageIndex + 1}`,
          `${scene.name}_${imageIndex + 1}.png`
        )),
      };
    });
  };

  const buildCharacterExportRows = (): AssetListExportRow[] => {
    const characters = getBatchAssetList('character') as Character[];
    const rows: AssetListExportRow[] = [];

    characters.forEach(character => {
      const asset = getAssetImages('character', character.id, character.name);
      const completedFaceImages = getCompletedImages(asset);
      const confirmedFaceUrl = getCharacterFaceReferenceImage(character);
      const faceImages = [...completedFaceImages].sort((left, right) => (
        left.imageUrl === confirmedFaceUrl ? -1 : right.imageUrl === confirmedFaceUrl ? 1 : 0
      )).slice(0, MAX_IMAGES_PER_ASSET);
      const faceFeatures = joinExportValues([
        character.appearance,
        character.faceFeatures?.faceShape && `脸型：${character.faceFeatures.faceShape}`,
        character.faceFeatures?.eyes && `眼睛：${character.faceFeatures.eyes}`,
        character.faceFeatures?.nose && `鼻子：${character.faceFeatures.nose}`,
        character.faceFeatures?.mouth && `嘴巴：${character.faceFeatures.mouth}`,
        character.faceFeatures?.skinTone && `肤色：${character.faceFeatures.skinTone}`,
      ], '\n');
      const relationships = joinExportValues((character.keyRelationships || []).map(item => (
        `${item.target}：${item.relationship}`
      )), '\n');
      const backgroundRelationships = joinExportValues([character.background, relationships], '\n');
      const basePrompt = getPromptExportText(
        faceImages.map((image, imageIndex) => ({ label: imageIndex === 0 ? '主图' : `图片${imageIndex + 1}`, prompt: image.prompt })),
        buildCharacterExportPrompt(character)
      );

      rows.push({
        group: character.name,
        assetName: character.name,
        cells: {
          sequence: rows.length + 1,
          mainName: character.name,
          role: character.role || '',
          ageGender: joinExportValues([character.age, character.gender], ' / '),
          lookName: '正脸身份基准',
          changeType: '身份基准',
          episodes: formatExportEpisodeNumbers(Array.from(new Set(
            (character.looks || []).flatMap(look => look.episodeNumbers || [])
          )).sort((a, b) => a - b)),
          scenes: joinExportValues(character.keyScenes || [], '\n'),
          events: '用于锁定人物脸型、五官、肤色与年龄感，其他造型必须在确认此图后生成',
          personality: joinExportValues(character.personality || [], '、'),
          appearance: faceFeatures,
          bodyProfile: '正脸基准图不使用身高、体重和全身体型信息',
          costume: '不作为服装造型依据',
          background: backgroundRelationships,
          arc: character.arc || '',
          prompt: basePrompt,
          reference: confirmedFaceUrl ? '用户已确认正脸主图' : '待用户确认正脸主图',
        },
        images: [
          ...[0, 1, 2].map(imageIndex => makeExportImage(
            faceImages[imageIndex]?.imageUrl,
            imageIndex === 0 ? '主图' : `图片 ${imageIndex + 1}`,
            `${character.name}_正脸_${imageIndex + 1}.png`
          )),
          makeExportImage(undefined, '四视图', `${character.name}_四视图.png`),
        ],
      });

      (character.looks || []).forEach(look => {
        const storedLookImages = asset?.lookImages?.[look.id] || [];
        const lookImages = [
          ...(look.imageUrl ? [{ imageId: `look-${look.id}`, imageUrl: look.imageUrl, prompt: look.imagePrompt }] : []),
          ...storedLookImages,
        ].filter((image, imageIndex, list) => (
          image.imageUrl && list.findIndex(candidate => candidate.imageUrl === image.imageUrl) === imageIndex
        )).slice(0, MAX_IMAGES_PER_ASSET);
        const prompt = getPromptExportText([
          ...lookImages.map((image, imageIndex) => ({ label: imageIndex === 0 ? '主图' : `图片${imageIndex + 1}`, prompt: image.prompt })),
          { label: '四视图', prompt: look.fourViewPrompt },
        ], buildCharacterExportPrompt(character, look));
        const referenceLook = look.referenceLookId
          ? character.looks?.find(candidate => candidate.id === look.referenceLookId)
          : undefined;
        const lookBodyProfile = mergeCharacterBodyProfiles(look.bodyProfile, character.bodyProfile);

        rows.push({
          group: character.name,
          assetName: character.name,
          assetLookId: look.id,
          cells: {
            sequence: rows.length + 1,
            mainName: character.name,
            role: character.role || '',
            ageGender: joinExportValues([look.ageStage || character.age, character.gender], ' / '),
            lookName: look.scene || look.stage || look.id,
            changeType: look.changeType || (look.isBaseLook ? '基础造型' : '场景换装'),
            episodes: formatExportEpisodeNumbers((look.episodeNumbers || []).filter(number => Number.isFinite(number)).sort((a, b) => a - b)),
            scenes: joinExportValues([look.sceneNames || [], look.scene], '\n'),
            events: joinExportValues([look.sourceEvidence, look.continuityNote, look.stage], '\n'),
            personality: joinExportValues(character.personality || [], '、'),
            appearance: faceFeatures,
            bodyProfile: formatCharacterBodyProfile(lookBodyProfile) || '沿用人物全身体态档案',
            costume: joinExportValues([
              look.costume,
              look.hairstyle && `发型：${look.hairstyle}`,
              look.accessories?.length ? `配饰：${look.accessories.join('、')}` : '',
              look.makeup && `妆容：${look.makeup}`,
              look.bodyChanges && `身体变化：${look.bodyChanges}`,
            ], '\n'),
            background: backgroundRelationships,
            arc: character.arc || '',
            prompt,
            reference: look.isBaseLook
              ? '已确认正脸身份基准图'
              : referenceLook?.scene || look.referenceReason || '已确认正脸身份基准图',
          },
          images: [
            ...[0, 1, 2].map(imageIndex => makeExportImage(
              lookImages[imageIndex]?.imageUrl,
              imageIndex === 0 ? '主图' : `图片 ${imageIndex + 1}`,
              `${character.name}_${look.scene || look.id}_${imageIndex + 1}.png`
            )),
            makeExportImage(
              look.fourViewImageUrl,
              '四视图',
              `${character.name}_${look.scene || look.id}_四视图.png`
            ),
          ],
        });
      });
    });

    return rows;
  };

  const buildPropExportRows = (): AssetListExportRow[] => {
    const props = getBatchAssetList('prop') as Prop[];
    const totals = new Map<string, number>();
    props.forEach(prop => {
      const mainName = getPropMainPropName(prop);
      totals.set(mainName, (totals.get(mainName) || 0) + 1);
    });
    const counters = new Map<string, number>();

    return props.map((prop, index) => {
      const mainName = getPropMainPropName(prop);
      const sequence = prop.stateSequence || (counters.get(mainName) || 0) + 1;
      counters.set(mainName, Math.max(counters.get(mainName) || 0, sequence));
      const asset = getAssetImages('prop', prop.id, prop.name);
      const images = getCompletedImages(asset).slice(0, MAX_IMAGES_PER_ASSET);
      const occurrenceText = joinExportValues((prop.occurrences || []).map(item => (
        joinExportValues([
          item.episodeNumber ? `第${item.episodeNumber}集` : item.episodeLabel,
          item.sceneName || item.heading,
          item.stateLabel,
        ], ' · ')
      )), '\n');
      const prompt = getPromptExportText(
        images.map((image, imageIndex) => ({ label: imageIndex === 0 ? '主图' : `图片${imageIndex + 1}`, prompt: image.prompt })),
        buildPropExportPrompt(prop)
      );

      return {
        group: mainName,
        assetName: prop.name,
        cells: {
          sequence: index + 1,
          mainName,
          stateName: prop.stateLabel || prop.name,
          stateSequence: `${sequence} / ${prop.totalStates || totals.get(mainName) || 1}`,
          typeImportance: joinExportValues([prop.type, prop.importance], ' / '),
          owner: prop.owner || '',
          episodes: formatExportEpisodeNumbers(getPropEpisodeNumbers(prop)),
          occurrences: occurrenceText || joinExportValues(prop.appearanceScenes || [], '\n') || '未记录具体场次',
          transition: prop.stateTransitionEvent || '',
          visualChange: prop.stateVisualChange || prop.visualDescription || '',
          narrativeFunction: prop.stateNarrativeFunction || prop.function || '',
          evidence: prop.stateEvidence || '',
          description: joinExportValues([prop.description, prop.notes], '\n'),
          prompt,
          generationMode: prop.imageMode === 'image-to-image' || prop.referencePropName ? '图生图' : '文生图',
          reference: prop.referencePropName || '无（基准状态）',
        },
        images: [0, 1, 2].map(imageIndex => makeExportImage(
          images[imageIndex]?.imageUrl,
          imageIndex === 0 ? '主图' : `图片 ${imageIndex + 1}`,
          `${prop.name}_${imageIndex + 1}.png`
        )),
      };
    });
  };

  const exportAssetListPackage = async (type: AssetListExportType) => {
    console.info('[完整素材 ZIP] 开始整理列表:', type);
    if (exportingAssetListType) return;
    const typeLabel = type === 'scene' ? '场景' : type === 'character' ? '人物' : '道具';
    const loadingToast = toast.loading(`正在整理${typeLabel}完整素材包和原图，请稍候...`);
    setExportingAssetListType(type);
    try {
      const rows = type === 'scene'
        ? buildSceneExportRows()
        : type === 'character'
          ? buildCharacterExportRows()
          : buildPropExportRows();
      if (rows.length === 0) {
        toast.warning('当前列表没有可导出的内容', { id: loadingToast });
        return;
      }
      console.info('[完整素材 ZIP] 列表整理完成:', type, rows.length);
      const projectName = getCurrentFileName().replace(/\.[^.]+$/, '') || '项目';
      const response = await fetch('/api/export-asset-list-xlsx?prepare=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          projectName,
          rows,
          packageOriginals: true,
          saveToDownloads: shouldSaveToServerDownloads(),
        }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `导出失败（${response.status}）`);
      }

      const result = await response.json();
      if (!result.success || (!result.savedToDownloads && !result.downloadUrl)) {
        throw new Error(result.error || '服务器没有返回下载地址');
      }
      if (!result.savedToDownloads) {
        const downloadLink = document.createElement('a');
        downloadLink.href = result.downloadUrl;
        downloadLink.download = String(result.fileName || `${projectName}_${typeLabel}列表_完整素材.zip`);
        downloadLink.style.display = 'none';
        document.body.appendChild(downloadLink);
        downloadLink.click();
        downloadLink.remove();
      }

      const rowCount = Number(result.rowCount || rows.length);
      const imageCount = Number(result.imageCount || 0);
      const originalImageCount = Number(result.originalImageCount || 0);
      const failedImageCount = Number(result.failedImageCount || 0);
      setAssetPackageExportSuccess({
        typeLabel,
        fileName: String(result.fileName || `${projectName}_${typeLabel}列表_完整素材.zip`),
        workbookFileName: String(result.workbookFileName || `${projectName}_${typeLabel}列表.xlsx`),
        rowCount,
        imageCount,
        originalImageCount,
        failedImageCount,
        savedToDownloads: Boolean(result.savedToDownloads),
        savedPath: String(result.savedPath || ''),
      });
      if (failedImageCount > 0) {
        toast.warning(`${typeLabel}完整素材 ZIP 已生成，另有 ${failedImageCount} 张旧图无法读取`, { id: loadingToast });
      } else {
        toast.success(
          result.savedToDownloads
            ? `${typeLabel}完整素材 ZIP 已保存到下载目录`
            : `${typeLabel}完整素材 ZIP 已开始下载`,
          { id: loadingToast }
        );
      }
    } catch (error) {
      console.error(`${typeLabel}列表导出失败:`, error);
      toast.error(error instanceof Error ? error.message : `${typeLabel}列表导出失败`, { id: loadingToast });
    } finally {
      setExportingAssetListType(null);
    }
  };

  const confirmCreationBibleAndStartExtraction = async () => {
    if (!creationBible.creationType || !creationBible.subjectRegion || !creationBible.creationBackground) {
      toast.error('请先选择创作类型、创作题材和创作背景');
      return;
    }
    if (!(await requireLoginBeforePaidAction())) return;

    let extractionContent = getExtractionSourceContent();
    if (!executionScriptReady) {
      const preparedScript = await ensureExecutionScript();
      if (!preparedScript) return;
      extractionContent = preparedScript;
    }

    const bible = getCreationBiblePayload();
    setCreationBible(prev => ({ ...prev, ...bible, confirmed: true }));
    setStepConfirmed(prev => ({ ...prev, upload: true }));
    resetExtractionOutputsForFreshRun();
    void extractAllParallel(extractionContent, getCurrentFileName(), bible);
  };

  const reopenCreationBibleSelection = async () => {
    await cleanupStoryboardImages();
    await cleanupAssetImages();
    resetExtractionOutputsForFreshRun();
    setCreationBible(prev => ({ ...prev, confirmed: false }));
    setCurrentStep(1);
    setProgress(15);
    toast.info('已重新打开创作圣经，请确认后重新提取');
  };

  type WorkflowStepStatus = 'completed' | 'active' | 'pending';
  type WorkflowStepView = {
    title: string;
    icon: typeof Upload;
    status: WorkflowStepStatus;
    revertKey?: keyof typeof stepConfirmed;
  };

  const hasStoryboardGroups = Object.values(chapterStoryboards).some(
    cs => (cs.promptGroups?.length ?? 0) > 0
  );
  const hasStoryboardImages = Object.values(chapterStoryboards).some(
    cs => (cs.promptGroups ?? []).some(pg => !!pg.storyboardImageUrl)
  );

  const workflowSteps: WorkflowStepView[] = [
    {
      title: '上传文件',
      icon: Upload,
      status: uploadedStoryReady ? 'completed' : 'active',
      revertKey: 'upload',
    },
    {
      title: '执行剧本',
      icon: FileText,
      status: executionScriptReady ? 'completed' : uploadedStoryReady ? 'active' : 'pending',
    },
    {
      title: '创作圣经',
      icon: BookOpen,
      status: creationBibleReady ? 'completed' : executionScriptReady ? 'active' : 'pending',
    },
    {
      title: '并行提取',
      icon: Sparkles,
      status: stepConfirmed.extraction ? 'completed' : creationBibleReady ? 'active' : 'pending',
      revertKey: 'extraction',
    },
    {
      title: '生成分镜',
      icon: Film,
      status: stepConfirmed.storyboard ? 'completed' : stepConfirmed.extraction ? 'active' : 'pending',
      revertKey: 'storyboard',
    },
    {
      title: '素材确认',
      icon: Package,
      status: stepConfirmed.assets ? 'completed' : stepConfirmed.storyboard ? 'active' : 'pending',
      revertKey: 'assets',
    },
    {
      title: '提示词确认',
      icon: FileText,
      status: stepConfirmed.prompts ? 'completed' : stepConfirmed.assets ? 'active' : 'pending',
      revertKey: 'prompts',
    },
    {
      title: '故事版',
      icon: ImageIcon,
      status: hasStoryboardImages ? 'completed' : (hasStoryboardGroups || stepConfirmed.prompts) ? 'active' : 'pending',
    },
    {
      title: '生成视频',
      icon: Video,
      status: stepConfirmed.videos ? 'completed' : hasStoryboardImages ? 'active' : 'pending',
      revertKey: 'videos',
    },
  ];
  const activeWorkflowIndex = workflowSteps.findIndex(step => step.status === 'active');
  const lastCompletedWorkflowIndex = workflowSteps.reduce(
    (last, step, index) => step.status === 'completed' ? index : last,
    -1
  );
  const workflowProgressIndex = activeWorkflowIndex >= 0 ? activeWorkflowIndex : lastCompletedWorkflowIndex;
  const workflowProgress = workflowSteps.length <= 1
    ? 0
    : Math.min(100, Math.max(0, (workflowProgressIndex / (workflowSteps.length - 1)) * 100));
  const batchRegenerationLabel = batchRegenerationConfirmType
    ? ({ scene: '场景', character: '人物', prop: '道具' } as const)[batchRegenerationConfirmType]
    : '';
  const batchRegenerationAssetCount = batchRegenerationConfirmType
    ? getBatchAssetList(batchRegenerationConfirmType).length
    : 0;
  const assetImageLimitLabel = assetImageLimitNotice
    ? ({ scene: '场景', character: '人物', prop: '道具' } as const)[assetImageLimitNotice.type]
    : '素材';
  const assetImageChooserData = assetImageChooserTarget
    ? assetImages.get(assetImageChooserTarget.assetId)
    : undefined;
  const assetImageChooserImages = (assetImageChooserData?.images || [])
    .filter(image => Boolean(image.imageUrl) && !image.isGenerating)
    .slice(0, MAX_IMAGES_PER_ASSET);

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
      <AlertDialog
        open={assetPackageExportSuccess !== null}
        onOpenChange={open => {
          if (!open) setAssetPackageExportSuccess(null);
        }}
      >
        <AlertDialogContent className="border-amber-400/45 bg-[#0c0d0b] text-amber-50 sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-amber-100">
              <CheckCircle2 className="size-5 text-emerald-400" />
              完整素材 ZIP 导出成功
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 leading-6 text-amber-100/70">
              <span className="block">
                {assetPackageExportSuccess?.typeLabel}列表、Excel 缩略图和对应原图已经整理完成。
              </span>
              <span className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-amber-400/20 bg-amber-400/[0.05] p-3 text-sm text-amber-50/85">
                <span>制作项：{assetPackageExportSuccess?.rowCount || 0} 条</span>
                <span>原图：{assetPackageExportSuccess?.originalImageCount || 0} 张</span>
                <span>Excel 缩略图：{assetPackageExportSuccess?.imageCount || 0} 张</span>
                <span>读取失败：{assetPackageExportSuccess?.failedImageCount || 0} 张</span>
              </span>
              <span className="block break-all text-sm text-amber-200/80">
                文件：{assetPackageExportSuccess?.fileName || '完整素材.zip'}
              </span>
              {assetPackageExportSuccess?.savedToDownloads && assetPackageExportSuccess.savedPath ? (
                <span className="block break-all text-xs text-emerald-300/85">
                  已保存到：{assetPackageExportSuccess.savedPath}
                </span>
              ) : null}
              <span className="block rounded-md border border-amber-400/20 bg-black/30 px-3 py-2 text-sm">
                请先完整解压 ZIP，再打开 Excel。点击表格中的缩略图即可打开同一状态对应的原图。
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              className="bg-amber-400 text-black hover:bg-amber-300"
              onClick={() => setAssetPackageExportSuccess(null)}
            >
              知道了
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={assetImageLimitNotice !== null}
        onOpenChange={open => {
          if (!open) setAssetImageLimitNotice(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-400" />
              已达到{assetImageLimitLabel}图片上限
            </AlertDialogTitle>
            <AlertDialogDescription className="leading-7">
              「{assetImageLimitNotice?.name || assetImageLimitLabel}」已达到 {MAX_IMAGES_PER_ASSET} 张图片上限。
              每个{assetImageLimitLabel}最多保留 {MAX_IMAGES_PER_ASSET} 张，如需添加新图，请先从卡片中移除一张已有图片。
              <br />
              <span className="font-medium text-amber-300">本次操作已拦截，没有调用图片 API，也不会扣除创作点。</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              className="bg-amber-500 text-black hover:bg-amber-400"
              onClick={() => setAssetImageLimitNotice(null)}
            >
              知道了
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={assetImageChooserTarget !== null}
        onOpenChange={open => {
          if (!open) setAssetImageChooserTarget(null);
        }}
      >
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>选择「{assetImageChooserTarget?.name || '素材'}」主图</DialogTitle>
            <DialogDescription>
              完整查看当前素材的全部图片。鼠标悬停可轻微放大预览，点击图片后，它会成为列表卡片最上方显示的主图。
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-3">
            {assetImageChooserImages.map((image, index) => {
              const isCurrentPrimary = index === 0;
              const isPortrait = assetImageChooserTarget?.type === 'character';
              return (
                <button
                  key={image.imageId}
                  type="button"
                  className={`group/select overflow-hidden rounded-md border bg-black/45 text-left shadow-lg transition duration-200 hover:scale-[1.025] hover:border-amber-300 hover:shadow-[0_12px_32px_rgba(251,191,36,0.16)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
                    isCurrentPrimary ? 'border-amber-300/80' : 'border-amber-400/20'
                  }`}
                  onClick={() => {
                    if (!assetImageChooserTarget) return;
                    requestPrimaryAssetImageSelection(
                      assetImageChooserTarget.assetId,
                      image.imageId,
                      assetImageChooserTarget.name,
                      assetImageChooserTarget.type,
                      image.imageUrl
                    );
                  }}
                  aria-label={`将第 ${index + 1} 张图片设为主图`}
                >
                  <div className={`relative w-full bg-black ${isPortrait ? 'aspect-[4/5]' : 'aspect-video'}`}>
                    <img
                      src={getAssetThumbnailUrl(image.imageUrl, isPortrait ? 640 : 900)}
                      alt={`${assetImageChooserTarget?.name || '素材'}第 ${index + 1} 张`}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-contain transition-transform duration-200 group-hover/select:scale-[1.02]"
                    />
                    {isCurrentPrimary && (
                      <Badge className="absolute left-2 top-2 border border-amber-200/40 bg-amber-400 text-black">
                        当前主图
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-amber-400/15 px-3 py-2 text-xs">
                    <span className="text-amber-100/75">第 {index + 1} 张</span>
                    <span className={isCurrentPrimary ? 'text-amber-300' : 'text-amber-100/50'}>
                      {isCurrentPrimary ? '正在使用' : '点击设为主图'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssetImageChooserTarget(null)}>
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={pendingCharacterFaceChange !== null}
        onOpenChange={open => {
          if (!open) setPendingCharacterFaceChange(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-400" />
              确认更换人物正脸主图？
            </AlertDialogTitle>
            <AlertDialogDescription className="leading-7">
              更换「{pendingCharacterFaceChange?.characterName || '人物'}」的正脸主图后，原身份基准会立即失效，所有造型生成按钮将重新锁定，直到你确认新的正脸。
              {Boolean(pendingCharacterFaceChange?.affectedLookCount) && (
                <>
                  <br />
                  当前有 <span className="font-semibold text-amber-300">{pendingCharacterFaceChange?.affectedLookCount} 个已生成造型或四视图</span>
                  将标记为“需按新正脸重做”，系统不会自动调用 API 或扣除创作点。
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消更换</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-500 text-black hover:bg-amber-400"
              onClick={() => {
                const pending = pendingCharacterFaceChange;
                setPendingCharacterFaceChange(null);
                if (!pending) return;
                selectPrimaryAssetImage(
                  pending.assetId,
                  pending.imageId,
                  pending.characterName,
                  'character',
                  pending.imageUrl
                );
              }}
            >
              确认更换
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={batchRegenerationConfirmType !== null}
        onOpenChange={open => {
          if (!open) setBatchRegenerationConfirmType(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-400" />
              确认再次批量生成全部{batchRegenerationLabel}图片？
            </AlertDialogTitle>
            <AlertDialogDescription className="leading-7">
              你已经使用过“一键生成{batchRegenerationLabel}图”。继续后，系统将再次为当前列表中的
              <span className="px-1 font-semibold text-amber-300">{batchRegenerationAssetCount} 个{batchRegenerationLabel}素材</span>
              批量新增图片，已有图片不会被覆盖。
              <br />
              <span className="font-semibold text-red-400">本次操作可能产生大批量创作点消耗，请确认确实需要重新生成。</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消，不消耗</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-500 text-black hover:bg-amber-400"
              onClick={() => {
                const confirmedType = batchRegenerationConfirmType;
                setBatchRegenerationConfirmType(null);
                if (confirmedType) void generateAllAssetImages(confirmedType, true);
              }}
            >
              确认并继续生成
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
      <div className="black-mirror-content relative z-10 mx-auto w-full max-w-[1920px]">
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
                爆款作品一站式工作流
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
              <AssetsFolderManager
                refreshTrigger={assetRefreshTrigger}
                onAssetsChanged={requestAssetLibrarySync}
              />
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
            {workflowSteps.map((step) => {
              const Icon = step.icon;
              const isActive = step.status === 'active';
              const isCompleted = step.status === 'completed';
              const isConfirmed = step.revertKey ? stepConfirmed[step.revertKey] : false;

              return (
                <div
                  key={step.title}
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
                    {isConfirmed && step.revertKey && step.revertKey !== 'videos' && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="mirror-step-undo absolute -right-1 -top-1 w-5 h-5 rounded-full p-0"
                        title="撤回到此步骤"
                        onClick={() => revertToStep(step.revertKey!)}
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
          <Progress value={workflowProgress} className="mirror-progress h-2" />
        </div>

        {/* Main Content */}
        <div
          className={`black-mirror-workspace grid grid-cols-1 gap-6 ${
            hasExpandedExtractionCollection ? 'lg:grid-cols-1' : 'lg:grid-cols-3'
          }`}
          data-expanded-extraction={hasExpandedExtractionCollection ? 'true' : 'false'}
        >
          {/* Left Panel - File Upload & Extraction Status */}
          <div className={`${hasExpandedExtractionCollection ? 'lg:hidden' : 'lg:col-span-1'} space-y-6`}>
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
		                      className={`execution-script-launch-button w-full ${isGeneratingExecutionScript ? 'is-generating' : ''}`}
		                      onClick={() => confirmStep('upload')}
		                      disabled={isProcessing || isGeneratingExecutionScript}
		                    >
	                      {isGeneratingExecutionScript ? (
	                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
	                      ) : (
	                        <CheckCircle2 className="w-4 h-4 mr-2" />
	                      )}
		                      {isGeneratingExecutionScript
		                        ? `正在整理执行剧本 · ${executionScriptElapsedSeconds} 秒`
		                        : '确认文件，拉执行剧本'}
		                    </Button>
                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={() => {
                        setUploadedFile(null);
                        setFileContent('');
                        setUploadedFileName(null);
                        setExecutionScript('');
                        setExecutionScriptSourceSignature('');
                        setExecutionScriptError(null);
                        setCreationBible(DEFAULT_CREATION_BIBLE);
                        setProgress(0);
                        toast.info('已清除文件，请重新上传');
	                      }}
	                      disabled={isProcessing || isGeneratingExecutionScript}
	                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      不满意，重新上传
                    </Button>
                  </div>
                )}
	              </CardContent>
	            </Card>

	            {/* Execution Script Preparation */}
	            {uploadedStoryReady && (
			              <Card className={`execution-script-card ${isGeneratingExecutionScript ? 'is-generating' : ''}`}>
		                <CardHeader>
		                  <CardTitle className="flex flex-wrap items-center justify-between gap-2">
		                    <span className="flex min-w-0 items-center gap-2">
		                      <FileText className="w-5 h-5" />
		                      拉执行剧本
		                    </span>
			                    <Badge
			                      className={`shrink-0 ${isGeneratingExecutionScript ? 'execution-script-generating-badge' : ''}`}
			                      variant={executionScriptReady && !isGeneratingExecutionScript ? 'default' : 'outline'}
			                    >
			                      {isGeneratingExecutionScript ? (
			                        <span className="flex items-center gap-1.5">
			                          <Loader2 className="h-3 w-3 animate-spin" />
			                          生成中
			                        </span>
			                      ) : executionScriptReady ? '已生成' : '待生成'}
			                    </Badge>
		                  </CardTitle>
		                  <CardDescription className="execution-script-copy">
		                    使用 DeepSeek 先整理成执行剧本，再进入五维提取。
		                  </CardDescription>
	                </CardHeader>
	                <CardContent className="space-y-3">
			                {isGeneratingExecutionScript ? (
			                  <div
			                    className="execution-script-generating-state"
			                    role="status"
			                    aria-live="polite"
			                    aria-busy="true"
			                  >
			                    <div className="execution-script-generating-heading">
			                      <span className="execution-script-generating-icon" aria-hidden="true">
			                        <Loader2 className="h-5 w-5 animate-spin" />
			                      </span>
			                      <div className="min-w-0 flex-1">
			                        <div className="text-sm font-semibold text-amber-50">
			                          {executionScriptReady ? '正在重新整理执行剧本' : '正在生成执行剧本'}
			                        </div>
			                        <div className="mt-0.5 text-xs leading-5 text-amber-100/65">
			                          {executionScriptProgressMessage}
			                        </div>
			                      </div>
			                      <span className="execution-script-elapsed">
			                        {executionScriptElapsedSeconds < 60
			                          ? `${executionScriptElapsedSeconds} 秒`
			                          : `${Math.floor(executionScriptElapsedSeconds / 60)}分${executionScriptElapsedSeconds % 60}秒`}
			                      </span>
			                    </div>
			                    <div className="execution-script-indeterminate" aria-hidden="true">
			                      <span />
			                    </div>
			                    <div className="execution-script-generating-steps" aria-hidden="true">
			                      <span className="is-complete">
			                        <CheckCircle2 className="h-3.5 w-3.5" />
			                        已接收剧本
			                      </span>
			                      <span className="is-active">
			                        <Sparkles className="h-3.5 w-3.5" />
			                        正在分析场次
			                      </span>
			                      <span>
			                        <Circle className="h-3.5 w-3.5" />
			                        等待规范格式
			                      </span>
			                    </div>
			                  </div>
			                ) : !executionScriptReady ? (
			                  <Button
			                    className="w-full"
		                    onClick={async () => {
		                      await ensureExecutionScript();
		                    }}
		                    disabled={isProcessing || isGeneratingExecutionScript}
		                  >
		                    {isGeneratingExecutionScript ? (
		                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
		                    ) : (
		                      <Sparkles className="w-4 h-4 mr-2" />
		                    )}
		                    生成执行剧本
		                  </Button>
		                ) : (
		                  <div className="space-y-4">
		                    <div className="execution-script-ready-state flex items-start gap-3 rounded-md border border-amber-400/25 bg-amber-500/10 px-4 py-3.5 text-amber-100">
		                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-amber-300/35 bg-black/20">
		                        <CheckCircle2 className="h-4 w-4" />
		                      </span>
		                      <div className="min-w-0 flex-1">
		                        <div className="text-sm font-semibold leading-5">执行剧本已就绪</div>
		                        <div className="execution-script-copy mt-0.5 text-xs leading-5 text-amber-100/70">
		                          后续场景、人物、人物音色、道具和大纲提取将优先使用这份执行剧本。
		                        </div>
		                      </div>
		                    </div>
		                    <div className="execution-script-actions">
		                        <Dialog open={showExecutionScriptPreview} onOpenChange={setShowExecutionScriptPreview}>
		                          <DialogTrigger asChild>
		                            <Button
		                              variant="outline"
		                              className="execution-script-action execution-script-action-primary w-full justify-center border-amber-300/45 bg-amber-500/10 text-amber-50 hover:bg-amber-500/20"
		                            >
		                              <Eye className="h-4 w-4 shrink-0" />
		                              <span className="whitespace-nowrap text-center">查看执行剧本</span>
		                            </Button>
		                          </DialogTrigger>
			                          <DialogContent className="flex max-h-[82vh] flex-col sm:max-w-xl">
		                            <DialogHeader>
		                              <DialogTitle>查看执行剧本</DialogTitle>
		                              <DialogDescription>
		                                这是基于上传故事整理出的执行剧本，后续提取会优先使用这份内容。
		                              </DialogDescription>
		                            </DialogHeader>
			                            <Textarea
			                              readOnly
			                              value={normalizedExecutionScript}
			                              className="h-[min(56vh,520px)] min-h-[320px] resize-none overflow-y-auto [field-sizing:fixed] text-xs leading-6"
			                            />
		                            <DialogFooter className="gap-2">
		                              <Button
		                                variant="outline"
		                                onClick={() => {
		                                  navigator.clipboard.writeText(normalizedExecutionScript).then(
		                                    () => toast.success('执行剧本内容已复制'),
		                                    () => toast.error('复制失败，请手动选择复制')
		                                  );
		                                }}
		                              >
		                                <Copy className="w-4 h-4 mr-2" />
		                                复制内容
		                              </Button>
		                              <Button variant="outline" onClick={() => setShowExecutionScriptPreview(false)}>
		                                关闭
		                              </Button>
		                            </DialogFooter>
		                          </DialogContent>
		                        </Dialog>
		                        <Button
		                          variant="outline"
		                          className="execution-script-action w-full justify-center"
		                          onClick={async () => {
		                            await ensureExecutionScript(true);
		                          }}
		                          disabled={isProcessing || isGeneratingExecutionScript}
		                        >
		                          {isGeneratingExecutionScript ? (
		                            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
		                          ) : (
		                            <RefreshCw className="h-4 w-4 shrink-0" />
		                          )}
		                          <span className="whitespace-nowrap text-center">重新拉起</span>
		                        </Button>
		                        <Button
		                          variant="outline"
		                          className="execution-script-action w-full justify-center"
		                          onClick={handleExportExecutionScript}
		                          disabled={isExportingExecutionScript}
		                        >
		                          {isExportingExecutionScript ? (
		                            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
		                          ) : (
		                            <Download className="h-4 w-4 shrink-0" />
		                          )}
		                          <span className="whitespace-nowrap text-center">导出 Word</span>
		                        </Button>
		                  </div>
		                </div>
			                )}
			                  {executionScriptError && !isGeneratingExecutionScript && (
			                    <div
			                      className="execution-script-error-state"
			                      role="alert"
			                      aria-live="assertive"
			                    >
			                      <span className="execution-script-error-icon" aria-hidden="true">
			                        <AlertCircle className="h-4 w-4" />
			                      </span>
			                      <div className="min-w-0 flex-1">
			                        <div className="text-sm font-semibold text-amber-50">
			                          本次执行剧本未生成完成
			                        </div>
			                        <div className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-amber-100/70">
			                          {executionScriptError}
			                        </div>
			                      </div>
			                      <Button
			                        type="button"
			                        size="sm"
			                        variant="outline"
			                        className="execution-script-error-retry shrink-0"
			                        onClick={async () => {
			                          await ensureExecutionScript(executionScriptReady);
			                        }}
			                        disabled={isProcessing || isGeneratingExecutionScript}
			                      >
			                        <RefreshCw className="h-3.5 w-3.5" />
			                        再试一次
			                      </Button>
			                    </div>
			                  )}
			                  {hasLegacyExtractionResultsPendingExecutionScript && (
		                    <div className="execution-script-copy rounded-md border border-amber-400/25 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
		                      当前恢复的是旧流程提取结果。请先生成执行剧本并确认创作圣经，系统会按新流程重新提取场景、人物、人物音色、道具和大纲。
		                    </div>
		                  )}
	                </CardContent>
	              </Card>
	            )}

	            <Dialog open={showExecutionScriptSuccessDialog} onOpenChange={setShowExecutionScriptSuccessDialog}>
	              <DialogContent className="sm:max-w-md">
	                <DialogHeader>
	                  <DialogTitle className="flex items-center gap-2">
	                    <CheckCircle2 className="h-5 w-5 text-emerald-300" />
	                    执行剧本拉取成功
	                  </DialogTitle>
	                  <DialogDescription>
	                    执行剧本已经整理完成。接下来可以查看内容，或继续确认创作圣经后进入并行提取。
	                  </DialogDescription>
	                </DialogHeader>
	                <DialogFooter className="gap-2">
	                  <Button
	                    variant="outline"
	                    onClick={() => {
	                      setShowExecutionScriptSuccessDialog(false);
	                      setShowExecutionScriptPreview(true);
	                    }}
	                  >
	                    <Eye className="mr-2 h-4 w-4" />
	                    查看执行剧本
	                  </Button>
	                  <Button onClick={() => setShowExecutionScriptSuccessDialog(false)}>
	                    继续
	                  </Button>
	                </DialogFooter>
	              </DialogContent>
	            </Dialog>

	            {/* Creation Bible */}
	            {uploadedStoryReady && executionScriptReady && (
	              <Card>
	                <CardHeader>
	                  <CardTitle className="flex items-center justify-between gap-2">
	                    <span className="flex items-center gap-2">
	                      <BookOpen className="w-5 h-5" />
	                      创作圣经
	                    </span>
	                    <Badge variant={creationBibleReady ? 'default' : 'outline'}>
	                      {creationBibleReady ? '已确认' : '待确认'}
	                    </Badge>
	                  </CardTitle>
	                  <CardDescription>
	                    确认后，场景、人物、道具提取和后续素材生图都会遵循这里的创作方向。
	                  </CardDescription>
	                </CardHeader>
	                <CardContent className="space-y-4">
	                  {creationBibleReady ? (
	                    <div className="rounded-md border border-amber-400/25 bg-amber-500/10 p-4">
	                      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-amber-100">
	                        <CheckCircle2 className="h-4 w-4" />
	                        创作圣经已确认，后续流程将按以下方向执行
	                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
	                        <div className="rounded-md border border-amber-400/20 bg-black/20 px-3 py-2">
	                          <div className="text-[11px] text-amber-200/70">创作类型</div>
	                          <div className="mt-1 text-sm font-semibold text-amber-50">{creationBible.creationType}</div>
	                        </div>
                        <div className="rounded-md border border-amber-400/20 bg-black/20 px-3 py-2">
                          <div className="text-[11px] text-amber-200/70">创作题材</div>
                          <div className="mt-1 text-sm font-semibold text-amber-50">{creationBible.subjectRegion}</div>
                        </div>
                        <div className="rounded-md border border-amber-400/20 bg-black/20 px-3 py-2">
                          <div className="text-[11px] text-amber-200/70">创作背景</div>
                          <div className="mt-1 text-sm font-semibold text-amber-50">{creationBible.creationBackground}</div>
                        </div>
	                      </div>
	                      <AlertDialog>
	                        <AlertDialogTrigger asChild>
	                          <Button
	                            type="button"
	                            variant="outline"
	                            className="mt-3 w-full border-amber-400/35 bg-black/20 text-amber-50 hover:bg-amber-500/10"
	                            disabled={isProcessing || isGeneratingExecutionScript}
	                          >
	                            <RefreshCw className="mr-2 h-4 w-4" />
	                            重新选择创作圣经
	                          </Button>
	                        </AlertDialogTrigger>
	                        <AlertDialogContent>
	                          <AlertDialogHeader>
	                            <AlertDialogTitle>确认重新选择创作圣经？</AlertDialogTitle>
	                            <AlertDialogDescription>
	                              创作圣经会影响后续场景、人物、道具、大纲提取，以及分镜、提示词、故事版和图片生成结果。确认后，当前后续提取结果会被清空，需要重新提取。
	                            </AlertDialogDescription>
	                          </AlertDialogHeader>
	                          <AlertDialogFooter>
	                            <AlertDialogCancel>取消</AlertDialogCancel>
	                            <AlertDialogAction onClick={reopenCreationBibleSelection}>
	                              确认重新选择
	                            </AlertDialogAction>
	                          </AlertDialogFooter>
	                        </AlertDialogContent>
	                      </AlertDialog>
	                    </div>
	                  ) : (
	                    <>
	                      <div className="space-y-2">
	                        <Label className="text-sm text-amber-100">创作类型（单选）</Label>
	                        <div className="grid gap-2 sm:grid-cols-3">
	                          {CREATION_TYPE_OPTIONS.map(option => {
	                            const selected = creationBible.creationType === option.value;
	                            return (
	                              <Button
	                                key={option.value}
	                                type="button"
	                                variant={selected ? 'default' : 'outline'}
	                                className={`h-auto justify-start px-3 py-3 text-left ${selected ? 'border-amber-300 shadow-[0_0_18px_rgba(245,184,64,0.28)]' : ''}`}
	                                onClick={() => setCreationBible(prev => ({
	                                  ...prev,
	                                  creationType: option.value,
	                                  confirmed: false,
	                                }))}
	                              >
	                                <span>
	                                  <span className="block text-sm font-medium">{option.label}</span>
	                                  <span className="mt-1 block whitespace-normal text-xs opacity-70">{option.description}</span>
	                                </span>
	                              </Button>
	                            );
	                          })}
	                        </div>
	                      </div>

	                      <div className="space-y-2">
	                        <Label className="text-sm text-amber-100">创作题材（单选）</Label>
	                        <div className="grid gap-2 sm:grid-cols-2">
	                          {CREATION_REGION_OPTIONS.map(option => {
	                            const selected = creationBible.subjectRegion === option.value;
	                            return (
	                              <Button
	                                key={option.value}
	                                type="button"
	                                variant={selected ? 'default' : 'outline'}
	                                className={`h-auto justify-start px-3 py-3 text-left ${selected ? 'border-amber-300 shadow-[0_0_18px_rgba(245,184,64,0.28)]' : ''}`}
	                                onClick={() => setCreationBible(prev => ({
	                                  ...prev,
	                                  subjectRegion: option.value,
	                                  confirmed: false,
	                                }))}
	                              >
	                                <span>
	                                  <span className="block text-sm font-medium">{option.label}</span>
	                                  <span className="mt-1 block whitespace-normal text-xs opacity-70">{option.description}</span>
	                                </span>
	                              </Button>
	                            );
	                          })}
	                        </div>
	                      </div>

	                      <div className="space-y-2">
	                        <Label className="text-sm text-amber-100">创作背景（单选）</Label>
	                        <div className="grid gap-2 sm:grid-cols-3">
	                          {CREATION_BACKGROUND_OPTIONS.map(option => {
	                            const selected = creationBible.creationBackground === option.value;
	                            return (
	                              <Button
	                                key={option.value}
	                                type="button"
	                                variant={selected ? 'default' : 'outline'}
	                                className={`h-auto justify-start px-3 py-3 text-left ${selected ? 'border-amber-300 shadow-[0_0_18px_rgba(245,184,64,0.28)]' : ''}`}
	                                onClick={() => setCreationBible(prev => ({
	                                  ...prev,
	                                  creationBackground: option.value,
	                                  confirmed: false,
	                                }))}
	                              >
	                                <span>
	                                  <span className="block text-sm font-medium">{option.label}</span>
	                                  <span className="mt-1 block whitespace-normal text-xs opacity-70">{option.description}</span>
	                                </span>
	                              </Button>
	                            );
	                          })}
	                        </div>
	                      </div>

	                      <Button
	                        className="w-full"
	                        onClick={confirmCreationBibleAndStartExtraction}
	                        disabled={
	                          isProcessing ||
	                          isGeneratingExecutionScript ||
	                          !creationBible.creationType ||
	                          !creationBible.subjectRegion ||
	                          !creationBible.creationBackground
	                        }
	                      >
	                        {isGeneratingExecutionScript ? (
	                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
	                        ) : (
	                          <Sparkles className="w-4 h-4 mr-2" />
	                        )}
	                        确认创作圣经并开始提取
	                      </Button>
	                    </>
	                  )}
	                </CardContent>
	              </Card>
	            )}

	            {/* Parallel Extraction Status */}
	            {canShowExtractionResults && hasExtractionStatusToShow && (
	              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5" />
                    并行提取状态
                  </CardTitle>
                  <CardDescription>
                    五个维度提取完成后，会回查原剧本核验重复项
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
                        {renderStatusIcon(effectiveExtractionStatus.scenes)}
                        {effectiveExtractionStatus.scenes !== 'loading' && effectiveExtractionStatus.scenes !== 'pending' && (
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
                        {renderStatusIcon(effectiveExtractionStatus.characters)}
                        {effectiveExtractionStatus.characters !== 'loading' && effectiveExtractionStatus.characters !== 'pending' && (
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
                        <Volume2 className="w-4 h-4 text-amber-400" />
                        <span className="text-sm">人物音色提取</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {renderStatusIcon(effectiveExtractionStatus.voices)}
                        {effectiveExtractionStatus.voices !== 'loading' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2"
                            title={effectiveExtractionStatus.voices === 'pending' ? '提取人物音色' : '重新提取人物音色'}
                            onClick={() => retryExtraction('voices')}
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
                        {renderStatusIcon(effectiveExtractionStatus.props)}
                        {effectiveExtractionStatus.props !== 'loading' && effectiveExtractionStatus.props !== 'pending' && (
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
                        {renderStatusIcon(effectiveExtractionStatus.outline)}
                        {effectiveExtractionStatus.outline !== 'loading' && effectiveExtractionStatus.outline !== 'pending' && effectiveExtractionStatus.outline !== 'batch_confirm' && (
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
                    <div className="rounded bg-gray-50 p-2 dark:bg-gray-800">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-amber-400" />
                          <div className="min-w-0">
                            <div className="text-sm">全文质量核验</div>
                            <div className="truncate text-[11px] text-muted-foreground">
                              {extractionReview.status === 'reviewing'
                                ? '正在核验重复项与人物造型时间线'
                                : extractionReview.status === 'pending'
                                  ? '等待人物、场景、道具全部提取完成'
                                  : extractionReview.status === 'success'
                                    ? extractionReview.mergedGroupCount > 0
                                      ? `已确认并合并 ${extractionReview.mergedGroupCount} 组重复项`
                                      : '重复项已核验'
                                    : extractionReview.status === 'error'
                                      ? (extractionReview.error || '核验失败，可重新尝试')
                                      : '核验重复实体，并自动检查人物时期与状态造型漏项'}
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {extractionReview.status === 'reviewing' ? (
                            <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
                          ) : extractionReview.status === 'success' ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                          ) : extractionReview.status === 'error' ? (
                            <AlertCircle className="h-4 w-4 text-red-400" />
                          ) : (
                            <Circle className="h-4 w-4 text-muted-foreground" />
                          )}
                          {hasSceneExtractionResult && hasCharacterExtractionResult && hasPropExtractionResult && extractionReview.status !== 'reviewing' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              title="重新通读原剧本，核验重复项与人物时期/状态造型漏项；会按实际 Token 扣除创作点"
                              onClick={() => void runExtractionQualityReview(true)}
                            >
                              <RefreshCw className="mr-1 h-3 w-3" />
                              {extractionReview.reviewedAt ? '重新核验' : '开始核验'}
                            </Button>
                          )}
                        </div>
                      </div>
                      {extractionReview.status === 'success' && extractionReview.lifecycle && (
                        <div className={`mt-2 rounded border px-2 py-1.5 text-[11px] ${
                          extractionReview.lifecycle.unresolvedCount > 0
                            ? 'border-red-400/25 bg-red-500/[0.06] text-red-100/80'
                            : 'border-emerald-400/20 bg-emerald-500/[0.05] text-emerald-100/75'
                        }`}>
                          人物造型证据 {extractionReview.lifecycle.requiredCount - extractionReview.lifecycle.unresolvedCount}
                          /{extractionReview.lifecycle.requiredCount} 已覆盖
                          {(extractionReview.lifecycle.repairedByModel + extractionReview.lifecycle.fallbackAdded) > 0 && (
                            <>；本次自动补齐 {extractionReview.lifecycle.repairedByModel + extractionReview.lifecycle.fallbackAdded} 项</>
                          )}
                          {extractionReview.lifecycle.unresolvedCount > 0 && (
                            <>；仍有 {extractionReview.lifecycle.unresolvedCount} 项需复核</>
                          )}
                        </div>
                      )}
                      {extractionReview.status === 'success' && extractionReview.groups.length > 0 && (
                        <div className="mt-2 space-y-1 border-t border-amber-400/15 pt-2">
                          {extractionReview.groups.slice(0, 4).map((group, index) => (
                            <div
                              key={`${group.type}-${group.canonicalName}-${index}`}
                              className="truncate text-[11px] text-amber-100/70"
                              title={`${group.aliases.join(' / ')} → ${group.canonicalName}；${group.reason}`}
                            >
                              {group.type === 'scene' ? '场景' : group.type === 'character' ? '人物' : '道具'}：
                              {group.aliases.join(' / ')} → {group.canonicalName}
                            </div>
                          ))}
                          {extractionReview.groups.length > 4 && (
                            <div className="text-[11px] text-muted-foreground">另有 {extractionReview.groups.length - 4} 组已完成合并</div>
                          )}
                        </div>
                      )}
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
                        已提取 {outlineBatchInfo.allChapters.length} / {outlineBatchInfo.totalEpisodes} 集
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
	                  {canShowExtractionResults && isEffectiveExtractionSuccess && !stepConfirmed.extraction && (
                    <div className="mt-4 space-y-2">
                      <Button
                        className="w-full"
                        onClick={() => confirmStep('extraction')}
                        disabled={isProcessing}
                      >
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        确认提取结果，选择分集
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
	            {canShowExtractionResults && outline && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BookOpen className="w-5 h-5" />
                    故事大纲
                  </CardTitle>
                  <CardDescription>
                    共 {outline.totalChapters} 集
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

                    {/* 分步确认流程 - 步骤1：确认大纲和分集选择 */}
                    {stepConfirmed.extraction ? (
                      <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                            <CheckCircle2 className="w-4 h-4" />
                            <span className="text-sm font-medium">大纲和分集选择已确认</span>
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
                            <span className="text-sm font-medium">确认大纲和分集选择</span>
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
                          确认后，系统将基于选定分集生成文字分镜
                        </p>
                      </div>
                    )}

                    {/* 分集列表 */}
                    <div className="space-y-2 mt-4">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">分集列表：</p>
                      {outline.chapters.map((chapter, index) => (
                        <div
                          key={`chapter-list-${chapter.chapterNumber}-${index}`}
                          className="p-3 rounded-lg border border-gray-200 dark:border-gray-700"
                        >
                          <div className="flex items-start gap-3">
                            <Badge variant="outline" className="shrink-0 mt-0.5">
                              第 {chapter.chapterNumber} 集
                            </Badge>
                            <div className="flex-1 min-w-0">
                              <p
                                className="text-xs text-gray-500 line-clamp-2"
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
          <div className={hasExpandedExtractionCollection ? 'min-w-0 lg:col-span-1' : 'min-w-0 lg:col-span-2'}>
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
	                  {canShowExtractionResults && scenesData && (
                    <Card>
                      <CardHeader>
                        <div className="flex items-center justify-between gap-3">
                          <CardTitle className="flex items-center gap-2 text-lg">
                            <MapPin className="w-5 h-5 text-blue-500" />
                            场景列表
                            {(() => {
                              const scenesForCount = ((sceneBatchInfo?.allScenes?.length ?? 0) > 0 ? sceneBatchInfo?.allScenes : scenesData.scenes) || [];
                              const mainSceneCount = new Set(scenesForCount.map((scene: Scene) => getSceneMainSceneName(scene))).size;
                              return (
                                <Badge variant="secondary">
                                  {mainSceneCount || scenesData.totalMainScenes || 0} 个主场景 / {scenesForCount.length || scenesData.totalScenes || 0} 个状态
                                </Badge>
                              );
                            })()}
                          </CardTitle>
                          <div className="flex shrink-0 flex-wrap justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => exportAssetListPackage('scene')}
                              disabled={exportingAssetListType !== null || getBatchAssetList('scene').length === 0}
                              title="导出场景 Excel、缩略图和全部原图 ZIP"
                            >
                              {exportingAssetListType === 'scene' ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              ) : (
                                <Download className="w-4 h-4 mr-2" />
                              )}
                              导出完整素材 ZIP
                            </Button>
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
                        </div>
                        {batchAssetGeneration.type === 'scene' && (
                          <CardDescription>
                            正在生成：{batchAssetGeneration.currentName || '准备中'}
                          </CardDescription>
                        )}
                      </CardHeader>
                      <CardContent>
                        {/* 场景整体提取进度 */}
                        {sceneBatchInfo && (
                          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-blue-700 dark:text-blue-400">
                                {extractionStatus.scenes === 'error' ? (
                                  '场景提取中断，请点击重新提取'
                                ) : extractionStatus.scenes === 'loading' ? (
                                  <span className="flex items-center gap-2">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    正在自动提取全部场景...
                                  </span>
                                ) : sceneBatchInfo.hasMore ? (
                                  '场景正在自动提取全部内容'
                                ) : (
                                  '场景已全部提取完成'
                                )}
                              </span>
                              <span className="text-sm text-blue-600 dark:text-blue-300">
                                {Math.round((sceneBatchInfo.currentBatch / sceneBatchInfo.totalBatches) * 100)}%
                              </span>
                            </div>
                            <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2">
                              <div
                                className={`bg-blue-600 h-2 rounded-full transition-all duration-300 ${extractionStatus.scenes === 'loading' ? 'animate-pulse' : ''}`}
                                style={{ width: `${(sceneBatchInfo.currentBatch / sceneBatchInfo.totalBatches) * 100}%` }}
                              />
                            </div>
                            <div className="text-xs text-gray-600 dark:text-gray-400">
                              已整理 {sceneBatchInfo.allScenes?.length || 0} 个有效制作状态
                              {sceneBatchInfo.sceneMarkers?.length > 0 && `（原始识别 ${sceneBatchInfo.sceneMarkers.length} 条场景记录）`}
                            </div>
                          </div>
                        )}

                        {sceneRenderItems.length === 0 ? (
                          <div className="py-8 text-center text-gray-400">
                            <Users className="mx-auto mb-2 h-12 w-12 opacity-50" />
                            <p className="text-sm">暂无场景数据</p>
                          </div>
                        ) : (
                          <OnDemandCollection
                            items={sceneRenderItems}
                            expanded={expandedSections.scenes}
                            collapsedCount={3}
                            batchSize={6}
                            className="grid grid-cols-1 gap-3 overflow-x-hidden transition-all duration-300"
                            collapsedClassName="max-h-[520px] overflow-y-hidden"
                            expandedClassName="max-h-none overflow-y-visible"
                            itemClassName="grid grid-cols-1 gap-3 [content-visibility:auto] [contain-intrinsic-size:760px]"
                            getKey={item => `scene-${item.scene.id}-${item.scene.name}-${item.sourceIndex}`}
                            renderItem={(renderItem) => {
                            const {
                              scene,
                              sourceIndex: index,
                              mainSceneName,
                              shouldShowMainSceneHeader,
                              siblingStateCount,
                              siblingStateIndex,
                              siblingEpisodeNumbers,
                            } = renderItem;
                            const assetData = getAssetImages('scene', scene.id, scene.name);
                            const images = assetData?.images || [];
                            const sceneReferenceImage = getSceneReferenceImage(scene);
                            const referenceSceneAsset = scene.referenceSceneName
                              ? getAssetImages('scene', scene.referenceSceneName)
                              : undefined;
                            const referenceSceneIsGenerating = referenceSceneAsset?.images.some(image => image.isGenerating) || false;
                            const generationAssetId = `scene-${scene.name}`;
                            const generatingImage = images.find(img => img.isGenerating);
                            const generationStatus = assetGenerationStatuses[generationAssetId] || generatingImage?.generatingStatus || '';
                            const isGenerating = Boolean(generationStatus || generatingImage);
                            const completedImageCount = images.filter(img => Boolean(img.imageUrl) && !img.isGenerating).length;
                            const currentAssetId = assetData?.assetId || `scene-${scene.name}`;
                            const isAssetsConfirmed = stepConfirmed.assets; // 素材是否已确认

                            return (
                              <Fragment>
                              {shouldShowMainSceneHeader && (
                                <div className="col-span-full rounded border border-amber-400/25 bg-amber-500/10 px-3 py-2">
                                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                                    <div className="min-w-0">
                                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                                        <span className="text-sm font-semibold text-amber-100" title={normalizeDisplayText(mainSceneName)}>
                                          {compactDisplayText(mainSceneName, 34)}
                                        </span>
                                        <Badge variant="outline" className="border-amber-400/35 text-amber-100">
                                          主场景
                                        </Badge>
                                      </div>
                                      <p className="mt-1 text-xs text-amber-100/65">
                                        下含 {siblingStateCount} 个有效制作状态
                                        {siblingEpisodeNumbers.length > 0 && `，关联 ${siblingEpisodeNumbers.slice(0, 5).map(item => `第${item}集`).join('、')}${siblingEpisodeNumbers.length > 5 ? ` 等${siblingEpisodeNumbers.length}集` : ''}`}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              )}
                              <div key={`scene-${scene.name}-${index}`} className={`min-w-0 overflow-hidden rounded-md border border-amber-400/20 bg-black/15 p-3 ${isAssetsConfirmed ? 'opacity-75' : ''}`}>
                                <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(320px,44%)_minmax(0,1fr)] lg:items-start">
                                <div className="min-w-0 space-y-2">
                                <AssetImageStack
                                  images={images}
                                  name={scene.name}
                                  type="scene"
                                  generationStatus={generationStatus}
                                  failureReason={assetGenerationErrors[generationAssetId]}
                                  isGenerating={isGenerating}
                                  isAssetsConfirmed={isAssetsConfirmed}
                                  onOpenChooser={() => setAssetImageChooserTarget({ assetId: currentAssetId, type: 'scene', name: scene.name })}
                                  onPreview={image => openImagePreview(image.imageUrl, scene.name, 'scene')}
                                  onGenerateFromImage={image => generateImageFromImage('scene', scene, image.imageUrl)}
                                  onDownload={image => downloadImage(image.imageUrl, scene.name)}
                                  onRemove={image => removeSelectedImage(currentAssetId, image.imageId)}
                                />
                                <div className="flex min-h-8 items-center justify-between gap-2">
                                  <span className="text-xs text-amber-100/55">
                                    {isGenerating ? `处理中 · 候选图 ${completedImageCount}/${MAX_IMAGES_PER_ASSET}` : `候选图 ${completedImageCount}/${MAX_IMAGES_PER_ASSET}`}
                                  </span>
                                  {!isGenerating && !isAssetsConfirmed && (
                                    <div className="flex items-center gap-1 rounded-md border border-amber-400/15 bg-black/20 p-1">
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7 min-w-0 p-0 text-amber-100/80 hover:bg-amber-400/15 hover:text-amber-50"
                                        onClick={() => generateAssetImage('scene', scene)}
                                        title="AI生成图片"
                                        aria-label="生成场景图片"
                                      >
                                        <Sparkles className="size-3.5" />
                                      </Button>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7 min-w-0 p-0 text-amber-100/80 hover:bg-amber-400/15 hover:text-amber-50"
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
                                        aria-label="上传场景图片"
                                      >
                                        <ImagePlus className="size-3.5" />
                                      </Button>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7 min-w-0 p-0 text-amber-100/80 hover:bg-amber-400/15 hover:text-amber-50"
                                        onClick={() => openImageLibrary('scene', scene.id, scene.name)}
                                        title="从图片库选择"
                                        aria-label="从图片库选择场景图片"
                                      >
                                        <FolderOpen className="size-3.5" />
                                      </Button>
                                    </div>
                                  )}
                                </div>
                                </div>
                                <div className="min-w-0 space-y-3">
                                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 overflow-hidden">
                                  <span
                                    className="min-w-0 max-w-full break-words text-sm font-medium leading-5 [overflow-wrap:anywhere]"
                                    title={normalizeDisplayText(scene.name)}
                                  >
                                    {compactDisplayText(scene.name, 28)}
                                  </span>
                                  <Badge variant="outline" className="border-amber-400/30 text-amber-100/85">
                                    状态 {Math.max(1, siblingStateIndex + 1)}/{siblingStateCount}
                                  </Badge>
                                  <CompactBadge text={scene.type} maxChars={8} />
                                  <CompactBadge text={scene.importance} maxChars={8} variant="default" />
                                  {scene.stateLabel && (
                                    <CompactBadge text={scene.stateLabel} maxChars={10} variant="secondary" />
                                  )}
                                </div>
                                <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-amber-100/75">
                                  <span className="shrink-0">关联集数：</span>
                                  <span className="min-w-0 truncate" title={normalizeDisplayText(formatSceneEpisodeText(scene))}>
                                    {compactDisplayText(formatSceneEpisodeText(scene), 42)}
                                  </span>
                                </div>
                                {scene.occurrences && scene.occurrences.length > 0 && (
                                  <div className="flex min-w-0 flex-wrap gap-1">
                                    {scene.occurrences.slice(0, 2).map((occurrence, occurrenceIndex) => (
                                      <CompactBadge
                                        key={`scene-${scene.id}-occurrence-${occurrenceIndex}`}
                                        text={`${occurrence.episodeLabel || '未标注'} ${occurrence.heading || scene.name}`}
                                        maxChars={28}
                                        variant="outline"
                                      />
                                    ))}
                                    {scene.occurrences.length > 2 && (
                                      <span className="text-xs text-gray-400">+{scene.occurrences.length - 2}</span>
                                    )}
                                  </div>
                                )}
                                {scene.referenceSceneName && (
                                  <p
                                    className={`truncate text-xs ${sceneReferenceImage ? 'text-emerald-300/90' : 'text-amber-200/75'}`}
                                    title={`基准图生图参考：${normalizeDisplayText(scene.referenceSceneName)}；${sceneReferenceImage ? '基准图已关联' : referenceSceneIsGenerating ? '基准图正在生成' : '需要先生成基准图'}`}
                                  >
                                    基准图生图参考：{compactDisplayText(scene.referenceSceneName, 26)} · {sceneReferenceImage ? '已关联' : referenceSceneIsGenerating ? '生成中' : '待生成'}
                                  </p>
                                )}
                                <div className="rounded border border-amber-400/15 bg-amber-500/[0.04] px-2.5 py-2 text-xs leading-5 text-amber-100/70">
                                  <p>
                                    <span className="text-amber-200/90">状态依据：</span>
                                    {scene.stateReasonLabel || getSceneStateReasonLabel(scene.stateReason)}
                                  </p>
                                  {scene.stateChangeEvidence && (
                                    <p className="line-clamp-2 break-words [overflow-wrap:anywhere]" title={normalizeDisplayText(scene.stateChangeEvidence)}>
                                      <span className="text-amber-200/90">剧本证据：</span>
                                      {compactDisplayText(scene.stateChangeEvidence, 76)}
                                    </p>
                                  )}
                                  {scene.stateVisualDifference && scene.stateReason !== 'baseline' && (
                                    <p className="line-clamp-2 break-words [overflow-wrap:anywhere]" title={normalizeDisplayText(scene.stateVisualDifference)}>
                                      <span className="text-amber-200/90">画面变化：</span>
                                      {compactDisplayText(scene.stateVisualDifference, 76)}
                                    </p>
                                  )}
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
                                    className="group min-w-0 cursor-pointer"
                                    onClick={() => {
                                      setEditingSceneId(scene.id);
                                      setEditingSceneDescription(scene.description || '');
                                    }}
                                  >
                                    <p
                                      className="line-clamp-3 break-words text-xs leading-5 text-gray-600 [overflow-wrap:anywhere] group-hover:text-blue-600 dark:text-gray-400 dark:group-hover:text-blue-400"
                                      title={normalizeDisplayText(scene.description)}
                                    >
                                      {compactDisplayText(scene.description || '点击添加场景描述...', 92)}
                                    </p>
                                    <p className="text-xs text-gray-400 dark:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                      点击编辑描述
                                    </p>
                                  </div>
                                )}
                                <p className="truncate text-xs text-gray-500" title={normalizeDisplayText(`${scene.timeOfDay || ''} | ${scene.atmosphere || ''}`)}>
                                  {compactDisplayText(`${scene.timeOfDay || ''} | ${scene.atmosphere || ''}`, 42)}
                                </p>
                                {scene.keyEvents && scene.keyEvents.length > 0 && (
                                  <div className="mt-1">
                                    <p className="text-xs text-gray-500 mb-1">关键事件：</p>
                                    <div className="flex min-w-0 flex-wrap gap-1">
                                      {scene.keyEvents.slice(0, 2).map((event: string, i: number) => (
                                        <CompactBadge key={`scene-${scene.id}-event-${i}`} text={event} maxChars={24} variant="secondary" />
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
                                    <div className="flex min-w-0 flex-wrap gap-1">
                                      {scene.visualElements.slice(0, 3).map((elem: string, i: number) => (
                                        <CompactBadge key={`scene-${scene.id}-elem-${i}`} text={elem} maxChars={14} />
                                      ))}
                                      {scene.visualElements.length > 3 && (
                                        <span className="text-xs text-gray-400">+{scene.visualElements.length - 3}</span>
                                      )}
                                    </div>
                                  </div>
                                )}
                                </div>
                                </div>
                              </div>
                              </Fragment>
                            );
                            }}
                          />
                        )}
                        <div className="text-center mt-2">
                          <Button variant="ghost" size="sm" className="text-xs text-gray-500" onClick={() => toggleSection('scenes')}>
                            {expandedSections.scenes ? '收起' : '展开全部'} {sceneBatchInfo?.allScenes?.length || scenesData?.scenes?.length || 0} 个状态
                            <ChevronDown className={`w-3 h-3 ml-1 transition-transform ${expandedSections.scenes ? 'rotate-180' : ''}`} />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Characters */}
	                  {canShowExtractionResults && charactersData && (
                    <Card>
                      <CardHeader>
                        <div className="flex items-center justify-between gap-3">
                          <CardTitle className="flex items-center gap-2 text-lg">
                            <Users className="w-5 h-5 text-purple-500" />
                            人物列表
                            <Badge variant="secondary">{characterBatchInfo?.characterMarkers?.length || charactersData.totalCharacters} 个人物</Badge>
                          </CardTitle>
                          <div className="flex shrink-0 flex-wrap justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => exportAssetListPackage('character')}
                              disabled={exportingAssetListType !== null || getBatchAssetList('character').length === 0}
                              title="导出人物 Excel、缩略图和全部原图 ZIP"
                            >
                              {exportingAssetListType === 'character' ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              ) : (
                                <Download className="w-4 h-4 mr-2" />
                              )}
                              导出完整素材 ZIP
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => generateAllAssetImages('character')}
                              disabled={isProcessing || isBatchAssetGenerating || stepConfirmed.assets || getBatchAssetList('character').length === 0}
                              title={stepConfirmed.assets ? '素材已确认，无法继续生成' : '只批量生成人物正脸候选图，造型需确认正脸后再生成'}
                            >
                              {batchAssetGeneration.type === 'character' ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              ) : (
                                <Sparkles className="w-4 h-4 mr-2" />
                              )}
                              {batchAssetGeneration.type === 'character'
                                ? `生成中 ${batchAssetGeneration.current}/${batchAssetGeneration.total}`
                                : '一键生成人物正脸'}
                            </Button>
                          </div>
                        </div>
                        {batchAssetGeneration.type === 'character' && (
                          <CardDescription>
                            正在生成：{batchAssetGeneration.currentName || '准备中'}
                          </CardDescription>
                        )}
                      </CardHeader>
                      <CardContent>
                        {/* 人物整体提取进度 */}
                        {characterBatchInfo && (
                          <div className="mb-4 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-purple-700 dark:text-purple-400">
                                {extractionStatus.characters === 'error' ? (
                                  '人物提取中断，请点击重新提取'
                                ) : extractionStatus.characters === 'loading' ? (
                                  <span className="flex items-center gap-2">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    正在自动提取全部人物...
                                  </span>
                                ) : characterBatchInfo.hasMore ? (
                                  '人物正在自动提取全部内容'
                                ) : (
                                  '人物已全部提取完成'
                                )}
                              </span>
                              <span className="text-sm text-purple-600 dark:text-purple-300">
                                {Math.round((characterBatchInfo.currentBatch / characterBatchInfo.totalBatches) * 100)}%
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
                          </div>
                        )}

                        {characterRenderItems.length === 0 ? (
                          <div className="p-4 text-center text-gray-500">
                            <Users className="mx-auto mb-2 h-8 w-8 opacity-50" />
                            <p>暂无人物数据</p>
                            {characterBatchInfo && (
                              <p className="mt-1 text-xs">已提取 {characterBatchInfo.allCharacters?.length || 0} 个人物</p>
                            )}
                          </div>
                        ) : (
                          <OnDemandCollection
                            items={characterRenderItems}
                            expanded={expandedSections.characters}
                            collapsedCount={2}
                            batchSize={4}
                            className="space-y-2 overflow-x-hidden transition-all duration-300"
                            collapsedClassName="max-h-[400px] overflow-y-hidden"
                            expandedClassName="max-h-none overflow-y-visible"
                            itemClassName="[content-visibility:auto] [contain-intrinsic-size:900px]"
                            getKey={(char, index) => `char-${char.id}-${char.name}-${index}`}
                            renderItem={(char: Character, index: number) => {
                            const assetData = getAssetImages('character', char.id, char.name);
                            const images = assetData?.images || [];
                            const generationAssetId = `character-${char.name}`;
                            const generatingImage = images.find(img => img.isGenerating);
                            const generationStatus = assetGenerationStatuses[generationAssetId] || generatingImage?.generatingStatus || '';
                            const isGenerating = Boolean(generationStatus || generatingImage);
                            const completedImageCount = images.filter(img => Boolean(img.imageUrl) && !img.isGenerating).length;
                            const primaryFaceImage = images.find(img => Boolean(img.imageUrl) && !img.isGenerating);
                            const confirmedFaceImageUrl = getCharacterFaceReferenceImage(char);
                            const isFaceIdentityConfirmed = Boolean(
                              confirmedFaceImageUrl && primaryFaceImage?.imageUrl === confirmedFaceImageUrl
                            );
                            const currentAssetId = assetData?.assetId || `character-${char.name}`;
                            const isAssetsConfirmed = stepConfirmed.assets; // 素材是否已确认
                            const displayAge = isUsefulText(char.age) ? (char.age.includes('岁') ? char.age : `${char.age}岁`) : '年龄未知';
                            const displayGender = isUsefulText(char.gender) ? char.gender : '性别待定';

                            return (
                              <div className={`min-w-0 overflow-hidden rounded-md border border-amber-400/20 bg-black/15 p-4 ${isAssetsConfirmed ? 'opacity-75' : ''}`}>
                                <div className="grid min-w-0 gap-4 md:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)]">
                                  {/* 人物图片区域 - 主图叠放选择 */}
                                  <div className="mx-auto w-full max-w-[280px] md:mx-0 md:max-w-none">
                                    <AssetImageStack
                                      images={images}
                                      name={char.name}
                                      type="character"
                                      generationStatus={generationStatus}
                                      failureReason={assetGenerationErrors[generationAssetId]}
                                      isGenerating={isGenerating}
                                      isAssetsConfirmed={isAssetsConfirmed}
                                      onOpenChooser={() => setAssetImageChooserTarget({ assetId: currentAssetId, type: 'character', name: char.name })}
                                      onPreview={image => openImagePreview(image.imageUrl, char.name, 'character')}
                                      onGenerateFromImage={image => generateImageFromImage('character', char, image.imageUrl)}
                                      onDownload={image => downloadImage(image.imageUrl, char.name)}
                                      onRemove={image => removeSelectedImage(currentAssetId, image.imageId)}
                                    />
                                    <div className="mt-2 flex min-h-8 items-center justify-between gap-2">
                                      <span className="text-xs text-amber-100/55">
                                        {isGenerating ? `处理中 · ${completedImageCount}/${MAX_IMAGES_PER_ASSET} 张` : `${completedImageCount}/${MAX_IMAGES_PER_ASSET} 张`}
                                      </span>
                                      {!isGenerating && !isAssetsConfirmed && (
                                        <div className="flex items-center gap-1 rounded-md border border-amber-400/15 bg-black/20 p-1">
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-7 w-7 min-w-0 p-0 text-amber-100/80 hover:bg-amber-400/15 hover:text-amber-50"
                                            onClick={() => generateAssetImage('character', char)}
                                            title="文生图：生成人物正脸候选图"
                                            aria-label="生成人物正脸候选图"
                                          >
                                            <Sparkles className="size-3.5" />
                                          </Button>
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-7 w-7 min-w-0 p-0 text-amber-100/80 hover:bg-amber-400/15 hover:text-amber-50"
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
                                            aria-label="上传人物图片"
                                          >
                                            <ImagePlus className="size-3.5" />
                                          </Button>
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-7 w-7 min-w-0 p-0 text-amber-100/80 hover:bg-amber-400/15 hover:text-amber-50"
                                            onClick={() => openImageLibrary('character', char.id, char.name)}
                                            title="从图片库选择"
                                            aria-label="从图片库选择人物图片"
                                          >
                                            <FolderOpen className="size-3.5" />
                                          </Button>
                                        </div>
                                      )}
                                    </div>
                                    <div className={`mt-2 rounded-md border px-2.5 py-2 text-xs ${
                                      isFaceIdentityConfirmed
                                        ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
                                        : 'border-amber-400/25 bg-amber-500/10 text-amber-100/75'
                                    }`}>
                                      {isFaceIdentityConfirmed ? (
                                        <div className="flex items-center gap-2">
                                          <CheckCircle2 className="size-4 shrink-0 text-emerald-300" />
                                          <span>正脸身份基准已确认，造型图生图已解锁</span>
                                        </div>
                                      ) : primaryFaceImage ? (
                                        <div className="space-y-2">
                                          <div className="flex items-start gap-2">
                                            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" />
                                            <span>请先确认当前正脸主图；确认前，所有时期、状态、变身和四视图均锁定。</span>
                                          </div>
                                          <Button
                                            size="sm"
                                            className="h-7 w-full bg-amber-400 text-black hover:bg-amber-300"
                                            onClick={() => confirmCharacterFaceIdentity(char, primaryFaceImage.imageUrl)}
                                          >
                                            <Check className="mr-1.5 size-3.5" />
                                            确认此图为身份基准
                                          </Button>
                                        </div>
                                      ) : (
                                        <div className="flex items-start gap-2">
                                          <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-300" />
                                          <span>先生成或上传人物正脸，其他一切变体暂不可生成。</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  {/* 人物信息 */}
                                  <div className="min-w-0 flex-1 overflow-hidden">
                                    <div className="mb-1 flex min-w-0 flex-wrap items-start justify-between gap-2">
                                      <div className="flex min-w-0 flex-wrap items-center gap-2 overflow-hidden">
                                        <span className="min-w-0 max-w-full truncate font-medium" title={normalizeDisplayText(char.name)}>
                                          {compactDisplayText(char.name, 18)}
                                        </span>
                                        <CompactBadge text={char.role} maxChars={8} variant={char.role === '主角' ? 'default' : 'outline'} />
                                      </div>
                                      <span className="shrink-0 text-xs text-gray-500">{displayAge} | {displayGender}</span>
                                    </div>
                                    {/* 外貌描述 - 可编辑 */}
                                    {editingCharacterId === char.id ? (
                                      <div className="space-y-1">
                                        <Textarea
                                          value={editingCharacterAppearance}
                                          onChange={(e) => setEditingCharacterAppearance(e.target.value)}
                                          className="text-xs min-h-[60px] resize-none"
                                          placeholder="输入正脸近景描述（发型、五官、肤色、皮肤质感）..."
                                        />
                                        <div className="flex gap-1">
                                          <Button
                                            size="sm"
                                            variant="default"
                                            className="h-6 text-xs"
                                            onClick={() => {
                                              // 保存正脸描述；身体档案独立保留，不参与近景图。
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
                                        className="group min-w-0 cursor-pointer"
                                        onClick={() => {
                                          setEditingCharacterId(char.id);
                                          setEditingCharacterAppearance(char.appearance || '');
                                        }}
                                      >
                                        {/* 正脸近景描述标签 */}
                                        <div className="text-xs text-gray-500 mb-1 font-medium">正脸近景描述：</div>
                                        <p
                                          className="line-clamp-3 break-words text-xs leading-5 text-gray-600 [overflow-wrap:anywhere] group-hover:text-blue-600 dark:text-gray-400 dark:group-hover:text-blue-400"
                                          title={normalizeDisplayText(char.appearance)}
                                        >
                                          {char.appearance && char.appearance.trim() ? (
                                            compactDisplayText(char.appearance, 120)
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
                                        <p className="line-clamp-2 break-words text-xs text-gray-600 [overflow-wrap:anywhere] dark:text-gray-400" title={normalizeDisplayText(char.arc)}>
                                          {compactDisplayText(char.arc, 80)}
                                        </p>
                                      </div>
                                    )}
                                    {/* 相关道具 */}
                                    {char.props && char.props.length > 0 && (
                                      <div className="mt-1">
                                        <div className="flex min-w-0 flex-wrap items-center gap-1">
                                          <span className="text-xs text-gray-500 shrink-0 font-medium">相关道具：</span>
                                          {char.props.map((prop: string, i: number) => (
                                            <CompactBadge key={`char-${char.id}-prop-${i}`} text={prop} maxChars={14} className="bg-blue-50 dark:bg-blue-900/20" />
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {/* 脸型特征 */}
                                    {char.faceFeatures && (
                                      <div className="mt-2 min-w-0 overflow-hidden rounded bg-gray-50 p-2 dark:bg-gray-800">
                                        <span className="text-xs text-gray-500 font-medium">脸型特征（固定）：</span>
                                        <div className="grid grid-cols-2 gap-1 mt-1 text-xs text-gray-600 dark:text-gray-400">
                                          <div className="truncate" title={normalizeDisplayText(char.faceFeatures.faceShape)}>脸型：{compactDisplayText(char.faceFeatures.faceShape || '待补充', 18)}</div>
                                          <div className="truncate" title={normalizeDisplayText(char.faceFeatures.eyes)}>眼睛：{compactDisplayText(char.faceFeatures.eyes || '待补充', 18)}</div>
                                          <div className="truncate" title={normalizeDisplayText(char.faceFeatures.nose)}>鼻子：{compactDisplayText(char.faceFeatures.nose || '待补充', 18)}</div>
                                          <div className="truncate" title={normalizeDisplayText(char.faceFeatures.mouth)}>嘴巴：{compactDisplayText(char.faceFeatures.mouth || '待补充', 18)}</div>
                                          <div className="col-span-2 truncate" title={normalizeDisplayText(char.faceFeatures.skinTone)}>肤色：{compactDisplayText(char.faceFeatures.skinTone || '待补充', 28)}</div>
                                        </div>
                                      </div>
                                    )}
                                    {/* 全身体态档案 */}
                                    {hasCharacterBodyProfile(char.bodyProfile) && (
                                      <div className="mt-2 min-w-0 overflow-hidden rounded border border-amber-400/20 bg-amber-400/[0.04] p-2">
                                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-1">
                                          <span className="text-xs font-medium text-amber-100/75">身体档案（全身图使用）</span>
                                          <span className="text-[10px] text-amber-100/40">正脸近景不读取</span>
                                        </div>
                                        <p
                                          className="mt-1 line-clamp-2 break-words text-xs leading-5 text-gray-500 [overflow-wrap:anywhere]"
                                          title={formatCharacterBodyProfile(char.bodyProfile)}
                                        >
                                          {compactDisplayText(formatCharacterBodyProfile(char.bodyProfile), 110)}
                                        </p>
                                      </div>
                                    )}
                                    {/* 造型列表 */}
                                    {char.looks && char.looks.length > 0 && (
                                      <div className="mt-4 border-t border-amber-400/20 pt-4">
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                          <div>
                                            <div className="flex items-center gap-2 text-sm font-semibold text-amber-100">
                                              <Layers3 className="size-4 text-amber-300" />
                                              {char.name}的造型时间线
                                            </div>
                                            <p className="mt-1 text-[11px] text-amber-100/45">全部造型直接展开；按正脸与父级造型依次解锁生成</p>
                                            {char.timelineAudit && (
                                              <div className={`mt-1.5 inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${
                                                char.timelineAudit.status === 'complete'
                                                  ? 'border-emerald-300/25 bg-emerald-500/10 text-emerald-100/80'
                                                  : 'border-red-300/30 bg-red-500/10 text-red-100/85'
                                              }`}>
                                                {char.timelineAudit.status === 'complete' ? (
                                                  <CheckCircle2 className="size-3 shrink-0" />
                                                ) : (
                                                  <AlertCircle className="size-3 shrink-0" />
                                                )}
                                                <span className="truncate">
                                                  全文时间线已核验 {char.timelineAudit.coveredCount}/{char.timelineAudit.requiredCount}
                                                  {char.timelineAudit.fallbackAddedCount > 0
                                                    ? `，含 ${char.timelineAudit.fallbackAddedCount} 项保守补全`
                                                    : ''}
                                                </span>
                                              </div>
                                            )}
                                          </div>
                                          <div className="flex max-w-full flex-wrap justify-end gap-1 text-[10px]">
                                            <span className="rounded border border-emerald-300/35 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-100">P1 身份基础</span>
                                            <span className="rounded border border-sky-300/35 bg-sky-500/10 px-1.5 py-0.5 text-sky-100">P2 年龄时期</span>
                                            <span className="rounded border border-amber-300/35 bg-amber-500/10 px-1.5 py-0.5 text-amber-100">P3 场景换装</span>
                                            <span className="rounded border border-orange-300/35 bg-orange-500/10 px-1.5 py-0.5 text-orange-100">P4 身体状态</span>
                                            <span className="rounded border border-fuchsia-300/35 bg-fuchsia-500/10 px-1.5 py-0.5 text-fuchsia-100">P5 特殊/复合</span>
                                          </div>
                                        </div>
                                        <div className="mt-3 space-y-3">
                                          {char.looks.map((look: CharacterLook, lookIndex: number) => {
                                            const lookReference = getCharacterLookReference(char, look);
                                            const lookLocked = !lookReference.imageUrl;
                                            const fourViewLocked = !isFaceIdentityConfirmed || !look.imageUrl || Boolean(look.identityNeedsReview);
                                            const lookBodyProfileText = formatCharacterBodyProfile(look.bodyProfile || char.bodyProfile);
                                            const priorityStyle = getCharacterLookPriorityStyle(look);
                                            return (
                                            <div
                                              key={look.id || lookIndex}
                                              className={`character-look-card min-w-0 overflow-hidden rounded-md border p-3 transition-all duration-300 ${
                                                look.isGenerating
                                                  ? 'border-amber-300/65 bg-amber-500/10 shadow-[0_0_24px_rgba(251,191,36,0.12)] ring-1 ring-amber-300/20'
                                                  : priorityStyle.cardClass
                                              }`}
                                            >
                                              <div className="character-look-card-layout">
                                                <div className="character-look-card-details">
                                              <div className="mb-1 flex min-w-0 flex-wrap items-center justify-between gap-1">
                                                <div className="flex min-w-0 flex-wrap items-center gap-2 overflow-hidden">
                                                  <CompactBadge text={look.scene || '造型'} maxChars={16} variant="secondary" />
                                                  <CompactBadge text={look.changeType || '服装造型'} maxChars={10} className="border-amber-400/35 text-amber-200" />
                                                  <CompactBadge text={priorityStyle.label} maxChars={12} className={priorityStyle.badgeClass} />
                                                  {look.ageStage && (
                                                    <CompactBadge text={look.ageStage} maxChars={10} />
                                                  )}
                                                  {look.physicalState && look.physicalState !== '正常状态' && (
                                                    <CompactBadge text={look.physicalState} maxChars={10} className="border-red-400/35 text-red-200" />
                                                  )}
                                                  {look.transformationState && (
                                                    <CompactBadge text={look.transformationState} maxChars={10} className="border-fuchsia-400/35 text-fuchsia-200" />
                                                  )}
                                                  {look.identityNeedsReview && (
                                                    <CompactBadge text="需按新正脸重做" maxChars={12} className="border-red-400/40 text-red-200" />
                                                  )}
                                                  {look.fourViewIdentityNeedsReview && (
                                                    <CompactBadge text="四视图已过期" maxChars={10} className="border-orange-400/40 text-orange-200" />
                                                  )}
                                                  {look.isLifecycleFallback && (
                                                    <CompactBadge text="全文核验补齐" maxChars={10} className="border-cyan-300/35 bg-cyan-500/10 text-cyan-100" />
                                                  )}
                                                  {look.stage && (
                                                    <CompactBadge text={look.stage} maxChars={12} />
                                                  )}
                                                  <span className="max-w-[80px] truncate text-xs text-gray-500" title={normalizeDisplayText(look.mood || '自然')}>{compactDisplayText(look.mood || '自然', 10)}</span>
                                                </div>
                                                {look.isGenerating ? (
                                                  <div className="flex items-center gap-1.5">
                                                    <Button
                                                      size="sm"
                                                      variant="outline"
                                                      className="h-8 border-amber-300/55 bg-amber-400/15 px-3 text-xs font-semibold text-amber-100 opacity-100"
                                                      disabled
                                                      aria-live="polite"
                                                    >
                                                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                                                      造型生成中
                                                    </Button>
                                                    <Button
                                                      size="sm"
                                                      variant="ghost"
                                                      className="h-8 px-2 text-xs text-red-200 hover:bg-red-500/15 hover:text-red-100"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        cancelLookGeneration(char, look.id);
                                                      }}
                                                      title="停止当前页面等待"
                                                    >
                                                      <X className="mr-1 size-3.5" />
                                                      停止
                                                    </Button>
                                                  </div>
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
                                                  <div className="flex gap-1.5">
                                                    <Button
                                                      size="sm"
                                                      variant={lookLocked ? 'outline' : 'default'}
                                                      className={`h-8 px-3 text-xs font-semibold ${
                                                        lookLocked
                                                          ? 'border-amber-400/20 text-amber-100/45'
                                                          : 'border border-amber-200/70 bg-amber-400 text-black shadow-[0_0_16px_rgba(251,191,36,0.2)] hover:bg-amber-300'
                                                      }`}
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (isBatchAssetGenerating) {
                                                          toast.info('批量图片任务正在运行，请等待当前批量任务结束后再单独生成造型');
                                                          return;
                                                        }
                                                        void handleGenerateCharacterLookImage(char, look.id);
                                                      }}
                                                      disabled={Boolean(lookLocked || look.isGenerating)}
                                                      title={lookLocked
                                                        ? lookReference.missingMessage
                                                        : isBatchAssetGenerating
                                                          ? '批量图片任务正在运行'
                                                          : `图生图参考：${lookReference.label}`}
                                                    >
                                                      {lookLocked ? (
                                                        <>
                                                          <AlertCircle className="mr-1.5 size-3.5" />
                                                          待解锁
                                                        </>
                                                      ) : (
                                                        <>
                                                          <Sparkles className="mr-1.5 size-3.5" />
                                                          {look.imageUrl ? '重新生成造型' : '生成造型'}
                                                        </>
                                                      )}
                                                    </Button>
                                                    <Button
                                                      size="sm"
                                                      variant="outline"
                                                      className="h-8 px-2.5 text-xs"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleGenerateCharacterFourView(char, look.id);
                                                      }}
                                                      disabled={Boolean(fourViewLocked || look.isGeneratingFourView || isBatchAssetGenerating)}
                                                      title={look.identityNeedsReview
                                                        ? '该造型基于旧正脸，请先重新生成造型图'
                                                        : fourViewLocked
                                                          ? '需先确认正脸并生成该造型图'
                                                          : '以该造型图生成四视图'}
                                                    >
                                                      四视图
                                                    </Button>
                                                  </div>
                                                )}
                                              </div>
                                              {look.isGenerating && (
                                                <div
                                                  className="mb-2 rounded-md border border-amber-300/30 bg-black/30 px-3 py-2.5"
                                                  role="status"
                                                  aria-live="polite"
                                                >
                                                  <div className="flex items-center gap-2 text-xs font-medium text-amber-100">
                                                    <Loader2 className="size-4 shrink-0 animate-spin text-amber-200" />
                                                    <span className="min-w-0 break-words">
                                                      {look.generatingStatus || '请求已提交，正在生成造型图片...'}
                                                    </span>
                                                  </div>
                                                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-amber-950/70">
                                                    <div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-amber-500 via-yellow-200 to-amber-400" />
                                                  </div>
                                                </div>
                                              )}
                                              <div className={`mb-1.5 flex min-w-0 items-start gap-1.5 rounded px-2 py-1 text-[11px] ${
                                                lookLocked
                                                  ? 'bg-amber-500/10 text-amber-200/80'
                                                  : 'bg-emerald-500/10 text-emerald-200/80'
                                              }`}>
                                                {lookLocked ? (
                                                  <AlertCircle className="mt-0.5 size-3 shrink-0" />
                                                ) : (
                                                  <CheckCircle2 className="mt-0.5 size-3 shrink-0" />
                                                )}
                                                <span className="min-w-0 break-words">
                                                  {lookLocked
                                                    ? lookReference.missingMessage
                                                    : `图生图参考：${lookReference.label}${look.referenceReason ? `；${look.referenceReason}` : ''}`}
                                                </span>
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
                                                  className="group/desc mb-1 min-w-0 cursor-pointer"
                                                  onClick={() => {
                                                    setEditingLookKey(`${char.id}-${look.id}`);
                                                    setEditingLookDescription(look.description || '');
                                                  }}
                                                >
                                                  {look.description ? (
                                                    <p className="line-clamp-2 break-words text-xs leading-5 text-gray-600 [overflow-wrap:anywhere] dark:text-gray-400" title={normalizeDisplayText(look.description)}>
                                                      {compactDisplayText(look.description, 90)}
                                                    </p>
                                                  ) : (
                                                    <p className="text-xs text-gray-400 italic">暂无提示词，点击添加</p>
                                                  )}
                                                  <p className="text-xs text-gray-400 dark:text-gray-500 opacity-0 group-hover/desc:opacity-100 transition-opacity">
                                                    点击编辑提示词
                                                  </p>
                                                </div>
                                              )}
                                              {lookBodyProfileText && (
                                                <div className="mb-1.5 min-w-0 rounded bg-black/10 px-2 py-1.5 text-[11px] leading-4 text-amber-100/55 dark:bg-black/20">
                                                  <p className="line-clamp-2 break-words [overflow-wrap:anywhere]" title={lookBodyProfileText}>
                                                    <span className="font-medium text-amber-100/70">全身体态：</span>
                                                    {compactDisplayText(lookBodyProfileText, 100)}
                                                  </p>
                                                  <p className="mt-0.5 line-clamp-1 break-words [overflow-wrap:anywhere]" title={normalizeDisplayText(look.bodyChanges || '沿用人物身体档案')}>
                                                    <span className="font-medium text-amber-100/70">当前变化：</span>
                                                    {compactDisplayText(look.bodyChanges || '沿用人物身体档案', 70)}
                                                  </p>
                                                </div>
                                              )}
                                              <div className="min-w-0 space-y-0.5 text-xs text-gray-500">
                                                <div className="truncate" title={normalizeDisplayText(look.costume)}>服装：{compactDisplayText(look.costume || '待补充', 36)}</div>
                                                <div className="truncate" title={normalizeDisplayText(look.hairstyle)}>发型：{compactDisplayText(look.hairstyle || '待补充', 36)}</div>
                                                {look.accessories && look.accessories.length > 0 && (
                                                  <div className="truncate" title={normalizeDisplayText(look.accessories.join('、'))}>配饰：{compactDisplayText(look.accessories.join('、'), 36)}</div>
                                                )}
                                                <div className="truncate" title={normalizeDisplayText(look.makeup)}>化妆：{compactDisplayText(look.makeup || '淡妆', 36)}</div>
                                                {look.episodeNumbers && look.episodeNumbers.length > 0 && (
                                                  <div className="truncate" title={look.episodeNumbers.map(item => `第${item}集`).join('、')}>
                                                    集数：{look.episodeNumbers.map(item => `第${item}集`).join('、')}
                                                  </div>
                                                )}
                                                {look.sceneNames && look.sceneNames.length > 0 && (
                                                  <div className="truncate" title={normalizeDisplayText(look.sceneNames.join('、'))}>
                                                    场景：{compactDisplayText(look.sceneNames.join('、'), 36)}
                                                  </div>
                                                )}
                                              </div>
                                                </div>
                                                <div className="character-look-card-media">
                                              {/* 显示该造型的图片 */}
                                              {look.isGenerating ? (
                                                <div className="min-h-[340px] overflow-hidden rounded-md border border-amber-300/35 bg-black/40">
                                                  <AssetGenerationPlaceholder status={look.generatingStatus || '正在生成全身造型图'} />
                                                </div>
                                              ) : look.imageUrl ? (
                                                <div className="group/look-image relative flex min-h-[340px] items-center justify-center overflow-hidden rounded-md border border-amber-400/20 bg-black/25">
                                                  <img
                                                    src={getAssetThumbnailUrl(look.imageUrl, 720)}
                                                    alt={`${char.name} - ${look.scene || look.id}`}
                                                    loading="lazy"
                                                    decoding="async"
                                                    fetchPriority="low"
                                                    className="block max-h-[560px] w-full cursor-zoom-in object-contain"
                                                    onClick={() => openImagePreview(look.imageUrl!, `${char.name} - ${look.scene || look.id}`, 'character')}
                                                    onError={(event) => {
                                                      const image = event.currentTarget;
                                                      if (image.dataset.originalFallback === 'true') return;
                                                      image.dataset.originalFallback = 'true';
                                                      image.src = look.imageUrl!;
                                                    }}
                                                  />
                                                  {/* 操作按钮组 */}
                                                  <div className={`absolute right-2 top-2 flex gap-1 transition-opacity ${isAssetsConfirmed ? 'hidden' : 'opacity-0 group-hover/look-image:opacity-100'}`}>
                                                    <Button
                                                      size="icon"
                                                      variant="secondary"
                                                      className="h-8 w-8 bg-black/75 text-amber-100 hover:bg-black/90"
                                                      title="预览"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        openImagePreview(look.imageUrl!, `${char.name} - ${look.scene || look.id}`, 'character');
                                                      }}
                                                    >
                                                      <Eye className="size-3.5" />
                                                    </Button>
                                                    <Button
                                                      size="icon"
                                                      variant="secondary"
                                                      className="h-8 w-8 bg-black/75 text-amber-100 hover:bg-black/90"
                                                      title="下载"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        downloadImage(look.imageUrl!, `${char.name}_${look.scene || look.id}`);
                                                      }}
                                                    >
                                                      <Download className="size-3.5" />
                                                    </Button>
                                                    <Button
                                                      size="icon"
                                                      variant="destructive"
                                                      className="h-8 w-8"
                                                      title="删除"
                                                      disabled={isAssetsConfirmed || isGeneratingImage}
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (!isAssetsConfirmed) handleDeleteCharacterLookImage(char, look.id);
                                                      }}
                                                    >
                                                      <Trash2 className="size-3.5" />
                                                    </Button>
                                                  </div>
                                                  {look.isCustom && (
                                                    <Badge className="absolute bottom-0 left-0 text-[10px]" variant="secondary">
                                                      自
                                                    </Badge>
                                                  )}
                                                </div>
                                              ) : (
                                                <div className="flex min-h-[340px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-amber-400/30 bg-black/20 text-amber-100/40">
                                                  <ImagePlus className="size-9" />
                                                  <span className="text-xs">尚未生成造型图</span>
                                                </div>
                                              )}
                                              {look.generationError && !look.isGenerating && (
                                                <div className="mt-2">
                                                  <AssetGenerationFailure reason={look.generationError} />
                                                </div>
                                              )}
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
                                                  <div className="mb-1 flex items-center gap-2 text-xs font-medium text-gray-500">
                                                    <span>{char.name}的四视图</span>
                                                    {look.fourViewIdentityNeedsReview && (
                                                      <span className="text-orange-300">旧参考图，建议重新生成</span>
                                                    )}
                                                  </div>
                                                  <img
                                                    src={getAssetThumbnailUrl(look.fourViewImageUrl, 960)}
                                                    alt={`${char.name}的四视图`}
                                                    loading="lazy"
                                                    decoding="async"
                                                    fetchPriority="low"
                                                    className="w-full h-auto object-contain rounded max-h-64"
                                                    onClick={() => openImagePreview(look.fourViewImageUrl!, `${char.name}的四视图`, 'character')}
                                                    onError={(event) => {
                                                      const image = event.currentTarget;
                                                      if (image.dataset.originalFallback === 'true') return;
                                                      image.dataset.originalFallback = 'true';
                                                      image.src = look.fourViewImageUrl!;
                                                    }}
                                                  />
                                                  <div className={`absolute top-5 right-0 flex gap-0.5 transition-opacity ${isAssetsConfirmed ? 'hidden' : 'opacity-0 group-hover/four-view:opacity-100'}`}>
                                                    <Button
                                                      size="icon"
                                                      variant="secondary"
                                                      className="h-4 w-4 bg-white/90"
                                                      title="预览"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        openImagePreview(look.fourViewImageUrl!, `${char.name}的四视图`, 'character');
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
                                                        downloadImage(look.fourViewImageUrl!, `${char.name}的四视图`);
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
                                                        updateLookById(look.id, {
                                                          fourViewImageUrl: undefined,
                                                          fourViewError: undefined,
                                                          fourViewIdentitySourceUrl: undefined,
                                                          fourViewLookSourceUrl: undefined,
                                                          fourViewIdentityNeedsReview: false,
                                                        }, char);
                                                      }}
                                                    >
                                                      <Trash2 className="w-2 h-2" />
                                                    </Button>
                                                  </div>
                                                </div>
                                              ) : null}
                                              {look.fourViewError && !look.isGeneratingFourView && (
                                                <div className="mt-2">
                                                  <AssetGenerationFailure reason={look.fourViewError} />
                                                </div>
                                              )}
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
                                                    disabled={!isFaceIdentityConfirmed}
                                                    title={isFaceIdentityConfirmed ? '上传本地造型图片' : '需先确认人物正脸身份基准'}
                                                  >
                                                    <ImagePlus className="w-3 h-3 mr-1" />
                                                    上传
                                                  </Button>
                                                </div>
                                              )}
                                                </div>
                                              </div>
                                            </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}
                                    {/* 服装信息（保留向后兼容） */}
                                    {char.costume && char.costume.length > 0 && char.looks === undefined && (
                                      <div className="mt-1">
                                        <div className="flex min-w-0 flex-wrap items-center gap-1">
                                          <span className="text-xs text-gray-500 shrink-0">服装：</span>
                                          {char.costume.map((c: string, i: number) => (
                                            <CompactBadge key={`char-${char.id}-costume-${i}`} text={c} maxChars={16} className="bg-purple-50 dark:bg-purple-900/20" />
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {/* 性格特点 */}
                                    {char.personality && char.personality.length > 0 && (
                                      <div className="mt-2 flex min-w-0 flex-wrap gap-1">
                                        {char.personality.slice(0, 3).map((p, i) => (
                                          <CompactBadge key={`char-${char.id}-personality-${i}`} text={p} maxChars={12} variant="secondary" />
                                        ))}
                                      </div>
                                    )}
                                    {/* 背景故事 */}
                                    {char.background && (
                                      <p className="mt-2 line-clamp-2 break-words text-xs text-gray-500 [overflow-wrap:anywhere]" title={normalizeDisplayText(char.background)}>
                                        <span className="font-medium text-gray-600 dark:text-gray-400">背景：</span>
                                        {compactDisplayText(char.background, 90)}
                                      </p>
                                    )}
                                    {/* 人物弧光 */}
                                    {char.arc && (
                                      <p className="mt-2 line-clamp-2 break-words text-xs text-gray-500 [overflow-wrap:anywhere]" title={normalizeDisplayText(char.arc)}>
                                        <span className="font-medium text-gray-600 dark:text-gray-400">成长线：</span>
                                        {compactDisplayText(char.arc, 90)}
                                      </p>
                                    )}
                                    {/* 服装细节 */}
                                    {char.costumeDetails && (
                                      <div className="mt-2 min-w-0 space-y-1 overflow-hidden rounded bg-purple-50 p-2 text-xs text-gray-600 dark:bg-purple-900/20 dark:text-gray-400">
                                        <div className="font-medium text-gray-500 dark:text-gray-400">服装细节：</div>
                                        {char.costumeDetails.mainOutfit && (
                                          <div className="truncate" title={normalizeDisplayText(char.costumeDetails.mainOutfit)}>主服装：{compactDisplayText(char.costumeDetails.mainOutfit, 34)}</div>
                                        )}
                                        {char.costumeDetails.colorScheme && (
                                          <div className="truncate" title={normalizeDisplayText(char.costumeDetails.colorScheme)}>配色：{compactDisplayText(char.costumeDetails.colorScheme, 34)}</div>
                                        )}
                                        {char.costumeDetails.accessories && char.costumeDetails.accessories.length > 0 && (
                                          <div className="truncate" title={normalizeDisplayText(char.costumeDetails.accessories.join('、'))}>配饰：{compactDisplayText(char.costumeDetails.accessories.join('、'), 34)}</div>
                                        )}
                                        {char.costumeDetails.styleNotes && (
                                          <div className="truncate" title={normalizeDisplayText(char.costumeDetails.styleNotes)}>风格：{compactDisplayText(char.costumeDetails.styleNotes, 34)}</div>
                                        )}
                                      </div>
                                    )}
                                    {/* 关键关系 */}
                                    {char.keyRelationships && char.keyRelationships.length > 0 && (
                                      <div className="mt-2">
                                        <p className="text-xs text-gray-500 mb-1">关键关系：</p>
                                        <div className="flex min-w-0 flex-wrap gap-1">
                                          {char.keyRelationships.slice(0, 3).map((rel, i) => (
                                            <CompactBadge key={`char-${char.id}-rel-${i}`} text={`${rel.target} (${rel.relationship})`} maxChars={24} />
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
                                        <div className="flex min-w-0 flex-wrap gap-1">
                                          {char.keyScenes.slice(0, 3).map((scene, i) => (
                                            <CompactBadge key={`char-${char.id}-scene-${i}`} text={scene} maxChars={18} variant="secondary" />
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
                                        <div className="flex min-w-0 flex-wrap gap-1">
                                          {char.props.slice(0, 3).map((prop, i) => (
                                            <CompactBadge key={`char-${char.id}-prop-${i}`} text={prop} maxChars={16} />
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
                            }}
                          />
                        )}
                        <div className="text-center mt-2">
                          <Button variant="ghost" size="sm" className="text-xs text-gray-500" onClick={() => toggleSection('characters')}>
                            {expandedSections.characters ? '收起' : '展开全部'} {characterBatchInfo?.characterMarkers?.length || charactersData?.totalCharacters || 0} 个人物
                            <ChevronDown className={`w-3 h-3 ml-1 transition-transform ${expandedSections.characters ? 'rotate-180' : ''}`} />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {canShowExtractionResults && (characterVoiceData || effectiveExtractionStatus.voices !== 'pending') && (
                    <CharacterVoiceLibrary
                      data={characterVoiceData}
                      library={voiceLibrary}
                      status={effectiveExtractionStatus.voices}
                      disabled={isProcessing}
                      libraryLoading={voiceLibraryLoading}
                      onRetry={() => void retryExtraction('voices')}
                      onBind={bindCharacterVoice}
                      onRefreshLibrary={() => syncVoiceLibrary(true)}
                      onUploadVoice={uploadVoiceToLibrary}
                      onDeleteVoice={deleteVoiceFromLibrary}
                    />
                  )}

                  {/* Props */}
	                  {canShowExtractionResults && propsData && (
                    <Card>
                      <CardHeader>
                        <div className="flex items-center justify-between gap-3">
                          <CardTitle className="flex items-center gap-2 text-lg">
                            <Package className="w-5 h-5 text-orange-500" />
                            道具列表
                            {(() => {
                              const propsForCount = ((propBatchInfo?.allProps?.length ?? 0) > 0 ? propBatchInfo?.allProps : propsData.props) || [];
                              const mainPropCount = new Set(propsForCount.map((prop: Prop) => getPropMainPropName(prop))).size;
                              const stateCount = propsForCount.reduce((total: number, prop: Prop) => total + getPropStateCount(prop), 0);
                              return (
                                <Badge variant="secondary">
                                  {mainPropCount || propsData.totalMainProps || propsData.totalProps || 0} 个物品 / {stateCount || propsData.totalPropStates || propsForCount.length || 0} 个状态
                                </Badge>
                              );
                            })()}
                          </CardTitle>
                          <div className="flex shrink-0 flex-wrap justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => exportAssetListPackage('prop')}
                              disabled={exportingAssetListType !== null || getBatchAssetList('prop').length === 0}
                              title="导出道具 Excel、缩略图和全部原图 ZIP"
                            >
                              {exportingAssetListType === 'prop' ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              ) : (
                                <Download className="w-4 h-4 mr-2" />
                              )}
                              导出完整素材 ZIP
                            </Button>
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
                        </div>
                        {batchAssetGeneration.type === 'prop' && (
                          <CardDescription>
                            正在生成：{batchAssetGeneration.currentName || '准备中'}
                          </CardDescription>
                        )}
                      </CardHeader>
                      <CardContent>
                        {/* 道具整体提取进度 */}
                        {propBatchInfo && (
                          <div className="mb-4 p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-orange-700 dark:text-orange-400">
                                {extractionStatus.props === 'error' ? (
                                  '道具提取中断，请点击重新提取'
                                ) : extractionStatus.props === 'loading' ? (
                                  <span className="flex items-center gap-2">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    正在通读全文并自动提取全部道具...
                                  </span>
                                ) : propBatchInfo.hasMore ? (
                                  '道具正在自动提取全部内容'
                                ) : (
                                  '道具已全部提取完成'
                                )}
                              </span>
                              <span className="text-sm text-orange-600 dark:text-orange-300">
                                {Math.round((propBatchInfo.currentBatch / propBatchInfo.totalBatches) * 100)}%
                              </span>
                            </div>
                            <div className="w-full bg-orange-200 dark:bg-orange-800 rounded-full h-2">
                              <div
                                className={`bg-orange-600 h-2 rounded-full transition-all duration-300 ${extractionStatus.props === 'loading' ? 'animate-pulse' : ''}`}
                                style={{ width: `${(propBatchInfo.currentBatch / propBatchInfo.totalBatches) * 100}%` }}
                              />
                            </div>
                            <div className="text-xs text-gray-600 dark:text-gray-400">
                              已提取 {new Set((propBatchInfo.allProps || []).map((prop: Prop) => getPropMainPropName(prop))).size} / {propBatchInfo.propMarkers?.length || 0} 个物品实体，
                              形成 {propBatchInfo.allProps?.length || 0} 个独立状态制作项
                            </div>
                          </div>
                        )}

                        {propRenderItems.length === 0 ? (
                          <div className="py-8 text-center text-gray-400">
                            <Package className="mx-auto mb-2 h-12 w-12 opacity-50" />
                            <p className="text-sm">暂无道具数据</p>
                          </div>
                        ) : (
                          <OnDemandCollection
                            items={propRenderItems}
                            expanded={expandedSections.props}
                            collapsedCount={3}
                            batchSize={6}
                            className="grid grid-cols-1 gap-3 overflow-x-hidden transition-all duration-300"
                            collapsedClassName="max-h-[520px] overflow-y-hidden"
                            expandedClassName="max-h-none overflow-y-visible"
                            itemClassName="grid grid-cols-1 gap-3 [content-visibility:auto] [contain-intrinsic-size:760px]"
                            getKey={item => `prop-${item.prop.id}-${item.prop.name}-${item.sourceIndex}`}
                            renderItem={(renderItem) => {
                            const {
                              prop,
                              sourceIndex: index,
                              mainPropName,
                              shouldShowMainPropHeader,
                              siblingStateCount,
                              siblingEpisodeNumbers,
                            } = renderItem;
                            const assetData = getAssetImages('prop', prop.id, prop.name);
                            const images = assetData?.images || [];
                            const generationAssetId = `prop-${prop.name}`;
                            const generatingImage = images.find(img => img.isGenerating);
                            const generationStatus = assetGenerationStatuses[generationAssetId] || generatingImage?.generatingStatus || '';
                            const isGenerating = Boolean(generationStatus || generatingImage);
                            const completedImageCount = images.filter(img => Boolean(img.imageUrl) && !img.isGenerating).length;
                            const currentAssetId = assetData?.assetId || `prop-${prop.name}`;
                            const referencePropAsset = prop.referencePropName
                              ? getAssetImages('prop', prop.referencePropName)
                              : undefined;
                            const referencePropImage = referencePropAsset?.images.find(image => Boolean(image.imageUrl) && !image.isGenerating);
                            const referencePropIsGenerating = referencePropAsset?.images.some(image => image.isGenerating);
                            const isAssetsConfirmed = stepConfirmed.assets; // 素材是否已确认

                            return (
                              <Fragment>
                              {shouldShowMainPropHeader && (
                                <div className="col-span-full rounded border border-amber-400/25 bg-amber-500/10 px-3 py-2">
                                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                                    <div className="min-w-0">
                                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                                        <span className="text-sm font-semibold text-amber-100" title={normalizeDisplayText(mainPropName)}>
                                          {compactDisplayText(mainPropName, 34)}
                                        </span>
                                        <Badge variant="outline" className="border-amber-400/35 text-amber-100">
                                          同一物品
                                        </Badge>
                                      </div>
                                      <p className="mt-1 text-xs text-amber-100/65">
                                        下含 {siblingStateCount} 个状态
                                        {siblingEpisodeNumbers.length > 0 && `，关联 ${siblingEpisodeNumbers.slice(0, 5).map(item => `第${item}集`).join('、')}${siblingEpisodeNumbers.length > 5 ? ` 等${siblingEpisodeNumbers.length}集` : ''}`}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              )}
                              <div key={`prop-${prop.name}-${index}`} className={`min-w-0 overflow-hidden rounded-md border border-amber-400/20 bg-black/15 p-3 ${isAssetsConfirmed ? 'opacity-75' : ''}`}>
                                <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(320px,44%)_minmax(0,1fr)] lg:items-start">
                                <div className="min-w-0 space-y-2">
                                {/* 道具图片区域 - 主图叠放选择 */}
                                <AssetImageStack
                                  images={images}
                                  name={prop.name}
                                  type="prop"
                                  generationStatus={generationStatus}
                                  failureReason={assetGenerationErrors[generationAssetId]}
                                  isGenerating={isGenerating}
                                  isAssetsConfirmed={isAssetsConfirmed}
                                  onOpenChooser={() => setAssetImageChooserTarget({ assetId: currentAssetId, type: 'prop', name: prop.name })}
                                  onPreview={image => openImagePreview(image.imageUrl, prop.name, 'prop')}
                                  onGenerateFromImage={image => generateImageFromImage('prop', prop, image.imageUrl)}
                                  onDownload={image => downloadImage(image.imageUrl, prop.name)}
                                  onRemove={image => removeSelectedImage(currentAssetId, image.imageId)}
                                />
                                <div className="flex min-h-8 items-center justify-between gap-2">
                                  <span className="text-xs text-amber-100/55">
                                    {isGenerating ? `处理中 · ${completedImageCount}/${MAX_IMAGES_PER_ASSET} 张` : `${completedImageCount}/${MAX_IMAGES_PER_ASSET} 张`}
                                  </span>
                                  {!isGenerating && !isAssetsConfirmed && (
                                    <div className="flex items-center gap-1 rounded-md border border-amber-400/15 bg-black/20 p-1">
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7 min-w-0 p-0 text-amber-100/80 hover:bg-amber-400/15 hover:text-amber-50"
                                        onClick={() => generateAssetImage('prop', prop)}
                                        title="AI生成图片"
                                        aria-label="生成道具图片"
                                      >
                                        <Sparkles className="size-3.5" />
                                      </Button>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7 min-w-0 p-0 text-amber-100/80 hover:bg-amber-400/15 hover:text-amber-50"
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
                                        aria-label="上传道具图片"
                                      >
                                        <ImagePlus className="size-3.5" />
                                      </Button>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7 min-w-0 p-0 text-amber-100/80 hover:bg-amber-400/15 hover:text-amber-50"
                                        onClick={() => openImageLibrary('prop', prop.id, prop.name)}
                                        title="从图片库选择"
                                        aria-label="从图片库选择道具图片"
                                      >
                                        <FolderOpen className="size-3.5" />
                                      </Button>
                                    </div>
                                  )}
                                </div>
                                </div>
                                <div className="min-w-0 space-y-3">
                                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 overflow-hidden">
                                  <span className="min-w-0 max-w-full truncate text-sm font-medium" title={normalizeDisplayText(prop.name)}>
                                    {compactDisplayText(prop.name, 24)}
                                  </span>
                                  <CompactBadge text={prop.type} maxChars={12} />
                                  {prop.importance && (
                                    <CompactBadge text={prop.importance} maxChars={8} variant="default" />
                                  )}
                                  {prop.stateLabel && (
                                    <CompactBadge text={prop.stateLabel} maxChars={10} variant="secondary" />
                                  )}
                                  {prop.isStateUnit && prop.totalStates && prop.totalStates > 1 && (
                                    <CompactBadge text={`状态 ${prop.stateSequence || 1}/${prop.totalStates}`} maxChars={10} variant="outline" />
                                  )}
                                  {!prop.isStateUnit && Array.isArray(prop.stateVariants) && prop.stateVariants.length > 1 && (
                                    <CompactBadge text={`${prop.stateVariants.length}种状态`} maxChars={8} variant="secondary" />
                                  )}
                                </div>
                                <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-amber-100/75">
                                  <span className="shrink-0">关联集数：</span>
                                  <span className="min-w-0 truncate" title={normalizeDisplayText(formatPropEpisodeText(prop))}>
                                    {compactDisplayText(formatPropEpisodeText(prop), 42)}
                                  </span>
                                </div>
                                {Array.isArray(prop.occurrences) && prop.occurrences.length > 0 && (
                                  <div className="flex min-w-0 flex-wrap gap-1">
                                    {prop.occurrences.slice(0, 2).map((occurrence, occurrenceIndex) => (
                                      <CompactBadge
                                        key={`prop-${prop.id}-occurrence-${occurrenceIndex}`}
                                        text={`${occurrence.episodeLabel || '未标注'} ${occurrence.sceneName || occurrence.heading || prop.name}`}
                                        maxChars={28}
                                        variant="outline"
                                      />
                                    ))}
                                    {prop.occurrences.length > 2 && (
                                      <span className="text-xs text-gray-400">+{prop.occurrences.length - 2}</span>
                                    )}
                                  </div>
                                )}
                                {prop.description && (
                                  <p className="line-clamp-3 break-words text-xs leading-5 text-gray-600 [overflow-wrap:anywhere] dark:text-gray-400" title={normalizeDisplayText(prop.description)}>
                                    {compactDisplayText(prop.description, 150)}
                                  </p>
                                )}
                                {prop.function && (
                                  <p className="truncate text-xs text-gray-500" title={normalizeDisplayText(prop.function)}>功能：{compactDisplayText(prop.function, 42)}</p>
                                )}
                                {prop.owner && (
                                  <p className="truncate text-xs text-gray-500" title={normalizeDisplayText(prop.owner)}>归属：{compactDisplayText(prop.owner, 42)}</p>
                                )}
                                {prop.isStateUnit ? (
                                  <div className="space-y-1.5 rounded border border-amber-400/15 bg-amber-500/5 px-2.5 py-2 text-xs text-amber-100/75">
                                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                      <CompactBadge
                                        text={prop.referencePropName ? '图生图状态' : '基准文生图'}
                                        maxChars={12}
                                        variant={prop.referencePropName ? 'secondary' : 'outline'}
                                      />
                                      {prop.referencePropName && (
                                        <span
                                          className="min-w-0 truncate"
                                          title={`图生图参考：${normalizeDisplayText(prop.referencePropName)}`}
                                        >
                                          参考：{compactDisplayText(prop.referencePropName, 28)} · {referencePropImage ? '已关联' : referencePropIsGenerating ? '生成中' : '待生成'}
                                        </span>
                                      )}
                                    </div>
                                    {prop.stateVisualChange && prop.stateVisualChange !== '基准状态' && (
                                      <p className="line-clamp-2 break-words leading-5" title={normalizeDisplayText(prop.stateVisualChange)}>
                                        状态变化：{compactDisplayText(prop.stateVisualChange, 90)}
                                      </p>
                                    )}
                                    {prop.stateTransitionEvent && prop.stateTransitionEvent !== '基准状态' && (
                                      <p className="line-clamp-2 break-words leading-5" title={normalizeDisplayText(prop.stateTransitionEvent)}>
                                        形成原因：{compactDisplayText(prop.stateTransitionEvent, 90)}
                                      </p>
                                    )}
                                    {prop.stateNarrativeFunction && (
                                      <p className="line-clamp-2 break-words leading-5 text-amber-100/85" title={normalizeDisplayText(prop.stateNarrativeFunction)}>
                                        剧情作用：{compactDisplayText(prop.stateNarrativeFunction, 100)}
                                      </p>
                                    )}
                                    {prop.stateEvidence && (
                                      <p className="line-clamp-2 break-words text-amber-100/55" title={normalizeDisplayText(prop.stateEvidence)}>
                                        剧本依据：{compactDisplayText(prop.stateEvidence, 90)}
                                      </p>
                                    )}
                                  </div>
                                ) : Array.isArray(prop.stateVariants) && prop.stateVariants.length > 0 && (
                                  <div className="flex min-w-0 flex-wrap gap-1">
                                    {prop.stateVariants.slice(0, 3).map((state, i) => (
                                      <CompactBadge
                                        key={`prop-${prop.id}-state-${state.id || i}`}
                                        text={`${state.stateName || state.stage || `状态${i + 1}`}${state.imageMode === 'image-to-image' ? ' · 图生图' : ''}`}
                                        maxChars={18}
                                        variant="secondary"
                                      />
                                    ))}
                                    {prop.stateVariants.length > 3 && (
                                      <span className="text-xs text-gray-400">+{prop.stateVariants.length - 3}</span>
                                    )}
                                  </div>
                                )}
                                {!prop.isStateUnit && Array.isArray(prop.stateVariants) && prop.stateVariants.some(state => state.referenceFromStateId) && (
                                  <p className="truncate text-xs text-amber-200/70">
                                    后续状态会参考前一状态图片生成，保持同一道具一致性
                                  </p>
                                )}
                                {prop.appearanceScenes && prop.appearanceScenes.length > 0 && (
                                  <div className="flex min-w-0 flex-wrap gap-1">
                                    {prop.appearanceScenes.slice(0, 2).map((scene: string, i: number) => (
                                      <CompactBadge key={`prop-${prop.id}-scene-${i}`} text={scene} maxChars={20} variant="secondary" />
                                    ))}
                                    {prop.appearanceScenes.length > 2 && (
                                      <span className="text-xs text-gray-400">+{prop.appearanceScenes.length - 2}</span>
                                    )}
                                  </div>
                                )}
                                </div>
                                </div>
                              </div>
                              </Fragment>
                            );
                            }}
                          />
                        )}
                        <div className="text-center mt-2">
                          <Button variant="ghost" size="sm" className="text-xs text-gray-500" onClick={() => toggleSection('props')}>
                            {expandedSections.props ? '收起' : '展开全部'} {new Set((((propBatchInfo?.allProps?.length ?? 0) > 0 ? propBatchInfo?.allProps : propsData?.props) || []).map((prop: Prop) => getPropMainPropName(prop))).size} 个物品 / {((propBatchInfo?.allProps?.length ?? 0) > 0 ? propBatchInfo?.allProps : propsData?.props)?.length || 0} 个状态
                            <ChevronDown className={`w-3 h-3 ml-1 transition-transform ${expandedSections.props ? 'rotate-180' : ''}`} />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Empty State */}
	                  {!canShowExtractionResults ? (
	                    <Card>
	                      <CardContent className="flex items-center justify-center h-64">
	                        <div className="max-w-md text-center text-gray-500">
	                          <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
	                          <p className="font-medium text-amber-100">
	                            {!executionScriptReady ? '请先拉执行剧本' : '请先确认创作圣经'}
	                          </p>
	                          <p className="mt-2 text-sm">
	                            {!executionScriptReady
	                              ? '新流程会先用 DeepSeek 生成执行剧本，再进入创作圣经确认。'
	                              : '确认创作圣经后，系统会按该方向提取场景、人物、人物音色、道具和大纲。'}
	                          </p>
	                        </div>
	                      </CardContent>
	                    </Card>
	                  ) : !scenesData && !charactersData && !propsData && (
	                    <Card>
                      <CardContent className="flex items-center justify-center h-64">
                        <div className="text-center text-gray-500">
                          <Sparkles className="w-16 h-16 mx-auto mb-4 opacity-50" />
                          <p>上传文件后将自动提取场景、人物、人物音色、道具和大纲</p>
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
                                <span className="font-medium">第 {task.chapterNumber} 集</span>
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
                          正在并行生成文字分镜（最多 4 集）...
                        </>
                      ) : batchInfo.active ? (
                        <>
                          <ArrowRightCircle className="w-4 h-4 mr-2" />
                          继续生成第 {batchInfo.completedBatches + 1}/{batchInfo.totalBatches} 批（第 {batchInfo.completedBatches * batchInfo.batchSize + 1}-{Math.min((batchInfo.completedBatches + 1) * batchInfo.batchSize, outline?.chapters?.length || 0)} 集）
                        </>
                      ) : (
                        <>
                          <Film className="w-4 h-4 mr-2" />
                          {(() => {
                            const totalChapters = outline?.chapters?.length || 0;
                            const successCount = Object.values(chapterStoryboards).filter(cs => cs.status === 'success' && !!cs.storyboard?.shots?.length).length;
                            if (successCount > 0 && successCount < totalChapters) {
                              return `继续生成未完成分集文字分镜（已完成 ${successCount}/${totalChapters}）`;
                            }
                            if (successCount >= totalChapters && totalChapters > 0) {
                              return '全部分集文字分镜已生成';
                            }
                            return '一键并行生成所有分集文字分镜';
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
                              <span className="text-sm">{getCanonicalEpisodeTitle(cs.chapterNumber)}</span>
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
                              <CardTitle>{getCanonicalEpisodeTitle(cs.chapterNumber)}</CardTitle>
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
                                    第 {cs.chapterNumber} 集文字分镜已收起
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
                                    第 {cs.chapterNumber} 集分镜生成失败
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
                            <p>请先在“提取结果”标签页确认大纲和分集选择</p>
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
                              <CardTitle>{getCanonicalEpisodeTitle(cs.chapterNumber)}</CardTitle>
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
                                const chapterReferences = getChapterAssetReferences(cs);
                                const missingReferences = chapterReferences.filter(reference => !reference.imageUrl);
                                const hasAnyAssets = assets.characters.length > 0 || assets.scenes.length > 0 || assets.props.length > 0;

                                return (
                                  <div className="space-y-3 pl-8">
                                    {chapterReferences.length > 0 && (
                                      <div className={`rounded-md border px-3 py-2 text-xs ${
                                        missingReferences.length === 0
                                          ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
                                          : 'border-amber-400/30 bg-amber-500/10 text-amber-100/80'
                                      }`}>
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <span className="font-medium">第 {cs.chapterNumber} 集素材关联校验</span>
                                          <span>
                                            已匹配 {chapterReferences.length - missingReferences.length}/{chapterReferences.length} 项
                                          </span>
                                        </div>
                                        {missingReferences.length > 0 && (
                                          <p className="mt-1 break-words">
                                            尚无图片：{missingReferences.slice(0, 6).map(reference => reference.label).join('、')}
                                            {missingReferences.length > 6 ? ` 等 ${missingReferences.length} 项` : ''}
                                          </p>
                                        )}
                                      </div>
                                    )}
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
                                            const assetData = getAssetImages('character', char.id, char.name);
                                            const images = assetData?.images || [];
                                            const currentAssetId = assetData?.assetId || `character-${char.id}`;
                                            const linkedCharacterReferences = chapterReferences.filter(reference => (
                                              reference.type === 'character' &&
                                              normalizeAssetIdentity(reference.entityName) === normalizeAssetIdentity(char.name)
                                            ));

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
                                                <div className="flex gap-2 flex-wrap">
                                                  {linkedCharacterReferences.length > 0 ? (
                                                    linkedCharacterReferences.map(reference => (
                                                      <div key={`character-reference-${reference.entityName}-${reference.variantId || reference.label}`} className="min-w-[132px] rounded border border-amber-400/20 bg-black/10 p-1.5">
                                                        <div className="flex items-center gap-2">
                                                          {reference.imageUrl ? (
                                                            <img
                                                              src={getAssetThumbnailUrl(reference.imageUrl, 180, 66)}
                                                              alt={reference.label}
                                                              loading="lazy"
                                                              decoding="async"
                                                              className="h-10 w-10 shrink-0 cursor-pointer rounded object-cover hover:opacity-80"
                                                              onClick={() => openImagePreview(reference.imageUrl, reference.label, 'character')}
                                                            />
                                                          ) : (
                                                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-dashed border-amber-400/30 text-amber-200/45">
                                                              <ImageIcon className="size-4" />
                                                            </div>
                                                          )}
                                                          <div className="min-w-0">
                                                            <p className="max-w-[150px] truncate text-[11px]" title={reference.label}>{reference.label}</p>
                                                            <p className={`text-[10px] ${reference.imageUrl ? 'text-emerald-400' : 'text-orange-400'}`}>
                                                              {reference.imageUrl ? '已关联本集造型图' : '本集造型图待生成'}
                                                            </p>
                                                          </div>
                                                        </div>
                                                      </div>
                                                    ))
                                                  ) : images.length > 0 ? (
                                                    images.map((img: any, idx: number) => (
                                                      img.imageUrl ? (
                                                        <div key={`img-${img.imageId}-${idx}`} className="relative group">
                                                          <img
                                                            src={getAssetThumbnailUrl(img.imageUrl, 180, 66)}
                                                            alt={char.name}
                                                            loading="lazy"
                                                            decoding="async"
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
                                            const assetData = getAssetImages('scene', scene.id, scene.name);
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
                                                            src={getAssetThumbnailUrl(img.imageUrl, 180, 66)}
                                                            alt={scene.name}
                                                            loading="lazy"
                                                            decoding="async"
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
                                            const assetData = getAssetImages('prop', prop.id, prop.name);
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
                                                            src={getAssetThumbnailUrl(img.imageUrl, 180, 66)}
                                                            alt={prop.name}
                                                            loading="lazy"
                                                            decoding="async"
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
                                        onClick={() => {
                                          if (missingReferences.length > 0) {
                                            toast.warning(`第 ${cs.chapterNumber} 集还有 ${missingReferences.length} 项素材图片未生成`, {
                                              description: '仍可继续，后续会使用已关联图片和文字描述；建议先补齐关键人物造型、主场景和关键道具。',
                                            });
                                          }
                                          confirmChapterAssets(cs.chapterNumber);
                                        }}
                                        title={missingReferences.length > 0 ? `还有 ${missingReferences.length} 项图片未生成` : '本集素材已全部关联'}
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
                      设置故事版面板描述的画面比例、风格和光影效果（全局设置，应用于所有分集）
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
                                  <Badge variant="secondary">第 {cs.chapterNumber} 集</Badge>
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
                                  <p className="text-yellow-700 dark:text-yellow-400 text-sm mb-2">该分集没有分镜数据</p>
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
                                      故事板分组（{(cs.promptGroups?.length ?? 0)}组 · 按连续镜头实际时长分组 · 单组不超过15秒）
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
                                              {formatStoryboardDurationSeconds(getPromptGroupDurationSeconds(cs, pg))}秒
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
                                                      creationBible: getCreationBiblePayload(),
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
                                          <label className="block text-xs font-medium text-gray-500 mb-1">连贯故事版面板描述</label>
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
                                                        creationBible: getCreationBiblePayload(),
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
                                                          creationBible: getCreationBiblePayload(),
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
                                                          creationBible: getCreationBiblePayload(),
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
                                                        creationBible: getCreationBiblePayload(),
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
                                    toast.success(`第 ${cs.chapterNumber} 集故事版面板描述已确认`);
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
                                      此操作将清空当前分集的故事版面板描述数据并重新生成。已生成的视频不会受影响。此操作不可撤销。
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
                                        toast.info(`正在重新生成第 ${cs.chapterNumber} 集故事版面板描述...`);

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
                                              chapterNumber: cs.chapterNumber,
                                              creationBible: getCreationBiblePayload(),
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
                                                promptsConfirmed: false,
                                                // 分组边界已变化，旧负数索引的视频不能继续挂到同序号的新分组。
                                                shotVideos: (prev[cs.chapterNumber].shotVideos || []).filter(shotVideo => shotVideo.shotNumber >= 0),
                                              }
                                            }));
                                            toast.success(`第 ${cs.chapterNumber} 集故事版面板描述重新生成成功`);
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
                                toast.info(`正在生成第 ${cs.chapterNumber} 集故事版面板描述...`);
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
                                      chapterNumber: cs.chapterNumber,
                                      creationBible: getCreationBiblePayload(),
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
                                        promptsConfirmed: false,
                                        shotVideos: (prev[cs.chapterNumber].shotVideos || []).filter(shotVideo => shotVideo.shotNumber >= 0),
                                      }
                                    }));
                                    toast.success(`第 ${cs.chapterNumber} 集故事版面板描述生成成功`);
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
                                        {formatStoryboardDurationSeconds(getPromptGroupDurationSeconds(cs, pg))}秒
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
                                              creationBible: getCreationBiblePayload(),
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
                                          src={getAssetThumbnailUrl(pg.storyboardImageUrl, 1100, 74)}
                                          alt={`故事板第${pg.groupIndex}组`}
                                          loading="lazy"
                                          decoding="async"
                                          fetchPriority="low"
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
                                                  creationBible: getCreationBiblePayload(),
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
                                                        creationBible: getCreationBiblePayload(),
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
                                                        creationBible: getCreationBiblePayload(),
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
                                                      creationBible: getCreationBiblePayload(),
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
                                  <CardTitle className="text-base">{getCanonicalEpisodeTitle(cs.chapterNumber)}</CardTitle>
                                  <CardDescription>
                                    按连续镜头实际时长分组生成视频，单组不超过15秒，并使用故事版提示词、故事版总控图和最多9张关联素材图
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
                                            <Badge variant="outline">{formatStoryboardDurationSeconds(getPromptGroupDurationSeconds(cs, pg))}秒</Badge>
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
                                                  <img
                                                    src={getAssetThumbnailUrl(reference.url, 180, 66)}
                                                    alt={reference.name}
                                                    loading="lazy"
                                                    decoding="async"
                                                    className="h-full w-full object-cover"
                                                  />
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
                                                    <Button
                                                      size="sm"
                                                      variant="secondary"
                                                      className="h-7"
                                                      title="保存视频到下载目录"
                                                      onClick={() => downloadVideo(video.videoUrl, `第${cs.chapterNumber}集_第${pg.groupIndex}组视频`)}
                                                    >
                                                      <Download className="w-3 h-3" />
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
                                <CardTitle className="text-base">第 {cs.chapterNumber} 集</CardTitle>
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
                                      <AlertDialogTitle>确认清空本集内容？</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        此操作将清空第 {cs.chapterNumber} 集的所有视频和提示词数据，您可以重新生成故事版面板描述。此操作不可撤销。
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
                                          toast.success(`第 ${cs.chapterNumber} 集内容已清空`);
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
                                                  if (shotVideoPayload.voiceResolution.missingCharacters.length > 0) {
                                                    toast.error(`请先为以下说话人物捆绑音色：${shotVideoPayload.voiceResolution.missingCharacters.join('、')}`);
                                                    setActiveTab('extraction');
                                                    return;
                                                  }
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
                                                        speakingCharacters: shotVideoPayload.voiceResolution.speakingCharacters,
                                                        voiceAssignments: shotVideoPayload.voiceResolution.assignments,
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
                                                    toast.error(error instanceof Error ? error.message : '视频重新生成失败');
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
                                                  title="保存视频到下载目录"
                                                  onClick={() => downloadVideo(video.videoUrl, `第${cs.chapterNumber}集_镜头${shot.shotNumber}_视频`)}
                                                >
                                                  <Download className="w-3 h-3" />
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
                                              if (shotVideoPayload.voiceResolution.missingCharacters.length > 0) {
                                                toast.error(`请先为以下说话人物捆绑音色：${shotVideoPayload.voiceResolution.missingCharacters.join('、')}`);
                                                setActiveTab('extraction');
                                                return;
                                              }
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
                                                    speakingCharacters: shotVideoPayload.voiceResolution.speakingCharacters,
                                                    voiceAssignments: shotVideoPayload.voiceResolution.assignments,
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
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 p-1 sm:p-2"
          onClick={closeImagePreview}
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
        >
          <div
            className="relative flex h-[calc(100vh-0.5rem)] w-[calc(100vw-0.5rem)] max-w-[1920px] flex-col overflow-hidden rounded-md border border-amber-400/30 bg-gray-900 shadow-2xl sm:h-[calc(100vh-1rem)] sm:w-[calc(100vw-1rem)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 工具栏 */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-700 bg-gray-800 px-2 py-2 sm:px-3">
              <div className="flex min-w-0 flex-1 items-center gap-2 text-white">
                <Eye className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate text-sm" title={previewImage.name}>
                  {previewImage.name}
                </span>
                <Badge variant="secondary" className="hidden shrink-0 text-xs sm:inline-flex">
                  {previewImage.type === 'scene' ? '场景' : previewImage.type === 'character' ? '人物' : previewImage.type === 'prop' ? '道具' : '故事版'}
                </Badge>
              </div>
              <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                {/* 缩放控制 */}
                <div className="mr-1 flex items-center gap-1 sm:mr-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handlePreviewZoomOut}
                    className="text-white hover:bg-white/20 h-8 w-8 p-0"
                    disabled={previewZoom <= 0.25}
                    title="缩小"
                    aria-label="缩小图片"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </Button>
                  <span className="w-10 text-center text-xs text-white sm:w-12">
                    {Math.round(previewZoom * 100)}%
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handlePreviewZoomIn}
                    className="text-white hover:bg-white/20 h-8 w-8 p-0"
                    disabled={previewZoom >= 3}
                    title="放大"
                    aria-label="放大图片"
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
                  title="下载图片"
                  aria-label="下载图片"
                >
                  <Download className="w-4 h-4" />
                </Button>
                {/* 关闭按钮 */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={closeImagePreview}
                  className="text-white hover:bg-white/20 h-8 w-8 p-0"
                  title="关闭预览"
                  aria-label="关闭预览"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* 图片容器 */}
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-2 sm:p-3">
              {previewImage.url ? (
                <>
                  {isPreviewImageLoading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-900/80 text-amber-100">
                      <div className="flex items-center gap-2 rounded-md border border-amber-300/25 bg-black/70 px-4 py-2 text-sm shadow-xl">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        正在加载高清预览
                      </div>
                    </div>
                  )}
                  <img
                    src={getAssetPreviewUrl(getDisplayImageUrl(previewImage.url))}
                    alt={previewImage.name}
                    className={`max-h-full max-w-full object-contain transition-[transform,opacity] duration-200 ${isPreviewImageLoading ? 'opacity-0' : 'opacity-100'}`}
                    style={{ transform: `scale(${previewZoom})` }}
                    onLoad={() => setIsPreviewImageLoading(false)}
                    onError={(event) => {
                      const image = event.currentTarget;
                      if (image.dataset.originalFallback === 'true') {
                        setIsPreviewImageLoading(false);
                        toast.error('图片预览加载失败，请稍后重试');
                        return;
                      }
                      image.dataset.originalFallback = 'true';
                      image.src = getDisplayImageUrl(previewImage.url);
                    }}
                  />
                </>
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
