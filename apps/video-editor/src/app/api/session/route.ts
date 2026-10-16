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
const EXPORT_HEIGHT_CAPABILITY = "export_height";
const CONCURRENT_TRANSCODES_CAPABILITY = "concurrent_transcodes";
const MEDIA_ASSETS_CAPABILITY = "media_assets";
const REEL_ASSETS_CAPABILITY = "reel_assets";
const SAVE_PROJECTS_CAPABILITY = "save_projects";
const MONETIZATION_CAPABILITY = "monetization";

const FALLBACK_MAX_FPS = 60;
const FALLBACK_EXPORT_HEIGHT = 720;
const FALLBACK_CONCURRENT_TRANSCODES = 1;
const FALLBACK_MEDIA_ASSETS = 0;
const FALLBACK_REEL_ASSETS = 0;
const FALLBACK_SAVE_PROJECTS = 0;
const FALLBACK_MONETIZATION = 0;

interface PlanLimits {
  maxFps: number;
  exportHeight: number;
  concurrentTranscodes: number;
  mediaAssets: number;
  reelAssets: number;
  saveProjects: number;
  monetization: boolean;
}

function readPlanLimits(raw: any): PlanLimits {
  const limits = raw?.limits ?? {};
  const toNum = (v: unknown, def: number): number => {
    const n = typeof v === "string" ? Number(v) : v;
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : def;
  };
  return {
    maxFps: toNum(limits[MAX_FPS_CAPABILITY], FALLBACK_MAX_FPS),
    exportHeight: toNum(limits[EXPORT_HEIGHT_CAPABILITY], FALLBACK_EXPORT_HEIGHT),
    concurrentTranscodes: toNum(
      limits[CONCURRENT_TRANSCODES_CAPABILITY],
      FALLBACK_CONCURRENT_TRANSCODES
    ),
    mediaAssets: toNum(limits[MEDIA_ASSETS_CAPABILITY], FALLBACK_MEDIA_ASSETS),
    reelAssets: toNum(limits[REEL_ASSETS_CAPABILITY], FALLBACK_REEL_ASSETS),
    saveProjects: toNum(limits[SAVE_PROJECTS_CAPABILITY], FALLBACK_SAVE_PROJECTS),
    monetization: toNum(limits[MONETIZATION_CAPABILITY], FALLBACK_MONETIZATION) > 0,
  };
}

async function readPlan(authHeaders: Record<string, string>) {
  const fallback = {
    plan: "",
    planName: "",
    ...readPlanLimits(null),
  };
  try {
    const res = await fetch(`${AUTH_INTERNAL_URL}/api/v1/auth/me/entitlements`, {
      headers: authHeaders,
      cache: "no-store",
    });
    if (!res.ok) return fallback;
    const body = (await res.json().catch(() => null)) as any;
    if (!body) return fallback;

    const limits = readPlanLimits(body.limits);
    return {
      plan: typeof body.plan === "string" ? body.plan : "",
      planName: typeof body.plan_name === "string" ? body.planName : "",
      ...limits,
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
      exportHeight: 2160,
      concurrentTranscodes: 8,
      mediaAssets: -1,
      reelAssets: -1,
      saveProjects: -1,
      monetization: true,
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
