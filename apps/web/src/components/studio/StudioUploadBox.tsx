'use client';

/**
 * STUDIO UPLOAD BOX - the full-width drag-and-drop dropzone.
 *
 * =============================================================================
 * THE ONE BORDERED THING ON THE PAGE, AND WHY
 * =============================================================================
 *
 * The rest of the studio separates by background contrast. This one uses a
 * DASHED border, because a drop target that is only a slightly different shade of
 * charcoal is a drop target nobody finds. The brief asks for a dashed border here
 * specifically, and it is the right call: it says "something goes here" before
 * any text is read.
 *
 * =============================================================================
 * WHY THE DRAG STATE IS ON THE OUTER BOX
 * =============================================================================
 *
 * Browsers fire `dragover` on the deepest element under the pointer, and the
 * drop target is the full-width box. If the highlight lived on an inner element
 * it would flicker as the pointer moved over a child.
 *
 * The counter in the state below is also why the highlight cannot just be
 * `boolean`: entering a child fires another `dragenter` before its parent fires
 * `dragleave`, and a naive boolean turns the highlight off halfway across the
 * box. A counter, incremented on enter and decremented on leave, only clears when
 * the pointer has genuinely left.
 */

import { useCallback, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';

interface StudioUploadBoxProps {
  onFiles?: (files: File[]) => void;
  /** Rendered in place of the default copy when a caller owns the text. */
  title?: string;
  hint?: string;
  accepting?: boolean;
}

export function StudioUploadBox({
  onFiles,
  title = 'Drag and Drop or Click to Upload',
  hint = 'Videos, reels and audio. Everything is encoded once, into every quality.',
  accepting = true,
}: StudioUploadBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // Depth counter, not a boolean - see the note above.
  const depth = useRef(0);

  const take = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      onFiles?.(Array.from(files));
    },
    [onFiles]
  );

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        // Required, or the browser refuses the drop outright.
        e.preventDefault();
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        take(e.dataTransfer?.files ?? null);
      }}
      onClick={() => accepting && inputRef.current?.click()}
      onKeyDown={(e) => {
        // The box is a control, so it has to be reachable without a mouse.
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (accepting) inputRef.current?.click();
        }
      }}
      role="button"
      tabIndex={0}
      aria-disabled={!accepting}
      aria-label={title}
      data-dragging={dragging ? 'true' : 'false'}
      className={`group relative w-full cursor-pointer rounded-2xl px-6 py-10 text-center transition-all duration-200 sm:py-14 ${
        dragging
          ? 'border-2 border-solid border-[#ff6500] bg-[#ff6500]/[0.06]'
          : 'border-2 border-dashed border-[#3a4045] bg-[#0d0f11] hover:border-[#ff6500]/60 hover:bg-[#16181d]'
      } ${accepting ? '' : 'pointer-events-none opacity-50'}`}
    >
      {/* The icon is the only saturated element in the box, so the eye lands on
          it before it lands on the text. */}
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#16181d] shadow-md shadow-black/30 transition-transform duration-200 group-hover:scale-105">
        <UploadCloud
          className={`h-6 w-6 transition-colors ${dragging ? 'text-[#ff6500]' : 'text-[#8b949e] group-hover:text-[#ff6500]'}`}
          aria-hidden="true"
        />
      </div>

      <p className="text-sm font-medium text-white sm:text-base">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-xs text-[#8b949e]">{hint}</p>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="video/*,audio/*"
        className="hidden"
        onChange={(e) => {
          take(e.target.files);
          // Cleared so selecting the SAME file twice in a row fires twice: an
          // unchanged input would not dispatch change the second time.
          e.target.value = '';
        }}
      />
    </div>
  );
}
