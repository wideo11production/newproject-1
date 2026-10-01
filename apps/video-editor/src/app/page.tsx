'use client';

// ============================================================================
// Editor entry point
// ============================================================================
//
// The `MediaStoreProvider` is here rather than inside `VideoEditor` because the
// store has to survive every re-render of the shell, and because a provider
// mounted inside the component that consumes it remounts its children whenever
// that component's key changes - which would throw away every decoded video
// frame in the compositor at exactly the wrong moment.

import { Suspense } from 'react';
import { VideoEditor } from './components/video-editor';
import { AccessGate } from './components/chrome/access-gate';
import { MediaStoreProvider } from './lib/engine/media-store';

export default function HomePage() {
  return (
    <MediaStoreProvider>
      {/*
        The gate lives here rather than in a middleware redirect. Signing in
        without losing your place, and without the editor's own sign-in buttons
        being unreachable, is worth more than keeping anonymous visitors off a
        page whose data is already 401-gated server side. See
        `components/chrome/access-gate.tsx` for the full trade-off.
      */}
      <AccessGate>
        <Suspense fallback={null}>
          <VideoEditor />
        </Suspense>
      </AccessGate>
    </MediaStoreProvider>
  );
}
