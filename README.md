# Voice AI Coach — MVP

An AI business coach for aesthetic clinic owners, answering over **chat and voice** from two
sources of truth: structured clinic/customer data and an uploaded clinic knowledge base.

Built for the V-Unite applicant challenge. **Live:** https://voice-ai-coach.vercel.app

See `HANDOFF.md` for build-state notes and known gotchas.

## What it does

Ask by voice or text — the coach identifies whether a question needs the customer data or the
uploaded documents, retrieves the right source, explains what it found, and gives specific
coaching tied to this clinic's numbers rather than generic advice. It reads answers aloud,
saves the conversation, and can end a session with a prioritised action plan.

The UI is a voice-first design in light "clinical" emerald: a living orb, a chat-and-voice
composer (type a message or tap the orb to speak), a clinic KPI strip, and answers that reveal
as they arrive with a chip naming the source they drew on.

A passcode-gated **Knowledge base** panel manages the uploaded documents: list them with chunk
counts and upload dates, open one to read the exact text the coach ingested, upload a PDF/TXT
(re-uploading the same filename replaces it), and delete with a confirm step. The whole panel is
owner-only, so a public deployment can't have its knowledge read, wiped, or polluted by a
stranger.

## Stack

| Layer | Choice |
|---|---|
| Hosting | Vercel (production deploy gated on lint + typecheck + tests + build) |
| Web app | Next.js (App Router) + React + TypeScript |
| Database + vectors | Supabase (Postgres + pgvector) |
| Orchestration | n8n — the main AI backend / orchestration layer |
| Voice | Fish Audio (TTS) + the browser's speech recognition (STT) |
| Embeddings | Cohere `embed-english-v3.0` (1024d), free tier, called from n8n |
| LLM | DeepSeek `deepseek-v4-flash` (OpenAI-compatible, tool calling) |
| CI | GitHub Actions |

## Architecture

One agent, two retrieval paths, chosen by the question:

- **Structured** — deterministic calculations over 60 synthetic customer records (treatment,
  provider, amount spent, last visit, rebooked, satisfaction) for conversion, retention and
  rebooking questions. Figures are computed in code (`src/lib/metrics.ts`), never by the model.
- **Unstructured** — pgvector similarity search over chunked clinic documents (policies, SOPs,
  pricing, consultation scripts) for questions about what the clinic's own material says.

**n8n is the main orchestration layer.** Three active workflows on the provided instance:

| Workflow | Webhook | Role |
|---|---|---|
| Main Orchestration | `POST /webhook/coach-chat` | DeepSeek **AI Agent** with two tools: a Clinic Metrics HTTP tool (→ the app's `/api/tools`) and a native Supabase vector retrieve-as-tool for the knowledge base. Reports which sources it used, so the UI can cite them |
| Knowledge Ingest | `POST /webhook/coach-ingest` | Chunk → Cohere embed → upsert into the Supabase vector store |
| Knowledge Retrieval | `POST /webhook/coach-retrieve` | Cohere embed → similarity search → matching passages |

The app's `POST /api/chat` routes each turn through the `coach-chat` agent, with the in-process
agent as a resilient fallback if n8n is unreachable. Exact figures stay in application code and
are exposed to the n8n agent as an HTTP tool — vectors are for meaning, arithmetic is never left
to a language model. See `n8n/README.md` for workflow IDs, credentials and gotchas.

### App endpoints

| Route | Purpose |
|---|---|
| `POST /api/chat` | Answer a coaching turn (n8n primary, in-process fallback) |
| `POST /api/tools` | Deterministic metric tools for the n8n agent (shared-secret). Includes `get_clinic_report` — the whole data picture in one call, so broad questions need one round-trip, not four |
| `POST /api/documents` | Upload a PDF/TXT → extract text → forward to n8n ingest (replaces a same-named document) |
| `GET · DELETE /api/documents` | List / read a document's text / delete it — all gated by `KNOWLEDGE_ADMIN_PASSCODE` |
| `POST /api/voice/transcribe` · `POST /api/voice/speak` | Fish Audio ASR / TTS |
| `POST /api/sessions` · `POST /api/sessions/[id]/end` | Save a session; summarise into an action plan |
| `GET /api/overview` | Aggregate, non-identifying clinic KPIs for the header strip |

## Minimum requirements

- [x] Deployed web application (Vercel)
- [x] Chat mode
- [x] Voice input
- [x] Voice response
- [x] Three coaching topics (sales/conversion, customers/retention, clinic knowledge)
- [x] 50+ synthetic customer records (60)
- [x] Supabase for clinic/customer data
- [x] n8n as the main orchestration layer
- [x] AI uses both structured data and uploaded knowledge
- [x] PDF/TXT knowledge-base upload with meaningful vector search / RAG
- [x] Saved coaching sessions / conversations
- [x] End-of-session summary / action plan
- [x] GitHub repository with complete source code
- [x] Automated CI checks on push / pull request
- [x] Automated tests for business and AI workflow paths
- [x] Deployment fails when required checks fail (`vercel.json` build command)

## Voice

- **Input:** the browser's built-in speech recognition (instant, free, no external credit). The
  Fish Audio ASR endpoint is wired as a fallback; note that Fish **ASR requires paid API credit**,
  while **TTS runs on the free `s2.1-pro-free` model**.
- **Output:** Fish Audio TTS. Because the free model renders slowly on long text (and would time
  out on a whole answer), answers are split into sentence-sized chunks and played back-to-back so
  the full reply is spoken (`src/lib/speech.ts`). Set `FISH_VOICE_ID` to a Fish reference voice so
  every chunk speaks in one consistent voice — without it the free model picks a default speaker
  per request, which can drift between chunks.

## Model choice

`deepseek-v4-flash` — measured on a tool-calling turn at ~0.86s vs ~1.59s for pro, both returning
correct tool calls; flash chosen for perceived latency. DeepSeek exposes no embeddings endpoint,
so embeddings come from Cohere's free tier via n8n's native Embeddings Cohere node (using more
than one AI provider is a listed bonus). Cohere v3 needs `input_type` — `search_document` when
indexing, `search_query` when querying — or retrieval degrades silently.

## Local setup

```
cp .env.example .env.local     # then fill in the values
npm install
npm run db:schema              # apply supabase/schema.sql (grants included; idempotent)
npm run db:seed                # 60 deterministic customer records (upserts)
npm run db:verify              # sanity-check schema, data and the vector RPC
npm run dev
```

## Testing

125 automated tests (`npm test`) plus a Playwright end-to-end smoke test (`npm run test:e2e`),
alongside `npm run lint`, `npm run typecheck`, `npm run build`.

- Unit tests for deterministic business logic (rates, segmentation, speech chunking, the
  consolidated `get_clinic_report` proven byte-identical to the granular tools)
- Backend/integration tests for the tool, document, voice, overview and chat routes, and the
  gated knowledge-management routes (list / read / delete)
- Failure/regression cases (bad secret, missing passcode, unsupported upload, non-2xx voice/ingest)
- An end-to-end browser smoke test of the core flow — hero KPIs, a typed question with its source,
  and the knowledge panel (unlock, upload, read, delete-with-confirm) — with the backend stubbed
- Paid voice and LLM APIs are mocked in CI to avoid unnecessary cost

CI (GitHub Actions) runs lint + typecheck + tests + build + the E2E on every push and PR; the same
lint/typecheck/test/build run in the Vercel build command, so a red check blocks the production deploy.
