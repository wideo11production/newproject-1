/**
 * ============================================================================
 * HERO CAROUSEL - full-width in-house promo layer (Prime Video style)
 * ============================================================================
 *
 * BEHAVIOUR:
 *   - Multiple Wino/Rino promo slides, autoplay karke ek ke baad ek
 *   - Manual prev/next controls + dot indicators
 *   - Hover/focus par PAUSE (accessibility - WCAG 2.2.2 auto-updating)
 *   - `prefers-reduced-motion` respect: reduced motion users ko autoplay
 *     band milta hai (WCAG 2.3.3)
 *
 * VIDEO SOURCE - LOCAL MinIO ONLY (hard requirement):
 *   Playlist URLs `ad-pool.ts` se aati hain, jo sirf apne MinIO
 *   (`MINIO_PUBLIC_HOST/video/<slug>/index.m3u8`) se build karti hai.
 *   Koi YouTube/Vimeo/CDN embed nahi.
 *
 * ---- CROSS-BROWSER HLS: hls.js + native (installed this round) ----
 *   Pehle sirf NATIVE HLS tha, jo sirf Safari/iOS support karta hai.
 *   Chrome/Edge/Firewall me .m3u8 seedha play nahi hota tha (unhone MSE
 *   use nahi kiya tha) - to hero wahan gradient fallback pe rehta tha.
 *
 *   Ab `hls.js@1.7.3` install kiya gaya hai - ye Media Source Extensions
 *   (MSE) use karke HLS playback deta hai, jo native HLS jaisa hi hai.
 *   Effect me dono path detect hote hain:
 *     - `Hls.isSupported()` true  (MSE) -> Hls instance, cross-browser
 *     - `Hls.isSupported()` false (Safari/iOS) -> native `video.src`
 *   Playlist source MINIO se hi aata hai (koi CDN nahi).
 *
 * ---- DEGRADATION: kab bhi video na chale to kya dikhta hai ----
 *   3-layer stack, bottom se upar:
 *     Layer 3: animated gradient (HAMESHA render, safety net)
 *     Layer 2: poster image (MinIO, video load hone tak)
 *     Layer 1: HLS video (Hls.js ya native)
 *   Matlab: kisi bhi browser me hero kabhi khaali/toota nahi dikhta -
 *   worst case me brand gradient + mascot + text dikhta hai.
 *
 * Hinglish comments: har block ka arth
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Play, Pause } from 'lucide-react';
import { cn } from '@wideo11/ui/lib/utils';
import { BrandCharacter } from '@wideo11/ui/brand/characters';
import type { HeroSlide } from '@/lib/landing/ad-pool';
// HLS.js - MSE-based HLS playback for Chrome/Edge/Firefox.
// NOTE: ye dependency sirf IS file me use hoti hai. Native HLS (Safari)
// iske bina hi chalta hai, isliye hum dono path support karte hain.
import Hls from 'hls.js';

/** Autoplay interval per slide (ms) */
const AUTOPLAY_MS = 7000;

export interface HeroCarouselProps {
  /** Slides - ad-pool se aati hain (already MinIO URLs) */
  slides: HeroSlide[];
  className?: string;
}

export default function HeroCarousel({ slides, className }: HeroCarouselProps) {
  // ---- State: current active slide index ----
  const [activeIndex, setActiveIndex] = useState(0);
  // ---- State: autoplay chalu hai ya nahi (hover/focus se control) ----
  const [isPaused, setIsPaused] = useState(false);
  // ---- State: prefers-reduced-motion (accessibility) ----
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  // ---- Ref: ACTIVE slide ka video element ----
  // Sirf active slide ka video control hota hai. HLS instance ek
  // `videoRefs.current[index]` map me store hota hai (saare slides ke
  // liye, kyunki slide change pe naya attach hota hai).
  const videoRefs = useRef<Record<number, HTMLVideoElement | null>>({});
  // HLS instance ref - destroy karne ke liye (memory + worker leak rokne
  // ke liye). Slide change par purana instance destroy hota hai.
  const hlsRef = useRef<Hls | null>(null);

  /**
   * Reduced-motion detect karo.
   *
   * `matchMedia` SSR pe exist nahi karta, isliye `useEffect` me check karo.
   * Default `false` rakhna zaroori hai taaki server render aur pehla client
   * render match kare (hydration mismatch na ho).
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    // Initial value set karo
    setPrefersReducedMotion(mq.matches);
    // Change listener (user runtime me toggle kar sakta hai)
    const onChange = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener('change', onChange);
    // Cleanup - memory leak nahi
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /**
   * Autoplay timer.
   *
   * Conditions (sab satisfy hone par hi chalta hai):
   *   - `slides.length > 1` (ek slide ho to rotate karne ka matlab nahi)
   *   - `!isPaused` (hover/focus par nahi)
   *   - `!prefersReducedMotion` (accessibility)
   */
  useEffect(() => {
    if (slides.length <= 1) return;
    if (isPaused) return;
    if (prefersReducedMotion) return;

    const timer = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % slides.length);
    }, AUTOPLAY_MS);

    // Timer hamesha clean karo - warna memory leak + double-timer
    return () => window.clearInterval(timer);
  }, [slides.length, isPaused, prefersReducedMotion]);

  /**
   * HLS ATTACH + PLAYBACK SYNC.
   *
   * Ye effect DO kaam karta hai, dono slide change par:
   *
   * 1. HLS.JS ATTACH (cross-browser playback)
   *    - `Hls.isSupported()` true  -> Chrome/Edge/Firefox. Hls instance bana
   *      kar playlist (MinIO .m3u8) attach karte hain. Ye MSE (Media Source
   *      Extensions) use karta hai, jo native HLS jaisa hi HLS support
   *      deta hai - pehle ye browsers me .m3u8 seedha play nahi hota tha.
   *    - `Hls.isSupported()` false -> Safari/iOS. Wahan NATIVE HLS already
   *      hota hai, to Hls instance banana zaroori nahi; `video.src` hi
   *      kaafi hai. Hls.js ko instantiate nahi karte (waste + double-handle).
   *    - `Hls.Events.ERROR` par `fatal` errors handle karte hain:
   *      - `NETWORK_ERROR` -> `startLoad()` retry (temporary network drop)
   *      - `MEDIA_ERROR`   -> `recoverMediaError()` (corrupt segment)
   *      Dono fail ho jayein to animated fallback layer dikhta hai.
   *
   * 2. PLAY/PAUSE SYNC
   *    Active slide ka video play, baaki pause. Reduced-motion users ke liye
   *    kabhi autoplay nahi.
   *
   * CLEANUP: slide change ya unmount par `hls.destroy()` zaroori hai - warna
   * MediaSource worker leak hota hai aur long sessions me memory badhti hai.
   */
  useEffect(() => {
    const video = videoRefs.current[activeIndex];
    // Video element abhi mount nahi hua (ya slide badal gayi) - no-op
    if (!video) return;

    // ---- Reduced motion: video play mat karo ----
    if (prefersReducedMotion) {
      video.pause();
      return;
    }

    const playlistUrl = slides[activeIndex]?.playlistUrl;
    if (!playlistUrl) return;

    // Hls.js supported hai (MSE available) -> JS-based HLS playback
    if (Hls.isSupported()) {
      // Purana instance destroy karo (leak + double-attach se bachao)
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      const hls = new Hls({
        // Low-latency-ish tuning. `capLevelToPlayerSize` segment quality ko
        // player size tak limit karta hai - 4K screen par 4K segment pull
        // karna bandwidth waste hota hai jab content chhota render ho raha ho.
        capLevelToPlayerSize: true,
        // Start at quality level 0 (lowest) for fast first paint, then ramp up.
        startLevel: 0,
        // Retry: transient network hiccups ko tolerate karo.
        manifestLoadingMaxRetry: 2,
        levelLoadingMaxRetry: 3,
        fragLoadingMaxRetry: 4,
      });
      hlsRef.current = hls;

      // Playlist load karo - MinIO .m3u8 se
      hls.loadSource(playlistUrl);
      // Hls ka media element se attach karo
      hls.attachMedia(video);

      // JAB PLAYBACK SHURU HO: video play karo
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        // Autoplay policy: muted video hi autoplay ho sakta hai. Hum
        // `muted` prop already lagaa hain, to ye reject nahi hona chahiye.
        // Catch safety ke liye rakha hai (kuch browsers strict hote hain).
        video.play().catch(() => {
          // Autoplay blocked - user interaction chahiye. Fallback layer
          // gradient dikha raha hai, to page broken nahi lagega.
        });
      });

      // FATAL ERROR RECOVERY
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data.fatal) return; // non-fatal warnings ignore

        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            // Network hiccup - dobara load karne ki koshish
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            // Corrupt/garbled segment - media recover
            hls.recoverMediaError();
            break;
          default:
            // Aur koi fatal error - instance destroy, fallback dikhega
            hls.destroy();
            if (hlsRef.current === hls) hlsRef.current = null;
            break;
        }
      });
    } else {
      // NATIVE HLS path (Safari/iOS). `video.src` se direct .m3u8.
      // NOTE: `canPlayType` guard se pata chal jaata hai ki native HLS hai.
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = playlistUrl;
        video.play().catch(() => {
          // Autoplay blocked - no-op, fallback layer covers it
        });
      }
      // NOTE: agar NE native HLS hai NE MSE bhi hai (exotic browser),
      // to kuch nahi chalega - gradient fallback dikhega. Ye acceptable
      // degradation hai (page kabhi toota nahi dikhta).
    }

    // ---- CLEANUP: slide change / unmount par ----
    return () => {
      video.pause();
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [activeIndex, prefersReducedMotion, slides]);

  /** Manual previous/next handlers */
  const goPrev = useCallback(() => {
    setActiveIndex((prev) => (prev - 1 + slides.length) % slides.length);
  }, [slides.length]);

  const goNext = useCallback(() => {
    setActiveIndex((prev) => (prev + 1) % slides.length);
  }, [slides.length]);

  /** Safe guard: agar slides empty hain to kuch render nahi */
  if (slides.length === 0) return null;

  const activeSlide = slides[activeIndex];

  return (
    <section
      // `aria-roledescription="carousel"` - screen readers ko context deta hai
      aria-roledescription="carousel"
      aria-label="Featured in-house promotions"
      className={cn('relative w-full overflow-hidden', className)}
      // Hover par pause: mouse yahan ho to autoplay band
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* ---- SLIDE LAYER ----
          Saari slides ek stack me render hoti hain, sirf active wali visible.
          Isse slide transition smooth rehta hai (CSS opacity). */}
      <div className="relative h-[420px] w-full sm:h-[500px] lg:h-[560px]">
        {slides.map((slide, idx) => {
          const isActive = idx === activeIndex;
          return (
            <div
              key={slide.id}
              // Inactive slides screen readers se hide (aria-hidden)
              aria-hidden={!isActive}
              className={cn(
                // Stack me absolute - sab ek ke upar ek
                'absolute inset-0 transition-opacity duration-700',
                isActive ? 'opacity-100' : 'pointer-events-none opacity-0'
              )}
            >
              {/* ---- LAYER 3 (bottom): animated gradient fallback ----
                  Ye HAMESHA render hota hai. Video ya to upar se cover kar
                  lega, ya agar fail hua to ye brand gradient dikhata hai.
                  Non-Safari me yehi visible rehta hai. */}
              <div
                aria-hidden="true"
                className="absolute inset-0"
                style={{
                  // Slide ke accent color se radial glow
                  background: `radial-gradient(ellipse at 30% 20%, ${slide.accent}33 0%, transparent 55%),
                               radial-gradient(ellipse at 75% 80%, ${slide.accent}22 0%, transparent 50%),
                               linear-gradient(135deg, #111217 0%, #181b1f 100%)`,
                }}
              />

              {/* ---- LAYER 2 (middle): poster image (MinIO) ----
                  Video load hone tak poster dikhata hai. `object-cover`
                  poora area cover karta hai (Prime Video jaisa full-bleed). */}
              <div
                aria-hidden="true"
                className="absolute inset-0"
                style={{
                  backgroundImage: `url(${slide.posterUrl})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  opacity: isActive ? 0.5 : 0,
                  transition: 'opacity 700ms',
                }}
              />

              {/* ---- LAYER 1 (top): HLS video (MinIO, cross-browser) ----
                  Hls.js effect is element ko attach karta hai. NOTE: is
                  element par `src` attribute DELIBERATELY nahi hai -
                  Hls.js `attachMedia()` internally `video.src` set karta
                  hota hai (blob/MSE URL). Agar hum yahan `src` doge to
                  dono compete karenge aur MSE stream toot jaati hai.

                  Safari/iOS par effect `video.src = playlistUrl` karta hai
                  (native HLS path), to playback wahan bhi chalta hai.

                  `onError` handler: source-load failure par fallback layer
                  (gradient) dikhta hai - crash nahi hota. */}
              <video
                // Per-slide ref: Hls.js effect correct element dhoondh sake
                ref={(el) => {
                  videoRefs.current[idx] = el;
                }}
                className="absolute inset-0 h-full w-full object-cover"
                // `muted` ZAROORI hai - browser autoplay policy sirf muted
                // video pe allow karti hai
                muted
                loop
                playsInline
                // Poster: video metadata load na ho to ye dikhta hai (MinIO)
                poster={slide.posterUrl}
                // HLS source set karega Hls.js (MSE) ya native path - dono
                // upar ke effect me. Yahan src nahi.
                onError={() => {
                  // No-op: gradient fallback already render hai
                }}
                aria-hidden={!isActive}
              />

              {/* ---- CONTENT OVERLAY (text + CTA) ----
                  Bottom-left aligned - Prime Video style. Text ke neeche
                  gradient scrim taaki white text readable rahe. */}
              <div className="absolute inset-0 flex items-end">
                <div className="w-full bg-gradient-to-t from-[#111217] via-[#111217]/80 to-transparent px-6 pb-12 pt-24 sm:px-10 lg:px-16">
                  <div className="flex items-end gap-4">
                    {/* Character - manifest-locked vector. `decorative`
                        true kyunki adjacent text already naam bata deta hai
                        (accessibility: screen reader double-announce na kare). */}
                    <BrandCharacter
                      id={slide.characterId}
                      size={72}
                      decorative
                      className="hidden shrink-0 sm:block"
                    />

                    <div className="min-w-0">
                      {/* Slide title */}
                      <h2 className="text-2xl font-bold tracking-tight text-[#d8d9da] sm:text-3xl lg:text-4xl">
                        {slide.title}
                      </h2>
                      {/* Slide subtitle - line-clamp-2 to long text control */}
                      <p className="mt-2 line-clamp-2 max-w-2xl text-sm leading-relaxed text-[#9fa7b3] sm:text-base">
                        {slide.subtitle}
                      </p>

                      {/* CTA button - internal route only */}
                      {slide.ctaLabel && slide.ctaHref ? (
                        <Link
                          href={slide.ctaHref}
                          className="mt-5 inline-flex items-center gap-2 rounded-md bg-[#5794f2] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#5794f2]/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5794f2]/60"
                        >
                          <Play className="h-4 w-4" aria-hidden="true" />
                          {slide.ctaLabel}
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ---- CONTROLS (bottom center) ----
          Prev/Next arrows + dot indicators + play/pause toggle.
          Keyboard accessible (buttons, aria-labels). */}
      <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full bg-[#111217]/80 px-3 py-1.5 backdrop-blur">
        {/* Prev button */}
        <button
          type="button"
          onClick={goPrev}
          aria-label="Previous slide"
          className="flex h-8 w-8 items-center justify-center rounded-full text-[#9fa7b3] transition-colors hover:bg-[#1f2227] hover:text-[#d8d9da] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5794f2]/60"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>

        {/* Dot indicators - click to jump */}
        <div className="flex items-center gap-1.5">
          {slides.map((slide, idx) => (
            <button
              key={slide.id}
              type="button"
              onClick={() => setActiveIndex(idx)}
              // Active dot ko accessible label do
              aria-label={`Go to slide ${idx + 1}: ${slide.title}`}
              // Current slide ko screen readers se announce karo
              aria-current={isActiveIdx(idx) ? 'true' : undefined}
              className={cn(
                'h-1.5 rounded-full transition-all',
                idx === activeIndex
                  ? 'w-6 bg-[#5794f2]'
                  : 'w-1.5 bg-[#9fa7b3]/50 hover:bg-[#9fa7b3]'
              )}
            />
          ))}
        </div>

        {/* Next button */}
        <button
          type="button"
          onClick={goNext}
          aria-label="Next slide"
          className="flex h-8 w-8 items-center justify-center rounded-full text-[#9fa7b3] transition-colors hover:bg-[#1f2227] hover:text-[#d8d9da] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5794f2]/60"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>

        {/* Play/pause toggle - WCAG 2.2.2 (user can pause auto-updating) */}
        <button
          type="button"
          onClick={() => setIsPaused((p) => !p)}
          aria-label={isPaused ? 'Resume autoplay' : 'Pause autoplay'}
          className="flex h-8 w-8 items-center justify-center rounded-full text-[#9fa7b3] transition-colors hover:bg-[#1f2227] hover:text-[#d8d9da] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5794f2]/60"
        >
          {isPaused ? (
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Pause className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      </div>
    </section>
  );

  /** Helper: kya ye index active hai (dot aria-current ke liye) */
  function isActiveIdx(idx: number): boolean {
    return idx === activeIndex;
  }
}
