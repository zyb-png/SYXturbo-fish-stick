'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Download, 
  Upload, 
  FileArchive, 
  Loader2,
  CheckCircle2,
  AlertCircle,
  Package
} from 'lucide-react';
import { toast } from 'sonner';

interface ProjectExporterProps {
  onExport: (projectName: string) => Promise<boolean | void>;
  onImport: (file: File) => Promise<boolean | void>;
  isExporting?: boolean;
  isImporting?: boolean;
}

export function ProjectExporter({ 
  onExport, 
  onImport, 
  isExporting = false, 
  isImporting = false 
}: ProjectExporterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [projectName, setProjectName] = useState('storyboard-project');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportZip = async () => {
    try {
      const exported = await onExport(projectName);
      if (exported === false) return;
      setIsOpen(false);
    } catch (error) {
      toast.error('导出失败: ' + (error instanceof Error ? error.message : '未知错误'));
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.zip')) {
      toast.error('请上传 .zip 格式的项目文件');
      return;
    }

    try {
      const imported = await onImport(file);
      if (imported === false) return;
      setIsOpen(false);
    } catch (error) {
      toast.error('导入失败: ' + (error instanceof Error ? error.message : '未知错误'));
    }

    // 重置 input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Package className="w-4 h-4" />
          项目文件
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg border-amber-400/45 bg-[#070706] text-amber-100 shadow-[0_0_46px_rgba(245,158,11,0.18)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-100">
            <FileArchive className="w-5 h-5 text-amber-300" />
            项目导入导出
          </DialogTitle>
          <DialogDescription className="text-amber-100/65">
            完整项目会保存为 .zip，包含当前工作状态和本地素材；再次使用时导入 ZIP 即可恢复编辑。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-4">
          {/* 导出部分 */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium flex items-center gap-2 text-amber-100">
              <Download className="w-4 h-4 text-amber-300" />
              导出项目
            </h4>
            <div className="flex gap-2">
              <Input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="项目名称"
                className="flex-1 border-amber-400/35 bg-black/35 text-amber-50 placeholder:text-amber-100/35 focus-visible:ring-amber-300"
              />
            </div>
            
            <div className="rounded-md border border-amber-400/35 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100/78">
              点击“保存完整项目”后会打包当前工作状态和本地素材，并稳定保存到系统下载目录：Downloads/AI故事分镜视频生成器/项目文件。
            </div>

            {/* 导出选项 */}
            <div className="grid grid-cols-1 gap-3">
              {/* ZIP包 */}
              <button
                onClick={handleExportZip}
                disabled={isExporting || !projectName.trim()}
                className="flex flex-col items-center gap-2 rounded-md border border-amber-400/60 bg-black/25 p-4 text-amber-100 transition-all hover:border-amber-300 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-amber-300/40 bg-amber-400/14">
                  <FileArchive className="h-5 w-5 text-amber-300" />
                </div>
                <div className="text-center">
                  <div className="text-sm font-medium">保存完整项目</div>
                  <div className="mt-1 text-xs text-amber-100/48">ZIP，可导入继续编辑</div>
                </div>
                {isExporting ? (
                  <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
                ) : (
                  <Badge className="border border-amber-300/30 bg-amber-500/12 text-xs text-amber-100 hover:bg-amber-500/16">推荐备份</Badge>
                )}
              </button>
            </div>

            {/* 导出说明 */}
            <div className="grid grid-cols-1 gap-2 text-xs">
              <div className="rounded-md border border-amber-400/25 bg-black/28 p-3">
                <p className="font-medium text-amber-200 mb-1">ZIP完整项目</p>
                <ul className="text-amber-100/62 space-y-0.5">
                  <li>• 包含当前全部工作状态</li>
                  <li>• 包含本地素材、图片、视频</li>
                  <li>• 可导入恢复工作</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="border-t border-amber-400/18 pt-4" />

          {/* 导入部分 */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium flex items-center gap-2 text-amber-100">
              <Upload className="w-4 h-4 text-amber-300" />
              导入项目
            </h4>
            <div className="flex flex-col gap-2">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImport}
                accept=".zip"
                className="hidden"
              />
              <Button
                variant="outline"
                className="w-full border-amber-400/35 bg-black/25 text-amber-100 hover:border-amber-300 hover:bg-amber-500/10 hover:text-amber-50"
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
              >
                {isImporting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    正在导入...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    选择ZIP项目文件
                  </>
                )}
              </Button>
            </div>
            <div className="flex items-start gap-2 rounded-md border border-amber-400/25 bg-amber-500/10 p-2 text-xs text-amber-100/74">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-300" />
              <span>导入 ZIP 将覆盖当前所有数据；再次使用时请在这里选择之前保存的完整项目 ZIP。</span>
            </div>
          </div>

          {/* 说明 */}
          <div className="space-y-2 rounded-md border border-amber-400/25 bg-black/28 p-3">
            <h5 className="text-xs font-medium text-amber-200">项目文件包含：</h5>
            <div className="grid grid-cols-2 gap-2 text-xs text-amber-100/62">
              <div className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-amber-300" />
                项目元数据
              </div>
              <div className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-amber-300" />
                工作状态
              </div>
              <div className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-amber-300" />
                场景图片
              </div>
              <div className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-amber-300" />
                人物图片
              </div>
              <div className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-amber-300" />
                道具图片
              </div>
              <div className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-amber-300" />
                分镜图片
              </div>
              <div className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-amber-300" />
                视频文件
              </div>
              <div className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-amber-300" />
                配置信息
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
