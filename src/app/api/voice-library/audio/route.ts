import { NextRequest, NextResponse } from 'next/server';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import { readCustomVoiceAudio } from '@/lib/voice-library-store';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  const id = new URL(request.url).searchParams.get('id')?.trim();
  if (!id) {
    return NextResponse.json({ success: false, error: '缺少音色 ID' }, { status: 400 });
  }

  try {
    const audio = await readCustomVoiceAudio(auth.account, id);
    if (!audio) {
      return NextResponse.json({ success: false, error: '音频不存在' }, { status: 404 });
    }

    const total = audio.data.length;
    const rangeHeader = request.headers.get('range');
    const rangeMatch = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/);
    if (rangeHeader && !rangeMatch) {
      return new NextResponse(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${total}` },
      });
    }

    if (rangeMatch) {
      const requestedStart = rangeMatch[1] ? Number(rangeMatch[1]) : undefined;
      const requestedEnd = rangeMatch[2] ? Number(rangeMatch[2]) : undefined;
      let start = requestedStart ?? Math.max(0, total - (requestedEnd || 0));
      let end = requestedStart === undefined ? total - 1 : Math.min(requestedEnd ?? total - 1, total - 1);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= total) {
        return new NextResponse(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${total}` },
        });
      }
      start = Math.floor(start);
      end = Math.floor(end);
      const chunk = audio.data.subarray(start, end + 1);
      return new NextResponse(new Uint8Array(chunk), {
        status: 206,
        headers: {
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, max-age=3600',
          'Content-Length': String(chunk.length),
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Content-Type': audio.contentType,
        },
      });
    }

    return new NextResponse(new Uint8Array(audio.data), {
      headers: {
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=3600',
        'Content-Length': String(total),
        'Content-Type': audio.contentType,
      },
    });
  } catch (error) {
    console.error('[音色库] 播放音频失败:', error);
    return NextResponse.json({ success: false, error: '读取音频失败' }, { status: 500 });
  }
}
