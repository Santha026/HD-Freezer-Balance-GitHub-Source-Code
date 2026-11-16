-- Run in Supabase SQL Editor in a new project.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'field' check(role in ('admin','field')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.hd_master (
  hd_code text primary key,
  hd_name text not null default '',
  location text not null default '',
  rsm text not null default '',
  zsm text not null default '',
  sdm text not null default '',
  total_deposit numeric(18,2) not null default 0,
  security_deposit numeric(18,2) not null default 0
);
create table if not exists public.assets (
  id bigint generated always as identity primary key,
  hd_code text not null,
  asset_tag text not null default '',
  capacity text not null default '',
  asset_value numeric(18,2) not null default 0
);
create index if not exists assets_hd_code_idx on public.assets(hd_code);
create or replace function public.is_active_user() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where user_id = (select auth.uid()) and active = true);
$$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where user_id = (select auth.uid()) and role = 'admin' and active = true);
$$;
revoke all on function public.is_active_user() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.is_active_user(), public.is_admin() to authenticated;
alter table public.profiles enable row level security;
alter table public.hd_master enable row level security;
alter table public.assets enable row level security;
drop policy if exists "profile self read" on public.profiles;
create policy "profile self read" on public.profiles for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "active users read master" on public.hd_master;
create policy "active users read master" on public.hd_master for select to authenticated using ((select public.is_active_user()));
drop policy if exists "active users read assets" on public.assets;
create policy "active users read assets" on public.assets for select to authenticated using ((select public.is_active_user()));
-- No client INSERT/UPDATE/DELETE policies. Only an authorized RPC may replace data.
-- Atomic replacement: a failed upload leaves existing data intact.
create or replace function public.replace_hd_dataset(p_master jsonb, p_assets jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m_count int; a_count int;
begin
  if not public.is_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
  if jsonb_typeof(p_master) <> 'array' or jsonb_typeof(p_assets) <> 'array' then raise exception 'Both datasets must be arrays'; end if;
  m_count := jsonb_array_length(p_master); a_count := jsonb_array_length(p_assets);
  if m_count = 0 then raise exception 'HD master cannot be empty'; end if;
  if m_count > 100000 or a_count > 200000 then raise exception 'Dataset exceeds single-request limits; use a server-side batch importer'; end if;
  if exists(select 1 from jsonb_array_elements(p_master) e where nullif(btrim(e->>'hd_code'),'') is null) then raise exception 'Missing HD Code in master'; end if;
  if exists(select 1 from jsonb_array_elements(p_assets) e where nullif(btrim(e->>'hd_code'),'') is null) then raise exception 'Missing HD Code in assets'; end if;
  if exists(select 1 from jsonb_array_elements(p_assets) e where not exists(select 1 from jsonb_array_elements(p_master) m where m->>'hd_code' = e->>'hd_code')) then raise exception 'Assets contain HD Codes not present in HD master'; end if;
  delete from public.assets;
  delete from public.hd_master;
  insert into public.hd_master(hd_code,hd_name,location,rsm,zsm,sdm,total_deposit,security_deposit)
  select hd_code,coalesce(hd_name,''),coalesce(location,''),coalesce(rsm,''),coalesce(zsm,''),coalesce(sdm,''),coalesce(total_deposit,0),coalesce(security_deposit,0)
  from jsonb_to_recordset(p_master) as x(hd_code text,hd_name text,location text,rsm text,zsm text,sdm text,total_deposit numeric,security_deposit numeric);
  insert into public.assets(hd_code,asset_tag,capacity,asset_value)
  select hd_code,coalesce(asset_tag,''),coalesce(capacity,''),coalesce(asset_value,0)
  from jsonb_to_recordset(p_assets) as x(hd_code text,asset_tag text,capacity text,asset_value numeric);
  return jsonb_build_object('hd_count',m_count,'asset_count',a_count);
end;$$;
revoke all on function public.replace_hd_dataset(jsonb,jsonb) from public;
revoke all on function public.replace_hd_dataset(jsonb,jsonb) from anon;
grant execute on function public.replace_hd_dataset(jsonb,jsonb) to authenticated;
-- Create accounts manually in Authentication > Users. Then assign roles in SQL Editor:
-- insert into public.profiles(user_id,role,active) values ('AUTH_USER_UUID','admin',true)
-- on conflict(user_id) do update set role='admin',active=true;
-- Repeat with role='field' for field users. Disable public signup in Auth settings.
