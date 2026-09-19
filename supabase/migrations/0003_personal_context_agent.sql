-- Personal Context Agent expansion
create table if not exists personal_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users_profile(user_id) on delete cascade,
  kind text not null check (kind in ('preference','routine','relationship','goal','fact','pattern')),
  content text not null,
  confidence numeric not null default 0.7,
  source_date date,
  evidence jsonb not null default '{}',
  embedding vector(1536),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(user_id, kind, content)
);
create index if not exists idx_personal_memories_user on personal_memories(user_id, last_seen_at desc);
create index if not exists idx_personal_memories_embedding on personal_memories using hnsw (embedding vector_cosine_ops);

create table if not exists life_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users_profile(user_id) on delete cascade,
  source text not null check (source in ('audio','email','steps','location','calendar','photo','manual','device')),
  occurred_at timestamptz not null,
  ended_at timestamptz,
  title text,
  summary text,
  payload jsonb not null default '{}',
  external_id text,
  created_at timestamptz not null default now(),
  unique(user_id, source, external_id)
);
create index if not exists idx_life_signals_user_time on life_signals(user_id, occurred_at desc);

alter table personal_memories enable row level security;
alter table life_signals enable row level security;

create or replace function match_personal_memories(
  p_user_id uuid,
  p_embedding vector(1536),
  p_limit int default 12
) returns table (id uuid, kind text, content text, confidence numeric, similarity float)
language sql stable as $$
  select m.id, m.kind, m.content, m.confidence,
         1 - (m.embedding <=> p_embedding) as similarity
  from personal_memories m
  where m.user_id = p_user_id and m.embedding is not null
  order by m.embedding <=> p_embedding
  limit p_limit;
$$;
