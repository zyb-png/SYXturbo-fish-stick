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
  Package,
  FileCode,
  Globe
} from 'lucide-react';
import { toast } from 'sonner';

interface ProjectExporterProps {
  onExport: (projectName: string) => Promise<void>;
  onExportHTML: (projectName: string) => Promise<void>;
  onImport: (file: File) => Promise<void>;
  isExporting?: boolean;
  isImporting?: boolean;
}

export function ProjectExporter({ 
  onExport, 
  onExportHTML,
  onImport, 
  isExporting = false, 
  isImporting = false 
}: ProjectExporterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [projectName, setProjectName] = useState('storyboard-project');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportZip = async () => {
    try {
      await onExport(projectName);
      setIsOpen(false);
      toast.success('ZIP项目包导出成功');
    } catch (error) {
      toast.error('导出失败: ' + (error instanceof Error ? error.message : '未知错误'));
    }
  };

  const handleExportHTML = async () => {
    try {
      await onExportHTML(projectName);
      setIsOpen(false);
      toast.success('HTML工程文件导出成功');
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
      await onImport(file);
      setIsOpen(false);
      toast.success('项目导入成功，页面即将刷新...');
      // 刷新页面以加载新状态
      setTimeout(() => {
        window.location.reload();
      }, 1500);
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileArchive className="w-5 h-5" />
            项目导入导出
          </DialogTitle>
          <DialogDescription>
            导出项目文件用于团队传输或备份，导入项目文件恢复工作进度
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-4">
          {/* 导出部分 */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Download className="w-4 h-4" />
              导出项目
            </h4>
            <div className="flex gap-2">
              <Input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="项目名称"
                className="flex-1"
              />
            </div>
            
            {/* 导出选项 */}
            <div className="grid grid-cols-2 gap-3">
              {/* HTML工程 */}
              <button
                onClick={handleExportHTML}
                disabled={isExporting || !projectName.trim()}
                className="flex flex-col items-center gap-2 p-4 border-2 border-purple-200 rounded-lg hover:border-purple-400 hover:bg-purple-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                  <Globe className="w-5 h-5 text-purple-600" />
                </div>
                <div className="text-center">
                  <div className="font-medium text-sm">HTML工程</div>
                  <div className="text-xs text-gray-500 mt-1">双击打开查看</div>
                </div>
                {isExporting ? (
                  <Loader2 className="w-4 h-4 animate-spin text-purple-600" />
                ) : (
                  <Badge variant="secondary" className="text-xs">推荐</Badge>
                )}
              </button>

              {/* ZIP包 */}
              <button
                onClick={handleExportZip}
                disabled={isExporting || !projectName.trim()}
                className="flex flex-col items-center gap-2 p-4 border-2 border-gray-200 rounded-lg hover:border-gray-400 hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                  <FileArchive className="w-5 h-5 text-gray-600" />
                </div>
                <div className="text-center">
                  <div className="font-medium text-sm">ZIP项目包</div>
                  <div className="text-xs text-gray-500 mt-1">完整数据备份</div>
                </div>
              </button>
            </div>

            {/* 导出说明 */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 bg-purple-50 rounded border border-purple-100">
                <p className="font-medium text-purple-700 mb-1">HTML工程</p>
                <ul className="text-purple-600 space-y-0.5">
                  <li>• 独立HTML文件，双击打开</li>
                  <li>• 离线查看，无需网络</li>
                  <li>• 适合分享和展示</li>
                </ul>
              </div>
              <div className="p-2 bg-gray-50 rounded border border-gray-200">
                <p className="font-medium text-gray-700 mb-1">ZIP项目包</p>
                <ul className="text-gray-600 space-y-0.5">
                  <li>• 包含所有素材文件</li>
                  <li>• 可导入恢复工作</li>
                  <li>• 适合团队协作</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="border-t pt-4" />

          {/* 导入部分 */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Upload className="w-4 h-4" />
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
                className="w-full"
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
            <div className="flex items-start gap-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded text-xs text-yellow-700 dark:text-yellow-400">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>导入将覆盖当前所有数据，请先导出备份</span>
            </div>
          </div>

          {/* 说明 */}
          <div className="space-y-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <h5 className="text-xs font-medium text-gray-700 dark:text-gray-300">项目文件包含：</h5>
            <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-400">
              <div className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-green-500" />
                项目元数据
              </div>
              <div className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-green-500" />
                工作状态
              </div>
              <div className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-green-500" />
                场景图片
              </div>
              <div className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-green-500" />
                人物图片
              </div>
              <div className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-green-500" />
                道具图片
              </div>
              <div className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-green-500" />
                分镜图片
              </div>
              <div className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-green-500" />
                视频文件
              </div>
              <div className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-green-500" />
                配置信息
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
