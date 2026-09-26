// Shared authentication shell - register aur login dono ke liye EK hi layout
//
// KYUN SHARED SHELL:
// Pehle har page apna Card khud render karta tha. Isliye padding, width, brand
// header aur color palette alag-alag ho gayi thi - jo "structural alignment"
// aur "visual continuity" ko todta tha. Ab dono pages is EK component ko use
// karte hain, isliye dimensions aur styling BY CONSTRUCTION same hain.
//
// SYMMETRY KA GUARANTEE:
//   - Card width  : max-w-[450px] (dono me identical, ek jagah define)
//   - Card height : min-h-[600px] (dono me identical - neeche dekho notes)
//   - Padding     : ek hi definition, dono me same
// Isse designer-level consistency milti hai bina manual pixel tuning ke.
//
// Hinglish comments: har block ka arth

'use client';

import Image from 'next/image';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wideo11/ui/card';
import type { ReactNode } from 'react';

/**
 * AuthShellProps - shell ke props
 */
interface AuthShellProps {
  /** Card ka title (e.g. "Welcome back") */
  title: string;
  /** Title ke neeche ka supporting text */
  description: string;
  /** Form fields - children render hote hain CardContent me */
  children: ReactNode;
  /** Card ke bottom ka cross-link (login <-> register switch) */
  footer?: ReactNode;
}

/**
 * AuthShell - centered, symmetric, premium auth card
 *
 * Height symmetry ka logic:
 * Register form me 5 fields + strength meter + 2 checkboxes hain, jabki login
 * me sirf 2 fields. Agar koi min-height nahi lagate to login card visibly chhota
 * rehta aur dono side-by-side dekhne par "broken" lagta.
 * Isliye Card par fixed `min-h` hai, aur login page apne content ko
 * "Security note" + "Forgot password" block se naturally fill karta hai - jisse
 * dono cards baseline par align hote hain bina content overflow kiye.
 */
export function AuthShell({ title, description, children, footer }: AuthShellProps) {
  return (
    // Page wrapper: centered vertically + horizontally
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gray-950 px-4 py-12">
      {/* Decorative background glow - purely visual, screen readers se hidden */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-blue-600/10 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 h-80 w-80 rounded-full bg-indigo-600/10 blur-3xl" />
      </div>

      <Card
        // Width + min-height SHARED hain - yehi symmetry guarantee karta hai
        className="relative w-full max-w-[450px] min-h-[600px] rounded-2xl border border-gray-800 bg-gray-900/70 shadow-2xl shadow-black/40 backdrop-blur-sm"
      >
        <CardHeader className="space-y-4 px-8 pt-8">
          {/* Brand logo - public assets se, Next Image ke saath.
              Absolute pixel dimensions diye hain (w/h) taaki layout shift na ho */}
          <div className="flex items-center gap-3">
            <Image
              src="/brand.svg"
              alt="Wideo11"
              width={44}
              height={44}
              priority
              className="h-11 w-11 rounded-xl shadow-lg shadow-blue-600/20"
            />
            <span className="text-lg font-semibold tracking-tight text-white">
              Wideo11
            </span>
          </div>

          <div className="space-y-1.5">
            <CardTitle className="text-2xl font-semibold tracking-tight text-white">
              {title}
            </CardTitle>
            <CardDescription className="text-sm leading-relaxed text-gray-400">
              {description}
            </CardDescription>
          </div>
        </CardHeader>

        {/* Content area - consistent padding dono forms me */}
        <CardContent className="flex flex-col px-8 pb-8">
          {/* Form fields yahan render hote hain */}
          <div className="flex-1">{children}</div>

          {/* Bottom cross-link - register <-> login switch */}
          {footer ? <div className="mt-6">{footer}</div> : null}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Field - label + input + error ka consistent wrapper
 *
 * Har field ka vertical rhythm (space-y-2) ek jagah define hai, isliye
 * register aur login dono me inputs ek line pe align hote hain.
 */
export function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <LabelHtml htmlFor={id}>{label}</LabelHtml>
      {children}
      {/* Error message - reserved height nahi, sirf tab dikhta hai jab error ho */}
      {error ? (
        <p className="text-xs font-medium text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * LabelHtml - consistent label styling
 * Typography: text-sm + font-medium + gray-300 (premium SaaS standard)
 */
function LabelHtml({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-sm font-medium tracking-tight text-gray-300"
    >
      {children}
    </label>
  );
}

/**
 * INPUT_CLASS - saare text inputs ke liye ek hi styling
 *
 * Yahan consolidated kya hai:
 *   - h-11        : consistent input height (44px - industry standard touch target)
 *   - border/ring : blue-500 focus state (premium SaaS feel)
 *   - placeholder : gray-600 taaki hierarchy clear rahe
 *   - aria-invalid: error state me border red ho jaata hai
 *
 * Ye export karna zaroori hai taaki register/login dono EXACT same input
 * styling use karein - manually likhne se drift hota hai.
 */
export const INPUT_CLASS =
  'h-11 w-full rounded-lg border border-gray-700 bg-gray-950/60 px-3.5 text-sm text-white ' +
  'placeholder:text-gray-600 transition-colors duration-200 ' +
  'focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 ' +
  'aria-[invalid=true]:border-red-500/70 aria-[invalid=true]:focus-visible:ring-red-500/25 disabled:opacity-60';

/**
 * PRIMARY_BUTTON_CLASS - primary CTA styling (dono forms me identical)
 * h-11 + rounded-lg + font-medium + blue-600 with focus ring
 */
export const PRIMARY_BUTTON_CLASS =
  'h-11 w-full rounded-lg bg-blue-600 font-medium text-white shadow-sm transition-colors duration-200 ' +
  'hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

/**
 * FORM_SPACING - form fields ka consistent vertical gap
 */
export const FORM_SPACING = 'space-y-4';
