// Profile page - user's account settings and preferences
//
// Hinglish: ye page user ke apne account ke liye hai - profile info,
// subscription status, earnings, aur settings.

import Link from 'next/link';
import {
  User,
  Shield,
  Clock,
  CreditCard,
  LogOut,
  Settings,
  Film,
  Crown,
} from 'lucide-react';

interface UserProfile {
  id: string;
  email: string;
  role: string;
  display_name: string;
  avatar_url?: string;
  subscriber_count: number;
  is_verified: boolean;
  created_at: string;
  plan: string;
  plan_name: string;
  max_fps: number;
  export_height: number;
  concurrent_transcodes: number;
  monetization: boolean;
}

interface EarningsStat {
  label: string;
  value: string;
  change: string;
}

export default function ProfilePage() {
  // Mock data - in production this would come from the API
  const user: UserProfile = {
    id: 'usr_1234567890',
    email: 'creator@wideo11.com',
    role: 'user',
    display_name: 'Creative Creator',
    avatar_url: undefined,
    subscriber_count: 1250,
    is_verified: true,
    created_at: '2026-01-15T00:00:00Z',
    plan: 'lifetime_aura',
    plan_name: 'Lifetime Single Use + AURA',
    max_fps: 240,
    export_height: 2160,
    concurrent_transcodes: 8,
    monetization: true,
  };

  const earnings: EarningsStat[] = [
    { label: 'Total Earnings', value: '₹45,200.00', change: '+12% this month' },
    { label: 'This Month', value: '₹8,450.00', change: '+5% vs last month' },
    { label: 'Ad Impressions', value: '1.2M', change: '+8% this month' },
    { label: 'Pending Withdrawal', value: '₹0.00', change: 'Available now' },
  ];

  return (
    <div className="min-h-screen bg-[#161616] text-white">
      {/* Header */}
      <header className="bg-[#1e1e1e] border-b border-[#2a2a2a] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <User className="h-6 w-6 text-[#ff6500]" />
            <h1 className="text-xl font-bold">Profile</h1>
          </div>
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/" className="text-sm hover:text-[#ff6500] transition-colors">
              Browse
            </Link>
            <Link href="/channel/@me" className="text-sm text-[#ff6500] font-medium">
              My Channel
            </Link>
            <Link href="/videos" className="text-sm hover:text-[#ff6500] transition-colors">
              My Videos
            </Link>
            <Link href="/pricing" className="text-sm hover:text-[#ff6500] transition-colors">
              Pricing
            </Link>
          </nav>
          <button
            onClick={() => window.location.href = '/auth/login'}
            className="px-4 py-2 rounded-full bg-red-600/10 hover:bg-red-600/20 text-red-400 transition-colors text-sm font-medium flex items-center gap-2"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Profile Header */}
        <div className="mb-8">
          <div className="flex flex-col md:flex-row md:items-center gap-6">
            <div className="w-20 h-20 rounded-full bg-[#2a2a2a] flex items-center justify-center flex-shrink-0">
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="" className="w-full h-full object-cover rounded-full" />
              ) : (
                <User className="h-10 w-10 text-[#ff6500]" />
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-bold">{user.display_name}</h2>
                {user.is_verified && (
                  <Shield className="h-5 w-5 text-[#ff6500]" />
                )}
              </div>
              <p className="text-gray-400 text-sm">{user.email}</p>
              <div className="flex items-center gap-2 mt-3">
                <span className="px-2 py-1 rounded bg-green-500/20 text-green-400 text-xs font-medium">
                  Verified
                </span>
                <span className="text-xs text-gray-500">
                  Member since {new Date(user.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {earnings.map((stat) => (
            <div key={stat.label} className="p-6 rounded-xl border border-[#2a2a2a] bg-[#1e1e1e]">
              <p className="text-sm text-gray-400">{stat.label}</p>
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-xs text-green-400">{stat.change}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-8 mb-8 border-b border-[#2a2a2a] pb-4">
          <Link
            href="/profile"
            className="px-4 py-2 border-b-2 border-[#ff6500] text-[#ff6500] font-medium"
          >
            Overview
          </Link>
          <Link href="/profile/subscription" className="px-4 py-2 text-gray-400 hover:text-white transition-colors">
            Subscription
          </Link>
          <Link href="/profile/earnings" className="px-4 py-2 text-gray-400 hover:text-white transition-colors">
            Earnings
          </Link>
          <Link href="/profile/settings" className="px-4 py-2 text-gray-400 hover:text-white transition-colors">
            Settings
          </Link>
        </div>

        {/* Overview Content */}
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Left Column - Plan Info */}
          <div className="lg:col-span-2">
            <div className="p-6 rounded-xl border border-[#2a2a2a] bg-[#1e1e1e]">
              <h3 className="font-bold mb-4">Current Plan</h3>
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-lg bg-[#ff6500]/20 flex items-center justify-center">
                  <Crown className="h-6 w-6 text-[#ff6500]" />
                </div>
                <div>
                  <h4 className="font-bold">{user.plan_name}</h4>
                  <p className="text-sm text-gray-400">{user.plan}</p>
                </div>
              </div>

              <table className="w-full text-sm text-gray-300">
                <tbody>
                  <tr className="border-b border-[#2a2a2a] py-3">
                    <td className="text-gray-400">Export Resolution</td>
                    <td className="text-right font-mono">{user.export_height}p</td>
                  </tr>
                  <tr className="border-b border-[#2a2a2a] py-3">
                    <td className="text-gray-400">Max FPS</td>
                    <td className="text-right font-mono">{user.max_fps}</td>
                  </tr>
                  <tr className="border-b border-[#2a2a2a] py-3">
                    <td className="text-gray-400">Concurrent Transcodes</td>
                    <td className="text-right font-mono">{user.concurrent_transcodes}</td>
                  </tr>
                  <tr className="border-b border-[#2a2a2a] py-3">
                    <td className="text-gray-400">Ad Revenue Sharing</td>
                    <td className="text-right">
                      {user.monetization ? (
                        <span className="text-green-400 font-medium">Enabled</span>
                      ) : (
                        <span className="text-gray-400">Disabled</span>
                      )}
                    </td>
                  </tr>
                  <tr className="border-b border-[#2a2a2a] py-3">
                    <td className="text-gray-400">Subscribers</td>
                    <td className="text-right font-mono">{user.subscriber_count.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Right Column - Quick Actions */}
          <div className="lg:col-span-1">
            <div className="p-6 rounded-xl border border-[#2a2a2a] bg-[#1e1e1e]">
              <h3 className="font-bold mb-4">Quick Actions</h3>
              <div className="space-y-3">
                <Link
                  href="/video-editor"
                  className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[#2a2a2a] hover:border-[#ff6500]/50 transition-colors text-left"
                >
                  <Film className="h-5 w-5 text-[#ff6500]" />
                  <span>Create New Video</span>
                </Link>
                <Link
                  href="/channel/@me"
                  className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[#2a2a2a] hover:border-[#ff6500]/50 transition-colors text-left"
                >
                  <User className="h-5 w-5 text-[#ff6500]" />
                  <span>Manage Channel</span>
                </Link>
                <Link
                  href="/videos"
                  className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[#2a2a2a] hover:border-[#ff6500]/50 transition-colors text-left"
                >
                  <Film className="h-5 w-5 text-[#ff6500]" />
                  <span>My Videos</span>
                </Link>
                <Link
                  href="/profile/settings"
                  className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[#2a2a2a] hover:border-[#ff6500]/50 transition-colors text-left"
                >
                  <Settings className="h-5 w-5 text-[#ff6500]" />
                  <span>Account Settings</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-[#161616] border-t border-[#2a2a2a] py-8 px-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <User className="h-6 w-6 text-[#ff6500]" />
            <span className="font-bold">Wideo11 Profile</span>
          </div>
          <div className="text-sm text-gray-400">
            © 2026 Wideo11. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
