'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Lock, Plus, RefreshCw, ShieldCheck, Users, WalletCards } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/password-input';

interface AdminAccountRow {
  id: string;
  username: string;
  name?: string;
  phone?: string;
  idNumber?: string;
  wechat?: string;
  status: 'active' | 'disabled' | 'frozen';
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  wallet: {
    availablePoints: number;
    frozenPoints: number;
    consumedPoints: number;
    totalGrantedPoints: number;
  };
}

interface AccountPointsDraft {
  addPoints: string;
  deductPoints: string;
}

function formatPoints(value: number): string {
  return Math.max(0, value || 0).toLocaleString('zh-CN');
}

function formatTime(value?: string): string {
  if (!value) return '暂无';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function createDraft(): AccountPointsDraft {
  return {
    addPoints: '',
    deductPoints: '',
  };
}

function readonlyValue(value?: string): string {
  return value?.trim() || '未填写';
}

function getStatusBadgeClass(status: AdminAccountRow['status']): string {
  if (status === 'active') return 'bg-emerald-500/20 text-emerald-200';
  if (status === 'frozen') return 'bg-amber-500/20 text-amber-100';
  return 'bg-red-500/20 text-red-200';
}

function getStatusLabel(status: AdminAccountRow['status']): string {
  if (status === 'active') return '启用';
  if (status === 'frozen') return '冻结';
  return '停用';
}

export default function AdminAccountsPage() {
  const [authorized, setAuthorized] = useState(false);
  const [adminUsername, setAdminUsername] = useState('manfei');
  const [adminPassword, setAdminPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<AdminAccountRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, AccountPointsDraft>>({});
  const [error, setError] = useState('');
  const [newAccount, setNewAccount] = useState({
    username: '',
    password: '',
    name: '',
    phone: '',
    idNumber: '',
    wechat: '',
  });

  const totalAvailable = useMemo(
    () => accounts.reduce((sum, account) => sum + account.wallet.availablePoints, 0),
    [accounts]
  );

  const displayAccounts = useMemo(() => (
    [...accounts].sort((a, b) => {
      const aName = (a.name || a.username || '').trim();
      const bName = (b.name || b.username || '').trim();
      return aName.localeCompare(bName, 'zh-CN') || a.username.localeCompare(b.username, 'zh-CN');
    })
  ), [accounts]);

  const applyAccounts = useCallback((rows: AdminAccountRow[]) => {
    setAccounts(rows);
    setDrafts((previous) => {
      const next: Record<string, AccountPointsDraft> = {};
      for (const account of rows) {
        next[account.id] = previous[account.id] || createDraft();
        next[account.id].addPoints = previous[account.id]?.addPoints ?? '';
        next[account.id].deductPoints = previous[account.id]?.deductPoints ?? '';
      }
      return next;
    });
  }, []);

  const loadAccounts = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch('/api/admin/accounts', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.success) {
        setAuthorized(false);
        throw new Error(result.error || '请先登录后台');
      }
      setAuthorized(true);
      setError('');
      applyAccounts(result.accounts || []);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : '读取后台失败';
      if (!quiet) setError(message);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [applyAccounts]);

  useEffect(() => {
    void loadAccounts(true);
  }, [loadAccounts]);

  useEffect(() => {
    if (!authorized) return;
    const timer = window.setInterval(() => void loadAccounts(true), 5_000);
    return () => window.clearInterval(timer);
  }, [authorized, loadAccounts]);

  const loginAdmin = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: adminUsername, password: adminPassword }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '后台账号或密码错误');
      }
      setAuthorized(true);
      setAdminPassword('');
      toast.success('后台已登录');
      await loadAccounts(true);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '后台登录失败');
    } finally {
      setLoading(false);
    }
  };

  const postAction = async (payload: Record<string, unknown>, successMessage: string) => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '操作失败');
      }
      applyAccounts(result.accounts || []);
      setError('');
      toast.success(successMessage);
      return true;
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : '操作失败';
      setError(message);
      toast.error(message);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const createAccount = async () => {
    const created = await postAction({
      action: 'create',
      ...newAccount,
    }, '账号已创建');
    if (!created) return;
    setNewAccount({
      username: '',
      password: '',
      name: '',
      phone: '',
      idNumber: '',
      wechat: '',
    });
  };

  const updateDraft = (accountId: string, patch: Partial<AccountPointsDraft>) => {
    setDrafts((previous) => ({
      ...previous,
      [accountId]: {
        ...(previous[accountId] || { addPoints: '', deductPoints: '' }),
        ...patch,
      },
    }));
  };

  const addPointsToAccount = async (accountId: string, points: string) => {
    const added = await postAction({
      action: 'addPoints',
      accountId,
      points: Number(points || 0),
    }, '点数已增加');
    if (!added) return;
    updateDraft(accountId, { addPoints: '' });
  };

  const deductPointsFromAccount = async (accountId: string, points: string) => {
    const deducted = await postAction({
      action: 'deductPoints',
      accountId,
      points: Number(points || 0),
    }, '点数已扣除');
    if (!deducted) return;
    updateDraft(accountId, { deductPoints: '' });
  };

  return (
    <main className="min-h-screen bg-[#070706] px-6 py-8 text-[#f6e9c7]">
      <Toaster richColors position="top-center" />
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-amber-400/50 bg-amber-500/12 px-4 text-sm font-semibold text-amber-100 shadow-[0_0_18px_rgba(245,158,11,0.18)] transition hover:bg-amber-500/22"
            >
              <ArrowLeft className="h-4 w-4" />
              返回工作台
            </Link>
            <Link
              href="/handcraft"
              className="inline-flex h-10 items-center rounded-md border border-amber-400/25 bg-black/30 px-4 text-sm font-medium text-amber-100/80 transition hover:bg-amber-500/10 hover:text-amber-100"
            >
              手搓党
            </Link>
          </div>
        </div>

        <header className="flex flex-col gap-4 border-b border-amber-400/20 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-amber-300">
              <ShieldCheck className="h-4 w-4" />
              账号后台
            </div>
            <h1 className="mt-2 text-3xl font-semibold text-amber-100">创作点账号管理</h1>
          </div>
          <Button
            variant="outline"
            className="border-amber-400/40 bg-black/30 text-amber-100 hover:bg-amber-500/10"
            onClick={() => void loadAccounts()}
            disabled={loading || !authorized}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </header>

        {!authorized ? (
          <section className="max-w-md rounded-md border border-amber-400/25 bg-[#11100d] p-5 shadow-[0_0_28px_rgba(245,158,11,0.12)]">
            <div className="mb-4 flex items-center gap-2 text-lg font-medium text-amber-100">
              <Lock className="h-5 w-5 text-amber-300" />
              后台登录
            </div>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="admin-username">管理员账号</Label>
                <Input
                  id="admin-username"
                  value={adminUsername}
                  onChange={(event) => setAdminUsername(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void loginAdmin();
                  }}
                  className="border-amber-400/30 bg-black/40 text-amber-50"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-password">管理员密码</Label>
                <PasswordInput
                  id="admin-password"
                  value={adminPassword}
                  onChange={(event) => setAdminPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void loginAdmin();
                  }}
                  className="border-amber-400/30 bg-black/40 text-amber-50"
                />
              </div>
              {error && <div className="text-sm text-red-300">{error}</div>}
              <Button
                className="w-full bg-amber-500 text-black hover:bg-amber-400"
                onClick={() => void loginAdmin()}
                disabled={loading || !adminUsername || !adminPassword}
              >
                登录后台
              </Button>
            </div>
          </section>
        ) : (
          <>
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-amber-400/20 bg-[#11100d] p-4">
                <div className="text-xs text-amber-300/80">账号数</div>
                <div className="mt-1 flex items-center gap-2 text-2xl font-semibold">
                  <Users className="h-5 w-5 text-amber-300" />
                  {accounts.length}
                </div>
              </div>
              <div className="rounded-md border border-amber-400/20 bg-[#11100d] p-4">
                <div className="text-xs text-amber-300/80">全账号可用点数</div>
                <div className="mt-1 flex items-center gap-2 text-2xl font-semibold">
                  <WalletCards className="h-5 w-5 text-amber-300" />
                  {formatPoints(totalAvailable)}
                </div>
              </div>
              <div className="rounded-md border border-amber-400/20 bg-[#11100d] p-4">
                <div className="text-xs text-amber-300/80">同步状态</div>
                <div className="mt-1 text-2xl font-semibold text-emerald-300">实时</div>
              </div>
            </section>

            <section className="rounded-md border border-amber-400/25 bg-[#11100d] p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-lg font-medium">
                  <Plus className="h-5 w-5 text-amber-300" />
                  新建账号
                </div>
                <div className="rounded-md border border-amber-400/25 bg-black/25 px-3 py-1.5 text-xs text-amber-100/70">
                  默认赠送 500 点：用户首次登录自动发放一次，后台不可重复赠送
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7">
                <Input placeholder="账号" value={newAccount.username} onChange={(event) => setNewAccount({ ...newAccount, username: event.target.value })} className="border-amber-400/25 bg-black/35" />
                <PasswordInput placeholder="密码" value={newAccount.password} onChange={(event) => setNewAccount({ ...newAccount, password: event.target.value })} className="border-amber-400/25 bg-black/35" />
                <Input placeholder="姓名/备注" value={newAccount.name} onChange={(event) => setNewAccount({ ...newAccount, name: event.target.value })} className="border-amber-400/25 bg-black/35" />
                <Input placeholder="手机号码（必填）" value={newAccount.phone} onChange={(event) => setNewAccount({ ...newAccount, phone: event.target.value })} className="border-amber-400/25 bg-black/35" />
                <Input placeholder="身份证号码（必填）" value={newAccount.idNumber} onChange={(event) => setNewAccount({ ...newAccount, idNumber: event.target.value })} className="border-amber-400/25 bg-black/35" />
                <Input placeholder="微信" value={newAccount.wechat} onChange={(event) => setNewAccount({ ...newAccount, wechat: event.target.value })} className="border-amber-400/25 bg-black/35" />
                <Button className="bg-amber-500 text-black hover:bg-amber-400" onClick={() => void createAccount()} disabled={loading || !newAccount.username || !newAccount.password || !newAccount.phone || !newAccount.idNumber}>
                  创建
                </Button>
              </div>
            </section>

            <section className="overflow-hidden rounded-md border border-amber-400/25 bg-[#11100d]">
              <div className="grid grid-cols-[1.05fr_1.45fr_1fr_1.25fr] border-b border-amber-400/20 px-4 py-3 text-xs text-amber-300/80">
                <div>姓名/账号</div>
                <div>资料（只读）</div>
                <div>点数</div>
                <div>创作点操作</div>
              </div>
              <div className="divide-y divide-amber-400/12">
                {displayAccounts.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-amber-100/60">暂无账号</div>
                ) : displayAccounts.map((account) => {
                  const draft = drafts[account.id] || createDraft();
                  return (
                    <div key={account.id} className="grid grid-cols-1 gap-4 px-4 py-4 text-sm lg:grid-cols-[1.05fr_1.45fr_1fr_1.25fr]">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-amber-50">{account.name || account.username}</span>
                          <Badge className={getStatusBadgeClass(account.status)}>
                            {getStatusLabel(account.status)}
                          </Badge>
                        </div>
                        {account.name && (
                          <div className="mt-1 text-xs text-amber-100/70">账号：{account.username}</div>
                        )}
                        <div className="mt-1 text-xs text-amber-100/55">最近登录：{formatTime(account.lastLoginAt)}</div>
                      </div>

                      <div className="grid grid-cols-1 gap-1.5 rounded-md border border-amber-400/15 bg-black/20 px-3 py-2 text-xs text-amber-100/65 sm:grid-cols-2">
                        <div>姓名：<span className="text-amber-50">{readonlyValue(account.name)}</span></div>
                        <div>微信：<span className="text-amber-50">{readonlyValue(account.wechat)}</span></div>
                        <div>手机：<span className="text-amber-50">{readonlyValue(account.phone)}</span></div>
                        <div>身份证：<span className="text-amber-50">{readonlyValue(account.idNumber)}</span></div>
                      </div>

                      <div className="space-y-1 tabular-nums">
                        <div className="text-emerald-300">可用 {formatPoints(account.wallet.availablePoints)}</div>
                        <div className="text-amber-100/60">冻结 {formatPoints(account.wallet.frozenPoints)}</div>
                        <div className="text-amber-100/60">累计消耗 {formatPoints(account.wallet.consumedPoints)}</div>
                      </div>

                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <Input type="number" min="1" placeholder="增加点数" value={draft.addPoints} onChange={(event) => updateDraft(account.id, { addPoints: event.target.value })} className="border-amber-400/25 bg-black/35" />
                          <Button variant="outline" className="border-amber-400/30 bg-black/20 text-amber-100 hover:bg-amber-500/10" onClick={() => void addPointsToAccount(account.id, draft.addPoints)} disabled={loading || !Number(draft.addPoints || 0)}>
                            增加点数
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Input type="number" min="1" placeholder="扣除点数" value={draft.deductPoints} onChange={(event) => updateDraft(account.id, { deductPoints: event.target.value })} className="border-amber-400/25 bg-black/35" />
                          <Button variant="outline" className="border-red-400/30 bg-black/20 text-red-100 hover:bg-red-500/10 hover:text-red-50" onClick={() => void deductPointsFromAccount(account.id, draft.deductPoints)} disabled={loading || !Number(draft.deductPoints || 0)}>
                            扣除点数
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
