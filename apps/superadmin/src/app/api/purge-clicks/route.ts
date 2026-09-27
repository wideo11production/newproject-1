import { forward } from '@/lib/proxy';

export async function POST(request: Request) {
  return forward('/admin/clicks/purge', request, 'POST');
}
