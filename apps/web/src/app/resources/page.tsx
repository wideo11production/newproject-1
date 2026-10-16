// Resources page - help center, docs, tutorials, terms
//
// Hinglish: ye page users ki help ke liye hai - docs, tutorials,
// terms of service, privacy policy, aur contact info.

import Link from 'next/link';
import {
  BookOpen,
  FileText,
  Shield,
  Mail,
  Phone,
  Globe,
  HelpCircle,
  Play,
} from 'lucide-react';

interface Resource {
  title: string;
  description: string;
  icon: React.ReactNode;
  href: string;
}

interface FAQ {
  question: string;
  answer: string;
}

const RESOURCES: Resource[] = [
  {
    title: 'Getting Started Guide',
    description: 'Learn how to upload your first video, use the editor, and publish your content.',
    icon: <Play className="h-5 w-5" />,
    href: '/docs/getting-started',
  },
  {
    title: 'Video Editor Tutorial',
    description: 'Step-by-step guide to the timeline, transitions, AI features, and exporting.',
    icon: <Play className="h-5 w-5" />,
    href: '/docs/editor-tutorial',
  },
  {
    title: 'Channel Management',
    description: 'Create and manage your channel, customize your profile, and grow your audience.',
    icon: <Globe className="h-5 w-5" />,
    href: '/docs/channel-management',
  },
  {
    title: 'Monetization Guide',
    description: 'How ad revenue sharing works, subscription plans, and withdrawing your earnings.',
    icon: <Shield className="h-5 w-5" />,
    href: '/docs/monetization',
  },
  {
    title: 'Community Guidelines',
    description: 'Rules for content, behavior, and what is and isn\'t allowed on Wideo11.',
    icon: <FileText className="h-5 w-5" />,
    href: '/docs/community-guidelines',
  },
  {
    title: 'API Documentation',
    description: 'Integrate with Wideo11 using our public API for uploads, analytics, and more.',
    icon: <FileText className="h-5 w-5" />,
    href: '/docs/api',
  },
];

const FAQS: FAQ[] = [
  {
    question: 'How do I upload a video?',
    answer: 'Go to the Studio, click "Upload", select your video file, add a title and description, and publish. Videos are processed automatically and available for streaming once transcoding completes.',
  },
  {
    question: 'What file formats are supported?',
    answer: 'We support MP4, MOV, AVI, MKV, and WebM for video. For audio, we support MP3, WAV, and AAC. Maximum file size is 8 GB per upload.',
  },
  {
    question: 'How do I earn money on Wideo11?',
    answer: 'Creators with an active paid subscription earn 20% of ad revenue from their content. Free plan users get unlimited storage but zero creator earnings. Withdrawals require a minimum balance of ₹1000.',
  },
  {
    question: 'Can I delete my account?',
    answer: 'Yes. Go to Settings > Account > Delete Account. All your content will be permanently removed and cannot be recovered.',
  },
  {
    question: 'How do I contact support?',
    answer: 'Email us at support@wideo11.com or use the contact form below. We typically respond within 24-48 hours.',
  },
];

export default function ResourcesPage() {
  return (
    <div className="min-h-screen bg-[#161616] text-white">
      {/* Header */}
      <header className="bg-[#1e1e1e] border-b border-[#2a2a2a] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BookOpen className="h-6 w-6 text-[#ff6500]" />
            <h1 className="text-xl font-bold">Wideo11 Resources</h1>
          </div>
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/" className="text-sm hover:text-[#ff6500] transition-colors">
              Browse
            </Link>
            <Link href="/pricing" className="text-sm hover:text-[#ff6500] transition-colors">
              Pricing
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-12 px-4 text-center">
        <h2 className="text-3xl font-bold mb-4">Help & Resources</h2>
        <p className="text-gray-400 max-w-2xl mx-auto">
          Everything you need to know about using Wideo11 — from getting started
          to monetizing your content.
        </p>
      </section>

      {/* Resources Grid */}
      <section className="py-12 px-4">
        <div className="max-w-7xl mx-auto">
          <h3 className="text-lg font-bold mb-6">Guides & Tutorials</h3>
          <div className="grid md:grid-cols-3 gap-6">
            {RESOURCES.map((resource) => (
              <div
                key={resource.title}
                className="p-6 rounded-xl border border-[#2a2a2a] bg-[#1e1e1e] hover:border-[#ff6500]/50 transition-colors"
              >
                <div className="w-10 h-10 rounded-lg bg-[#ff6500]/20 flex items-center justify-center mb-4">
                  {resource.icon}
                </div>
                <h4 className="font-bold mb-2">{resource.title}</h4>
                <p className="text-sm text-gray-400 mb-4">{resource.description}</p>
                <Link href={resource.href} className="text-sm text-[#ff6500] hover:underline font-medium">
                  Read Guide →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-12 px-4">
        <div className="max-w-3xl mx-auto">
          <h3 className="text-lg font-bold mb-6">Frequently Asked Questions</h3>
          <div className="space-y-4">
            {FAQS.map((faq, idx) => (
              <div key={idx} className="p-4 rounded-lg border border-[#2a2a2a] bg-[#1e1e1e]">
                <h4 className="font-medium mb-2">{faq.question}</h4>
                <p className="text-sm text-gray-400">{faq.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section className="py-12 px-4 bg-[#1e1e1e]/50">
        <div className="max-w-7xl mx-auto">
          <h3 className="text-lg font-bold mb-6">Contact Us</h3>
          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <h4 className="font-bold mb-4">Email</h4>
              <p className="text-sm text-gray-400 mb-2">
                <Mail className="h-4 w-4 mr-2 inline" />
                support@wideo11.com
              </p>
              <h4 className="font-bold mb-4 mt-6">Phone</h4>
              <p className="text-sm text-gray-400 mb-2">
                <Phone className="h-4 w-4 mr-2 inline" />
                +91 1800 WIDEO11
              </p>
              <h4 className="font-bold mb-4 mt-6">Address</h4>
              <p className="text-sm text-gray-400">
                <Globe className="h-4 w-4 mr-2 inline" />
                Wideo11 Technologies, Mumbai, India
              </p>
            </div>
            <div className="p-6 rounded-xl border border-[#2a2a2a] bg-[#161616]">
              <h4 className="font-bold mb-4">Send a Message</h4>
              <form className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Your Name</label>
                  <input type="text" className="w-full px-3 py-2 rounded border border-[#2a2a2a] bg-[#161616] text-white focus:border-[#ff6500] outline-none" />
                </div>
                <div className="mt-4">
                  <label className="block text-sm font-medium mb-1">Your Email</label>
                  <input type="email" className="w-full px-3 py-2 rounded border border-[#2a2a2a] bg-[#161616] text-white focus:border-[#ff6500] outline-none" />
                </div>
                <div className="mt-4">
                  <label className="block text-sm font-medium mb-1">Subject</label>
                  <input type="text" className="w-full px-3 py-2 rounded border border-[#2a2a2a] bg-[#161616] text-white focus:border-[#ff6500] outline-none" />
                </div>
                <div className="mt-4">
                  <label className="block text-sm font-medium mb-1">Message</label>
                  <textarea
                    rows={4}
                    className="w-full px-3 py-2 rounded border border-[#2a2a2a] bg-[#161616] text-white focus:border-[#ff6500] outline-none"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-3 rounded-full bg-[#ff6500] text-white font-semibold hover:bg-[#e55a00] transition-colors mt-4"
                >
                  Send Message
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#161616] border-t border-[#2a2a2a] py-8 px-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <BookOpen className="h-6 w-6 text-[#ff6500]" />
            <span className="font-bold">Wideo11 Resources</span>
          </div>
          <div className="text-sm text-gray-400">
            © 2026 Wideo11. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
