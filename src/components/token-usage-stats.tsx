'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { 
  Coins, 
  ArrowUpCircle, 
  ArrowDownCircle, 
  RefreshCw, 
  Trash2,
  ChevronRight,
  Info
} from 'lucide-react';
import { TokenUsage, calculateTotalTokens, INITIAL_TOKEN_USAGE } from '@/hooks/usePersistentState';

interface TokenUsageStatsProps {
  tokenUsage: TokenUsage;
  onClear: () => void;
  onRefresh?: () => void;
}

// 步骤名称映射
const STEP_NAMES: Record<string, string> = {
  upload: '文件上传',
  extractScenes: '场景提取',
  extractCharacters: '人物提取',
  extractProps: '道具提取',
  extractOutline: '大纲提取',
  generateStoryboard: '分镜生成',
  generateAssetImage: '素材图片',
  generateImageStoryboard: '图片分镜',
  generatePrompts: '提示词生成',
  generateVideo: '视频生成',
  regenerateStoryboardImage: '图片重生成',
  regenerateVideo: '视频重生成',
};

// 格式化token数量
function formatTokens(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(2)}M`;
  } else if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

// 格式化时间
function formatTimestamp(timestamp: number): string {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TokenUsageStats({ tokenUsage, onClear, onRefresh }: TokenUsageStatsProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  const total = calculateTotalTokens(tokenUsage);
  const hasUsage = total.total > 0;

  // 获取各步骤的使用详情
  const getStepDetails = () => {
    const details: { step: string; name: string; input: number; output: number; count: number; timestamps: number[] }[] = [];

    // 单次调用的步骤
    const singleSteps: (keyof TokenUsage)[] = [
      'upload', 'extractScenes', 'extractCharacters', 'extractProps', 
      'extractOutline', 'generateStoryboard', 'generatePrompts'
    ];

    singleSteps.forEach(step => {
      const item = tokenUsage[step];
      if (item && 'input' in item && (item.input > 0 || item.output > 0)) {
        details.push({
          step,
          name: STEP_NAMES[step] || step,
          input: item.input,
          output: item.output,
          count: 1,
          timestamps: [item.timestamp],
        });
      }
    });

    // 数组类型的步骤
    const arraySteps: (keyof TokenUsage)[] = [
      'generateAssetImage', 'generateImageStoryboard', 'generateVideo',
      'regenerateStoryboardImage', 'regenerateVideo'
    ];

    arraySteps.forEach(step => {
      const items = tokenUsage[step];
      if (Array.isArray(items) && items.length > 0) {
        const totalInput = items.reduce((sum, item) => sum + item.input, 0);
        const totalOutput = items.reduce((sum, item) => sum + item.output, 0);
        if (totalInput > 0 || totalOutput > 0) {
          details.push({
            step,
            name: STEP_NAMES[step] || step,
            input: totalInput,
            output: totalOutput,
            count: items.length,
            timestamps: items.map(item => item.timestamp).filter(t => t > 0),
          });
        }
      }
    });

    return details.sort((a, b) => (b.input + b.output) - (a.input + a.output));
  };

  const stepDetails = getStepDetails();

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Coins className="w-4 h-4" />
          Token统计
          {hasUsage && (
            <Badge variant="secondary" className="ml-1 text-xs">
              {formatTokens(total.total)}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="w-5 h-5 text-yellow-500" />
            Token 消耗统计
          </DialogTitle>
          <DialogDescription>
            查看各步骤的Token消耗详情，帮助优化成本
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* 总览卡片 */}
          <Card className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20">
            <CardContent className="pt-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                    {formatTokens(total.input)}
                  </div>
                  <div className="text-sm text-gray-500 flex items-center justify-center gap-1 mt-1">
                    <ArrowUpCircle className="w-3 h-3" />
                    输入Token
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                    {formatTokens(total.output)}
                  </div>
                  <div className="text-sm text-gray-500 flex items-center justify-center gap-1 mt-1">
                    <ArrowDownCircle className="w-3 h-3" />
                    输出Token
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {formatTokens(total.total)}
                  </div>
                  <div className="text-sm text-gray-500 flex items-center justify-center gap-1 mt-1">
                    <Coins className="w-3 h-3" />
                    总计
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 说明 */}
          <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-sm text-yellow-700 dark:text-yellow-400 flex items-start gap-2">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <p>Token消耗估算说明：</p>
              <ul className="list-disc list-inside mt-1 text-xs space-y-1">
                <li>输入Token = 系统提示词 + 用户输入内容的字符数估算</li>
                <li>输出Token = 模型生成内容的字符数估算</li>
                <li>中文约1字符≈1-2 Token，英文约4字符≈1 Token</li>
                <li>实际消耗可能因模型不同略有差异</li>
              </ul>
            </div>
          </div>

          {/* 详细列表 */}
          {stepDetails.length > 0 ? (
            <div className="space-y-2">
              <h4 className="font-medium text-sm text-gray-500">各步骤详情</h4>
              {stepDetails.map((detail, index) => (
                <div 
                  key={detail.step} 
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="w-6 h-6 rounded-full p-0 flex items-center justify-center text-xs">
                      {index + 1}
                    </Badge>
                    <div>
                      <div className="font-medium text-sm">{detail.name}</div>
                      <div className="text-xs text-gray-500">
                        {detail.count > 1 && `${detail.count} 次调用`}
                        {detail.timestamps.length > 0 && ` · 最近 ${formatTimestamp(detail.timestamps[detail.timestamps.length - 1])}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="text-blue-600 dark:text-blue-400">
                      ↑{formatTokens(detail.input)}
                    </div>
                    <div className="text-purple-600 dark:text-purple-400">
                      ↓{formatTokens(detail.output)}
                    </div>
                    <div className="font-medium w-16 text-right">
                      {formatTokens(detail.input + detail.output)}
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Coins className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>暂无Token消耗记录</p>
              <p className="text-sm">开始使用后将自动统计</p>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex gap-2 pt-4 border-t">
            {onRefresh && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                className="gap-1"
              >
                <RefreshCw className="w-4 h-4" />
                刷新
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(tokenUsage, null, 2));
              }}
              disabled={!hasUsage}
            >
              复制统计数据
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={() => {
                onClear();
                setIsOpen(false);
              }}
              disabled={!hasUsage}
            >
              <Trash2 className="w-4 h-4 mr-1" />
              清除统计
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// 简化版Token统计显示（用于header）
export function TokenUsageBadge({ tokenUsage }: { tokenUsage: TokenUsage }) {
  const total = calculateTotalTokens(tokenUsage);
  
  if (total.total === 0) return null;

  return (
    <div className="flex items-center gap-2 px-2 py-1 text-xs bg-yellow-50 dark:bg-yellow-900/20 rounded-full">
      <Coins className="w-3 h-3 text-yellow-500" />
      <span className="font-medium text-yellow-700 dark:text-yellow-400">
        {formatTokens(total.total)} tokens
      </span>
    </div>
  );
}
