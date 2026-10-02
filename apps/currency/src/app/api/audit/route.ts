// Click/activity capture endpoint.
//
// The implementation is SHARED: `@wideo11/ui/audit-handler`. This file used to
// be a copy-paste of the same ~90 lines in every app, and it had already drifted
// into three variants - five of which reported an unreachable audit store to the
// browser as `400 Bad Request`, which looks like a client bug when it is really
// the store being down.
//
// A fix in one copy left the other six silently wrong. Now there is one
// implementation and this route is only the wiring.
//
// See the handler's header comment for the full reasoning.

import { handleClickEvents } from '@wideo11/ui/audit-handler';

export async function POST(request: Request) {
  return handleClickEvents(request);
}
