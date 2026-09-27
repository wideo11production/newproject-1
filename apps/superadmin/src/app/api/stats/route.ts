import { forward } from '@/lib/proxy';

export async function GET(request: Request) {
  return forward('/admin/clicks/stats', request);
}
