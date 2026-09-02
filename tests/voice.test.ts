import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isVoiceConfigured, synthesize, transcribe } from '@/lib/voice';

/** Fish Audio is a paid external API; every call here is mocked. */

beforeEach(() => {
  process.env.FISH_AUDIO_API_KEY = 'fish-test-key';
});

afterEach(() => {
  delete process.env.FISH_AUDIO_API_KEY;
  vi.unstubAllGlobals();
});

describe('isVoiceConfigured', () => {
  it('is false without a key', () => {
    delete process.env.FISH_AUDIO_API_KEY;
    expect(isVoiceConfigured()).toBe(false);
  });
});

describe('synthesize', () => {
  it('returns MP3 bytes on success and sends a bearer token', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const speech = await synthesize('Your conversion is low on CoolSculpting.');

    expect(speech.contentType).toBe('audio/mpeg');
    expect(speech.audio.length).toBe(4);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/v1/tts');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer fish-test-key');
    expect(JSON.parse(init!.body as string)).toMatchObject({ format: 'mp3' });
  });

  it('throws on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 402 })));
    await expect(synthesize('hi')).rejects.toThrow(/402/);
  });

  it('throws when the key is missing', async () => {
    delete process.env.FISH_AUDIO_API_KEY;
    await expect(synthesize('hi')).rejects.toThrow(/FISH_AUDIO_API_KEY/);
  });
});

describe('transcribe', () => {
  it('returns the trimmed transcript', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ text: '  who has not returned?  ' }), { status: 200 })));
    expect(await transcribe(Buffer.from([0, 1, 2]))).toBe('who has not returned?');
  });

  it('throws on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 500 })));
    await expect(transcribe(Buffer.from([0]))).rejects.toThrow(/500/);
  });
});
