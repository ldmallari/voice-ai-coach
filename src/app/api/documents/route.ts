import { NextResponse } from 'next/server';
import {
  deleteDocument,
  extractText,
  getDocumentContent,
  hasUsableText,
  ingestDocument,
  isAdminConfigured,
  isIngestConfigured,
  isStoreConfigured,
  listDocuments,
  passcodeMatches,
  titleFromFilename,
  validateUpload,
} from '@/lib/documents';

/**
 * Knowledge-base endpoint.
 *
 * The whole knowledge base is owner-only: `POST` (upload, replacing an existing
 * document of the same name rather than duplicating it), `GET` (list) and
 * `DELETE` are all gated by an admin passcode, so a public deployment cannot be
 * read, wiped, or polluted with junk uploads by a stranger. PDF parsing needs
 * Node APIs, so this route opts out of the edge runtime.
 */
export const runtime = 'nodejs';

/** Checks the admin passcode. Returns an error response, or null when authorised. */
function requireAdmin(request: Request): NextResponse | null {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: 'Knowledge management is not configured (KNOWLEDGE_ADMIN_PASSCODE).' },
      { status: 503 },
    );
  }
  if (!passcodeMatches(request.headers.get('x-admin-passcode'))) {
    return NextResponse.json({ error: 'Incorrect passcode.' }, { status: 401 });
  }
  return null;
}

/** For operations that query Supabase directly (list, delete). Null when the store is ready. */
function requireStore(): NextResponse | null {
  if (!isStoreConfigured()) {
    return NextResponse.json({ error: 'Document store is not configured.' }, { status: 503 });
  }
  return null;
}

export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;

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

  // Replace an existing document of the same name rather than duplicating its chunks.
  if (isStoreConfigured()) {
    try {
      await deleteDocument(title);
    } catch {
      /* best-effort; a failed cleanup should not block the upload */
    }
  }

  const result = await ingestDocument(title, text);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Ingest failed.' }, { status: 502 });
  }

  return NextResponse.json({ ok: true, title, characters: text.length });
}

export async function GET(request: Request) {
  const denied = requireAdmin(request) ?? requireStore();
  if (denied) return denied;

  // With a `title`, return that one document's full text; without, list them all.
  const title = new URL(request.url).searchParams.get('title');

  try {
    if (title) {
      const doc = await getDocumentContent(title);
      if (!doc) return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
      return NextResponse.json(doc);
    }
    return NextResponse.json({ documents: await listDocuments() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[documents] read failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const denied = requireAdmin(request) ?? requireStore();
  if (denied) return denied;

  const title = new URL(request.url).searchParams.get('title');
  if (!title) {
    return NextResponse.json(
      { error: 'A "title" query parameter is required.' },
      { status: 400 },
    );
  }

  try {
    const removed = await deleteDocument(title);
    return NextResponse.json({ ok: true, title, removed });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[documents] delete failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
