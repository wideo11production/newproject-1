// Rate Limiter Utility - Adaptive Per-IP Registration Limit
// Strict 1 request per IP per minute for registration and login routes
// Adaptive: If unauthenticated surge detected -> 429 + IP flag
// If authenticated load increasing -> allow scale-out, ignore individual pod limits
// Human-paced registration only entry point allowed

import { NextRequest, NextResponse } from 'next/server';

// In-memory store for rate limiting (production: use Redis)
// Map: IP -> { count: number, windowStart: number, flagged: boolean, isAuthenticated: boolean }
interface RateLimitData {
  count: number;
  windowStart: number;
  flagged: boolean;
  lastRequest: number;
  isAuthenticated: boolean;
  surgeCount: number; // Track surge attempts
}

const rateLimitStore = new Map<string, RateLimitData>();

// Global metrics for adaptive scaling (in production: use Prometheus/Redis)
let globalMetrics = {
  totalRequests: 0,
  authRequests: 0,
  unauthRequests: 0,
  flaggedIPs: 0,
  surgeDetected: false,
  authLoadIncreasing: false,
};

// Cleanup interval: remove expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  // Use Array.from to avoid Map iterator downlevelIteration issue
  Array.from(rateLimitStore.entries()).forEach(([ip, data]) => {
    if (now - data.windowStart > 60000) { // 60 second window expired
      rateLimitStore.delete(ip);
    }
  });
}, 5 * 60 * 1000);

// Update global metrics for adaptive scaling decisions
function updateGlobalMetrics(isAuthenticated: boolean, isSurge: boolean) {
  globalMetrics.totalRequests++;
  if (isAuthenticated) {
    globalMetrics.authRequests++;
  } else {
    globalMetrics.unauthRequests++;
  }
  if (isSurge) {
    globalMetrics.surgeDetected = true;
    globalMetrics.flaggedIPs++;
  }
  // Calculate auth ratio for scaling decisions
  const authRatio = globalMetrics.totalRequests > 0 
    ? globalMetrics.authRequests / globalMetrics.totalRequests 
    : 1;
  globalMetrics.authLoadIncreasing = authRatio > 0.6; // 60% auth threshold
}

/**
 * RATE LIMIT CONFIG - per route type
 *
 * ---- YE VALUES KABHI 1/60s NAHI HONI CHAHIYE ----
 * Pehle yahan hardcoded `if (rateData.count > 1)` tha, yaani 60 second
 * me DOOSRA request hi 429 "Too many attempts" throw kar deta tha.
 *
 * Ye real users ko lock kar raha tha, sirf bots ko nahi:
 *   register (1st) -> email kholo -> verify link click (2nd) = 429
 *   galat password -> sahi password retry                  = 429
 * Matlab ek normal signup flow hi break ho jata tha. User ne ise
 * "Too many attempts" error ke roop me report kiya.
 *
 * ---- NAYA APPROACH ----
 * Har route type ka apna budget hai. Credential stuffing defense ZAROORI
 * hai, par budget aisa hona chahiye jo legit user ko block na kare:
 *
 *   registration : 3 per 5 min  (mass account creation rokna hai - strict)
 *   login        : 8 per min    (typo + retry allowed, brute force nahi)
 *   verify       : 10 per min   (link clicks safe hain; user multiple
 *                                baar click kar sakta hai)
 *   auth (other) : 20 per min   (webauthn ceremonies etc.)
 *
 * Verify ko alag (generous) bucket dena zaroori hai kyunki:
 *   - verification link email client me click hota hai (guaranteed follow-up)
 *   - 30-min token window hai; user ko baar baar try karne ka option milna
 *     chahiye warna koi genuine miss hone par account permanently purge ho
 *     jayega (aur resend ka koi route nahi hai)
 *
 * Window bhi per-route rakha hai - registration ka 5-minute window ek
 * 5-minute timer use karta hai, baaki 1-minute.
 */
const RATE_LIMITS: Record<
  'registration' | 'login' | 'auth' | 'verify',
  { max: number; windowMs: number }
> = {
  registration: { max: 3, windowMs: 5 * 60 * 1000 },
  login: { max: 8, windowMs: 60 * 1000 },
  verify: { max: 10, windowMs: 60 * 1000 },
  auth: { max: 20, windowMs: 60 * 1000 },
};

/**
 * Get adaptive scaling decision for GKE
 * Returns true if scaling should proceed based on auth load
 */
export function shouldScaleGKE(): boolean {
  const authRatio = globalMetrics.totalRequests > 0 
    ? globalMetrics.authRequests / globalMetrics.totalRequests 
    : 1;
  // Scale if auth load is increasing legitimately (auth ratio > 60%)
  // Ignore individual pod limits when auth load is genuinely increasing
  return globalMetrics.authLoadIncreasing && !globalMetrics.surgeDetected;
}

/**
 * Check and enforce adaptive rate limit for authentication routes
 * Returns NextResponse with 429 if limit exceeded, null if allowed
 *
 * @param request - Incoming NextRequest
 * @param routeType - route bucket (drives max + window)
 * @param isAuthenticated - Whether the request has valid auth
 * @returns NextResponse | null
 */
export function checkAuthRateLimit(
  request: NextRequest,
  routeType: 'registration' | 'login' | 'auth' | 'verify',
  isAuthenticated: boolean = false
): NextResponse | null {
  // Get client IP - check headers for proxy/load balancer
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIP = request.headers.get('x-real-ip');
  const clientIP = forwardedFor?.split(',')[0]?.trim() || realIP || request.ip || 'unknown';

  // Rate limit key: IP + route type for granular control
  const rateLimitKey = `${clientIP}:${routeType}`;
  const now = Date.now();
  const { max, windowMs } = RATE_LIMITS[routeType];
  
  // Get or create rate limit data for this IP
  let rateData = rateLimitStore.get(rateLimitKey);
  
  if (!rateData) {
    // First request - initialize window
    rateData = {
      count: 0,
      windowStart: now,
      flagged: false,
      lastRequest: now,
      isAuthenticated,
      surgeCount: 0,
    };
    rateLimitStore.set(rateLimitKey, rateData);
  }
  
  // Check if current window has expired
  if (now - rateData.windowStart > windowMs) {
    // Window expired - reset for new window
    rateData.count = 0;
    rateData.windowStart = now;
    rateData.flagged = false;
    rateData.surgeCount = 0;
  }
  
  // Update authentication status
  rateData.isAuthenticated = isAuthenticated;
  
  // Increment request count
  rateData.count++;
  rateData.lastRequest = now;
  
  // Check for surge: multiple requests from same IP in short time
  // NOTE: abhi surge tabhi maana jaata hai jab budget ACTUALLY cross ho,
  // na ki har doosre request pe (pehle `count > 1` tha - bahut aggressive).
  const isSurge = rateData.count > max && !isAuthenticated;
  if (isSurge) {
    rateData.surgeCount++;
  }
  
  // Update global metrics for adaptive scaling
  updateGlobalMetrics(isAuthenticated, isSurge);
  
  // ADAPTIVE LIMIT: 
  // 1. If unauthenticated surge -> 429 + flag IP + drop connection
  // 2. If authenticated load increasing -> allow (GKE will scale)
  
  if (rateData.count > max) {
    // Flag the IP for suspicious activity
    rateData.flagged = true;
    
    if (!isAuthenticated) {
      // BUDGET CROSSED: 429 + flag IP
      // Log the violation for security monitoring
      console.warn(`[RATE-LIMIT] SURGE: IP ${clientIP} exceeded limit on ${routeType} route. Count: ${rateData.count}/${max}, Flagged: true`);
      
      const retryAfterSec = Math.ceil(windowMs / 1000);
      
      // Return 429 Too Many Requests with Retry-After header
      const response = NextResponse.json(
        { 
          error: 'Too Many Requests', 
          message: `Too many ${routeType} attempts from this network. Please wait ${retryAfterSec} seconds and try again.`,
          retryAfter: retryAfterSec,
          surgeDetected: true,
          defenseBarrier: true
        },
        { 
          status: 429,
          headers: {
            'Retry-After': retryAfterSec.toString(),
            'X-RateLimit-Limit': max.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': Math.ceil((rateData.windowStart + windowMs) / 1000).toString(),
            'X-Defense-Barrier': 'activated',
            'X-Surge-Detected': 'true'
          }
        }
      );
      
      return response;
    } else {
      // AUTHENTICATED LOAD INCREASING: Allow request, GKE will scale out
      // Ignore standard individual pod limits for legitimate auth load
      console.log(`[RATE-LIMIT] AUTHENTICATED LOAD: IP ${clientIP} on ${routeType}. Auth load increasing - GKE will scale out.`);
      
      // Update global metrics to trigger GKE scaling
      globalMetrics.authLoadIncreasing = true;
      globalMetrics.surgeDetected = false;
      
      // Allow request with headers indicating GKE should scale
      return null;
    }
  }
  
  // Request allowed - add rate limit headers
  const response = null;
  return response;
}

/**
 * Middleware wrapper for authentication routes with adaptive rate limiting
 * Applies adaptive limit to registration, login, and auth endpoints
 * 
 * @param request - Incoming NextRequest
 * @returns NextResponse | null (null = continue)
 */
export function authRateLimitMiddleware(request: NextRequest): NextResponse | null {
  const path = request.nextUrl.pathname;
  
  // Check if request has valid authentication token
  const authHeader = request.headers.get('authorization');
  const hasAuth = !!authHeader && authHeader.startsWith('Bearer ');
  
  // Check if this is an authentication route
  if (path.startsWith('/api/auth/register') || path.startsWith('/api/auth/signup')) {
    return checkAuthRateLimit(request, 'registration', hasAuth);
  }
  
  if (path.startsWith('/api/auth/login') || path.startsWith('/api/auth/signin')) {
    return checkAuthRateLimit(request, 'login', hasAuth);
  }
  
  // ---- VERIFY + RESEND: generous bucket ----
  // Ye pehle generic 'auth' bucket me jate the. Ab inka apna bucket hai
  // kyunki:
  //   - verification email link browser me click hoti hai (guaranteed
  //     follow-up request)
  //   - 30-min token window hai; user ko retry karne dena zaroori hai
  //   - resend bhi isi bucket se guzarta hai (legit action hai)
  if (
    path.startsWith('/api/auth/verify') ||
    path.startsWith('/api/auth/resend')
  ) {
    return checkAuthRateLimit(request, 'verify', hasAuth);
  }
  
  if (path.startsWith('/api/auth/') && !path.startsWith('/api/auth/callback')) {
    // Other auth endpoints (except OAuth callbacks)
    return checkAuthRateLimit(request, 'auth', hasAuth);
  }
  
  // Not an auth route - continue
  return null;
}

/**
 * Get rate limit status for an IP (for monitoring/dashboard)
 * Used by custom dashboard to display flagged IPs
 */
export function getRateLimitStatus(ip: string): { 
  registration: { count: number; flagged: boolean; windowStart: number; isAuthenticated: boolean; surgeCount: number } | null;
  login: { count: number; flagged: boolean; windowStart: number; isAuthenticated: boolean; surgeCount: number } | null;
  auth: { count: number; flagged: boolean; windowStart: number; isAuthenticated: boolean; surgeCount: number } | null;
} {
  const reg = rateLimitStore.get(`${ip}:registration`) || null;
  const log = rateLimitStore.get(`${ip}:login`) || null;
  const auth = rateLimitStore.get(`${ip}:auth`) || null;
  
  return { registration: reg, login: log, auth: auth };
}

/**
 * Get global adaptive metrics for GKE scaling decisions
 */
export function getGlobalAdaptiveMetrics() {
  return {
    ...globalMetrics,
    authRatio: globalMetrics.totalRequests > 0 
      ? globalMetrics.authRequests / globalMetrics.totalRequests 
      : 1,
    shouldScale: shouldScaleGKE(),
  };
}

/**
 * Clear rate limit for an IP (admin action)
 */
export function clearRateLimit(ip: string): void {
  // Use Array.from to avoid Map iterator downlevelIteration issue
  Array.from(rateLimitStore.keys()).forEach((key) => {
    if (key.startsWith(`${ip}:`)) {
      rateLimitStore.delete(key);
    }
  });
}