#!/usr/bin/env node
// check-channel-cover.mjs
//
// Drive CHANNEL CREATION in a real browser, upload a real PNG to the cover
// field, and assert the image is genuinely stored on the created channel and
// shown to a visitor.
//
// =============================================================================
// WHY THIS FILE, AND WHY A BROWSER
// =============================================================================
//
// Reported: "cover upload does not work while creating a channel, but works
// fine when I edit the channel afterwards."
//
// Every check that already existed said the feature was fine:
//
//   - `check-channel-wizard.mjs` passed 16/16 and never touched the cover
//   - both endpoints answered correctly, from a clean build, on the first try
//   - the types were right, the JSON shape was right, the Go build was green
//
// The defect was ONE property name in a browser-side guard (`ticket.upload_url`
// against a server that sends `uploadUrl`), plus a hardcoded byte ceiling that
// disagreed with the server's, plus a client-invented object key. None of that
// is visible to a request-level check - it reported PASS the whole time, which
// is exactly what happened.
//
// So the only honest evidence is a browser running that guard and a file going
// through a real <input type=file>.
//
// =============================================================================
// THE ASSERTIONS ARE ABOUT STATE, NOT ABOUT 200s
// =============================================================================
//
// "The upload request returned 200" is not the claim. The claim is: the bytes
// reached object storage, the channel row carries the resulting URL, and that
// URL serves an image back to a visitor. A check that stops at the 200 has
// stopped one step short of the thing the user asked for - the same shape of
// mistake as a test that passes while asserting its own bug.
//
// Usage:  node tools/check-channel-cover.mjs

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import zlib from 'node:zlib';

import { ENV, openHarness, reporter, fillCreateForm } from './lib/harness.mjs';

const require = createRequire(import.meta.url);
const { WEB, AUTH } = ENV;

const { check, summarise } = reporter();

/**
 * A real 2:1 PNG, 1200x630 - YouTube's banner shape - so the fixture is honest
 * about the aspect ratio the field promises.
 *
 * A 1x1 pixel would satisfy a magic-byte check and teach us nothing. And no binary
 * in the repo: a fixture image is reviewable as a diff, which a committed .png is
 * not.
 */
function makeBannerPng(w = 1200, h = 630) {
  const table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (buf) => {
    let crc = 0xffffffff;
    for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) {
    row[1 + x * 3] = 40 + ((x * 180) / w) | 0;
    row[2 + x * 3] = 90;
    row[3 + x * 3] = 200;
  }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const h = await openHarness({ onLog: (m) => console.log(m) });

try {
  const token = await h.apiToken();
  check('an API token is available for the storage assertions', Boolean(token), { WEB, AUTH });

  check('signed in', await h.signIn());

  // ---- 0. The contract, straight from the running service ----
  //
  // Before touching the browser: what does the create-time endpoint actually
  // return? Every downstream assertion is easier to read when the shape is known,
  // and a shape change should fail here rather than three steps into a UI flow.
  const ticketRes = await fetch(`${AUTH}/api/v1/auth/channels/cover/upload-url`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'banner.png', contentType: 'image/png' }),
  });
  const ticket = await ticketRes.json().catch(() => ({}));
  const keys = Object.keys(ticket).sort();

  check('the create-time upload-url endpoint is reachable', ticketRes.status === 200, {
    status: ticketRes.status,
  });
  check('it returns an upload URL', Boolean(ticket.uploadUrl || ticket.upload_url), { keys });
  check(
    'it returns camelCase `uploadUrl`, which is the key the code must read',
    typeof ticket.uploadUrl === 'string',
    { keys }
  );
  check(
    'it states the byte ceiling, so the client cannot disagree with it',
    typeof ticket.maxBytes === 'number' && ticket.maxBytes > 0,
    { maxBytes: ticket.maxBytes }
  );
  check(
    'it does NOT return `upload_url` - the key that broke the wizard',
    !('upload_url' in ticket),
    { keys }
  );

  // ---- 1. Reach the dashboard ----
  //
  // The compulsory step-2 gate redirects a creator whose newest channel is
  // unfinished, and the harness account always has one after a few runs. Clearing
  // it is the FEATURE working, so the shared harness does it and says so.
  const reached = await h.reachDashboard(token);
  check('the dashboard is reachable', reached.reached === true, reached);

  const opened = await h.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')]
      .find(x => /create a channel|new channel|create channel/i.test(x.textContent || ''));
    if (!b) return { opened: false, buttons: [...document.querySelectorAll('button')]
      .map(x => (x.textContent||'').trim()).filter(Boolean).slice(0, 14) };
    b.click();
    return { opened: true };
  })()`);
  check('the dashboard offers a create-channel control', opened.opened === true, opened);
  await new Promise((r) => setTimeout(r, 900));

  // ---- 2. The form really asks for a cover ----
  const coverField = await h.evaluate(`(() => {
    const t = document.body.innerText;
    const input = document.querySelector('input[data-track="channel-cover-input"]');
    return {
      promptPresent: /channel cover/i.test(t),
      inputPresent: !!input,
      accepts: input ? input.getAttribute('accept') : null,
    };
  })()`);
  check('the create form ASKS for a cover', coverField.promptPresent === true, coverField);
  check('the create form has a real file input for it', coverField.inputPresent === true, coverField);

  // ---- 3. Push a REAL file through the REAL input ----
  //
  // FIRST: does the BUTTON work? `setFileInput` drives the element directly and
  // never touches the `<label htmlFor>`, so it proves the pipeline and says nothing
  // about the control in front of it. The step-2 logo upload shipped in exactly that
  // state - a perfect upload behind a label pointing at an id that did not exist -
  // and every upload-driven check passed.
  const chooser = await h.clickOpensFileChooser('label[for="ch-cover"]');
  check('clicking the cover "Upload" control opens a file chooser', chooser?.opened === true, {
    result: chooser,
    hint: 'a label whose htmlFor matches no input id is dead to a person and invisible ' +
      'to any check that sets files programmatically',
  });

  const fixture = join(tmpdir(), 'wideo11-banner-fixture.png');
  writeFileSync(fixture, makeBannerPng());
  const inputSet = await h.setFileInput('input[data-track="channel-cover-input"]', fixture);
  check('the file input resolves and accepts a real file', inputSet === true, {});

  // Wait for a DEFINITIVE outcome, not a fixed sleep: an upload that takes 300ms
  // and one that takes 6s must both be judged on what they say, not on when we
  // happened to look.
  let outcome = { ok: null, err: null, waited: 0 };
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 400));
    outcome = await h.evaluate(`(() => {
      const wrap = document.querySelector('input[data-track="channel-cover-input"]')
        ?.closest('.space-y-1\\\\.5');
      const scope = wrap?.parentElement?.parentElement ?? document.body;
      const texts = [...scope.querySelectorAll('p')].map(p => (p.textContent || '').trim()).filter(Boolean);
      return {
        ok: texts.find(t => t === 'Cover set.') ?? null,
        err: texts.find(t => /could not|not a valid|unexpected response|did not upload|the limit is|network error/i.test(t)) ?? null,
        all: texts.slice(0, 6),
      };
    })()`);
    outcome.waited = (i + 1) * 400;
    if (outcome.ok || outcome.err) break;
  }

  check('uploading a real PNG during creation REACHES SUCCESS', Boolean(outcome.ok), {
    waitedMs: outcome.waited,
    texts: outcome.all,
  });
  check('the create-time cover upload does not report an error', !outcome.err, {
    error: outcome.err,
  });

  const thumb = await h.evaluate(`(() => {
    const input = document.querySelector('input[data-track="channel-cover-input"]');
    const box = input?.closest('.space-y-1\\\\.5')?.querySelector('.relative');
    const img = box?.querySelector('img');
    return img ? img.getAttribute('src') : null;
  })()`);
  check('the field previews the uploaded image', Boolean(thumb && thumb.startsWith('http')), {
    thumb: thumb ? `${thumb.slice(0, 90)}…` : null,
  });

  if (thumb) {
    const head = await fetch(thumb, { method: 'HEAD' }).catch(() => null);
    check('the stored object is served back from storage', Boolean(head?.ok), {
      status: head?.status ?? 'request failed',
    });
    check(
      'storage serves it as an IMAGE, not as something else',
      (head?.headers?.get('content-type') ?? '').startsWith('image/'),
      { contentType: head?.headers?.get('content-type') }
    );
  }

  // ---- 4. Finish the form and create ----
  const handle = `cov${Date.now().toString(36).slice(-6)}`;
  const filled = await h.evaluate(fillCreateForm(handle));
  check('the create form has the fields this check needs', filled.handle && filled.name, filled);
  check('the required wizard answers can be chosen', filled.category && filled.mature && filled.kids, filled);
  await new Promise((r) => setTimeout(r, 400));

  const submitted = await h.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')]
      .find(x => /^create channel$/i.test((x.textContent||'').trim()));
    if (b) { b.click(); return { clicked: true }; }
    return { clicked: false, buttons: [...document.querySelectorAll('button')]
      .map(x => (x.textContent||'').trim()).filter(Boolean).slice(0, 16) };
  })()`);
  check('the create form submits', submitted.clicked === true, submitted);
  await new Promise((r) => setTimeout(r, 3500));

  const api = h.api(token);
  const listBody = await api('/channels');
  const channels = listBody.body.channels ?? listBody.body.data ?? [];
  const created = channels.find((c) => c.handle === handle);

  check('the channel was created', Boolean(created), {
    handles: channels.map((c) => c.handle).slice(0, 8),
  });
  check(
    'the created channel STORED the cover URL on the row',
    Boolean(created?.cover_url),
    { cover_url: created?.cover_url ? `${created.cover_url.slice(0, 80)}…` : null }
  );
  check(
    'the stored URL is the SAME object the preview showed',
    Boolean(created?.cover_url && thumb && created.cover_url === thumb),
    { stored: created?.cover_url ?? null, previewed: thumb ?? null }
  );

  // ---- 5. A visitor sees it ----
  //
  // Asserted in the BROWSER, not against `fetch(...).text()`.
  //
  // The route file is a server component but the page body is a Client Component
  // that FETCHES after hydration, so the cover URL is never in the server-rendered
  // HTML. An earlier version asserted against that HTML and failed correctly - and
  // pointed at the wrong file.
  await h.navigate(`${WEB}/channel/${handle}`, 4000);
  const rendered = await h.evaluate(`(() => {
    const cover = document.querySelector('[data-track="channel-cover"]');
    const banner = cover?.closest('div');
    return {
      cover: cover ? cover.getAttribute('src') : null,
      bannerBackground: banner ? getComputedStyle(banner).backgroundColor : null,
    };
  })()`);

  check('the PUBLIC page shows the cover, in the rendered DOM', rendered.cover === created?.cover_url, {
    rendered: rendered.cover,
    stored: created?.cover_url ?? null,
  });
  check(
    'the cover is the same object the creator uploaded',
    Boolean(rendered.cover) && rendered.cover.includes('/covers/'),
    { rendered: rendered.cover }
  );
  check(
    'the banner is painted with a resolved brand colour even behind the cover',
    typeof rendered.bannerBackground === 'string' && rendered.bannerBackground.startsWith('rgb'),
    { bannerBackground: rendered.bannerBackground }
  );

  const errors = h.consoleErrors.filter((e) => e && !/Failed to load resource/i.test(e));
  check('no uncaught exceptions in the browser', errors.length === 0, {
    errors: errors.slice(0, 4),
  });
} finally {
  await h.close();
}

process.exit(summarise(`channel: ${typeof handle === 'undefined' ? '(none)' : handle}`));
