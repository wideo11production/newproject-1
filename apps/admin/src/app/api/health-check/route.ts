// Dependency health.
//
// The implementation is SHARED: `@wideo11/ui/health-handler`. This route used to
// be a copy-paste of the same 55 lines in `apps/web`, and BOTH copies leaked
// internal service names, internal hostnames and a port map to any unauthenticated
// caller - because both were listed in `publicApiPrefixes`.
//
// Docker's liveness check does NOT use this route. It uses `/api/live`, which is
// deliberately dependency-free; see the handler's header for why the two must not
// be the same endpoint.
//
// Requires a session. Opened here? That is an edit in this app's middleware, not
// in this file - which is the point.

import { handleDependencyHealth } from '@wideo11/ui/health-handler';

export async function GET() {
  return handleDependencyHealth();
}