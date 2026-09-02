/**
 * Clinic knowledge uploads.
 *
 * Accepts a PDF or TXT file, extracts plain text, and hands it to the n8n
 * ingest workflow, which chunks, embeds (Cohere) and stores it in the Supabase
 * vector store. Parsing and the ingest contract live here so the route stays
 * thin and the rules stay unit-testable without a running n8n.
 */

/** The brief allows PDF and TXT only. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Shorter than this after extraction almost certainly means a failed parse. */
const MIN_TEXT_LENGTH = 20;

export interface UploadMeta {
  name: string;
  type: string;
  size: number;
}

export type Validation = { ok: true } | { ok: false; reason: string };

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** True for the two formats the brief permits, checked by MIME and by extension. */
export function isSupported(meta: Pick<UploadMeta, 'name' | 'type'>): boolean {
  const ext = extension(meta.name);
  const isPdf = meta.type === 'application/pdf' || ext === 'pdf';
  const isTxt = meta.type === 'text/plain' || ext === 'txt';
  return isPdf || isTxt;
}

/** Rejects empty, oversized, and unsupported uploads before any parsing work. */
export function validateUpload(meta: UploadMeta): Validation {
  if (meta.size === 0) return { ok: false, reason: 'The file is empty.' };
  if (meta.size > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: 'The file is larger than the 5 MB limit.' };
  }
  if (!isSupported(meta)) {
    return { ok: false, reason: 'Only PDF and TXT files are supported.' };
  }
  return { ok: true };
}

/**
 * Extracts plain text from a supported upload.
 * PDF parsing is loaded lazily so the heavy dependency never touches the TXT
 * path (or tests that only exercise validation).
 */
export async function extractText(bytes: Uint8Array, name: string): Promise<string> {
  if (extension(name) === 'txt') {
    return new TextDecoder().decode(bytes).trim();
  }

  const { extractText: extractPdfText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractPdfText(pdf, { mergePages: true });
  return (Array.isArray(text) ? text.join('\n') : text).trim();
}

/** True when there is enough text to be worth embedding. */
export function hasUsableText(text: string): boolean {
  return text.trim().length >= MIN_TEXT_LENGTH;
}

export function isIngestConfigured(): boolean {
  return Boolean(process.env.N8N_INGEST_URL);
}

export interface IngestResult {
  ok: boolean;
  error?: string;
}

/**
 * Forwards an extracted document to the n8n ingest webhook.
 * Returns a result rather than throwing so the route can map failures to an
 * HTTP status without a try/catch of its own.
 */
export async function ingestDocument(title: string, text: string): Promise<IngestResult> {
  const url = process.env.N8N_INGEST_URL;
  if (!url) return { ok: false, error: 'N8N_INGEST_URL is not configured.' };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.N8N_WEBHOOK_SECRET
          ? { 'X-Coach-Secret': process.env.N8N_WEBHOOK_SECRET }
          : {}),
      },
      body: JSON.stringify({ title, text }),
      // Embedding a large document can be slow; give it room but still bound it.
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      return { ok: false, error: `Ingest failed with status ${response.status}.` };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Ingest request failed.',
    };
  }
}

/** Turns a file name into a human document title: drops the extension. */
export function titleFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, '').trim() || 'Untitled document';
}
