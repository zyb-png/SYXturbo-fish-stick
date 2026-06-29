'use client';

import { useCallback, useEffect, useState } from 'react';
import { Coins, Gift, KeyRound, Loader2, LogOut, QrCode, RefreshCw, ShieldCheck, Snowflake, TrendingDown, WalletCards } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface WalletSnapshot {
  account: {
    id: string;
    name?: string;
    phone?: string;
    wechat?: string;
    status?: 'active' | 'pending' | 'disabled';
    createdAt?: string;
  } | null;
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
    initialPoints: number;
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

const DEFAULT_ADMIN_GIFT_POINTS = 500;

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

function isAdminGiftBatch(batch: WalletSnapshot['batches'][number]): boolean {
  return batch.source === 'bonus' || batch.label.includes('管理员赠送');
}

function isAdminGiftTransaction(transaction: WalletSnapshot['transactions'][number]): boolean {
  return transaction.type === 'grant' && transaction.description.includes('管理员赠送');
}

export function CreationPointsWallet() {
  const [open, setOpen] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [qrDialogMode, setQrDialogMode] = useState<'account' | 'recharge'>('account');
  const [loading, setLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<WalletSnapshot | null>(null);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });

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

  useEffect(() => {
    const openWallet = () => {
      setOpen(true);
    };
    const openLogin = () => {
      setOpen(true);
      setLoginOpen(true);
    };

    window.addEventListener('manfei:open-wallet', openWallet);
    window.addEventListener('manfei:open-login', openLogin);

    return () => {
      window.removeEventListener('manfei:open-wallet', openWallet);
      window.removeEventListener('manfei:open-login', openLogin);
    };
  }, []);

  const summary = snapshot?.summary;
  const account = snapshot?.account || null;
  const hasAccount = Boolean(account?.id);
  const displayedAvailablePoints = hasAccount ? (summary?.availablePoints || 0) : 0;
  const displayedFrozenPoints = hasAccount ? (summary?.frozenPoints || 0) : 0;
  const displayedConsumedPoints = hasAccount ? (summary?.consumedPoints || 0) : 0;
  const adminGiftBatches = snapshot?.batches.filter(isAdminGiftBatch) || [];
  const adminGiftTotalPoints = adminGiftBatches.reduce((sum, batch) => sum + Math.max(0, batch.initialPoints || 0), 0);
  const visibleTransactions = snapshot?.transactions
    .filter((transaction) => transaction.type !== 'freeze')
    .slice(0, 20) || [];
  const blackGoldButtonClass = 'gap-2 border border-amber-400/45 bg-[#0b0905] text-amber-100 shadow-[0_0_16px_rgba(245,158,11,0.18)] hover:bg-amber-500/15 hover:text-amber-50 disabled:border-amber-400/20 disabled:bg-black/30 disabled:text-amber-100/35';

  const handleLogin = async () => {
    setLoginLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '登录失败');
      }
      if (result.wallet) {
        setSnapshot(result.wallet);
      } else {
        await loadWallet(true);
      }
      setLoginForm({ username: '', password: '' });
      setLoginOpen(false);
      setOpen(true);
      window.dispatchEvent(new CustomEvent('manfei:wallet-updated'));
      toast.success('账号登录成功');
    } catch (loginError) {
      toast.error(loginError instanceof Error ? loginError.message : '登录失败');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      await loadWallet(true);
      toast.success('已退出账号');
    } catch {
      toast.error('退出登录失败');
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Coins className="h-4 w-4 text-amber-600" />
            创作点
            {summary && (
              <Badge variant="secondary" className="ml-1 tabular-nums">
                {formatPoints(displayedAvailablePoints)}
              </Badge>
            )}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[82vh] max-w-2xl overflow-y-auto border-amber-400/45 bg-[#070706] text-amber-100 shadow-[0_0_42px_rgba(245,158,11,0.18)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WalletCards className="h-5 w-5 text-amber-300" />
            创作点钱包
          </DialogTitle>
          <DialogDescription className="text-amber-100/62">
            先登录账号，再使用创作点；任务开始时预冻结，成功后扣除，失败自动退回。
          </DialogDescription>
        </DialogHeader>

        {loading && !snapshot ? (
          <div className="flex min-h-48 items-center justify-center text-amber-100/60">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            正在读取钱包
          </div>
        ) : error && !snapshot ? (
          <div className="rounded-md border border-red-400/35 bg-red-950/30 p-4 text-sm text-red-200">
            {error}
          </div>
        ) : snapshot && (
          <div className="space-y-5">
            <section className="rounded-md border border-amber-400/35 bg-[#11100d]/95 p-4 shadow-[inset_0_0_30px_rgba(245,158,11,0.04)]">
              {hasAccount ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-xs text-amber-300">当前账号</div>
                    <div className="mt-1 truncate text-lg font-semibold text-amber-50">
                      {account?.name || account?.id}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-amber-100/70">
                      <span>账号ID：{account?.id}</span>
                      {account?.wechat && <span>微信：{account.wechat}</span>}
                      {account?.phone && <span>手机：{account.phone}</span>}
                    </div>
                    {adminGiftTotalPoints > 0 && (
                      <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-amber-400/45 bg-black/35 px-3 py-2 text-sm font-semibold text-amber-100 shadow-[0_0_18px_rgba(245,158,11,0.18)]">
                        <Gift className="h-4 w-4 text-amber-300" />
                        管理员赠送额度：{formatPoints(adminGiftTotalPoints)} 点
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    className={blackGoldButtonClass}
                    onClick={() => {
                      setQrDialogMode('recharge');
                      setRechargeOpen(true);
                    }}
                  >
                    <QrCode className="h-4 w-4" />
                    充值
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className={blackGoldButtonClass}
                    onClick={() => void handleLogout()}
                  >
                    <LogOut className="h-4 w-4" />
                    退出登录
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-xs text-amber-300">登录账号</div>
                    <div className="mt-1 text-lg font-semibold text-amber-50">未登录账号</div>
                    <div className="mt-1 text-xs leading-5 text-amber-100/70">
                      初始创作点为 0。登录后默认获得管理员赠送 {formatPoints(DEFAULT_ADMIN_GIFT_POINTS)} 点。
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      className={blackGoldButtonClass}
                      onClick={() => {
                        setQrDialogMode('account');
                        setRechargeOpen(true);
                      }}
                    >
                      <QrCode className="h-4 w-4" />
                      获取账号
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className={blackGoldButtonClass}
                      onClick={() => setLoginOpen(true)}
                    >
                      <KeyRound className="h-4 w-4" />
                      登录账号
                    </Button>
                  </div>
                </div>
              )}
            </section>

            <div className="grid grid-cols-3 divide-x divide-amber-400/20 rounded-md border border-amber-400/30 bg-[#0b0a08]/80">
              <div className="px-4 py-4">
                <div className="text-xs text-amber-100/60">可用创作点</div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-emerald-300">
                  {formatPoints(displayedAvailablePoints)}
                </div>
              </div>
              <div className="px-4 py-4">
                <div className="flex items-center gap-1 text-xs text-amber-100/60">
                  <Snowflake className="h-3.5 w-3.5" />
                  任务冻结
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums">
                  {formatPoints(displayedFrozenPoints)}
                </div>
              </div>
              <div className="px-4 py-4">
                <div className="flex items-center gap-1 text-xs text-amber-100/60">
                  <TrendingDown className="h-3.5 w-3.5" />
                  累计消耗
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums">
                  {formatPoints(displayedConsumedPoints)}
                </div>
              </div>
            </div>

            {hasAccount && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium text-amber-100">额度批次</h3>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-amber-100/70 hover:bg-amber-500/10 hover:text-amber-100"
                  onClick={() => void loadWallet()}
                  disabled={loading}
                  title="刷新创作点"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
              <div className="divide-y divide-amber-400/15 rounded-md border border-amber-400/30 bg-[#0b0a08]/70">
                {snapshot.batches.map((batch) => {
                  const adminGift = isAdminGiftBatch(batch);
                  return (
                    <div
                      key={batch.id}
                      className={`flex items-center justify-between gap-4 px-3 py-3 text-sm ${
                        adminGift ? 'bg-amber-500/8' : ''
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{batch.label}</span>
                          {adminGift && (
                            <Badge className="border border-amber-400/45 bg-black/35 px-2 py-0.5 text-amber-100 shadow-[0_0_12px_rgba(245,158,11,0.16)] hover:bg-amber-500/10">
                              管理员赠送 {formatPoints(batch.initialPoints)} 点
                            </Badge>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-amber-100/55">
                          {batch.available ? `有效期至 ${formatDate(batch.expiresAt)}` : '已过期'}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className={`font-medium tabular-nums ${adminGift ? 'text-amber-300' : ''}`}>
                          {formatPoints(batch.remainingPoints)}
                        </div>
                        {adminGift && (
                          <div className="text-xs font-medium text-amber-300">
                            管理员赠送
                          </div>
                        )}
                        {batch.frozenPoints > 0 && (
                          <div className="text-xs text-amber-100/55">
                            冻结 {formatPoints(batch.frozenPoints)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
            )}

            {hasAccount && (
            <section>
              <h3 className="mb-2 text-sm font-medium text-amber-100">最近流水</h3>
              <div className="divide-y divide-amber-400/15 rounded-md border border-amber-400/30 bg-[#0b0a08]/70">
                {visibleTransactions.length === 0 ? (
                  <div className="px-3 py-8 text-center text-sm text-amber-100/55">暂无流水</div>
                ) : visibleTransactions.map((transaction) => {
                  const positive = transaction.type === 'grant' || transaction.type === 'refund';
                  const adminGift = isAdminGiftTransaction(transaction);
                  return (
                    <div key={transaction.id} className="flex items-center justify-between gap-4 px-3 py-2.5 text-sm">
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="truncate">{transaction.description}</span>
                          {adminGift && (
                            <Badge className="border border-amber-400/45 bg-black/35 text-amber-100 hover:bg-amber-500/10">
                              管理员赠送
                            </Badge>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-amber-100/55">
                          {formatTime(transaction.createdAt)} · {TRANSACTION_LABELS[transaction.type]}
                        </div>
                      </div>
                      <div className={`shrink-0 font-medium tabular-nums ${positive ? 'text-emerald-300' : ''}`}>
                        {positive ? '+' : '-'}{formatPoints(transaction.amount)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
            )}

            <div className="text-xs leading-5 text-amber-100/55">
              {hasAccount
                ? '当前账号创作点已接入文本、图片和视频任务。'
                : '未登录账号时创作点显示为 0；请点击“获取账号”添加好友开通额度。'}
            </div>
          </div>
        )}
        </DialogContent>
      </Dialog>

      <Dialog open={rechargeOpen} onOpenChange={setRechargeOpen}>
        <DialogTrigger asChild>
          <Button
            size="sm"
            className={blackGoldButtonClass}
            onClick={() => setQrDialogMode(hasAccount ? 'recharge' : 'account')}
          >
            <QrCode className="h-4 w-4" />
            {hasAccount ? '充值' : '获取账号'}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-sm border-amber-400/45 bg-[#070706] text-amber-100 shadow-[0_0_42px_rgba(245,158,11,0.18)]">
          <DialogHeader>
            <DialogTitle>{qrDialogMode === 'account' ? '扫码添加微信获取账号' : '扫码添加微信充值'}</DialogTitle>
            <DialogDescription className="text-amber-100/62">
              {qrDialogMode === 'account'
                ? '使用微信扫码添加好友，备注“获取账号”。'
                : '使用微信扫码添加好友，备注充值即可。'}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-amber-400/35 bg-[#11100d] p-3">
            <img
              src="/wechat-recharge-qr.jpg"
              alt="微信充值二维码"
              className="mx-auto w-full max-w-[280px] rounded-sm"
            />
          </div>
        </DialogContent>
      </Dialog>

      {!hasAccount && (
        <Button
          variant="outline"
          size="sm"
          className={blackGoldButtonClass}
          onClick={() => setLoginOpen(true)}
        >
          <KeyRound className="h-4 w-4" />
          登录账号
        </Button>
      )}

      <Button
        variant="outline"
        size="sm"
        className={blackGoldButtonClass}
        onClick={() => window.open('/admin/accounts', '_blank')}
      >
        <ShieldCheck className="h-4 w-4" />
        账号后台
      </Button>

      <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
        <DialogContent className="max-w-sm border-amber-400/45 bg-[#070706] text-amber-100 shadow-[0_0_42px_rgba(245,158,11,0.18)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-amber-300" />
              登录账号
            </DialogTitle>
            <DialogDescription className="text-amber-100/62">
              输入后台录入的账号和密码，登录后创作点会实时同步。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="wallet-login-username" className="text-amber-100/80">账号</Label>
              <Input
                id="wallet-login-username"
                value={loginForm.username}
                onChange={(event) => setLoginForm((current) => ({ ...current, username: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && loginForm.username && loginForm.password) void handleLogin();
                }}
                className="border-amber-400/30 bg-black/35 text-amber-50"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wallet-login-password" className="text-amber-100/80">密码</Label>
              <Input
                id="wallet-login-password"
                type="password"
                value={loginForm.password}
                onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && loginForm.username && loginForm.password) void handleLogin();
                }}
                className="border-amber-400/30 bg-black/35 text-amber-50"
              />
            </div>
            <Button
              className={`w-full ${blackGoldButtonClass}`}
              onClick={() => void handleLogin()}
              disabled={loginLoading || !loginForm.username || !loginForm.password}
            >
              {loginLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
              登录
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
