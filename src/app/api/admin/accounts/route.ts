import { NextRequest, NextResponse } from 'next/server';
import {
  createManagedAccount,
  listPublicAccounts,
  requireAdminSession,
  updateManagedAccount,
} from '@/lib/account-store';
import {
  getCreationPointSnapshotForAccount,
  grantCreationPointsToAccount,
  setAccountAvailableCreationPoints,
} from '@/lib/creation-points';

export const dynamic = 'force-dynamic';

async function buildAccountsPayload() {
  const accounts = await listPublicAccounts();
  const rows = await Promise.all(accounts.map(async (account) => {
    const wallet = await getCreationPointSnapshotForAccount(account.id);
    return {
      ...account,
      wallet: wallet.summary,
      batches: wallet.batches,
      updatedAt: wallet.updatedAt,
    };
  }));
  return rows;
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
}

export async function GET(request: NextRequest) {
  try {
    await requireAdminSession(request);
    return NextResponse.json({
      success: true,
      accounts: await buildAccountsPayload(),
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '后台未登录',
    }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdminSession(request);
    const body = await request.json();
    const action = typeof body.action === 'string' ? body.action : '';

    if (action === 'create') {
      const account = await createManagedAccount({
        username: body.username,
        password: body.password,
        name: body.name,
        phone: body.phone,
        wechat: body.wechat,
        status: body.status === 'disabled' ? 'disabled' : 'active',
      });
      const initialPoints = toNumber(body.initialPoints);
      if (initialPoints && initialPoints > 0) {
        await grantCreationPointsToAccount({
          accountId: account.id,
          points: initialPoints,
          label: '管理员赠送额度',
          source: 'bonus',
        });
      }
    } else if (action === 'updateProfile') {
      await updateManagedAccount({
        accountId: body.accountId,
        password: body.password,
        name: body.name,
        phone: body.phone,
        wechat: body.wechat,
        status: body.status === 'disabled' ? 'disabled' : 'active',
      });
    } else if (action === 'setPoints') {
      const points = toNumber(body.points);
      if (points === null) throw new Error('请输入要设置的点数');
      await setAccountAvailableCreationPoints({
        accountId: body.accountId,
        points,
      });
    } else if (action === 'grantPoints') {
      const points = toNumber(body.points);
      if (!points || points <= 0) throw new Error('请输入要赠送的点数');
      await grantCreationPointsToAccount({
        accountId: body.accountId,
        points,
        label: typeof body.label === 'string' && body.label.trim() ? body.label.trim() : '管理员赠送额度',
        source: 'bonus',
      });
    } else {
      throw new Error('未知后台操作');
    }

    return NextResponse.json({
      success: true,
      accounts: await buildAccountsPayload(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '后台操作失败';
    return NextResponse.json({
      success: false,
      error: message,
    }, { status: message.includes('后台') || message.includes('登录') ? 401 : 400 });
  }
}
