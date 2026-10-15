// Default fallback for the @dashboard parallel route slot.
//
// Falls back to rendering the DashboardRoute panel (same as page.tsx)
// so the slot is never empty if mounted.

import DashboardRoute from './page';

export default function DashboardSlotDefault() {
  return <DashboardRoute />;
}
