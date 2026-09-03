# Voice AI Coach — build notes

Technical notes on how the app is put together — the orchestration, the data, the voice
path, and the gotchas worth knowing when running or extending it. For the overview,
requirements checklist and setup, see `README.md`; for the n8n workflows specifically, see
`n8n/README.md`.

## Architecture at a glance

- **Next.js (App Router)** web app on **Vercel**. Production redeploys from `main` and the
  build is gated on lint + typecheck + tests (`vercel.json`), so a red check blocks the deploy.
- **n8n (Railway) is the main orchestration layer.** `POST /api/chat` routes each turn through
  the n8n `coach-chat` AI Agent; an in-process agent (`src/lib/agent.ts`) is the fallback if
  n8n is unreachable.
- Two sources of truth, chosen per question:
  - **Structured** — deterministic calculations over 60 synthetic customer records
    (`src/lib/metrics.ts`). Figures are computed in code and exposed to the n8n agent as an
    HTTP tool; arithmetic is never left to the model.
  - **Unstructured** — pgvector similarity search over chunked clinic documents, embedded with
    Cohere. The `documents` + `match_documents` schema follows LangChain's Supabase convention
    so n8n's Vector Store node works natively.

## n8n workflows (all active)

| Workflow | ID | Webhook | Role |
|---|---|---|---|
| Main Orchestration | `0EVPI3YIuG4dom3b` | `/webhook/coach-chat` | DeepSeek AI Agent + Clinic Metrics HTTP tool (→ `/api/tools`) + Supabase vector retrieve-as-tool |
| Knowledge Ingest | `8K5CuLYnrtpdg7YY` | `/webhook/coach-ingest` | chunk → Cohere embed → upsert to the vector store |
| Knowledge Retrieval | `PYTsapmIGNDP4wDo` | `/webhook/coach-retrieve` | Cohere embed → similarity search |

Credentials are reused in n8n by ID: Cohere (`uxtOtEIzqzq68DNt`), DeepSeek (`7lhVEg2d90IJdEYp`),
Supabase (`fQiSXhORB0qR3ugh`). The Supabase credential must use the **service-role** key.

## App endpoints

`POST /api/chat` · `POST /api/tools` (shared-secret, constant-time compare, fails closed) ·
`POST /api/documents` (PDF/TXT → text → n8n ingest) · `POST /api/voice/transcribe` ·
`POST /api/voice/speak` · `POST /api/sessions` · `POST /api/sessions/[id]/end` ·
`GET /api/overview` (aggregate KPIs for the header, no PII).

## UI

Voice-first light design (emerald): a living orb, a chat-and-voice composer (type or tap the
orb to speak), a clinic KPI strip fed by `/api/overview`, answers that reveal as they arrive,
and a thinking state while the coach works. Fonts via `next/font` (Bricolage Grotesque + Onest).

## Environment

`.env.local` (gitignored; `.env.example` lists the names) holds `DEEPSEEK_API_KEY`,
`DEEPSEEK_BASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`,
`COHERE_API_KEY`, `COACH_TOOL_SECRET`, `FISH_AUDIO_API_KEY`, and the `N8N_*` webhook URLs.
`.mcp.json` (gitignored) registers the n8n MCP server; start from the repo root or it won't
connect. Vercel holds the same values as project env vars for production + preview.

## Gotchas

- **n8n's Cohere node defaults to `embed-english-v2.0` (4096 dims).** Both workflows pin v3.0
  (1024 dims) explicitly — a mismatch fails inserts or silently ruins retrieval.
- Cohere v3 needs `input_type`: `search_document` when indexing, `search_query` when querying.
- Use model id `deepseek-v4-flash` (this account's `/models` list omits `deepseek-chat`).
- **Tables created via a direct `DATABASE_URL` connection do not inherit Supabase's automatic
  CRUD grants** to `service_role` — they land with only `REFERENCES/TRIGGER/TRUNCATE`, so every
  service-key SELECT/INSERT returns `permission denied for table … 403`. `schema.sql` now grants
  `service_role` explicitly; `npm run db:schema` is idempotent and safe to re-run.
- `service_role` bypasses RLS — server-side only.
- **Fish Audio ASR needs paid API credit** (separate from platform credit); **TTS runs free** on
  `s2.1-pro-free`. Voice input therefore uses the browser's speech recognition, with Fish ASR as
  a fallback for when credit exists.
- **Fish TTS is slow on long text and times out on a whole answer.** Answers are split into
  ~240-char chunks and played back-to-back so the full reply is spoken (`src/lib/speech.ts`).
- The `n8n/*.workflow.ts` files are design sketches; the live workflows above are authoritative.

## Commands

```
npm run dev          # local dev server
npm test             # 100 tests, external APIs mocked
npm run lint
npm run typecheck
npm run build
npm run db:schema    # apply supabase/schema.sql (grants included; idempotent)
npm run db:seed      # 60 records, upserts
npm run db:verify    # schema, data and vector RPC sanity check
```
