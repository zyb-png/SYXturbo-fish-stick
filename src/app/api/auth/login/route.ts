import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateUserAccount,
  USER_SESSION_COOKIE,
} from '@/lib/account-store';
import { ensureLoginBonusForAccount, getCreationPointSnapshotForAccount } from '@/lib/creation-points';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || !password) {
      return NextResponse.json({ success: false, error: '请输入账号和密码' }, { status: 400 });
    }

    const result = await authenticateUserAccount(username, password);
    await ensureLoginBonusForAccount(result.account.id);

    const response = NextResponse.json({
      success: true,
      account: result.account,
      wallet: await getCreationPointSnapshotForAccount(result.account.id),
    });
    response.cookies.set(USER_SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: result.maxAge,
    });
    return response;
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '登录失败',
    }, { status: 401 });
  }
}
