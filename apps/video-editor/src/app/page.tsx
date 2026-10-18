'use client';

// ============================================================================
// EDITOR ENTRY POINT — Primary Container Layout
// ============================================================================
//
// Hinglish: Ye file video-editor ka primary container layout hai. Ismein teen
// major components physically mounted aur wired hain:
//
//   1. EditorOverlayProvider — page-level state container jo AIPromptStudio,
//      FrameTemplateNodes, FrameTemplateEditor overlays ko manage karta hai.
//      Isko VideoEditor component (jo useEditorOverlay() hook use karta hai)
//      ke ANDAR wrap karta hai — isliye dono (page + VideoEditor) ek hi context
//      share karte hain bina prop-drilling ke.
//
//   2. SuperadminPulseIndicator — green blinking dot jo viewport ke upper-right
//      par continuously check karta hai ki kya user 'advchashampalup@gmail.com'
//      hai. Agar haan → root 'superadmin' status visible. Ye 150ms transition
//      ke saath animate hota hai.
//
//   3. MediaStoreProvider + AccessGate + VideoEditor — jo andar se AIPromptStudio
//      dialog, 3-frame layout editor nodes (FrameTemplateNodes), aur red playhead
//      hover preview handlers ko render karta hai. Ye teeno VideoEditor ke render
//      tree mein physically mounted hain (video-editor.tsx:3198, :2858, :2887).
//
// ---- ROUTER ATTACHMENT ----
// Hinglish: Ye page `/app/page.tsx` hai, jo video-editor app ka root route
// handle karta hai (port 3002). Iski routing `apps/video-editor/src/app/`
// directory structure par based hai — Next.js App Router yehi se start hota hai.
//
// ---- LAYOUT OVERRIDES ----
// Hinglish: Saare borders/stripes hata diye gaye hain (borderless.css global).
// Panels flush rehte hain rounded-md contours mein. Palette:
//   Charcoal #161616 (sidebars/blocks) | Slate Gray #1e1e1e (timelines)
//   Orange-red #ff6500 accent (150ms state changes)
// ============================================================================

import { Suspense } from 'react';
import { VideoEditor } from './components/video-editor';
import { AccessGate } from './components/chrome/access-gate';
import { MediaStoreProvider } from './lib/engine/media-store';
import { useSession } from './lib/session';
import { EditorOverlayProvider } from './context/editor-overlay-context';
import { SuperadminPulseIndicator } from '@wideo11/ui/superadmin-pulse';

function EditorShell() {
  const { session } = useSession();

  // Hinglish: Admin Pass — session se user email + role nikal kar EditorOverlayProvider
  // ke initialSession mein pass karte hain. Provider isi data se superadmin gating
  // evaluate karta hai: 'advchashampalup@gmail.com' → isSuperAdmin = true.
  const initialSession = {
    isSuperAdmin: session.isSuperadmin,
    email: session.email,
    role: session.role,
    maxFps: session.maxFps,
    plan: session.plan,
  };

  return (
    <EditorOverlayProvider initialSession={initialSession}>
      {/* Hinglish: MediaStoreProvider yahan wrap karta hai kyunki store
          VideoEditor ke re-renders se bachaana padta hai — provider inside
          the consuming component remount karta hai children ko, jo decoded
          video frames ko throw away karta. */}
      <MediaStoreProvider>
        {/* Hinglish: AccessGate sign-in check karta hai bina middleware redirect ke.
            Editor ke apne sign-in buttons reachably rehne dete hain. */}
        <AccessGate>
          <Suspense fallback={null}>
            <VideoEditor />
          </Suspense>
        </AccessGate>
      </MediaStoreProvider>

      {/* ---- COMPONENT INJECTION: Green superadmin pulse dot (page-level viewport) ----
          Hinglish: Ye dot page ke upper-right corner par fix hai, VideoEditor ke
          render tree se bahr — taaki ye kabhi bhi editor ki state changes se
          disconnect nahi ho. 150ms transition ke saath green pulse karta hai.
          Continuous root evaluation: har session refresh par dobara check hota hai. */}
      <div className="fixed top-4 right-4 z-[60] flex items-center gap-2 rounded-md bg-[#161616]/90 px-2.5 py-1.5 shadow-[0_0_8px_rgba(34,197,94,0.3)]">
        <SuperadminPulseIndicator
          email={session.email}
          role={session.role}
          isSuperadmin={session.isSuperadmin}
          size="sm"
        />
        {session.isSuperadmin && (
          <span className="text-[9px] font-medium text-green-400">Root Active</span>
        )}
      </div>
    </EditorOverlayProvider>
  );
}

export default function HomePage() {
  return <EditorShell />;
}
