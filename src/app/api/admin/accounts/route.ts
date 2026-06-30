import { NextRequest, NextResponse } from 'next/server';
import {
  createManagedAccount,
  listAdminAccounts,
  requireAdminSession,
} from '@/lib/account-store';
import {
  deductCreationPointsFromAccount,
  getCreationPointSnapshotForAccount,
  grantCreationPointsToAccount,
} from '@/lib/creation-points';

export const dynamic = 'force-dynamic';

async function buildAccountsPayload() {
  const accounts = await listAdminAccounts();
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
      await createManagedAccount({
        username: body.username,
        password: body.password,
        name: body.name,
        phone: body.phone,
        idNumber: body.idNumber,
        wechat: body.wechat,
        status: body.status === 'disabled' ? 'disabled' : 'active',
      });
    } else if (action === 'addPoints') {
      const points = toNumber(body.points);
      if (points === null || points <= 0) throw new Error('请输入要增加的点数');
      await grantCreationPointsToAccount({
        accountId: body.accountId,
        points,
        label: '后台增加点数',
        source: 'bonus',
      });
    } else if (action === 'deductPoints') {
      const points = toNumber(body.points);
      if (points === null || points <= 0) throw new Error('请输入要扣除的点数');
      await deductCreationPointsFromAccount({
        accountId: body.accountId,
        points,
        description: `后台扣除点数 ${points.toLocaleString('zh-CN')} 点`,
      });
    } else if (action === 'setPoints') {
      throw new Error('设置点数已停用，请使用增加点数');
    } else if (action === 'grantPoints') {
      throw new Error('默认赠送额度由系统自动发放，每个账号仅一次，后台不能手动重复赠送');
    } else if (action === 'updateProfile') {
      throw new Error('账号资料创建后不可修改，只能调整创作点数');
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
