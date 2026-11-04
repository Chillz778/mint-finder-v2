do $$
begin
  create type public.app_role as enum ('admin', 'user');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role public.app_role not null,
  unique (user_id, role)
);

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
drop policy if exists "own roles readable" on public.user_roles;
create policy "own roles readable" on public.user_roles
  for select to authenticated using (user_id = auth.uid());
revoke all on function public.has_role(uuid, public.app_role) from public, anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  x_handle text,
  x_url text,
  description text,
  image_url text,
  website text,
  mint_url text,
  chain text not null default 'ethereum',
  rule text not null default 'check_site',
  holder_contract text,
  opensea_slug text,
  mint_date timestamptz,
  price text,
  created_at timestamptz not null default now()
);

grant select on public.projects to anon, authenticated;
grant insert, update, delete on public.projects to authenticated;
grant all on public.projects to service_role;
alter table public.projects enable row level security;
drop policy if exists "projects public read" on public.projects;
drop policy if exists "admin insert projects" on public.projects;
drop policy if exists "admin update projects" on public.projects;
drop policy if exists "admin delete projects" on public.projects;
create policy "projects public read" on public.projects
  for select to anon, authenticated using (true);
create policy "admin insert projects" on public.projects
  for insert to authenticated with check (public.has_role(auth.uid(), 'admin'));
create policy "admin update projects" on public.projects
  for update to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "admin delete projects" on public.projects
  for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

create table if not exists public.allowlist_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  wallet text not null,
  unique (project_id, wallet)
);

create index if not exists allowlist_wallet_idx on public.allowlist_entries(wallet);
grant select, insert, delete on public.allowlist_entries to authenticated;
grant all on public.allowlist_entries to service_role;
alter table public.allowlist_entries enable row level security;
drop policy if exists "admin read lists" on public.allowlist_entries;
drop policy if exists "admin add lists" on public.allowlist_entries;
drop policy if exists "admin remove lists" on public.allowlist_entries;
create policy "admin read lists" on public.allowlist_entries
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "admin add lists" on public.allowlist_entries
  for insert to authenticated with check (public.has_role(auth.uid(), 'admin'));
create policy "admin remove lists" on public.allowlist_entries
  for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

create or replace function public.allowlisted_projects(_wallet text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select project_id
  from public.allowlist_entries
  where wallet = lower(trim(_wallet))
$$;

revoke all on function public.allowlisted_projects(text) from public;
grant execute on function public.allowlisted_projects(text) to anon, authenticated;

-- Do not automatically grant admin to the first public sign-up.
drop trigger if exists on_auth_user_created_admin on auth.users;
drop function if exists public.grant_first_admin();
