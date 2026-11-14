-- Phase 3 (plan.md §6): background enrichment.
-- A changed note is put on a queue; every 10 seconds a scheduled job hands queued notes
-- to the `enrich` Edge Function, which adds tags, an embedding and links to related notes.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pgmq;

select pgmq.create('enrich_jobs');

-- ---------- queue a note when its words change ----------

create function public.queue_enrichment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pgmq.send('enrich_jobs', jsonb_build_object('id', new.id));
  return new;
end;
$$;

create trigger notes_enrich_new after insert on public.notes
  for each row when (new.text <> '' and new.purged_at is null)
  execute function public.queue_enrichment();

-- Only when the words actually changed: pinning, moving or the enrichment itself
-- being written back must not queue the note again.
create trigger notes_enrich_changed after update on public.notes
  for each row when (
    (old.text is distinct from new.text or old.title is distinct from new.title)
    and new.text <> '' and new.purged_at is null
  )
  execute function public.queue_enrichment();

-- ---------- hand queued notes to the Edge Function ----------

-- The function URL and a shared secret live in Vault (set outside migrations so the
-- secret is never written to a file). The function rejects calls without the secret.
create function public.process_enrichment(batch_size int default 5)
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
  -- Reading hides a job for 120 seconds; if the function doesn't finish and delete it
  -- in that time it becomes visible again, which is the retry.
  select jsonb_agg(jsonb_build_object('msg_id', msg_id, 'id', message->>'id', 'read_ct', read_ct))
    into jobs
    from pgmq.read('enrich_jobs', 120, batch_size);
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
    timeout_milliseconds := 100000
  );
end;
$$;

create function public.finish_enrichment(msg_ids bigint[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  msg bigint;
begin
  foreach msg in array msg_ids loop
    perform pgmq.delete('enrich_jobs', msg);
  end loop;
end;
$$;

-- ---------- nearest notes by meaning, for link chains ----------

create function public.related_notes(target uuid, min_similarity real default 0.55, max_results int default 5)
returns table (id uuid, similarity real)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select other.id, (1 - (other.embedding <=> source.embedding))::real as similarity
  from notes source
  join notes other on other.user_id = source.user_id and other.id <> source.id
  where source.id = target
    and source.embedding is not null
    and other.embedding is not null
    and other.purged_at is null
    and other.deleted_at is null
    and 1 - (other.embedding <=> source.embedding) >= min_similarity
  order by other.embedding <=> source.embedding
  limit max_results;
$$;

-- These run with elevated rights, so only the server may call them.
revoke all on function public.queue_enrichment() from public, anon, authenticated;
revoke all on function public.process_enrichment(int) from public, anon, authenticated;
revoke all on function public.finish_enrichment(bigint[]) from public, anon, authenticated;
revoke all on function public.related_notes(uuid, real, int) from public, anon, authenticated;
grant execute on function public.finish_enrichment(bigint[]) to service_role;
grant execute on function public.related_notes(uuid, real, int) to service_role;

select cron.schedule('process-enrichment', '10 seconds', $$select public.process_enrichment()$$);
