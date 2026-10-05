import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * Relay to the auth service for channel data, on the editor's own origin.
 *
 * ---- WHY THIS EXISTS ----
 *
 * `branding-panel.tsx` fetches `/api/channels` — same-origin, because a browser
 * cannot add an `Authorization` header to a plain `fetch`, and the channel list is
 * behind auth. The editor had no such route, so the request 404'd, `channels` stayed
 * `[]`, and the panel rendered "No channels found" for every user on every project.
 * The route existed on the web app only, which the editor cannot call directly: no
 * env var points at it and it is not a declared dependency.
 *
 * So the hop that matters is done here instead: read the session cookie, turn it
 * into a bearer, and call `auth-service` directly. The editor already has
 * `AUTH_INTERNAL_URL` for exactly this in its own `session` and `presence` routes.
 *
 * ---- WHY THE UPSTREAM PATH IS BUILT HERE AND NEVER TAKEN AS INPUT ----
 *
 * A relay that forwards a caller-supplied path is an open proxy into the internal
 * network — `/api/channels/../../admin/ledger` is that bug. Every path below is a
 * literal, and the one variable part is validated as a UUID before it is
 * interpolated, so there is no string here that came from a request.
 */

const AUTH_INTERNAL_URL = process.env.AUTH_INTERNAL_URL ?? 'http://auth-service:8085';
const SESSION_COOKIE = 'wideo11_session';

/**
 * A channel id is a UUID upstream. Rejecting anything else means a crafted id can
 * never introduce a path separator, a query, or a second upstream call.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function callUpstream(upstreamPath: string, init: { method: 'GET' | 'PATCH'; body?: unknown }) {
  const session = cookies().get(SESSION_COOKIE)?.value;
  if (!session) {
    return NextResponse.json(
      { error: 'sign_in_required', message: 'Sign in to use your channel branding.' },
      { status: 401 }
    );
  }

  try {
    const res = await fetch(`${AUTH_INTERNAL_URL}${upstreamPath}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${session}`,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    });
    const payload = await res.json().catch(() => ({}));
    // The upstream status is passed through unchanged: a 403 from the service gate
    // means something specific, and flattening it to a 500 would hide it.
    return NextResponse.json(payload, { status: res.status });
  } catch {
    // The editor does not declare a dependency on auth-service, so "not up yet" is a
    // normal state. Reporting that as an auth failure would tell a signed-in user to
    // sign in again, which is not the problem.
    return NextResponse.json(
      { error: 'upstream_unavailable', message: 'Cannot reach the authentication service.' },
      { status: 503 }
    );
  }
}

/** `GET /api/v1/auth/channels` — this user's channels. */
export function relayChannelList() {
  return callUpstream('/api/v1/auth/channels', { method: 'GET' });
}

/**
 * `GET|PATCH /api/v1/auth/channels/:id/setup` — one channel's branding setup.
 *
 * Only the fields the editor owns are accepted on a PATCH. Upstream's request struct
 * has pointers for tagline, visibility, keyword lists and comment policy, and
 * forwarding an arbitrary body would let an editor request change a channel's public
 * settings. This relay is for reading, and for the logo URL.
 */
export async function relayChannelSetup(id: string, method: 'GET' | 'PATCH', request?: Request) {
  if (!UUID.test(id)) {
    return NextResponse.json({ error: 'invalid_channel_id', message: 'That channel id is not a channel id.' }, { status: 400 });
  }

  if (method === 'GET') {
    return callUpstream(`/api/v1/auth/channels/${id}/setup`, { method: 'GET' });
  }

  const body = (await request?.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_request', message: 'The body could not be read.' }, { status: 400 });
  }

  // Read back what the editor is allowed to write: the logo URL only. Everything
  // else the service accepts is channel configuration, which belongs to the
  // dashboard, not to an editor session.
  const patch: Record<string, unknown> = {};
  if (typeof body.logo_url === 'string') patch.logo_url = body.logo_url;

  if (!Object.keys(patch).length) {
    return NextResponse.json(
      { error: 'nothing_to_update', message: 'The editor can only set the logo URL.' },
      { status: 400 }
    );
  }

  return callUpstream(`/api/v1/auth/channels/${id}/setup`, { method: 'PATCH', body: patch });
}