// POST /api/refresh - force rate refresh proxy (same-origin, CORS-free)
import { forwardToCurrency } from '@/lib/currency-proxy';

export async function POST() {
  return forwardToCurrency('/api/v1/rates/refresh', { method: 'POST' });
}
