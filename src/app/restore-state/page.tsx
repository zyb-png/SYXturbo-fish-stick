'use client';

import { useEffect, useState } from 'react';

export default function RestoreStatePage() {
  const [message, setMessage] = useState('正在恢复本地备份...');

  useEffect(() => {
    try {
      const keysToRemove: string[] = [];
      for (let index = 0; index < window.localStorage.length; index++) {
        const key = window.localStorage.key(index);
        if (key?.startsWith('storyboard_')) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach(key => window.localStorage.removeItem(key));
      setMessage(`已清理 ${keysToRemove.length} 项浏览器旧缓存，正在重新读取本地备份...`);

      window.setTimeout(() => {
        window.location.replace(`/?restored=${Date.now()}`);
      }, 800);
    } catch (error) {
      console.error('恢复本地备份失败:', error);
      setMessage('恢复本地备份失败，请关闭页面后重新打开。');
    }
  }, []);

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 flex items-center justify-center p-8">
      <div className="max-w-md rounded-lg border bg-white p-6 text-center shadow-sm">
        <h1 className="text-xl font-semibold mb-3">恢复本地备份</h1>
        <p className="text-sm text-gray-600">{message}</p>
      </div>
    </main>
  );
}
