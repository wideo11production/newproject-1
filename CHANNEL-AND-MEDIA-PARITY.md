# Channel creation and media parity — what YouTube asks, and what we do not have

> Written 2026-10-01 so this stops being a vague goal and becomes a checklist.
> **Nothing here is implemented yet** — this is the specification.
>
> Related: `SYSTEM-PLAN.md` (build order), `updatedtodo.md` Session 16 (services,
> sessions, plans), Session 17 (one login, RBAC).

---

## 0. A plain statement about "all of YouTube's features"

I will not claim parity, because it is not a thing that can be honestly promised.
YouTube is a decade of work by hundreds of engineers, and "we have everything
YouTube has" is the kind of statement that ends with a demo that breaks.

What this document does instead:

1. **Channel creation** — enumerated exactly, because the set is finite and I can
   finish it. This becomes one focused piece of work.
2. **Media features** — an inventory with an honest status per row, so the gap is
   visible instead of assumed. Marked as the long tail, built over phases.

Every row says **what it is, why a creator needs it, and where it lands.** A row
marked `NOT BUILT` is a promise, not a plan.

---

## 1. Channel creation — what YouTube asks, and we do not

Today `CreateChannelRequest` takes four things: `handle`, `display_name`,
`description`, `is_public`. That is a name, not a channel. YouTube asks roughly
ten times that, and each question changes how the channel behaves or is found.

### 1.1 Required, without which a channel cannot be created

| # | Question | Field | Why it matters | Status |
|---|---|---|---|---|
| 1 | Channel name | `display_name` | What people see | **BUILT** |
| 2 | Handle (the `@name`) | `handle` | The public URL. Permanent once claimed | **BUILT** |
| 3 | What kind of channel is it? | `channel_type` | `gaming` / `music` / `podcast` / `education` / `howto` / `sports` / `news` / `film` / `people` / `comedy` / `autos` | **NOT BUILT** |
| 4 | Description | `description` | Search and "about" | **BUILT** (optional — should be required-ish) |
| 5 | Audience / content rating | `mature_content` | `yes` / `no` / `audience` | **NOT BUILT** |
| 6 | Made for kids? | `made_for_kids` | Legally distinct from "mature" — this is the one YouTube's own form gates hardest, and getting it wrong is a compliance problem, not a preference | **NOT BUILT** |
| 7 | Contact email | `contact_email` | A private contact, never shown publicly | **NOT BUILT** |

`channel_type` is the one people underestimate. It is not a label: it changes
upload defaults, which features surface, and how the channel is categorised. It
belongs in the create form, not in settings discovered later.

### 1.2 Strongly recommended at creation

| # | Question | Field | Why | Status |
|---|---|---|---|---|
| 8 | Channel country / primary language | `country`, `primary_language` | YouTube gates a channel to a country, and it decides which programmes and rules apply | **NOT BUILT** |
| 9 | Channel keywords | `keywords` | Discovery. Distinct from the description | **NOT BUILT** |
| 10 | Branding: profile picture and banner | `image_url`, `cover_url` | Columns exist; the form does not ask, and there is no upload step in the create flow | **HALF** |
| 11 | Channel URL confirmation | — | Show the final `@handle` and confirm it cannot be changed, before the row is written | **NOT BUILT** |

### 1.3 Design decisions that need settling before any of this is built

| Question | Decision | Reason |
|---|---|---|
| One step or several? | **Several, with progress.** Name/handle first, then type and audience, then branding. | Asking 10 questions in one form is how people click through without reading, and the two that matter most (`channel_type`, `made_for_kids`) are the ones at the bottom. |
| Is the handle ever released? | **Never.** Already implemented (`retired_handles`, migration 014). | A reissued handle inherits a dead URL's trust. |
| Can `channel_type` change later? | Yes, with a warning. | Creators get it wrong. But `made_for_kids` and `mature_content` are **audited on change** — they have legal consequences. |
| Are the answers private or public? | Split. `contact_email` private forever. `country` and `primary_language` public — they decide which programmes apply and must be honest. | Publishing an address on the channel is how a creator gets doxxed by a scraper. |
| What if the user abandons half way? | Draft, not a channel. A channel row exists only when the required set is complete. | A half-answered channel with no `channel_type` has no upload defaults and cannot be categorised. |
| Do we ask `mature_content` AND `made_for_kids`? | **Yes, both, separately.** | They are different questions. Collapsing them is how a kids channel ends up flagged adult, or the reverse. |

### 1.4 What this changes in code

| Change | Where |
|---|---|
| New columns on `channels` | migration `018` — `channel_type`, `mature_content`, `made_for_kids`, `contact_email`, `country`, `primary_language`, `keywords` |
| `CreateChannelRequest` grows | `internal/model/creator.go` — with `channel_type` **required**, the rest validated |
| Create flow becomes multi-step | new component in `apps/web`, calling the same `POST /api/v1/auth/channels` once at the end |
| Handle confirmation before submit | UI, and the "cannot be changed" warning text |

### 1.5 Deliberately NOT copying from YouTube

| YouTube has | We skip | Why |
|---|---|---|
| Channel name suggestions and handle availability checker | — | Pure convenience; ours already shows availability. |
| "Advanced" recovery contacts and verification phone | — | Impersonation defence at a scale we do not have. |
| Per-channel content-review settings | — | Comes with the ads/brand-check phase, not channel creation. |
| Analytics setup wizard | — | Analytics arrives with channels having some data worth looking at. |

---

## 2. Media features — YouTube parity inventory

Status is honest and means something:

- **BUILT** — works, and is covered by a test.
- **PARTIAL** — the path exists but misses something listed.
- **NOT BUILT** — does not exist. A promise, not a plan.

### 2.1 Uploading

| Feature | YouTube behaviour | Ours | Status |
|---|---|---|---|
| Drag and drop upload | Yes | Editor file input | **PARTIAL** — no drag target |
| Resumable / chunked upload | Yes, survives a dropped connection | Presigned PUT straight to MinIO; a dropped connection loses the upload | **PARTIAL** — fine for small files, weak at 8 GB |
| Upload progress and ETA | Yes | Not shown | **NOT BUILT** |
| Pause and resume | Yes | No | **NOT BUILT** |
| Queue multiple files | Yes | One at a time | **NOT BUILT** |
| Retry a failed file | Yes, keeps the rest | Whole batch is one request | **NOT BUILT** |
| Concurrent upload limit | Per account | Per plan, 0–4 transcode slots | **BUILT** |

### 2.2 Processing and quality

| Feature | Ours | Status |
|---|---|---|
| Multi-rendition ladder (1080/720/480) | HLS 480/720/1080 from `transcoding-service` | **BUILT** |
| Poster frame | Generated during transcode | **BUILT** |
| Filmstrip preview | Compositor, per spec | **BUILT** |
| Audio waveform peaks | Generated in transcode | **BUILT** |
| Quality selector on playback | No | **NOT BUILT** |
| HDR / 4K / high-bitrate | 4K export yes, HDR no | **PARTIAL** |
| Auto-enhance / colour correction | No | **NOT BUILT** |
| Loudness normalisation (EBU R128) | No | **NOT BUILT** — a real one: inconsistent audio loudness between videos is the most common creator complaint |
| Subtitles / captions (auto + manual) | No | **NOT BUILT** — required for reach, and a legal requirement in many markets |
| Thumbnail generation + A/B testing | No | **NOT BUILT** |

### 2.3 Publishing

| Feature | Ours | Status |
|---|---|---|
| Draft | `status = initiated` onwards | **BUILT** |
| Scheduled publish | No | **NOT BUILT** |
| Unlisted / private | `is_public` boolean only | **PARTIAL** — unlisted is not expressible |
| Age restriction | No | **NOT BUILT** — blocked on `mature_content` above |
| Monetisation eligibility | No | **NOT BUILT** — Phase 7 |
| End screens, cards, playlists | No | **NOT BUILT** |

### 2.4 Reels / Shorts

| Feature | Ours | Status |
|---|---|---|
| 90s cap, 9:16 enforced | Readiness grid, four platforms | **BUILT** (Phase 4) |
| Per-platform readiness with reasons | Yes | **BUILT** |
| Safe-area guidance | Yes | **BUILT** |
| Automated cross-post | Not built, and honestly not buildable without per-creator OAuth | **NOT BUILT — see the note** |
| Shorts shelf eligibility | Warned at >60s | **BUILT** |
| Pinned comment, like-count display | No | **NOT BUILT** |

### 2.5 The order this gets built in

Grouped by dependency, not by appeal:

| Step | Feature set | Needs first |
|---|---|---|
| A | Upload queue, progress, pause/resume, per-file retry | Direct PUT becomes multipart, or the queue holds pre-signed parts |
| B | Unlisted visibility, age restriction, scheduling | `mature_content` from §1 |
| C | Subtitles, loudness normalisation, quality selector | — |
| D | Monetisation, end screens, playlists | Phase 7 ads manager |
| E | Auto-enhance, thumbnails, A/B | — |

**B and C are the ones with consequences, not just polish.** Age restriction and
subtitles have legal exposure; loudness is what creators complain about most.

---

## 3. Why this file exists

Every one of the last few sessions reopened a question that had already been
answered, and two of them produced bugs rather than answers — a stale gap table
that sent work at finished things, and a `NEXT_PUBLIC_*` var that had been dead
in every app for weeks while the correct fallbacks hid it.

So the rule going forward:

> **A decision is written here, in a file that says NOT BUILT or BUILT. It is not
> re-litigated in a later session, and it is not treated as done because someone
> half-built it.**

If something here turns out to be wrong, the row changes — deliberately, with the
reason next to it — rather than being quietly discovered again in three weeks.

---

## 4. Still open, needing a decision from you

| Question | Why it cannot be decided here |
|---|---|
| Do we show the full YouTube channel wizard, or the 4 required questions and defer the rest? | A 10-step wizard is a very different product from a 2-step one, and it changes how many creators finish. |
| Age restriction and `made_for_kids` — do we ship both, or only the one the product can actually enforce? | Enforcing "made for kids" properly means building the restricted-features model, not just a checkbox. |
| Unlisted: a real third visibility state, or a share-link flag? | It changes the `channels` schema and every query that filters on it. |
| Subtitles: generated first, or uploaded first? | Generated subtitles need a transcription service; uploaded need a caption editor. Different builds. |
