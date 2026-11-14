-- Phase 1 (plan.md §5): tables, row-level security and the private media bucket.
-- Every row belongs to one user and is only ever visible to that user.

create extension if not exists vector with schema extensions;

-- Stamps each write with the server's clock. Devices pull "everything written since
-- my last pull" by this column, so it must not depend on any device's own clock.
create function public.touch_synced_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.synced_at := now();
  return new;
end;
$$;

-- ---------- folders ----------

create table public.folders (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,
  kind        text check (kind in ('thoughts', 'default')),  -- the two built-in folders; null otherwise
  parent_id   uuid references public.folders on delete set null,
  expanded    boolean not null default true,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  synced_at   timestamptz not null default now()
);
create unique index folders_one_builtin_per_user on public.folders (user_id, kind) where kind is not null;
create index folders_pull on public.folders (user_id, synced_at);
create trigger folders_touch before insert or update on public.folders
  for each row execute function public.touch_synced_at();

-- ---------- notes (quick thoughts are notes in the 'thoughts' folder) ----------

create table public.notes (
  id            uuid primary key,              -- generated on the device
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  folder_id     uuid references public.folders on delete set null,
  content       text not null default '',      -- editor HTML
  text          text not null default '',      -- plain text, one line per block
  title         text not null default '',
  snippet       text not null default '',
  pinned        boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,                   -- in Recently Deleted
  purged_at     timestamptz,                   -- deleted for good; row kept so other devices learn of it
  synced_at     timestamptz not null default now(),

  -- Captured on the device when the thought is saved.
  context       jsonb not null default '{}',

  -- Written by the enrich function (phase 3).
  enrichment    jsonb,
  enrich_status text not null default 'pending' check (enrich_status in ('pending', 'done', 'failed')),
  enriched_hash text,

  embedding     extensions.halfvec(1536),
  fts           tsvector generated always as (to_tsvector('english', title || ' ' || text)) stored
);
create index notes_embedding on public.notes using hnsw (embedding extensions.halfvec_cosine_ops);
create index notes_fts on public.notes using gin (fts);
create index notes_by_date on public.notes (user_id, created_at desc);
create index notes_pull on public.notes (user_id, synced_at);
create trigger notes_touch before insert or update on public.notes
  for each row execute function public.touch_synced_at();

-- ---------- links between related notes (phase 5) ----------

create table public.note_links (
  user_id  uuid not null default auth.uid() references auth.users on delete cascade,
  from_id  uuid not null references public.notes on delete cascade,
  to_id    uuid not null references public.notes on delete cascade,
  score    real not null,
  reason   text not null check (reason in ('similar', 'shared_tags', 'same_link')),
  primary key (from_id, to_id)
);
create index note_links_to on public.note_links (to_id);

-- ---------- files attached to notes ----------

create table public.attachments (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  note_id    uuid not null references public.notes on delete cascade,
  kind       text not null check (kind in ('image', 'sketch', 'audio')),
  path       text not null,                    -- object path in the 'media' bucket
  seconds    real,
  described  text,                             -- transcript or caption (phase 8)
  created_at timestamptz not null default now()
);
create index attachments_note on public.attachments (note_id);

-- ---------- row-level security ----------

alter table public.folders     enable row level security;
alter table public.notes       enable row level security;
alter table public.note_links  enable row level security;
alter table public.attachments enable row level security;

create policy "own folders" on public.folders for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own notes" on public.notes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own links" on public.note_links for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own attachments" on public.attachments for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Signed-in users only; anonymous visitors get nothing.
revoke all on public.folders, public.notes, public.note_links, public.attachments from anon;
grant select, insert, update, delete
  on public.folders, public.notes, public.note_links, public.attachments to authenticated;

-- ---------- media bucket: private, one top-level folder per user ----------

insert into storage.buckets (id, name, public) values ('media', 'media', false)
on conflict (id) do nothing;

create policy "own media: read" on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own media: add" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own media: change" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own media: remove" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
