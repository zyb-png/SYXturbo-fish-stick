'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Loader2, Image as ImageIcon, Check, FolderOpen } from 'lucide-react';
import { getAssetThumbnailUrl } from '@/lib/asset-image-url';

interface ImageFile {
  name: string;
  size?: number;
  sizeFormatted?: string;
  createdAt?: string;
  modifiedAt?: string;
  // S3 相关字段
  key?: string;
  fileName?: string;
  timestamp?: number;
  url?: string;
}

interface FolderData {
  count: number;
  size?: number;
  files: ImageFile[];
}

interface ImageLibrarySelectorProps {
  open: boolean;
  onClose: () => void;
  onSelect: (imageUrl: string, imageName: string) => void;
  currentType?: 'scene' | 'character' | 'prop';
}

const FOLDER_MAP: Record<string, { name: string; key: string }> = {
  scenes: { name: '场景图片', key: 'scenes' },
  characters: { name: '人物图片', key: 'characters' },
  props: { name: '道具图片', key: 'props' },
  storyboards: { name: '分镜图片', key: 'storyboards' },
};

export function ImageLibrarySelector({ open, onClose, onSelect, currentType }: ImageLibrarySelectorProps) {
  const [loading, setLoading] = useState(true);
  const [folders, setFolders] = useState<Record<string, FolderData>>({});
  const [selectedImage, setSelectedImage] = useState<{ url: string; name: string } | null>(null);
  const [activeTab, setActiveTab] = useState<string>('scenes');

  // 根据当前类型自动切换到对应标签
  useEffect(() => {
    if (currentType && open) {
      const tabMap: Record<string, string> = {
        scene: 'scenes',
        character: 'characters',
        prop: 'props',
      };
      setActiveTab(tabMap[currentType] || 'scenes');
    }
  }, [currentType, open]);

  // 加载图片库数据
  useEffect(() => {
    if (open) {
      loadImages();
    }
  }, [open]);

  const loadImages = async () => {
    setLoading(true);
    try {
      // 先尝试从 S3 获取图片
      let data;
      try {
        const s3Response = await fetch('/api/s3-assets-list');
        const s3Data = await s3Response.json();
        if (s3Data.success && Object.values(s3Data.folders as Record<string, { count: number }>).some((f: { count: number }) => f.count > 0)) {
          data = s3Data;
          console.log('从 S3 加载图片库成功');
        }
      } catch (s3Error) {
        console.log('S3 图片库加载失败，尝试本地文件系统:', s3Error);
      }

      // 如果 S3 没有数据，尝试从本地文件系统获取
      if (!data || !Object.values(data.folders as Record<string, { count: number }>).some((f: { count: number }) => f.count > 0)) {
        const localResponse = await fetch('/api/assets-list');
        const localData = await localResponse.json();
        if (localData.success) {
          data = localData;
          console.log('从本地文件系统加载图片库成功');
        }
      }

      if (data && data.success) {
        setFolders(data.folders);
      }
    } catch (error) {
      console.error('加载图片库失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = () => {
    if (selectedImage) {
      onSelect(selectedImage.url, selectedImage.name);
      setSelectedImage(null);
      onClose();
    }
  };

  const getImageUrl = (folder: string, filename: string) => {
    return `/api/assets-view?folder=${encodeURIComponent(folder)}&filename=${encodeURIComponent(filename)}`;
  };

  // 计算总图片数
  const totalImages = Object.values(folders).reduce((sum, f) => sum + f.count, 0);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5" />
            从图片库选择
          </DialogTitle>
          <DialogDescription>
            选择一张已有的图片添加到素材中。共 {totalImages} 张图片可选。
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        ) : totalImages === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500">
            <ImageIcon className="w-16 h-16 mb-4 opacity-50" />
            <p>图片库中暂无图片</p>
            <p className="text-sm">请先生成或上传图片</p>
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="w-full justify-start">
              {Object.entries(FOLDER_MAP).map(([key, { name }]) => (
                <TabsTrigger key={key} value={key} className="gap-1">
                  {name}
                  {folders[key]?.count > 0 && (
                    <Badge variant="secondary" className="ml-1 text-xs">
                      {folders[key].count}
                    </Badge>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>

            {Object.entries(FOLDER_MAP).map(([key, { name }]) => (
              <TabsContent key={key} value={key} className="mt-4">
                {folders[key]?.count === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-gray-500">
                    <ImageIcon className="w-12 h-12 mb-2 opacity-50" />
                    <p>该分类暂无图片</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 max-h-[min(62vh,620px)] overflow-y-auto p-1 pr-2">
                    {folders[key]?.files.map((file, index) => {
                      // S3 数据有 url 字段，本地数据需要构建 URL
                      const imageUrl = file.url || getImageUrl(name, file.name);
                      const displayName = file.fileName || file.name;
                      const isSelected = selectedImage?.url === imageUrl;

                      return (
                        <div
                          key={file.key || file.name || index}
                          className={`group relative rounded-lg overflow-hidden cursor-pointer border transition-all bg-black/30 ${
                            isSelected
                              ? 'border-amber-400 ring-2 ring-amber-400/40'
                              : 'border-amber-400/15 hover:border-amber-300/60'
                          }`}
                          onClick={() => setSelectedImage({ url: imageUrl, name: displayName })}
                          title={displayName}
                        >
                          <div className="flex aspect-[4/3] items-center justify-center bg-neutral-950/70">
                            {imageUrl ? (
                              <img
                                src={getAssetThumbnailUrl(imageUrl, 520, 72)}
                                alt={displayName}
                                loading="lazy"
                                decoding="async"
                                fetchPriority="low"
                                className="h-full w-full object-contain p-1 transition-transform duration-200 group-hover:scale-[1.02]"
                              />
                            ) : (
                              <ImageIcon className="h-10 w-10 text-muted-foreground" />
                            )}
                          </div>
                          <div className="border-t border-amber-400/10 bg-black/55 px-2 py-1.5">
                            <div className="truncate text-xs text-amber-50/85">
                              {displayName}
                            </div>
                            {file.sizeFormatted && (
                              <div className="mt-0.5 truncate text-[11px] text-amber-100/45">
                                {file.sizeFormatted}
                              </div>
                            )}
                          </div>
                          {isSelected && (
                            <div className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-black shadow">
                              <Check className="w-4 h-4" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>
            ))}
          </Tabs>
        )}

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSelect} disabled={!selectedImage}>
            {selectedImage ? '选择此图片' : '请选择图片'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
