// Shared browser harness for the channel checks.
//
// =============================================================================
// WHY THIS EXISTS, AND WHY IT WAS THE THIRD COPY
// =============================================================================
//
// `check-channel-wizard.mjs`, `check-channel-cover.mjs` and `check-channel-setup.mjs`
// each grew their own Chrome launcher, CDP plumbing and sign-in routine. All three
// were individually fine. They had still drifted - in log-in behaviour, in how they
// waited, and in what they reported when a step failed.
//
// The drift became load-bearing the moment the compulsory step-2 gate landed:
//
//   check-channel-cover.mjs opens the dashboard to click "Create channel"
//   -> the gate redirects a creator whose newest channel is unfinished
//   -> 15 of 23 checks fail
//
// Nothing was broken. The dashboard was doing exactly what it was built to do, and
// the harness had never had to cope with it because the gate did not exist.
//
// The fix is not "add a redirect step to the cover check". That would be the third
// copy of the answer, in the same class as the third copy of the three-step upload
// flow that read `ticket.upload_url` and made cover upload fail 100% of the time.
//
// So: one harness, and every check asks it the same two questions -
//   - can I open a browser and sign in?
//   - can I reach the dashboard?
//
// and both are answered the same way every time.
//
// Usage:  const h = await openHarness();
//         await h.close();

// A harness user who has unfinished channels from earlier runs will be redirected
// by the gate. Finishing them is the FEATURE working, so `reachDashboard` does it
// and says so, rather than treating it as an obstacle to route around.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME =
  process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const AUTH = process.env.AUTH_URL ?? 'http://localhost:8085';
const EMAIL = process.env.HARNESS_EMAIL ?? 'harness@wideo11.test';
const PASSWORD = process.env.HARNESS_PASSWORD ?? 'Harness-Pass-2026!x';

export const ENV = { WEB, AUTH, EMAIL, PASSWORD };

/**
 * Milliseconds from a 429's `Retry-After`, or null.
 *
 * The header is in SECONDS, and it is the only authoritative statement of when the
 * window rolls over - a fixed sleep is a guess that is either too short (and gets
 * another 429) or far too long (and wastes the run).
 */
function waitForRetryAfter(res) {
  const raw = res.headers?.get?.('Retry-After');
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

/**
 * Spawn Chrome, attach over CDP, and return a small API over the page.
 *
 * `flatten: true` on `Target.attachToTarget` is not optional: without it every
 * CDP message needs a `sessionId` envelope wrapper, and getting that wrong
 * produces a session that evaluates nothing and reports no error.
 */
export async function openHarness({ onLog } = {}) {
  const log = onLog ?? (() => {});
  const profile = mkdtempSync(join(tmpdir(), 'wideo11-harness-'));

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  // `--remote-debugging-port=0` means "pick one", and the only place the chosen
  // port appears is this line on stderr. Reading it is the reason this harness can
  // run two checks in parallel without colliding.
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(
      () => reject(new Error('chrome did not report a debug url within 20s')),
      20000
    );
    chrome.stderr.on('data', (d) => {
      buf += d.toString();
      const m = /ws:\/\/[^\s]+/.exec(buf);
      if (m) {
        clearTimeout(timer);
        resolve(m[0]);
      }
    });
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));

  let id = 0;
  const pending = new Map();
  const consoleErrors = [];

  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(m.params.exceptionDetails?.exception?.description ?? '');
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(
        (m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ')
      );
    }
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params, sessionId }));
    });

  const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result;
  const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result;
  for (const domain of ['Page', 'Runtime', 'Network', 'DOM']) {
    await send(`${domain}.enable`, {}, sessionId);
  }

  /** Evaluate an expression that must produce JSON, and parse it. */
  const evaluate = async (expression) => {
    const r = await send(
      'Runtime.evaluate',
      { expression: `JSON.stringify(${expression})`, returnByValue: true, awaitPromise: true },
      sessionId
    );
    const value = r.result?.result?.value;
    return value === undefined ? null : JSON.parse(value);
  };

  const navigate = async (url, waitMs = 3000) => {
    await send('Page.navigate', { url }, sessionId);
    await new Promise((r) => setTimeout(r, waitMs));
  };

  const path = () => evaluate('location.pathname');

  /** Log in through the real form, polling WITHOUT navigating. */
  const signIn = async () => {
    await send('Network.clearBrowserCookies', {}, sessionId);
    await navigate(`${WEB}/auth/login`, 3000);

    const submitted = await evaluate(`(() => {
      const set = (el, v) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const ins = [...document.querySelectorAll('input')];
      const e = ins.find(i => /email/i.test(i.type + ' ' + (i.name||'') + ' ' + (i.placeholder||'')));
      const pw = ins.find(i => /password/i.test(i.type + ' ' + (i.name||'')));
      const form = e ? e.closest('form') : null;
      if (!e || !pw || !form) return { filled: false, url: location.href };
      set(e, ${JSON.stringify(EMAIL)});
      set(pw, ${JSON.stringify(PASSWORD)});
      form.requestSubmit();
      return { filled: true };
    })()`);

    if (!submitted?.filled) {
      log('note: the login form did not render - the web app may still be starting');
      return false;
    }

    // Poll WITHOUT navigating.
    //
    // A navigation here cancels the in-flight login POST, and the harness then
    // reports six empty objects and looks like a broken feature. That is exactly
    // what happened in `check-channel-wizard.mjs` before the comment was written
    // there, and it is why this comment is here too.
    //
    // A 429 shows up as the login page re-rendering with an error, so the state is
    // checked for that too and reported rather than treated as "still working".
    let rateLimited = false;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const state = await evaluate(`(() => {
        try {
          const x = new XMLHttpRequest();
          x.open('GET', '/api/session', false);
          x.send(null);
          if (x.status !== 200) return { status: x.status };
          return JSON.parse(x.responseText);
        } catch (e) { return { error: String(e) }; }
      })()`);
      if (state && (state.state === 'ready' || state.state === 'needs_setup')) return true;
      const text = await evaluate(`document.body.innerText.slice(0, 400)`);
      if (typeof text === 'string' && /too many|rate limit|slow down/i.test(text)) {
        if (!rateLimited) {
          rateLimited = true;
          log('note: the login form says the account is rate-limited - waiting it out');
        }
        // The limiter window is minutes long, so polling every 250ms for a minute
        // is just noise. Slow down once we know.
        await new Promise((r) => setTimeout(r, 30_000));
      }
    }
    return false;
  };

  /**
   * An API token for the server-side assertions, where a check needs to read the
   * DB's view.
   *
   * RESPECTS THE RATE LIMITER. `auth-service` allows 8 logins per 5 minutes per
   * IP+email, and every check logs in twice - once through the form, once here.
   * So running the checks back to back, or re-running one after a fix, walks
   * straight into a 429.
   *
   * The first version of this simply returned null on a 429, and the caller
   * reported:
   *
   *     FAIL an API token is available {"status":429}
   *
   * Thirty-two failures followed, all of them downstream of a token that was
   * refused for being one of several in a burst.
   *
   * A rate limit is the system working. A check that cannot tell the difference
   * between "the feature is broken" and "you asked too fast" reports the second as
   * the first, and the response is to go looking for a bug in working code.
   *
   * `Retry-After` is honoured when present; otherwise a conservative backoff. The
   * total is bounded so a genuinely blocked account fails rather than hanging.
   */
  const apiToken = async () => {
    const deadline = Date.now() + 4 * 60 * 1000;

    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${AUTH}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      });
      const body = await res.json().catch(() => ({}));
      const token = body?.tokens?.access_token ?? null;

      if (res.status !== 429) return token;

      if (Date.now() > deadline) {
        log(
          `note: still rate-limited after ${Math.round(
            (Date.now() - (deadline - 4 * 60 * 1000)) / 1000
          )}s of backing off - giving up so the check reports a real failure`
        );
        return token;
      }

      const waitMs = waitForRetryAfter(res) ?? Math.min(30_000, 5_000 * 2 ** attempt);
      log(`note: login rate-limited - waiting ${Math.round(waitMs / 1000)}s (Retry-After)`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  };

  const api = (token) => (apiPath, method = 'GET', body) =>
    fetch(`${AUTH}/api/v1/auth${apiPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

  /**
   * Get to the dashboard, clearing the compulsory step-2 gate if it fires.
   *
   * The gate redirects a creator whose NEWEST channel has not been set up. After
   * several test runs the harness account always has one, so this is the normal
   * path - not an error case.
   *
   * It finishes that channel through the API rather than by clicking, because the
   * point is to REACH the dashboard, not to re-test the wizard. The wizard is what
   * `check-channel-setup.mjs` is for.
   *
   * Returns whether the gate had to intervene, so a caller can say so.
   */
  const reachDashboard = async (token) => {
    await navigate(`${WEB}/dashboard`, 3500);
    if ((await path()) !== '/dashboard/channels/setup') {
      return { reached: (await path()) === '/dashboard', gateCleared: false };
    }

    log('note: the step-2 gate redirected on arrival - clearing it first');

    const pending = await api(token)('/channels/setup/pending');
    if (pending.body?.needs_setup && pending.body?.channel_id) {
      await api(token)(`/channels/${pending.body.channel_id}/setup`, 'PATCH', {
        finish_step2: true,
      });
    }
    await navigate(`${WEB}/dashboard`, 3500);
    return { reached: (await path()) === '/dashboard', gateCleared: true };
  };

  /** Push a real file through a real file input, the way a person would. */
  const setFileInput = async (selector, filePath) => {
    const root = await send('DOM.getDocument', {}, sessionId);
    const node = await send(
      'DOM.querySelector',
      { nodeId: root.result.root.nodeId, selector },
      sessionId
    );
    if (!node.result?.nodeId) return false;
    await send('DOM.setFileInputFiles', { files: [filePath], nodeId: node.result.nodeId }, sessionId);
    return true;
  };

  /**
   * Click something for real and report whether the browser opened a FILE CHOOSER.
   *
   * =============================================================================
   * WHY THIS EXISTS - AND WHY `setFileInput` IS NOT ENOUGH
   * =============================================================================
   *
   * `setFileInput` sets files on an element directly over CDP. It never touches the
   * `<label htmlFor="...">` that a person actually clicks, so it proves the UPLOAD
   * PIPELINE works and says nothing about whether the BUTTON works.
   *
   * Those are different claims, and the step-2 logo upload was broken in exactly the
   * second one:
   *
   *     <input data-track="setup-logo-input" ... />            <- no id
   *     <label htmlFor="setup-logo-input">Upload logo</label>  <- points at nothing
   *
   * Clicking the label did nothing. No file dialog. And `check-channel-setup.mjs`
   * reported 40/40, because every one of those checks drove the upload through the
   * element and never through the control in front of it.
   *
   * A check that exercises the plumbing but not the door. The user noticed in about
   * ten seconds; the harness took four runs to notice, and would not have noticed
   * at all.
   *
   * -----------------------------------------------------------------------------
   * WHY A TRUSTED MOUSE EVENT AND NOT `element.click()`
   * -----------------------------------------------------------------------------
   *
   * The first version of this called `el.click()` from JS - a SYNTHETIC event.
   *
   * Chrome will not open a file chooser for a synthetic click on a hidden input, so
   * this reported `false` for BOTH the label and the input - and the obvious
   * reading was "the label is still broken". It was not. The `id` matched, and
   * `label.control` resolved to the input; both were verified in the same probe.
   *
   * The tell was that clicking the INPUT directly also failed. A defect in the
   * label cannot explain that - it meant the click mechanism was wrong.
   *
   * `Input.dispatchMouseEvent` produces a TRUSTED event at real coordinates, which
   * is what a person produces. It is the only way to test a control whose whole
   * job is to be clicked.
   */
  const clickOpensFileChooser = async (clickSelector) => {
    // Intercept so headless Chrome does not block on a native dialog it cannot
    // show - and so the `fileChooserOpened` event is delivered at all.
    await send('Page.setInterceptFileChooserDialog', { enabled: true }, sessionId);

    let opened = false;
    const onMessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.method === 'Page.fileChooserOpened') opened = true;
    };
    ws.addEventListener('message', onMessage);

    try {
      const box = await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(clickSelector)});
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return { empty: true };
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`);

      if (!box) return { clicked: false, reason: 'selector matched nothing' };
      if (box.empty) return { clicked: false, reason: 'element has no size - it is not visible' };

      // press + release, the two halves of a real click.
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send(
          'Input.dispatchMouseEvent',
          {
            type,
            x: box.x,
            y: box.y,
            button: 'left',
            buttons: type === 'mousePressed' ? 1 : 0,
            clickCount: 1,
          },
          sessionId
        );
      }

      // The chooser opens asynchronously.
      for (let i = 0; i < 30 && !opened; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      return { clicked: true, opened, x: box.x, y: box.y };
    } finally {
      ws.removeEventListener('message', onMessage);
      await send('Page.setInterceptFileChooserDialog', { enabled: false }, sessionId).catch(() => {});
    }
  };

  /** A PNG screenshot of the current viewport, base64-encoded. */
  const screenshot = async (width = 1440, height = 2400) => {
    // Override the metrics so the shot is exactly the size asked for, rather than
    // whatever the headless window happened to open at. Without this, a "1440x900"
    // request quietly returns a different size and the shot lies about the layout.
    await send(
      'Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: 1, mobile: false },
      sessionId
    );
    await new Promise((r) => setTimeout(r, 400));
    const r = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    if (!r.result?.data) throw new Error('captureScreenshot returned no data');
    return r.result.data;
  };

  const close = async () => {
    ws.close();
    chrome.kill();
    // Chrome unlinks its profile asynchronously; on Windows the directory is still
    // held for a moment after exit, so a bare rmSync throws EPERM. A leaked temp
    // profile is not worth a failed run.
    await new Promise((r) => setTimeout(r, 800));
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch {
      log('note: left a temp Chrome profile behind (harmless)');
    }
  };

  return {
    evaluate,
    navigate,
    path,
    signIn,
    apiToken,
    api,
    reachDashboard,
    setFileInput,
    clickOpensFileChooser,
    screenshot,
    consoleErrors,
    close,
  };
}

/**
 * The tiny check/report pair, shared so every harness reports the same way.
 *
 * A check that prints PASS in one harness and nothing in another is a check whose
 * output nobody can trust, and "did it even run?" is the first question asked of
 * any failing suite.
 */
export function reporter() {
  let pass = 0;
  const fails = [];
  const check = (label, ok, detail) => {
    if (ok) {
      pass++;
      console.log(`PASS  ${label}`, detail ? JSON.stringify(detail) : '');
    } else {
      fails.push(label);
      console.log(`FAIL  ${label}`, detail ? JSON.stringify(detail) : '');
    }
  };
  const summarise = (extra = '') => {
    console.log(`\n${pass}/${pass + fails.length} checks passed`);
    console.log(fails.length === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${fails.length})`);
    for (const f of fails) console.log(`  - ${f}`);
    if (extra) console.log(extra);
    return fails.length;
  };
  return { check, summarise };
}

/** Fill the channel create form. Returns whether the fields were found. */
export const fillCreateForm = (handle) => `(() => {
  const set = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // The real ids, not guessed selectors.
  //
  // An earlier version matched on placeholder and input NAME and found nothing -
  // the wizard inputs carry ids (#ch-handle, #ch-name) and no matching name. The
  // channel was never created, and the failure surfaced four checks later as "the
  // channel was created: false", which reads as a broken create flow rather than a
  // broken test.
  const h = document.querySelector('#ch-handle, input[placeholder="aarav"]');
  const n = document.querySelector('#ch-name');
  if (h) set(h, ${JSON.stringify(handle)});
  if (n) set(n, 'Cover Probe');

  // The wizard's picker contract is button[aria-pressed], and the options are
  // matched on their HINT rather than an anchored label+hint string - an anchored
  // match breaks silently when the copy changes and the selection just stops
  // being found.
  const press = (re) => {
    const b = [...document.querySelectorAll('button[aria-pressed]')]
      .find(x => re.test(x.textContent || ''));
    b?.click();
    return !!b;
  };
  return {
    handle: !!h, name: !!n,
    category: press(/Tutorials, courses, explainers/),
    mature: press(/Suitable for everyone/),
    kids: press(/Full feature set applies/),
  };
})()`;
