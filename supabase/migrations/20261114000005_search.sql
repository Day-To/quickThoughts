-- Phase 4 (plan.md §7): one function that finds a user's notes by meaning, by words,
-- by date, or any mix. It runs with the caller's own rights, so row-level security
-- guarantees it only ever sees the caller's notes.

create function public.search_notes(
  query_text      text default null,                     -- words to match exactly
  query_embedding extensions.halfvec(1536) default null, -- meaning to match
  from_date       date default null,                     -- inclusive, in the user's timezone
  to_date         date default null,                     -- inclusive
  tz              text default 'UTC',
  note_type       text default null,
  match_count     int default 20,
  min_similarity  real default 0.25,
  rrf_k           int default 50
)
returns table (id uuid, score real, similarity real)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with scope as not materialized (
    select n.id, n.created_at, n.fts, n.embedding
    from notes n
    where n.user_id = (select auth.uid())
      and n.purged_at is null
      and n.deleted_at is null
      and (from_date is null or n.created_at >= (from_date::timestamp at time zone tz))
      and (to_date is null or n.created_at < ((to_date + 1)::timestamp at time zone tz))
      and (note_type is null or n.enrichment->>'type' = note_type)
  ),
  -- Any of the words, not all of them: a question like "do I have anything about
  -- sunscreen" should still match a note that only says "sunscreen".
  words as (
    select websearch_to_tsquery('english', regexp_replace(trim(coalesce(query_text, '')), '\s+', ' or ', 'g')) as q
  ),
  keyword as (
    select s.id, row_number() over (order by ts_rank_cd(s.fts, w.q) desc) as rank
    from scope s, words w
    where query_text is not null and s.fts @@ w.q
    order by rank
    limit least(match_count, 50) * 2
  ),
  semantic as (
    select s.id,
           1 - (s.embedding <=> query_embedding) as similarity,
           row_number() over (order by s.embedding <=> query_embedding) as rank
    from scope s
    where query_embedding is not null
      and s.embedding is not null
      and 1 - (s.embedding <=> query_embedding) >= min_similarity
    order by rank
    limit least(match_count, 50) * 2
  ),
  -- Reciprocal rank fusion: a note scores for each list it appears in, more the higher it ranks.
  ranked as (
    select coalesce(k.id, m.id) as id,
           coalesce(1.0 / (rrf_k + k.rank), 0) + coalesce(1.0 / (rrf_k + m.rank), 0) as score,
           m.similarity
    from keyword k
    full outer join semantic m on k.id = m.id
    union all
    -- No topic at all ("last week"): everything in the date range.
    select s.id, 0, null
    from scope s
    where query_text is null and query_embedding is null
  )
  select r.id, r.score::real, r.similarity::real
  from ranked r
  join scope s on s.id = r.id
  order by r.score desc, s.created_at desc
  limit match_count;
$$;

revoke all on function public.search_notes(text, extensions.halfvec, date, date, text, text, int, real, int) from public, anon;
grant execute on function public.search_notes(text, extensions.halfvec, date, date, text, text, int, real, int) to authenticated;
