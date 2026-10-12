// /api/media/[id]/finalize  -  step 3 of a media upload.
//
// Marks the bytes as landed and hands the asset to the transcoder, which runs
// the ffmpeg ladder (1080p / 720p / 480p / audio / reel in one pass) and calls
// back when it is done.
//
// A failed transcode ENQUEUE does not fail this request: the file is stored and
// recorded either way, and telling the user their 8 GB upload failed means they
// re-upload it. The asset stays `uploaded`, visibly unfinished rather than
// silently complete.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

type Ctx = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Ctx) {
  return forwardAuth(req, `/media/${encodeURIComponent(params.id)}/finalize`, 'POST');
}
