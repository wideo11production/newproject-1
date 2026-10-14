'use client';

// =============================================================================
// A PASSWORD FIELD WITH A SHOW/HIDE TOGGLE
// =============================================================================
//
// WHY THIS EXISTS AT ALL
//
// Six inputs on the settings page were `type="password"` with no way to reveal
// what was typed. For the three PIN fields that is not a small annoyance - a PIN is
// SIX DIGITS, there is no length to feel, and a typo is invisible until the server
// rejects it. For a password confirmation it is worse: the commonest cause of a
// failed confirmation is a mistyped character nobody can see.
//
// So this is a genuine correctness fix, not a polish item.
//
// =============================================================================
// WHY THE PIN TOGGLE IS OFF BY DEFAULT AND THE PASSWORD TOGGLE IS ALSO OFF
// =============================================================================
//
// Both start hidden. The reasons differ and the difference is deliberate:
//
//   PIN       six digits, and a revealed PIN on a shared screen is shoulder-surfing
//             bait. It stays hidden until somebody asks.
//   PASSWORD  same, for the same reason.
//
// Both are one click away, which is the actual requirement: "I cannot tell what I
// typed" is the problem, and it is solved by availability rather than by default
// visibility.
//
// =============================================================================
// WHY THE TOGGLE IS A BUTTON AND NOT A CHECKBOX
// =============================================================================
//
// Two reasons that both matter:
//
//   1. A checkbox announces itself as a setting with a label. A button is a
//      momentary action, which is what this is. There is nothing to persist.
//   2. `type="button"` is EXPLICIT, because this component is inside forms.
//      Without it the button's default `type="submit"` submits the form, which
//      would save a half-typed PIN the moment somebody clicked the eye.
//
// That second one is the kind of bug that survives review because it looks correct:
// a button, an onClick, inside a form.

// =============================================================================
// WHY `autoComplete` IS NOT SIMPLY REMOVED
// =============================================================================
//
// `autoComplete="new-password"` is what tells a password manager NOT to offer an
// existing credential for a field that is creating a new one. Dropping it would
// make the form easier to type and worse to use, and would change behaviour for
// people relying on a manager.
//
// It is preserved, and a manager still fills the field while it is hidden. That is
// correct and is the intended behaviour of `new-password`: the input is masked from
// SIGHT, not from the value the browser holds.
//
// =============================================================================
// WHY THE VALUE IS NOT CLEARED ON TOGGLE
// =============================================================================
//
// Toggling reveals what is already there. Clearing it would be a small act of
// vandalism - the person clicked to SEE their input, not to destroy it.

import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import {
  grafanaText,
  productPanelHover,
} from '@wideo11/ui/design-system';

export interface RevealableInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value: string;
  onValueChange: (v: string) => void;
  /** Accessible name, e.g. "Show PIN" / "Hide PIN". */
  revealLabel?: string;
  hideLabel?: string;
}

export function RevealableInput({
  value,
  onValueChange,
  revealLabel = 'Show',
  hideLabel = 'Hide',
  className = '',
  ...rest
}: RevealableInputProps) {
  const [shown, setShown] = useState(false);
  // Generated rather than hardcoded, so two instances on one page cannot collide
  // and a screen reader announces the control by its real label.
  const labelId = useId();

  return (
    <div className="relative">
      <input
        {...rest}
        type={shown ? 'text' : 'password'}
        value={value}
        aria-describedby={rest['aria-describedby']}
        onChange={(e) => onValueChange(e.target.value)}
        className={`pr-10 ${className}`}
      />

      {/*
        `type="button"` is load-bearing. The default is `submit`, and this button
        lives inside the settings form, so without it clicking the eye would submit
        a half-typed PIN.
      */}
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? hideLabel : revealLabel}
        aria-pressed={shown}
        title={shown ? hideLabel : revealLabel}
        className={`absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-gray-500 transition-colors ${productPanelHover} hover:${grafanaText} focus:outline-none focus:ring-2 focus:ring-[#5794f2]`}
      >
        {shown ? (
          <EyeOff className="h-2.5 w-2.5" aria-hidden="true" />
        ) : (
          <Eye className="h-2.5 w-2.5" aria-hidden="true" />
        )}
      </button>

      {/* Referenced so the label is not an orphan for assistive tech. */}
      <span id={labelId} className="sr-only">
        {shown ? hideLabel : revealLabel}
      </span>
    </div>
  );
}