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
  wechat?: string;
  status: 'active' | 'disabled';
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

interface AccountDraft {
  name: string;
  phone: string;
  wechat: string;
  status: 'active' | 'disabled';
  password: string;
  setPoints: string;
  grantPoints: string;
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

function createDraft(account: AdminAccountRow): AccountDraft {
  return {
    name: account.name || '',
    phone: account.phone || '',
    wechat: account.wechat || '',
    status: account.status,
    password: '',
    setPoints: String(account.wallet.availablePoints || 0),
    grantPoints: '',
  };
}

export default function AdminAccountsPage() {
  const [authorized, setAuthorized] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<AdminAccountRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, AccountDraft>>({});
  const [error, setError] = useState('');
  const [newAccount, setNewAccount] = useState({
    username: '',
    password: '',
    name: '',
    phone: '',
    wechat: '',
    initialPoints: '0',
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
      const next: Record<string, AccountDraft> = {};
      for (const account of rows) {
        next[account.id] = previous[account.id] || createDraft(account);
        next[account.id].setPoints = previous[account.id]?.setPoints ?? String(account.wallet.availablePoints || 0);
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
        body: JSON.stringify({ password: adminPassword }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '后台口令错误');
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
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : '操作失败';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const createAccount = async () => {
    await postAction({
      action: 'create',
      ...newAccount,
      initialPoints: Number(newAccount.initialPoints || 0),
    }, '账号已创建');
    setNewAccount({
      username: '',
      password: '',
      name: '',
      phone: '',
      wechat: '',
      initialPoints: '0',
    });
  };

  const updateDraft = (accountId: string, patch: Partial<AccountDraft>) => {
    setDrafts((previous) => ({
      ...previous,
      [accountId]: {
        ...(previous[accountId] || {
          name: '',
          phone: '',
          wechat: '',
          status: 'active',
          password: '',
          setPoints: '0',
          grantPoints: '',
        }),
        ...patch,
      },
    }));
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
                <Label htmlFor="admin-password">后台口令</Label>
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
                disabled={loading || !adminPassword}
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
              <div className="mb-4 flex items-center gap-2 text-lg font-medium">
                <Plus className="h-5 w-5 text-amber-300" />
                新建账号
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
                <Input placeholder="账号" value={newAccount.username} onChange={(event) => setNewAccount({ ...newAccount, username: event.target.value })} className="border-amber-400/25 bg-black/35" />
                <PasswordInput placeholder="密码" value={newAccount.password} onChange={(event) => setNewAccount({ ...newAccount, password: event.target.value })} className="border-amber-400/25 bg-black/35" />
                <Input placeholder="姓名/备注" value={newAccount.name} onChange={(event) => setNewAccount({ ...newAccount, name: event.target.value })} className="border-amber-400/25 bg-black/35" />
                <Input placeholder="微信" value={newAccount.wechat} onChange={(event) => setNewAccount({ ...newAccount, wechat: event.target.value })} className="border-amber-400/25 bg-black/35" />
                <Input type="number" min="0" placeholder="额外点数" value={newAccount.initialPoints} onChange={(event) => setNewAccount({ ...newAccount, initialPoints: event.target.value })} className="border-amber-400/25 bg-black/35" />
                <Button className="bg-amber-500 text-black hover:bg-amber-400" onClick={() => void createAccount()} disabled={loading || !newAccount.username || !newAccount.password}>
                  创建
                </Button>
              </div>
            </section>

            <section className="overflow-hidden rounded-md border border-amber-400/25 bg-[#11100d]">
              <div className="grid grid-cols-[1.15fr_1fr_1.35fr_1.5fr] border-b border-amber-400/20 px-4 py-3 text-xs text-amber-300/80">
                <div>姓名/账号</div>
                <div>点数</div>
                <div>资料</div>
                <div>操作</div>
              </div>
              <div className="divide-y divide-amber-400/12">
                {displayAccounts.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-amber-100/60">暂无账号</div>
                ) : displayAccounts.map((account) => {
                  const draft = drafts[account.id] || createDraft(account);
                  return (
                    <div key={account.id} className="grid grid-cols-1 gap-4 px-4 py-4 text-sm lg:grid-cols-[1.15fr_1fr_1.35fr_1.5fr]">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-amber-50">{account.name || account.username}</span>
                          <Badge className={account.status === 'active' ? 'bg-emerald-500/20 text-emerald-200' : 'bg-red-500/20 text-red-200'}>
                            {account.status === 'active' ? '启用' : '停用'}
                          </Badge>
                        </div>
                        {account.name && (
                          <div className="mt-1 text-xs text-amber-100/70">账号：{account.username}</div>
                        )}
                        <div className="mt-1 text-xs text-amber-100/55">最近登录：{formatTime(account.lastLoginAt)}</div>
                      </div>

                      <div className="space-y-1 tabular-nums">
                        <div className="text-emerald-300">可用 {formatPoints(account.wallet.availablePoints)}</div>
                        <div className="text-amber-100/60">冻结 {formatPoints(account.wallet.frozenPoints)}</div>
                        <div className="text-amber-100/60">累计消耗 {formatPoints(account.wallet.consumedPoints)}</div>
                      </div>

                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <Input placeholder="姓名/备注" value={draft.name} onChange={(event) => updateDraft(account.id, { name: event.target.value })} className="border-amber-400/25 bg-black/35" />
                        <Input placeholder="微信" value={draft.wechat} onChange={(event) => updateDraft(account.id, { wechat: event.target.value })} className="border-amber-400/25 bg-black/35" />
                        <Input placeholder="手机" value={draft.phone} onChange={(event) => updateDraft(account.id, { phone: event.target.value })} className="border-amber-400/25 bg-black/35" />
                        <select
                          value={draft.status}
                          onChange={(event) => updateDraft(account.id, { status: event.target.value === 'disabled' ? 'disabled' : 'active' })}
                          className="h-9 rounded-md border border-amber-400/25 bg-black/35 px-3 text-sm"
                        >
                          <option value="active">启用</option>
                          <option value="disabled">停用</option>
                        </select>
                      </div>

                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <Input type="number" min="0" value={draft.setPoints} onChange={(event) => updateDraft(account.id, { setPoints: event.target.value })} className="border-amber-400/25 bg-black/35" />
                          <Button variant="outline" className="border-amber-400/30 bg-black/20 text-amber-100 hover:bg-amber-500/10" onClick={() => void postAction({ action: 'setPoints', accountId: account.id, points: Number(draft.setPoints || 0) }, '点数已设置')}>
                            设置点数
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Input type="number" min="0" placeholder="赠送点数" value={draft.grantPoints} onChange={(event) => updateDraft(account.id, { grantPoints: event.target.value })} className="border-amber-400/25 bg-black/35" />
                          <Button variant="outline" className="border-amber-400/30 bg-black/20 text-amber-100 hover:bg-amber-500/10" onClick={() => void postAction({ action: 'grantPoints', accountId: account.id, points: Number(draft.grantPoints || 0) }, '点数已赠送')}>
                            赠送
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <PasswordInput placeholder="新密码" value={draft.password} onChange={(event) => updateDraft(account.id, { password: event.target.value })} className="border-amber-400/25 bg-black/35" />
                          <Button className="bg-amber-500 text-black hover:bg-amber-400" onClick={() => void postAction({
                            action: 'updateProfile',
                            accountId: account.id,
                            name: draft.name,
                            phone: draft.phone,
                            wechat: draft.wechat,
                            status: draft.status,
                            password: draft.password,
                          }, '账号已保存')}>
                            保存资料
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
