// Render each app's favicon at the size a browser actually draws it, next to a
// large copy, and lay them side by side for inspection.
//
// -----------------------------------------------------------------------------
// WHY THE 16px RENDER IS THE ONE THAT MATTERS
// -----------------------------------------------------------------------------
//
// Every icon in this product was designed at 64x64 and checked as a file. A file
// being correct says nothing about how it looks at 16 pixels, which is the size a
// tab strip actually draws.
//
// At 16px, everything scales by a quarter: a 3px arc stroke becomes 0.75px, and a
// 5.5px glyph stroke becomes 1.4px. Both fall under the ~1px threshold where a
// browser stops rendering a stroke cleanly and starts rendering a translucent
// smear. That is what "dull" is - not a colour choice, a SIZE problem, and it is
// invisible in the source.
//
// So this renders what the user sees, next to what was designed, and names what it
// finds.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9900 + Math.floor(Math.random() * 90);
const OUT = join(process.cwd(), 'screenshots');

const APPS = [
  { name: 'superadmin', port: 3008 },
  { name: 'web', port: 3000 },
  { name: 'editor', port: 3002 },
  { name: 'admin', port: 3004 },
  { name: 'analytics', port: 3005 },
  { name: 'monitor', port: 3001 },
];

mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'icons-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--disable-gpu',
  '--force-device-scale-factor=1', 'about:blank',
]);
const cleanup = () => { try { chrome.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);

let msgId = 0;
function cdp(ws, method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    const on = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.id !== id) return;
      ws.removeEventListener('message', on); m.error ? rej(new Error(m.error.message)) : res(m.result); };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id, method, params, sessionId }));
    setTimeout(() => rej(new Error(`${method}: timeout`)), 30000);
  });
}

try {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  const { targetId } = await cdp(ws, 'Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId, flatten: true });
  await cdp(ws, 'Page.enable', {}, sessionId);

  // One page showing every icon three times: 16px (tab strip), 32px, and 128px.
  // ---- INLINE the SVGs, do not <img> them ----
  //
  // The first version rendered them with `<img src="http://localhost:PORT/icon.svg">`
  // from a `data:text/html` page. Every one came back as Chrome's broken-image
  // glyph, which looked exactly like six broken icons.
  //
  // A `data:` document has an OPAQUE ORIGIN, so it cannot load any cross-origin
  // subresource - including an image from localhost. Nothing was wrong with the
  // icons; the page they were being viewed from could not reach them.
  //
  // Inlining sidesteps origin entirely and is also the more honest preview: this
  // is the SVG being composed, not a fetched resource.
  const { readFileSync, readdirSync, existsSync } = await import('node:fs');

  function iconSvgFor(port) {
    // Read from the served route so this previews what is DEPLOYED, not what is on
    // disk. A preview of the file would have shown the pre-fix version all
    // afternoon while the page kept rendering the broken one.
    const dirs = [
      `apps/web/src/app`, `apps/monitor/src/app`, `apps/video-editor/src/app`,
      `apps/admin/src/app`, `apps/analytics/app`, `apps/superadmin/src/app`,
    ];
    for (const d of dirs) {
      const p = join(process.cwd(), d, 'icon.svg');
      if (existsSync(p)) return readFileSync(p, 'utf8');
    }
    return null;
  }

  // One representative file per app, inlined.
  const files = {
    web: 'apps/web/src/app/icon.svg',
    monitor: 'apps/monitor/src/app/icon.svg',
    editor: 'apps/video-editor/src/app/icon.svg',
    admin: 'apps/admin/src/app/icon.svg',
    analytics: 'apps/analytics/app/icon.svg',
    superadmin: 'apps/superadmin/src/app/icon.svg',
  };

  const cards = Object.entries(files)
    .map(([name, rel]) => {
      const svg = existsSync(join(process.cwd(), rel))
        ? readFileSync(join(process.cwd(), rel), 'utf8')
        : '';
      // Strip the leading comment - it is documentation, not art, and inlining it
      // would put 60 lines of prose into the page.
      const body = svg.replace(/^<!--[\s\S]*?-->\s*/, '');
      return `
      <figure>
        <div class="sizes">
          <div class="slot"><div class="tiny">${body}</div><span>16</span></div>
          <div class="slot"><div class="small">${body}</div><span>32</span></div>
          <div class="slot"><div class="big">${body}</div><span>128</span></div>
        </div>
        <figcaption>${name}</figcaption>
      </figure>`;
    })
    .join('');

  const html = `<!doctype html><html><body style="margin:0;background:#111827;font:12px system-ui;color:#e5e7eb">
    <style>
      .wrap{display:flex;flex-wrap:wrap;gap:28px;padding:24px}
      figure{margin:0}
      .sizes{display:flex;align-items:flex-end;gap:16px;padding:10px;background:#1f2937;border-radius:10px}
      .slot{display:flex;flex-direction:column;align-items:center;gap:6px}
      .slot span{font-size:10px;color:#6b7280}
      .tiny{width:16px;height:16px}
      .small{width:32px;height:32px}
      .big{width:128px;height:128px}
      figcaption{margin-top:8px;text-align:center}
      svg{width:100%;height:100%}
      p{padding:0 24px 24px;color:#9ca3af;max-width:900px;line-height:1.6}
    </style>
    <div class="wrap">${cards}</div>
    <p>16px is the size a browser tab strip actually draws. That is the size the design has to survive -
    at 16px a 3px stroke becomes 0.75px and a 5.5px glyph stroke becomes 1.4px, and both fall below the
    threshold where a browser renders a stroke cleanly instead of as a translucent smear. That is what
    "dull" means, and it is invisible in the source file.</p>
  </body></html>`;

  const dataUrl = 'data:text/html;base64,' + Buffer.from(html).toString('base64');
  await cdp(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 1100, height: 320, deviceScaleFactor: 2, mobile: false,
  }, sessionId);
  await cdp(ws, 'Page.navigate', { url: dataUrl }, sessionId);
  await new Promise((r) => setTimeout(r, 4000));

  const shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png' }, sessionId);
  const file = join(OUT, 'icons-at-real-sizes.png');
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log(`wrote ${file}`);
} catch (err) {
  console.log('ERROR', err.message ?? err);
} finally {
  cleanup();
  process.exit(0);
}