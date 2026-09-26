// Default fallback for the @dashboard parallel route slot.
//
// Kyun zaroori hai: @dashboard sirf /dashboard par resolve hota hai. Jab user kisi
// doosre page se soft navigation (next/link) ke through "/" par aata hai, to us slot
// ke liye koi page match nahi hota - aur default.tsx ke bina Next.js us slot par
// 404 return kar deta tha. Yahi "click karne par 404" wala behaviour tha.
//
// Ye file null return karti hai, kyunki root layout in slots ko render hi nahi karta
// (layout unhe props me accept karta hai par JSX me use nahi karta). Isliye landing
// page par koi editor canvas ya dashboard panel render nahi hoga.
//
// Hinglish: default fallback se soft navigation par 404 nahi aayega.
export default function DashboardSlotDefault() {
  return null;
}
