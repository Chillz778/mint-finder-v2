create or replace function public.allowlisted_projects(_wallet text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select entries.project_id
  from public.allowlist_entries as entries
  join public.projects as projects on projects.id = entries.project_id
  where (
    projects.chain = 'solana'
    and entries.wallet = trim(_wallet)
  ) or (
    projects.chain <> 'solana'
    and entries.wallet = lower(trim(_wallet))
  )
$$;

revoke all on function public.allowlisted_projects(text) from public;
grant execute on function public.allowlisted_projects(text) to anon, authenticated;
