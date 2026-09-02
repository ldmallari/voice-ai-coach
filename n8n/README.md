# n8n workflows

n8n is the **main orchestration layer**. Three workflows run on the provided
Railway instance (`primary-production-c0ce.up.railway.app`), all active.

| Workflow | ID | Webhook | Purpose |
|---|---|---|---|
| Main Orchestration | `0EVPI3YIuG4dom3b` | `POST /webhook/coach-chat` | DeepSeek **AI Agent** that answers a coaching turn. Tools: **Clinic Metrics** (HTTP → the app's `/api/tools`) and **Clinic Knowledge** (native Supabase vector retrieve-as-tool). Session memory keyed by `sessionId`. |
| Knowledge Ingest | `8K5CuLYnrtpdg7YY` | `POST /webhook/coach-ingest` | Chunk → Cohere embed → upsert into the Supabase `documents` vector store. |
| Knowledge Retrieval | `PYTsapmIGNDP4wDo` | `POST /webhook/coach-retrieve` | Cohere embed → similarity search → `{matches:[{title,content,similarity}]}`. |

The app is the primary caller: `/api/chat` posts to `coach-chat` (n8n orchestrates,
with an in-process fallback); `/api/documents` posts to `coach-ingest`; the
in-process agent's knowledge search posts to `coach-retrieve`.

## How the app and n8n connect

- `POST /api/chat` → `coach-chat`. The n8n agent's **Clinic Metrics** tool calls
  back to `https://voice-ai-coach.vercel.app/api/tools` with the `x-coach-secret`
  header, so exact figures are always computed in code (`src/lib/metrics.ts`),
  never by the model.
- Set `N8N_COACH_URL`, `N8N_INGEST_URL`, `N8N_RETRIEVAL_URL` in the app env.

## Credentials in n8n (reused by ID)

| Credential | ID | Used by |
|---|---|---|
| Cohere | `uxtOtEIzqzq68DNt` | embeddings in all three workflows |
| DeepSeek | `7lhVEg2d90IJdEYp` | the agent's chat model |
| Supabase (service_role) | `fQiSXhORB0qR3ugh` | the vector store nodes |

The Supabase credential must use the **service-role** key. And the DB tables need
explicit `service_role` grants (see `supabase/schema.sql`) or inserts return
`permission denied for table … 403`.

## Gotchas baked into the workflows

- Cohere is pinned to `embed-english-v3.0` (1024 dims). The node defaults to
  `embed-english-v2.0` (4096 dims), which will not fit `vector(1024)` and silently
  ruins retrieval.
- `queryName` is `match_documents`, matching `supabase/schema.sql`.
- The agent's HTTP tool uses the base `n8n-nodes-base.httpRequestTool`. The
  langchain `toolHttpRequest` node errored at runtime on this instance
  (`supplyData method but no execute method`).

## The `*.workflow.ts` files

`ingest.workflow.ts` and `retrieval.workflow.ts` are the original design sketches
(written against `@n8n/workflow-sdk`). The **live workflows above are
authoritative** — they were built and are maintained through the n8n MCP, whose
builder SDK differs slightly (e.g. `vectorStore()` / `tool()` factories, an added
Set node that reshapes retrieval output to `{title,content,similarity}`).
