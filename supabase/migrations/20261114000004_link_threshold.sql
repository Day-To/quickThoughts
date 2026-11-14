-- Calibrated on sample notes with text-embedding-3-small: clearly related pairs scored
-- 0.54-0.59, an adjacent-topic pair 0.45, and unrelated pairs 0.39 or lower.
-- 0.55 (the first guess) missed real matches; 0.45 sits in the gap.
drop function public.related_notes(uuid, real, int);

create function public.related_notes(target uuid, min_similarity real default 0.45, max_results int default 5)
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

revoke all on function public.related_notes(uuid, real, int) from public, anon, authenticated;
grant execute on function public.related_notes(uuid, real, int) to service_role;
