'use client';

/**
 * ============================================================================
 * WORKSPACE SIDEBAR — unified responsive sidebar with 6 role-mapped tabs.
 * ============================================================================
 *
 * Ye sidebar sabasepe user directive ke 6 required tabs ko render karta hai:
 *
 *   1. 📊 Workspace Overview  → Universal landing (all roles)
 *   2. 🎥 WideoCut Editor      → Video editing canvas (external app)
 *   3. 🎓 AURA Studio          → Student verification gate (user-service dual-gate)
 *   4. 📦 Creator Broadcast    → Upload-service volume check + content safety
 *   5. 📢 Commercial Console   → Ads-service geofencing tracker
 *   6. 💰 Financial Ledger     → 5% sister split ledger rules + GST reporting
 *
 * RESPONSIVE STRATEGY:
 *   - Desktop (lg+): expanded sidebar with icon + label
 *   - Tablet: collapsed icon-rail
 *   - Mobile (<lg): hidden, slide-in drawer via FAB button
 *
 * LAZY LOADING:
 *   - Har view component React.lazy + Suspense wrapped hai (zero bundle bloat).
 *   - Only the active view chunk loads; others stay as SSR fallback skeletons.
 *
 * Role-based visibility:
 *   - AURA Studio: sirf "student" role ke liye visible
 *   - Financial Ledger: sirf "monetized" creators (subscriber or revenue > 0)
 *   - Commercial Console: sirf subscribed creators
 *   - Baaki sab sabke liye visible
 *
 * Hinglish comments: har block ka full arth.
 *
 * BORDERLESS DESIGN: Ye sidebar hard borders se hai azad - visual separation
 * bg color contrast se hota hai (bg-[#181b1f] sidebar, bg-[#1a1a1a] separators).
 * Koi bhi/border-b/border-t class nahi hai. Saare interactive elements
 * rounded-md geometry pe hain aur 150ms color transitions use karte hain.
 * Active/hover states bg-[#1f2227] ya orange-red (#ff6500) se hote hain,
 * koi ring/border nahi.
 */

import { lazy, Suspense, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Play,
  GraduationCap,
  Upload,
  Megaphone,
  Wallet,
  ChevronsLeft,
  ChevronsRight,
  Menu,
  X,
  Monitor,
  CreditCard,
  HelpCircle,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@wideo11/ui/lib/utils';
import { BrandCharacterAnimation } from '@/components/brand-character-animation';

// ---------------------------------------------------------------------------
// Lazy-loaded view components — sabhi separately chunk hote hain.
// Suspense fallback = skeleton loader (spinner + grey boxes).
// Hinglish: import() ke through dynamically load hota hai — sirf tab
// select hone par network request bhejta hai.
// ---------------------------------------------------------------------------

const WorkspaceOverview = lazy(() =>
  import('@/components/workspace/views/overview').then((m) => ({ default: m.WorkspaceOverviewView }))
);
const WideoCutEditor = lazy(() =>
  import('@/components/workspace/views/widiocut-editor').then((m) => ({ default: m.WideoCutEditorView }))
);
const AuraStudio = lazy(() =>
  import('@/components/workspace/views/aura-studio').then((m) => ({ default: m.AuraStudioView }))
);
const AuraFramerate = lazy(() =>
  import('@/components/workspace/views/aura-framerate').then((m) => ({ default: m.AuraFramerateView }))
);
const CreatorBroadcast = lazy(() =>
  import('@/components/workspace/views/creator-broadcast').then((m) => ({ default: m.CreatorBroadcastView }))
);
const CommercialConsole = lazy(() =>
  import('@/components/workspace/views/commercial-console').then((m) => ({ default: m.CommercialConsoleView }))
);
const FinancialLedger = lazy(() =>
  import('@/components/workspace/views/financial-ledger').then((m) => ({ default: m.FinancialLedgerView }))
);
const SubscriptionHub = lazy(() =>
  import('@/components/workspace/views/subscription-hub').then((m) => ({ default: m.SubscriptionHubView }))
);
const MicroFrameGuide = lazy(() =>
  import('@/components/workspace/views/help/micro-frame-guide').then((m) => ({ default: m.MicroFrameGuide }))
);

// ---------------------------------------------------------------------------
// Tab definition type
// ---------------------------------------------------------------------------

export type WorkspaceTabId =
  | 'overview'
  | 'editor'
  | 'aura'
  | 'framerate'
  | 'broadcast'
  | 'commercial'
  | 'ledger'
  | 'subscription'
  | 'help-micro-frame';

export type WorkspaceTab = {
  id: WorkspaceTabId;
  label: string;
  icon: React.ReactNode;
  // Visible roles: 'all' | 'student' | 'creator' | 'monetized' | 'subscriber'
  visibleFor: 'all' | 'student' | 'creator' | 'monetized' | 'subscriber';
  // href for non-lazy navigation (editor opens in new tab).
  external?: boolean;
  href?: string;
};

// ---------------------------------------------------------------------------
// Tab registry — user directive ke 6 tabs.
// Hinglish: har tab ka mapping:
//   - overview: sabke liye (universal landing)
//   - editor: video editor external app
//   - aura: student verification (user-service Gate A/B)
//   - broadcast: upload + quota + safety (upload-service)
//   - commercial: ad revenue tracker (ads-service geofencing)
//   - ledger: 5% sister split + GST reporting (billing-service settlement)
// ---------------------------------------------------------------------------

export const WORKSPACE_TABS: WorkspaceTab[] = [
  {
    id: 'overview',
    label: 'Workspace Overview',
    icon: <LayoutDashboard className="h-2.5 w-2.5" />,
    visibleFor: 'all',
  },
  {
    id: 'editor',
    label: 'WideoCut Editor',
    icon: <Play className="h-2.5 w-2.5" />,
    visibleFor: 'all',
    external: true,
    href: process.env.NEXT_PUBLIC_VIDEO_EDITOR_URL ?? 'http://localhost:3002',
  },
  {
    id: 'aura',
    label: 'AURA Studio',
    icon: <GraduationCap className="h-2.5 w-2.5" />,
    visibleFor: 'student',
  },
  {
    id: 'framerate',
    label: 'AURA Premium Framerate',
    icon: <Monitor className="h-2.5 w-2.5" />,
    visibleFor: 'creator',
  },
  {
    id: 'broadcast',
    label: 'Creator Broadcast Pack',
    icon: <Upload className="h-2.5 w-2.5" />,
    visibleFor: 'creator',
  },
  {
    id: 'commercial',
    label: 'Commercial Console',
    icon: <Megaphone className="h-2.5 w-2.5" />,
    visibleFor: 'monetized',
  },
  {
    id: 'ledger',
    label: 'Financial Ledger Hub',
    icon: <Wallet className="h-2.5 w-2.5" />,
    visibleFor: 'monetized',
  },
  {
    id: 'subscription',
    label: 'Subscription Hub',
    icon: <CreditCard className="h-2.5 w-2.5" />,
    visibleFor: 'creator',
  },
];

// ---------------------------------------------------------------------------
// View component map — tab ID se lazy component map.
// ---------------------------------------------------------------------------

const TAB_VIEWS: Record<Exclude<WorkspaceTab['id'], 'editor'>, React.LazyExoticComponent<React.FC>> = {
  overview: WorkspaceOverview,
  aura: AuraStudio,
  framerate: AuraFramerate,
  broadcast: CreatorBroadcast,
  commercial: CommercialConsole,
  ledger: FinancialLedger,
  subscription: SubscriptionHub,
  'help-micro-frame': MicroFrameGuide,
};

// ---------------------------------------------------------------------------
// Skeleton fallback for Suspense
// ---------------------------------------------------------------------------

function ViewSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="h-8 w-48 animate-pulse rounded bg-[#1f2227]" />
      <div className="space-y-3">
        <div className="h-4 w-full max-w-3xl animate-pulse rounded bg-[#1f2227]" />
        <div className="h-4 w-full max-w-2xl animate-pulse rounded bg-[#1f2227]" />
        <div className="h-4 w-full max-w-xl animate-pulse rounded bg-[#1f2227]" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type WorkspaceSidebarProps = {
  // User role for tab visibility filtering.
  userRole?: 'student' | 'creator' | 'monetized' | 'subscriber';
  // Is user a subscriber (for Commercial Console + Editor)?
  isSubscriber?: boolean;
  // Has user earned revenue > 0 (for Financial Ledger)?
  hasRevenue?: boolean;
};

export function WorkspaceSidebar({
  userRole = 'creator',
  isSubscriber = false,
  hasRevenue = false,
}: WorkspaceSidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkspaceTabId>('overview');
  const [helpOpen, setHelpOpen] = useState(false);

  // Determine which tabs are visible for this user.
  const visibleTabs = WORKSPACE_TABS.filter((tab) => {
    if (tab.visibleFor === 'all') return true;
    if (tab.visibleFor === 'student') return userRole === 'student';
    if (tab.visibleFor === 'creator') return userRole === 'student' || userRole === 'creator';
    if (tab.visibleFor === 'monetized') return isSubscriber || hasRevenue;
    if (tab.visibleFor === 'subscriber') return isSubscriber;
    return true;
  });

  // Route change → close mobile sidebar.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      try {
        window.localStorage.setItem('wideo11.workspace.collapsed', prev ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !prev;
    });
  };

  const isActive = (id: WorkspaceTabId): boolean => {
    return activeTab === id;
  };

  // Handle tab click.
  const handleTabClick = (tab: WorkspaceTab) => {
    if (tab.external && tab.href) {
      window.open(tab.href, '_blank', 'noopener,noreferrer');
      return;
    }
    setActiveTab(tab.id);
    // Update URL hash without full page reload.
    if (!tab.external) {
    window.history.pushState(null, '', `/workspace#${tab.id}`);
    }
  };

  // On mount, check URL hash for initial tab.
  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash && visibleTabs.some((t) => t.id === hash as WorkspaceTabId)) {
      setActiveTab(hash as WorkspaceTabId);
    }
  }, []);

  // Render the active view.
  const renderActiveView = () => {
    if (activeTab === 'editor') {
      // External — handled by new tab on click.
      return (
        <div className="p-6">
          <p className="text-[#9fa7b3]">
            The WideoCut Editor opens in a new tab. Use the sidebar button to launch it.
          </p>
        </div>
      );
    }

    const ViewComponent = TAB_VIEWS[activeTab as keyof typeof TAB_VIEWS];
    if (!ViewComponent) {
      return (
        <div className="flex flex-col items-center justify-center p-6 text-center">
          <BrandCharacterAnimation
            character="rino"
            size="lg"
            message="Nothing here yet. Select a tab from the sidebar to get started."
            action="Explore"
            onAction={() => setActiveTab('overview')}
          />
        </div>
      );
    }

    return (
      <Suspense fallback={<ViewSkeleton />}>
        <ViewComponent />
      </Suspense>
    );
  };

  const nav = (
    <nav aria-label="Workspace sections" className="flex flex-col gap-1 p-2">
      {visibleTabs.map((tab) => {
        const active = isActive(tab.id);
        return (
          <button
            key={tab.id}
            onClick={() => handleTabClick(tab)}
            aria-current={active ? 'page' : undefined}
            title={collapsed ? tab.label : undefined}
            className={cn(
              'group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5794f2]/50',
              active
                ? 'bg-[#1f2227] text-[#d8d9da] shadow-inner'
                : 'text-[#9fa7b3] hover:bg-[#1f2227]/60 hover:text-[#d8d9da]'
            )}
          >
            <span
              className={cn('shrink-0', active ? 'text-[#5794f2]' : 'text-[#9fa7b3]')}
              aria-hidden="true"
            >
              {tab.icon}
            </span>
            {/* Collapsed me visually chhupa, but screen reader ko dikhta hai */}
            <span className={cn('truncate', collapsed && 'sr-only')}>{tab.label}</span>
            {active ? (
              <span
                className="ml-auto h-2 w-2 shrink-0 rounded-full bg-[#5794f2]"
                aria-hidden="true"
              />
            ) : null}
          </button>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* ---- Mobile top bar ---- */}
      <div className="flex items-center justify-between bg-[#1a1a1a] px-3 py-2 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open workspace navigation"
          aria-expanded={mobileOpen}
          className="flex h-9 w-9 items-center justify-center rounded-md text-[#9fa7b3] transition-colors hover:bg-[#1f2227] hover:text-[#d8d9da]"
        >
          <Menu className="h-2.5 w-2.5" />
        </button>
        <span className="text-sm font-semibold text-[#d8d9da]">Workspace</span>
        {/* ---- Help button on mobile ---- */}
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={helpOpen}
          onClick={() => setHelpOpen(!helpOpen)}
          aria-label="Help"
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-md text-[#9fa7b3] transition-colors hover:bg-[#1f2227] hover:text-[#d8d9da]',
            helpOpen && 'text-[#ff6500]',
          )}
        >
          <HelpCircle className="h-2.5 w-2.5" />
        </button>
      </div>

      {/* ---- Mobile slide-in drawer ---- */}
      {mobileOpen ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="fixed inset-y-0 left-0 z-50 w-64 bg-[#1a1a1a] lg:hidden">
            <div className="flex items-center justify-between bg-[#1a1a1a] px-3 py-2.5">
              <span className="text-sm font-semibold text-[#d8d9da]">Workspace</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
                className="flex h-9 w-9 items-center justify-center rounded-md text-[#9fa7b3] hover:bg-[#1f2227] hover:text-[#d8d9da]"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
            {nav}
          </div>
        </>
      ) : null}

      {/* ---- Desktop sidebar ---- */}
      <aside
        className={cn(
          'hidden shrink-0 bg-[#1a1a1a] lg:flex lg:flex-col',
          collapsed ? 'w-16' : 'w-64'
        )}
      >
        <div className="bg-[#1a1a1a] p-4">
          <div className="flex items-center justify-between">
            <h2 className={cn('text-xs font-bold text-[#5794f2] uppercase', collapsed && 'sr-only')}>
              Workspace
            </h2>
            {/* ---- Help dropdown ----
                Navbar ke main Help dropdown menu.
                Ismein "AURA Micro-Frame Studio Walkthrough" link shamil hai. */}
            <div className="relative">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={helpOpen}
                onClick={() => setHelpOpen(!helpOpen)}
                aria-label="Help"
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-md text-[#9fa7b3] transition-colors duration-150',
                  helpOpen ? 'text-[#ff6500]' : 'hover:bg-[#1f2227] hover:text-[#d8d9da]',
                )}
                title="Help"
              >
                <HelpCircle className="h-2.5 w-2.5" />
              </button>
              {helpOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setHelpOpen(false)}
                    aria-hidden="true"
                  />
                  <div
                    role="menu"
                    aria-label="Help"
                    className="absolute right-0 top-9 z-50 w-56 rounded-md bg-[#181b1f] py-1 shadow-xl"
                  >
                    <button
                    role="menuitem"
                    onClick={() => {
                      setActiveTab('help-micro-frame');
                      setHelpOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[#d8d9da] transition-colors hover:bg-[#1f2227] hover:text-[#ff6500]"
                  >
                    <HelpCircle className="h-2.5 w-2.5" />
                    AURA Micro-Frame Studio Walkthrough
                  </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {nav}

        <div className="mt-auto bg-[#1a1a1a] p-2">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            className={cn(
              'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm',
              'text-[#9fa7b3] hover:bg-[#1f2227]/60 hover:text-[#d8d9da]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5794f2]/50'
            )}
          >
            {collapsed ? (
              <ChevronsRight className="h-2.5 w-2.5 shrink-0" />
            ) : (
              <ChevronsLeft className="h-2.5 w-2.5 shrink-0" />
            )}
            <span className={cn('truncate', collapsed && 'sr-only')}>Collapse</span>
          </button>
        </div>
      </aside>

      {/* ---- Main content area with lazy view ---- */}
      <main className="flex-1 overflow-y-auto">
        {renderActiveView()}
      </main>
    </>
  );
}
