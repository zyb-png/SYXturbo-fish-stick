import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_APP_SETTINGS,
  getSavedAppSettingsSync,
  saveAppSettingsSync,
} from '@/lib/app-settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({
      success: true,
      settings: getSavedAppSettingsSync(),
      defaults: DEFAULT_APP_SETTINGS,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const settings = saveAppSettingsSync(body?.settings ?? body);
    return NextResponse.json({ success: true, settings });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
