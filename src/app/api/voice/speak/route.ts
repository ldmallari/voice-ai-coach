import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isVoiceConfigured, synthesize } from '@/lib/voice';

/** Text-to-speech: `{ text }` in, audio bytes out. */
export const runtime = 'nodejs';

const RequestSchema = z.object({ text: z.string().min(1).max(4000) });

export async function POST(request: Request) {
  if (!isVoiceConfigured()) {
    return NextResponse.json(
      { error: 'Voice is not configured (FISH_AUDIO_API_KEY).' },
      { status: 503 },
    );
  }

  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Expected a JSON body with a non-empty "text".' },
      { status: 400 },
    );
  }

  try {
    const { audio, contentType } = await synthesize(parsed.data.text);
    return new NextResponse(new Uint8Array(audio), {
      status: 200,
      headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Speech synthesis failed.';
    console.error('[voice/speak] failed:', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
