# Voice AI Coach — MVP

An AI business coach for aesthetic clinic owners, answering over chat and voice from two
sources of truth: structured clinic/customer data and an uploaded clinic knowledge base.

Built for the V-Unite applicant challenge.

## Stack

| Layer | Choice |
|---|---|
| Hosting | Vercel |
| Database + vectors | Supabase (Postgres + pgvector) |
| Orchestration | n8n (main backend / orchestration layer) |
| Voice in/out | Fish Audio |
| Embeddings | Cohere `embed-english-v3.0` (1024d), free tier, called from n8n |
| LLM | DeepSeek `deepseek-v4-flash` (OpenAI-compatible, tool calling) |
| CI | GitHub Actions |

## Architecture

Two retrieval paths behind one agent, chosen by the question:

- **Structured** — SQL over ~50 synthetic customer records (treatment, provider, amount
  spent, last visit, rebooked, satisfaction) for questions about conversion, retention
  and rebooking rates.
- **Unstructured** — pgvector similarity search over chunked clinic documents (policies,
  SOPs, pricing, consultation scripts) for questions about what the clinic's own
  material says.

The agent must say which source it used and what it found, then give specific coaching
rather than generic advice.

## Requirements checklist

- [ ] Deployed web application (Vercel)
- [ ] Chat mode
- [ ] Voice input
- [ ] Voice response
- [ ] Supabase for clinic/customer data
- [ ] 50+ synthetic customer records
- [ ] n8n as main orchestration layer
- [ ] PDF/TXT knowledge-base upload with vector search / RAG
- [ ] AI uses both structured data and uploaded knowledge
- [ ] Saved coaching sessions / conversations
- [ ] End-of-session summary or action plan
- [ ] GitHub repository with complete source code
- [ ] Automated CI checks on push / PR
- [ ] Automated tests for business and AI workflow paths
- [ ] Deployment blocked when required checks fail

## Model choice

`deepseek-v4-flash`, verified against the account's `/models` endpoint. Measured on a
tool-calling turn: flash 0.86s, pro 1.59s, both returning correct tool calls. Flash was
chosen for perceived latency; override with `DEEPSEEK_MODEL`.

DeepSeek exposes no embeddings endpoint (`/embeddings` returns 404 on both `/embeddings`
and `/v1/embeddings`), so embeddings come from Cohere's free tier, called inside n8n
through its native Embeddings Cohere node. Using more than one AI provider is a listed
bonus in the challenge brief.

Cohere's v3 embedding models require an `input_type`: `search_document` when indexing
chunks and `search_query` when embedding a question. Getting that wrong silently degrades
retrieval, so it is worth verifying in the n8n node configuration rather than assuming.

## Why n8n owns retrieval

The brief requires n8n to be the main orchestration layer, so retrieval genuinely runs
there rather than being decorative: n8n embeds via Cohere and reads and writes a Supabase
Vector Store. The knowledge tables therefore follow LangChain's
Supabase convention (`documents` + `match_documents`) so the n8n node works natively.

Exact figures stay in application code and are exposed to n8n as HTTP tools. Vectors are
for meaning; arithmetic is never left to a language model.

## Local setup

```
cp .env.example .env
npm install
npm run dev
```

## Testing

- Unit tests for deterministic business logic (rates, segmentation, calculations)
- Integration test for one backend path
- One end-to-end / smoke test of a core coaching flow
- At least one failure / regression case
- Paid voice and LLM APIs are mocked in CI to avoid unnecessary cost
