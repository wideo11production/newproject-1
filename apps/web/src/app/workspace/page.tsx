// ============================================================================
// WORKSPACE PAGE — /workspace
// ============================================================================
//
// Unified workspace with 6 lazy-loaded tabs in a single responsive sidebar.
// This replaces the old dashboard's hardcoded page with a role-aware,
// lazy-loaded multi-view workspace.
//
// Hinglish: har tab ek alag chunk me load hota hai (React.lazy + Suspense).
// User role + subscriber status se tabs automatically show/hide hote hain.
//
// Backend integration:
//   - Overview / Ledger → billing-service settlement API
//   - AURA Studio → user-service student verification API
//   - Creator Broadcast → upload-service quota + safety API
//   - Commercial Console → ads-service geofencing API

'use client';

import { WorkspaceSidebar } from '@/components/workspace/workspace-sidebar';
import { useSessionIdentity } from '@/lib/identity-context';
import { Suspense } from 'react';

import {
  grafanaBg,
  grafanaText,
  grafanaTextMuted,
} from '@wideo11/ui/design-system';

// Fallback shown while a tab's code chunk loads.
function WorkspaceLoading() {
  return (
    <div className={`flex items-center justify-center gap-3 p-8 ${grafanaTextMuted}`}>
      <div className="h-2.5 w-2.5 animate-spin rounded-full-transparent" />
      <span>Loading workspace...</span>
    </div>
  );
}

export default function WorkspacePage() {
  const identity = useSessionIdentity();

  // Determine user's role + monetization status for tab visibility.
  // Hinglish: ye values session identity se aate hain (auth-service se).
  // Agar unavailable ho to default "creator" maanenge.
  const userRole = (identity.professional_role as 'student' | 'creator' | 'monetized') || 'creator';
  const isSubscriber = identity.is_subscribed || false;
  const hasRevenue = (identity.total_revenue ?? 0) > 0;

  return (
    <div className={`flex min-h-screen ${grafanaBg} ${grafanaText}`}>
      <Suspense fallback={<WorkspaceLoading />}>
        <WorkspaceSidebar
          userRole={userRole}
          isSubscriber={isSubscriber}
          hasRevenue={hasRevenue}
        />
      </Suspense>
    </div>
  );
}
