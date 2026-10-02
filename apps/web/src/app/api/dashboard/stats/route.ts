// /api/dashboard/stats - aggregated dashboard statistics
//
// Returns all the key metrics for the dashboard overview tab.
// Single call replaces multiple round-trips.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return forwardAuth(req, '/dashboard/stats', 'GET');
}