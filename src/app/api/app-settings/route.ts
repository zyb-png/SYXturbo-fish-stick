import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_APP_SETTINGS,
  getSavedAppSettingsSync,
  saveAppSettingsSync,
} from '@/lib/app-settings';
import { requireAdminSession } from '@/lib/account-store';

export const dynamic = 'force-dynamic';

function buildErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = message.includes('后台') || message.includes('登录') ? 401 : 500;
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  try {
    await requireAdminSession(request);
    return NextResponse.json({
      success: true,
      settings: getSavedAppSettingsSync(),
      defaults: DEFAULT_APP_SETTINGS,
    });
  } catch (error: unknown) {
    return buildErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdminSession(request);
    const body = await request.json();
    const settings = saveAppSettingsSync(body?.settings ?? body);
    return NextResponse.json({ success: true, settings });
  } catch (error: unknown) {
    return buildErrorResponse(error);
  }
}
