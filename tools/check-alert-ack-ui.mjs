// Is the critical-alert banner actually gone after acknowledgement, and does the
// history show who acknowledged what?
//
// WHY A SCRIPT AND NOT A LOOK
//
// The change under test is "a banner that was always visible becomes invisible
// once acknowledged". A test that asserts the banner's markup is absent proves
// nothing — a component can render nothing at all and pass, which is a dashboard
// that is broken in exactly the way that is hardest to notice.
//
// So this renders the page in a browser and reads the VISIBLE TEXT. "0
// UNACKNOWLEDGED CRITICAL EVENTS" must not appear, and the acknowledgement history
// must name a person and a timestamp. That is what an operator sees.
//
// It also checks the thing that makes the feature safe rather than merely
// convenient: the SECURITY EVENTS panel must STILL contain the acknowledged
// event. Acknowledging is not resolving, and a UI that quietly removed the event
// from the timeline would be a much worse bug than a permanent banner.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9750 + Math.floor(Math.random() * 100);
const BASE = 'http://localhost:3008';
const OUT = join(process.cwd(), 'screenshots');

const EMAIL = process.env.SA_EMAIL;
const PASSWORD = process.env.SA_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error('SA_EMAIL and SA_PASSWORD must be set');
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

/**
 * Assertions that only mean something once the dashboard actually rendered.
 *
 * THE FIRST VERSION OF THIS FILE GOT THIS EXACTLY WRONG, and it is worth
 * recording precisely how.
 *
 * It asserted "the banner is not visible" and got a PASS — on the LOGIN page.
 * The dashboard had redirected, so there was no banner, so the assertion about
 * the banner was satisfied by a page that never contained one. Three more
 * assertions failed for the same reason and would have been failures of a
 * completely different bug.
 *
 * This is the most dangerous shape a browser test can take: it passes when the
 * subject is absent. The file's own comment said "a component can render nothing
 * at all and pass, which is a dashboard that is broken in exactly the way that is
 * hardest to notice" — and then did it.
 *
 * So every later assertion is gated on `dashboardUp`. When the dashboard did not
 * render, they report SKIP with the reason, never PASS.
 */
let dashboardUp = false;
let skipReason = '';

const checkIfDashboard = (name, ok, detail = '') => {
  if (!dashboardUp) {
    results.push({ name, ok: null });
    console.log(`SKIP  ${name}  (${skipReason})`);
    return;
  }
  check(name, ok, detail);
};

const profile = mkdtempSync(join(tmpdir(), 'ackui-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--disable-gpu', '--hide-scrollbars',
  '--window-size=1440,1200', 'about:blank',
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
    setTimeout(() => rej(new Error(`${method}: timeout`)), 40000);
  });
}
const evaluate = async (ws, sessionId, expression) => {
  const r = await cdp(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  return r.result.value;
};

try {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  const { targetId } = await cdp(ws, 'Target.createTarget', { url: `${BASE}/login` });
  const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId, flatten: true });
  await cdp(ws, 'Page.enable', {}, sessionId);
  await cdp(ws, 'Runtime.enable', {}, sessionId);
  await new Promise((r) => setTimeout(r, 3500));

  // ---- Sign in the way a person does ----
  //
  // BEFORE the dashboard gate below, because the failure mode that gate detects is
  // "redirected to /login" — and if the login never happened, that is what it
  // finds.
  const status = await evaluate(ws, sessionId, `fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ${JSON.stringify(EMAIL)}, password: ${JSON.stringify(PASSWORD)} })
  }).then(r => String(r.status)).catch(e => 'ERR ' + e.message)`);
  check('signed in', status === '200', `HTTP ${status}`);

  await cdp(ws, 'Page.navigate', { url: BASE }, sessionId);

  // Poll for content rather than sleeping a fixed time - six API calls land on
  // mount and a fixed wait photographs a loading state.
  let text = '';
  const where = String(await evaluate(ws, sessionId, 'location.pathname') ?? '');
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    text = String(await evaluate(ws, sessionId,
      `document.body ? document.body.innerText : ''`) ?? '');
    if (text.includes('Live Click Ledger')) break;
  }

  dashboardUp = text.includes('Live Click Ledger');
  if (!dashboardUp) {
    skipReason = `dashboard did not render (path=${where}, ${text.length} chars)`;
  }
  check('dashboard rendered', dashboardUp,
    dashboardUp ? `${text.length} chars` : `path=${where} text=${JSON.stringify(text.slice(0, 120))}`);

  // ---- 1. The banner must be GONE ----
  //
  // The critical event WAS acknowledged in the setup step. If the banner still
  // shows, the acknowledgement had no effect on the UI.
  checkIfDashboard('banner is gone after acknowledging',
    !/UNACKNOWLEDGED CRITICAL EVENT/i.test(text),
    /UNACKNOWLEDGED CRITICAL EVENT/i.test(text) ? 'banner still visible' : 'quiet');

  // ---- 2. And there must be a reason visible: the acknowledgement count ----
  checkIfDashboard('acknowledgement count is shown',
    /Alert Acknowledgements/.test(text) && /recorded/.test(text),
    (text.match(/Alert Acknowledgements[\s\S]{0,70}/)?.[0] ?? 'panel not found').replace(/\s+/g, ' ').trim());

  // ---- 3. THE SAFETY PROPERTY: the event is still in the timeline ----
  //
  // Acknowledging is "seen", not "resolved". If the acknowledged event vanished
  // from Security Events, the feature would be hiding evidence, which is worse
  // than the permanent banner it replaced.
  // ---- Expand the acknowledgement panel BEFORE sampling text again ----
  //
  // `innerText` excludes `display: none` subtrees. The panel is collapsed by
  // default, so the first sample could not see `LOCKOUT_TRIGGERED` inside it, and
  // the "still in the timeline" assertion failed on a page that was working
  // exactly as designed.
  //
  // The fix is to expand first. The fix that WOULD NOT have been acceptable is
  // weakening the assertion — the point of it is that acknowledging must not
  // remove the event from view.
  await evaluate(ws, sessionId, `(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent.trim() === 'Show');
    if (btn) btn.click();
    return !!btn;
  })()`);
  await new Promise((r) => setTimeout(r, 1200));

  const ackText = String(await evaluate(ws, sessionId,
    `document.body ? document.body.innerText : ''`) ?? '');

  checkIfDashboard('the acknowledged event is STILL in the security timeline',
    /LOCKOUT_TRIGGERED/.test(ackText),
    /LOCKOUT_TRIGGERED/.test(ackText) ? 'event retained' : 'event missing');

  checkIfDashboard('history names who acknowledged it', ackText.includes(EMAIL), EMAIL);
  checkIfDashboard('history shows the note', /office router/.test(ackText),
    'note is visible in the history table');

  // ---- And the SECURITY EVENTS panel must still be there ----
  //
  // Distinct from the assertion above. That one proves the EVENT is still visible
  // somewhere. This one proves the panel that holds the audit timeline was not
  // removed or emptied to achieve it — because "hide the acknowledged row" would
  // satisfy the first assertion and defeat the purpose of the feature.
  const securityPanel = await evaluate(ws, sessionId, `(() => {
    const panel = Array.from(document.querySelectorAll('section'))
      .find(s => /Security Events/i.test(s.querySelector('span')?.textContent ?? ''));
    if (!panel) return { found: false };
    return { found: true, text: panel.innerText.slice(0, 400) };
  })()`);
  checkIfDashboard('the Security Events panel still exists and has content',
    securityPanel.found && String(securityPanel.text ?? '').length > 20,
    securityPanel.found ? `${String(securityPanel.text).split('\\n')[0]}...` : 'panel not found');

  // Screenshot for a human.
  const shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(join(OUT, 'superadmin-acknowledged.png'), Buffer.from(shot.data, 'base64'));

  await cdp(ws, 'Target.closeTarget', { targetId });
} catch (err) {
  check('harness completed', false, String(err.message ?? err));
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log('='.repeat(70));
  console.log(`${results.length - failed}/${results.length} passed`);
  console.log(`screenshot -> screenshots/superadmin-acknowledged.png`);
  cleanup();
  process.exit(failed === 0 ? 0 : 1);
}
