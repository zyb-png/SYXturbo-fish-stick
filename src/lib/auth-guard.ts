import { NextResponse } from 'next/server';
import { getCurrentUserAccount } from './account-store';

export async function requireUserLoginResponse() {
  const account = await getCurrentUserAccount();

  if (!account) {
    return {
      account: null,
      response: NextResponse.json(
        {
          success: false,
          error: '请先登录账号后再使用该功能',
          code: 'LOGIN_REQUIRED',
        },
        { status: 401 }
      ),
    };
  }

  return { account, response: null };
}
