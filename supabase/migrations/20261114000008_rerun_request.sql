-- A user can ask for a quick thought to be processed again with a named model
-- (the "reprocess with Claude Fable 5.2" button). The app writes the request here;
-- the pipeline carries it out and clears it.
alter table public.notes add column enrich_request jsonb;

drop trigger notes_enrich_changed on public.notes;

create trigger notes_enrich_changed after update on public.notes
  for each row when (
    (old.text is distinct from new.text
      or old.title is distinct from new.title
      or old.originals is distinct from new.originals
      or (new.enrich_request is not null and old.enrich_request is distinct from new.enrich_request))
    and new.text <> '' and new.purged_at is null
  )
  execute function public.queue_enrichment();
