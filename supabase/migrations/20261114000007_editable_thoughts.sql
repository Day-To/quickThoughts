-- A quick thought is now an ordinary, fully editable note: the pipeline writes its
-- organised title and body into the note itself, and keeps the words the user
-- actually captured in `originals`.
--
--   editing the note's text  -> search data is refreshed, the text is left alone
--   editing an original      -> the thought is processed again and rewritten
--
-- So a note is queued when its words OR its originals change; the function decides which case it is.

drop trigger notes_enrich_changed on public.notes;

create trigger notes_enrich_changed after update on public.notes
  for each row when (
    (old.text is distinct from new.text
      or old.title is distinct from new.title
      or old.originals is distinct from new.originals)
    and new.text <> '' and new.purged_at is null
  )
  execute function public.queue_enrichment();
