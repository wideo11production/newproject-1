// WideoCutEditorView — 🎥 Direct route to video editing canvas.
//
// Hinglish: ye tab video editor ko embed karta hai (iframe ya redirect).
// Video editor ek alag app hai (Next.js app on port 3002) jo yahan
// iframe mein ya naye tab mein khol sakta hai.
//
// User directive: "WideoCut Editor (Direct route to video editing canvas view)"

import { Play, ExternalLink } from 'lucide-react';
import { Button } from '@wideo11/ui/button';

const VIDEO_EDITOR_URL = process.env.NEXT_PUBLIC_VIDEO_EDITOR_URL ?? 'http://localhost:3002';

export function WideoCutEditorView() {
  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#d8d9da]">WideoCut Editor</h1>
        <a href={VIDEO_EDITOR_URL} target="_blank" rel="noreferrer">
          <Button variant="ghost" size="sm" className="text-[#9fa7b3]">
            <ExternalLink className="mr-2 h-2.5 w-2.5" />
            Open in new tab
          </Button>
        </a>
      </div>

      <div className="mb-4 rounded-md bg-[#0d0f11] p-4">
        <div className="flex items-center gap-3 text-sm text-[#9fa7b3]">
          <Play className="h-2.5 w-2.5 text-[#5794f2]" />
          <span>
            The WideoCut editor runs as a standalone application.{' '}
            <strong>Click "Open in new tab"</strong> to launch it with full
            performance (120 FPS support for AURA Premium subscribers).
          </span>
        </div>
      </div>

      <div
        className="relative flex h-[600px] w-full items-center justify-center rounded-md bg-[#0d0f11]"
      >
        <iframe
          src={VIDEO_EDITOR_URL}
          title="WideoCut Editor"
          className="h-full w-full rounded-md border-0"
          allow="camera; microphone; fullscreen"
        />
        <div className="absolute bottom-4 left-4 rounded-md bg-[#181b1f] px-3 py-1.5 text-xs text-[#9fa7b3]">
          AURA Premium Engine: 120 FPS / 240Hz enabled for verified subscribers
        </div>
      </div>
    </div>
  );
}

