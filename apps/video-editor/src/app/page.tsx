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
import { MediaStoreProvider } from './lib/engine/media-store';

export default function HomePage() {
  return (
    <MediaStoreProvider>
      <Suspense fallback={null}>
        <VideoEditor />
      </Suspense>
    </MediaStoreProvider>
  );
}
