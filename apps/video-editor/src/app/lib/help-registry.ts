// ============================================================================
// HELP REGISTRY
// ============================================================================
//
// ONE table, read by three surfaces: the per-icon hover popover, the modal, and
// the full help page. A help system with three sources drifts within a week, and
// the symptom is a popover that explains something the page contradicts.
//
// Each entry answers FOUR questions, because a tooltip that only answers the
// first is not worth the hover it costs:
//
//   what    what it does, in one line
//   use     WHERE in a project you would reach for it
//   good    what it is genuinely better at
//   cost    what it is worse at, honestly
//
// The last one is the one that is almost always missing, and it is the one that
// actually helps: a feature described only in benefits is indistinguishable
// from a feature that has no downsides.

export interface HelpEntry {
  id: string;
  title: string;
  category: 'Timeline' | 'Editing' | 'Playback' | 'Project';
  what: string;
  use: string;
  good: string;
  cost: string;
  /** Keyboard shortcut, if there is one. */
  keys?: string;
}

export const HELP: HelpEntry[] = [
  {
    id: 'blade',
    title: 'Blade',
    category: 'Editing',
    keys: 'S',
    what: 'Cuts the clip under the playhead into two, leaving every other clip exactly where it is.',
    use: 'Splitting a take at a natural break — between sentences, on a beat, at a door closing.',
    good: 'Non-destructive: both halves stay editable and Ctrl+Z rejoins them as one clip.',
    cost: 'Refuses a cut that would leave fewer than one frame on a side, because a one-frame clip cannot be grabbed again.',
  },
  {
    id: 'snap',
    title: 'Snapping',
    category: 'Timeline',
    keys: 'N',
    what: 'Pulls a dragged clip onto the playhead, another clip’s edge, a marker, or the ends of the timeline.',
    use: 'Every precise join. It is the difference between "looks aligned" and "is aligned".',
    good: 'Works across lanes, so a video and its audio land on the same frame without arithmetic.',
    cost: 'Fights you on a 30-pixel clip where every target is inside the snap radius. Turn it off and nudge with the arrow keys.',
  },
  {
    id: 'trim',
    title: 'Trim',
    category: 'Timeline',
    what: 'Drag a clip’s edge to change where it starts or ends. The source moves with it, so the picture is not stretched.',
    use: 'Cutting dead air off the head or tail of a clip.',
    good: 'Moves the source in-point with the edge, so trimming shows different frames rather than the same frames for longer.',
    cost: 'Leaves a gap. That is what Ripple is for — and using trim when you meant ripple is the most common mistake in a first edit.',
  },
  {
    id: 'ripple',
    title: 'Ripple trim',
    category: 'Editing',
    what: 'Trims an edge and slides everything after it by the same amount, so no gap is left.',
    use: 'Tightening a talking head without ever re-timing the clips that follow.',
    good: 'Keeps a cutlist gap-free automatically. The single biggest time saver in a spoken-word edit.',
    cost: 'Everything downstream MOVES. If a clip was lined up to something external, that lining is now wrong.',
  },
  {
    id: 'roll',
    title: 'Roll',
    category: 'Timeline',
    what: 'Moves the cut between two touching clips. The left clip grows, the right shrinks.',
    use: 'Syncing to music, or landing on the exact frame you want without changing the total length.',
    good: 'Total duration never changes, so nothing downstream has to move.',
    cost: 'Only works on two clips that are already welded together. Across a gap it is really a trim plus a slide.',
  },
  {
    id: 'slip',
    title: 'Slip',
    category: 'Timeline',
    what: 'Slides the SOURCE inside the clip. The clip does not move and its length does not change.',
    use: 'Starting a clip on the right word, or on the first beat instead of the second.',
    good: 'The only edge edit that leaves everything around it completely untouched.',
    cost: 'Useless without audio to hear. On silent footage you are moving a picture nobody can tell has moved.',
  },
  {
    id: 'slide',
    title: 'Slide',
    category: 'Timeline',
    what: 'Moves a clip between its neighbours, which grow and shrink to fill the space.',
    use: 'Nudging a middle clip a few frames without disturbing the rest of the timeline.',
    good: 'Only the three clips involved move. The rest of the edit is untouched.',
    cost: 'Needs a neighbour on at least one side. A lone clip on an empty lane has nothing to slide between.',
  },
  {
    id: 'attach',
    title: 'Attach / Detach',
    category: 'Timeline',
    what: 'Attaching ties a video clip to its audio so they move, cut and fade together. Detaching splits them apart.',
    use: 'Attach while they are in sync. Detach the moment one side drifts and you need to move them independently.',
    good: 'Attached, a ripple trim on the video trims the audio in the same frame, so sync cannot drift.',
    cost: 'While attached you cannot move one without the other — which is the point, and also the frustration, when they have drifted.',
  },
  {
    id: 'transition',
    title: 'Transitions',
    category: 'Timeline',
    what: 'Blends two touching clips over a chosen length. The outgoing clip is held past its own end rather than trimmed.',
    use: 'Softening a hard cut at a scene change, or covering a cut you could not find a better solution for.',
    good: 'Removing or re-timing one never moves a frame of the edit underneath it.',
    cost: 'A long crossfade delays the second clip’s own content, which is audible as a lip-sync slip on dialogue.',
  },
  {
    id: 'marker',
    title: 'Markers',
    category: 'Timeline',
    what: 'A labelled point on the timeline. Drop one with M, step between them with , and .',
    use: 'Marking where something is wrong, so you can come back to it after fixing three other things.',
    good: 'Snapping targets as well as notes, so a clip lands on a marker instead of near one.',
    cost: 'Markers are not saved with the project yet — a refresh loses them, which is the one thing a note is for.',
  },
  {
    id: 'filmstrip',
    title: 'Timeline frames',
    category: 'Timeline',
    what: 'Real frames from the clip’s own footage, sampled across its length — and the cuts INSIDE the clip are marked on it.',
    use: 'Finding the cut without scrubbing. You can see where the shot changes and click straight at it.',
    good: 'Marks internal cuts, so a 40-second take with three cuts inside it shows you all three without playing it.',
    cost: 'Decoding costs a moment the first time each clip appears, and a very long clip cannot show every frame.',
  },
  {
    id: 'playhead',
    title: 'Playhead',
    category: 'Playback',
    what: 'The red line. Left and Right step exactly one frame; the timecode is HH:MM:SS:FF.',
    use: 'Every decision about where something starts.',
    good: 'Frame-exact. The frame number is shown next to the timecode, so there is never a conversion to do in your head.',
    cost: 'None worth naming. It is the one piece of the UI that has no opinion.',
  },
  {
    id: 'shuttle',
    title: 'J / K / L',
    category: 'Playback',
    keys: 'J K L',
    what: 'Reverse, stop, forward. Holding J or L speeds up.',
    use: 'Finding the moment you want by ear, which is usually faster than watching.',
    good: 'Ramping rate means you can scan a two-minute clip without scrubbing it frame by frame.',
    cost: 'Audio goes granular above about 4x. Fine for finding, useless for judging the sound.',
  },
  {
    id: 'export',
    title: 'Export',
    category: 'Project',
    what: 'Renders the timeline through the same compositor the preview uses, and records it to a file.',
    use: 'Delivering a cut, not just previewing it.',
    good: 'One renderer, two consumers — so the file cannot differ from the preview.',
    cost: 'It is REAL-TIME, so a one-minute timeline takes a minute. And the container is whatever your browser’s encoder produces (WebM here).',
  },
];

/** Look an entry up by the `aria-label` a control carries. */
export function helpFor(id: string): HelpEntry | null {
  const needle = id.toLowerCase();
  return (
    HELP.find((h) => h.id === needle) ??
    HELP.find((h) => h.title.toLowerCase() === needle) ??
    HELP.find((h) => h.title.toLowerCase().startsWith(needle)) ??
    null
  );
}
