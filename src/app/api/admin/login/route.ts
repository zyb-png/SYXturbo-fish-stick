import { NextRequest, NextResponse } from 'next/server';
import {
  ADMIN_SESSION_COOKIE,
  authenticateAdmin,
  getDefaultAdminPasswordHint,
} from '@/lib/account-store';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const password = typeof body.password === 'string' ? body.password : '';
    const result = await authenticateAdmin(password);
    const response = NextResponse.json({ success: true });
    response.cookies.set(ADMIN_SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: result.maxAge,
    });
    return response;
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '后台登录失败',
      hint: getDefaultAdminPasswordHint(),
    }, { status: 401 });
  }
}
