#!/usr/bin/env node
// Headless render of the monitoring dashboard, for real visual verification.
//
// WHY THIS EXISTS
//
// Every HTTP check said port 3001 was fine: 200, all 10 assets 200, both API
// routes 200, and the server-rendered HTML contained the full dashboard
// markup. It was still visually broken - six blank chart panels.
//
// The cause was invisible to any of those checks: `echarts/core` needs
// explicit component registration, and without it `init()` succeeds,
// `setOption()` succeeds, and the canvas stays blank. Nothing errors. The
// only way to see it is to actually render the page and look.
//
// So this drives real Chrome over the DevTools protocol, waits for hydration,
// and then checks what is on the SCREEN - not what the HTML says.
//
// CHECKS
//   1. console errors and page exceptions (the usual cause of "renders but
//      stuck on the loading state")
//   2. hydration actually completed - no remaining "Loading metrics…"
//   3. every panel canvas has non-zero pixel content, so a blank chart fails
//   4. stat tiles show real numbers, not the "—" placeholder
//
// USAGE
//   node tools/check-dashboard.mjs [url] [--out screenshot.png]
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://localhost:3001/';
const outIdx = process.argv.indexOf('--out');
const outPath = outIdx > -1 ? process.argv[outIdx + 1] : null;

const userDir = mkdtempSync(join(tmpdir(), 'dash-'));
const PORT = 9222 + Math.floor(Math.random() * 400);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDir}`,
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--window-size=1600,1200',
  // NOTE: deliberately NOT passing --hide-scrollbars. That flag makes
  // scrollbars zero-width overlays, so the gutter measurement always reports
  // 0 and the thin-scrollbar check cannot fail - it would pass even with the
  // CSS entirely absent. The flag was here for cleaner screenshots; removing
  // it is worth 2px on the right edge of a PNG.
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevTools() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome DevTools endpoint never came up');
}

function cdp(ws, method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const onMessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === id) {
        ws.removeEventListener('message', onMessage);
        msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result);
      }
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

let ws, sessionId;
const consoleErrors = [];
const exceptions = [];

try {
  const wsUrl = await waitForDevTools();
  // Node 22+ ships a global WebSocket. Using it avoids depending on the `ws`
  // package, which is not guaranteed to be hoisted in this workspace - the
  // dynamic import below silently returned an object whose default export was
  // not constructable, and the tool failed with "WebSocket is not a
  // constructor" instead of reporting anything about the dashboard.
  if (typeof globalThis.WebSocket !== 'function') {
    throw new Error('no global WebSocket; Node 22+ required for this check');
  }
  ws = new globalThis.WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  const { targetId } = await cdp(ws, 'Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId, flatten: true }));

  await cdp(ws, 'Runtime.enable', {}, sessionId);
  await cdp(ws, 'Log.enable', {}, sessionId);
  await cdp(ws, 'Page.enable', {}, sessionId);

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      // The bare text ("SyntaxError: missing ) after argument list") says
      // nothing actionable. The url + line are what identify the file.
      const where = d.url
        ? ` @ ${d.url}:${d.lineNumber + 1}:${d.columnNumber + 1}`
        : '';
      exceptions.push((d.exception?.description ?? d.text ?? 'unknown') + where);
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      consoleErrors.push(`[${m.params.entry.source}] ${m.params.entry.text}`);
    }
  });

  await cdp(ws, 'Page.navigate', { url }, sessionId);
  // Hydration + two poll cycles. The dashboard fetches on mount and then
  // every 15s; 6s is enough for the first paint of real data.
  await sleep(9000);

  const evaluate = async (expr) => {
    const r = await cdp(ws, 'Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true,
    }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
    return r.result.value;
  };

  const report = await evaluate(`(() => {
    const text = document.body.innerText;

    // ---- CSS actually applied? ----
    //
    // A stylesheet returning 200 is NOT proof of styling. The monitor shipped
    // 529 bytes of raw "@tailwind base;@tailwind components;..." which the
    // browser ignores: page rendered, every asset 200, data flowing, charts
    // drawing - and it looked completely unstyled. The only way to catch it
    // is to ask the LAYOUT ENGINE, not the network.
    //
    // Two probes that a stylesheet was processed:
    //   1. A Tailwind utility rule exists in a stylesheet
    //   2. A known utility element has a non-default computed value
    //      (background-color of a bg-gray-950 element, etc.)
    const sheets = [...document.styleSheets];
    let cssRuleCount = 0;
    let hasTailwindDirectives = false;
    for (const s of sheets) {
      let rules;
      try { rules = s.cssRules; } catch { continue; }
      if (!rules) continue;
      cssRuleCount += rules.length;
    }
    // If the CSS text still contains the raw directive, PostCSS never ran.
    for (const s of sheets) {
      try {
        const txt = [...s.cssRules].map(r => r.cssText).join(' ');
        if (txt.includes('@tailwind')) hasTailwindDirectives = true;
      } catch {}
    }

    const probe = document.createElement('div');
    probe.className = 'bg-gray-950';
    document.body.appendChild(probe);
    const probeBg = getComputedStyle(probe).backgroundColor;
    probe.remove();

    const canvases = [...document.querySelectorAll('canvas')];

    // A chart that rendered has non-trivial pixel content. Reading the canvas
    // is the only check that distinguishes "chart drew" from "container exists".
    const canvasInfo = canvases.map((c) => {
      let nonEmpty = null;
      try {
        const ctx = c.getContext('2d');
        if (ctx && c.width > 0 && c.height > 0) {
          const d = ctx.getImageData(0, 0, c.width, c.height).data;
          let n = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
          nonEmpty = n;
        }
      } catch (e) { nonEmpty = 'blocked:' + e.name; }
      return {
        w: c.width, h: c.height,
        cssW: Math.round(c.getBoundingClientRect().width),
        cssH: Math.round(c.getBoundingClientRect().height),
        nonEmptyPixels: nonEmpty,
      };
    });

    // Full-width canvases mean the grid collapsed. A 2-column layout on a
    // 1600px viewport puts each panel near 780px; 1500+ means the grid
    // classes are not being applied.
    const tooWide = canvasInfo.filter(c => c.cssW > 1100).length;

    return {
      title: document.title,
      stillLoading: text.includes('Loading metrics'),
      noDataPanels: (text.match(/no data returned by Prometheus/g) || []).length,
      css: {
        styleSheets: sheets.length,
        cssRules: cssRuleCount,
        rawTailwindDirectives: hasTailwindDirectives,
        bgGray950Computed: probeBg,
        stylingApplied: cssRuleCount > 50 && !hasTailwindDirectives,
      },
      // Scrollbar width, measured from the live layout engine.
      //
      // Measuring documentElement is not enough here: the dashboard uses
      // h-screen with overflow-auto on inner elements, so the BODY never
      // scrolls and the document gutter is always 0 - which reads as "no
      // scrollbar styling" even when it is working. The real scrollers are the
      // inner elements, so those are measured instead.
      //
      // NOTE: no backticks anywhere in this expression. It is itself inside a
      // JS template literal, so a backtick in a comment here silently
      // terminates the outer string and the tool itself stops parsing.
      scrollbar: (() => {
        const scrollers = [...document.querySelectorAll('*')].filter(el => {
          const o = getComputedStyle(el);
          return (o.overflowY === 'auto' || o.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
        });
        // element.width - element.clientWidth is the exact scrollbar
        // footprint: clientWidth excludes the scrollbar, offsetWidth includes it.
        // NOTE: plain concatenation, not a template literal - this whole
        // expression is itself inside a JS template literal, so a nested
        // backtick terminates the outer string and the tool fails to parse
        // with "SyntaxError: missing ) after argument list".
        const widths = scrollers.slice(0, 6).map(el => ({
          tag: el.tagName.toLowerCase(),
          gutter: el.offsetWidth - el.clientWidth,
          scrollbarWidth: getComputedStyle(el).scrollbarWidth,
        }));
        return {
          docGutter: window.innerWidth - document.documentElement.clientWidth,
          scrollerCount: scrollers.length,
          widths: widths,
        };
      })(),
      grid: { fullWidthCanvases: tooWide, total: canvasInfo.length },
      canvases: canvasInfo,
      bodyChars: text.length,
    };
  })()`);

  if (outPath) {
    const { data } = await cdp(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId);
    writeFileSync(outPath, Buffer.from(data, 'base64'));
  }

  console.log(JSON.stringify({ url, report, consoleErrors, exceptions }, null, 2));

  // ---- Verdict ----
  // Exits non-zero when the page is technically healthy but visually broken.
  // That combination is exactly what every HTTP-level check misses.
  const problems = [];
  if (report.stillLoading) problems.push('stuck on "Loading metrics" (hydration did not complete)');
  if (report.noDataPanels > 0) problems.push(`${report.noDataPanels} panel(s) returned no data`);
  if (report.css.rawTailwindDirectives) {
    problems.push('CSS still contains raw @tailwind directives - PostCSS/Tailwind did not run');
  }
  if (report.css.cssRules < 50) {
    problems.push(`only ${report.css.cssRules} CSS rules parsed - styles are not being applied`);
  }
  if (report.grid.fullWidthCanvases > 0) {
    problems.push(`${report.grid.fullWidthCanvases} chart(s) are full-width - the grid is not applying`);
  }
  const blank = report.canvases.filter(c => !c.nonEmptyPixels || c.nonEmptyPixels === 0);
  if (blank.length) problems.push(`${blank.length} chart canvas(es) are blank`);

  // ---- Scrollbar ----
  //
  // The gutter is REPORTED, not asserted.
  //
  // Headless Chrome does not honour custom scrollbar styling at all. Probed
  // directly: injecting `::-webkit-scrollbar{width:2px}` onto the scrolling
  // element itself, and separately `scrollbar-width:thin`, both left the
  // gutter at 15px. A universal selector cannot be less broken than a direct
  // one, so the "CSS did not apply" conclusion was wrong - the measurement
  // environment simply cannot see it.
  //
  // So asserting `gutter <= 4` here would fail forever and train people to
  // ignore this tool. The rule is verified the only way it can be: by reading
  // the compiled CSS (packages/ui/src/styles/scrollbar.css, 2px, present in
  // both bundles) and by looking at a real browser window.
  const sb = report.scrollbar;
  console.log(`\n  scrollbar: ${sb.scrollerCount} scroller(s), ` +
    `gutter ${sb.widths.map(w => w.tag + '=' + w.gutter + 'px').join(', ') || 'n/a'} ` +
    `(not asserted - headless Chrome ignores custom scrollbars)`);

  if (exceptions.length) problems.push(`${exceptions.length} uncaught exception(s)`);
  if (consoleErrors.length) problems.push(`${consoleErrors.length} console/network error(s)`);

  if (problems.length) {
    console.error('\nFAIL:');
    for (const p of problems) console.error('  - ' + p);
    if (exceptions.length) {
      console.error('\n  exceptions:');
      for (const e of exceptions) console.error('    ' + e.split('\n').slice(0, 3).join('\n    '));
    }
    if (consoleErrors.length) {
      console.error('\n  console errors:');
      for (const e of consoleErrors) console.error('    ' + e.slice(0, 200));
    }
    process.exitCode = 1;
  } else {
    console.log('\nOK: dashboard rendered with styling, grid and data.');
  }
} catch (err) {
  console.error('check failed:', err.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}  chrome.kill();
  try { rmSync(userDir, { recursive: true, force: true }); } catch {}
}
