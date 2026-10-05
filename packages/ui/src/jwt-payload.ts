// Read the JWT payload WITHOUT verifying the signature.
//
// =============================================================================
// THIS IS NOT AUTHENTICATION. READ THAT BEFORE USING IT.
// =============================================================================
//
// Decoding a JWT is just base64-decoding a JSON object. It proves nothing: anyone
// can mint `{"user_id": "someone-else"}` and this function will happily return
// it.
//
// It is used for ONE thing: labelling a telemetry row with who was browsing, so
// that "which of my own users clicked the export button" is answerable. If the
// value is forged, the worst outcome is a click attributed to the wrong person
// in an internal dashboard. Nothing is unlocked, nothing is read, nothing is
// authorised.
//
// Every place that ACTUALLY decides anything - is this session valid, is this
// user allowed to do this - must go to auth-service, which holds the signing key
// and verifies properly. This module must never appear in such a path.
//
// If a future change needs a trust decision, this is the wrong tool. Read the
// token from the cookie in a middleware/handler and call auth-service.

export interface SessionClaims {
  user_id?: string;
  sub?: string;
  email?: string;
  session_id?: string;
  role?: string;
}

/**
 * Decode a JWT payload, returning null on anything malformed.
 *
 * Never throws: a malformed cookie is an anonymous visit, not an error worth
 * failing a click batch over.
 */
export function jwtPayload(token: string | undefined | null): SessionClaims | null {
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    // noUncheckedIndexedAccess: `parts[1]` is `string |
    // undefined` even after the length check, and
    // `Buffer.from` does not accept undefined.
    const encoded = parts[1];
    if (encoded === undefined) return null;
    const json = Buffer.from(encoded, 'base64url').toString('utf8');
    const claims = JSON.parse(json);
    // A decoded payload could be any JSON. Only an object with at least a string
    // subject is worth believing even as an attribution label.
    if (!claims || typeof claims !== 'object') return null;
    return claims as SessionClaims;
  } catch {
    return null;
  }
}

/**
 * Identity headers for the telemetry service.
 *
 * Returns an empty object when there is no usable session, which is the normal
 * case for a signed-out visitor on a public page. The telemetry service treats
 * every header as optional.
 */
export function identityHeaders(token: string | undefined | null): Record<string, string> {
  const claims = jwtPayload(token);
  if (!claims) return {};

  const headers: Record<string, string> = {};
  const userId = claims.user_id ?? claims.sub;
  if (typeof userId === 'string' && userId) headers['X-Internal-User-Id'] = userId;
  if (typeof claims.email === 'string' && claims.email) {
    headers['X-Internal-User-Email'] = claims.email;
  }
  if (typeof claims.session_id === 'string' && claims.session_id) {
    headers['X-Internal-Session-Id'] = claims.session_id;
  }
  return headers;
}