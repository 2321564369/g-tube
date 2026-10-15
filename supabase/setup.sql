create extension if not exists pgcrypto;

create table if not exists public.galaxy_profiles (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username ~ '^[a-z0-9_-]{3,24}$'),
  pin_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.galaxy_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.galaxy_profiles(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.galaxy_user_data (
  user_id uuid not null references public.galaxy_profiles(id) on delete cascade,
  data_key text not null,
  value jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, data_key)
);

create table if not exists public.galaxy_auth_attempts (
  id bigint generated always as identity primary key,
  username text not null,
  attempted_at timestamptz not null default now()
);

alter table public.galaxy_profiles enable row level security;
alter table public.galaxy_sessions enable row level security;
alter table public.galaxy_user_data enable row level security;
alter table public.galaxy_auth_attempts enable row level security;

revoke all on public.galaxy_profiles from anon, authenticated;
revoke all on public.galaxy_sessions from anon, authenticated;
revoke all on public.galaxy_user_data from anon, authenticated;
revoke all on public.galaxy_auth_attempts from anon, authenticated;

create index if not exists galaxy_sessions_expiry_idx on public.galaxy_sessions (expires_at);
create index if not exists galaxy_auth_attempts_lookup_idx on public.galaxy_auth_attempts (username, attempted_at);

-- Run periodically to remove expired sessions and old login-attempt records.
create or replace function public.galaxy_cleanup_auth_data()
returns void
language plpgsql
security definer
as $
begin
  delete from public.galaxy_sessions where expires_at < now();
  delete from public.galaxy_auth_attempts where attempted_at < now() - interval '1 day';
end;
$;