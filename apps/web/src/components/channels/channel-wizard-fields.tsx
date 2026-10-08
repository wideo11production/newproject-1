'use client';

// The channel-type picker, and the two audience questions that travel with it.
//
// =============================================================================
// WHY THIS IS A PICKER AND NOT A TEXT FIELD
// =============================================================================
//
// `channel_type` is REQUIRED by the backend (migration 018) and it is not a
// label. It selects upload defaults and which features surface, so a channel
// filed under the wrong one gets defaults nobody asked for.
//
// That makes it exactly the wrong thing to type. A dropdown of twelve options
// takes two seconds; a free-text field gets "vibes", "gaming2" and "GAMING",
// and the creator has no idea the choice will follow them for months.
//
// The options are also GROUPED, because that is how people think about it -
// "I make cooking videos" is a search, not a memory test.
//
// =============================================================================
// THE TWO AUDIENCE QUESTIONS ARE SEPARATE, AND THEY HAVE TO BE
// =============================================================================
//
//   MATURE CONTENT  - a rating about the material: no / yes / audience
//   MADE FOR KIDS   - a legal classification about the AUDIENCE
//
// YouTube's own wizard gates the second one hardest, and for a reason: collapsing
// them is how a family cooking channel gets treated as adult content, or an adult
// channel gets restricted. They are not a mood picker.
//
// `made_for_kids` is a POINTER, not a boolean, all the way down - and that starts
// here. An unanswered question must not arrive at the server as `false`, because
// `false` is an assertion about somebody's content that nobody made.

import { useState } from 'react';
import { Label } from '@wideo11/ui/label';
import { Input } from '@wideo11/ui/input';
import { COVER_ACCEPTED, uploadChannelCover } from '@/lib/channel-cover-upload';
import { CATEGORY_GROUPS as _CATEGORY_GROUPS } from '@/lib/channel-types';

// The category list moved to `@/lib/channel-types`, because step 2 needs it too.
//
// A closed set enforced in three places (Go's `model.ValidChannelType`, migration
// 018's CHECK constraint, and this UI) is only "one list" if there is one file.
// It was private here, and the only way for the step-2 screen to offer the same
// picker would have been to paste it - which would have produced a fourth answer
// to the same question, on purpose, in a hurry.
const CATEGORY_GROUPS = _CATEGORY_GROUPS;

const MATURE_OPTIONS = [
  {
    value: 'no',
    label: 'No',
    hint: 'Suitable for everyone',
  },
  {
    value: 'audience',
    label: 'Yes, most of it',
    hint: 'Some content needs an adult audience',
  },
  {
    value: 'yes',
    label: 'Yes, all of it',
    hint: 'Intended for an adult audience throughout',
  },
];

export interface ChannelWizardExtras {
  channelType: string;
  matureContent: string;
  /** 
ull means NOT YET ANSWERED, which is not the same as alse. */
  madeForKids: boolean | null;
  contactEmail: string;
  country: string;
  primaryLanguage: string;
  keywords: string;
  /** The uploaded channel banner, once it has been finalised. */
  coverUrl: string;
}

export const EMPTY_WIZARD: ChannelWizardExtras = {
  // ---- `channelType` USED TO BE `''` ----
  //
  // That produced a form which looked complete and submitted an INVALID value:
  // `JSON.stringify` keeps the empty string, the server rejects it with
  //
  //     channel_type must be one of: gaming, music, podcast, education, howto,
  //                                   sports, news, film, people, comedy, autos, other
  //
  // and the creator sees a server error for a field they were never told was
  // required. That is the whole bug: an empty string is a value, and the server
  // correctly refused it.
  //
  // ---- WHY `'other'` AND NOT A POPULAR CATEGORY ----
  //
  // Two reasons, and they point opposite ways from each other:
  //
  //   * Guessing wrong is worse than admitting ignorance. `channel_type` selects
  //     upload defaults and which features surface, so a creator silently put on
  //     `gaming` because it was listed first gets a channel that behaves wrong and
  //     has no way to tell why. `other` is the honest answer when nobody has
  //     chosen yet.
  //
  //   * It keeps the form ALWAYS SUBMITTABLE. A required-with-error field is the
  //     right pattern once somebody has to pick; a form that silently sends a
  //     wrong answer is not. The picker is right above it and one click replaces
  //     the default, so nothing is lost by having a safe one in place.
  //
  // `'other'` is a REAL member of the allowlist - it is not a sentinel that would
  // fail the same validation, which is the mistake `'unspecified'` or `''` would
  // have been.
  channelType: 'other',

  // ---- `matureContent` STAYS EMPTY, ON PURPOSE ----
  //
  // The sibling field below is NOT defaulted, and the difference is the point.
  //
  // `mature_content` is a COMPLIANCE answer about a specific clip, so "I have not
  // answered" and "no" are genuinely different and the wire format already carries
  // `null` for unanswered. Defaulting it to `'no'` would state as fact something
  // nobody chose.
  //
  // `channel_type` is a CATEGORISATION, and an uncategorised channel is a perfectly
  // valid channel. Defaulting it is labelling, not claiming.
  matureContent: '',
  madeForKids: null,
  contactEmail: '',
  country: '',
  primaryLanguage: '',
  keywords: '',
  coverUrl: '',
};

/**
 * Option - one selectable choice that LOOKS selected when it is.
 *
 * The bug this fixes: each option carried a static circle, and selection was
 * signalled only by the button's and background. A person clicking "Yes"
 * saw no change AT ALL in the circle, so nothing appeared to happen - the exact
 * complaint that the round options "do not select".
 *
 * The indicator is the state, not the. `aria-pressed` and colour are
 * secondary: they are what an assistive technology reads and what a
 * high-contrast theme may override, so neither can be the only signal.
 */
function Option({
  selected,
  onSelect,
  label,
  hint,
  testId,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  hint?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-track={testId}
      className={`flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
        selected
          ? 'border-[#5794f2] bg-[#5794f2]/10'
          : 'border-[#2c3235] hover:border-[#3d434a]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-full transition-colors ${
          selected ? 'border-[#5794f2]' : 'border-[#4b5158]'
        }`}
      >
        {selected ? <span className="h-1.5 w-1.5 rounded-full bg-[#5794f2]" /> : null}
      </span>
      <span className="min-w-0">
        <span
          className={`block text-[12px] font-medium ${
            selected ? 'text-[#d8d9da]' : 'text-[#b6bcc4]'
          }`}
        >
          {label}
        </span>
        {hint ? <span className="block text-[10px] text-[#6b7280]">{hint}</span> : null}
      </span>
    </button>
  );
}

export function ChannelWizardFields({
  value,
  onChange,
}: {
  value: ChannelWizardExtras;
  /**
   * Accepts an UPDATER, not a value.
   *
   * It was a plain value, and that was a real bug rather than a test artefact:
   *
   *     const set = (key, v) => onChange({ ...value, [key]: v });
   *
   * Two clicks in the same tick - pick a mature rating, then the kids answer -
   * both spread the SAME `value` captured by the render that created them, so
   * the second call overwrites the first and the first answer is lost. The
   * symptoms were "the options do not select" and "one of the two questions
   * never sticks", which is exactly how it was reported.
   *
   * A functional updater is the only form that is correct when two changes can
   * land before a re-render.
   */
  onChange: (updater: (prev: ChannelWizardExtras) => ChannelWizardExtras) => void;
}) {
  const set = <K extends keyof ChannelWizardExtras>(key: K, v: ChannelWizardExtras[K]) =>
    onChange((prev) => ({ ...prev, [key]: v }));

  return (
    <div className="space-y-4">
      {/* ---- 1. Channel type: REQUIRED ---- */}
      <div className="space-y-1.5">
        <Label className="text-xs text-[#9fa7b3]">
          What kind of channel is this? <span className="text-[#5794f2]">*</span>
        </Label>
        <p className="text-[11px] text-[#6b7280]">
          This picks your upload defaults and which features appear. You can change it
          later.
        </p>
        <div className="mt-2 max-h-56 space-y-3 overflow-y-auto rounded-md bg-[#181b1f] p-3 custom-scrollbar">
          {CATEGORY_GROUPS.map((g) => (
            <div key={g.group}>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#6b7280]">
                {g.group}
              </p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {g.items.map((it) => {
                  const selected = value.channelType === it.value;
                  return (
                    <button
                      key={it.value}
                      type="button"
                      onClick={() => set('channelType', it.value)}
                      aria-pressed={selected}
                      data-track={`type-${it.value}`}
                      className={`flex items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${
                        selected
                          ? 'border-[#5794f2] bg-[#5794f2]/10'
                          : 'border-[#2c3235] hover:border-[#3d434a]'
                      }`}
                    >
                      {/*
                        A CHECK, not a colour. The category tiles had the same
                        problem as the radio group: the only selection cue was a tint, and on a dark background that is easy to
                        miss entirely - which is what "the options are not
                        selecting" looked like.
                      */}
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-full transition-colors ${
                          selected ? 'border-[#5794f2] bg-[#5794f2]' : 'border-[#4b5158]'
                        }`}
                      >
                        {selected ? (
                          <svg viewBox="0 0 12 12" className="h-2 w-2 text-white">
                            <path
                              d="M2 6.5 L4.5 9 L10 3"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        ) : null}
                      </span>
                      <span className="min-w-0">
                        <span
                          className={`block text-[12px] font-medium ${
                            selected ? 'text-[#d8d9da]' : 'text-[#b6bcc4]'
                          }`}
                        >
                          {it.label}
                        </span>
                        <span className="block text-[10px] text-[#6b7280]">{it.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {value.channelType ? (
          <button
            type="button"
            onClick={() => set('channelType', '')}
            className="text-[10px] text-[#6b7280] underline underline-offset-2 hover:text-[#9fa7b3]"
          >
            Clear selection
          </button>
        ) : null}
      </div>

      {/* ---- 2. The two audience questions, asked separately ---- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <fieldset className="space-y-1.5">
          <legend className="text-xs text-[#9fa7b3]">
            Does this channel contain mature content? <span className="text-[#5794f2]">*</span>
          </legend>
        <div className="space-y-1.5">
          {MATURE_OPTIONS.map((o) => (
            <Option
              key={o.value}
              testId={`mature-${o.value}`}
              selected={value.matureContent === o.value}
              onSelect={() => set('matureContent', o.value)}
              label={o.label}
              hint={o.hint}
            />
          ))}
        </div>
      </fieldset>

        <fieldset className="space-y-1.5">
          <legend className="text-xs text-[#9fa7b3]">
            Is this channel made for kids? <span className="text-[#5794f2]">*</span>
          </legend>
          <p className="text-[11px] text-[#6b7280]">
            A separate question from the content rating, and a legal one. If you are
            unsure, choose the more protective answer.
          </p>
          <div className="space-y-1.5">
            {(
              [
                { value: true, label: 'Yes, it is', hint: 'Features are restricted accordingly' },
                { value: false, label: 'No, it is not', hint: 'Full feature set applies' },
              ] as const
            ).map((o) => (
              <Option
                key={String(o.value)}
                testId={`kids-${o.value}`}
                selected={value.madeForKids === o.value}
                onSelect={() => set('madeForKids', o.value)}
                label={o.label}
                hint={o.hint}
              />
            ))}
          </div>
          {value.madeForKids === null ? (
            <p className="text-[10px] text-[#6b7280]">Not answered yet.</p>
          ) : null}
        </fieldset>
      </div>

      {/* ---- 3. Recommended ---- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ch-contact" className="text-xs text-[#9fa7b3]">
            Contact email (private)
          </Label>
          <Input
            id="ch-contact"
            type="email"
            value={value.contactEmail}
            onChange={(e) => set('contactEmail', e.target.value)}
            placeholder="you@example.com"
            className="h-10-[#2c3235] bg-[#181b1f] text-sm"
          />
          <p className="text-[10px] text-[#6b7280]">
            Never shown on your public channel. It decides which regional rules apply.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ch-country" className="text-xs text-[#9fa7b3]">
              Country
            </Label>
            <Input
              id="ch-country"
              value={value.country}
              onChange={(e) => set('country', e.target.value.toUpperCase().slice(0, 2))}
              placeholder="IN"
              maxLength={2}
              className="h-10-[#2c3235] bg-[#181b1f] text-sm uppercase"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ch-lang" className="text-xs text-[#9fa7b3]">
              Language
            </Label>
            <Input
              id="ch-lang"
              value={value.primaryLanguage}
              onChange={(e) => set('primaryLanguage', e.target.value.slice(0, 16))}
              placeholder="en"
              maxLength={16}
              className="h-10-[#2c3235] bg-[#181b1f] text-sm"
            />
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ch-keywords" className="text-xs text-[#9fa7b3]">
          Search keywords
        </Label>
        <Input
          id="ch-keywords"
          value={value.keywords}
          onChange={(e) => set('keywords', e.target.value)}
          placeholder="cooking, thali, vegetarian, quick recipes"
          className="h-10-[#2c3235] bg-[#181b1f] text-sm"
        />
        <p className="text-[10px] text-[#6b7280]">
          Comma separated. These are how people find you - the description is not
          searched the same way.
        </p>
      </div>

      <CoverField coverUrl={value.coverUrl} onChange={(v) => set('coverUrl', v)} />
    </div>
  );
}

/**
 * CoverField - the channel banner, uploaded during creation.
 *
 * WHY IT IS HERE AND NOT AFTERWARDS
 * ---------------------------------
 * The upload machinery already existed: `channels.cover_url` is a column, and
 * `components/channels/cover-uploader.tsx` does the three-step presigned PUT. What
 * was missing was the CREATE step, so a new channel had no banner until the
 * creator went looking for it later - and an empty banner slot is the first thing
 * that makes a channel look abandoned.
 *
 * It is optional, deliberately. A banner is presentation, and refusing to create
 * a channel over one turns a cosmetic gap into a dead end.
 *
 * The image is uploaded BEFORE the channel exists, so it goes to a key derived
 * from the user. The create call then records that URL. The orphan case - image
 * uploaded, channel creation fails - leaves an object that nothing references,
 * which is a small cost against a channel that ships with its own banner.
 *
 * =============================================================================
 * THIS COMPONENT WAS BROKEN. HERE IS EXACTLY WHY.
 * =============================================================================
 *
 * Reported: "cover upload does not work while creating a channel, but works
 * fine when I edit the channel afterwards."
 *
 * Three INDEPENDENT faults, and fixing one does not fix the others - which is
 * why "I tried again and it still fails" is a normal outcome here.
 *
 *  1. THE RESPONSE KEY. The guard read `ticket.upload_url`; the server sends
 *     `uploadUrl`. `UploadTicket` in `internal/service/storage.go` is camelCase
 *     end to end, so `upload_url` is never present and `!ticket.upload_url` was
 *     ALWAYS true. The function returned before uploading, every time.
 *
 *  2. THE SIZE LIMIT. It allowed 6 MB against the server's 4 MB, so a 5 MB file
 *     uploaded in full and was then rejected - after the wait.
 *
 *  3. THE OBJECT KEY. It sent a client-invented `objectKey` the server ignores,
 *     and fell back to that invented key at finalize. Accepting it would be an
 *     IDOR on the object store.
 *
 * Why it survived a build, a review and a PASSING test suite: the edit-time
 * component read the correct key, so the same feature demonstrably worked two
 * screens away. Two copies of one three-step flow, reading different JSON
 * dialects - and `check-channel-wizard.mjs` passed 16/16 without ever touching
 * the cover. Copy-paste across a monorepo guarantees drift: nothing fails when
 * two copies disagree, they just disagree.
 *
 * The durable fix is `lib/channel-cover-upload.ts` - ONE implementation that
 * cannot drift from itself. Both this component and `cover-uploader.tsx` call it.
 */
function CoverField({
  coverUrl,
  onChange,
}: {
  coverUrl: string;
  onChange: (url: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function pick(file: File) {
    setBusy(true);
    setProgress(0);
    setMsg(null);
    setErr(null);
    try {
      const publicUrl = await uploadChannelCover({
        file,
        scope: { pending: true },
        onProgress: setProgress,
      });
      onChange(publicUrl);
      setMsg('Cover set.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed. You can add a cover later.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-[#9fa7b3]">Channel cover (optional)</Label>
      <div className="flex items-start gap-3">
        <div className="relative h-[68px] w-40 shrink-0 overflow-hidden rounded-md-dashed-[#2c3235] bg-[#181b1f]">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[9px] text-[#4b5158]">
              2:1
            </span>
          )}
        </div>
        <div className="space-y-1">
          <input
            type="file"
            accept={COVER_ACCEPTED.join(',')}
            id="ch-cover"
            data-track="channel-cover-input"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pick(f);
              // Same file twice must fire again.
              e.target.value = '';
            }}
          />
          <label
            htmlFor="ch-cover"
            className={`inline-flex h-8 cursor-pointer items-center rounded-md px-2.5 text-[10px] text-[#d8d9da] transition-colors hover:bg-[#1f2227] ${
              busy ? 'pointer-events-none opacity-50' : ''
            }`}
          >
            {busy ? `Uploading ${progress}%…` : coverUrl ? 'Replace' : 'Upload'}
          </label>
          <p className="text-[10px] text-[#6b7280]">PNG, JPEG or WebP. Under 4 MB.</p>
          {busy ? (
            <div className="h-1 w-40 overflow-hidden rounded-full bg-[#1f2227]">
              <div
                className="h-full rounded-full bg-[#5794f2] transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          ) : null}
          {msg ? <p className="text-[10px] text-[#9fa7b3]">{msg}</p> : null}
          {err ? <p className="text-[10px] text-red-400">{err}</p> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * clientPreflight - the checks worth doing before a round trip.
 *
 * UX only. The server validates all of it, and the database constrains it, so a
 * bug here costs a confusing error message rather than a bad row.
 *
 * The three required answers each get their OWN message, because "invalid" for
 * all three is how someone fixes one and breaks the flow again.
 */
export function clientPreflight(w: ChannelWizardExtras): string | null {
  if (!w.channelType) return 'Pick the kind of channel this is.';
  if (!w.matureContent) return 'Answer the mature-content question.';
  if (w.madeForKids === null) return 'Answer the made-for-kids question - it is a legal setting, not a preference.';
  if (w.country && !/^[A-Z]{2}$/.test(w.country)) return 'Country must be two letters, e.g. IN.';
  if (w.contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(w.contactEmail)) return 'That contact email does not look right.';
  return null;
}

