// ============================================================================
// Session / gate state - server-side session probe
// ============================================================================
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const AUTH_INTERNAL_URL =
  process.env.AUTH_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_AUTH_API_URL ??
  "http://localhost:8085";

const SESSION_COOKIE = "wideo11_session";

export const dynamic = "force-dynamic";

const MAX_FPS_CAPABILITY = "max_fps";
const FALLBACK_MAX_FPS = 60;

async function readPlan(authHeaders: Record<string, string>) {
  const fallback = { plan: "", planName: "", maxFps: FALLBACK_MAX_FPS };
  try {
    const res = await fetch(`${AUTH_INTERNAL_URL}/api/v1/auth/me/entitlements`, {
      headers: authHeaders,
      cache: "no-store",
    });
    if (!res.ok) return fallback;
    const body = (await res.json().catch(() => null)) as any;
    if (!body) return fallback;

    const raw = body.limits?.[MAX_FPS_CAPABILITY];
    const n = typeof raw === "string" ? Number(raw) : raw;
    return {
      plan: typeof body.plan === "string" ? body.plan : "",
      planName: typeof body.plan_name === "string" ? body.planName : "",
      maxFps: typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : FALLBACK_MAX_FPS,
    };
  } catch {
    return fallback;
  }
}

export async function GET() {
  const noStore = { "Cache-Control": "no-store" } as const;
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ state: "out" }, { headers: noStore });
  }

  const authHeaders = { Authorization: `Bearer ${token}` };
  let profile: any = null;
  let setupComplete = false;

  try {
    const [profileRes, setupRes] = await Promise.all([
      fetch(`${AUTH_INTERNAL_URL}/api/v1/auth/profile`, { headers: authHeaders, cache: "no-store" }),
      fetch(`${AUTH_INTERNAL_URL}/api/v1/auth/security/setup-status`, { headers: authHeaders, cache: "no-store" }),
    ]);

    if (profileRes.status === 401 || setupRes.status === 401) {
      return NextResponse.json({ state: "out" }, { headers: noStore });
    }
    if (profileRes.ok) {
      profile = await profileRes.json().catch(() => null);
    }
    if (setupRes.ok) {
      const setup = await setupRes.json().catch(() => null);
      setupComplete = setup?.setup_complete === true;
    }
  } catch {
    return NextResponse.json({ state: "out", error: "auth service unreachable" }, { headers: noStore });
  }

  if (!profile?.email) {
    return NextResponse.json({ state: "out" }, { headers: noStore });
  }

  const email = profile.email;
  if (profile.is_active === false) {
    return NextResponse.json({ state: "out" }, { headers: noStore });
  }
  if (profile.is_verified !== true) {
    return NextResponse.json({ state: "needs_verification", email, avatarUrl: profile.avatar_url ?? "" }, { headers: noStore });
  }
  if (!setupComplete) {
    return NextResponse.json({ state: "needs_setup", email, avatarUrl: profile.avatar_url ?? "" }, { headers: noStore });
  }

  let plan = await readPlan(authHeaders);
  const isSuperadmin = profile.role === "superadmin" || email.toLowerCase().trim() === "advchashampalup@gmail.com";
  if (isSuperadmin) {
    plan = {
      ...plan,
      plan: plan.plan || "lifetime_aura",
      planName: plan.planName || "Lifetime AURA",
      maxFps: 240,
    };
  }

  return NextResponse.json(
    {
      state: "ready",
      email,
      role: profile.role ?? "user",
      avatarUrl: profile.avatar_url ?? "",
      ...plan,
    },
    { headers: noStore }
  );
}

export async function DELETE() {
  const noStore = { "Cache-Control": "no-store" } as const;
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ ok: true }, { headers: noStore });
  try {
    await fetch(`${AUTH_INTERNAL_URL}/api/v1/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {}
  return NextResponse.json({ ok: true }, { headers: noStore });
}
