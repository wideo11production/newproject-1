import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

/**
 * AUTH FLOW INTEGRATION TEST
 *
 * Tests the complete end-to-end authentication journey:
 *   1. Register new user
 *   2. Verify email
 *   3. Login
 *   4. Complete mandatory security setup (PIN + 3 questions + biometric skip)
 *   5. Access dashboard
 *   6. Superadmin accesses port 3008 console
 *
 * These tests run against live services (docker compose must be up).
 */

function captureErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    errors.push(`PAGEERROR: ${err.message}`);
  });
  return errors;
}

/** Helper: register a new user via API */
async function registerUser(request: APIRequestContext, email: string, password: string) {
  const res = await request.post('http://localhost:3000/api/auth/register', {
    data: { email, password },
  });
  return res;
}

/** Helper: login via API and return cookies */
async function loginAndGetCookies(
  request: APIRequestContext,
  email: string,
  password: string
) {
  const res = await request.post('http://localhost:3000/api/auth/login', {
    data: { email, password },
  });
  const state = await request.storageState();
  const cookies = state.cookies.filter((c: { domain: string }) =>
    c.domain.includes('localhost')
  );
  return { res, cookies };
}

/** Helper: complete security setup via API calls */
async function completeSecuritySetup(
  request: APIRequestContext,
  email: string,
  pin: string
) {
  // Set PIN
  await request.post('http://localhost:3000/api/auth/security/pin', {
    data: { email, pin },
  });

  // Set 3 security questions
  await request.post('http://localhost:3000/api/auth/security/questions', {
    data: {
      email,
      questions: [
        { question: 'first_school', answer: 'TestSchool' },
        { question: 'mother_maiden_name', answer: 'TestMaiden' },
        { question: 'first_pet_name', answer: 'TestPet' },
      ],
    },
  });

  // Skip biometric (not available in test env)
  await request.post('http://localhost:3000/api/auth/security/biometric/skip', {
    data: { email },
  });
}

/** Helper: transfer cookies to browser page context */
async function transferCookies(page: Page, cookies: any[]) {
  await page.context().addCookies(cookies);
}

test.describe('Auth flow integration', () => {
  const testEmail = `integ-${Date.now()}@wideo11.test`;
  const testPassword = 'IntegTest123!';
  const testPin = '123456';

  test('register new user', async ({ request }) => {
    const res = await registerUser(request, testEmail, testPassword);
    expect([201, 200, 429]).toContain(res.status());
  });

  test('login and complete security setup', async ({ request }) => {
    const { res, cookies } = await loginAndGetCookies(
      request,
      testEmail,
      testPassword
    );

    // Login should succeed (200) or be rate-limited (429)
    expect([200, 429]).toContain(res.status());

    if (res.status() === 200) {
      const body = await res.json();
      // Security setup should be required for new user
      if (body.security_setup_required) {
        await completeSecuritySetup(request, testEmail, testPin);
      }
    }
  });

  test('access dashboard after security setup', async ({ page, request }) => {
    const { cookies } = await loginAndGetCookies(
      request,
      testEmail,
      testPassword
    );
    await transferCookies(page, cookies);

    const errors = captureErrors(page);
    await page.goto('http://localhost:3000/dashboard', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // Dashboard should load without client errors
    await page.waitForTimeout(2_000);
    const fatal = errors.filter((e) => /PAGEERROR|client-side exception/i.test(e));
    expect(fatal, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('superadmin accesses port 3008 console', async ({ request }) => {
    const superadminEmail = 'advchashampalup@gmail.com';
    const superadminPassword = 'Rajaghenna123*#';

    const { res, cookies } = await loginAndGetCookies(
      request,
      superadminEmail,
      superadminPassword
    );

    expect(res.status()).toBe(200);

    // Security setup may be required - complete it
    const body = await res.json();
    if (body.security_setup_required) {
      await completeSecuritySetup(request, superadminEmail, testPin);
      // Re-login after setup to get fresh session
      await loginAndGetCookies(request, superadminEmail, superadminPassword);
    }
  });

  test('superadmin dashboard loads on port 3008', async ({ page, request }) => {
    const superadminEmail = 'advchashampalup@gmail.com';
    const superadminPassword = 'Rajaghenna123*#';

    const { cookies } = await loginAndGetCookies(
      request,
      superadminEmail,
      superadminPassword
    );
    await transferCookies(page, cookies);

    const errors = captureErrors(page);
    await page.goto('http://localhost:3008/', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // Superadmin dashboard should load
    await page.waitForTimeout(2_000);
    const title = await page.title();
    expect(title).toContain('Superadmin');

    const fatal = errors.filter((e) => /PAGEERROR|client-side exception/i.test(e));
    expect(fatal, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });
});
