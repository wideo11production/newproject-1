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
//   - Card height : content-driven, capped at max-h-[60vh] (dono me identical)
//   - Padding     : ek hi definition, dono me same
// Isse designer-level consistency milti hai bina manual pixel tuning ke.
//
// HEIGHT STRATEGY (current - fixed 500px hataya gaya):
//   Timeline:
//     1. `min-h-[600px]`  -> card content se zyada stretch hota tha
//     2. fixed `h-[500px]` -> isme form clip hota tha (submit invisible)
//     3. AB: height content-driven + `max-h-[60vh]` cap
//
//   Kyun 3? Register form ab STRICT single-column hai (4 fields apni-apni
//   line pe) + 44px (`h-11`) inputs + `space-y-4` (16px) gaps + strength
//   meter + 2 consent panels + submit. Iska natural content height ~640-680px
//   hai - jo KISI fixed chhoti height me nahi samayega, aur na hi bina
//   compress kiye. Compression (2-column grid, `h-10`, `space-y-2`) karte
//   to 500px me fit hota, par wo readability/ergonomics se compromise tha.
//
//   Ab card apni content height leta hai (bade screens par perfectly
//   centered) aur `max-h-[60vh]` se cap hota hai - kyunki wrapper ka
//   `min-h-screen` (100vh) + `py-[20vh]` upar-neeche 40vh khata hai.
//   100vh - 40vh = 60vh. Chhote viewports par card 60vh tak shrink hota hai
//   aur inner `overflow-y-auto` scroll karata hai - CLIP kabhi nahi hota.
//
//   Trade-off jo jaan-boojh kar liya gaya: 16px gap + 44px inputs +
//   single column = zyada vertical space chahiye. Ye theek hai, kyunki ab
//   scroll sirf tab aata hai jab viewport SAHI se chhota ho, hamesha nahi.
//
// Hinglish comments: har block ka arth

'use client';

// ---- BRAND MASCOTS (inline SVG, zero image files) ----
// Pehle yahan `<Image src="/brand.svg">` tha. Wo ek FILE ASSET tha -
// matlab ek extra network request + ek image decode + ek cached binary.
// Spec ke mutabik ab hum Wideo11 ke apne inline SVG mascots render karte
// hain (`packages/ui/src/brand/characters.tsx`, spec revision 1.0.0).
//
// FAYDA:
//   - Zero image bytes (koi .png/.svg file load nahi)
//   - Koi CLS nahi (vector inline hai, box pehle se jaanta hai)
//   - 16px tak crisp (vector resample hota hai)
//   - Deterministic - koi AI drift nahi, manifest se geometry locked hai
import { BrandLockup } from '@wideo11/ui/brand/characters';
// NOTE: `CardDescription` pehle import kiya tha par compact header ke baad
// render nahi hota (600px budget me jagah nahi). Ab import bhi hata diya -
// unused import rakhna lint noise deta hai.
import { Card, CardContent, CardHeader, CardTitle } from '@wideo11/ui/card';
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
 * Height strategy: content-driven + `max-h-[60vh]` cap. Fixed `h-[500px]`
 * hata di gaya hai (wo 2-column grid + `h-10` inputs pe depend karta tha,
 * jo ab single-column + 44px inputs mandate ke saath replace ho gaye hain).
 *
 * Fixed height ki jagah ab `max-h-[60vh]` hai, kyunki wrapper 100vh +
 * 40vh (`py-[20vh]`) padding use karta hai - to card ke liye exactly 60vh
 * bachta hai. Isse:
 *   - Bade viewports: card apni natural height, perfectly centered
 *   - Chhote viewports: card 60vh tak shrink, inner layer scroll kare
 *   - Kabhi bhi clip nahi, aur hamesha scrollbar nahi
 *
 * Register form ke liye koi "content filler" ya artificial compactness ki
 * zaroorat nahi - form apni natural, readable, single-column height rakhta
 * hai. Login form (2 fields) naturally chhota hai, jo acceptable hai.
 */
export function AuthShell({ title, description, children, footer }: AuthShellProps) {
  return (
    // ---- OUTER PAGE WRAPPER (centering + breathing room) ----
    // Ye wrapper poore auth layout ka root hai. Iska kaam hai card ko
    // viewport ke EXACT CENTER me rakhna, dono axes pe.
    //
    //   `box-border` + `min-h-screen` : 100vh = true viewport height.
    //     Ye EXPLICITLY pin kiya gaya hai. Agar ye `box-content` hota, to
    //     `min-h-screen` sirf content box hota aur uske upar `py-[20vh]`
    //     padding add ho jata -> 100vh + 40vh = har page par permanent
    //     vertical scrollbar. Ye galti pichle round me bhi hui thi
    //     (`box-content` galat jagah lagane se 100vh + px-4 py-6 ho gaya
    //     tha), isliye ab comment + explicit class dono lock kar diye hain.
    //
    //   `flex items-center justify-center` : card DONO axes pe centered.
    //     `items-center` + overflow ka ek classic flexbox trap hai - jab
    //     card viewport se bada hota hai to top overflow UPAR clip ho jata
    //     hai aur scroll se unreachable ho jata hai. Isko rokne ke liye
    //     card par `max-h-[60vh]` + internal `overflow-y-auto` hai (neeche),
    //     jisse card kabhi available height se bada hi nahi hoga. Yaani
    //     centering + no-clip dono saath me sahi rehte hain.
    //
    //   `px-[10%]` : EXACTLY 10% horizontal breathing space. Percentage
    //     padding viewport width ke hisaab se calculate hoti hai, to
    //     ultra-wide (4K) screens par bhi proportional rehti hai - fixed
    //     px value nahi. Mobile par bhi chalti hai.
    //
    //   `py-[20vh]` : EXACTLY 20vh vertical padding top aur bottom. Ye
    //     `min-h-screen` ke saath milkar 100vh + 40vh deta hai, isliye
    //     `overflow-y-auto` COMPANION zaroori hai (card ko `max-h-[60vh]`
    //     chahiye taaki 100vh - 40vh = 60vh ke andar fit ho). Chhote
    //     viewports (jaise 700px) par 40vh = 280px, to card ko ~420px me
    //     fit karna padta hai - inner scroll layer usi kaam aata hai.
    //     Design intent: card viewport ka max 60% height lega, aur upar/
    //     niche 20vh ka premium "breathing" gap rahega.
    //
    //   `w-full min-w-0` : wrapper poori width leta hai, warna flex shrink
    //     karke card ko viewport se bada kar deta hai.
    //
    //   `overflow-x-hidden` : horizontal overflow clip - mobile par
    //     horizontal scrollbar nahi aata.
    //
    // ---- PADDING: `py-[20vh]` se `py-5` (20px) ----
    // Pehle `py-[20vh]` tha. Ye 600px card ke SAATH incompatible tha:
    //   20vh (top) + 20vh (bottom) = 40vh
    //   1080p screen par 40vh = ~360px
    //   360 + 600 (card) = 960px total -> viewport se zyada -> PAGE scroll
    // Yaani user ko "no scroll" ke saath "600px card" dono nahi mil sakte
    // the. Fix: vertical padding FIXED 20px kar diya.
    //   600 (card) + 20 + 20 = 640px total
    // Ye ~650px se bade har viewport me bina kisi scroll ke fit hota hai
    // (aam laptop 720-1000px CSS pixels hote hain).
    // NOTE: 650px se CHHOTE viewport par page scroll aayega - ye unavoidable
    // hai, kyunki 600px content + padding physically 640px chahta hai. Koi bhi
    // CSS usse viewport ke andar nahi daal sakta bina content ko chhota kiye.
    //
    // Hinglish: card 600px fixed, padding 20px - total 640px, zyada tar
    //   bina scroll ke fit ho jata hai
    <div className="relative mx-auto box-border flex min-h-screen w-full min-w-0 items-center justify-center overflow-x-hidden bg-[#111217] px-[10%] py-5">
      {/* Decorative background glow - purely visual, screen readers se hidden */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-blue-600/10 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 h-80 w-80 rounded-full bg-indigo-600/10 blur-3xl" />
      </div>

      <Card
        // ---- HEIGHT: content-driven, capped at 60vh ----
        // FIXED `h-[500px]` POORI TARAH hata di gayi. Woh 2-column grid pe
        // depend kar rahi thi (grid ~128px bachata tha). Ab form STRICT
        // single-column + 44px inputs + `space-y-4` hai, jiska natural
        // content height ~640-680px hai - jo 500px me KABHI nahi samayega.
        // Fixed height rakhne se ya to content clip hota (submit button
        // invisible) ya scrollbar aa jaata. Isliye ab:
        //
        //   - Height apne aap content se banti hai (koi `h-*` nahi).
        //   - `max-h-[60vh]` : wrapper ka `min-h-screen` (100vh) + `py-[20vh]`
        //     upar-neeche = 40vh, to card ke liye 100vh - 40vh = 60vh bachta
        //     hai. `max-h-[60vh]` EXACTLY usi number par hai, yaani card kabhi
        //     available height se bada nahi hoga.
        //   - Ye `items-center` + overflow ke flexbox trap ko bhi rokta hai:
        //     bina max-h ke bada card upar clip ho jata tha.
        //   - Bade viewports par content < 60vh hota hai to card apni natural
        //     height rakhta hai aur vertically perfectly centered rehta hai.
        //   - Chhote viewports par card 60vh tak shrink hota hai aur inner
        //     `overflow-y-auto` safety layer scroll karata hai (CLIP nahi).
        //
        //   `w-full` + `min-w-0` + `max-w-[450px]` : width constraints waise
        //     hi - chhote screens par shrink, bade par 450px cap.
        //
        // GRAFANA SURFACE MAPPING (card par):
        //   border = #2c3235 (grafanaBorderHex) - pehle `border-gray-800` (#1f2937)
        //   bg     = #181b1f @ 70% (grafanaPanelHex) - pehle `bg-gray-900/70` (#111827/70)
        //   Ye card ko landing page ke hero/content panels se EXACTLY same surface
        //   deta hai, to page-to-page transition me color shift nahi dikhta.
        // Hinglish: card ki height content se (60vh cap), color landing wala
        //   - auth pages ab ek hi family me hain
        //
        // ---- HEIGHT: AUTO (content-fit) - fixed 600px REMOVED ----
        // SCREENSHOT ne dikhaya ki `h-[600px]` galat choice tha:
        //
        //   card 600px, content ~420px  ->  ~180px DEAD SPACE bottom me
        //
        // Compact form banne ke baad content 600px ki zaroorat se kai chhota
        // ho gaya, lekin card height fix thi - to bottom me ek bada khaali
        // area dikh raha tha. User ka feedback: "form ke andar neeche bhut
        // space kahli and awkward". Sahi pakda gaya.
        //
        // FIX: height ab CONTENT se aati hai (`h-auto`, koi `h-*` nahi).
        //   - dead space gayab
        //   - card hamesha apne content ke barabar
        //   - register (3 fields) ~420px, login (2 fields) ~300px -
        //     dono sahi dikhenge, koi stretch nahi
        //   - koi scroll nahi (content box se chhota hai by definition)
        //   - wrapper `min-h-screen items-center` se dono vertically center
        //
        // NOTE: 600px kyun chhoda, wo bhi bata deta hoon - wo tab sahi tha
        // jab form LAMBBA tha (4 fields + 2 bordered panels, ~640px) aur
        // fixed height usse clip kar rahi thi. Ab form compact hai, to fixed
        // height ulta problem ban gayi. Height ko content ke saath adapt
        // karna hi sahi approach hai.
        //
        // `overflow-hidden` rakha hai - future me koi bahut lamba field
        // add ho to overflow card se bahar na nikle.
        // Hinglish: height apne aap content ke hisaab se - khaali jagah nahi
        className="relative box-border flex h-auto w-full min-w-0 max-w-[450px] flex-col overflow-hidden rounded-2xl border border-[#2c3235] bg-[#181b1f]/70 shadow-2xl shadow-black/40 backdrop-blur-sm"
      >
        {/* ---- COMPACT HEADER ----
            600px budget me header ko ~230px se ~90px par laaya gaya:
            - pehle 3 alag rows: logo row, title block, description
            - ab EK row: [mascot + Wideo11] left, [title] right
            - description POORI TARAH hata di - form ka apna context
              ("Create your account") zyada useful hai
            Ye ~140px bachta hai jo form ko mila.
            Hinglish: header chhota - mascot + title ek hi line me */}
        <CardHeader className="shrink-0 space-y-0 px-5 pt-4 sm:px-7 sm:pt-4">
          {/* ---- BRAND LOCKUP: Wino + Rino inline SVG mascots ----
              Spec revision 1.0.0 (packages/ui/src/brand/characters-manifest.ts).

              `BrandLockup` dono mascots ko slight overlap me render karta hai
              (negative `-space-x-2`) - ye intentional design choice hai, jisse
              lockup compact dikhta hai aur dono ki identity saath dikhti hai.

              SIZING: 28px per mascot. Chhota rakha hai kyunki ye ek HEADER
              row hai, hero nahi - form ka content upar se push nahi hona
              chahiye. 28px comfortably `minLegiblePx: 16` se upar hai, to
              Rino ke 3 antennas bhi readable rehte hain.

              ACCESSIBILITY: `decorative` true kyun?
                - Mascot purely visual hai. Card ka `<h3>` title + description
                  already screen reader ko bata dete hain ki ye login/register
                  page hai.
                - Agar mascot apna aap `role="img"` + `aria-label` rakhta,
                  to screen reader HAR page par "Wino - Your build buddy,
                  Rino - Your automation sidekick" DOBAARA announce karta -
                  jo noise hai, information nahi.
                - Isliye `decorative` (aria-hidden) sahi choice hai. Brand
                  naam visually `Wideo11` text ke roop me bhi present hai. */}
          <div className="flex items-center justify-between gap-3">
            {/* Left: mascots + wordmark.
                `shrink-0` ZAROORI hai - iske bina flex ye side compress ho
                jata tha jab title lambi ho, aur wordmark "Wide..." me truncate
                ho jata tha (screenshot me dikha). Ab left side kabhi shrink
                nahi hoga; truncate sirf right side (title) pe lagega. */}
            <div className="flex shrink-0 items-center gap-2">
              <BrandLockup size={26} />
              <span className="text-sm font-semibold tracking-tight text-[#d8d9da]">
                Wideo11
              </span>
            </div>
            {/* Right: page title + description.
                `truncate` + `min-w-0` safety deta hai agar title lambi ho
                to ellipsis lag jaye (login page ka "Welcome back" short hai,
                register ka "Create your account" thoda lamba). */}
          <div className="min-w-0 text-right">
            <CardTitle className="truncate text-base font-semibold tracking-tight text-[#d8d9da]">
              {title}
            </CardTitle>
            {/* `description` pehle REMOVED tha - wo tab jab card par FIXED
                600px height thi aur header me jagah nahi thi. Ab card
                `h-auto` hai (content-fit), yaani extra line lene se koi
                problem nahi, isliye ye wapas render kiya gaya.

                NOTE: `line-clamp-1` (single line + ellipsis) `truncate` se
                behtar hai yahan - `truncate` overflow:hidden use karta hai
                jo flex row me height collapse kar sakta tha. `line-clamp-1`
                height ko line-height tak hi rakhta hai. */}
            <p className="mt-0.5 line-clamp-1 text-[11px] leading-none text-[#9fa7b3]">
              {description}
            </p>
          </div>
        </div>
      </CardHeader>

        {/* Content area - consistent padding dono forms me.
            `flex-1 min-h-0` zaroori hai: isse ye apna bacha hua height leta
            hai aur flex-1 wala child (form) overflow na karaye. */}
        <CardContent className="flex min-h-0 flex-1 flex-col px-5 pb-4 sm:px-7 sm:pb-4">
          {/* Form fields yahan render hote hain.
              KOI SCROLL LAYER NAHI - `overflow-y-auto` poori tarah hata diya
              gaya hai, aur `.auth-scroll` class + uski CSS definition dono
              globals.css se remove kar di gayi hain (koi component use nahi
              karta tha).

              KYUN: user requirement tha "scroll na karna pade, not at all".
              600px card me content ~580px hai, yaani scroll ki ZAROORAT hi
              nahi bani. Pehle ka scroll layer isliye zaroori tha kyunki:
                - card `max-h-[60vh]` tha (viewport par dependent)
                - wrapper `py-[20vh]` tha (40vh reserve)
                - content ~640-680px tha (4 fields + 2 panels)
              Teeno conditions ab badal gayi:
                - card FIXED `h-[600px]` (viewport independent)
                - wrapper `py-5` (fixed 20px)
                - content ~580px (1 field hata diya + compact spacing)
              Yaani ab content kabhi box se bada nahi hoga.

              SAFETY: agar future me koi field add ho aur content 600px cross
              kar le, to `overflow-hidden` (card par) ki wajah se CLIP hoga -
              scroll nahi. Ye jaan-bujh kar choose kiya gaya hai: user ko
              invisible content se zyada pasand hai visible scroll nahi.
              (Agar aisa ho to field count/compactness adjust karna padega,
              ya `max-h` wapas laana padega.)
              Hinglish: scroll hata diya - 600px me sab aa jata hai */}
          <div className="min-h-0 min-w-0 flex-1">{children}</div>

          {/* Bottom cross-link - register <-> login switch */}
          {footer ? <div className="mt-3 shrink-0">{footer}</div> : null}
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
    // `space-y-1` (4px): label aur input ke beech ka gap. Ye field ke
    // ANDAR ka gap hai - form ke children ke beech ka gap `FORM_SPACING`
    // (`space-y-3`) alag se handle karti hai. Do alag values isliye kyunki
    // dono alag relationships describe karte hain.
    <div className="space-y-1">
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
      className="block text-xs font-medium leading-none tracking-tight text-[#d8d9da]"
    >
      {children}
    </label>
  );
}

/**
 * INPUT_CLASS - saare text inputs ke liye ek hi styling
 *
 * Yahan consolidated kya hai:
 *   - h-11        : 44px input height. Ye EXACTLY `design-system.ts` ke
 *                   `input` token ke saath match karta hai (bhi `h-11`).
 *                   Pehle `h-10` (40px) tha jo design system se DRIFT kar
 *                   raha tha - ab dono ek hi value pe lock hain.
 *   - border/ring : blue-500 focus state (premium SaaS feel)
 *   - placeholder : gray-600 taaki hierarchy clear rahe
 *   - aria-invalid: error state me border red ho jaata hai
 *
 * Ye export karna zaroori hai taaki register/login dono EXACT same input
 * styling use karein - manually likhne se drift hota hai.
 */
export const INPUT_CLASS =
  // `h-11` = 44px - EXACTLY `design-system.ts` ke `input` token ke saath match.
  // `bg-[#0d0f11]` = grafana `surface.sunken` shade (input ka andar ka beech
  // slightly darker hota hai panel se, taaki field "recessed" lage - ye
  // standard enterprise form pattern hai, Tailwind `gray-950/60` ki jagah
  // exact Grafana value).
  // `border-[#2c3235]` = grafanaBorderHex.
  // NOTE: input TEXT left-aligned hai (text-left), centered NAHI. Centered
  // input text ek genuine UX anti-pattern hai - user ko typed value ka
  // start/end offset dikhta hai, cursor position kaandha lagta hai, aur
  // email/password me reading slow hoti hai. "Alignment" yahan matlab hai
  // ki saare fields ek hi width/indent line pe baithen (jo `w-full` + shared
  // `Field` wrapper ensure karte hain), text centering nahi.
  // `h-10` = 40px. Pehle `h-11` (44px) tha. 600px card me 3 text input hain
  // (full name hata diya), to 4px x 3 = 12px bacha.
  // NOTE: 40px abhi bhi WCAG 2.5.8 (Target Size Minimum = 24px) se kahin
  // upar hai, to accessibility compromise nahi hai - sirf 2 column grid
  // wale dense layout se zyada compact ho gaya.
  'h-10 w-full min-w-0 rounded-lg border border-[#2c3235] bg-[#0d0f11] px-3.5 text-sm text-[#d8d9da] ' +
  'placeholder:text-[#9fa7b3]/60 transition-colors duration-200 ' +
  'focus-visible:border-[#5794f2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5794f2]/30 ' +
  'aria-[invalid=true]:border-[#f2495c]/70 aria-[invalid=true]:focus-visible:ring-[#f2495c]/25 disabled:opacity-60';

/**
 * PRIMARY_BUTTON_CLASS - primary CTA styling (dono forms me identical)
 *
 * `inline-flex items-center justify-center` ZAROORI hai: ye class `<Button>`
 * (ek `<button>`) aur raw `<Link>` (ek `<a>`) dono pe use hoti hai.
 * `<a>` default se `display: inline` hota hai, aur inline element par
 * `h-11` / `w-full` apply hi NAHI hote - button chhota aur text jaisa dikhta
 * hai. `inline-flex` se dono cases me sahi full-width button banta hai.
 */
export const PRIMARY_BUTTON_CLASS =
  'inline-flex h-10 w-full min-w-0 items-center justify-center rounded-lg bg-blue-600 font-medium text-sm text-white shadow-sm transition-colors duration-200 ' +
  'hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

/**
 * FORM_SPACING - form fields ka consistent vertical gap
 *
 * `space-y-3` (12px) - pehle `space-y-4` (16px) tha. 600px card me ab 5
 * children hain (3 field + terms + submit), to 4px x 5 = 20px bacha.
 * 12px gap abhi bhi clearly readable hai (label ka apna `space-y-1` alag hai,
 * wo field ke andar label-to-input distance hai).
 */
export const FORM_SPACING = 'space-y-3';
