-- Voice AI Coach — Supabase schema
-- Two sources of truth: structured consultation records, and chunked clinic documents.

create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- 1. Structured clinic / customer data
-- ---------------------------------------------------------------------------
create table if not exists customers (
  id             text primary key,
  customer_name  text        not null,
  treatment      text        not null,
  provider       text        not null,
  status         text        not null check (status in ('purchased','declined','consultation_only')),
  amount_spent   numeric(10,2) not null default 0 check (amount_spent >= 0),
  last_visit     date        not null,
  rebooked       boolean     not null default false,
  satisfaction   smallint    check (satisfaction between 1 and 5),
  created_at     timestamptz not null default now(),

  -- Spend and rebooking only make sense against a purchase; enforced here so bad
  -- rows cannot exist even if a caller gets it wrong.
  constraint spend_requires_purchase
    check (status = 'purchased' or amount_spent = 0),
  constraint rebooking_requires_purchase
    check (status = 'purchased' or rebooked = false)
);

create index if not exists customers_treatment_idx on customers (treatment);
create index if not exists customers_provider_idx  on customers (provider);
create index if not exists customers_last_visit_idx on customers (last_visit desc);

-- ---------------------------------------------------------------------------
-- 2. Clinic knowledge base (PDF / TXT uploads)
--
-- Shaped to LangChain's Supabase convention so n8n's Supabase Vector Store node
-- can insert and query it directly, rather than needing a bespoke adapter.
-- 1024 dimensions matches Cohere embed-english-v3.0, used on Cohere's free tier
-- via n8n's native Embeddings Cohere node.
-- ---------------------------------------------------------------------------
create table if not exists documents (
  id        bigserial primary key,
  content   text,
  metadata  jsonb,
  embedding vector(1024)
);

-- Approximate nearest neighbour over cosine distance.
create index if not exists documents_embedding_idx
  on documents using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Signature required by the LangChain / n8n Supabase vector store integration.
create or replace function match_documents (
  query_embedding vector(1024),
  match_count     int default 5,
  filter          jsonb default '{}'
)
returns table (
  id         bigint,
  content    text,
  metadata   jsonb,
  similarity float
)
language plpgsql stable
as $$
begin
  return query
  select
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity
  from documents d
  where d.metadata @> filter
    and d.embedding is not null
  order by d.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Coaching sessions
-- ---------------------------------------------------------------------------
create table if not exists coaching_sessions (
  id         uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  summary    text,
  action_plan jsonb
);

create table if not exists coaching_messages (
  id         bigserial primary key,
  session_id uuid not null references coaching_sessions (id) on delete cascade,
  role       text not null check (role in ('user','assistant')),
  content    text not null,
  -- Which source of truth answered this turn, so the UI can cite it.
  sources    text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists coaching_messages_session_idx
  on coaching_messages (session_id, created_at);

-- ---------------------------------------------------------------------------
-- 4. Grants
--
-- Tables created through a direct Postgres connection (our db:schema script,
-- which connects as `postgres`) do NOT inherit Supabase's automatic CRUD grants
-- to the API roles: they land with only REFERENCES/TRIGGER/TRUNCATE, so every
-- SELECT/INSERT reaching the tables through PostgREST or n8n's Supabase Vector
-- Store node is denied with "permission denied for table". Grant the
-- server-side service_role explicitly. anon and authenticated are deliberately
-- left without data access — nothing here is meant to be reachable unauthenticated.
-- ---------------------------------------------------------------------------
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function match_documents(vector, int, jsonb) to service_role;
