// Health endpoint - container healthcheck ke liye.
//
// ----------------------------------------------------------------------------
// YE ROUTE KYUN ZAROORI HAI
// ----------------------------------------------------------------------------
//
// Compose me healthcheck pehle ye tha:
//
//     wget --spider -q http://127.0.0.1:3002/ || exit 1
//
// Wo HAR BAAR fail ho raha tha (352 consecutive failures), jabki app bilkul
// theek chal raha tha. Do wajah thi, dono ek saath:
//
//   1. Auth gate. `src/middleware.ts` har page request par session check karta
//      hai, aur bina session ke `/` ko `http://localhost:3000/auth/register`
//      par 307 bhej deta hai. Yaani healthcheck ko 200 nahi, REDIRECT milta hai.
//
//   2. `wget --spider` non-2xx (ya redirect) ko FAILURE samajhta hai. Isi liye
//      web app ka healthcheck `/auth/login` hit karta hai - wo public page hai
//      aur 200 deta hai. Wahi trick yahan kaam nahi karegi kyunke editor ka koi
//      bhi page bina session ke 200 nahi deta.
//
// Confirm kiya gaya: container ke andar node se `http://127.0.0.1:3002/` par
// 307 milta hai - matlab server CHAL raha hai, sirf check galat hai.
//
// ----------------------------------------------------------------------------
// ISLIYE
// ----------------------------------------------------------------------------
//
// `api/` route gate ke matcher se bahar hai (deliberately - JSON ko HTML
// redirect bechne se accha 401 hai), to ye route bina session ke seedha 200
// deta hai. Healthcheck ab yahi hit karta hai.
//
// Ye sirf "server up hai" batata hai. Dependencies (auth/dashboard) ki jaanch
// jaan-boojh kar nahi hoti - ek hard dependency down hone par editor ko restart
// karne ka koi matlab nahi, wo sirf us feature ko unavailable banata hai.
//
// Hinglish comments: har block ka arth
import { NextResponse } from 'next/server';

// Kuch Next.js setups is route ko static export me build karne ki koshish
// karte hain, jismein runtime env read nahi hota. Dynamic mark karna isse
// rokta hai - aur saath hi ye guarantee deta hai ki route har request par
// actually chalta hai.
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      service: 'video-editor',
      // Timestamp sirf debugging ke liye - isse koi parse nahi karta, isliye
      // ise health decision ka hissa mat samajhna.
      time: new Date().toISOString(),
    },
    {
      // No-store: warna proxy ne 200 ko cache kar liya to container down hone
      // ke baad bhi healthcheck pass karta rehta.
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
