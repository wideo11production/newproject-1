// Default fallback for the @analytics parallel route slot.
//
// @analytics sirf apne matching route par resolve hota hai. "/" jaise un-matched
// routes par soft navigation (next/link) karne par, default.tsx ke bina Next.js is
// slot ke liye 404 return kar deta tha - jisse poori page 404 ho jati thi.
//
// Root layout in slots ko render nahi karta, isliye null return karna sahi hai -
// isse landing page par analytics panel leak nahi hoga.
//
// Hinglish: default fallback se soft navigation par 404 nahi aayega.
export default function AnalyticsSlotDefault() {
  return null;
}
