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
-- ---------------------------------------------------------------------------
create table if not exists documents (
  id          uuid primary key default gen_random_uuid(),
  title       text        not null,
  source_type text        not null check (source_type in ('pdf','txt')),
  byte_size   integer     not null,
  uploaded_at timestamptz not null default now()
);

create table if not exists document_chunks (
  id          bigserial primary key,
  document_id uuid    not null references documents (id) on delete cascade,
  chunk_index integer not null,
  content     text    not null,
  -- 1536 dims matches text-embedding-3-small.
  embedding   vector(1536),
  unique (document_id, chunk_index)
);

-- Approximate nearest neighbour over cosine distance.
create index if not exists document_chunks_embedding_idx
  on document_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

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
-- 4. Vector search RPC
-- ---------------------------------------------------------------------------
create or replace function match_document_chunks (
  query_embedding vector(1536),
  match_count     int default 5,
  min_similarity  float default 0.2
)
returns table (
  content    text,
  title      text,
  similarity float
)
language sql stable
as $$
  select
    dc.content,
    d.title,
    1 - (dc.embedding <=> query_embedding) as similarity
  from document_chunks dc
  join documents d on d.id = dc.document_id
  where dc.embedding is not null
    and 1 - (dc.embedding <=> query_embedding) > min_similarity
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;
