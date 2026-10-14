// CommercialConsoleView — 📢 Ads-service geofencing tracker + revenue dashboard.
//
// Hinglish: ye view ads revenue tracking karta hai:
//   - Geofencing: ad impressions by region/country
//   - Revenue attribution: viewer 60% / platform 20% / creator 20% split
//   - Campaign performance
//
// User directive: "Commercial Console (Maps onto ads-service geofencing tracker)"

import { useEffect, useState } from 'react';
import { Globe, DollarSign, TrendingUp, Users } from 'lucide-react';

import {
  grafanaDanger,
  grafanaDangerBg,
  grafanaPanel,
  grafanaPrimary,
  grafanaPrimaryBg,
  grafanaSuccess,
  grafanaSuccessBg,
  grafanaText,
  grafanaTextMuted,
  productPanelHover,
  productSunken,
  productWarning,
} from '@wideo11/ui/design-system';

type AdRevenueStats = {
  total_revenue: number;
  impressions: number;
  viewer_share: number;
  platform_share: number;
  creator_share: number;
  top_countries: Array<{ country: string; revenue: number; impressions: number }>;
};

export function CommercialConsoleView() {
  const [stats, setStats] = useState<AdRevenueStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetch('/api/ads/revenue', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => setStats(data as AdRevenueStats))
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !stats) {
    return (
      <div className="p-6">
        <div className={`h-6 w-48 animate-pulse rounded ${productPanelHover}`} />
      </div>
    );
  }

  const splitPct = {
    viewer: (stats.viewer_share / stats.total_revenue) * 100,
    platform: (stats.platform_share / stats.total_revenue) * 100,
    creator: (stats.creator_share / stats.total_revenue) * 100,
  };

  return (
    <div className="p-6">
      <h1 className={`text-2xl font-bold ${grafanaText} mb-6`}>
        Commercial Console
      </h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <div className={`rounded-md ${grafanaPanel} p-5`}>
          <div className="flex items-center gap-3">
            <DollarSign className={`h-2.5 w-2.5 ${grafanaPrimary}`} />
            <div>
              <p className={`text-[11px] uppercase tracking-wide ${grafanaTextMuted}`}>
                Total Revenue
              </p>
              <p className={`mt-1 text-2xl font-bold ${grafanaText}`}>
                ₹{stats.total_revenue.toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        <div className={`rounded-md ${grafanaPanel} p-5`}>
          <div className="flex items-center gap-3">
            <Globe className={`h-2.5 w-2.5 ${grafanaSuccess}`} />
            <div>
              <p className={`text-[11px] uppercase tracking-wide ${grafanaTextMuted}`}>
                Impressions
              </p>
              <p className={`mt-1 text-2xl font-bold ${grafanaText}`}>
                {stats.impressions.toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        <div className={`rounded-md ${grafanaPanel} p-5`}>
          <div className="flex items-center gap-3">
            <Users className={`h-2.5 w-2.5 ${grafanaDanger}`} />
            <div>
              <p className={`text-[11px] uppercase tracking-wide ${grafanaTextMuted}`}>
                Unique Viewers
              </p>
              <p className={`mt-1 text-2xl font-bold ${grafanaText}`}>
                {Math.round(stats.impressions * 0.6).toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        <div className={`rounded-md ${grafanaPanel} p-5`}>
          <div className="flex items-center gap-3">
            <TrendingUp className={`h-2.5 w-2.5 ${productWarning}`} />
            <div>
              <p className={`text-[11px] uppercase tracking-wide ${grafanaTextMuted}`}>
                Your Share (20%)
              </p>
              <p className={`mt-1 text-2xl font-bold ${grafanaText}`}>
                ₹{stats.creator_share.toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Revenue split visualization */}
      <div className={`mb-8 rounded-md ${grafanaPanel} p-5`}>
        <h3 className={`mb-4 text-sm font-semibold ${grafanaText}`}>
          Revenue Split (Q3.2)
        </h3>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-xs">
              <span className={`${grafanaTextMuted}`}>Viewer (60%)</span>
              <span className={`${grafanaText}`}>₹{stats.viewer_share.toLocaleString()}</span>
            </div>
            <div className={`mt-1 h-2 rounded-full ${productPanelHover}`}>
              <div
                className={`h-2 rounded-full ${grafanaPrimaryBg}`}
                style={{ width: `${splitPct.viewer}%` }}
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs">
              <span className={`${grafanaTextMuted}`}>Creator (20% — subscribed only)</span>
              <span className={`${grafanaText}`}>₹{stats.creator_share.toLocaleString()}</span>
            </div>
            <div className={`mt-1 h-2 rounded-full ${productPanelHover}`}>
              <div
                className={`h-2 rounded-full ${grafanaSuccessBg}`}
                style={{ width: `${splitPct.creator}%` }}
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs">
              <span className={`${grafanaTextMuted}`}>Platform (20%)</span>
              <span className={`${grafanaText}`}>₹{stats.platform_share.toLocaleString()}</span>
            </div>
            <div className={`mt-1 h-2 rounded-full ${productPanelHover}`}>
              <div
                className={`h-2 rounded-full ${grafanaDangerBg}`}
                style={{ width: `${splitPct.platform}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Geofencing */}
      <div className={`rounded-md ${grafanaPanel} p-5`}>
        <h3 className={`mb-4 text-sm font-semibold ${grafanaText}`}>
          Top Countries by Revenue
        </h3>
        <div className="space-y-2">
          {stats.top_countries.map((country, i) => (
            <div
              key={country.country}
              className={`flex items-center justify-between rounded-md ${productSunken} px-3 py-2`}
            >
              <span className={`text-sm ${grafanaText}`}>
                #{i + 1} {country.country}
              </span>
              <span className={`text-sm ${grafanaTextMuted}`}>
                ₹{country.revenue.toLocaleString()} · {country.impressions.toLocaleString()} impressions
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

