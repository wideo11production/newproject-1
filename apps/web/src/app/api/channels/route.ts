// /api/channels  -  apne channels dekho (GET) + naya banao (POST)
//
// Hinglish: channels list karo, ya naya channel banao
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return forwardAuth(req, '/channels', 'GET');
}

export async function POST(req: NextRequest) {
  return forwardAuth(req, '/channels', 'POST');
}