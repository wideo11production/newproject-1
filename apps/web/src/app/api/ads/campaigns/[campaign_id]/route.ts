// ============================================================================
// AD CAMPAIGNS API - Proxy to ads-service
// ============================================================================
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return forwardAuth(req, '/campaigns', 'GET');
}

export async function POST(req: NextRequest) {
  return forwardAuth(req, '/campaigns', 'POST');
}

export async function PUT(req: NextRequest) {
  return forwardAuth(req, '/campaigns', 'PUT');
}

export async function DELETE(req: NextRequest) {
  return forwardAuth(req, '/campaigns', 'DELETE');
}
