// Monitor root page - serves the metrics dashboard at "/"
//
// KYUN YE FILE ZAROORI THI:
// Monitor me sirf parallel route slots (@metrics, @telemetry) the - koi root
// "page.tsx" nahi tha. Isliye "/" par koi page serve hi nahi hota tha,
// healthcheck 404 fail hota tha, aur user ko kuch nahi dikhta.
//
// ---- BUG JO IS FILE NE INTRODUCE KIYA ----
//
// Pehle ye karta tha:
//
//     import MetricsDashboard from './@metrics/page'
//     export default function MonitorPage() { return <MetricsDashboard /> }
//
// Par layout me `@metrics` slot PEHLE SE render ho raha hai:
//
//     <main>{metrics}</main>     // <- @metrics, yahan
//     <aside>{telemetry}</aside>
//     {children}                 // <- aur page.tsx ka output YAHAN
//
// Matlab real metrics dashboard DO BAAR render ho raha tha - ek baar
// `<main>` me, aur ek baar `{children}` me - `children` layout me kahin
// visible position me nahi daala gaya, to browser me dikhta bhi nahi, par
// hydration ke dauraan dono instances mount hote the (har ek apna
// 15-second polling interval chalata rakhtha).
//
// ---- FIX ----
//
// Ek parallel slot ko route page se render karna SAHI tarika nahi hai: slot
// render karne ka kaam LAYOUT ka hai. Ye page ab kuch render nahi karta -
// layout ke paas @metrics hai, wo render karega, aur bas.
export default function MonitorPage() {
  return null;
}
