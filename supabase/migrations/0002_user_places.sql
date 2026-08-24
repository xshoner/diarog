-- 내 장소 (사용자 지정 장소 별칭): 등록 반경 내에서 찍은 사진은 이 이름으로 표시
-- 실행 위치: Supabase Dashboard > SQL Editor (프로젝트 okrecbetvcdglnjlprqj)

create table if not exists user_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users_profile(user_id) on delete cascade,
  name text not null,
  lat double precision not null,
  lng double precision not null,
  radius_m int not null default 150,
  created_at timestamptz not null default now(),
  unique(user_id, name)
);
create index if not exists idx_user_places_user on user_places(user_id);

-- RLS: 활성화 + 정책 없음 (서버 service_role 전용 접근, 0001과 동일한 심층 방어)
alter table user_places enable row level security;
