import { GlobalActivityTracker } from '@wideo11/ui/activity-tracker';
import type { Metadata } from 'next';
// Google font REMOVED - air-gapped Grafana font stack use ho raha hai.
// Kyun: "next/font/google" build time par network se Inter fetch karta tha aur
// network fail hone se build crash ho jati thi ("Failed to fetch Inter" / ECONNRESET).
// Ye ek baar actually is project me build fail kar chuki thi.
// Ab koi external font fetch nahi - system fonts native hain, zero latency.
// Hinglish: Google font hata diya, ab system font stack hai - kabhi fail nahi hoga
import { FONT_SANS_CLASS, FONT_SANS_STACK } from '@wideo11/ui/font';
import './globals.css';
import { ReactNode } from 'react';
import Providers from './providers';
import { IdentityProvider } from '@/lib/identity-context';
import { AppChrome } from '@/components/app-chrome';

export const metadata: Metadata = {
  title: 'Wideo11 - Video Platform',
  description: 'Premium video platform with custom observability dashboard',
};

export default function RootLayout({
  children,
  dashboard,
  analytics,
  alerts,
}: {
  children: ReactNode;
  dashboard: ReactNode;
  analytics: ReactNode;
  alerts: ReactNode;
}) {
  // Log config for verification (server side)
  console.log("Config loaded:", { appUrl: process.env.NEXT_PUBLIC_APP_URL, buffer: process.env.MINIMUM_MAINTENANCE_BUFFER_INR, sisterShare: process.env.SISTER_SHARE_PERCENTAGE });
  return (
    // ---- `dark` class on <html> (theme fix) ----
    // `globals.css` me do theme blocks hain:
    //   `:root` (default) -> `--background: 0 0% 100%` = **WHITE**
    //   `.dark`           -> dark Grafana tokens (#111217 family)
    //
    // Pehle `<html>` par `dark` class KABHI nahi lagta tha. Matlab har page
    // `:root` (light) par render hoti thi, aur har shadcn component
    // (`bg-card`, `bg-background`, `text-foreground`, `bg-muted` ...)
    // WHITE dikhta tha.
    //
    // Auth pages phir bhi dark lagti thi - sirf isliye ki `AuthShell` ne
    // apna background HARDCODE kiya hai (`bg-[#111217]`). Isliye transition
    // invisible tha jab tak user auth page se nikal kar kisi shadcn-token
    // wale page par nahi gaya - aur wahin "dark se light" flash dikhta tha.
    //
    // `dark` class lagane se poora app consistently dark hota hai aur wo
    // flash khatam ho jata hai.
    //
    // `colorScheme: 'dark'` bhi set kiya hai taaki browser ka native
    // scrollbar, form controls (checkbox/select), aur autofill styling bhi
    // dark rahein - inhe CSS variables control nahi karte.
    //
    // NOTE: agar future me light theme bhi chahiye, to ye static class
    // replace karke next-themes provider lagana padega. Abhi app sirf dark
    // hai, to static sahi (aur zero flash - koi hydration mismatch nahi).
    <html lang="en" className="dark" style={{ colorScheme: 'dark' }} suppressHydrationWarning>
      <body className={FONT_SANS_CLASS} style={{ fontFamily: FONT_SANS_STACK, backgroundColor: '#111217', color: '#d8d9da' }} suppressContentEditableWarning>
        {/* Global activity capture - har click/change persist hota hai.
            NOTE: ye <body> ke ANDAR hona zaroori hai - bahar rakhne par
            invalid HTML ban jata hai aur hydration fail hoti hai. */}
        <GlobalActivityTracker />
        <Providers>
          {/* ---- SESSION IDENTITY (avatar/username app-wide) ----
              Requirement: "session se har jagah uski profile image jaha bhi
              woh jayegi uske sath honi chahiye".

              Ye provider ek baar `/api/auth/me` call karta hai (httpOnly
              cookie se proxy hokar) aur avatar/username/role ko pure app
              me available karata hai - koi bhi component `useSessionIdentity()`
              se padh sakta hai, bina kisi ke dobara fetch kiye.

              Placement: `<Providers>` ke ANDAR, `<AppChrome>` se pehle -
              isliye header, sidebar, settings, sab ise use kar sakte hain.

              Public pages (login/register) par user authenticated nahi hota
              -> `_isAuthenticated` false, consumers apna fallback dikhate hain. */}
          <IdentityProvider>
            {/* Header + sidebar + main scroll container yahan se aata hai.
                Auth routes (/auth/*) pe ye khud render NAHI hota, warna dashboard
                chrome full-screen auth card ko cover kar deta tha. */}
            <AppChrome>{children}</AppChrome>
          </IdentityProvider>
        </Providers>
      </body>
    </html>
  );
}