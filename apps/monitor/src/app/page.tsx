// Monitor root page - serves the metrics dashboard at "/"
//
// KYUN YE FILE ZAROORI THI:
// Monitor me sirf parallel route slots (@metrics, @telemetry) the - koi root
// "page.tsx" nahi tha. Isliye "/" par koi page serve hi nahi hota tha,
// healthcheck 404 fail hota tha, aur user ko kuch nahi dikhta.
//
// APPROACH:
// @metrics ek PARALLEL SLOT hai - wo apne aap URL segment nahi banata, balki
// root layout ke "metrics" prop me render hota hai. Isliye usse yahan call
// nahi kar sakte; uska default export import karke render karte hain.
// Isse "/" par wahi real dashboard dikhta hai jo live Prometheus data pull karta hai.
//
// Hinglish: parallel slot ko import karke root page par render kiya
import MetricsDashboard from './@metrics/page';

export default function MonitorPage() {
  // Wahi dashboard jo @metrics slot me hai - real Prometheus data ke saath
  return <MetricsDashboard />;
}
