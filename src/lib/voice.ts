/**
 * Voice I/O via Fish Audio.
 *
 * Speech-to-text (ASR) for the owner's spoken question, and text-to-speech (TTS)
 * for the coach's spoken answer. Kept as a thin, testable client: the routes
 * handle HTTP shape, this handles the Fish Audio contract and failure mapping.
 */

const TTS_URL = 'https://api.fish.audio/v1/tts';
const ASR_URL = 'https://api.fish.audio/v1/asr';

/** Free-tier speech model; overridable if a paid model is provisioned. */
const DEFAULT_TTS_MODEL = 's2.1-pro-free';

export function isVoiceConfigured(): boolean {
  return Boolean(process.env.FISH_AUDIO_API_KEY);
}

function apiKey(): string {
  const key = process.env.FISH_AUDIO_API_KEY;
  if (!key) throw new Error('FISH_AUDIO_API_KEY is not set.');
  return key;
}

export interface Speech {
  audio: Buffer;
  contentType: string;
}

/** Synthesises spoken audio (MP3) for a coach answer. */
export async function synthesize(text: string): Promise<Speech> {
  const model = process.env.FISH_TTS_MODEL ?? DEFAULT_TTS_MODEL;
  const body: Record<string, unknown> = { text, format: 'mp3' };
  // A reference voice is optional; without it Fish uses its default speaker.
  if (process.env.FISH_VOICE_ID) body.reference_id = process.env.FISH_VOICE_ID;

  const response = await fetch(TTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      model,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Fish Audio TTS failed with status ${response.status}.`);
  }

  const audio = Buffer.from(await response.arrayBuffer());
  return { audio, contentType: 'audio/mpeg' };
}

/** Transcribes a spoken question to text. */
export async function transcribe(audio: Buffer, filename = 'audio.webm'): Promise<string> {
  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array(audio)]), filename);
  if (process.env.FISH_ASR_LANGUAGE) form.append('language', process.env.FISH_ASR_LANGUAGE);

  const response = await fetch(ASR_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Fish Audio ASR failed with status ${response.status}.`);
  }

  const data = (await response.json()) as { text?: string };
  return (data.text ?? '').trim();
}
