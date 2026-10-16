import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * LIST VIEW CRASH - test-driven fix.
 *
 * THE BUG: switching to List view on /dashboard/upload throws a client-side
 * exception. Grid view works.
 *
 * WHY A BROWSER TEST AND NOT A UNIT TEST: the crash is in the browser's render of
 * an obfuscated chunk, which no unit test can observe. This drives the real page
 * and asserts on the console + the DOM.
 *
 * THE FIX MUST NOT BREAK: grid view, hover preview, the icon-only buttons.
 */

/** Capture console errors and page exceptions. */
function captureErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    errors.push(`PAGEERROR: ${err.message}`);
  });
  return errors;
}

/** Log in and land on the upload page with a session. */
async function loginAndGoto(page: Page, request: { post: Function; storageState: Function }) {
  // Use a pre-seeded verified user with security setup complete.
  const email = process.env.PROBE_EMAIL;
  if (!email) throw new Error('PROBE_EMAIL env required');

  // The session cookie is httpOnly, so the browser cannot see it via
  // document.cookie - waitForFunction on it never resolves. And a cookie set on
  // the `request` context is not automatically shared with the `page` context.
  // So: log in through the request context, then transfer its storage state into
  // the browser context the page uses.
  const res = await request.post('http://localhost:3000/api/auth/login', {
    data: { email, password: 'Studio@Verify123' },
  });
  if (!res.ok() && res.status() !== 429) {
    throw new Error(`login failed: ${res.status()}`);
  }

  const state = await request.storageState();
  await page.context().addCookies(
    state.cookies.filter((c: { domain: string }) => c.domain.includes('localhost'))
  );

  await page.goto('http://localhost:3000/dashboard/upload');
  await page.waitForSelector('[data-media-library]', { timeout: 20_000 });
}

test.describe('List view crash', () => {
  test('grid view renders without errors', async ({ page, request }) => {
    const errors = captureErrors(page);
    await loginAndGoto(page, request);

    // The library header has a List button; grid is the default.
    await expect(page.locator('[data-media-library]')).toBeVisible();
    await page.waitForTimeout(500);

    // No page errors rendered.
    const fatal = errors.filter((e) => /PAGEERROR|a client-side exception/i.test(e));
    expect(fatal, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('list view renders without client-side exception', async ({ page, request }) => {
    const errors = captureErrors(page);
    await loginAndGoto(page, request);

    // SWITCH TO LIST - the reported crash.
    await page.click('button:has-text("List")');
    await page.waitForTimeout(600);

    // The cards survived the switch.
    const cards = page.locator('[data-studio-card]');
    await expect(cards.first()).toBeVisible();

    // THE ASSERTION: no client-side exception.
    const fatal = errors.filter((e) => /PAGEERROR|a client-side exception/i.test(e));
    expect(fatal, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('list view keeps the icon-only buttons working', async ({ page, request }) => {
    const errors = captureErrors(page);
    await loginAndGoto(page, request);

    await page.click('button:has-text("List")');
    await page.waitForTimeout(600);

    // A play button exists and is reachable in list view.
    const play = page.getByLabel(/^Play /).first();
    await expect(play).toBeVisible();
    await expect(play).toHaveAttribute('title', /Play here|Not playable yet/);

    const fatal = errors.filter((e) => /PAGEERROR/i.test(e));
    expect(fatal, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('hover preview still works in list view', async ({ page, request }) => {
    const errors = captureErrors(page);
    await loginAndGoto(page, request);

    await page.click('button:has-text("List")');
    await page.waitForTimeout(600);

    const row = page.locator('[data-studio-card]').first();
    await row.hover();
    await page.waitForTimeout(400);

    const fatal = errors.filter((e) => /PAGEERROR/i.test(e));
    expect(fatal, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });
});
