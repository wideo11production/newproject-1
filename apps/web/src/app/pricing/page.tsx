// Pricing page - video editor subscription plans
//
// Hinglish: ye page saare 7 subscription tiers dikhata hai jo user ko
// kharidne ke liye available hain. Har plan ki price, features, aur
// "Buy" button hota hai.

import Link from 'next/link';
import {
  Crown,
  Globe,
  Shield,
  Clock,
  Users,
  Film,
  Play,
  Check,
  X,
} from 'lucide-react';

interface Plan {
  name: string;
  tier: string;
  region: string;
  currency: string;
  price: number;
  days: number;
  minBalance: number;
  discountPercent: number;
  features: string[];
  isPopular?: boolean;
}

const PLANS: Plan[] = [
  {
    name: 'Quarterly (3 Months)',
    tier: 'quarterly',
    region: 'India',
    currency: '₹',
    price: 999,
    days: 90,
    minBalance: 1000,
    discountPercent: 0,
    features: [
      '1080p export',
      'Unlimited uploads',
      '2 concurrent transcodes',
      'Basic AI features',
      'Standard support',
    ],
  },
  {
    name: 'Biannual (6 Months)',
    tier: 'biannual',
    region: 'India',
    currency: '₹',
    price: 1799,
    days: 180,
    minBalance: 1000,
    discountPercent: 0,
    features: [
      '4K export',
      'Unlimited uploads',
      '4 concurrent transcodes',
      'All AI features',
      'Priority support',
      'Ad revenue sharing',
    ],
    isPopular: true,
  },
  {
    name: 'Annual (12 Months)',
    tier: 'annual',
    region: 'India',
    currency: '₹',
    price: 2999,
    days: 365,
    minBalance: 1000,
    discountPercent: 0,
    features: [
      '4K export',
      'Unlimited uploads',
      '8 concurrent transcodes',
      'All AI features',
      'Priority support',
      'Ad revenue sharing',
      'Custom thumbnails',
    ],
  },
  {
    name: 'Lifetime Single Use',
    tier: 'lifetime',
    region: 'India',
    currency: '₹',
    price: 7999,
    days: 0,
    minBalance: 1000,
    discountPercent: 0,
    features: [
      '4K export',
      'Unlimited uploads',
      'Unlimited transcodes',
      'All AI features',
      'Lifetime access',
      'Ad revenue sharing',
      'Custom thumbnails',
      'No watermark',
    ],
  },
  {
    name: 'Lifetime Group (5 People)',
    tier: 'lifetime_group5',
    region: 'India',
    currency: '₹',
    price: 19999,
    days: 0,
    minBalance: 1000,
    discountPercent: 0,
    features: [
      '4K export',
      'Unlimited uploads',
      'Unlimited transcodes',
      'All AI features',
      'Lifetime access for 5 users',
      'Ad revenue sharing',
      'Custom thumbnails',
      'No watermark',
      'Team workspace',
    ],
  },
  {
    name: 'Lifetime Group (10 People)',
    tier: 'lifetime_group10',
    region: 'India',
    currency: '₹',
    price: 34999,
    days: 0,
    minBalance: 1000,
    discountPercent: 0,
    features: [
      '4K export',
      'Unlimited uploads',
      'Unlimited transcodes',
      'All AI features',
      'Lifetime access for 10 users',
      'Ad revenue sharing',
      'Custom thumbnails',
      'No watermark',
      'Team workspace',
      'Admin controls',
    ],
  },
  {
    name: 'Lifetime Single Use + AURA',
    tier: 'lifetime_aura',
    region: 'India',
    currency: '₹',
    price: 12999,
    days: 0,
    minBalance: 1000,
    discountPercent: 0,
    features: [
      '4K export',
      'Unlimited uploads',
      'Unlimited transcodes',
      'All AI features',
      'Lifetime access',
      'Ad revenue sharing',
      'Custom thumbnails',
      'No watermark',
      'AURA dialog access',
      'Superadmin tools',
    ],
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[#161616] text-white">
      {/* Header */}
      <header className="bg-[#1e1e1e] border-b border-[#2a2a2a] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Film className="h-6 w-6 text-[#ff6500]" />
            <h1 className="text-xl font-bold">Wideo11</h1>
          </div>
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/" className="text-sm hover:text-[#ff6500] transition-colors">
              Browse
            </Link>
            <Link href="/channel/@me" className="text-sm hover:text-[#ff6500] transition-colors">
              My Channel
            </Link>
            <Link href="/videos" className="text-sm hover:text-[#ff6500] transition-colors">
              My Videos
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <button className="px-4 py-2 rounded-full bg-[#ff6500] text-white text-sm font-semibold hover:bg-[#e55a00] transition-colors">
              Sign In
            </button>
            <button className="px-4 py-2 rounded-full border border-[#2a2a2a] hover:bg-[#2a2a2a] transition-colors text-sm">
              Sign Up
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-12 px-4 text-center">
        <h2 className="text-3xl font-bold mb-4">Choose Your Plan</h2>
        <p className="text-gray-400 max-w-2xl mx-auto">
          Unlock professional video editing with Wideo11. All plans include
          ad revenue sharing, AI features, and priority support.
        </p>
      </section>

      {/* Plans Grid */}
      <section className="py-12 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-3 gap-6">
            {PLANS.map((plan) => (
              <Link
                key={plan.tier}
                href="/auth/signup"
                className="block group"
              >
                <div className={`p-6 rounded-xl border border-[#2a2a2a] bg-[#1e1e1e] hover:border-[#ff6500]/50 transition-colors ${plan.isPopular ? 'border-[#ff6500]/50 bg-[#1e1e1e]/50' : ''}`}>
                  {plan.isPopular && (
                    <div className="absolute -top-3 right-3 bg-[#ff6500] text-white text-xs font-bold px-2 py-1 rounded-full">
                      Popular
                    </div>
                  )}
                  <h3 className="text-xl font-bold mb-2">{plan.name}</h3>
                  <div className="mb-4">
                    <span className="text-3xl font-bold">
                      {plan.currency}{plan.price}
                    </span>
                    {plan.days > 0 ? (
                      <span className="text-gray-400 text-sm ml-2">
                        / {plan.days} days
                      </span>
                    ) : (
                      <span className="text-gray-400 text-sm ml-2">
                        / lifetime
                      </span>
                    )}
                  </div>
                  <p className="text-gray-400 text-sm mb-6 min-h-[3em]">
                    {plan.features[0]}
                  </p>
                  <ul className="space-y-3 mb-6">
                    {plan.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <Check className="h-4 w-4 text-[#ff6500] flex-shrink-0" />
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <button className="w-full py-3 rounded-full bg-[#ff6500] text-white font-semibold hover:bg-[#e55a00] transition-colors">
                    Get Started
                  </button>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-12 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold mb-8 text-center">Frequently Asked Questions</h2>
          <div className="space-y-4">
            <div className="p-4 rounded-lg border border-[#2a2a2a] bg-[#1e1e1e]">
              <h3 className="font-medium mb-2">Can I upgrade or downgrade my plan?</h3>
              <p className="text-sm text-gray-400">
                Yes, you can upgrade your plan at any time. The new plan takes effect
                immediately and your remaining balance is adjusted pro-rata.
              </p>
            </div>
            <div className="p-4 rounded-lg border border-[#2a2a2a] bg-[#1e1e1e]">
              <h3 className="font-medium mb-2">How does ad revenue sharing work?</h3>
              <p className="text-sm text-gray-400">
                Creators with an active paid subscription earn 20% of ad revenue from
                their content. Free plan users get unlimited storage but zero creator
                earnings.
              </p>
            </div>
            <div className="p-4 rounded-lg border border-[#2a2a2a] bg-[#1e1e1e]">
              <h3 className="font-medium mb-2">What is the minimum balance for withdrawal?</h3>
              <p className="text-sm text-gray-400">
                The minimum withdrawal balance is ₹1000 (or equivalent in your region's
                currency). Once you reach this threshold, you can request a payout.
              </p>
            </div>
            <div className="p-4 rounded-lg border border-[#2a2a2a] bg-[#1e1e1e]">
              <h3 className="font-medium mb-2">Is there a free trial?</h3>
              <p className="text-sm text-gray-400">
                Yes, all new users get a 3-day free trial automatically. After the trial,
                you need to subscribe to a paid plan to continue earning and exporting.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#161616] border-t border-[#2a2a2a] py-8 px-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <Film className="h-6 w-6 text-[#ff6500]" />
            <span className="font-bold">Wideo11</span>
          </div>
          <div className="text-sm text-gray-400">
            © 2026 Wideo11. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
