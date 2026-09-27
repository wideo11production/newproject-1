// POST /api/audit/violation - security violation receive karo
//
// Ye "staff trap" ka backend endpoint hai. Agar koi unauthorized staff/manager
// hardcoded config alter karta hai, to report yahan aata hai aur superadmin
// dashboard par RED pulsing alert flash hota hai.
//
// Hinglish comments: har block ka arth
import { NextResponse } from 'next/server';

interface Violation {
  id: string;
  timestamp: string;
  type: string;
  detail: string;
  page: string;
  userAgent: string;
}

// NOTE: same in-memory store approach audit/route.go jaisa.
// Production me proper DB chahiye.
// Hinglish: memory store - production me DB use karna chahiye
const violations: Violation[] = [];
const MAX_VIOLATIONS = 500;

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Validation - ye user-controlled input hai
    if (!body || typeof body.type !== 'string' || typeof body.detail !== 'string') {
      return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
    }

    // Detail ki length limit - log spam na ho
    const violation: Violation = {
      id: typeof body.id === 'string' ? body.id : `${Date.now()}`,
      timestamp:
        typeof body.timestamp === 'string' ? body.timestamp : new Date().toISOString(),
      // Sirf allowed types accept karo
      type: ['CONFIG_TAMPER', 'RATE_LIMIT_BYPASS_ATTEMPT', 'AUTH_FAILURE_SPIKE'].includes(
        body.type
      )
        ? body.type
        : 'CONFIG_TAMPER',
      detail: body.detail.slice(0, 500),
      page: typeof body.page === 'string' ? body.page.slice(0, 200) : 'unknown',
      userAgent:
        typeof body.userAgent === 'string' ? body.userAgent.slice(0, 200) : 'unknown',
    };

    violations.push(violation);
    while (violations.length > MAX_VIOLATIONS) {
      violations.shift();
    }

    return NextResponse.json({ recorded: true, id: violation.id });
  } catch {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }
}

// GET - violations padho (superadmin "Awareness Reports" grid consume karta hai)
export async function GET() {
  return NextResponse.json({
    total: violations.length,
    violations: violations.slice(-100),
  });
}
