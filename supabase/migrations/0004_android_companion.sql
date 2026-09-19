-- Only the server service_role may read credentials. Raw tokens are never stored.
create table if not exists companion_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users_profile(user_id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  revoked_at timestamptz,
  last_seen_at timestamptz
);
create index if not exists idx_companion_devices_user on companion_devices(user_id);
alter table companion_devices enable row level security;
revoke all on companion_devices from anon, authenticated;
