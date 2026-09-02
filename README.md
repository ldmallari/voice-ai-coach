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
| LLM | Anthropic Claude |
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
