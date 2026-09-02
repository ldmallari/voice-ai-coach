# n8n workflows

Workflow definitions kept in the repository so the orchestration layer is version
controlled alongside the application, rather than existing only as clicked-together
state inside n8n.

| File | Path | Purpose |
|---|---|---|
| `ingest.workflow.ts` | `POST /webhook/coach-ingest` | Chunk, embed and store a clinic document |
| `retrieval.workflow.ts` | `POST /webhook/coach-retrieve` | Embed a question and return matching passages |

## Credentials required in n8n

| Credential | Value |
|---|---|
| Cohere | Trial API key |
| Supabase | Project host + service role key |

## Notes

Both workflows pin Cohere to `embed-english-v3.0` (1024 dimensions). The node
defaults to `embed-english-v2.0`, which is 4096 dimensions and does not fit the
`vector(1024)` column. Ingest and retrieval must use the same model, or inserts
succeed while searches quietly return nothing relevant.

`queryName` is `match_documents`, matching the function defined in
`supabase/schema.sql`.
