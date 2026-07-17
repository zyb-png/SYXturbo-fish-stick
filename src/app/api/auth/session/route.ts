import { NextResponse } from 'next/server';
import { getCurrentUserAccount } from '@/lib/account-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const account = await getCurrentUserAccount();
    return NextResponse.json({
      success: true,
      authenticated: Boolean(account?.id),
      account: account
        ? {
            id: account.id,
            name: account.name,
            status: account.status,
          }
        : null,
    }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    console.error('[账号] 读取登录状态失败:', error);
    return NextResponse.json({
      success: false,
      authenticated: false,
      account: null,
      error: '暂时无法确认登录状态',
    }, {
      status: 500,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  }
}
