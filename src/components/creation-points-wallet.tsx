'use client';

import { useCallback, useEffect, useState } from 'react';
import { Coins, Loader2, RefreshCw, Snowflake, TrendingDown, WalletCards } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface WalletSnapshot {
  summary: {
    availablePoints: number;
    frozenPoints: number;
    consumedPoints: number;
    totalGrantedPoints: number;
  };
  batches: Array<{
    id: string;
    label: string;
    source: string;
    remainingPoints: number;
    frozenPoints: number;
    expiresAt: string | null;
    available: boolean;
  }>;
  pricing: Array<{
    featureCode: string;
    name: string;
    unit: string;
    unitPoints: number;
    pricingDescription?: string;
    minimumPoints?: number;
    maximumPoints?: number;
    billingEnabled: boolean;
  }>;
  transactions: Array<{
    id: string;
    type: 'grant' | 'freeze' | 'consume' | 'refund';
    amount: number;
    description: string;
    createdAt: string;
  }>;
}

const TRANSACTION_LABELS = {
  grant: '发放',
  freeze: '冻结',
  consume: '扣除',
  refund: '退回',
};

function formatPoints(value: number): string {
  return Math.max(0, value || 0).toLocaleString('zh-CN');
}

function formatDate(value: string | null): string {
  if (!value) return '长期有效';
  return new Date(value).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function CreationPointsWallet() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<WalletSnapshot | null>(null);

  const loadWallet = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch('/api/creation-points', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '读取创作点失败');
      }
      setSnapshot(result);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取创作点失败');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWallet();
    const timer = window.setInterval(() => void loadWallet(true), 5_000);
    return () => window.clearInterval(timer);
  }, [loadWallet]);

  useEffect(() => {
    if (open) void loadWallet();
  }, [open, loadWallet]);

  const summary = snapshot?.summary;
  const activePricing = snapshot?.pricing.filter((item) => item.billingEnabled) || [];
  const visibleTransactions = snapshot?.transactions
    .filter((transaction) => transaction.type !== 'freeze')
    .slice(0, 20) || [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Coins className="h-4 w-4 text-amber-600" />
          创作点
          {summary && (
            <Badge variant="secondary" className="ml-1 tabular-nums">
              {formatPoints(summary.availablePoints)}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[82vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WalletCards className="h-5 w-5 text-amber-600" />
            创作点钱包
          </DialogTitle>
          <DialogDescription>
            任务开始时预冻结，成功后扣除，失败自动退回。
          </DialogDescription>
        </DialogHeader>

        {loading && !snapshot ? (
          <div className="flex min-h-48 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            正在读取钱包
          </div>
        ) : error && !snapshot ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : snapshot && (
          <div className="space-y-5">
            <div className="grid grid-cols-3 divide-x rounded-md border bg-muted/20">
              <div className="px-4 py-4">
                <div className="text-xs text-muted-foreground">可用创作点</div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-emerald-700">
                  {formatPoints(snapshot.summary.availablePoints)}
                </div>
              </div>
              <div className="px-4 py-4">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Snowflake className="h-3.5 w-3.5" />
                  任务冻结
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums">
                  {formatPoints(snapshot.summary.frozenPoints)}
                </div>
              </div>
              <div className="px-4 py-4">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <TrendingDown className="h-3.5 w-3.5" />
                  累计消耗
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums">
                  {formatPoints(snapshot.summary.consumedPoints)}
                </div>
              </div>
            </div>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium">额度批次</h3>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => void loadWallet()}
                  disabled={loading}
                  title="刷新创作点"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
              <div className="divide-y rounded-md border">
                {snapshot.batches.map((batch) => (
                  <div key={batch.id} className="flex items-center justify-between gap-4 px-3 py-3 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium">{batch.label}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {batch.available ? `有效期至 ${formatDate(batch.expiresAt)}` : '已过期'}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-medium tabular-nums">{formatPoints(batch.remainingPoints)}</div>
                      {batch.frozenPoints > 0 && (
                        <div className="text-xs text-muted-foreground">
                          冻结 {formatPoints(batch.frozenPoints)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-medium">功能价格</h3>
              <div className="grid grid-cols-1 divide-y rounded-md border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                <div className="divide-y">
                  {activePricing.slice(0, Math.ceil(activePricing.length / 2)).map((item) => (
                    <div key={item.featureCode} className="px-3 py-2.5 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span>{item.name}</span>
                        {!item.pricingDescription && (
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {formatPoints(item.unitPoints)} / {item.unit}
                            {item.minimumPoints ? `，最低 ${formatPoints(item.minimumPoints)}` : ''}
                            {item.maximumPoints ? `，最高 ${formatPoints(item.maximumPoints)}` : ''}
                          </span>
                        )}
                      </div>
                      {item.pricingDescription && (
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">
                          {item.unitPoints > 0 ? `${formatPoints(item.unitPoints)} 点/张；` : ''}{item.pricingDescription}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="divide-y">
                  {activePricing.slice(Math.ceil(activePricing.length / 2)).map((item) => (
                    <div key={item.featureCode} className="px-3 py-2.5 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span>{item.name}</span>
                        {!item.pricingDescription && (
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {formatPoints(item.unitPoints)} / {item.unit}
                            {item.minimumPoints ? `，最低 ${formatPoints(item.minimumPoints)}` : ''}
                            {item.maximumPoints ? `，最高 ${formatPoints(item.maximumPoints)}` : ''}
                          </span>
                        )}
                      </div>
                      {item.pricingDescription && (
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">
                          {item.unitPoints > 0 ? `${formatPoints(item.unitPoints)} 点/张；` : ''}{item.pricingDescription}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-medium">最近流水</h3>
              <div className="divide-y rounded-md border">
                {visibleTransactions.length === 0 ? (
                  <div className="px-3 py-8 text-center text-sm text-muted-foreground">暂无流水</div>
                ) : visibleTransactions.map((transaction) => {
                  const positive = transaction.type === 'grant' || transaction.type === 'refund';
                  return (
                    <div key={transaction.id} className="flex items-center justify-between gap-4 px-3 py-2.5 text-sm">
                      <div className="min-w-0">
                        <div className="truncate">{transaction.description}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {formatTime(transaction.createdAt)} · {TRANSACTION_LABELS[transaction.type]}
                        </div>
                      </div>
                      <div className={`shrink-0 font-medium tabular-nums ${positive ? 'text-emerald-700' : ''}`}>
                        {positive ? '+' : '-'}{formatPoints(transaction.amount)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="text-xs leading-5 text-muted-foreground">
              当前为本机单用户钱包，创作点已接入文本、图片和视频任务。支付充值、企业额度分配和多用户账户接口已预留，尚未连接支付渠道。
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
