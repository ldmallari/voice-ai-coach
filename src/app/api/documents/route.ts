import { NextResponse } from 'next/server';
import {
  extractText,
  hasUsableText,
  ingestDocument,
  isIngestConfigured,
  titleFromFilename,
  validateUpload,
} from '@/lib/documents';

/**
 * Knowledge-base upload endpoint.
 *
 * Accepts a single PDF or TXT file, extracts its text, and forwards it to the
 * n8n ingest workflow. PDF parsing needs Node APIs, so this route opts out of
 * the edge runtime.
 */
export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isIngestConfigured()) {
    return NextResponse.json(
      { error: 'Knowledge ingest is not configured (N8N_INGEST_URL).' },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'Expected a multipart form upload with a "file" field.' },
      { status: 400 },
    );
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'No file was uploaded under the "file" field.' },
      { status: 400 },
    );
  }

  const check = validateUpload({ name: file.name, type: file.type, size: file.size });
  if (!check.ok) {
    return NextResponse.json({ error: check.reason }, { status: 400 });
  }

  let text: string;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    text = await extractText(bytes, file.name);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read the file.';
    return NextResponse.json({ error: `Failed to extract text: ${message}` }, { status: 422 });
  }

  if (!hasUsableText(text)) {
    return NextResponse.json(
      { error: 'No readable text was found in the document.' },
      { status: 422 },
    );
  }

  const title = titleFromFilename(file.name);
  const result = await ingestDocument(title, text);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? 'Ingest failed.' },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, title, characters: text.length });
}
