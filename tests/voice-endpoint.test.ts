import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Backend tests for the voice routes; Fish Audio is mocked. */

async function loadTranscribe() {
  vi.resetModules();
  return import('@/app/api/voice/transcribe/route');
}
async function loadSpeak() {
  vi.resetModules();
  return import('@/app/api/voice/speak/route');
}

beforeEach(() => {
  process.env.FISH_AUDIO_API_KEY = 'fish-test-key';
});
afterEach(() => {
  delete process.env.FISH_AUDIO_API_KEY;
  vi.unstubAllGlobals();
});

describe('POST /api/voice/transcribe', () => {
  it('is disabled without a key', async () => {
    delete process.env.FISH_AUDIO_API_KEY;
    const { POST } = await loadTranscribe();
    const form = new FormData();
    form.append('audio', new File([new Uint8Array([1, 2])], 'q.webm', { type: 'audio/webm' }));
    const response = await POST(new Request('http://localhost/api/voice/transcribe', { method: 'POST', body: form }));
    expect(response.status).toBe(503);
  });

  it('rejects a request with no audio', async () => {
    const { POST } = await loadTranscribe();
    const response = await POST(new Request('http://localhost/api/voice/transcribe', { method: 'POST', body: new FormData() }));
    expect(response.status).toBe(400);
  });

  it('returns the transcript for a valid upload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ text: 'why are consultations not converting' }), { status: 200 })));
    const { POST } = await loadTranscribe();
    const form = new FormData();
    form.append('audio', new File([new Uint8Array([1, 2, 3])], 'q.webm', { type: 'audio/webm' }));
    const response = await POST(new Request('http://localhost/api/voice/transcribe', { method: 'POST', body: form }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.text).toBe('why are consultations not converting');
  });
});

describe('POST /api/voice/speak', () => {
  it('returns audio bytes with an audio content type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([9, 9, 9]), { status: 200 })));
    const { POST } = await loadSpeak();
    const response = await POST(
      new Request('http://localhost/api/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Your rebooking rate is weak.' }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
  });

  it('rejects an empty text body', async () => {
    const { POST } = await loadSpeak();
    const response = await POST(
      new Request('http://localhost/api/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '' }),
      }),
    );
    expect(response.status).toBe(400);
  });
});
