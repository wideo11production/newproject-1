'use client';

// ============================================================================
// STUDENT VERIFICATION - Phase 1 Automated Student Verification Engine
// ============================================================================
// /student-verification - Student application + compliance status console.
//
// BORDERLESS DESIGN SYSTEM (zero gray lines, zero wireframe margins,
// zero cell borders - background contrast only):
//
//   Input/Form Base:    #161616 (Deep Matte Charcoal) - rounded-md blocks
//   Warning Banner:     #1e1e1e (Elegant Grayish-Black Slate) - rounded-md
//   Focus Flash:        #ff6500 (MOVAVI accent) - 150ms animation loop
//
// Hinglish: Student verification application form aur compliance status
// cards. Sab borders hat gaye, sirf background contrast se panels alag
// hain. Focused inputs #ff6500 ring se 150ms loop me flash karte hain.
//
// Superadmin context: advchashampalup@gmail.com (global root superadmin)
// pipeline visibility ke liye header me dikhayi deta hai.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import {
  Plus,
  AlertCircle,
  CheckCircle,
  ShieldAlert,
  User,
  Mail,
  Building2,
  Award,
  Clock,
  Monitor,
} from 'lucide-react';
import {
  input,
  select,
  buttonPrimary,
  borderlessCard,
  focusFlash,
  accent,
} from '@wideo11/ui/design-system';

// Simple cn utility (className merge) - no external dep.
function cn(...classes: (string | boolean | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

// SUPERADMIN CONTEXT - global root superadmin for pipeline visibility.
// advchashampalup@gmail.com ki email ko detect karke superadmin-only
// section dikhaya jaata hai.
const SUPERADMIN_EMAIL = 'advchashampalup@gmail.com';

// Professional role options (Gate A/B routing).
const PROFESSIONAL_ROLES = [
  { value: 'student', label: 'Student', hint: 'Academic domain instant pass (Gate A)' },
  { value: 'tutor', label: 'Tutor', hint: 'Educational domain instant pass (Gate A)' },
  { value: 'advocate', label: 'Advocate', hint: 'Bar Council domain OR ID card (Gate B)' },
];

// Educational content categories (student tier allowed).
const EDUCATIONAL_CATEGORIES = [
  'tutorial',
  'lecture',
  'course',
  'lesson',
  'study_guide',
  'exam_prep',
  'academic_project',
  'research',
  'thesis',
  'educational_documentary',
];

// Verification statuses.
const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending Review', color: 'bg-[#2a2a2a] text-gray-300' },
  verified_by_domain: { label: 'Verified (Domain)', color: 'bg-[#15803d]/20 text-[#4ade80]' },
  pending_document: { label: 'Document Review', color: 'bg-[#b45309]/20 text-[#fbbf24]' },
  verified: { label: 'Verified (Document)', color: 'bg-[#15803d]/20 text-[#4ade80]' },
  rejected: { label: 'Rejected', color: 'bg-[#7f1d1d]/20 text-[#fca5a5]' },
  expired: { label: 'Expired - Re-verify', color: 'bg-[#7f1d1d]/20 text-[#fca5a5]' },
};

// Focus flash animation - #ff6500 ring, 150ms loop.
const FOCUS_FLASH_CSS = `
  @keyframes focus-flash {
    0% { box-shadow: 0 0 0 0 rgba(255, 101, 0, 0.7); }
    50% { box-shadow: 0 0 0 4px rgba(255, 101, 0, 0.4); }
    100% { box-shadow: 0 0 0 0 rgba(255, 101, 0, 0); }
  }
  .focus-flash-150ms {
    animation: focus-flash 150ms ease-in-out infinite;
  }
`;

const studentVerificationMetadata = {
  title: 'Student Verification - Wideo11',
  description: 'Student/Tutor/Advocate verification application and compliance status',
};

// Client components cannot `export const metadata` or `generateMetadata`
// in Next.js 14. Page title defaults to the root layout metadata.

export default function StudentVerificationPage() {
  const [email, setEmail] = useState('');
  const [professionalRole, setProfessionalRole] = useState<'' | 'student' | 'tutor' | 'advocate'>('');
  const [institution, setInstitution] = useState('');
  const [academicEmail, setAcademicEmail] = useState('');
  const [documentUrl, setDocumentUrl] = useState('');
  const [barAssociationId, setBarAssociationId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ status: 'success' | 'error'; message: string } | null>(null);
  const [complianceData, setComplianceData] = useState<{
    isStudent: boolean;
    status: string;
    category: string;
    penaltyApplied: boolean;
    walletFrozen: boolean;
  } | null>(null);
  const flashRef = useRef(false);

  const isSuperadmin = email === SUPERADMIN_EMAIL;

  // Focus flash animation toggle - 150ms loop.
  useEffect(() => {
    const interval = setInterval(() => {
      flashRef.current = !flashRef.current;
    }, 150);
    return () => clearInterval(interval);
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitResult(null);

    try {
      const res = await fetch('/api/auth/student-verification/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          professional_role: professionalRole,
          institution_name: institution,
          academic_email: academicEmail,
          document_url: documentUrl || undefined,
          bar_association_id: barAssociationId || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSubmitResult({ status: 'success', message: data.message || 'Verification application submitted.' });
        setComplianceData({
          isStudent: true,
          status: data.status || 'pending',
          category: data.content_category || 'educational',
          penaltyApplied: false,
          walletFrozen: false,
        });
      } else {
        setSubmitResult({ status: 'error', message: data.message || 'Application failed.' });
      }
    } catch {
      setSubmitResult({ status: 'error', message: 'Network error. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  }, [email, professionalRole, institution, academicEmail, documentUrl, barAssociationId]);

  const complianceCard = useMemo(() => {
    if (!complianceData) return null;
    const statusInfo = STATUS_LABELS[complianceData.status as keyof typeof STATUS_LABELS] ?? STATUS_LABELS.pending;
    return (
      <div className={cn(borderlessCard, complianceData.walletFrozen ? 'bg-[#1e1e1e]' : 'bg-[#161616]')}>
        <div className="flex items-start justify-between gap-3 p-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ShieldAlert className="h-5 w-5 text-[#ff6500]" />
              <span className="text-sm font-medium text-white">Compliance Status</span>
            </div>
            <p className="text-xs text-gray-400 mb-3">
              Student tier channel content scope enforcement
            </p>
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${statusInfo.color}`}>
                {statusInfo.label}
              </span>
              {complianceData.penaltyApplied && (
                <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-[#7f1d1d]/20 text-[#fca5a5]">
                  25% Penalty Applied
                </span>
              )}
              {complianceData.walletFrozen && (
                <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-[#7f1d1d]/20 text-[#fca5a5]">
                  Wallet Frozen
                </span>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-white">
              {complianceData.isStudent ? 'STUDENT' : 'GENERAL'}
            </div>
            <div className="text-xs text-gray-500">Tier</div>
          </div>
        </div>
        <div className="border-t border-[#2a2a2a]/30 mt-3 pt-3">
          <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
            <span>Content Category</span>
            <span>{complianceData.category}</span>
          </div>
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>Wallet Withdrawals</span>
            <span className={complianceData.walletFrozen ? 'text-[#fca5a5]' : 'text-[#4ade80]'}>
              {complianceData.walletFrozen ? 'Frozen' : 'Active'}
            </span>
          </div>
        </div>
      </div>
    );
  }, [complianceData]);

  return (
    <div className="min-h-screen bg-[#111217] text-[#d8d9da]">
      <style dangerouslySetInnerHTML={{ __html: FOCUS_FLASH_CSS }} />

      {/* Header - superadmin context visible for root admin */}
      <header className="bg-[#161616] border-0 p-4 mb-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Award className="h-6 w-6 text-[#ff6500]" />
            <div>
              <h1 className="text-sm font-semibold text-white">Student Verification</h1>
              <p className="text-xs text-gray-400">AURA student gate - dual-gate verification engine</p>
            </div>
          </div>
          {isSuperadmin && (
            <div className={cn(borderlessCard, 'bg-[#1e1e1e]')}>
              <div className="flex items-center gap-2 p-3">
                <Monitor className="h-4 w-4 text-[#ff6500]" />
                <span className="text-xs font-medium text-[#ff6500]">SUPERADMIN</span>
                <span className="text-xs text-gray-400">advchashampalup@gmail.com</span>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4">
        {/* Application Form - borderless input base #161616 */}
        <section className={cn(borderlessCard, 'bg-[#161616]')}>
          <div className="p-5">
            <div className="flex items-center gap-2 mb-5">
              <User className="h-5 w-5 text-[#ff6500]" />
              <h2 className="text-sm font-semibold text-white">Student Verification Application</h2>
            </div>
            <p className="text-xs text-gray-400 mb-5">
              Apply for student/tutor/advocate verification. Gate A: academic domain instant pass.
              Gate B: document upload + 365-day token.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-300">Email Address</label>
                  <input
                    type="email"
                    className={cn(input, 'bg-[#161616]')}
                    placeholder="name@college.edu"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-300">Professional Role</label>
                  <select
                    className={cn(select, 'bg-[#161616]')}
                    value={professionalRole}
                    onChange={(e) => setProfessionalRole(e.target.value as any)}
                  >
                    <option value="">Select role</option>
                    {PROFESSIONAL_ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label} - {r.hint}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-300">Institution Name</label>
                <input
                  type="text"
                  className={cn(input, 'bg-[#161616]')}
                  placeholder="e.g. IIT Delhi, Bar Council of India"
                  value={institution}
                  onChange={(e) => setInstitution(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-300">Academic Email (for Gate A domain check)</label>
                <input
                  type="email"
                  className={cn(input, 'bg-[#161616]')}
                  placeholder="name@college.edu"
                  value={academicEmail}
                  onChange={(e) => setAcademicEmail(e.target.value)}
                />
                <p className="text-xs text-gray-500">
                  Domain match = instant verified_by_domain status + 365-day token
                </p>
              </div>

              {professionalRole === 'advocate' && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-300">Bar Association ID (mandatory for advocate)</label>
                  <input
                    type="text"
                    className={cn(input, 'bg-[#161616]')}
                    placeholder="Bar Council membership number"
                    value={barAssociationId}
                    onChange={(e) => setBarAssociationId(e.target.value)}
                  />
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-300">Document Upload URL (Gate B fallback)</label>
                <input
                  type="text"
                  className={cn(input, 'bg-[#161616]')}
                  placeholder="MinIO path to ID card / degree certificate"
                  value={documentUrl}
                  onChange={(e) => setDocumentUrl(e.target.value)}
                />
                <p className="text-xs text-gray-500">
                  Upload college_id, bar_council_id, bar_card, or tutor_certificate
                </p>
              </div>

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={isSubmitting || !email || !professionalRole}
                  className={cn(buttonPrimary, 'w-full', isSubmitting ? 'opacity-50' : '')}
                >
                  {isSubmitting ? 'Submitting...' : 'Apply for Verification'}
                </button>
              </div>
            </form>
          </div>
        </section>

        {submitResult && (
          <div
            className={cn(
              borderlessCard,
              submitResult.status === 'success' ? 'bg-[#161616]' : 'bg-[#1e1e1e]',
              flashRef.current && submitResult.status === 'error' ? 'focus-flash-150ms' : '',
            )}
            role="alert"
          >
            <div className="flex items-center gap-2 p-4">
              {submitResult.status === 'success' ? (
                <CheckCircle className="h-5 w-5 text-[#4ade80]" />
              ) : (
                <AlertCircle className="h-5 w-5 text-[#ff6500]" />
              )}
              <span className="text-sm text-white">{submitResult.message}</span>
            </div>
          </div>
        )}

        {/* Compliance Status Card - borderless, warning banner #1e1e1e */}
        {complianceCard}

        {/* Educational Content Reference */}
        <section className={cn(borderlessCard, 'bg-[#161616]')}>
          <div className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <Building2 className="h-5 w-5 text-[#ff6500]" />
              <h3 className="text-sm font-semibold text-white">Educational Content Categories</h3>
            </div>
            <p className="text-xs text-gray-400 mb-3">
              Student tier channels can ONLY upload content from these categories:
            </p>
            <div className="flex flex-wrap gap-2">
              {EDUCATIONAL_CATEGORIES.map((cat) => (
                <span
                  key={cat}
                  className="px-2.5 py-1 rounded-md text-xs font-medium bg-[#2a2a2a] text-gray-300 border-0"
                >
                  {cat}
                </span>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
