// GET /api/rates - currency rates proxy (same-origin, CORS-free)
import { forwardToCurrency } from '@/lib/currency-proxy';

export async function GET() {
  return forwardToCurrency('/api/v1/rates');
}
