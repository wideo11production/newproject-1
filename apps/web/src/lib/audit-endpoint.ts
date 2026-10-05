// The single click-collection endpoint, in one place.
//
// This exists because there were two spellings of it. `audit-tracking.ts` had
// `/api/audit` hardcoded; `@wideo11/ui/activity-tracker` had
// `NEXT_PUBLIC_AUDIT_ENDPOINT ?? '/api/audit'`. Both resolve to the same route
// today, which is exactly why nobody noticed, and exactly why a change to one
// would have left the other pointing at nothing.
//
// Bracket access `['...']` rather than dot, because this app's tsconfig sets
// `noPropertyAccessFromIndexSignature` and dot notation is error TS4111.
export const API_ENDPOINT = process.env['NEXT_PUBLIC_AUDIT_ENDPOINT'] ?? '/api/audit';