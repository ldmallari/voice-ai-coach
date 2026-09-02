import { NextResponse } from 'next/server';
import { isVoiceConfigured, transcribe } from '@/lib/voice';

/** Speech-to-text: multipart audio in, `{ text }` out. */
export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isVoiceConfigured()) {
    return NextResponse.json(
      { error: 'Voice is not configured (FISH_AUDIO_API_KEY).' },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'Expected a multipart form upload with an "audio" field.' },
      { status: 400 },
    );
  }

  const audio = form.get('audio');
  if (!(audio instanceof File)) {
    return NextResponse.json(
      { error: 'No audio was uploaded under the "audio" field.' },
      { status: 400 },
    );
  }

  try {
    const buffer = Buffer.from(await audio.arrayBuffer());
    const text = await transcribe(buffer, audio.name || 'audio.webm');
    return NextResponse.json({ text });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Transcription failed.';
    console.error('[voice/transcribe] failed:', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
