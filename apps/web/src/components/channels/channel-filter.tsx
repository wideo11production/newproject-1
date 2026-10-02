'use client';

// The category filter for the public browse page.
//
// A separate Client Component, and not `'use client'` on the page itself, so the
// heading and the copy around it keep rendering on the server. `tsc --noEmit`
// does NOT catch using a hook in a server component - only `next build` does -
// so the first version of this failed at build time with an error that points at
// the import line rather than at the missing directive.
//
// =============================================================================
// WHY THIS IS A ROW OF WORDS AND NOT A ROW OF PILLS
// =============================================================================
//
// Thirteen rounded chips, each with its own border, is the loudest element on a
// gallery page - and the least important one. Filters are navigation, not
// content, and navigation should be quieter than the thing it navigates.
//
// So: plain text, one weight and one colour change to say which is active, and a
// hairline underneath. Thirteen words read as a sentence you can scan. Thirteen
// bordered pills read as thirteen competing objects, which is the exact problem
// the card grid was just rebuilt to fix.
//
// The active state is a colour AND an underline, not colour alone. Colour alone
// fails for a colourblind reader, and it fails silently - they cannot select a
// category, and nothing looks broken.
//
// =============================================================================
// WHY THE LIST IS DERIVED AND NOT WRITTEN OUT
// =============================================================================
//
// This used to be a local `FILTERS` array with its own short labels - "How-to"
// where the picker says "How-to & Style", "People" for "People & Blogs".
//
// A sixth copy of a closed set, with its own opinion about the wording. It could
// offer a category the database refuses, and it called two of them something
// different from every other screen. Deriving it from `CATEGORY_GROUPS` means the
// filter cannot offer a category nobody else offers, and `tools/check-channel-lists.mjs`
// checks the source it now comes from.
//
// The labels are the FULL ones rather than the abbreviated ones this used. On a
// gallery page there is room, and "How-to" next to "How-to & Style" elsewhere in
// the product is the kind of small inconsistency that reads as unpolished.

import { CHANNEL_TYPES } from '@/lib/channel-types';

/** "All" first, then every category in the picker's own order. */
const FILTERS = [{ value: '', label: 'All' }, ...CHANNEL_TYPES.map((t) => ({ value: t.value, label: t.label }))];

export default function ChannelFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <nav aria-label="Channel categories" className="border-b border-white/[0.07] pb-4">
      {/*
        `overflow-x-auto` with a hidden scrollbar rather than `flex-wrap`.

        Wrapping makes the row two or three lines deep on a phone, which pushes the
        grid below the fold and turns a filter into a wall. Scrolling keeps it one
        line, which is what a row of navigation should be.

        The filter is a `<nav>` and not a `role="group"` with a visible label: it
        navigates the results, it does not operate a control, and "Filter by
        category" as visible text was a heading for something that reads fine
        without one. An `aria-label` does the job without taking up the line.
      */}
      <ul className="-mx-1 flex items-center gap-x-5 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map((f) => {
          const selected = value === f.value;
          return (
            <li key={f.value || 'all'} className="shrink-0">
              <button
                type="button"
                data-track={`filter-${f.value || 'all'}`}
                onClick={() => onChange(f.value)}
                aria-current={selected ? 'true' : undefined}
                className={`relative whitespace-nowrap pb-1 text-[13px] transition-colors duration-200 ${
                  selected
                    ? 'text-white/90'
                    : 'text-white/35 hover:text-white/70'
                }`}
              >
                {f.label}
                {/*
                  The active marker is an underline on a pseudo-element rather than
                  a background or a border on the button.

                  A border on the button would change its box and shift the row as
                  you click - the layout moves under the pointer, which is the one
                  thing a filter must never do. An absolutely-positioned rule inside
                  a `relative` button occupies no layout space at all.
                */}
                {selected ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-1 h-px bg-white/70"
                  />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
