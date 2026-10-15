// ============================================================================
// SETTINGS CONSOLE - settings page
// ============================================================================
// /settings is a console route (AppChrome wraps it), but it has no @settings
// parallel-slot and the real settings UI lives at /dashboard/settings (the 1105-line
// unified settings hub). Render this page as a server-side redirect so every entry
// point that lands here — including the creator-dashboard "Console" overflow item
// (dashboard/page.tsx) and the AppChrome navigation link — reaches the real page
// instead of the empty <div/> stub it was before.
//
// `redirect()` throws a Response (Next.js special) during server render, so
// AppChrome never paints for /settings; the browser receives a 307 to
// /dashboard/settings, which renders standalone (it is not a CONSOLE_ROUTE).

import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Settings - Wideo11',
  description: 'Redirecting to the unified settings console',
};

export default function SettingsPage() {
  redirect('/dashboard/settings');
}
