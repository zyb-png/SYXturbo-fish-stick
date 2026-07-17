'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  FolderOpen, 
  Loader2,
  MapPin,
  Users,
  Package,
  Film,
  RefreshCw,
  FolderTree,
  Download,
  FileImage,
  FileVideo,
  ChevronRight,
  ArrowLeft,
  Trash2,
  Eye,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { toast } from 'sonner';
import { getAssetPreviewUrl } from '@/lib/asset-image-url';

interface AssetFile {
  name: string;
  size: number;
  sizeFormatted: string;
  createdAt: string;
  modifiedAt: string;
  // S3 相关字段
  url?: string;
  key?: string;
}

interface FolderData {
  count: number;
  size: number;
  files: AssetFile[];
}

interface AssetsConfig {
  assetsPath: string;
  folders: {
    scenes: string;
    characters: string;
    props: string;
    storyboards: string;
    videos: string;
  };
}

interface AssetStats {
  scenes: number;
  characters: number;
  props: number;
  storyboards: number;
  videos: number;
}

const FOLDER_MAP: Record<string, { name: string; icon: React.ReactNode; color: string }> = {
  scenes: { name: '场景图片', icon: <MapPin className="w-4 h-4" />, color: 'text-blue-500' },
  characters: { name: '人物图片', icon: <Users className="w-4 h-4" />, color: 'text-green-500' },
  props: { name: '道具图片', icon: <Package className="w-4 h-4" />, color: 'text-orange-500' },
  storyboards: { name: '分镜图片', icon: <Film className="w-4 h-4" />, color: 'text-purple-500' },
  videos: { name: '视频文件', icon: <FileVideo className="w-4 h-4" />, color: 'text-red-500' },
};

const BATCH_DOWNLOAD_TOOLTIP = '本机访问会稳定保存到系统下载目录；公网访问会打包为 ZIP 下载到当前浏览器。';

function shouldSaveToServerDownloads() {
  if (typeof window === 'undefined') return true;
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
}

function getDownloadFilename(contentDisposition: string | null, fallback: string) {
  if (!contentDisposition) return fallback;
  const encodedMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) return decodeURIComponent(encodedMatch[1]);
  const plainMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  return plainMatch?.[1] ? decodeURIComponent(plainMatch[1]) : fallback;
}

function downloadBlob(blob: Blob, filename: string) {
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
}

interface AssetsFolderManagerProps {
  refreshTrigger?: number; // 当此值变化时刷新数据
  onAssetsChanged?: () => void;
}

export function AssetsFolderManager({ refreshTrigger, onAssetsChanged }: AssetsFolderManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [config, setConfig] = useState<AssetsConfig | null>(null);
  const [assetsExist, setAssetsExist] = useState(false);
  const [assetStats, setAssetStats] = useState<AssetStats | null>(null);
  
  // 文件浏览器状态
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [folderFiles, setFolderFiles] = useState<AssetFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const [downloadingFolder, setDownloadingFolder] = useState<string | null>(null);
  
  // 预览状态
  const [previewFile, setPreviewFile] = useState<{
    folder: string;
    filename: string;
    originalUrl: string;
  } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);
  
  // 删除状态
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  const [deleteConfirmFile, setDeleteConfirmFile] = useState<{ folder: string; file: AssetFile } | null>(null);
  
  // 客户端挂载状态
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  // 加载资产配置
  const loadConfig = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/assets-config');
      const data = await response.json();
      
      if (data.success) {
        setConfig(data.config);
        setAssetsExist(data.assetsExist);
        setAssetStats(data.assetStats);
        onAssetsChanged?.();
      }
    } catch (error) {
      console.error('加载配置失败:', error);
      toast.error('加载配置失败');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchFolderFilesForDownload = async (folderKey: string): Promise<AssetFile[]> => {
    let data;
    try {
      const s3Response = await fetch(`/api/s3-assets-list?folder=${folderKey}`);
      const s3Data = await s3Response.json();
      if (s3Data.success && s3Data.files && s3Data.files.length > 0) {
        data = {
          success: true,
          files: s3Data.files.map((file: any) => ({
            name: file.fileName || file.name,
            size: 0,
            sizeFormatted: '未知',
            createdAt: new Date(file.timestamp).toISOString(),
            modifiedAt: new Date(file.timestamp).toISOString(),
            url: file.url,
            key: file.key,
          })),
        };
      }
    } catch (s3Error) {
      console.log('S3 文件列表加载失败，尝试本地文件系统:', s3Error);
    }

    if (!data || !data.files || data.files.length === 0) {
      const folderName = FOLDER_MAP[folderKey]?.name || folderKey;
      const response = await fetch(`/api/assets-list?folder=${encodeURIComponent(folderName)}`);
      data = await response.json();
    }

    if (!data.success) {
      throw new Error(data.error || '加载文件列表失败');
    }

    return data.files || [];
  };

  // 加载文件夹内容
  const loadFolderFiles = async (folderKey: string) => {
    setIsLoadingFiles(true);
    try {
      const files = await fetchFolderFilesForDownload(folderKey);
      setFolderFiles(files);
      setCurrentFolder(folderKey);
    } catch (error) {
      console.error('加载文件列表失败:', error);
      toast.error(error instanceof Error ? error.message : '加载文件列表失败');
    } finally {
      setIsLoadingFiles(false);
    }
  };

  // 下载文件
  const downloadFile = async (folderKey: string, file: AssetFile) => {
    const filename = file.name;
    setDownloadingFile(filename);
    try {
      const folderName = FOLDER_MAP[folderKey]?.name || folderKey;
      const sourceUrl = file.key && file.url
        ? file.url
        : `/api/assets-view?folder=${encodeURIComponent(folderName)}&filename=${encodeURIComponent(filename)}`;
      const saveToDownloads = shouldSaveToServerDownloads();
      const response = await fetch('/api/assets-save-to-downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: sourceUrl,
          fileName: filename.replace(/\.[^.]+$/, ''),
          saveToDownloads,
        }),
      });

      if (!saveToDownloads && response.ok) {
        const blob = await response.blob();
        const downloadName = getDownloadFilename(response.headers.get('Content-Disposition'), filename);
        downloadBlob(blob, downloadName);
        toast.success('已开始下载', {
          description: downloadName,
          duration: 6000,
        });
        return;
      }

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || '下载失败');
      }

      toast.success('已保存到下载目录', {
        description: data.targetPath || data.filename,
        duration: 6000,
      });
    } catch (error) {
      console.error('下载失败:', error);
      toast.error(error instanceof Error ? error.message : '下载失败');
    } finally {
      setDownloadingFile(null);
    }
  };

  // 批量保存某个类别的全部资产到下载目录，避免浏览器目录写入导致桌面端闪退
  const batchDownloadFolder = async (folderKey: string) => {
    setDownloadingFolder(folderKey);
    try {
      toast.info('正在保存到下载目录，请稍等...', { duration: 3000 });
      const saveToDownloads = shouldSaveToServerDownloads();
      const response = await fetch('/api/assets-batch-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderKey, saveToDownloads }),
      });

      if (!saveToDownloads && response.ok) {
        const blob = await response.blob();
        const downloadName = getDownloadFilename(
          response.headers.get('Content-Disposition'),
          `${FOLDER_MAP[folderKey]?.name || folderKey}.zip`
        );
        downloadBlob(blob, downloadName);
        toast.success(`${FOLDER_MAP[folderKey]?.name || folderKey} 已开始下载`, {
          description: downloadName,
          duration: 8000,
        });
        return;
      }

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || '批量下载失败');
      }

      toast.success(`${FOLDER_MAP[folderKey]?.name || folderKey} 已保存到下载目录`, {
        description: `${data.copiedCount} 个文件：${data.targetPath}`,
        duration: 8000,
      });
    } catch (error: any) {
      console.error('批量下载失败:', error);
      toast.error(error?.message || '批量下载失败');
    } finally {
      setDownloadingFolder(null);
    }
  };

  // 预览文件
  const previewFileHandler = async (folderKey: string, file: AssetFile) => {
    const filename = file.name;
    setIsLoadingPreview(true);
    setPreviewZoom(1);
    const folderName = FOLDER_MAP[folderKey]?.name || folderKey;
    const originalUrl = file.key && file.url
      ? file.url
      : `/api/assets-view?folder=${encodeURIComponent(folderName)}&filename=${encodeURIComponent(filename)}`;

    setPreviewUrl(getAssetPreviewUrl(originalUrl));
    setPreviewFile({ folder: folderKey, filename, originalUrl });
  };

  // 关闭预览
  const closePreview = useCallback(() => {
    if (previewUrl?.startsWith('blob:')) {
      window.URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setPreviewFile(null);
    setIsLoadingPreview(false);
    setPreviewZoom(1);
  }, [previewUrl]);

  const handleDialogOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
    if (!open) {
      closePreview();
      setCurrentFolder(null);
      setDeleteConfirmFile(null);
    }
  }, [closePreview]);

  // 删除文件
  const deleteFile = async (folderKey: string, file: AssetFile) => {
    const filename = file.name;
    setDeletingFile(filename);
    try {
      const response = await fetch('/api/delete-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageKey: file.key || filename,
          imageUrl: file.url,
          folder: FOLDER_MAP[folderKey]?.name || folderKey,
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        toast.success('文件删除成功');
        // 刷新文件列表
        loadFolderFiles(folderKey);
        // 刷新统计
        loadConfig();
      } else {
        toast.error(data.error || '删除失败');
      }
    } catch (error) {
      console.error('删除失败:', error);
      toast.error('删除失败');
    } finally {
      setDeletingFile(null);
      setDeleteConfirmFile(null);
    }
  };

  // 缩放控制
  const handleZoomIn = () => setPreviewZoom(prev => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setPreviewZoom(prev => Math.max(prev - 0.25, 0.25));

  // 键盘事件处理 - ESC 关闭预览
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (previewFile && previewUrl) {
        if (e.key === 'Escape') {
          closePreview();
        } else if (e.key === '+' || e.key === '=') {
          handleZoomIn();
        } else if (e.key === '-') {
          handleZoomOut();
        }
      }
    };

    if (previewFile && previewUrl) {
      window.addEventListener('keydown', handleKeyDown);
      // 禁止页面滚动
      document.body.style.overflow = 'hidden';
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [previewFile, previewUrl, closePreview]);

  // 初始化资产文件夹
  const initializeAssets = async () => {
    setIsSaving(true);
    try {
      const response = await fetch('/api/assets-config', {
        method: 'PUT',
      });
      const data = await response.json();
      
      if (data.success) {
        setConfig(data.config);
        setAssetsExist(true);
        toast.success('资产文件夹初始化成功');
        loadConfig();
      } else {
        toast.error(data.error || '初始化失败');
      }
    } catch (error) {
      console.error('初始化失败:', error);
      toast.error('初始化失败');
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      setCurrentFolder(null);
    }
  }, [isOpen]);

  // 当 refreshTrigger 变化时刷新数据（用于清除数据后刷新）
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      loadConfig();
    }
  }, [refreshTrigger]);

  // 计算总资产数
  const totalAssets = assetStats 
    ? Object.values(assetStats).reduce((sum, count) => sum + count, 0) 
    : 0;

  // 格式化文件大小
  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // 格式化日期
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleDialogOpenChange}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <FolderTree className="w-4 h-4" />
            资产管理
          </Button>
        </DialogTrigger>
        <DialogContent 
          className={previewFile && previewUrl
            ? 'flex h-[calc(100vh-0.5rem)] max-h-[calc(100vh-0.5rem)] w-[calc(100vw-0.5rem)] max-w-[calc(100vw-0.5rem)] flex-col gap-0 overflow-hidden rounded-md p-0 sm:max-w-[calc(100vw-1rem)]'
            : 'flex max-h-[85vh] flex-col overflow-hidden sm:max-w-3xl'
          }
          showCloseButton={!(previewFile && previewUrl)}
          onInteractOutside={(e) => {
            // 如果图片预览打开，阻止点击外部关闭 Dialog
            if (previewFile && previewUrl) {
              e.preventDefault();
            }
          }}
          onEscapeKeyDown={(e) => {
            if (previewFile && previewUrl) {
              e.preventDefault();
              closePreview();
            }
          }}
        >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5" />
            资产文件夹管理
          </DialogTitle>
          <DialogDescription>
            {currentFolder 
              ? `浏览 ${FOLDER_MAP[currentFolder]?.name || currentFolder} 中的文件`
              : '查看和管理生成的图片和视频资产'
            }
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        ) : currentFolder ? (
          /* 文件浏览视图 */
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentFolder(null)}
                className="gap-1"
              >
                <ArrowLeft className="w-4 h-4" />
                返回
              </Button>
              <ChevronRight className="w-4 h-4 text-gray-400" />
              <span className="flex items-center gap-2">
                <span className={FOLDER_MAP[currentFolder]?.color}>
                  {FOLDER_MAP[currentFolder]?.icon}
                </span>
                <span className="font-medium">{FOLDER_MAP[currentFolder]?.name}</span>
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => batchDownloadFolder(currentFolder)}
                        disabled={downloadingFolder === currentFolder || folderFiles.length === 0}
                      >
                        {downloadingFolder === currentFolder ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4 mr-1" />
                        )}
                        批量下载
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={8} className="max-w-[260px] text-center leading-5">
                    {BATCH_DOWNLOAD_TOOLTIP}
                  </TooltipContent>
                </Tooltip>
                <Badge variant="secondary">
                  {folderFiles.length} 个文件
                </Badge>
              </div>
            </div>

            {isLoadingFiles ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : folderFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                <FolderOpen className="w-12 h-12 mb-3 text-gray-300" />
                <p>此文件夹为空</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <div className="space-y-2">
                  {folderFiles.map((file) => (
                    <div
                      key={file.name}
                      className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      <div className="flex-shrink-0">
                        {currentFolder === 'videos' ? (
                          <FileVideo className="w-8 h-8 text-red-400" />
                        ) : (
                          <FileImage className="w-8 h-8 text-blue-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate" title={file.name}>
                          {file.name}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-gray-500">
                          <span>{file.sizeFormatted}</span>
                          <span>{formatDate(file.modifiedAt)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {/* 预览按钮 */}
                        {currentFolder !== 'videos' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => previewFileHandler(currentFolder, file)}
                            disabled={isLoadingPreview}
                            className="text-gray-500 hover:text-blue-500"
                            title="预览"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        )}
                        {/* 下载按钮 */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => downloadFile(currentFolder, file)}
                          disabled={downloadingFile === file.name}
                          title="下载"
                        >
                          {downloadingFile === file.name ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Download className="w-4 h-4" />
                          )}
                        </Button>
                        {/* 删除按钮 */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteConfirmFile({ folder: currentFolder, file })}
                          disabled={deletingFile === file.name}
                          className="text-gray-500 hover:text-red-500"
                          title="删除"
                        >
                          {deletingFile === file.name ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* 主视图 */
          <div className="flex-1 overflow-y-auto space-y-6">
            {/* 资产文件夹状态 */}
            {config && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-sm">资产文件夹</h3>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={loadConfig}
                    >
                      <RefreshCw className="w-4 h-4 mr-1" />
                      刷新
                    </Button>
                    {!assetsExist && (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={initializeAssets}
                        disabled={isSaving}
                      >
                        {isSaving ? (
                          <Loader2 className="w-4 h-4 animate-spin mr-1" />
                        ) : null}
                        初始化文件夹
                      </Button>
                    )}
                  </div>
                </div>

                {/* 总计 */}
                <div className="p-4 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950 dark:to-blue-950 rounded-lg border">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FolderTree className="w-5 h-5 text-purple-500" />
                      <span className="font-medium">总资产数量</span>
                    </div>
                    <Badge variant="default" className="text-base px-3 py-1">
                      {totalAssets} 个文件
                    </Badge>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(FOLDER_MAP).map(([key, info]) => {
                    const count = assetStats?.[key as keyof AssetStats] || 0;
                    const isDownloadingThisFolder = downloadingFolder === key;

                    return (
                    <div
                      key={key}
                      className="p-4 border rounded-lg text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={info.color}>{info.icon}</span>
                          <span className="text-sm font-medium">{info.name}</span>
                        </div>
                        <Badge variant="secondary">
                          {count} 个
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-gray-500 hover:text-gray-700"
                          onClick={() => loadFolderFiles(key)}
                        >
                          查看文件
                          <ChevronRight className="w-3 h-3 ml-1" />
                        </Button>
                        <div className="flex items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2 text-xs"
                                  disabled={isDownloadingThisFolder || count === 0}
                                  onClick={() => batchDownloadFolder(key)}
                                >
                                  {isDownloadingThisFolder ? (
                                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                  ) : (
                                    <Download className="w-3 h-3 mr-1" />
                                  )}
                                  批量下载
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" sideOffset={8} className="max-w-[260px] text-center leading-5">
                              {BATCH_DOWNLOAD_TOOLTIP}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  )})}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 图片预览模态框 - 放在资产管理 Dialog 内部，避免外层弹窗拦截点击 */}
        {previewFile && previewUrl && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 cursor-pointer"
            onClick={closePreview}
            role="dialog"
            aria-modal="true"
            aria-label="图片预览"
          >
            <div
              className="relative flex h-full w-full cursor-default flex-col overflow-hidden bg-gray-900"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-3 bg-gray-800 border-b border-gray-700 shrink-0">
                <div className="flex min-w-0 items-center gap-2 text-white">
                  <Eye className="w-4 h-4 shrink-0" />
                  <span className="truncate text-sm" title={previewFile.filename}>
                    {previewFile.filename}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 mr-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleZoomOut();
                      }}
                      className="text-white hover:bg-white/20 h-8 w-8 p-0"
                      disabled={previewZoom <= 0.25}
                      title="缩小"
                    >
                      <ZoomOut className="w-4 h-4" />
                    </Button>
                    <span className="text-white text-xs w-12 text-center">
                      {Math.round(previewZoom * 100)}%
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleZoomIn();
                      }}
                      className="text-white hover:bg-white/20 h-8 w-8 p-0"
                      disabled={previewZoom >= 3}
                      title="放大"
                    >
                      <ZoomIn className="w-4 h-4" />
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      closePreview();
                    }}
                    className="text-white hover:bg-white/20 h-8 w-8 p-0"
                    title="关闭预览"
                    aria-label="关闭预览"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-2 sm:p-3">
                {isLoadingPreview && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-900/80 text-amber-100">
                    <div className="flex items-center gap-2 rounded-md border border-amber-300/25 bg-black/70 px-4 py-2 text-sm shadow-xl">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      正在加载高清预览
                    </div>
                  </div>
                )}
                <img
                  src={previewUrl}
                  alt={previewFile.filename}
                  className={`max-h-full max-w-full object-contain transition-[transform,opacity] duration-200 ${isLoadingPreview ? 'opacity-0' : 'opacity-100'}`}
                  style={{ transform: `scale(${previewZoom})` }}
                  onLoad={() => setIsLoadingPreview(false)}
                  onError={(event) => {
                    const image = event.currentTarget;
                    if (image.dataset.originalFallback === 'true') {
                      setIsLoadingPreview(false);
                      toast.error('图片预览加载失败，请稍后重试');
                      return;
                    }
                    image.dataset.originalFallback = 'true';
                    image.src = previewFile.originalUrl;
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
    
    {/* 删除确认对话框 */}
    {mounted && deleteConfirmFile && createPortal(
      <div 
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
        onClick={() => setDeleteConfirmFile(null)}
      >
        <div 
          className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-red-100 dark:bg-red-900 rounded-full">
              <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">确认删除</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                此操作无法撤销
              </p>
            </div>
          </div>
          
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
            确定要删除文件 <span className="font-medium">{deleteConfirmFile.file.name}</span> 吗？
            删除后文件将无法恢复。
          </p>
          
          <div className="flex gap-3 justify-end">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmFile(null)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteFile(deleteConfirmFile.folder, deleteConfirmFile.file)}
              disabled={deletingFile === deleteConfirmFile.file.name}
            >
              {deletingFile === deleteConfirmFile.file.name ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  删除中...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  确认删除
                </>
              )}
            </Button>
          </div>
        </div>
      </div>,
      document.body
    )}
  </>
  );
}
