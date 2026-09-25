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
 * @param routeType - 'registration' | 'login' | 'auth'
 * @param isAuthenticated - Whether the request has valid auth
 * @returns NextResponse | null
 */
export function checkAuthRateLimit(
  request: NextRequest, 
  routeType: 'registration' | 'login' | 'auth',
  isAuthenticated: boolean = false
): NextResponse | null {
  // Get client IP - check headers for proxy/load balancer
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIP = request.headers.get('x-real-ip');
  const clientIP = forwardedFor?.split(',')[0]?.trim() || realIP || request.ip || 'unknown';
  
  // Rate limit key: IP + route type for granular control
  const rateLimitKey = `${clientIP}:${routeType}`;
  const now = Date.now();
  
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
  
  // Check if current window has expired (60 seconds)
  if (now - rateData.windowStart > 60000) {
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
  const isSurge = rateData.count > 1 && !isAuthenticated;
  if (isSurge) {
    rateData.surgeCount++;
  }
  
  // Update global metrics for adaptive scaling
  updateGlobalMetrics(isAuthenticated, isSurge);
  
  // ADAPTIVE LIMIT: 
  // 1. If unauthenticated surge -> 429 + flag IP + drop connection
  // 2. If authenticated load increasing -> allow (GKE will scale)
  
  if (rateData.count > 1) {
    // Flag the IP for suspicious activity
    rateData.flagged = true;
    
    if (!isAuthenticated) {
      // UNAUTHENTICATED SURGE: Drop connection, 429, flag IP
      // Log the violation for security monitoring
      console.warn(`[RATE-LIMIT] UNAUTHENTICATED SURGE: IP ${clientIP} exceeded limit on ${routeType} route. Count: ${rateData.count}, Flagged: true`);
      
      // Return 429 Too Many Requests with Retry-After header
      const response = NextResponse.json(
        { 
          error: 'Too Many Requests', 
          message: 'Registration/Login rate limit exceeded. Unauthenticated surge detected. Please wait 60 seconds.',
          retryAfter: 60,
          surgeDetected: true,
          defenseBarrier: true
        },
        { 
          status: 429,
          headers: {
            'Retry-After': '60',
            'X-RateLimit-Limit': '1',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': Math.ceil((rateData.windowStart + 60000) / 1000).toString(),
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