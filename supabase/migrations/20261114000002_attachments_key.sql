-- One row per file per note, so re-syncing a note updates its attachment rows instead of duplicating them.
alter table public.attachments alter column id set default gen_random_uuid();
alter table public.attachments add constraint attachments_note_path_key unique (note_id, path);
