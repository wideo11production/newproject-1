// Advertising law constants + ad types
//
// ============================================================================
// CONTRACT WITH SERVER (IMPORTANT)
// ============================================================================
// Ye values CLIENT side hain sirf UI behaviour control karne ke liye
// (min/max view duration, MRC threshold).
//
// ASLI PAISA KA HISAAB KABHI YAHAN NAHI HOTA.
// Billing-service (ad-economics.go) server pe calculate karta hai aur
// business_laws_test.go us lock karta hai:
//     Viewer 60% | Creator 20% (subscribed) | Platform 20%
//     Free creator: Viewer 60% | Creator 10% | Platform 30%
//     Sister share 5% (ledger) | INR 2000 buffer masked
//
// Agar yahan koi percentage likh dete to wo UI ka sirf decoration hota,
// actual payout server wahi hota. Isliye percentage YAHAN jaan-boojh kar
// nahi rakhi - sirf viewability/UX rules rakhi hain.
//
// Hinglish: yahan sirf dikhne wale rules; paisa hamesha server pe
export const AD_LAWS = {
  /** MRC industry standard: minimum 2 second view time */
  minViewSeconds: 2,

  /** Randomized duration range - bot fixed-timing guess na kar sake */
  minDurationSeconds: 5,
  maxDurationSeconds: 20,

  /** MRC viewability: 50% pixels visible hone chahiye */
  minPixelVisibility: 50,

  /** Ad impression tab-hidden ya pixel-starve ho to count NAHI hota */
  requireVisibleTab: true,

  /** NOTE: revenue split percentages INTENTIONALLY yahan nahi hain.
   *  Wo server-side (billing-service) hain - single source of truth. */
} as const;

/** Ad slot types - placement ke hisaab se */
export type AdSlot =
  | 'feed'
  | 'video-detail'
  | 'channel-page'
  | 'search-results'
  | 'dashboard'
  | 'sidebar';

/** Ek ad creative - in-house, koi third party nahi */
export interface AdCreative {
  id: string;
  title: string;
  body: string;
  ctaLabel?: string;
  /** Optional click-through (internal route - external nahi) */
  ctaHref?: string;
  /** Advertiser - internal creator ya self-promoted */
  advertiser: string;
  /** Campaign id - revenue ledger se link */
  campaignId: string;
}

/** Ad view ka measured record */
export interface AdViewRecord {
  adId: string;
  slotId: AdSlot;
  /** Kitne second dekha (randomized duration) */
  duration: number;
  /** Kitne % pixels visible the */
  pixelVisibility: number;
  /** Count hua ya nahi (MRC compliant) */
  counted: boolean;
}

/**
 * Sample creatives - sirf DEMO/placeholder.
 *
 * NOTE: Ye koi real advertiser data nahi hai. Production me ye billing-service
 * ke campaign table se aayega. Ye in-house infrastructure hai, isliye koi
 * third-party ad network fetch NAHI hota - zero cost.
 *
 * Hinglish: demo creatives - real me campaign table se aayenge
 */
export const DEMO_CREATIVES: Record<AdSlot, AdCreative> = {
  feed: {
    id: 'demo-feed-1',
    title: 'Creator Tip: Fix your audio in 2 minutes',
    body: 'Use the audio panel to normalize loudness across every clip.',
    ctaLabel: 'Open editor',
    advertiser: 'Wideo11 Creator Academy',
    campaignId: 'demo-campaign-1',
  },
  'video-detail': {
    id: 'demo-detail-1',
    title: 'Grow your channel with better thumbnails',
    body: 'Templates panel has 40+ ready-made thumbnail layouts.',
    ctaLabel: 'View templates',
    advertiser: 'Wideo11 Templates',
    campaignId: 'demo-campaign-2',
  },
  'channel-page': {
    id: 'demo-channel-1',
    title: 'Wino, Mino and Rino are live',
    body: 'New mascot series now in the templates panel.',
    advertiser: 'Wideo11',
    campaignId: 'demo-campaign-3',
  },
  'search-results': {
    id: 'demo-search-1',
    title: 'Featured: 5000 trending reels',
    body: 'Explore what is trending this week on Wideo11.',
    ctaLabel: 'Browse reels',
    advertiser: 'Wideo11',
    campaignId: 'demo-campaign-4',
  },
  dashboard: {
    id: 'demo-dash-1',
    title: 'Your earnings are ready',
    body: 'Check the analytics panel for this month revenue split.',
    ctaLabel: 'View analytics',
    advertiser: 'Wideo11 Analytics',
    campaignId: 'demo-campaign-5',
  },
  sidebar: {
    id: 'demo-sidebar-1',
    title: 'Refer a creator',
    body: 'Both of you get credited in the ledger.',
    ctaLabel: 'Invite',
    advertiser: 'Wideo11',
    campaignId: 'demo-campaign-6',
  },
};
