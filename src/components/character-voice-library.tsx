'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Library,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { OnDemandCollection } from '@/components/on-demand-collection';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  MIN_DIALOGUE_LINES_FOR_VOICE_PROFILE,
  type CharacterVoiceExtraction,
  type CharacterVoiceVariant,
  type VoiceLibraryItem,
} from '@/lib/character-voice';

type ExtractionStatus = 'pending' | 'loading' | 'success' | 'error' | 'batch_confirm';

export interface VoiceUploadInput {
  file: File;
  name: string;
  language: string;
  category: string;
  gender: VoiceLibraryItem['gender'];
  ageRange: string;
  description: string;
}

interface CharacterVoiceLibraryProps {
  data: CharacterVoiceExtraction | null;
  library: VoiceLibraryItem[];
  status: ExtractionStatus;
  disabled?: boolean;
  libraryLoading?: boolean;
  onRetry: () => void;
  onBind: (profileId: string, variantId: string, voiceId: string) => void;
  onRefreshLibrary: () => Promise<void>;
  onUploadVoice: (input: VoiceUploadInput) => Promise<boolean>;
  onDeleteVoice: (voiceId: string) => Promise<boolean>;
}

interface VoicePickerTarget {
  profileId: string;
  characterName: string;
  variantId: string;
  variantLabel: string;
}

const UPLOAD_CATEGORIES = [
  '女幼年', '男幼年',
  '女青年', '男青年',
  '女中年', '男中年',
  '女老年', '男老年',
  '系统', '第三方', '其他',
];

function compactEpisodes(episodes: number[]): string {
  if (episodes.length === 0) return '全剧通用';
  const sorted = Array.from(new Set(episodes)).sort((a, b) => a - b);
  if (sorted.length <= 5) return sorted.map(item => `第${item}集`).join('、');
  return `${sorted.slice(0, 4).map(item => `第${item}集`).join('、')} 等${sorted.length}集`;
}

function sourceLabel(source: VoiceLibraryItem['source']): string {
  if (source === 'builtin') return '内置音频';
  if (source === 'custom') return '我的上传';
  return '旧版预设';
}

function categoryForVoice(voice: VoiceLibraryItem): string {
  return voice.category || `${voice.gender}${voice.ageRange}` || '其他';
}

function optionLabel(voice: VoiceLibraryItem): string {
  const prefix = [voice.language, voice.category].filter(Boolean).join(' / ');
  return prefix ? `${prefix} · ${voice.name}` : voice.name;
}

function suggestedCategoryForVariant(
  variant: CharacterVoiceVariant,
  speakerCategory?: 'character' | 'system' | 'third_party',
): string {
  if (speakerCategory === 'system') return '系统';
  if (speakerCategory === 'third_party') return '第三方';

  const evidence = [
    variant.label,
    variant.ageStage,
    variant.traits.genderPresentation,
    variant.traits.agePresentation,
    ...variant.stageKeywords,
  ].filter(Boolean).join(' ');
  const gender = /女|女性|少女|女孩|母亲|奶奶|婆婆/.test(evidence)
    ? '女'
    : /男|男性|少年|男孩|父亲|爷爷|公公/.test(evidence)
      ? '男'
      : '';
  const age = /婴|幼年|童年|儿童|男童|女童/.test(evidence)
    ? '幼年'
    : /老年|年迈|老人|爷爷|奶奶/.test(evidence)
      ? '老年'
      : /中年|成熟|父亲|母亲/.test(evidence)
        ? '中年'
        : /青年|年轻|少年|少女/.test(evidence)
          ? '青年'
          : '';
  return gender && age ? `${gender}${age}` : '全部';
}

export function CharacterVoiceLibrary({
  data,
  library,
  status,
  disabled = false,
  libraryLoading = false,
  onRetry,
  onBind,
  onRefreshLibrary,
  onUploadVoice,
  onDeleteVoice,
}: CharacterVoiceLibraryProps) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [profilesExpanded, setProfilesExpanded] = useState(false);
  const [draftSelections, setDraftSelections] = useState<Record<string, string>>({});
  const [voicePickerTarget, setVoicePickerTarget] = useState<VoicePickerTarget | null>(null);
  const [pickerLanguage, setPickerLanguage] = useState('中文');
  const [pickerCategory, setPickerCategory] = useState('全部');
  const [pickerSelectedVoiceId, setPickerSelectedVoiceId] = useState('');
  const [previewingVoiceId, setPreviewingVoiceId] = useState('');
  const [uploadExpanded, setUploadExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingVoiceId, setDeletingVoiceId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [languageFilter, setLanguageFilter] = useState('全部');
  const [categoryFilter, setCategoryFilter] = useState('全部');
  const [sourceFilter, setSourceFilter] = useState('全部');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadLanguage, setUploadLanguage] = useState('中文');
  const [uploadCategory, setUploadCategory] = useState('女青年');
  const [uploadDescription, setUploadDescription] = useState('');
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioLibrary = useMemo(
    () => library.filter(voice => voice.source !== 'preset' && Boolean(voice.referenceAudioUrl)),
    [library],
  );

  const variantCount = useMemo(
    () => data?.profiles?.reduce((sum, profile) => sum + profile.variants.length, 0) || 0,
    [data],
  );
  const boundCount = useMemo(
    () => data?.profiles?.reduce(
      (sum, profile) => sum + profile.variants.filter(variant => variant.boundVoiceId).length,
      0,
    ) || 0,
    [data],
  );
  const languages = useMemo(
    () => Array.from(new Set(audioLibrary.map(voice => voice.language).filter((item): item is string => Boolean(item)))),
    [audioLibrary],
  );
  const categories = useMemo(
    () => Array.from(new Set(audioLibrary.map(categoryForVoice))).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [audioLibrary],
  );
  const visibleLibrary = useMemo(() => {
    const keyword = searchText.trim().toLocaleLowerCase();
    return audioLibrary.filter(voice => {
      if (languageFilter !== '全部' && voice.language !== languageFilter) return false;
      if (categoryFilter !== '全部' && categoryForVoice(voice) !== categoryFilter) return false;
      if (sourceFilter !== '全部' && voice.source !== sourceFilter) return false;
      if (!keyword) return true;
      return [voice.name, voice.description, voice.language, voice.category, ...voice.tags]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(keyword);
    });
  }, [audioLibrary, categoryFilter, languageFilter, searchText, sourceFilter]);
  const pickerLanguages = useMemo(
    () => Array.from(new Set(audioLibrary.map(voice => voice.language || '其他'))),
    [audioLibrary],
  );
  const pickerCategories = useMemo(() => {
    return Array.from(new Set(
      audioLibrary
        .filter(voice => pickerLanguage === '全部' || (voice.language || '其他') === pickerLanguage)
        .map(categoryForVoice),
    )).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [audioLibrary, pickerLanguage]);
  const pickerVoices = useMemo(() => {
    return audioLibrary.filter(voice => {
      if (pickerLanguage !== '全部' && (voice.language || '其他') !== pickerLanguage) return false;
      if (pickerCategory !== '全部' && categoryForVoice(voice) !== pickerCategory) return false;
      return true;
    });
  }, [audioLibrary, pickerCategory, pickerLanguage]);
  const pickerSelectedVoice = useMemo(
    () => audioLibrary.find(voice => voice.id === pickerSelectedVoiceId),
    [audioLibrary, pickerSelectedVoiceId],
  );

  const stopVoicePreview = useCallback(() => {
    const audio = previewAudioRef.current;
    if (audio) {
      audio.pause();
      try {
        audio.currentTime = 0;
      } catch {
        // Some browsers reject seeking before media metadata is available.
      }
    }
    setPreviewingVoiceId('');
  }, []);

  const playVoicePreview = useCallback((voice: VoiceLibraryItem) => {
    if (!voice.referenceAudioUrl || typeof window === 'undefined') return;
    let audio = previewAudioRef.current;
    if (!audio) {
      audio = new Audio();
      audio.preload = 'auto';
      previewAudioRef.current = audio;
    }
    const source = new URL(voice.referenceAudioUrl, window.location.href).href;
    if (audio.src !== source) {
      audio.pause();
      audio.src = source;
    }
    try {
      audio.currentTime = 0;
    } catch {
      // Playback will begin from the start once the browser has loaded metadata.
    }
    setPreviewingVoiceId(voice.id);
    void audio.play().catch(() => setPreviewingVoiceId(''));
  }, []);

  useEffect(() => {
    return () => {
      const audio = previewAudioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
      }
    };
  }, []);

  useEffect(() => {
    stopVoicePreview();
  }, [pickerCategory, pickerLanguage, stopVoicePreview]);

  const openVoicePicker = (
    profileId: string,
    characterName: string,
    speakerCategory: 'character' | 'system' | 'third_party' | undefined,
    variant: CharacterVoiceVariant,
  ) => {
    const selectionKey = `${profileId}:${variant.id}`;
    const preferredVoiceIds = [
      draftSelections[selectionKey],
      variant.boundVoiceId,
      variant.recommendedVoiceId,
    ].filter(Boolean);
    const currentVoiceId = preferredVoiceIds.find(voiceId => (
      audioLibrary.some(voice => voice.id === voiceId)
    ));
    const currentVoice = audioLibrary.find(voice => voice.id === currentVoiceId);
    const language = currentVoice?.language || '中文';
    const suggestedCategory = currentVoice
      ? categoryForVoice(currentVoice)
      : suggestedCategoryForVariant(variant, speakerCategory);
    const hasSuggestedCategory = audioLibrary.some(voice => (
      (voice.language || '其他') === language && categoryForVoice(voice) === suggestedCategory
    ));

    stopVoicePreview();
    setVoicePickerTarget({
      profileId,
      characterName,
      variantId: variant.id,
      variantLabel: variant.label,
    });
    setPickerLanguage(language);
    setPickerCategory(hasSuggestedCategory ? suggestedCategory : '全部');
    setPickerSelectedVoiceId(currentVoice?.id || '');
  };

  const closeVoicePicker = () => {
    stopVoicePreview();
    setVoicePickerTarget(null);
  };

  const confirmVoiceSelection = () => {
    if (!voicePickerTarget || !pickerSelectedVoice) return;
    const selectionKey = `${voicePickerTarget.profileId}:${voicePickerTarget.variantId}`;
    setDraftSelections(previous => ({
      ...previous,
      [selectionKey]: pickerSelectedVoice.id,
    }));
    closeVoicePicker();
  };

  const bindSelectedVoice = (
    profileId: string,
    variantId: string,
    voice: VoiceLibraryItem,
  ) => {
    onBind(profileId, variantId, voice.id);
    const selectionKey = `${profileId}:${variantId}`;
    setDraftSelections(previous => {
      const next = { ...previous };
      delete next[selectionKey];
      return next;
    });
  };

  const handleUploadFile = (file: File | null) => {
    setUploadFile(file);
    if (file && !uploadName.trim()) {
      setUploadName(file.name.replace(/\.[^.]+$/, ''));
    }
  };

  const submitUpload = async () => {
    if (!uploadFile || !uploadName.trim()) return;
    setUploading(true);
    try {
      const gender: VoiceLibraryItem['gender'] = uploadCategory.startsWith('女')
        ? '女'
        : uploadCategory.startsWith('男')
          ? '男'
          : '中性';
      const ageRange = uploadCategory.includes('幼年')
        ? '幼年/童年'
        : uploadCategory.includes('青年')
          ? '青年'
          : uploadCategory.includes('中年')
            ? '中年'
            : uploadCategory.includes('老年')
              ? '老年'
              : '不限';
      const uploaded = await onUploadVoice({
        file: uploadFile,
        name: uploadName.trim(),
        language: uploadLanguage,
        category: uploadCategory,
        gender,
        ageRange,
        description: uploadDescription.trim(),
      });
      if (uploaded) {
        setUploadFile(null);
        setUploadName('');
        setUploadDescription('');
        setUploadExpanded(false);
      }
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (voice: VoiceLibraryItem) => {
    if (!window.confirm(`确定删除“${voice.name}”吗？删除后，该账号将无法再试听或绑定这条音色。`)) return;
    setDeletingVoiceId(voice.id);
    try {
      await onDeleteVoice(voice.id);
    } finally {
      setDeletingVoiceId('');
    }
  };

  return (
    <Card className="gap-0 overflow-hidden rounded-lg border-amber-400/25 bg-black/20 py-0">
      <CardHeader className="border-b border-amber-400/15 px-4 !pb-3 pt-3 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-1.5 text-base">
              <Volume2 className="h-4 w-4 text-amber-400" />
              人物音色库
              {data && (
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                  {data.totalSpeakers} 个人物 / {variantCount} 个音色状态
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="mt-1 max-w-3xl text-[11px] leading-4">
              全剧累计至少 {MIN_DIALOGUE_LINES_FOR_VOICE_PROFILE} 句台词才建立音色档案；同一人物的不同时期归在人物下，系统与第三方声音遵循同一门槛。
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
              <DialogTrigger asChild>
                <Button className="h-7 px-2.5 text-[11px]" size="sm" variant="outline" onClick={() => void onRefreshLibrary()}>
                  <Library className="mr-1.5 h-3.5 w-3.5" />
                  选择音色库
                  <Badge className="ml-1 h-4 bg-amber-500/15 px-1 text-[9px] text-amber-100">{audioLibrary.length}</Badge>
                </Button>
              </DialogTrigger>
              <DialogContent className="flex max-h-[88vh] flex-col overflow-hidden p-0 sm:max-w-6xl">
                <DialogHeader className="border-b border-amber-400/15 px-4 pb-3 pt-4 sm:px-5">
                  <div className="flex flex-wrap items-start justify-between gap-2 pr-8">
                    <div>
                      <DialogTitle className="text-base">统一音色库</DialogTitle>
                      <DialogDescription className="mt-1 text-xs leading-4">
                        已按原文件夹分类导入；可试听后绑定，也可上传并保存到当前账号的音色库。
                      </DialogDescription>
                    </div>
                    <div className="flex gap-1.5">
                      <Button className="h-7 px-2.5 text-[11px]" variant="outline" size="sm" onClick={() => void onRefreshLibrary()} disabled={libraryLoading}>
                        <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${libraryLoading ? 'animate-spin' : ''}`} />
                        刷新
                      </Button>
                      <Button className="h-7 px-2.5 text-[11px]" size="sm" onClick={() => setUploadExpanded(value => !value)}>
                        <Upload className="mr-1.5 h-3.5 w-3.5" />
                        上传音色
                      </Button>
                    </div>
                  </div>
                </DialogHeader>

                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  {uploadExpanded && (
                    <div className="border-b border-amber-400/15 bg-amber-500/[0.04] px-4 py-3 sm:px-5">
                      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-5">
                        <div className="xl:col-span-2">
                          <Label className="text-[11px]" htmlFor="voice-audio-file">音频文件</Label>
                          <Input
                            id="voice-audio-file"
                            className="mt-1 h-8 text-xs"
                            type="file"
                            accept="audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg,audio/flac,.mp3,.wav,.m4a,.aac,.ogg,.flac"
                            onChange={event => handleUploadFile(event.target.files?.[0] || null)}
                          />
                        </div>
                        <div>
                          <Label className="text-[11px]" htmlFor="voice-upload-name">音色名称</Label>
                          <Input
                            id="voice-upload-name"
                            className="mt-1 h-8 text-xs"
                            value={uploadName}
                            maxLength={80}
                            placeholder="例如：林清青年声线"
                            onChange={event => setUploadName(event.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-[11px]">语言</Label>
                          <Select value={uploadLanguage} onValueChange={setUploadLanguage}>
                            <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="中文">中文</SelectItem>
                              <SelectItem value="英文">英文</SelectItem>
                              <SelectItem value="其他">其他</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-[11px]">分类</Label>
                          <Select value={uploadCategory} onValueChange={setUploadCategory}>
                            <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {UPLOAD_CATEGORIES.map(category => (
                                <SelectItem key={category} value={category}>{category}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="mt-2.5 flex flex-col gap-2.5 md:flex-row md:items-end">
                        <div className="min-w-0 flex-1">
                          <Label className="text-[11px]" htmlFor="voice-upload-description">备注（可选）</Label>
                          <Input
                            id="voice-upload-description"
                            className="mt-1 h-8 text-xs"
                            value={uploadDescription}
                            maxLength={300}
                            placeholder="记录音色特点、适合角色或使用场景"
                            onChange={event => setUploadDescription(event.target.value)}
                          />
                        </div>
                        <Button
                          className="h-8 shrink-0 px-3 text-xs"
                          disabled={!uploadFile || !uploadName.trim() || uploading}
                          onClick={() => void submitUpload()}
                        >
                          {uploading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
                          保存到我的音色库
                        </Button>
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">支持 MP3、WAV、M4A、AAC、OGG、FLAC，单个文件不超过 20MB。</p>
                    </div>
                  )}

                  <div className="grid gap-2 border-b border-amber-400/15 px-4 py-2.5 sm:grid-cols-2 sm:px-5 xl:grid-cols-[minmax(220px,1fr)_140px_140px_140px]">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        className="h-8 pl-8 text-xs"
                        value={searchText}
                        placeholder="搜索音色名称或标签"
                        onChange={event => setSearchText(event.target.value)}
                      />
                    </div>
                    <Select value={languageFilter} onValueChange={setLanguageFilter}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="全部">全部语言</SelectItem>
                        {languages.map(language => <SelectItem key={language} value={language}>{language}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="全部">全部分类</SelectItem>
                        {categories.map(category => <SelectItem key={category} value={category}>{category}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={sourceFilter} onValueChange={setSourceFilter}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="全部">全部来源</SelectItem>
                        <SelectItem value="builtin">内置音频</SelectItem>
                        <SelectItem value="custom">我的上传</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
                    {libraryLoading && audioLibrary.length === 0 ? (
                      <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin" />正在载入音色库...
                      </div>
                    ) : visibleLibrary.length === 0 ? (
                      <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">没有符合筛选条件的音色</div>
                    ) : (
                      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {visibleLibrary.map(voice => (
                          <article key={voice.id} className="rounded-md border border-amber-400/20 bg-black/15 p-2.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-amber-100" title={voice.name}>{voice.name}</div>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  <Badge className="h-4 px-1 text-[9px]" variant="outline">{sourceLabel(voice.source)}</Badge>
                                  {voice.language && <Badge className="h-4 px-1 text-[9px]" variant="secondary">{voice.language}</Badge>}
                                  <Badge className="h-4 px-1 text-[9px]" variant="secondary">{voice.category || voice.ageRange}</Badge>
                                </div>
                              </div>
                              {voice.source === 'custom' && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 shrink-0 text-red-300 hover:text-red-200"
                                  title="删除我的音色"
                                  disabled={deletingVoiceId === voice.id}
                                  onClick={() => void handleDelete(voice)}
                                >
                                  {deletingVoiceId === voice.id
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    : <Trash2 className="h-3.5 w-3.5" />}
                                </Button>
                              )}
                            </div>
                            <p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground" title={voice.description}>{voice.description}</p>
                            {voice.referenceAudioUrl ? (
                              <audio className="mt-2 h-8 w-full" controls preload="none" src={voice.referenceAudioUrl}>
                                当前浏览器不支持音频播放。
                              </audio>
                            ) : (
                              <div className="mt-3 rounded border border-dashed border-amber-400/15 px-3 py-2 text-[11px] text-muted-foreground">
                                此通用预设暂无试听文件
                              </div>
                            )}
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </DialogContent>
            </Dialog>
            <Button
              className="h-7 px-2.5 text-[11px]"
              size="sm"
              variant="outline"
              onClick={onRetry}
              disabled={disabled || status === 'loading'}
            >
              {status === 'loading' ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              )}
              {data ? '重新提取音色' : '提取人物音色'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-3 sm:px-5">
        {status === 'loading' && !data && (
          <div className="flex min-h-20 items-center justify-center gap-2 rounded-md border border-amber-400/20 bg-amber-500/[0.04] text-xs text-amber-100/80">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在通读执行剧本，统计累计至少 {MIN_DIALOGUE_LINES_FOR_VOICE_PROFILE} 句台词的发声主体及其时期/变身音色...
          </div>
        )}

        {status === 'error' && !data && (
          <div className="rounded-md border border-red-400/25 bg-red-500/[0.06] p-3 text-xs text-red-100/80">
            人物音色提取失败，请点击“提取人物音色”重试。
          </div>
        )}

        {!data && status !== 'loading' && status !== 'error' && (
          <div className="rounded-md border border-dashed border-amber-400/25 p-4 text-center text-xs text-muted-foreground">
            尚未建立人物音色库。提取后，累计至少 {MIN_DIALOGUE_LINES_FOR_VOICE_PROFILE} 句台词的发声主体会按时期和特殊状态归类。
          </div>
        )}

        {data && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-400/20 bg-amber-500/[0.04] px-2.5 py-1.5 text-[11px]">
              <span>已扫描 {data.totalDialogueLines} 句台词</span>
              <span className={boundCount === variantCount ? 'text-emerald-300' : 'text-amber-300'}>
                已绑定 {boundCount}/{variantCount} 个音色状态
              </span>
            </div>

            <OnDemandCollection
              items={data.profiles}
              expanded={profilesExpanded}
              collapsedCount={3}
              batchSize={6}
              className="space-y-3 overflow-x-hidden overflow-y-auto pr-1 transition-all duration-300"
              collapsedClassName="max-h-[460px]"
              expandedClassName="max-h-[76vh]"
              itemClassName="[content-visibility:auto] [contain-intrinsic-size:280px]"
              getKey={profile => profile.id}
              renderItem={profile => (
                <section className="border-t border-amber-400/15 pt-3 first:border-t-0 first:pt-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  <h3 className="text-sm font-semibold text-amber-100">{profile.characterName}</h3>
                  {profile.speakerCategory === 'system' && (
                    <Badge className="h-5 bg-cyan-500/15 px-1.5 text-[10px] text-cyan-200">系统音色</Badge>
                  )}
                  {profile.speakerCategory === 'third_party' && (
                    <Badge className="h-5 bg-sky-500/15 px-1.5 text-[10px] text-sky-200">第三方音色</Badge>
                  )}
                  <Badge className="h-5 px-1.5 text-[10px]" variant="outline">{profile.totalDialogueCount} 句台词</Badge>
                  {profile.aliases.length > 0 && (
                    <span className="text-[10px] text-muted-foreground">别名：{profile.aliases.join('、')}</span>
                  )}
                </div>

                <div className="grid gap-2 xl:grid-cols-2">
                  {profile.variants.map(variant => {
                    const selectionKey = `${profile.id}:${variant.id}`;
                    const boundVoice = audioLibrary.find(voice => voice.id === variant.boundVoiceId);
                    const pendingVoice = audioLibrary.find(voice => voice.id === draftSelections[selectionKey]);
                    const displayedVoice = pendingVoice || boundVoice;
                    const hasPendingChange = Boolean(
                      pendingVoice && pendingVoice.id !== variant.boundVoiceId,
                    );
                    return (
                      <div key={variant.id} className="rounded-md border border-amber-400/20 bg-black/10 p-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge className="h-5 bg-amber-500/15 px-1.5 text-[10px] text-amber-100">{variant.label}</Badge>
                          <Badge className="h-5 px-1.5 text-[10px]" variant="outline">{compactEpisodes(variant.episodeNumbers)}</Badge>
                          <span className="text-[10px] text-muted-foreground">{variant.dialogueCount} 句</span>
                          {hasPendingChange ? (
                            <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-amber-300">
                              <Volume2 className="h-3 w-3" />待绑定
                            </span>
                          ) : boundVoice && (
                            <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-emerald-300">
                              <Check className="h-3 w-3" />已绑定
                            </span>
                          )}
                        </div>

                        <p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground" title={variant.sampleDialogues.join('\n')}>
                          {variant.sampleDialogues[0] ? `台词样本：“${variant.sampleDialogues[0]}”` : '暂无台词样本'}
                        </p>
                        <p className="mt-1 text-[10px] leading-4 text-amber-100/70">
                          {variant.traits.agePresentation} · {variant.traits.pitch} · {variant.traits.timbre} · {variant.traits.pace}
                        </p>

                        <div className="mt-2 grid grid-cols-2 gap-1.5">
                          <Button
                            className="h-8 min-w-0 justify-between gap-1.5 px-2.5 text-xs"
                            variant="outline"
                            disabled={disabled || audioLibrary.length === 0}
                            onClick={() => openVoicePicker(
                              profile.id,
                              profile.characterName,
                              profile.speakerCategory,
                              variant,
                            )}
                          >
                            <span className="min-w-0 truncate text-left">
                              {displayedVoice ? '重新选择' : '选择音色'}
                            </span>
                            <Library className="h-3.5 w-3.5 shrink-0" />
                          </Button>
                          <Button
                            className="h-8 min-w-0 px-2.5 text-xs"
                            variant={hasPendingChange ? 'default' : 'outline'}
                            disabled={disabled || !displayedVoice || !hasPendingChange}
                            onClick={() => displayedVoice && bindSelectedVoice(
                              profile.id,
                              variant.id,
                              displayedVoice,
                            )}
                          >
                            <Link2 className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                            {boundVoice && !hasPendingChange ? '已绑定音色' : '绑定音色'}
                          </Button>
                        </div>

                        {displayedVoice && (
                          <div className="mt-1.5 rounded-md border border-amber-400/10 bg-black/10 p-2">
                            <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
                              <span className="truncate font-medium text-amber-100">{displayedVoice.name}</span>
                              <span className={hasPendingChange ? 'text-amber-300' : 'text-emerald-300'}>
                                {hasPendingChange ? '等待绑定' : '当前音色'}
                              </span>
                            </div>
                            <p className="text-[11px] leading-4 text-muted-foreground">{displayedVoice.description}</p>
                            {displayedVoice.referenceAudioUrl && (
                              <audio className="mt-1.5 h-7 w-full" controls preload="none" src={displayedVoice.referenceAudioUrl}>
                                当前浏览器不支持音频播放。
                              </audio>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                </section>
              )}
            />

            <div className="border-t border-amber-400/15 pt-2 text-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-3 text-[11px] text-muted-foreground hover:text-amber-100"
                aria-expanded={profilesExpanded}
                onClick={() => setProfilesExpanded(value => !value)}
              >
                {profilesExpanded ? '收起' : '展开全部'} {data.totalSpeakers} 个人物 / {variantCount} 个音色状态
                <ChevronDown className={`ml-1 h-3 w-3 transition-transform ${profilesExpanded ? 'rotate-180' : ''}`} />
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog
        open={Boolean(voicePickerTarget)}
        onOpenChange={open => {
          if (!open) closeVoicePicker();
        }}
      >
        <DialogContent className="flex max-h-[86vh] flex-col overflow-hidden p-0 sm:max-w-5xl">
          <DialogHeader className="border-b border-amber-400/15 px-4 pb-3 pt-4 sm:px-5">
            <DialogTitle className="text-base">
              {voicePickerTarget
                ? `${voicePickerTarget.characterName} · ${voicePickerTarget.variantLabel}`
                : '选择音色'}
            </DialogTitle>
            <DialogDescription className="text-xs leading-4">
              为当前人物状态选定参考音频
            </DialogDescription>
          </DialogHeader>

          <div className="border-b border-amber-400/15 px-4 py-2.5 sm:px-5">
            <div className="flex flex-wrap gap-1.5">
              {['全部', ...pickerLanguages].map(language => (
                <Button
                  key={language}
                  size="sm"
                  variant={pickerLanguage === language ? 'default' : 'outline'}
                  className="h-7 min-w-16 px-2.5 text-[11px]"
                  onClick={() => {
                    setPickerLanguage(language);
                    setPickerCategory('全部');
                  }}
                >
                  {language === '全部' ? '全部语言' : language}
                </Button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {['全部', ...pickerCategories].map(category => {
                const categoryCount = audioLibrary.filter(voice => (
                  (pickerLanguage === '全部' || (voice.language || '其他') === pickerLanguage)
                  && (category === '全部' || categoryForVoice(voice) === category)
                )).length;
                return (
                  <Button
                    key={category}
                    size="sm"
                    variant={pickerCategory === category ? 'default' : 'outline'}
                    className="h-7 gap-1.5 px-2 text-[10px]"
                    onClick={() => setPickerCategory(category)}
                  >
                    <span>{category === '全部' ? '全部分类' : category}</span>
                    <span className="text-[10px] opacity-70">{categoryCount}</span>
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
            {pickerVoices.length === 0 ? (
              <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed border-amber-400/20 text-xs text-muted-foreground">
                当前分类暂无音色
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {pickerVoices.map(voice => {
                  const selected = voice.id === pickerSelectedVoiceId;
                  const previewing = voice.id === previewingVoiceId;
                  return (
                    <button
                      key={voice.id}
                      type="button"
                      title={`试听并选择 ${voice.name}`}
                      aria-pressed={selected}
                      className={`min-h-24 rounded-md border p-2.5 text-left transition-[border-color,background-color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
                        selected
                          ? 'border-amber-300 bg-amber-500/15'
                          : 'border-amber-400/20 bg-black/15 hover:-translate-y-0.5 hover:border-amber-300/70 hover:bg-amber-500/[0.07]'
                      }`}
                      onPointerEnter={() => playVoicePreview(voice)}
                      onPointerLeave={stopVoicePreview}
                      onFocus={() => playVoicePreview(voice)}
                      onBlur={stopVoicePreview}
                      onClick={() => {
                        setPickerSelectedVoiceId(voice.id);
                        playVoicePreview(voice);
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium text-amber-100" title={voice.name}>{voice.name}</div>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            <Badge className="h-4 px-1 text-[9px]" variant="outline">{sourceLabel(voice.source)}</Badge>
                            <Badge className="h-4 px-1 text-[9px]" variant="secondary">{voice.language || '其他'}</Badge>
                            <Badge className="h-4 px-1 text-[9px]" variant="secondary">{categoryForVoice(voice)}</Badge>
                          </div>
                        </div>
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${
                          selected
                            ? 'border-amber-300 bg-amber-300 text-black'
                            : previewing
                              ? 'border-emerald-300/60 bg-emerald-400/10 text-emerald-200'
                              : 'border-amber-400/20 text-amber-100/65'
                        }`}>
                          {selected
                            ? <Check className="h-3.5 w-3.5" />
                            : <Volume2 className={`h-3.5 w-3.5 ${previewing ? 'animate-pulse' : ''}`} />}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-muted-foreground" title={voice.description}>
                        {voice.description || optionLabel(voice)}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter className="border-t border-amber-400/15 bg-black/20 px-4 py-3 sm:items-center sm:justify-between sm:px-5">
            <div className="min-w-0 text-left text-xs text-muted-foreground">
              {pickerSelectedVoice ? (
                <span className="block truncate">
                  已选：<strong className="font-medium text-amber-100">{pickerSelectedVoice.name}</strong>
                </span>
              ) : '尚未选择音色'}
            </div>
            <div className="flex justify-end gap-1.5">
              <Button className="h-8 px-3 text-xs" variant="outline" onClick={closeVoicePicker}>取消</Button>
              <Button className="h-8 px-3 text-xs" disabled={disabled || !pickerSelectedVoice} onClick={confirmVoiceSelection}>
                <Check className="mr-1.5 h-3.5 w-3.5" />
                确认选择
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
