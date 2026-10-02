// =============================================================================
// CHANNEL CATEGORIES - the one list, in one file
// =============================================================================
//
// Extracted from `components/channels/channel-wizard-fields.tsx`, where it was a
// private constant.
//
// Why extract rather than copy: the list is a CLOSED SET, enforced in three
// places, and the three are meant to be the same list.
//
//   - `model.ValidChannelType` (Go)          - what the API accepts
//   - migration 018's CHECK constraint (SQL)  - what the database accepts
//   - this file                                - what a creator can pick
//
// A second copy of a closed set is not a convenience, it is a fourth answer. The
// step-2 screen needed the list to let a creator CONFIRM the category they chose
// in step 1, and the alternative was to paste it again - so the divergence would
// have been built deliberately, for a good reason, in a hurry.
//
// `tools/check-channel-lists.mjs` asserts all of them agree. A test that
// compares the two you can see is the only one that catches the third you cannot.

/** One selectable category. */
export type ChannelType = {
  /** The value sent to the API. Must be in `model.ValidChannelType`. */
  value: string;
  /** What the creator reads. */
  label: string;
  /**
   * Why this exists, in one line.
   *
   * Not decoration: `channel_type` selects upload defaults and which features
   * surface, so a creator choosing wrongly gets a channel that behaves wrong and
   * cannot tell why.
   */
  hint: string;
};

/** Grouped for display; the grouping is presentational only. */
export const CATEGORY_GROUPS: { group: string; items: ChannelType[] }[] = [
  {
    group: 'Popular',
    items: [
      { value: 'gaming', label: 'Gaming', hint: 'Gameplay, streams, reviews' },
      { value: 'music', label: 'Music', hint: 'Originals, covers, performances' },
      { value: 'education', label: 'Education', hint: 'Tutorials, courses, explainers' },
      { value: 'people', label: 'People & Blogs', hint: 'Vlogs, interviews, personal' },
    ],
  },
  {
    group: 'How-to',
    items: [
      { value: 'howto', label: 'How-to & Style', hint: 'Cooking, DIY, fashion, repair' },
      { value: 'film', label: 'Film & Animation', hint: 'Shorts, series, behind the scenes' },
      { value: 'news', label: 'News & Politics', hint: 'Reporting, commentary' },
    ],
  },
  {
    group: 'More',
    items: [
      { value: 'podcast', label: 'Podcast', hint: 'Interviews, talk shows, audio first' },
      { value: 'sports', label: 'Sports', hint: 'Matches, training, analysis' },
      { value: 'comedy', label: 'Comedy', hint: 'Sketches, stand-up, parody' },
      { value: 'autos', label: 'Autos & Vehicles', hint: 'Reviews, restoration, racing' },
      // "Other" was MISSING here while `model.ValidChannelType` and migration
      // 018's CHECK constraint both accepted it - so a creator whose channel did
      // not fit any of the eleven above had literally no way to describe it, and
      // had to pick the least-wrong category instead. That is a wrong answer
      // applied to somebody's work in order to satisfy a form.
      //
      // Found by `tools/check-channel-lists.mjs`, which exists because this list
      // was the FOURTH copy of a closed set and the copies had already drifted.
      //
      // Placed under "More" rather than first, so it stays the answer somebody
      // reaches for deliberately rather than the answer they settle on by
      // exhaustion.
      { value: 'other', label: 'Other', hint: 'None of these quite fit' },
    ],
  },
];

/** Every category, flattened. What the validation and the checker iterate. */
export const CHANNEL_TYPES: ChannelType[] = CATEGORY_GROUPS.flatMap((g) => g.items);

/** The values alone, for comparing against the Go map. */
export const CHANNEL_TYPE_VALUES: string[] = CHANNEL_TYPES.map((t) => t.value);

/**
 * Find the display label for a stored value, or undefined.
 *
 * Used by step 2 to show the category a creator already chose. Returning undefined
 * for an unknown value rather than echoing it back is deliberate: an unrecognised
 * stored value means the database and this list have diverged, and rendering the
 * raw string would hide that instead of surfacing it.
 */
export function channelTypeLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return CHANNEL_TYPES.find((t) => t.value === value)?.label;
}
