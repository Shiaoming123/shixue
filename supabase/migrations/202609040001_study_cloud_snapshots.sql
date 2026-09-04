create table if not exists public.study_cloud_snapshots (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  record_id text not null default 'current' check (record_id = 'current'),
  revision text not null,
  mutation jsonb not null check (jsonb_typeof(mutation) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.study_cloud_snapshots enable row level security;

revoke all on table public.study_cloud_snapshots from public, anon;
grant select, insert, update on table public.study_cloud_snapshots to authenticated;

create policy "study cloud owners select their snapshot"
  on public.study_cloud_snapshots
  for select
  to authenticated
  using (auth.uid() = owner_id);

create policy "study cloud owners insert their snapshot"
  on public.study_cloud_snapshots
  for insert
  to authenticated
  with check (auth.uid() = owner_id);

create policy "study cloud owners update their snapshot"
  on public.study_cloud_snapshots
  for update
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create or replace function public.study_cloud_cas_snapshot(
  p_snapshot jsonb,
  p_expected_revision text default null
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  next_revision text := p_snapshot ->> 'revision';
  affected_rows integer;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if jsonb_typeof(p_snapshot) <> 'object'
    or p_snapshot ->> 'collection' <> 'study_state'
    or p_snapshot ->> 'recordId' <> 'current'
    or p_snapshot ->> 'kind' <> 'upsert'
    or next_revision is null
    or length(next_revision) = 0
    or length(next_revision) > 512
  then
    raise exception 'invalid study cloud snapshot';
  end if;

  if p_expected_revision is null then
    insert into public.study_cloud_snapshots (
      owner_id,
      record_id,
      revision,
      mutation,
      updated_at
    ) values (
      current_user_id,
      'current',
      next_revision,
      p_snapshot,
      now()
    )
    on conflict (owner_id) do nothing;
  else
    update public.study_cloud_snapshots
      set revision = next_revision,
          mutation = p_snapshot,
          updated_at = now()
      where owner_id = current_user_id
        and revision = p_expected_revision;
  end if;

  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

revoke all on function public.study_cloud_cas_snapshot(jsonb, text) from public, anon;
grant execute on function public.study_cloud_cas_snapshot(jsonb, text) to authenticated;
