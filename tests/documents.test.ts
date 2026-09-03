import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extractText,
  hasUsableText,
  ingestDocument,
  isSupported,
  passcodeMatches,
  titleFromFilename,
  validateUpload,
  MAX_UPLOAD_BYTES,
} from '@/lib/documents';

describe('validateUpload', () => {
  it('accepts a PDF by mime type', () => {
    expect(validateUpload({ name: 'policy.pdf', type: 'application/pdf', size: 1000 }).ok).toBe(true);
  });

  it('accepts a TXT by extension even when the mime type is empty', () => {
    expect(validateUpload({ name: 'sop.txt', type: '', size: 1000 }).ok).toBe(true);
  });

  it('rejects an empty file', () => {
    const result = validateUpload({ name: 'a.txt', type: 'text/plain', size: 0 });
    expect(result.ok).toBe(false);
  });

  it('rejects a file over the size limit', () => {
    const result = validateUpload({ name: 'a.pdf', type: 'application/pdf', size: MAX_UPLOAD_BYTES + 1 });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('5 MB') });
  });

  it('rejects unsupported formats such as .docx', () => {
    const result = validateUpload({
      name: 'notes.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 1000,
    });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('PDF and TXT') });
  });
});

describe('isSupported', () => {
  it('is false for an image', () => {
    expect(isSupported({ name: 'x.png', type: 'image/png' })).toBe(false);
  });
});

describe('extractText', () => {
  it('decodes a TXT buffer to trimmed text', async () => {
    const bytes = new TextEncoder().encode('  Cancellation fee is 50%.  ');
    expect(await extractText(bytes, 'policy.txt')).toBe('Cancellation fee is 50%.');
  });
});

describe('hasUsableText', () => {
  it('rejects near-empty extractions', () => {
    expect(hasUsableText('  short ')).toBe(false);
  });
  it('accepts real content', () => {
    expect(hasUsableText('This is a real clinic policy document.')).toBe(true);
  });
});

describe('titleFromFilename', () => {
  it('drops the extension', () => {
    expect(titleFromFilename('Consultation SOP.pdf')).toBe('Consultation SOP');
  });
});

describe('passcodeMatches', () => {
  const OLD = process.env.KNOWLEDGE_ADMIN_PASSCODE;
  afterEach(() => {
    if (OLD === undefined) delete process.env.KNOWLEDGE_ADMIN_PASSCODE;
    else process.env.KNOWLEDGE_ADMIN_PASSCODE = OLD;
  });

  it('accepts the configured passcode', () => {
    process.env.KNOWLEDGE_ADMIN_PASSCODE = '022304';
    expect(passcodeMatches('022304')).toBe(true);
  });

  it('rejects a wrong passcode (including a length mismatch)', () => {
    process.env.KNOWLEDGE_ADMIN_PASSCODE = '022304';
    expect(passcodeMatches('000000')).toBe(false);
    expect(passcodeMatches('022')).toBe(false);
  });

  it('rejects when the passcode is unset or missing', () => {
    delete process.env.KNOWLEDGE_ADMIN_PASSCODE;
    expect(passcodeMatches('022304')).toBe(false);
    process.env.KNOWLEDGE_ADMIN_PASSCODE = '022304';
    expect(passcodeMatches(null)).toBe(false);
  });
});

describe('ingestDocument', () => {
  const OLD = process.env.N8N_INGEST_URL;

  beforeEach(() => {
    process.env.N8N_INGEST_URL = 'https://n8n.example/webhook/coach-ingest';
  });

  afterEach(() => {
    if (OLD === undefined) delete process.env.N8N_INGEST_URL;
    else process.env.N8N_INGEST_URL = OLD;
    vi.unstubAllGlobals();
  });

  it('fails cleanly when the ingest URL is not configured', async () => {
    delete process.env.N8N_INGEST_URL;
    const result = await ingestDocument('T', 'body text');
    expect(result.ok).toBe(false);
  });

  it('posts the document and reports success on a 2xx', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await ingestDocument('Cancellation Policy', 'Late cancellations incur a fee.');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0][1];
    expect(JSON.parse(init!.body as string)).toEqual({
      title: 'Cancellation Policy',
      text: 'Late cancellations incur a fee.',
    });
  });

  it('reports failure when n8n returns a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const result = await ingestDocument('T', 'body text');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/500/);
  });

  it('reports failure when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));
    const result = await ingestDocument('T', 'body text');
    expect(result).toEqual({ ok: false, error: 'network down' });
  });
});
