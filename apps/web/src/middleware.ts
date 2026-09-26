import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { authRateLimitMiddleware } from '@/lib/rate-limiter';

// Ye middleware sabhi routes ko protect karta hai, sirf public routes whitelist ki gayi hain.
// Agar user unauthenticated hai aur usne protected route ki request ki, to usko /signup par redirect kardiya jata hai.
// Hinglish comments: har line ka arth samjhne ke liye.

export async function middleware(request: NextRequest) {
  // PHASE 1: Rate Limiting for Auth Routes
  // Rigid per-IP limit: 1 request per minute for registration/login
  // Second request within 60s = 429 drop + IP flag
  const rateLimitResponse = authRateLimitMiddleware(request);
  if (rateLimitResponse) {
    return rateLimitResponse; // Return 429 immediately
  }

  // Public routes jo bina authentication ke access kiye ja sakte hain
  // '/auth' add kiya gaya hai taaki /auth/register aur /auth/login pages reachable hon.
  // Pehle ye public nahi the, isliye middleware unauthenticated user ko /signup par redirect
  // kar deta tha - aur /signup exist nahi karta, to 404 loop ban jata tha.
  const publicPaths = [
    '/',
    '/auth',
    '/login',
    '/signup',
    '/api/auth',
  ]; // /api/auth bhi whitelist hai kyunki auth API routes yahan se aati hain

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

  // Agar path public nahi hai aur user authenticate nahi hai, to register page par redirect kardo
  if (!isPublicPath && !isAuthenticated) {
    // Hard redirect to register page (jo ab exist karta hai - /signup nahi)
    return NextResponse.redirect(new URL('/auth/register', request.url));
  }

  // Agar sab kuch theek hai, to age badhao
  return NextResponse.next();
}

// Middleware ko kis path par apply karna hai, ye matcher define karta hai
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (favicon)
     * - public folder
     *
     * IMPORTANT: 'api/auth' pehle is exclusion list me tha, jisse middleware
     * /api/auth/* par chala hi nahi - aur rate limiter wahan dead code ban gaya tha.
     * Ab api/auth exclude NAHI hota, taaki registration/login API requests bhi
     * 1-request-per-IP-per-minute defense barrier ke through jaayein.
     * Ye auth API routes publicPaths me hain, isliye auth redirect nahi hoga -
     * sirf rate limiter active rahega. (Rate limiter lib khud intact hai, koi badlav nahi.)
     */
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
};
