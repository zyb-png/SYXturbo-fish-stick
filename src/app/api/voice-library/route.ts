import { NextRequest, NextResponse } from 'next/server';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import {
  deleteCustomVoice,
  listAccountVoiceLibrary,
  MAX_CUSTOM_VOICE_BYTES,
  saveCustomVoice,
} from '@/lib/voice-library-store';
import type { VoiceLibraryItem } from '@/lib/character-voice';

export const runtime = 'nodejs';

function textField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function genderField(value: string): VoiceLibraryItem['gender'] {
  if (value === '女' || value === '男') return value;
  return '中性';
}

export async function GET() {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const voices = await listAccountVoiceLibrary(auth.account);
    const categories = Array.from(new Set(voices.map(voice => voice.category).filter(Boolean))).sort((a, b) => (
      String(a).localeCompare(String(b), 'zh-CN')
    ));
    const languages = Array.from(new Set(voices.map(voice => voice.language).filter(Boolean)));
    return NextResponse.json({
      success: true,
      voices,
      summary: {
        total: voices.length,
        builtin: voices.filter(voice => voice.source === 'builtin').length,
        custom: voices.filter(voice => voice.source === 'custom').length,
        languages,
        categories,
      },
    });
  } catch (error) {
    console.error('[音色库] 读取失败:', error);
    return NextResponse.json({ success: false, error: '读取音色库失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: '请选择需要上传的音频文件' }, { status: 400 });
    }
    if (file.size <= 0) {
      return NextResponse.json({ success: false, error: '音频文件为空' }, { status: 400 });
    }
    if (file.size > MAX_CUSTOM_VOICE_BYTES) {
      return NextResponse.json({ success: false, error: '单个音频不能超过 20MB' }, { status: 413 });
    }

    const name = textField(formData, 'name') || file.name.replace(/\.[^.]+$/, '');
    const language = textField(formData, 'language') || '中文';
    const category = textField(formData, 'category') || '其他';
    const gender = genderField(textField(formData, 'gender'));
    const ageRange = textField(formData, 'ageRange') || '不限';
    const description = textField(formData, 'description');
    const voice = await saveCustomVoice(auth.account, {
      name,
      language,
      category,
      gender,
      ageRange,
      description,
      originalFileName: file.name,
      data: Buffer.from(await file.arrayBuffer()),
    });

    return NextResponse.json({ success: true, voice });
  } catch (error) {
    console.error('[音色库] 上传失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '上传音色失败',
    }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  const id = new URL(request.url).searchParams.get('id')?.trim();
  if (!id) {
    return NextResponse.json({ success: false, error: '缺少音色 ID' }, { status: 400 });
  }

  try {
    const deleted = await deleteCustomVoice(auth.account, id);
    if (!deleted) {
      return NextResponse.json({ success: false, error: '音色不存在或不可删除' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[音色库] 删除失败:', error);
    return NextResponse.json({ success: false, error: '删除音色失败' }, { status: 500 });
  }
}

