// CreatorBroadcastView — 📦 Creator Broadcast Pack.
//
// Hinglish: ye view upload-service ke saath integrate karta hai:
//   1. Per-user upload quota check (.env config se)
//   2. Content safety scan status (FFmpeg + ONNX guard results)
//   3. Current upload sessions
//
// User directive: "Creator Broadcast Pack (Maps onto upload-service volume check)"

import { useEffect, useState } from 'react';
import { Upload, Shield, Database, AlertTriangle } from 'lucide-react';
import { Button } from '@wideo11/ui/button';

import {
  grafanaDanger,
  grafanaDangerBg,
  grafanaPanel,
  grafanaPrimary,
  grafanaPrimaryBg,
  grafanaSuccess,
  grafanaText,
  grafanaTextMuted,
  productPanelHover,
  productSunken,
  productWarning,
} from '@wideo11/ui/design-system';

type UploadSession = {
  uuid: string;
  filename: string;
  file_size: number;
  status: string;
  category: string;
  created_at: string;
};

type SafetyCheck = {
  status: 'pending' | 'scanning' | 'clean' | 'flagged' | 'aborted';
  detections_count: number;
  max_confidence: number;
  categories_found?: string;
};

type QuotaInfo = {
  max_file_size_mb: number;
  max_daily_uploads: number;
  has_quota: boolean;
};

export function CreatorBroadcastView() {
  const [sessions, setSessions] = useState<UploadSession[]>([]);
  const [safetyStatus, setSafetyStatus] = useState<Record<string, SafetyCheck>>({});
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [blacklist, setBlacklist] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetch('/api/uploads/quota', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => setQuota(data as QuotaInfo))
      .catch(() => setQuota(null));

    void fetch('/api/uploads/sessions?limit=10', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        const sessions = (data.sessions || []) as UploadSession[];
        setSessions(sessions);

        // Fetch safety check status for each session.
        sessions.forEach((s) => {
          void fetch(`/safety/check/${s.uuid}`, { cache: 'no-store' })
            .then((r) => r.json())
            .then((sc) => {
              setSafetyStatus((prev) => ({ ...prev, [s.uuid]: sc.check }));
            })
            .catch(() => {});
        });
      })
      .catch(() => setSessions([]));

    void fetch('/api/uploads/blacklist-check', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => setBlacklist(!!data.blacklisted))
      .catch(() => setBlacklist(false))
      .finally(() => setLoading(false));
  }, []);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  if (loading && !sessions.length) {
    return (
      <div className="p-6">
        <div className={`h-6 w-48 animate-pulse rounded ${productPanelHover}`} />
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className={`text-2xl font-bold ${grafanaText} mb-6`}>
        Creator Broadcast Pack
      </h1>

      {/* Quota card */}
      <div className={`mb-6 rounded-md ${grafanaPanel} p-5`}>
        <div className="flex items-center gap-3">
          <Database className={`h-2.5 w-2.5 ${grafanaPrimary}`} />
          <div>
            <h3 className={`font-semibold ${grafanaText}`}>Upload Quota</h3>
            {quota ? (
              <p className={`text-sm ${grafanaTextMuted}`}>
                Max file: {quota.max_file_size_mb > 0 ? `${quota.max_file_size_mb} MB` : 'Unlimited'}
                {' · '}
                Daily uploads: {quota.max_daily_uploads > 0 ? quota.max_daily_uploads : 'Unlimited'}
              </p>
            ) : (
              <p className={`text-sm ${grafanaTextMuted}`}>Loading quota info...</p>
            )}
          </div>
        </div>
      </div>

      {/* Blacklist alert */}
      {blacklist ? (
        <div className={`mb-6 rounded-md/30 ${grafanaDangerBg}/10 p-4`}>
          <div className={`flex items-center gap-2 ${grafanaDanger}`}>
            <AlertTriangle className="h-2.5 w-2.5" />
            <span className="font-semibold">Account Blacklisted</span>
          </div>
          <p className={`mt-1 text-sm ${grafanaDanger}/80`}>
            Your account has been blacklisted due to a content safety violation.
            Contact support to appeal.
          </p>
        </div>
      ) : null}

      {/* Upload button */}
      <div className="mb-6">
        <Button
          className={`${grafanaPrimaryBg} text-white ${grafanaPrimaryBg}/85`}
          onClick={() => {
            // Dispatch to upload init flow.
            window.location.href = '/broadcast/new';
          }}
        >
          <Upload className="mr-2 h-2.5 w-2.5" />
          New Upload
        </Button>
      </div>

      {/* Sessions list with safety status */}
      <div className="space-y-3">
        <h3 className={`text-sm font-semibold ${grafanaText}`}>Recent Uploads</h3>
        {sessions.length === 0 ? (
          <div className={`rounded-md ${productSunken} p-6 text-center`}>
            <Upload className={`mx-auto h-6 w-6 ${grafanaTextMuted}`} />
            <p className={`mt-2 text-sm ${grafanaTextMuted}`}>No uploads yet.</p>
          </div>
        ) : (
          sessions.map((s) => {
            const safety = safetyStatus[s.uuid];
            return (
              <div
                key={s.uuid}
                className={`flex items-center justify-between rounded-md ${productSunken} p-3`}
              >
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm font-medium ${grafanaText}`}>
                    {s.filename}
                  </p>
                  <p className={`text-xs ${grafanaTextMuted}`}>
                    {formatBytes(s.file_size)} · Category: {s.category} · Status: {s.status}
                  </p>
                </div>
                {safety ? (
                  <span className={`ml-3 text-xs ${
                    safety.status === 'clean' ? `${grafanaSuccess}`
                    : safety.status === 'flagged' ? `${grafanaDanger}`
                    : safety.status === 'scanning' ? `${productWarning}`
                    : `${grafanaTextMuted}`
                  }`}>
                    Safety: {safety.status}
                  </span>
                ) : (
                  <Shield className={`ml-3 h-2.5 w-2.5 ${grafanaTextMuted}`} />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

