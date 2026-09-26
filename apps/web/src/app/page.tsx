// Commercial landing page - Server Component (koi "use client" nahi, isliye zero client JS overhead)
// Purane editor canvas block aur static template loops (Array.from skeleton loops) poore tarah hata diye gaye hain.
// Naya page: professional landing dashboard + working auth navigation vectors.
// Hinglish comments: har block ka arth samjhne ke liye.

import Link from 'next/link';
import { Button } from '@wideo11/ui/button';
import { Badge } from '@wideo11/ui/badge';
import { Card, CardContent } from '@wideo11/ui/card';
import { PlayCircle, ShieldCheck, Gauge, LineChart, Wallet, Globe } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="min-h-full bg-gray-950 text-gray-100">
      {/* ---------------- Top navigation bar ---------------- */}
      {/* Auth navigation vectors yahan bhi hain taaki har page se login/register reachable rahe */}
      <header className="sticky top-0 z-40 border-b border-gray-800 bg-gray-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">
              W
            </span>
            <span className="text-lg font-semibold tracking-tight text-white">Wideo11</span>
          </Link>

          {/* Login + Register buttons header me - primary action Register */}
          <nav className="flex items-center gap-3">
            <Link href="/auth/login">
              <Button variant="ghost" className="text-gray-300 hover:text-white">
                Log in
              </Button>
            </Link>
            <Link href="/auth/register">
              <Button className="bg-blue-600 text-white hover:bg-blue-500">Register</Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* ---------------- Hero section ---------------- */}
      {/* Background CSS gradient se banaya gaya hai - koi image asset required nahi */}
      <section className="relative overflow-hidden border-b border-gray-800">
        {/* Decorative gradient blobs - purely visual, aria-hidden */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -top-32 left-1/4 h-80 w-80 rounded-full bg-blue-600/20 blur-3xl" />
          <div className="absolute -bottom-24 right-1/4 h-72 w-72 rounded-full bg-purple-600/10 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-6xl px-6 py-20 text-center sm:py-28">
          <Badge className="mb-6 border-blue-500/40 bg-blue-500/10 text-blue-300">
            Now accepting creators
          </Badge>

          <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">
            Publish video. Keep control of every stream.
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-400">
            Wideo11 is a video platform built around edge delivery and honest payouts. Your
            catalog is transcoded to adaptive HLS, streamed from the edge, and every rupee you
            earn is recorded in a ledger you can actually audit.
          </p>

          {/* Primary CTA = Register, Secondary CTA = Login */}
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link href="/auth/register" className="w-full sm:w-auto">
              <Button size="lg" className="w-full bg-blue-600 px-8 text-white hover:bg-blue-500">
                Create your account
              </Button>
            </Link>
            <Link href="/auth/login" className="w-full sm:w-auto">
              <Button
                size="lg"
                variant="outline"
                className="w-full border-gray-700 px-8 text-gray-200 hover:bg-gray-800"
              >
                I already have an account
              </Button>
            </Link>
          </div>

          <p className="mt-4 text-sm text-gray-500">
            Free to start. No card required to publish your first video.
          </p>
        </div>
      </section>

      {/* ---------------- Stats strip ---------------- */}
      {/* Chaar stat cards - statically likhe gaye hain, koi loop nahi */}
      <section className="border-b border-gray-800 bg-gray-900/30">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card className="border-gray-800 bg-gray-900/60">
              <CardContent className="pt-6">
                <p className="text-sm text-gray-400">Uptime SLA</p>
                <p className="mt-1 text-2xl font-bold text-white">99.98%</p>
              </CardContent>
            </Card>
            <Card className="border-gray-800 bg-gray-900/60">
              <CardContent className="pt-6">
                <p className="text-sm text-gray-400">Edge regions</p>
                <p className="mt-1 text-2xl font-bold text-white">12</p>
              </CardContent>
            </Card>
            <Card className="border-gray-800 bg-gray-900/60">
              <CardContent className="pt-6">
                <p className="text-sm text-gray-400">Streams per day</p>
                <p className="mt-1 text-2xl font-bold text-white">48K</p>
              </CardContent>
            </Card>
            <Card className="border-gray-800 bg-gray-900/60">
              <CardContent className="pt-6">
                <p className="text-sm text-gray-400">Support response</p>
                <p className="mt-1 text-2xl font-bold text-white">&lt; 2h</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* ---------------- Product pillars ---------------- */}
      {/* Feature blocks - har block manually likha gaya hai, koi map loop nhi chalata */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight text-white">
            Built for creators who want the numbers to hold up
          </h2>
          <p className="mt-4 text-gray-400">
            Infrastructure decisions that normally get bolted on later are part of the product
            from day one.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Card className="border-gray-800 bg-gray-900/50">
            <CardContent className="pt-6">
              <PlayCircle className="h-6 w-6 text-blue-400" />
              <h3 className="mt-4 font-semibold text-white">Adaptive HLS streaming</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-400">
                2-second optimized fragments are served directly from the video bucket and CDN
                edge, so playback never routes through application compute.
              </p>
            </CardContent>
          </Card>

          <Card className="border-gray-800 bg-gray-900/50">
            <CardContent className="pt-6">
              <ShieldCheck className="h-6 w-6 text-green-400" />
              <h3 className="mt-4 font-semibold text-white">Verified signups only</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-400">
                Per-IP registration throttling keeps onboarding human-paced and stops automated
                abuse before it can leak into billing.
              </p>
            </CardContent>
          </Card>

          <Card className="border-gray-800 bg-gray-900/50">
            <CardContent className="pt-6">
              <Gauge className="h-6 w-6 text-purple-400" />
              <h3 className="mt-4 font-semibold text-white">Self-hosted observability</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-400">
                A custom console on port 3001 tracks egress, connection pools and container
                restarts with no paid vendor tooling in the loop.
              </p>
            </CardContent>
          </Card>

          <Card className="border-gray-800 bg-gray-900/50">
            <CardContent className="pt-6">
              <LineChart className="h-6 w-6 text-yellow-400" />
              <h3 className="mt-4 font-semibold text-white">Creator analytics</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-400">
                Revenue, watch time and retention per channel, exportable in clean formats for
                your finance team.
              </p>
            </CardContent>
          </Card>

          <Card className="border-gray-800 bg-gray-900/50">
            <CardContent className="pt-6">
              <Wallet className="h-6 w-6 text-emerald-400" />
              <h3 className="mt-4 font-semibold text-white">Transparent payouts</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-400">
                Clear ledger entries, buffer-aware balances, and a fixed share allocation
                recorded on every settlement run.
              </p>
            </CardContent>
          </Card>

          <Card className="border-gray-800 bg-gray-900/50">
            <CardContent className="pt-6">
              <Globe className="h-6 w-6 text-cyan-400" />
              <h3 className="mt-4 font-semibold text-white">Edge-first delivery</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-400">
                Static assets and video segments ship from the edge, keeping egress predictable
                and infrastructure cost bounded.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ---------------- Bottom CTA ---------------- */}
      {/* Secondary conversion block - Register primary, Login secondary */}
      <section className="border-t border-gray-800 bg-gray-900/40">
        <div className="mx-auto max-w-3xl px-6 py-16 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Ready to publish your first video?
          </h2>
          <p className="mt-3 text-gray-400">
            Create an account in under a minute, or log in and pick up where you left off.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link href="/auth/register" className="w-full sm:w-auto">
              <Button size="lg" className="w-full bg-blue-600 px-8 text-white hover:bg-blue-500">
                Register now
              </Button>
            </Link>
            <Link href="/auth/login" className="w-full sm:w-auto">
              <Button
                size="lg"
                variant="outline"
                className="w-full border-gray-700 px-8 text-gray-200 hover:bg-gray-800"
              >
                Log in
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ---------------- Footer ---------------- */}
      <footer className="border-t border-gray-800 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-sm text-gray-500 sm:flex-row">
          <p>&copy; {new Date().getFullYear()} Wideo11. All rights reserved.</p>
          {/* Auth links footer me bhi - accessibility aur easy navigation ke liye */}
          <nav className="flex items-center gap-4">
            <Link href="/auth/login" className="transition-colors hover:text-gray-300">
              Login
            </Link>
            <Link href="/auth/register" className="transition-colors hover:text-gray-300">
              Register
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
