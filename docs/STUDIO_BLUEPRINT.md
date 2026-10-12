# Wideo11 Studio Design Blueprint

This is the single source of truth for the studio / discover / channel pages. Derived
from the schematic mockup, and written down **once** so it stops being re-taught.

> **Superseded in scope by [`MASTER_BLUEPRINT.md`](./MASTER_BLUEPRINT.md).** This file
> covers the studio *design system and layout patterns* only. For the project-wide
> audit, the palette/type/spacing token decision, the full route map, and the
> serialised execution plan, read MASTER_BLUEPRINT.md.
>
> **Important correction recorded there (§2.1):** this file's `#0d0f11` / `#16181d` /
> `#ff6500` values are currently HARDCODED across ten studio components and are NOT
> the tokens in `packages/ui/design-system.ts` (which say `#111217` / `#181b1f` /
> `#5794f2`). Two palettes are running at once. The resolution is Step 1 of
> MASTER_BLUEPRINT.md and must happen before further visual work.


---

## 1. The layout IS a split view. Always.

```
┌──────────────────────────────────────────────────────────────┐
│ TOP NAV  Wideo11 │ Home Uploads Resources Player │  🔍  avatar │
├────────┬─────────────────────────────────────────────────────┤
│ ICON   │  CHANNEL HEADER  (avatar w/ orange ring)             │
│ RAIL   │  Creator │ Channel │ Subscribers │ Joined            │
│ (no    ├───────────────────────────┬─────────────────────────┤
│ labels)│  MEDIA LIBRARY            │  VIDEO CONTENT AREA      │
│        │  [≡][⊞] Sort By ▾ [🔍]   │  ┌───────────────────┐   │
│ MEDIA  │  ┌────┐ ┌────┐ ┌────┐    │  │                   │   │
│ VIDEOS │  │card│ │card│ │card│    │  │     player        │   │
│ SHORT  │  └────┘ └────┘ └────┘    │  │  ▶ ────●────  🔊  │   │
│ REELS  │  ┌────┐ ┌────┐ ╔══════╗   │  └───────────────────┘   │
│ HORIZ  │  │card│ │card│ ║ACTIVE║   │  ┌────┬────┬────┬────┐   │
│ VERT   │  └────┘ └────┘ ╚══════╝   │  │Titl│Crea│Chan│Date│   │
│ AUDIO  │  ...                      │  └────┴────┴────┴────┘   │
│ LIVE   │                           │  Comments                │
│ PLAYLST│                           │  [Add a comment...]       │
└────────┴───────────────────────────┴─────────────────────────┘
```

**The active card is highlighted with a thin border/rectangle — not a heavy glow.**
The mockup shows `Wideo Project 3 - Promo v2.mp4` ringed while everything else is not.

**Never remove the split to "fix" a view.** The list/grid toggle lives *inside* the
left panel and must stay compact enough to fit beside the player. The player taking
most of the width is the intended proportion, not a bug.

---

## 2. The icon rail

Vertical, icons only, **no labels**:

| Slot | Destination |
|---|---|
| MEDIA | all media |
| VIDEOS | long-form |
| SHORT REELS | short reels |
| HORIZONTAL | landscape |
| VERTICAL | portrait |
| AUDIO FILES | audio |
| LIVE | live |
| PLAYLISTS | playlists |

Active slot = orange-red fill.

---

## 3. Aspect ratio per category

From the schematic diagrams. These are load-bearing, not decoration:

| Category | Ratio | Shape |
|---|---|---|
| Horizontal / wide video | ~1.25 : 1 | landscape |
| Vertical / tall reel | 16 : 19 | **portrait** (taller than wide) |
| Short reel | ~1.6 : 1 | compact |
| Long reel | ~4 : 1 | **very wide letterbox** (23.2 × 4.5 in the diagram) |
| Audio | 1 : 1 | square |

A long reel is *not* a normal video shape and a portrait reel is *not* a landscape
one. Deriving every card's aspect from `kind` alone is what made the grid wrong.

---

## 4. The four metadata boxes

Under the player, four **separate** rounded boxes, each with its own label:

`Title` · `Creator` · `Channel` · `Date`

Not a paragraph, not a row of text — four boxes, because each answers a different
question and is scannable alone.

---

## 5. Comments

Links are **strictly banned**, on both sides:

* client — `commentHasLink()` in `components/studio/Comments.tsx`, so the author is
  told *while typing*, before they press Post
* server — `ValidateCommentBody()` in
  `services/auth-service/internal/service/comment_links.go`, so it is not bypassable

Comments support likes and one level of replies. A viewer liking their own comment
still shows as unliked until the server confirms.

---

## 6. Design rules

* Palette: `#0d0f11` page, `#16181d` surface, `#ff6500` accent.
* **No line dividers.** Depth comes from background contrast and soft shadows only.
* Borderless containers, rounded 12–16px, generous spacing.
* Typography clean and modern; spacing generous.
* Changes to what is already built should be **minimal**. The result must look
  exceptional and cohesive — never awkward.
