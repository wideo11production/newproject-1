// /api/auth/security/pin  -  security PIN set + change
//
// POST = naya PIN set karo  (mandatory step 1, first time)
// PUT  = PIN change karo   (current PIN verify karke)
//
// Hinglish: POST se naya PIN set, PUT se change (purana PIN verify karte hue)
import { forwardSecurity } from '@/lib/security-proxy';
import type { NextRequest } from 'next/server';

// ---- POST: pehli baar PIN set ----
// Body: { pin, confirm_pin }
export async function POST(req: NextRequest) {
  return forwardSecurity(req, '/security/pin', 'POST', { requireBody: true });
}

// ---- PUT: PIN change ----
// Body: { old_pin, new_pin }
//
// NOTE: ye pehle missing tha - proxy par sirf POST tha, isliye UI ka "Change
// PIN" button 405 (Method Not Allowed) milta tha jabki backend PUT support
// karta hai. Ab dono methods proxy par hain.
export async function PUT(req: NextRequest) {
  return forwardSecurity(req, '/security/pin', 'PUT');
}
