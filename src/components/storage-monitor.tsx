'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw, Download, Trash2 } from 'lucide-react';
import LZString from 'lz-string';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

function parseStoredValue(raw: string) {
  const value = raw.startsWith('LZ:')
    ? LZString.decompressFromUTF16(raw.slice(3)) || raw
    : raw;
  return JSON.parse(value);
}

const ESTIMATED_LOCAL_STORAGE_QUOTA = 5 * 1024 * 1024;

/**
 * 存储空间监控组件
 * 监控 localStorage 使用情况，当空间不足时显示警告
 */
export function StorageMonitor() {
  const [showWarning, setShowWarning] = useState(false);
  const [storageInfo, setStorageInfo] = useState<{
    quotaUsed: number;
    quotaRemaining: number;
    totalSize: number;
  } | null>(null);

  useEffect(() => {
    // 每30秒检查一次存储空间
    const checkStorage = () => {
      if (typeof window === 'undefined') return;

      try {
        let usedSpace = 0;
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (key) {
            const value = window.localStorage.getItem(key);
            if (value) {
              usedSpace += new Blob([value]).size;
            }
          }
        }

        const quotaUsed = (usedSpace / ESTIMATED_LOCAL_STORAGE_QUOTA) * 100;
        const quotaRemaining = ESTIMATED_LOCAL_STORAGE_QUOTA - usedSpace;

        setStorageInfo({ quotaUsed, quotaRemaining, totalSize: usedSpace });

        // 当使用超过 80% 时显示警告
        if (quotaUsed > 80) {
          setShowWarning(true);
        }
      } catch (error) {
        console.error('[StorageMonitor] 检查存储空间失败:', error);
      }
    };

    checkStorage();
    const interval = setInterval(checkStorage, 30000);

    return () => clearInterval(interval);
  }, []);

  const handleClearStorage = async () => {
    if (typeof window === 'undefined') return;

    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key?.startsWith('storyboard_')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => window.localStorage.removeItem(key));
      await fetch('/api/project-state', { method: 'DELETE' });

      toast.success('存储已清理', {
        description: `已清除 ${keysToRemove.length} 项数据`,
      });

      setShowWarning(false);
      setStorageInfo({ quotaUsed: 0, quotaRemaining: ESTIMATED_LOCAL_STORAGE_QUOTA, totalSize: 0 });

      // 刷新页面
      window.location.reload();
    } catch (error) {
      toast.error('清理失败', {
        description: error instanceof Error ? error.message : '未知错误',
      });
    }
  };

  const handleReleaseBrowserStorage = async () => {
    if (typeof window === 'undefined') return;

    try {
      const state: Record<string, string> = {};
      const keysToRemove: string[] = [];

      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key?.startsWith('storyboard_')) {
          const value = window.localStorage.getItem(key);
          if (value) {
            state[key] = value;
          }
          keysToRemove.push(key);
        }
      }

      if (Object.keys(state).length > 0) {
        const response = await fetch('/api/project-state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state }),
        });

        if (!response.ok) {
          throw new Error(`备份失败：HTTP ${response.status}`);
        }
      }

      keysToRemove.forEach(key => window.localStorage.removeItem(key));

      toast.success('浏览器缓存已释放', {
        description: '项目数据仍保留在本机文件备份中，页面将自动恢复。',
      });

      setShowWarning(false);
      setStorageInfo({ quotaUsed: 0, quotaRemaining: ESTIMATED_LOCAL_STORAGE_QUOTA, totalSize: 0 });
      window.location.reload();
    } catch (error) {
      toast.error('释放缓存失败', {
        description: error instanceof Error ? error.message : '未知错误',
      });
    }
  };

  const handleExportData = () => {
    if (typeof window === 'undefined') return;

    try {
      const data: Record<string, any> = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key?.startsWith('storyboard_')) {
          try {
            const raw = window.localStorage.getItem(key);
            if (raw) {
              data[key] = parseStoredValue(raw);
            }
          } catch (e) {
            // ignore
          }
        }
      }

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `storyboard-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success('数据导出成功', {
        description: '请保存备份文件，然后可以清除存储',
      });
    } catch (error) {
      toast.error('导出失败', {
        description: error instanceof Error ? error.message : '未知错误',
      });
    }
  };

  return (
    <>
      {/* 存储使用情况指示器 */}
      {storageInfo && storageInfo.quotaUsed > 50 && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm">
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    存储空间使用
                  </span>
                  <span className={`text-xs font-medium ${
                    storageInfo.quotaUsed > 80 ? 'text-red-500' : 'text-yellow-500'
                  }`}>
                    {storageInfo.quotaUsed.toFixed(1)}%
                  </span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      storageInfo.quotaUsed > 80 ? 'bg-red-500' : 'bg-yellow-500'
                    }`}
                    style={{ width: `${storageInfo.quotaUsed}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  已使用 {(storageInfo.totalSize / 1024).toFixed(2)} KB / 总计 {(ESTIMATED_LOCAL_STORAGE_QUOTA / 1024).toFixed(0)} KB，剩余 {(storageInfo.quotaRemaining / 1024).toFixed(2)} KB
                </p>
                {storageInfo.quotaUsed > 50 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3 w-full"
                    onClick={() => setShowWarning(true)}
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    管理存储空间
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 警告对话框 */}
      <AlertDialog open={showWarning} onOpenChange={setShowWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              存储空间即将用尽
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  您的浏览器存储空间已使用超过 <strong>{storageInfo?.quotaUsed.toFixed(1)}%</strong>，
                  剩余空间不足。这里指浏览器缓存，保守总额度按 <strong>5MB</strong> 估算；项目状态会同步写入本机文件备份。
                </p>
                <div className="bg-gray-100 dark:bg-gray-800 rounded p-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">已使用:</span>
                    <span className="font-medium">{storageInfo ? `${(storageInfo.totalSize / 1024).toFixed(2)} KB` : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">剩余空间:</span>
                    <span className="font-medium text-yellow-600 dark:text-yellow-400">
                      {storageInfo ? `${(storageInfo.quotaRemaining / 1024).toFixed(2)} KB` : 'N/A'}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  如果要删除当前项目内容，请先备份，然后手动清除全部存储。
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-col gap-2">
            <Button
              className="w-full"
              onClick={handleReleaseBrowserStorage}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              释放浏览器缓存（保留项目）
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={handleExportData}
            >
              <Download className="w-4 h-4 mr-2" />
              备份数据
            </Button>
            <Button
              variant="destructive"
              className="w-full"
              onClick={handleClearStorage}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              清除全部数据
            </Button>
            <AlertDialogCancel className="w-full">
              稍后处理
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
