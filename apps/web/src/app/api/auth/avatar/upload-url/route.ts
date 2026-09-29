// POST /api/auth/avatar/upload-url  -  presigned MinIO PUT URL
//
// 2-step upload flow ka step 1. File bytes app server par KABHI nahi aate -
// browser seedha MinIO me PUT karta hai (step 2), phir `/finalize` (step 3).
//
// SECURITY: extension + content-type allowlist backend par validate hote
// hain, dono cross-check karke. Client ke claim par akela bharosa nahi.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  return forwardAuth(req, '/avatar/upload-url', 'POST');
}