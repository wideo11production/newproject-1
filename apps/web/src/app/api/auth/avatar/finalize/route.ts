// POST /api/auth/avatar/finalize  -  magic bytes verify + content-type force
//
// Upload ke baad call hota hai. Server ASLI file bytes padh kar image format
// verify karta hai (client ke Content-Type claim par bharosa nahi) aur
// stored Content-Type ko server-side force karta hai - jisse ".html ko .png
// naam dekar upload karna" stored XSS nahi bana sakta.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  return forwardAuth(req, '/avatar/finalize', 'POST');
}