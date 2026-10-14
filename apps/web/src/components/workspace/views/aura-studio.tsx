// AuraStudioView — 🎓 AURA Studio student verification gate.
//
// Hinglish: ye view user-service ke Dual-Gate student verification system
// ko visualize karta hai:
//   - Gate A: Instant domain check (email academic domain → auto verified)
//   - Gate B: ID card upload → manual review → verified
//
// User directive: "AURA Studio (Maps directly onto the user-service
// student verification gate)"
//
// API endpoints (user-service):
//   GET  /students/:id/status   — status check
//   POST /students/gate-a/:id   — instant domain verification
//   POST /students/gate-b/:id   — ID document upload (fallback)
//   POST /students/approve/:id  — admin approval
//

import { useEffect, useState } from 'react';
import { GraduationCap, CheckCircle, Clock, XCircle, Upload, Shield } from 'lucide-react';
import { Button } from '@wideo11/ui/button';
import { Input } from '@wideo11/ui/input';
import { Label } from '@wideo11/ui/label';

import {
  grafanaDanger,
  grafanaPanel,
  grafanaPrimary,
  grafanaPrimaryBg,
  grafanaSuccess,
  grafanaText,
  grafanaTextMuted,
  productPanelHover,
  productSeparation,
  productSunken,
  productWarning,
} from '@wideo11/ui/design-system';

type VerificationStatus = 'pending' | 'verified_by_domain' | 'pending_document' | 'verified' | 'rejected' | 'expired';

type VerificationRecord = {
  status: VerificationStatus;
  verified: boolean;
  token_expires_at?: string | null;
  email_domain?: string;
  id_document_url?: string;
};

export function AuraStudioView() {
  const [status, setStatus] = useState<VerificationRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDocForm, setShowDocForm] = useState(false);
  const [docUrl, setDocUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Fetch verification status on mount.
  useEffect(() => {
    void fetch('/api/user/student-status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        setStatus(data);
      })
      .catch(() => {
        setStatus({
          status: 'pending',
          verified: false,
        });
      })
      .finally(() => setLoading(false));
  }, []);

  const handleGateA = async () => {
    setLoading(true);
    void fetch('/api/user/student-status/gate-a', { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        setStatus(data);
      })
      .finally(() => setLoading(false));
  };

  const handleDocSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    void fetch('/api/user/student-status/gate-b', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_url: docUrl }),
    })
      .then((r) => r.json())
      .then((data) => {
        setStatus(data);
        setShowDocForm(false);
      })
      .catch(() => {
        setShowDocForm(false);
      })
      .finally(() => setSubmitting(false));
  };

  if (loading && !status) {
    return (
      <div className="p-6">
        <div className={`h-6 w-48 animate-pulse rounded ${productPanelHover}`} />
      </div>
    );
  }

  const statusColor: Record<VerificationStatus, string> = {
    pending: `${grafanaTextMuted}`,
    verified_by_domain: `${grafanaSuccess}`,
    pending_document: `${productWarning}`,
    verified: `${grafanaSuccess}`,
    rejected: `${grafanaDanger}`,
    expired: `${grafanaDanger}`,
  };

  const statusIcon: Record<VerificationStatus, React.ReactNode> = {
    pending: <Clock className="h-2.5 w-2.5" />,
    verified_by_domain: <Shield className="h-2.5 w-2.5" />,
    pending_document: <Upload className="h-2.5 w-2.5" />,
    verified: <CheckCircle className="h-2.5 w-2.5" />,
    rejected: <XCircle className="h-2.5 w-2.5" />,
    expired: <Clock className="h-2.5 w-2.5" />,
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className={`text-2xl font-bold ${grafanaText}`}>
          AURA Studio — Student Verification
        </h1>
      </div>

      <div className={`mb-6 rounded-md ${grafanaPanel} p-5`}>
        <div className="flex items-center gap-3">
          <span className={statusColor[status?.status || 'pending']}>
            {statusIcon[status?.status || 'pending']}
          </span>
          <div>
            <p className={`font-medium ${grafanaText}`}>
              Status: {status?.status || 'pending'}
            </p>
            {status?.email_domain ? (
              <p className={`text-sm ${grafanaTextMuted}`}>
                Domain: {status.email_domain} ({status.verified ? '✓ Verified' : '✗ Not verified'})
              </p>
            ) : null}
            {status?.token_expires_at ? (
              <p className={`text-sm ${grafanaTextMuted}`}>
                Token expires: {new Date(status.token_expires_at).toLocaleDateString()}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className={`rounded-md ${productSunken} p-4`}>
          <h3 className={`flex items-center gap-2 text-sm font-semibold ${grafanaText}`}>
            <GraduationCap className={`h-2.5 w-2.5 ${grafanaPrimary}`} />
            Gate A — Instant Domain Verification
          </h3>
          <p className={`mt-1 text-xs ${grafanaTextMuted}`}>
            Agar aapka email academic institution (e.g. iitd.ac.in, iiitb.ac.in)
            par hai to ek click me automatically verified ho jaoenge.
          </p>
          <Button
            size="sm"
            className={`mt-3 ${grafanaPrimaryBg} text-white ${grafanaPrimaryBg}/85`}
            onClick={handleGateA}
          >
            Verify via academic email
          </Button>
        </div>

        <div className={`rounded-md ${productSunken} p-4`}>
          <h3 className={`flex items-center gap-2 text-sm font-semibold ${grafanaText}`}>
            <Upload className={`h-2.5 w-2.5 ${grafanaPrimary}`} />
            Gate B — ID Card Document Upload
          </h3>
          <p className={`mt-1 text-xs ${grafanaTextMuted}`}>
            Agar domain match nahi hota, to college ID card upload karo.
            Manual review ke baad 365-day token mil jayega.
          </p>

          {showDocForm ? (
            <form onSubmit={handleDocSubmit} className="mt-3 space-y-3">
              <div>
                <Label htmlFor="doc-url" className={`text-xs ${grafanaTextMuted}`}>
                  Document URL (MinIO/S3 path)
                </Label>
                <Input
                  id="doc-url"
                  value={docUrl}
                  onChange={(e) => setDocUrl(e.target.value)}
                  placeholder="minio://id-card-xyz.jpg"
                  className={`${productSeparation} ${grafanaPanel} text-sm`}
                  required
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={submitting}
                  className={`${grafanaPrimaryBg} text-white ${grafanaPrimaryBg}/85`}
                >
                  {submitting ? 'Submitting...' : 'Submit for review'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowDocForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className={`mt-3 ${grafanaTextMuted}`}
              onClick={() => setShowDocForm(true)}
            >
              Upload ID card
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

