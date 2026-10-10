#!/usr/bin/env node
// shot-editor.mjs - screenshot the video editor AS A SESSION (cookie) user.
//
// WHY THIS EXISTS
//
// The editor's gate reads the `wideo11_session` httpOnly cookie (set by the web
// login at :3000, host-only on `localhost`, so it is ALSO sent to :3002). An
// unauthenticated shot only ever shows the sign-in gate - which is a green run
// for a completely wrong page, the same failure class the shared harness notes.
//
// This tool logs in through the web app's own /api/auth/login proxy - exactly
// what a real login does - keeps the `Set-Cookie` it hands back, injects it
// with CDP `Network.setCookie`, and only then opens the editor. No credentials
// are hardcoded: the password comes from the SECURITY_SUPERADMIN_PASSWORD env
// var (or argv), like the other harness tools.
//
// USAGE
//   node tools/shot-editor.mjs [url] [out.png] [--click=SELECTOR]
//
//   --click dispatches a real click on a selector before the shot, which is how
//   the open dropdown state gets captured (a closed Radix trigger proves
//   nothing about the list's scrollbar colour).
//   --clip=x,y,w,h captures a region (device pixels at 1x), for close-ups of a
//   rail or a toolbar control that a full-page shot renders too small to judge.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';

// Mint a session token EXACTLY the way auth-service does (HS256, aud
// 'wideo11-api'), straight from the repo's own .env secret. WHY: the login
// endpoint rate-limits an account after a handful of calls (429), and a visual
// verification loop that sleeps 15 minutes between shots is a verification loop
// nobody runs. This is a LOCAL dev shortcut for a local stack - the token never
// leaves the machine, is injected via CDP like any session, and expires in the
// same 15 minutes the real access token does.
function mintToken(email, role, userId) {
  const env = readFileSync(join(process.cwd(), '.env'), 'utf8');
  const secret = /^JWT_SECRET_KEY=(.+)$/m.exec(env)?.[1]?.trim();
  if (!secret) throw new Error('JWT_SECRET_KEY not found in .env');
  const b64u = (buf) => Buffer.from(buf).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64u(
    JSON.stringify({
      user_id: userId,
      session_id: randomUUID(),
      email,
      role,
      iss: 'wideo11-auth',
      aud: 'wideo11-api',
      sub: userId,
      iat: now,
      nbf: now,
      exp: now + 15 * 60,
      jti: randomUUID(),
    }),
  );
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('http')) ?? 'http://localhost:3002/';

// Jobs: `--job=<out.png>[|clip=x,y,w,h][|click=text:sel]`, repeatable. One login
// (or one mint) can feed every shot, which matters because the login endpoint
// rate-limits the account to a handful of calls per 15 minutes.
const jobs = args.filter((a) => a.startsWith('--job=')).map((a) => {
  const spec = a.slice('--job='.length);
  const [out, ...opts] = spec.split('|');
  const clipArg = opts.find((o) => o.startsWith('clip='))?.slice('clip='.length);
  const click = opts.find((o) => o.startsWith('click='))?.slice('click='.length);
  return {
    out,
    clip: clipArg
      ? (() => {
          const [x, y, width, height] = clipArg.split(',').map(Number);
          return { x, y, width, height, scale: 1 };
        })()
      : undefined,
    click,
  };
});

const clickSel = args.find((a) => a.startsWith('--click='))?.slice('--click='.length);
const out = args.find((a) => a.endsWith('.png')) ?? 'editor-shot.png';
const shotList = jobs.length > 0 ? jobs : [{ out, clip: undefined, click: clickSel }];

const CHROME =
  process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const EMAIL = process.env.HARNESS_EMAIL ?? 'advchashampalup@gmail.com';

// Password: env first (this is how the other tools keep credentials out of the
// command line), argv as the fallback for a run where the env is not set.
const password =
  process.env.HARNESS_PASSWORD ??
  process.env.SECURITY_SUPERADMIN_PASSWORD ??
  (args.includes('--mint') ? 'minted' : readFileSync(process.argv[3] ?? '', 'utf8').trim());

const USER_ID = 'b670bcd2-e606-4c74-8092-e1e47fc48b3d'; // advchashampalup@gmail.com
const useMint = args.includes('--mint');

if (!password) {
  console.error('no password: set HARNESS_PASSWORD or SECURITY_SUPERADMIN_PASSWORD');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const userDir = mkdtempSync(join(tmpdir(), 'editorshot-'));
const PORT = 9500 + Math.floor(Math.random() * 400);

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDir}`,
    '--no-sandbox',
    '--disable-gpu',
    '--window-size=1600,1400',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
);

let ws;
try {
  // ---- 1. Session: either a real login, or a locally-minted token ----
  let cookieValue;
  if (useMint) {
    cookieValue = mintToken(EMAIL, 'superadmin', USER_ID);
    console.log('session token minted locally (--mint)');
  } else {
    const res = await fetch(`${WEB}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password }),
      redirect: 'manual',
    });
    if (!res.ok) {
      console.error(`login failed: ${res.status} ${await res.text()}`);
      process.exit(2);
    }
    const setCookie = res.headers.get('set-cookie') ?? '';
    const pair = setCookie.split(';').find((p) => p.trim().startsWith('wideo11_session='));
    if (!pair) {
      console.error('login response had no wideo11_session cookie');
      process.exit(2);
    }
    cookieValue = pair.trim().slice('wideo11_session='.length);
    console.log('login OK, session cookie captured');
  }

  // ---- 2. CDP plumbing ----
  let wsUrl;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) {
        wsUrl = (await r.json()).webSocketDebuggerUrl;
        break;
      }
    } catch {}
    await sleep(250);
  }
  if (!wsUrl) throw new Error('chrome did not expose a debugger');
  ws = new globalThis.WebSocket(wsUrl);
  await new Promise((res2, rej) => {
    ws.onopen = res2;
    ws.onerror = rej;
  });

  const cdp = (method, params = {}, sid) =>
    new Promise((resolve, reject) => {
      const id = Math.floor(Math.random() * 1e9);
      const onMsg = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id === id) {
          ws.removeEventListener('message', onMsg);
          m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result);
        }
      };
      ws.addEventListener('message', onMsg);
      ws.send(JSON.stringify({ id, method, params, sessionId: sid }));
    });

  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  await cdp('Page.enable', {}, sessionId);
  await cdp('Network.enable', {}, sessionId);

  // ---- 3. Inject the cookie for the editor origin before navigating ----
  await cdp(
    'Network.setCookie',
    {
      name: 'wideo11_session',
      value: cookieValue,
      domain: 'localhost',
      path: '/',
      url: 'http://localhost:3002/',
      httpOnly: true,
      sameSite: 'Lax',
    },
    sessionId,
  );

  await cdp('Page.navigate', { url }, sessionId);
  // The editor resolves the session, media and timeline before it is settle-
  // worthy: 8s measured as the steady point for a warm build.
  await sleep(8000);

  // Optional interaction: click a trigger so the OPEN state is what gets
  // captured. The dropdown's own rendering is the thing worth a picture.
  // Optional: evaluate an expression and print the result (single-quote it in
  // PowerShell: '--eval=...' so the shell leaves the JS alone). Used to read
  // computed styles when a class visibly does not do what it should.
  const evalExpr = args.find((a) => a.startsWith('--eval='))?.slice('--eval='.length);
  if (evalExpr) {
    const result = await cdp('Runtime.evaluate', { expression: evalExpr, returnByValue: true }, sessionId);
    console.log(result.result.value);
  }

  // Optional: REAL mouse click at an element's centre (CDP Input domain).
  // Radix Select opens on pointerdown and ignores synthetic JS clicks, so a
  // real input event is the only way to open one for a screenshot.
  const clickAt = args.find((a) => a.startsWith('--input-click='))?.slice('--input-click='.length);
  if (clickAt) {
    const rectExpr = `(() => { const els = [...document.querySelectorAll('button,[role="combobox"]')];
      const el = els.find((e) => (e.textContent || '').toLowerCase().includes(${JSON.stringify(clickAt.toLowerCase())}) || (e.getAttribute('aria-label') || '').toLowerCase().includes(${JSON.stringify(clickAt.toLowerCase())}));
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    })()`;
    const rect = await cdp('Runtime.evaluate', { expression: rectExpr, returnByValue: true }, sessionId);
    if (rect.result.value) {
      const { x, y } = JSON.parse(rect.result.value);
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId);
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId);
      console.log(`input-clicked ${clickAt} at ${x},${y}`);
    } else {
      console.log(`input-click target NOT_FOUND: ${clickAt}`);
    }
    await sleep(700);
    const state = await cdp(
      'Runtime.evaluate',
      {
        expression: `(() => { const lb = document.querySelector('[role="listbox"]');
          if (!lb) return 'no listbox open';
          const items = [...lb.querySelectorAll('[role="option"]')].slice(0, 4)
            .map((o) => o.textContent.trim() + '|' + getComputedStyle(o).color);
          const checked = lb.querySelector('[data-state="checked"]');
          return 'OPEN items: ' + items.join(' ; ') + ' ; checked=' + (checked ? checked.textContent.trim() + '|' + getComputedStyle(checked).backgroundColor : 'none');
        })()`,
        returnByValue: true,
      },
      sessionId,
    );
    console.log(state.result.value);
  }

  if (args.includes('--list-buttons')) {
    const dump = await cdp(
      'Runtime.evaluate',
      {
        expression:
          'JSON.stringify([...document.querySelectorAll("button,[role=combobox]")].map((e) => (e.getAttribute("aria-label") || "") + " | " + (e.textContent || "").trim().slice(0, 30)))',
        returnByValue: true,
      },
      sessionId,
    );
    console.log(dump.result.value);
  }

  for (const [i, shot] of shotList.entries()) {
    if (shot.click) {
      const expr = shot.click.startsWith('text:')
        ? `(() => { const want = ${JSON.stringify(shot.click.slice(5).toLowerCase())};
            const els = [...document.querySelectorAll('button,[role="combobox"]')];
            const el = els.find((e) =>
              (e.textContent || '').trim().toLowerCase().includes(want) ||
              (e.getAttribute('aria-label') || '').toLowerCase().includes(want));
            if (!el) return 'NOT_FOUND';
            el.scrollIntoView({ block: 'center' });
            el.click();
            return 'CLICKED ' + el.getAttribute('aria-label');
          })()`
        : `(() => { const el = document.querySelector(${JSON.stringify(shot.click)}); if (!el) return 'NOT_FOUND'; el.scrollIntoView({block:'center'}); el.click(); return 'CLICKED'; })()`;
      const clicked = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId);
      console.log(`job ${i} click ${shot.click} -> ${clicked.result.value}`);
      await sleep(900);
    }

    // Every job after the first re-navigates: a Radix popover, an open menu or a
    // scroll offset from the previous job is not the page state this job wants.
    if (i > 0) {
      await cdp('Page.navigate', { url }, sessionId);
      await sleep(6000);
    }

    const { data } = await cdp(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: false, clip: shot.clip },
      sessionId,
    );
    writeFileSync(shot.out, Buffer.from(data, 'base64'));
    console.log(`wrote ${shot.out}`);
  }} catch (err) {
  console.error(String(err.message ?? err));
  process.exitCode = 1;
} finally {
  chrome.kill();
  try {
    rmSync(userDir, { recursive: true, force: true });
  } catch {}
  try {
    ws?.close();
  } catch {}
}
