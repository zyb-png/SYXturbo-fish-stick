import { NextResponse } from 'next/server';
import { getCurrentUserAccount } from './account-store';

export const LOGIN_REQUIRED_MESSAGE = '请先登录账号再继续使用。新账号首次登录赠送 500 创作点。';

export async function requireUserLoginResponse() {
  const account = await getCurrentUserAccount();

  if (!account) {
    return {
      account: null,
      response: NextResponse.json(
        {
          success: false,
          error: LOGIN_REQUIRED_MESSAGE,
          code: 'LOGIN_REQUIRED',
        },
        { status: 401 }
      ),
    };
  }

  return { account, response: null };
}
