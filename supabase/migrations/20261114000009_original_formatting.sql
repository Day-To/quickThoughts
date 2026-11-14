-- Each original capture now keeps the formatting it was entered with (`html`), as well
-- as its plain text. Pictures and recordings are left out of it: they live in the note.
create or replace function public.merge_notes(source uuid, target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notes t
  set originals = (
        case when jsonb_array_length(t.originals) = 0
          then jsonb_build_array(jsonb_build_object(
            'at', t.created_at, 'text', t.text, 'context', t.context,
            'html', regexp_replace(t.content, '<(img|audio)\M[^>]*>(</audio>)?', '', 'g')))
          else t.originals
        end
      ) || jsonb_build_object(
        'at', s.created_at, 'text', s.text, 'context', s.context,
        'html', regexp_replace(s.content, '<(img|audio)\M[^>]*>(</audio>)?', '', 'g')),
      content = t.content || s.content,
      text = t.text || E'\n' || s.text,
      updated_at = now()
  from public.notes s
  where t.id = target and s.id = source and s.user_id = t.user_id and s.id <> t.id;

  if not found then
    raise exception 'merge_notes: notes % and % cannot be merged', source, target;
  end if;

  update public.attachments set note_id = target where note_id = source;
  delete from public.note_links where from_id = source or to_id = source;
  update public.notes
  set purged_at = now(), updated_at = now(), content = '', text = '', title = '', snippet = '', embedding = null
  where id = source;
end;
$$;
