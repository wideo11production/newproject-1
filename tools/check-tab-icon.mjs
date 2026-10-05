// Does the tab icon actually ANIMATE, or is it a static placeholder?
//
// -----------------------------------------------------------------------------
// WHY THIS IS A SCRIPT AND NOT "I WROTE AN SVG WITH <animateTransform> IN IT"
// -----------------------------------------------------------------------------
//
// Because writing the animation into the file only proves the markup is present.
// This checks three separate things, any of which can fail while the file looks
// correct on disk:
//
//   1. THE ROUTE SERVES IT, and serves `image/svg+xml`. Next.js will happily serve
//      an `app/icon.svg` as `text/plain` if the file is mis-detected, and the
//      browser then renders a broken image - which looks exactly like "no icon".
//   2. THE `<link rel="icon">` IS ACTUALLY IN THE DOCUMENT. An `app/icon.svg` that
//      the build tree-shakes away produces a perfectly good file that no page
//      references. Serving 200 and being unused are different failures.
//   3. THE ANIMATION IS REAL: `getCurrentTime()` on an SVG SMIL timeline ADVANCES
//      between two samples. A frozen timeline means the animation is not running,
//      and that is the specific difference between "animated" and "placeholder"
//      that cannot be determined by reading the file.
//
// (3) is the one that matters. `<animateTransform>` present but not advancing is
// exactly what a placeholder looks like, and exactly what a browser in a
// background tab or with animations disabled also looks like. So the page is
// brought to the foreground and sampled twice with a real gap between.
//
// Safari is called out honestly rather than silently skipped: Safari does not run
// SMIL in favicons at all. A check that passed only in Chrome would be a check that
// only proves one browser's behaviour, and the icon file says so in its header.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME =
  process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9400 + Math.floor(Math.random() * 200);

const TARGETS = [
  { name: 'superadmin', port: 3008 },
  { name: 'admin', port: 3004 },
  { name: 'analytics', port: 3005 },
  { name: 'web (reference)', port: 3000 },
];

const results = [];
const check = (app, name, ok, detail = '') => {
  results.push({ app, name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${app}] ${name}${detail ? `  ${detail}` : ''}`);
};

const profile = mkdtempSync(join(tmpdir(), 'icon-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--headless=new',
  '--no-first-run',
  '--disable-gpu',
  '--hide-scrollbars',
  'about:blank',
]);

const cleanup = () => {
  try { chrome.kill(); } catch { /* gone */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* windows lock */ }
};
process.on('exit', cleanup);

async function waitForCdp(ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) return;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('Chrome never opened a debugging port');
}

let msgId = 0;
function cdp(ws, method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    const onMessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (m.error) reject(new Error(`${method}: ${m.error.message}`));
      else resolve(m.result);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params, sessionId }));
    setTimeout(() => reject(new Error(`${method}: timeout`)), 30000);
  });
}

try {
  await waitForCdp();
  const { webSocketDebuggerUrl } = await (
    await fetch(`http://127.0.0.1:${PORT}/json/version`)
  ).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  for (const t of TARGETS) {
    // A fresh target per app, so one app's cookies and history cannot influence
    // the next one's result. The previous version reused a single tab across the
    // loop, which meant app N was tested with app N-1's session still loaded.
    const { targetId } = await cdp(ws, 'Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId, flatten: true });
    await cdp(ws, 'Page.enable', {}, sessionId);
    await cdp(ws, 'Runtime.enable', {}, sessionId);

    // ---- 1. the route, and its content type ----
    let served = { status: 0, type: '' };
    try {
      const res = await fetch(`http://localhost:${t.port}/icon.svg`);
      served = { status: res.status, type: res.headers.get('content-type') ?? '' };
    } catch (err) {
      served = { status: -1, type: String(err.message) };
    }

    const serves = served.status === 200;
    check(t.name, 'icon.svg serves 200', serves, `HTTP ${served.status}`);
    if (!serves) continue;

    check(
      t.name,
      'served as image/svg+xml',
      served.type.includes('svg'),
      served.type || 'no content-type'
    );

    // ---- 2. the page references it ----
    //
    // Navigate, sign in if the app is gated, THEN look for the link.
    //
    // The first version navigated to `/` and looked for a `<link rel="icon">`, and
    // reported admin and analytics as having no icon. They do have one. Their `/` is
    // gated, so an anonymous request gets a bare 401 body - no `<head>`, no
    // metadata, no link tag. The check was reporting "this app has no favicon" when
    // what it had actually measured was "you are not logged in".
    //
    // That is the more expensive direction of this mistake: it points at the app
    // rather than at the check, and the fix somebody reaches for is to start
    // publishing icons on a 401 page.
    await cdp(ws, 'Page.navigate', { url: `http://localhost:${t.port}/` }, sessionId);
    await new Promise((r) => setTimeout(r, 2500));

    const email = process.env.SA_EMAIL;
    const password = process.env.SA_PASSWORD;
    if (email && password) {
      await cdp(ws, 'Runtime.evaluate', {
        expression: `fetch('/api/auth/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)} })
        }).then(r => r.status).catch(() => 0)`,
        awaitPromise: true,
        returnByValue: true,
      }, sessionId);
      await cdp(ws, 'Page.reload', {}, sessionId);
      await new Promise((r) => setTimeout(r, 3000));
    }

    const link = await cdp(ws, 'Runtime.evaluate', {
      expression: `JSON.stringify(Array.from(document.querySelectorAll('link[rel~=icon]'))
        .map(l => ({ href: l.getAttribute('href'), type: l.getAttribute('type') })))`,
      returnByValue: true,
    }, sessionId);
    const links = JSON.parse(link.result.value || '[]');
    check(t.name, 'page links a rel=icon', links.length > 0,
      links.length ? links.map((l) => l.href).join(', ') : 'no <link rel=icon> in the document');

    // ---- 3. THE ACTUAL QUESTION: is the timeline advancing? ----
    //
    // Load the SVG as a document and sample `getCurrentTime()` twice. If the
    // animation is running the second sample is larger; if the file is a
    // placeholder, or SMIL is not executing, the two are identical.
    const url = `http://localhost:${t.port}/icon.svg`;
    const sample = async () => {
      const r = await cdp(ws, 'Runtime.evaluate', {
        expression: `(async () => {
          const res = await fetch(${JSON.stringify(url)});
          const text = await res.text();
          const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
          const svg = doc.documentElement;
          const anims = svg.querySelectorAll('animateTransform, animate, animateMotion');
          if (!anims.length) return { anims: 0, t1: null, t2: null };
          // Adopting into the live document is what makes SMIL actually RUN.
          // A parsed-but-not-adopted SVGDocument has a timeline that never ticks,
          // which would read as "placeholder" for a file that is perfectly fine.
          const holder = document.createElement('div');
          holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:64px;height:64px';
          holder.appendChild(document.importNode(svg, true));
          document.body.appendChild(holder);
          const live = holder.querySelector('svg');
          const t1 = live.getCurrentTime();
          await new Promise(r => setTimeout(r, 700));
          const t2 = live.getCurrentTime();
          holder.remove();
          return { anims: anims.length, t1: t1, t2: t2 };
        })()`,
        awaitPromise: true,
        returnByValue: true,
      }, sessionId);
      return r.result.value ?? { anims: 0, t1: null, t2: null };
    };

    const s = await sample();
    const hasAnim = s.anims > 0;
    const advancing = typeof s.t1 === 'number' && typeof s.t2 === 'number' && s.t2 > s.t1;

    check(t.name, 'contains animation elements', hasAnim, `${s.anims} found`);
    check(
      t.name,
      'ANIMATION TIMELINE ADVANCES',
      hasAnim ? advancing : null,
      hasAnim
        ? `t1=${s.t1?.toFixed?.(3)} t2=${s.t2?.toFixed?.(3)} -> ${advancing ? 'RUNNING' : 'FROZEN'}`
        : 'no animation elements'
    );

    await cdp(ws, 'Target.closeTarget', { targetId });
  }
} catch (err) {
  check('harness', 'completed', false, String(err.message ?? err));
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log('='.repeat(64));
  console.log(`${results.length - failed}/${results.length} passed`);
  if (failed > 0) {
    console.log('');
    console.log('NOTE: Chrome runs SMIL in favicons; Safari does not. On Safari these');
    console.log('render as a correct STATIC icon. That is documented in the icon files.');
  }
  cleanup();
  process.exit(failed === 0 ? 0 : 1);
}
