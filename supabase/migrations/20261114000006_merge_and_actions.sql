-- New thought pipeline: a new thought is first compared with earlier ones.
--   very similar (score 90+)  -> merged into the earlier thought
--   related      (score 60-89) -> linked
-- then the (possibly merged) thought is enriched with a title, a body and actions.

-- Every capture that went into a thought, oldest first. Filled in when thoughts are merged.
alter table public.notes add column originals jsonb not null default '[]';

-- Folds `source` into `target` (both must belong to the same user) and retires `source`.
create function public.merge_notes(source uuid, target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notes t
  set originals = (
        case when jsonb_array_length(t.originals) = 0
          then jsonb_build_array(jsonb_build_object('at', t.created_at, 'text', t.text, 'context', t.context))
          else t.originals
        end
      ) || jsonb_build_object('at', s.created_at, 'text', s.text, 'context', s.context),
      content = t.content || s.content,
      text = t.text || E'\n' || s.text,
      updated_at = now()
  from public.notes s
  where t.id = target and s.id = source and s.user_id = t.user_id and s.id <> t.id;

  if not found then
    raise exception 'merge_notes: notes % and % cannot be merged', source, target;
  end if;

  -- Files stay where they are in storage; the merged note's HTML still points at them.
  update public.attachments set note_id = target where note_id = source;
  delete from public.note_links where from_id = source or to_id = source;
  -- Kept as an empty marker so every device drops its copy.
  update public.notes
  set purged_at = now(), updated_at = now(), content = '', text = '', title = '', snippet = '', embedding = null
  where id = source;
end;
$$;

revoke all on function public.merge_notes(uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_notes(uuid, uuid) to service_role;

-- Enrichment now also runs actions (fetching pages, web lookups), which take longer:
-- smaller batches, and five minutes before an unfinished job is retried.
create or replace function public.process_enrichment(batch_size int default 2)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  jobs jsonb;
  project_url text;
  secret text;
begin
  select jsonb_agg(jsonb_build_object('msg_id', msg_id, 'id', message->>'id', 'read_ct', read_ct))
    into jobs
    from pgmq.read('enrich_jobs', 300, batch_size);
  if jobs is null then
    return;
  end if;

  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'enrich_secret';
  if project_url is null or secret is null then
    raise warning 'enrichment is not configured: project_url / enrich_secret missing from vault';
    return;
  end if;

  perform net.http_post(
    url := project_url || '/functions/v1/enrich',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-enrich-secret', secret),
    body := jobs,
    timeout_milliseconds := 140000
  );
end;
$$;
