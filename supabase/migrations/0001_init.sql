-- diarog (AI 라이프로그) 초기 스키마 v1
-- 실행 위치: Supabase Dashboard > SQL Editor (프로젝트 okrecbetvcdglnjlprqj)
-- 참고: 앱 서버는 service_role 키로 접근하며(RLS 우회), 모든 사용자 스코핑은
--       서버 코드에서 강제한다. RLS는 전 테이블 활성화 + 정책 없음(anon/authenticated
--       완전 차단)으로 심층 방어를 구성한다.

create extension if not exists vector;

-- 1. 사용자 프로필 (자체 세션 인증: Google sub 기준)
create table if not exists users_profile (
  user_id uuid primary key default gen_random_uuid(),
  google_sub text unique not null,
  email text,
  display_name text,
  avatar_url text,
  persona_type text not null default 'plain'
    check (persona_type in ('plain','essay','humor','dry')),
  ritual_time time not null default '21:00',
  calendar_connected boolean not null default false,
  google_refresh_token text,
  push_subscription jsonb,
  plan text not null default 'free',
  onboarded boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2. 사진
create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users_profile(user_id) on delete cascade,
  taken_at timestamptz not null,
  time_confidence text not null default 'exif' check (time_confidence in ('exif','file','unknown')),
  lat double precision,
  lng double precision,
  gps_source text not null default 'none' check (gps_source in ('exif','interpolated','none')),
  storage_thumb_path text not null,
  storage_mid_path text not null,
  exif_raw jsonb,
  is_receipt boolean not null default false,
  receipt jsonb,
  moment_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_photos_user_taken on photos(user_id, taken_at);
create index if not exists idx_photos_moment on photos(moment_id);

-- 3. 캘린더 이벤트 캐시 (description 미수집 — 최소 수집 원칙)
create table if not exists calendar_events_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users_profile(user_id) on delete cascade,
  gcal_event_id text not null,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  location_text text,
  loc_lat double precision,
  loc_lng double precision,
  attendees jsonb not null default '[]',
  synced_at timestamptz not null default now(),
  unique(user_id, gcal_event_id)
);
create index if not exists idx_cal_user_time on calendar_events_cache(user_id, starts_at);

-- 4. Moment
create table if not exists moments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users_profile(user_id) on delete cascade,
  date date not null,
  seq int not null default 0,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  place_name text,
  place_category text,
  address text,
  lat double precision,
  lng double precision,
  linked_event_id uuid references calendar_events_cache(id) on delete set null,
  link_confidence numeric,
  people jsonb not null default '[]',
  mood text,
  memo text,
  status text not null default 'draft' check (status in ('draft','confirmed','soft_confirmed')),
  weather jsonb,
  ai jsonb,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index if not exists idx_moments_user_date on moments(user_id, date);

alter table public.photos
drop constraint if exists fk_photos_moment;

alter table photos
  add constraint fk_photos_moment foreign key (moment_id) references moments(id) on delete set null;

-- 5. 증거 (설명가능성)
create table if not exists moment_evidence (
  id uuid primary key default gen_random_uuid(),
  moment_id uuid not null references moments(id) on delete cascade,
  type text not null check (type in ('photo','calendar','poi','weather','receipt','user_answer','interpolated_gps')),
  payload jsonb not null default '{}',
  score numeric,
  score_breakdown jsonb
);
create index if not exists idx_evidence_moment on moment_evidence(moment_id);

-- 6. 버튼 질문
create table if not exists moment_questions (
  id uuid primary key default gen_random_uuid(),
  moment_id uuid not null references moments(id) on delete cascade,
  user_id uuid not null references users_profile(user_id) on delete cascade,
  question_text text not null,
  options jsonb not null default '["맞아요","아니에요"]',
  target text not null default 'event_link',
  payload jsonb,
  answer text,
  answered_at timestamptz,
  confidence_before numeric
);
create index if not exists idx_questions_user on moment_questions(user_id, answered_at);

-- 7. 일기
create table if not exists diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users_profile(user_id) on delete cascade,
  date date not null,
  body_final text,
  body_generated text,
  sentences jsonb not null default '[]', -- [{text, evidence_refs[], kind:'fact'|'inference'}]
  one_line text,
  persona_type_used text,
  few_shot_count int not null default 0,
  edited boolean not null default false,
  created_at timestamptz not null default now(),
  unique(user_id, date)
);

-- 8. 페르소나 2층 학습 (원문→수정문 쌍)
create table if not exists persona_edits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users_profile(user_id) on delete cascade,
  source text not null default 'diary' check (source in ('diary','moment_title')),
  original text not null,
  revised text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_persona_edits_user on persona_edits(user_id, created_at desc);

-- 9. 교정 기록 (MOAT 데이터)
create table if not exists corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users_profile(user_id) on delete cascade,
  moment_id uuid references moments(id) on delete set null,
  kind text not null check (kind in ('title','place','event_link','people','split','merge','photo_remove','question_answer','mood','memo')),
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

-- 10. 주간 회고
create table if not exists weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users_profile(user_id) on delete cascade,
  week_start date not null,
  body text,
  highlights jsonb not null default '[]',
  stats jsonb not null default '{}',
  opened_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, week_start)
);

-- 11. 검색 인덱스 (pgvector)
create table if not exists search_index (
  moment_id uuid primary key references moments(id) on delete cascade,
  user_id uuid not null references users_profile(user_id) on delete cascade,
  date date not null,
  summary text not null,
  embedding vector(1536),
  updated_at timestamptz not null default now()
);
create index if not exists idx_search_embedding on search_index
  using hnsw (embedding vector_cosine_ops);

-- 12. AI 사용량 원장 (K8 원가 지표)
create table if not exists usage_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users_profile(user_id) on delete set null,
  date date not null default (now() at time zone 'Asia/Seoul')::date,
  kind text not null, -- call1|call2|call3|call4|embed
  model text,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  est_cost numeric not null default 0,
  ok boolean not null default true,
  latency_ms int,
  created_at timestamptz not null default now()
);
create index if not exists idx_usage_user_date on usage_ledger(user_id, date);

-- 13. 분석 이벤트 (§12 최소 세트)
create table if not exists analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  name text not null,
  props jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_events_name on analytics_events(name, created_at);

-- RLS: 전 테이블 활성화, 정책 없음 → anon/authenticated 키로는 접근 불가.
alter table users_profile enable row level security;
alter table photos enable row level security;
alter table calendar_events_cache enable row level security;
alter table moments enable row level security;
alter table moment_evidence enable row level security;
alter table moment_questions enable row level security;
alter table diary_entries enable row level security;
alter table persona_edits enable row level security;
alter table corrections enable row level security;
alter table weekly_reviews enable row level security;
alter table search_index enable row level security;
alter table usage_ledger enable row level security;
alter table analytics_events enable row level security;

-- 자연어 검색 RPC (서버 전용 호출)
create or replace function match_moments(
  p_user_id uuid,
  p_embedding vector(1536),
  p_from date,
  p_to date,
  p_limit int default 20
) returns table (moment_id uuid, date date, summary text, similarity float)
language sql stable as $$
  select s.moment_id, s.date, s.summary,
         1 - (s.embedding <=> p_embedding) as similarity
  from search_index s
  where s.user_id = p_user_id
    and s.embedding is not null
    and (p_from is null or s.date >= p_from)
    and (p_to is null or s.date <= p_to)
  order by s.embedding <=> p_embedding
  limit p_limit;
$$;

-- 스토리지 버킷(photos, 비공개)은 앱 서버가 service_role로 자동 생성한다.
