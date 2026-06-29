import { NextRequest, NextResponse } from 'next/server';
import {
  logoutUserSession,
  USER_SESSION_COOKIE,
} from '@/lib/account-store';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const token = request.cookies.get(USER_SESSION_COOKIE)?.value;
  await logoutUserSession(token);
  const response = NextResponse.json({ success: true });
  response.cookies.set(USER_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
