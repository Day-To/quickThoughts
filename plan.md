# Quick Thoughts — execution plan

Status: phases 1–5 done; phase 6 (installable PWA) is next (see §15) · written 14 Nov 2026

## 1. What we are building

An installable app (PWA) for capturing the random thoughts a person has during the day
that might matter later, and for getting them back when needed.

> "If you are ever buying sunscreen, buy from these brands — Lakme, Minimalist,
> Aqualogica (best), Dermaco." Open the app, type it, done. Months later: "do I have
> anything about sunscreen?" and it comes back with everything attached to it.

The loop:

1. The user records a thought (text, checklist, image, voice, sketch, or a shared link).
2. The app attaches context: time, day, date, timezone, place, how it was captured.
3. An LLM adds a title, type, category, tags and named things.
4. The thought is compared with the user's earlier thoughts and linked to related ones.
5. It is stored with a vector embedding so it can be found by meaning, by words, or by date.

Retrieval is one search box that understands "what did I think last week", "on 3 Nov",
"anything about sunscreen".

## 2. Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Embeddings | OpenAI `text-embedding-3-small` | Notes will live in a cloud database anyway, so on-device embedding no longer buys privacy or offline search; one server-side model keeps a single vector space. |
| Enrichment LLM | A small OpenAI model, name kept in config | Prices and model names move; the model is chosen from OpenAI's pricing page when phase 3 starts. |
| Database, auth, files, server code | Supabase (Postgres + pgvector, Auth, Storage, Edge Functions) | One service covers all four; pgvector keeps vectors next to the rows they describe. |
| App | The existing Next.js app, made installable | Composer, editor, library and phone layout are already built. |

Consequence: the on-device embedding code added earlier (`lib/embeddings.ts`,
`lib/embed.worker.ts`, the `@huggingface/transformers` dependency) is removed in phase 3.

## 3. Where things stand today

Built and working, all in the browser with no backend:

- Home screen composer: rich text with auto-formatting, images, voice recording, sketches.
- Notes library: folders, note list, rich editor, search by text, Recently Deleted.
- Phone layout (one pane at a time) and desktop layout (three columns).
- Storage: one IndexedDB record holding all folders and notes. Images, sketches and
  recordings are embedded inside each note's HTML as base64.
- On-device embeddings and a `semanticSearch()` function with no UI.

Not built: accounts, cloud storage, sync between devices, context capture, enrichment,
linking, natural-language search, link summaries, installability, offline app shell.

## 4. Architecture

```
Phone / desktop browser (PWA)
  ├─ UI (Next.js, client-rendered)
  ├─ Local store (IndexedDB): everything the user sees, plus an outbox of unsent changes
  └─ Sync engine: pushes the outbox, pulls remote changes
        │  HTTPS, user's session token
        ▼
Supabase
  ├─ Auth: who the user is
  ├─ Postgres: folders, notes, links, attachments  (row-level security on every table)
  │     ├─ pgvector: embedding column + HNSW index
  │     ├─ full-text column + GIN index
  │     └─ queue (pgmq) + scheduler (pg_cron) + HTTP (pg_net)
  ├─ Storage: private bucket for images, sketches, recordings
  └─ Edge Functions (hold the OpenAI key)
        ├─ enrich        background: context → LLM → embedding → links
        ├─ search        query → parse → embed → hybrid search
        └─ capture-link  fetch page → extract text → summarise
              │
              ▼
           OpenAI API
```

Principles:

- **Capture never waits.** A thought is saved locally the instant the user saves it.
  Sync and enrichment happen afterwards.
- **The OpenAI key never reaches the browser.** Only Edge Functions call OpenAI.
- **Local-first UI.** Screens read from the local store, so the app opens and works
  offline; the cloud is the source of truth across devices.

## 5. Data model

"Thoughts" stay what they are today: notes in the Quick Thoughts folder. One `notes`
table serves both, so every note is enriched and searchable, not only quick thoughts.

```sql
create table folders (
  id          uuid primary key,
  user_id     uuid not null references auth.users,
  name        text not null,
  kind        text,                            -- 'thoughts' | 'default' for the two built-in folders, else null
  parent_id   uuid references folders,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table notes (
  id            uuid primary key,              -- generated on the device
  user_id       uuid not null references auth.users,
  folder_id     uuid references folders,
  content       text not null,                 -- editor HTML
  text          text not null,                 -- plain text, one line per block
  title         text not null default '',
  snippet       text not null default '',
  pinned        boolean not null default false,
  created_at    timestamptz not null,
  updated_at    timestamptz not null,
  deleted_at    timestamptz,                   -- Recently Deleted
  purged_at     timestamptz,                   -- deleted for good; kept so other devices learn of it

  -- step 2: context captured on the device
  context       jsonb not null default '{}',   -- { timezone, local_time, weekday, part_of_day,
                                               --   source, lat, lng, accuracy_m, place }

  -- step 3: written by the enrich function
  enrichment    jsonb,                         -- { type, category, tags[], entities[], summary, has_todos }
  enrich_status text not null default 'pending',  -- pending | done | failed
  enriched_hash text,                          -- hash of the text that was enriched

  -- step 5
  embedding     halfvec(1536),
  fts           tsvector generated always as (to_tsvector('english', title || ' ' || text)) stored
);
create index on notes using hnsw (embedding halfvec_cosine_ops);
create index on notes using gin (fts);
create index on notes (user_id, created_at desc);

create table note_links (                      -- step 4
  user_id   uuid not null references auth.users,
  from_id   uuid not null references notes on delete cascade,
  to_id     uuid not null references notes on delete cascade,
  score     real not null,                     -- cosine similarity
  reason    text not null,                     -- 'similar' | 'shared_tags' | 'same_link'
  primary key (from_id, to_id)
);

create table attachments (
  id          uuid primary key,
  user_id     uuid not null references auth.users,
  note_id     uuid not null references notes on delete cascade,
  kind        text not null,                   -- image | sketch | audio
  path        text not null,                   -- object path in the private bucket
  seconds     real,                            -- audio length
  described   text                             -- transcript or caption (phase 7)
);
```

Every table gets row-level security: `user_id = auth.uid()` for select, insert, update
and delete. Storage paths start with the user's id and the bucket policy enforces it.

Ids: new notes and folders already get UUIDs on the device. The built-in folders
(`thoughts`, `notes`) and the sample notes use short text ids today, so the first upload
gives them UUIDs and the built-in folders are recognised by `kind` instead of by id.

Vector column: `halfvec(1536)` is what Supabase's own guide uses for
`text-embedding-3-small`. It keeps the model's full 1536 dimensions at half precision,
about 3 KB per note. (An earlier message suggested 512 dimensions; that is a later
storage lever, not the starting point.)

## 6. The capture pipeline

**Step 1 — record.** Unchanged for the user. The note is written to the local store and
added to the outbox. The sync engine upserts it into `notes` when online.

**Step 2 — context.** Captured on the device at save time and stored in `context`:

- Time, timezone, weekday, part of day (morning / afternoon / evening / night).
- Source: typed, voice, sketch, image, shared link.
- Location, only if the user has allowed it: latitude, longitude, accuracy. A readable
  place name is added later by the enrich function (provider is an open decision, §13).

**Step 3 — enrichment.** Runs in the background, following Supabase's documented
pattern (extensions `vector`, `pgmq`, `pg_net`, `pg_cron`, `hstore`):

1. A trigger on `notes` (insert, or update of `text`) puts a job on a queue.
2. A scheduled job (every 10 seconds in the guide) reads the queue in batches and calls
   the `enrich` Edge Function.
3. `enrich`, per note:
   - Skips if the text hash equals `enriched_hash` (no change since last time).
   - Calls the LLM with the text and context, asking for a fixed JSON structure:
     `type`, `category`, `tags`, `entities`, `summary`, `has_todos`. The prompt is given
     the user's existing categories and most-used tags so it reuses them instead of
     inventing near-duplicates.
   - Embeds `title + text + tags + place` with `text-embedding-3-small`.
   - Writes `enrichment`, `embedding`, `enriched_hash`, `enrich_status = 'done'`.
4. Failures are retried by the queue; after repeated failure the status is `failed`
   and the note remains fully usable, just not enriched.

**Step 4 — link chain.** In the same function, after embedding: find the user's nearest
notes by cosine similarity, keep those above a threshold (0.45, see §18) and upsert `note_links` rows in both directions.
Links for a note are recomputed whenever it is re-enriched.

**Step 5 — store.** Already done by steps 1–4: the row holds content, context,
enrichment, embedding and keyword index.

The app shows enrichment when it arrives (pulled by the sync engine): tags and category
on the thought card, a "Related" list in the note view.

## 7. Search

One `search` Edge Function, called from the existing search box:

1. **Parse.** A small LLM call, given today's date and the user's timezone, turns the
   query into `{ from, to, topic, type }`.
   "what did I think about sunscreen last week" → last week's date range + "sunscreen".
2. **Date-only queries** (no topic) skip embedding and return notes in the range, newest first.
3. **Otherwise** embed the topic and call one SQL function, `search_notes`, with the
   user's own token so row-level security applies. It:
   - filters by user, date range, type, and not deleted;
   - ranks by meaning (vector distance) and by exact words (full-text);
   - merges the two rankings with reciprocal rank fusion (Supabase's hybrid-search recipe).
4. Results open the note with its tags, context (when, where) and related notes.

Offline, the search box falls back to today's plain text search over the local store.

Later (not in the first cut): a short written answer above the results that cites the
notes it used.

## 8. Link capture

- **Getting the link in.** Paste a URL into the composer; a lone URL is recognised as a
  link thought. On Android the installed app also appears in the share sheet (manifest
  `share_target`). iOS Safari does not support this for web apps, so on iPhone it is
  paste only unless the app is later wrapped natively.
- **`capture-link` function.** Fetches the page server-side, extracts the readable text,
  asks the LLM for a title and a short summary, and stores them on the note
  (`enrichment.link = { url, site, title, summary }`). The normal enrich step then tags
  and embeds it.
- **Guards.** Only http/https; block private and local addresses; cap download size and
  time; fall back to "saved link, no summary" for pages that block bots, need a login,
  or render only with JavaScript.

## 9. Notes, checklists, formatting

Already built: the composer and the editor share one editor setup with auto-formatting
(checklists, dashed / bulleted / numbered lists, headings, bold, and so on).
`enrichment.has_todos` lets search and filters find thoughts with open checklist items.

## 10. Sync and offline

- The local store stays as is; each change also appends to an **outbox**.
- **Push:** when online and signed in, send the outbox in order (upserts keyed by id).
- **Pull:** fetch rows with `updated_at` newer than the last cursor; merge into the store.
- **Conflicts:** last write wins per note, by `updated_at`. Simultaneous edits of one
  note on two devices can lose the older edit; acceptable for a personal capture tool,
  and revisited only if it bites.
- **Deletes:** Recently Deleted is `deleted_at`. "Delete permanently" sets `purged_at`,
  removes the content and files, and keeps the empty row so other devices drop it too.
- **Media:** moves out of the note HTML into Storage. The HTML references an attachment
  id; the app resolves it to a local blob (cached in IndexedDB) or a signed URL.
  This is the largest change to existing code and the main risk in phase 2.
- **First sign-in:** everything currently in the browser is uploaded once, including
  extracting the embedded base64 media into Storage and re-keying the built-in folders
  and sample notes to UUIDs (see §5).

## 11. PWA

- `app/manifest.ts` (Next.js built-in), icons, standalone display, theme colours.
- A service worker that caches the app shell so the app opens offline. The bundled
  Next.js guide covers the manifest and push notifications but not offline caching, so
  this is either hand-written or done with a library (decided in phase 6).
- Installability, the microphone, location and service workers all need HTTPS, so the
  app must be deployed (or served over local HTTPS) to be tested on a phone.
- Android share target (see §8). Push notifications are out of scope for now.

## 12. Security and privacy

- Row-level security on every table and on the Storage bucket.
- The browser only ever holds the Supabase URL and the public (anon) key.
- The OpenAI key lives in Supabase function secrets.
- The scheduled job calls `enrich` from inside the database with no user session, so
  the function must verify a shared secret (kept in Supabase Vault) and reject
  anything else. The guide does not add this by itself.
- `search` and `capture-link` require a signed-in user's token.
- Every note's text is sent to OpenAI for enrichment and embedding. Location is opt-in.

## 13. Open decisions

| # | Question | Default if not decided |
|---|---|---|
| 1 | Personal tool, or other people from day one? | Build multi-user-safe from the start. |
| 2 | Sign-in method | **Decided:** sign-in is mandatory; nothing in the app is reachable signed out. Email + password, with account creation (Supabase emails a confirmation link), "forgot password" reset, and an emailed sign-in link as an alternative. Still open: Supabase's built-in mailer sends only 2 emails an hour and its emails carry links, not typed codes; both need custom SMTP before other people use the app. |
| 3 | Location | Opt-in; store coordinates and a place name. |
| 4 | Place-name provider (reverse geocoding) | Start with coordinates only; pick a provider in phase 3. |
| 5 | iPhone has no share-sheet entry for web apps | Accept paste-only for now. |
| 6 | Hosting for the Next.js app | Decide before phase 6; needed for HTTPS on a phone. |
| 7 | Language of notes | English full-text config. If notes mix languages, switch the keyword index to the `simple` config. |

## 14. Cost and scale

Estimates, not quotes. Token counts are assumptions; OpenAI prices are from third-party
trackers because OpenAI's pricing page could not be fetched while writing this.

- **Embedding:** $0.02 per million tokens. A 150-token thought costs about $0.000003.
- **Enrichment:** on a nano-class model at $0.05 in / $0.40 out per million tokens,
  about 600 tokens in and 200 out is roughly $0.0001 per thought.
- **Per user:** 10 thoughts a day is about $0.40 a year; 100 a day about $4 a year.
  Search adds one small parse call and one embedding per query.
- **Vectors:** about 3 KB per note before the index. 10 notes a day is roughly 11 MB a
  year per user.
- **Supabase (from its pricing page):** Free is $0 with 500 MB database, 1 GB file
  storage, 500,000 function calls; free projects pause after a week of inactivity.
  Pro is from $25 a month with 8 GB database disk, 100 GB file storage, 2 million calls.
- **Likely first limit:** file storage (images and recordings), not vectors or tokens.
- **Scaling path:** pgvector with an HNSW index is expected to hold up to millions of
  rows (not benchmarked here). If storage becomes the constraint, shorten embeddings
  (the model supports fewer dimensions) before considering a separate vector database.

## 15. Build phases

Each phase ends with something usable and a check that proves it.

| Phase | Scope | Done when |
|---|---|---|
| 1. Foundation ✅ | Supabase project, extensions, schema, row-level security, sign-in screen | A second account cannot read the first account's rows (tested). **Done:** `scripts/test-rls.mjs` passes 15 checks against the live project; sign-in, reload and sign-out tested with a throwaway account. |
| 2. Cloud sync ✅ | Outbox, push/pull, media to Storage, one-time upload of existing local data, offline behaviour | A thought captured offline on one device appears on another after reconnecting, with its image and recording. **Done:** two-device test passes, including a sketch stored as a file and restored on a second device. |
| 3. Enrichment ✅ | Context capture, queue + `enrich` function, tags on cards; remove on-device embeddings | A new thought gains tags and an embedding within about a minute, and a failed OpenAI call is retried. **Done:** `scripts/test-enrich.mjs` passes 13 checks; in the app, tags appeared on a card 16 s after capture. Retry is by queue design and was not exercised with a forced failure. |
| 4. Search ✅ | `search` function, `search_notes` SQL, results UI | "sunscreen", "last 7 days" and "sunscreen last week" each return the right notes. **Done:** `scripts/test-search.mjs` passes 13 checks (word, meaning, date-only, topic + date, full question, type, nonsense, other account, signed out); the search box on the home screen and in the library both use it. |
| 5. Link chains ✅ | `note_links`, Related list in the note view | A second sunscreen thought shows the first as related, and vice versa. **Done:** a "Related" strip under the open note; tested by opening one sunscreen note and following the strip to the other. |
| 6. PWA | Manifest, icons, service worker, deploy over HTTPS | Installs on Android and iPhone and opens with no network. |
| 7. Links | Paste-URL capture, `capture-link`, Android share target | Sharing an article produces a titled, summarised thought. |
| 8. Media understanding | Voice transcription, image captions feed enrichment | A voice note is found by words spoken in it. |

Order rationale: sync before intelligence, because enrichment runs on rows in the
database; search before links, because it reuses the embedding and proves its quality.

## 16. Risks

- **Media migration (phase 2).** Moving base64 out of note HTML touches the editor, the
  composer, thought cards and stored data. Mitigation: keep reading the old inline
  format while writing the new one.
- **Enrichment cost on edits.** Every edit re-queues the note. Mitigation: the hash
  check, plus syncing a note only after typing pauses.
- **Tag sprawl.** LLMs invent near-duplicate tags. Mitigation: feed existing tags into
  the prompt; add a merge tool only if needed.
- **Link threshold.** Too low links everything, too high links nothing. Mitigation:
  tune on real notes in phase 5; store the score so the UI can cut off later.
- **Free project pausing.** A paused project stops sync. Mitigation: move to Pro before
  relying on it daily.
- **iPhone limits.** No share target; storage for installed web apps can be evicted
  under pressure. The cloud copy is the safety net.

## 17. Configuration needed

In `.env.local` (names listed in `.env.example`):

| Variable | Used by | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser | No (public by design; safety comes from row-level security) |
| `SUPABASE_PROJECT_REF` | Supabase CLI: migrations, function deploys | No |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI | Yes |
| `SUPABASE_DB_PASSWORD` | Supabase CLI: applying migrations | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Local admin scripts and tests only; never the browser | Yes |
| `OPENAI_API_KEY` | Copied into Supabase function secrets; never the browser | Yes |
| `OPENAI_ENRICH_MODEL` | Model name for enrichment and query parsing | No |

## 18. Review log

Checked against sources on 14 Nov 2026:

- Supabase automatic-embeddings guide: extensions, trigger → queue → cron → function
  flow, 10-second schedule, `halfvec(1536)` with `text-embedding-3-small`, retry
  behaviour, and that the cron-initiated call carries no user authorisation.
- Supabase hybrid-search guide: `tsvector` + vector columns, GIN + HNSW indexes,
  reciprocal rank fusion, RPC call with the user's token for row-level security.
- Supabase pricing page: Free and Pro limits quoted in §14.
- Next.js docs bundled with this project's version: manifest via `app/manifest.ts`;
  the PWA guide does not cover offline caching.
- WebKit bug 194593: Web Share Target still unsupported on iOS Safari.

Changed while building phases 1–2:

- Sign-in is an emailed link, not a typed code (Supabase restriction, see §13 #2).
- A server-stamped `synced_at` column (set by trigger) is the pull cursor, so sync does
  not depend on any device's clock. `updated_at` stays the device's edit time and decides
  which copy wins.
- Sample notes are uploaded only to an empty account; on an account that already has
  data they are dropped from the new device, so samples are never duplicated.
- Signing out pushes pending changes, then clears the device's local copy. It refuses to
  sign out if changes could not be saved.
- Dirty tracking is a set of changed ids rather than an ordered outbox.

Changed while building phase 3:

- Enrichment model is `gpt-5-nano` (available on this key; about 2 s per note).
- Link threshold is 0.45, not 0.55. Measured on sample notes: related pairs scored
  0.54–0.59, an adjacent-topic pair 0.45, unrelated pairs 0.39 or lower.
- Links are by similarity only. The "two or more shared tags" rule is not implemented.
- Location: coordinates only, rounded to about 11 m, taken from a fix refreshed when the
  home screen opens and after each capture (so saving never waits for GPS). No place
  name yet (§13 #4).
- Media stays embedded in the note on the device and is converted to files only when
  syncing (`lib/media-sync.ts`), so no screen had to change.
- Known gap: when an image is removed from a note, its file stays in Storage until the
  note itself is deleted for good.
- The app asks for fresh data 15 s and 40 s after pushing a note, so tags show up
  without waiting for the 60 s poll.

Changed while building phases 4–5:

- Queries with no time or type words skip the LLM and go straight to embedding + search
  (about 0.6 s). Queries that mention time or a kind of note are parsed first (1–2 s).
- Keyword matching is "any of the words", so a full question still matches a note that
  contains only its topic word.
- Results below a similarity of 0.32 to the query are dropped, so nonsense returns
  nothing. In testing, relevant notes scored 0.40+ and unrelated ones 0.28 or less.
- While typing, the list filters by plain text on the device; ranked cloud results
  replace it after a 0.45 s pause. Signed out or offline it stays plain text.
- The home screen has a search field; results replace the recent-thoughts list.
- Related notes are fetched when a note is opened (needs a connection); they are not
  stored on the device.
- A deterministic guard drops a "topic" that is only the note type ("my todos"), after
  the LLM was seen returning it and matching nothing.

Changed after phase 5 (authentication):

- The app is gated: signed out, only the sign-in screen renders (`components/account/auth-screen.tsx`).
- Signing out still clears the device after pushing pending changes, and now lands on the sign-in screen.
- "Local-first without an account" no longer applies; the device copy is a cache of the signed-in account.

Changed after phase 5 (home screen and search UI):

- The home screen is the composer only. Recent thoughts are no longer listed there; a
  brief "Saved to Quick Thoughts" line confirms each capture.
- All search bars are gone. A search icon (home header, library toolbar, phone note list)
  or Cmd+K opens a Spotlight-style panel (`components/search/spotlight.tsx`): instant
  plain-text matches while typing, ranked cloud results after a pause, arrow keys and
  Return to open, tags and the understood date range shown.
- Search state moved out of the notes store into the panel; the note list no longer
  has a "Search Results" mode.

Changed after phase 5 (thought pipeline redesign, supersedes parts of §6):

- **Order:** similarity first, then enrichment, then actions.
- **Similarity** is a 0–100 score from the LLM, not raw embedding distance. Embeddings
  only shortlist the three closest earlier notes (cosine 0.40+); their raw numbers are
  not percentages (plainly related notes score about 0.55), so 90 / 60 cannot be
  applied to them directly.
  - 90+ and both are quick thoughts: the new thought is merged into the earlier one
    (`merge_notes`); the later row is kept only as a purged marker. Only a newly added
    thought can be merged; editing an old one never triggers a merge.
  - 60–89: linked both ways in `note_links` (score stored as 0.60–0.89).
  - below 60: nothing.
- **Enrichment** now writes `title`, `summary`, `points`, `checklist` and `actions` as
  well as type, category, tags and entities. `notes.originals` keeps each capture that
  went into a merged thought.
- **Action worker** (inside the `enrich` function, after the page is first written):
  - `fetch_link`: a URL in the thought is fetched (public http/https only), and its
    title, site, image and a two-sentence summary are stored. This replaces phase 7's
    `capture-link` function.
  - `research`: a web lookup through OpenAI's built-in search, proposed by the LLM or
    forced for shopping / recommendation thoughts that name things. One per thought.
- **Thought page** (`components/notes/thought-view.tsx`): quick thoughts open as an
  organised page (title, body, images, checklist, link cards, web findings, tags) with
  the original words and an "Actions taken" timeline beside it. "Edit original" opens
  the editor. Ticked checklist items are stored in `context.checked`.
- Organised titles apply to quick thoughts only; ordinary notes keep the first line the
  user typed.
- Not done: thoughts enriched before this change keep their old enrichment (tags only)
  until their words are edited. Cost of web lookups is not yet measured.

Changed after phase 5 (editable thoughts, supersedes the read-only thought page):

- A quick thought is an ordinary, fully editable note. The pipeline writes the organised
  title and body (summary, pointers, checklist as a real task list, link and web
  findings) **into the note's own content**, and keeps the captured words in
  `notes.originals`.
- Quick thoughts and ordinary notes use the same editor. A quick thought additionally
  shows two floating boxes on the right (`components/notes/thought-panels.tsx`):
  "Original thought" and "Actions taken". Below 1280px wide they sit behind a toggle
  above the note.
- **Editing the note's text** is left alone: the server only refreshes its search embedding.
- **Editing an original** (pencil in the box) reprocesses the thought and rewrites the
  note from the originals, replacing manual edits to the body. The open editor updates
  in place when the new version arrives.
- The queue trigger fires on a change to text, title or originals; the function tells
  the cases apart by a hash of the originals (`enriched_hash`).
- Ordinary notes are never rewritten; they get tags, an embedding and links only.
- A merge also rewrites the surviving thought from all its originals, so manual edits
  to that thought's body are replaced when a new capture is merged into it.
- The capture's own formatting (checkboxes, lists) is not preserved once the thought is
  written up; originals are kept as plain text. Images and recordings are carried over.
- After a save the app asks for fresh data nine times over 90 s, so results appear
  shortly after the server finishes.
- Removed: the read-only thought page, `context.checked`, and organised-title overrides
  in lists (the note's first line is the title again).

Changed after phase 5 (product lookups and note layout):

- A thought that names things to buy (a recommendation, a shopping note, or one that
  mentions brands or products) always gets a **product lookup**; the rule is in code,
  not left to the model. The worker asks OpenAI's web search for one product per brand
  or item as structured data, then opens each product page to confirm it exists and to
  take its picture and price. A page that does not load is replaced by a web-search link.
  The lookup is tried twice before falling back to a plain-facts lookup.
- Products are shown in the note as a horizontal **slider of cards** (picture, brand,
  name, store, price), a single block in the editor (`lib/thought-nodes.tsx`).
- **Sources** are no longer written into the text. They are a separate block, folded
  behind "Show sources".
- Sections of a written-up note are separated by blank lines.
- The side boxes use a hairline instead of a wide shadow, which was being clipped into
  a grey slab; their background now matches the editor.
- Measured in one trial: a four-brand product lookup used about 30,000 input tokens
  and six searches. Per-search fees are not known.

Changed after phase 5 (empty start):

- A new account starts with no sample notes and no folders of its own. Quick Thoughts
  remains as the one fixed place (captures have to land somewhere, and the pipeline
  identifies thoughts by it); it behaves like All Notes and cannot be deleted.
- The built-in "Notes" folder is gone. A note written under All Notes belongs to no
  folder (`folder_id` null) and appears under All Notes only.
- (Superseded, see the incident note below.) A device's leftover notes are no longer
  cleared while signed out; they are cleared at sign-in if they belong to another account.
- On 14 Nov 2026 the project's data was wiped at the owner's request: all accounts,
  notes, folders, links and queued jobs. Schema, functions, secrets and the schedule
  were kept.

Changed after phase 5 (merge reliability and smart search):

- **Similarity judge.** Measured on the same pairs eight times each. The small model,
  shown the earlier thought's written-up text, scored an obvious "add to my list"
  pair 85 to 95, straddling the merge line. Now: the judge is `gpt-5-mini`
  (`OPENAI_JUDGE_MODEL`), it compares the words each thought was captured in rather
  than the written-up text, and its instructions say that being the same kind of note
  (two links to read later, two errands) is not a reason to merge.
  Result: merge and unrelated cases were right 8/8; "related" was right 7/8 and 5/8.
- **Links have a second signal.** A strong embedding match (cosine 0.50+) links two
  notes even when the judge scores them below 60. It can never cause a merge.
- **Search is understand, gather, judge** (`supabase/functions/search/index.ts`):
  - Understand runs only when the query mentions time or a kind of note; it returns
    topic, dates, type and related words.
  - Gather is generous: the 18 nearest notes by embedding (cosine 0.12+) or any keyword.
  - Judge: `gpt-5-mini` reads the shortlist and scores each note 0-100 for the query;
    65+ is returned, best first. This is what lets "life", "future" or "prophecy" find
    a note that lists "wedding at 28, house at 32" without using any of those words.
  - Measured: about 1.6-2.0 s for a plain query, 3-4.5 s when dates are involved,
    1.4 s for dates only. Before the judge step existed it was about 0.6 s.
- Search results are now ordered by the judge's score, not by fused rank.

Open as of 14 Nov 2026 (evening):

- **The OpenAI account ran out of credits** during repeated test runs. Until it is
  topped up, thoughts are not organised and search falls back to plain text.
- The pipeline now treats account errors (no credits, quota, rate limit) as "wait",
  not "fail": the job stays queued and is retried every five minutes for as long as
  it takes. Other errors still give up after five tries. Deployed, not yet exercised.
- The embedding backstop for links and the false-merge guard have since passed the
  full pipeline test (run once, on `gpt-6-luna`).
- Tests that trigger web lookups are expensive (about 30,000 input tokens each); the
  pipeline test should get a mode that skips them.

Model change (14 Nov 2026, at the owner's request):

- Both LLM roles now use `gpt-6-luna`: writing up and lookups (`OPENAI_ENRICH_MODEL`,
  was `gpt-5-nano`) and judging similarity and search relevance (`OPENAI_JUDGE_MODEL`,
  was `gpt-5-mini`). Embeddings stay on `text-embedding-3-small`.
- GPT-6 models reject the "minimal" reasoning setting; the functions now pick the
  lightest setting per model family ("minimal" on GPT-5, "none" on GPT-6).
- Measured on the ten judge scenarios, six tries each: all correct, including the
  "related" cases the previous judge got wrong. The search test and the full pipeline
  test (merge, link, false-merge guard, product lookup, page fetch) pass on it.
- Its price has not been checked.

Claude as the writer (14 Nov 2026, at the owner's request):

- **Who does what now**
  - Writing a thought up, summarising a linked page, web lookups (facts and products):
    `claude-opus-5-5` first (`ANTHROPIC_WRITER_MODEL`), falling back to `gpt-6-luna`.
  - Merge / link judging and search relevance: `gpt-6-luna` (unchanged).
  - Embeddings: `text-embedding-3-small` (unchanged).
- **Fallback.** If a Claude call fails for any reason (no credits, bad key, rate limit,
  a declined request, a malformed answer) that step is done by OpenAI instead, and the
  reason is stored on the thought (`enrichment.fallback`). "Out of credits" is
  remembered for ten minutes so later notes skip Claude without trying.
- **Reprocess button.** Each quick thought's Actions box has "Reprocess with Claude
  Fable 5.2". It writes `notes.enrich_request`; the pipeline reruns the whole flow
  (similarity and links, write-up, actions) with `claude-fable-5-2` first, then clears
  the request. Only models on an allow-list in the function are honoured. Like editing
  the original, it rewrites the note and replaces manual edits; the button asks first.
- The Actions box shows which model wrote the thought.
- Claude code lives in `supabase/functions/enrich/claude.ts` and uses the official
  Anthropic SDK: structured output for the write-up, the `web_search_20260209` server
  tool for lookups, adaptive thinking at low effort (medium for Fable).
- Verified on the live project: write-up by Opus, rerun by Fable, page summary and
  product lookup by Opus, and the fallback (by giving the function an invalid
  Anthropic key, then restoring it). The out-of-credits path itself was not exercised.
- Claude's server-side refusal fallback is not enabled; a declined request falls back
  to OpenAI through the same mechanism as any other failure.

Incident, 14 Nov 2026: a device lost its local copy of the notes

- **What happened.** The owner's browser showed no notes. The cloud copy was intact.
- **Cause.** The "clear a device's notes when nobody is signed in" safeguard ran during
  start-up while an expired login was being refreshed, when the app briefly has no
  session. It cleared the local store; the sync cursor still said "up to date", so
  nothing was fetched again.
- **Fix.**
  - That safeguard is removed. The decision is made at sign-in instead: if the device
    last synced a different account, its local copy is cleared before syncing, so one
    account's notes are still never uploaded into another.
  - Self-repair: on start-up, if the device has nothing waiting to upload and holds a
    different number of notes than the account, it fetches everything again.
- **Verified.** The emptied state was reproduced and the notes came back on opening
  the app; an expired login no longer clears anything; a second account on the same
  browser gets none of the first account's notes.

Original thoughts keep their formatting (15 Nov 2026, at the owner's request):

- Each original now stores `html` (the capture as formatted: lists, checkboxes, bold)
  beside its plain `text`. Set by the pipeline on first processing and by
  `merge_notes`; pictures and recordings are left out.
- Viewing: every original has its own box ("1 of 2", "2 of 2"), rendered read-only
  with the note editor's formatting.
- Editing: one editor holding all of them, separated by divider lines; saving splits
  at the dividers back into separate originals. A change to the words reprocesses the
  thought; a formatting-only change is just saved.
- Originals captured before this have no `html` and show as plain lines.
- Sync fix found on the way: notes with and without `originals` are uploaded in
  separate batches (a mixed batch was rejected by the server).

Spacing, text size and drawing (15 Nov 2026, at the owner's request):

- Checklist rows are 22px apart at the default size (measured from Apple Notes
  screenshots); body lines stay 17px. Circle-to-text gap is 6px.
- Text size belongs to the text (`lib/font-size.ts`, a `fontSize` mark saved as
  `<span style="font-size: Npx">`). Cmd/Ctrl with + (also = or ;) and - step the
  selected text; with nothing selected they set the size of what is typed next. The
  Format menu has a size row (−, a field for any size, +) and preset sizes plus
  Default. Line heights are ratios so a line with bigger text grows. (The first
  version zoomed the whole note; the owner rejected that and it was removed.)
- Drawing: a Draw button in the note toolbar adds a drawing block below the cursor
  (`lib/drawing-node.tsx`), with a palette (pen, marker, eraser, colours, undo, Done).
  Stored as strokes in the note's content (`div[data-type="drawing"]`), rendered as
  SVG. The pipeline keeps drawings when it rewrites a thought.
- Turbopack can keep serving an old stylesheet after a restart; clearing
  `.next/dev/cache` before starting fixes it.

Phone screens, location step, wording (15 Nov 2026, at the owner's request):

- The reprocess button reads "Reprocess with extra thinking effort" (it still runs
  `claude-fable-5-2`).
- Location is on by default. Once per device after signing in, a step explains why it
  is collected and offers "Turn On Location" (the browser's own prompt follows) or
  "Not Now" (`locationAsked` in the store; `components/account/location-step.tsx`).
- Phones: folder list and note list follow Notes on iPhone (large title that shrinks
  into the top bar, rounded cards, notes grouped by date) with a floating bar at the
  bottom: search, new note / new folder, and a lightbulb that goes straight to the
  capture screen. An open note has the same lightbulb bottom right.
  Shared pieces live in `components/notes/mobile-dock.tsx`.
- Phone folder list: New Folder and Edit at the top right. In Edit mode each folder
  has an options button (Rename, New Folder Inside, Delete Folder; no delete for Quick
  Thoughts), built-in rows are dimmed, and rows don't open. Reordering by dragging is
  not built.

Installable app (PWA), 15 Nov 2026:

- `app/manifest.ts` (name, standalone display, icons), `app/icon.png`,
  `app/apple-icon.png`, `public/icons/*` (rendered from `public/icons/icon.svg`: a
  notepad with a lit bulb, drawn for this app).
- `public/sw.js` keeps the page and its build files for offline launches; registered by
  `components/pwa.tsx` in production builds only (in development it would serve stale
  files). Headers for `/sw.js` are set in `next.config.ts`.
- Checked against `next build` + `next start`: Chrome reports no installability
  errors, and the app opens with the network off.
- Still needed before it can be installed on a phone: hosting over HTTPS (phase 6),
  and the hosted address added to Supabase's allowed sign-in redirect URLs.

Changed during review:

- Vector column is `halfvec(1536)`, not 512 dimensions as first suggested.
- Added the shared-secret check on `enrich`; the guide leaves that call unauthenticated.
- Added `purged_at` so permanent deletes reach other devices.
- Added the skip-if-unchanged hash so edits do not re-run the LLM needlessly.
- Search works on all notes, not only Quick Thoughts.
- Built-in folders and sample notes have non-UUID ids today; added `folders.kind` and a
  re-keying step to the first upload.

Not verified:

- OpenAI's own pricing page (blocked); current small-model names and prices.
- pgvector performance at millions of rows; HNSW index size.
- The link threshold (0.45) is calibrated on nine sample notes, not on real usage.
- Reverse-geocoding providers and their terms.

## 19. Sources

- Supabase automatic embeddings: https://supabase.com/docs/guides/ai/automatic-embeddings
- Supabase hybrid search: https://supabase.com/docs/guides/ai/hybrid-search
- Supabase pricing: https://supabase.com/pricing
- OpenAI pricing (official, not retrieved): https://openai.com/api/pricing/
- OpenAI embeddings pricing tracker: https://www.activepieces.com/blog/openai-embeddings-api-pricing-in-2026-dated-and-checked.md
- OpenAI model pricing guide: https://www.aipricing.guru/blog/openai-api-pricing-guide-2026/
- WebKit bug 194593 (Web Share Target): https://bugs.webkit.org/show_bug.cgi?id=194593
- Next.js PWA guide: `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`
