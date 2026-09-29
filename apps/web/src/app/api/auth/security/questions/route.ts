// PUT /api/auth/security/questions
// 3 security questions + answers save karta hai (mandatory step 3).
//
// Hinglish: user ke 3 security questions save karo
import { forwardSecurity } from '@/lib/security-proxy';
import type { NextRequest } from 'next/server';

export async function PUT(req: NextRequest) {
  return forwardSecurity(req, '/security/questions', 'PUT');
}