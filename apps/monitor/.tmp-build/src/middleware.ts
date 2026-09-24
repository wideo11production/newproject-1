import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

// Ye middleware sabhi routes ko protect karta hai, sirf public routes whitelist ki gayi hain.
// Agar user unauthenticated hai aur usne protected route ki request ki, to usko /signup par redirect kardiya jata hai.
// Hinglish comments: har line ka arth samjhne ke liye.

export async function middleware(request: NextRequest) {
  // Public routes jo bina authentication ke access kiye ja sakte hain
  const publicPaths = ['/', '/login', '/signup', '/api/auth']; // /api/auth ko bhi whitelist kiya hai kyunki Next-Auth ke routes yahan se guzarte hain

  // Check karta hai ki request ka path public path mein se koi hai ya nahi
  const isPublicPath = publicPaths.some((path) =>
    request.nextUrl.pathname.startsWith(path)
  );

  // Get token using next-auth/jwt (works in middleware)
  const token = await getToken({ 
    req: request,
    secret: process.env.NEXTAUTH_SECRET
  });

  const isAuthenticated = !!token;

  // Agar path public nahi hai aur user authenticate nahi hai, to /signup par redirect kardo
  if (!isPublicPath && !isAuthenticated) {
    // Hard redirect to signup page
    return NextResponse.redirect(new URL('/signup', request.url));
  }

  // Agar sab kuch theek hai, to age badhao
  return NextResponse.next();
}

// Middleware ko kis path par apply karna hai, ye matcher define karta hai
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth (Next-Auth)
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (favicon)
     * - public folder
     */
    '/((?!api/auth|_next/static|_next/image|favicon.ico|public).*)',
  ],
};
