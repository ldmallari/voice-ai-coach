# Session handoff — Voice AI Coach MVP

Paste this into a new Claude Code session started from this directory.

## The task

Build the V-Unite applicant challenge: a **Voice AI Coach for aesthetic clinic owners**
that answers over chat and voice from two sources of truth — structured clinic/customer
data and an uploaded clinic knowledge base.

**Due Friday 4 September, 4:00 PM PHT.** A technical interview follows at 5:00 PM the
same day, so submit early in the afternoon. Brief is at
`~/Downloads/V-Unite_Voice_AI_Coach_MVP_Applicant_Challenge_Final_v4 (1).pdf`.

Scoring weights that drive priorities: agent architecture 18%, working end-to-end MVP
17%, QA/CI 15%, data/RAG/tools 12%, responsiveness 12%, voice 8%, n8n 8%, code
architecture 5%, UI/UX 5%.

## Repo and accounts

- Repo: `https://github.com/ldmallari/voice-ai-coach` (**private**)
- Commits use the personal identity `mallarilevin@gmail.com` (repo-local git config);
  global config remains the work address
- Pushes authenticate as `ldmallari` via a repo-local credential helper pointing at
  `~/.config/gh-personal`. The default `gh` account (`levinmallari`, work) is untouched
- To run `gh` against this repo: `GH_CONFIG_DIR="$HOME/.config/gh-personal" gh <cmd>`

## Stack and why

| Layer | Choice | Reason |
|---|---|---|
| Hosting | Vercel | Required by the brief. **Not yet deployed** |
| Database + vectors | Supabase, project `zxjbxogadvincdzpshst` | Required. pgvector 0.8.2, live |
| Reasoning model | DeepSeek `deepseek-v4-flash` | Provided by V-Unite. Tool calling verified. Flash 0.86s vs pro 1.59s |
| Embeddings | Cohere `embed-english-v3.0` (1024d) | Emmanuel suggested the free tier. DeepSeek has no embeddings endpoint |
| Orchestration | n8n on Railway, provided by Emmanuel | Brief requires n8n be the **main** orchestration layer |
| Voice | Fish Audio | Required. **Key not yet obtained** |

## Credentials

Never commit these. `.env.local` and `.mcp.json` are gitignored.

- `.env.local` holds `DEEPSEEK_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `DATABASE_URL`, `COHERE_API_KEY` (local verification only), `COACH_TOOL_SECRET`
- n8n holds the **Cohere** credential. A **Supabase** credential still needs adding there
- `.mcp.json` registers the n8n MCP server as `n8n-coach`. It is read from the session
  root, so **start Claude Code from this directory** or it will not connect
- All of these are exposed in the previous chat transcript. Rotate after submission

## Status — updated 2 Sep (mvp branch, PR #1)

95 tests passing, CI green on the PR. Work continues on the `mvp` branch; `main`
is the production line and the merge is the deploy gate.

### Deployed to n8n (Railway `n8n-coach`), all active

| Workflow | ID | Webhook | Verified |
|---|---|---|---|
| Knowledge Ingest | `8K5CuLYnrtpdg7YY` | `/webhook/coach-ingest` | ✅ live |
| Knowledge Retrieval | `PYTsapmIGNDP4wDo` | `/webhook/coach-retrieve` | ✅ live |
| Main Orchestration (DeepSeek agent) | `jb1YGfVUXUQwZ5re` | `/webhook/coach-chat` | ✅ knowledge path live; metrics HTTP tool awaits the Vercel URL |

Credentials wired: Cohere (`uxtOtEIzqzq68DNt`), DeepSeek (`7lhVEg2d90IJdEYp`),
Supabase (`fQiSXhORB0qR3ugh`). The Supabase credential must use the **service-role**
key (host `https://zxjbxogadvincdzpshst.supabase.co`).

### Built this session
- `POST /api/documents` — PDF/TXT upload → text extract (unpdf) → n8n ingest
- `POST /api/voice/transcribe` + `/api/voice/speak` — Fish Audio ASR + TTS
- UI: voice mic (browser SpeechRecognition primary, Fish ASR fallback), spoken
  answers (Fish TTS), document upload, saved sessions, end-of-session action plan
- `src/lib/orchestrator.ts` + `/api/chat` — route through the n8n agent when
  `N8N_COACH_URL` is set, in-process agent as fallback
- `vercel.json` — build runs lint+typecheck+test before build (deploy gate)
- `schema.sql` — explicit `service_role` grants (see gotchas)

### The two live external constraints
- **Fish Audio API credit is $0.** TTS works on the free `s2.1-pro-free` model;
  ASR (voice input) needs paid credit. Browser SpeechRecognition covers voice
  input meanwhile. Top up at https://fish.audio/app/developers to use Fish ASR.
- **Vercel not deployed.** See Remaining.

## Earlier work

62 tests passing, 0 npm vulnerabilities, CI green on every push.

- Next 16 / React 19 / TypeScript, Tailwind, App Router
- `src/lib/metrics.ts` — pure business calculations (conversion, rebooking, retention,
  per-treatment and per-provider breakdowns). Every figure in an answer comes from here,
  never from the model
- `src/lib/router.ts` — deterministic SQL-vs-vector routing, falls back to `both`
- `src/lib/synthetic.ts` — seeded 60-record dataset. Deliberately uneven: CoolSculpting
  converts at 7% against a 52% clinic average, and Nurse Kahu is 22 points below peers,
  so the coach has real signal to find
- `src/lib/tools.ts` — tool definitions shared by the agent loop and the HTTP endpoint
- `src/lib/agent.ts` — DeepSeek tool-use loop, bounded turns, source citation
- `src/lib/sessions.ts` + `src/lib/summary.ts` — session persistence and a zod-validated
  action plan with a fallback when the model returns unusable JSON
- `POST /api/chat`, `POST /api/tools` (shared secret, constant-time compare, fails
  closed), `POST /api/sessions`, `POST /api/sessions/[id]/end`
- `supabase/schema.sql` applied and seeded. `documents` + `match_documents` follow
  LangChain's convention so n8n's Supabase Vector Store node works natively
- `n8n/ingest.workflow.ts` and `n8n/retrieval.workflow.ts` — written and committed,
  **not yet deployed** to the Railway instance

## Remaining, in priority order

1. **Vercel deploy** — connect the GitHub repo (Production branch = `main`; the
   `mvp` branch gets Preview deploys). Set env vars from `.env.local`
   (DEEPSEEK_*, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, COHERE_API_KEY,
   COACH_TOOL_SECRET, FISH_AUDIO_API_KEY, N8N_RETRIEVAL_URL, N8N_INGEST_URL).
2. **After Vercel is live** (Claude does these):
   - Update the Main Orchestration "Clinic Metrics" tool URL from the placeholder
     `https://voice-ai-coach.vercel.app/api/tools` to the real deployment URL.
   - Set `N8N_COACH_URL=…/webhook/coach-chat` in Vercel env so n8n becomes the
     primary path, then test the metrics path through n8n end-to-end.
3. **Fish Audio API credit** — top up to enable server-side Fish ASR (voice input
   currently works via the browser).
4. **Branch protection on `main`** — require the CI check before merge (the second
   half of the deploy gate).

Done: n8n workflows deployed + active, document upload, voice I/O, saved sessions
and action plan, n8n main orchestration, CI + deploy gate.

## Gotchas already hit

- **n8n's Cohere node defaults to `embed-english-v2.0`, which is 4096 dimensions.** Both
  workflows pin v3.0 explicitly. A mismatch fails inserts or silently ruins retrieval
- Cohere v3 needs `input_type`: `search_document` when indexing, `search_query` when
  querying. Wrong values degrade retrieval quietly
- `deepseek-chat` works but is absent from the account's `/models` list. Use
  `deepseek-v4-flash`
- A stale `match_document_chunks` function broke the first schema apply. Schema is now
  idempotent; `npm run db:schema` is safe to re-run
- An earlier workflow was accidentally created on the **company** n8n
  (`workflow.backroomop.com`) and has been archived. Build only against `n8n-coach`
- `service_role` bypasses RLS. Server-side only
- **Tables created via the direct `DATABASE_URL` connection do not inherit
  Supabase's automatic CRUD grants** to `service_role`/`anon`/`authenticated` —
  they land with only `REFERENCES/TRIGGER/TRUNCATE`, so every service-key
  SELECT/INSERT (app reads and the n8n vector store) returns `permission denied
  for table … 403`. `schema.sql` now grants `service_role` explicitly; re-run
  `npm run db:schema` after any fresh project
- **Fish Audio ASR needs paid API credit** (separate from platform credit); TTS
  runs on the free `s2.1-pro-free` model. Browser SpeechRecognition is the voice-
  input fallback so the demo works at $0 credit
- The n8n Cohere/DeepSeek/Supabase credentials are reused by ID in the deployed
  workflows; the app's `.mcp.json` bearer token reaches the same n8n instance

## Commands

```
npm run dev          # local dev server
npm test             # 62 tests, external APIs mocked
npm run lint         # eslint (next lint was removed in Next 16)
npm run typecheck
npm run build
npm run db:schema    # apply supabase/schema.sql, idempotent
npm run db:seed      # 60 records, upserts
npm run db:verify    # schema, data and vector RPC sanity check
```
