// POST /api/convert - conversion proxy (same-origin, CORS-free)
import { forwardToCurrency } from '@/lib/currency-proxy';

export async function POST(request: Request) {
  // Raw body as-is forward karo (parse karne ki zarurat nahi)
  return forwardToCurrency('/api/v1/convert', {
    method: 'POST',
    body: await request.text(),
  });
}
