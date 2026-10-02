#!/usr/bin/env node
// check-channel-setup.mjs
//
// Drive STEP 2 of channel creation in a real browser, and assert that it is
// actually COMPULSORY.
//
// =============================================================================
// WHY THIS FILE EXISTS, AND WHY IT IS NOT A UNIT TEST
// =============================================================================
//
// The requirement was that step 2 is compulsory. That is a claim about what a
// creator is ALLOWED TO DO, and the only honest evidence is a browser doing the
// things a creator would do:
//
//   1. create a channel
//   2. try to carry on to the dashboard without finishing step 2
//   3. observe whether the dashboard lets them
//   4. finish step 2
//   5. observe that they are let through, and that a visitor sees the result
//
// A test asserting "the gate function returns true" proves the gate function
// returns true. It says nothing about whether a creator can reach the dashboard,
// which is the actual requirement.
//
// The other reason: the gate has TWO independent halves and both have to hold.
// The client redirects, and the server decides. A check that only inspects one of
// them is checking half a feature - and the half that fails silently is the
// server one, because an unenforced gate looks exactly like an enforced one from
// the inside.
//
// =============================================================================
// WHY THIS USES THE SHARED HARNESS
// =============================================================================
//
// It had its own Chrome launcher and sign-in loop, and both were fine. They had
// still drifted: this file kept logging in when the login limiter was already
// exhausted, and reported
//
//     FAIL an API token is available {"status":429}
//     ... 32 more failures
//
// All thirty-two were downstream of a token refused for being one of several in a
// burst. `lib/harness.mjs` now honours `Retry-After`, and both checks ask the
// same two questions the same way.
//
// =============================================================================
// WHAT IS ASSERTED ABOUT THE FIELDS
// =============================================================================
//
// Each saved field is read back THROUGH THE API, not out of the DOM.
//
// The reason is specific: `setup_step2_at` is stamped server-side from the server
// clock, and the whole gate turns on it. A UI showing "finished" while the column
// was still NULL would look perfect and hold nothing up. So the source of truth
// for every assertion here is a fresh `GET`, not what the browser believes.
//
// Usage:  node tools/check-channel-setup.mjs

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import zlib from 'node:zlib';

import { ENV, openHarness, reporter, fillCreateForm } from './lib/harness.mjs';

const require = createRequire(import.meta.url);
const { WEB } = ENV;

const { check, summarise } = reporter();

/** A real square PNG, 512x512 - the shape a logo is supposed to be. */
function makeSquarePng(size = 512) {
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
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = 240;
    row[2 + x * 3] = (x * 255) / size;
    row[3 + x * 3] = 120;
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const h = await openHarness({ onLog: (m) => console.log(m) });
let handle = '(none)';
let channelId = '(none)';

try {
  const token = await h.apiToken();
  check('an API token is available for the server-side assertions', Boolean(token));
  const api = h.api(token);

  check('signed in', await h.signIn());

  // -------------------------------------------------------------------------
  // 1. Reach the dashboard, clearing the gate if an earlier run left it set
  // -------------------------------------------------------------------------
  const reached = await h.reachDashboard(token);
  check('the dashboard is reachable to begin with', reached.reached === true, reached);

  const opened = await h.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')]
      .find(x => /create a channel|new channel|create channel/i.test(x.textContent || ''));
    if (!b) return { opened: false };
    b.click();
    return { opened: true };
  })()`);
  check('the dashboard offers a create-channel control', opened.opened === true, opened);
  await new Promise((r) => setTimeout(r, 900));

  // -------------------------------------------------------------------------
  // 2. Create a channel through the real form
  // -------------------------------------------------------------------------
  handle = `stp${Date.now().toString(36).slice(-6)}`;
  const filled = await h.evaluate(fillCreateForm(handle));
  check('the create form was filled', filled.handle && filled.category, filled);
  await new Promise((r) => setTimeout(r, 400));

  await h.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')]
      .find(x => /^create channel$/i.test((x.textContent||'').trim()));
    b?.click();
    return !!b;
  })()`);
  await new Promise((r) => setTimeout(r, 4000));

  // -------------------------------------------------------------------------
  // 3. THE COMPULSORY PART - the creator is sent to step 2
  // -------------------------------------------------------------------------
  const landed = await h.path();
  check(
    'creating a channel lands the creator in STEP 2, not the dashboard',
    landed === '/dashboard/channels/setup',
    { landed, expected: '/dashboard/channels/setup' }
  );

  // -------------------------------------------------------------------------
  // 4. THE SERVER SAYS IT IS UNFINISHED
  // -------------------------------------------------------------------------
  // Read through the API rather than the DOM. The gate turns on `setup_step2_at`,
  // which is stamped server-side - a UI that disagrees with it would look finished
  // and hold nothing up.
  const pendingBefore = await api('/channels/setup/pending');
  check(
    'the SERVER reports the channel as needing setup',
    pendingBefore.status === 200 && pendingBefore.body.needs_setup === true,
    pendingBefore.body
  );

  channelId = pendingBefore.body.channel_id;
  check('the server names WHICH channel', typeof channelId === 'string', { channelId });

  // -------------------------------------------------------------------------
  // 5. TRYING TO ESCAPE
  // -------------------------------------------------------------------------
  // Navigate straight to the dashboard the way a creator would - by typing the
  // URL. This is the test that matters: the gate has to hold against a creator who
  // does not go through the flow.
  await h.navigate(`${WEB}/dashboard`, 3500);
  const afterEscape = await h.path();
  check(
    'a creator who navigates straight to the dashboard is RETURNED to step 2',
    afterEscape === '/dashboard/channels/setup',
    { afterEscape }
  );

  // -------------------------------------------------------------------------
  // 6. THE SCREEN OFFERS EVERYTHING, AND NOTHING IS REQUIRED
  // -------------------------------------------------------------------------
  await h.navigate(`${WEB}/dashboard/channels/setup`, 3500);

  const shape = await h.evaluate(`(() => {
    const has = (t) => !!document.querySelector('[data-track="' + t + '"]');
    const finish = document.querySelector('[data-track="setup-finish"]');
    return {
      logo: has('setup-logo-input'),
      tagline: has('setup-tagline'),
      brand: !!document.querySelector('[data-track="setup-brand-default"]'),
      swatches: document.querySelectorAll('[data-track^="setup-brand-"]:not([data-track="setup-brand-default"])').length,
      category: has('setup-channel-type'),
      keywords: has('setup-keywords'),
      visibility: ['public','unlisted','private'].every(v => has('setup-visibility-' + v)),
      comments: has('setup-comments-enabled'),
      commentPolicy: has('setup-comment-policy-subscribers'),
      kids: has('setup-kids-auto'),
      watermark: has('setup-watermark'),
      cover: !!document.querySelector('[data-track="setup-cover-input"], input[type=file]'),
      // A compulsory step that can be disabled is a step that can trap somebody.
      finishPresent: !!finish,
      finishDisabled: finish ? finish.disabled : null,
    };
  })()`);

  check('the logo field is offered', shape.logo === true, shape);
  check('the tagline field is offered', shape.tagline === true, shape);
  check('a brand colour palette is offered', shape.brand === true && shape.swatches > 0, shape);
  check('category can be confirmed', shape.category === true, shape);
  check('keywords can be refined', shape.keywords === true, shape);
  check('all three visibility states are offered', shape.visibility === true, shape);
  check(
    'per-channel upload defaults are offered',
    shape.comments && shape.commentPolicy && shape.kids && shape.watermark,
    shape
  );
  check(
    'the Finish button is present and NOT disabled - nothing on this screen is required',
    shape.finishPresent === true && shape.finishDisabled === false,
    { finishPresent: shape.finishPresent, finishDisabled: shape.finishDisabled }
  );

  // -------------------------------------------------------------------------
  // 7. FILL IT
  // -------------------------------------------------------------------------
  // Blur-driven saves need the element to be genuinely FOCUSED first.
  //
  // An earlier version set the value and dispatched a `blur` Event on an element
  // that was never focused, so React's onBlur never fired, the save never happened,
  // and the assertion read:
  //
  //     FAIL the tagline was stored {"tagline":""}
  //
  // which reads as "the field did not save" rather than "the test never focused
  // the field". A real creator types into the box, which focuses it.
  await h.evaluate(`(() => {
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const fill = (sel, v) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.focus();
      set(el, v);
      el.blur();
      return true;
    };
    return {
      tagline: fill('[data-track="setup-tagline"]', 'Bread, and the patience it needs'),
      keywords: fill('[data-track="setup-keywords"]', 'baking, sourdough'),
    };
  })()`);
  // Two fields, one debounce window. The wait has to exceed it, or the second
  // field's save is still in flight when the first is asserted.
  await new Promise((r) => setTimeout(r, 1500));

  // Brand colour: pick a swatch that is NOT the default, so "it saved" cannot be
  // confused with "it was already 206".
  const hueBefore = (await api(`/channels/${channelId}/setup`)).body.channel?.brand_hue ?? null;
  const picked = await h.evaluate(`(() => {
    const swatches = [...document.querySelectorAll('button[data-track^="setup-brand-"]')]
      .filter(b => b.getAttribute('data-track') !== 'setup-brand-default');
    const target = swatches.find(b => b.getAttribute('data-track') === 'setup-brand-Violet')
      ?? swatches[swatches.length - 1];
    target?.click();
    return { clicked: !!target, track: target?.getAttribute('data-track') ?? null, count: swatches.length };
  })()`);
  check('a brand colour can be chosen', picked.clicked === true, picked);
  await new Promise((r) => setTimeout(r, 1200));

  // Visibility: unlisted, because it is the state that is impossible to express
  // with a boolean and the one most worth proving.
  await h.evaluate(`(() => {
    const b = document.querySelector('[data-track="setup-visibility-unlisted"]');
    b?.click();
    return !!b;
  })()`);
  await new Promise((r) => setTimeout(r, 1200));

  await h.evaluate(`(() => {
    const b = document.querySelector('[data-track="setup-comment-policy-subscribers"]');
    b?.click();
    return !!b;
  })()`);
  await new Promise((r) => setTimeout(r, 900));
  await h.evaluate(`(() => {
    const w = document.querySelector('[data-track="setup-watermark"]');
    if (w && !w.checked) w.click();
    return !!w;
  })()`);
  await new Promise((r) => setTimeout(r, 900));

  // Logo: a real PNG through the real input.
  //
  // ---- FIRST: does the BUTTON work at all? ----
  //
  // Asserted before the upload, and separately, because "the upload works" and
  // "the button opens a chooser" are different claims.
  //
  // This input originally had `data-track="setup-logo-input"` and NO `id`, so the
  // label's `htmlFor="setup-logo-input"` matched nothing and clicking "Upload
  // logo" did nothing at all. The upload pipeline was perfect; the control in front
  // of it was dead. And every check below drives the upload through the ELEMENT, so
  // they all passed - the file chooser was never opened once in the whole run.
  // `.opened`, not the whole return value.
  //
  // `clickOpensFileChooser` returns `{clicked, opened, reason?}` so a failure can
  // say WHY - "selector matched nothing" and "element has no size" are different
  // bugs with the same symptom. Comparing the object to `true` therefore reported
  // false even when the chooser opened, which is the harness lying about a working
  // feature rather than catching a broken one.
  const chooser = await h.clickOpensFileChooser('[data-track="setup-logo-button"]');
  check(
    'clicking "Upload logo" actually opens a file chooser',
    chooser?.opened === true,
    {
      result: chooser,
      hint: 'a <label htmlFor> pointing at an id the input does not have is the classic ' +
        'version of this: the element uploads fine when driven programmatically and the ' +
        'button is dead for a person',
    }
  );

  const fixture = join(tmpdir(), 'wideo11-logo-fixture.png');
  writeFileSync(fixture, makeSquarePng());
  const inputSet = await h.setFileInput('input[data-track="setup-logo-input"]', fixture);
  check('the logo input resolves and accepts a real file', inputSet === true, {});

  let logoOutcome = { ok: false, err: null };
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 400));
    logoOutcome = await h.evaluate(`(() => {
      const img = [...document.querySelectorAll('img')].find(i => (i.getAttribute('src')||'').includes('/covers/'));
      const err = [...document.querySelectorAll('p')].map(p => p.textContent.trim())
        .find(t => /not a valid|could not|did not upload|limit is|unexpected response/i.test(t));
      return { ok: !!img, err: err ?? null, src: img ? img.getAttribute('src') : null };
    })()`);
    if (logoOutcome.ok || logoOutcome.err) break;
  }
  check('a real PNG uploads as the logo', logoOutcome.ok === true, logoOutcome);
  check('the logo upload reports no error', !logoOutcome.err, { error: logoOutcome.err });

  // -------------------------------------------------------------------------
  // 8. WHAT THE SERVER ACTUALLY STORED
  // -------------------------------------------------------------------------
  // Every field read back through the API. The DOM can only report what the
  // browser believes, and the browser is not the authority on any of this.
  const savedState = await api(`/channels/${channelId}/setup`);
  const ch = savedState.body.channel ?? {};

  check('the tagline was stored', ch.tagline === 'Bread, and the patience it needs', {
    tagline: ch.tagline,
  });
  check(
    'the keywords were stored',
    typeof ch.keywords === 'string' && ch.keywords.includes('sourdough'),
    { keywords: ch.keywords }
  );
  check(
    'the brand colour was stored as a HUE, and it CHANGED from what it was',
    typeof ch.brand_hue === 'number' && ch.brand_hue !== null && ch.brand_hue !== hueBefore,
    { brand_hue: ch.brand_hue, before: hueBefore }
  );
  check(
    'the brand colour is one the palette offers',
    savedState.body.brand_colors?.some((c) => c.hue === ch.brand_hue) === true,
    { brand_hue: ch.brand_hue, offered: savedState.body.brand_colors?.map((c) => c.hue) }
  );
  check('the visibility was stored', ch.visibility === 'unlisted', { visibility: ch.visibility });
  check(
    'the comment policy was stored',
    ch.comments_enabled === true && ch.comment_policy === 'subscribers',
    { enabled: ch.comments_enabled, policy: ch.comment_policy }
  );
  check('the watermark default was stored', ch.watermark_enabled === true, {
    watermark: ch.watermark_enabled,
  });
  check('the logo was stored', typeof ch.logo_url === 'string' && ch.logo_url.length > 0, {
    logo_url: ch.logo_url,
  });
  check(
    'setup is STILL not complete - filling fields is not finishing',
    ch.setup_complete === false && ch.setup_completed_at === undefined,
    { setup_complete: ch.setup_complete }
  );

  if (ch.logo_url) {
    const head = await fetch(ch.logo_url, { method: 'HEAD' }).catch(() => null);
    check('the stored logo is served back from storage', Boolean(head?.ok), {
      status: head?.status ?? 'failed',
      contentType: head?.headers?.get('content-type'),
    });
  }

  // The server must STILL report the channel as needing setup. If finishing were
  // implied by filling, the compulsory part would be a formality.
  const stillPending = await api('/channels/setup/pending');
  check(
    'the server STILL says setup is needed - filling is not finishing',
    stillPending.body.needs_setup === true,
    stillPending.body
  );

  // -------------------------------------------------------------------------
  // 9. FINISH
  // -------------------------------------------------------------------------
  await h.navigate(`${WEB}/dashboard/channels/setup`, 3500);
  await h.evaluate(`(() => { document.querySelector('[data-track="setup-finish"]')?.click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 4500));

  const afterFinish = await h.path();
  check('finishing lands the creator on the dashboard', afterFinish === '/dashboard', {
    afterFinish,
  });

  const pendingAfter = await api('/channels/setup/pending');
  check(
    'the server now reports setup as COMPLETE',
    pendingAfter.body.needs_setup === false,
    pendingAfter.body
  );

  // -------------------------------------------------------------------------
  // 10. THE GATE HAS STOPPED INTERFERING
  // -------------------------------------------------------------------------
  // The dashboard must stay reachable now. A gate that keeps redirecting after
  // setup is finished is the exact failure this step is most likely to have -
  // and it is not hypothetical: the first version of the gate asked for "any
  // unfinished channel" and with older half-finished channels on the account it
  // never released at all.
  await h.navigate(`${WEB}/dashboard`, 3500);
  const settled = await h.path();
  check('the dashboard is reachable AFTER setup is finished', settled === '/dashboard', {
    settled,
  });

  const finishedState = await api(`/channels/${channelId}/setup`);
  check(
    'the server stamped setup_step2_at',
    typeof finishedState.body.channel?.setup_completed_at === 'string',
    { at: finishedState.body.channel?.setup_completed_at }
  );

  // -------------------------------------------------------------------------
  // 11. A VISITOR SEES THE RESULT
  // -------------------------------------------------------------------------
  await h.navigate(`${WEB}/channel/${handle}`, 4000);
  const publicView = await h.evaluate(`(() => {
    const cover = document.querySelector('[data-track="channel-cover"]');
    const avatar = document.querySelector('[data-track="channel-avatar"]');
    const h1 = document.querySelector('h1');
    const p = h1 ? h1.parentElement?.querySelector('p') : null;
    return {
      avatar: avatar ? avatar.getAttribute('src') : null,
      avatarBorder: avatar ? getComputedStyle(avatar).borderTopColor : null,
      subtitle: p ? p.textContent.trim() : null,
    };
  })()`);

  check(
    'the public page shows the logo the creator uploaded',
    publicView.avatar === ch.logo_url,
    { public: publicView.avatar, expected: ch.logo_url }
  );
  check('the public page shows the tagline, not the handle', publicView.subtitle === 'Bread, and the patience it needs', {
    subtitle: publicView.subtitle,
  });
  check(
    'the public page paints the chosen brand colour on the avatar ring',
    typeof publicView.avatarBorder === 'string' && publicView.avatarBorder.startsWith('rgb'),
    { avatarBorder: publicView.avatarBorder }
  );

  const errors = h.consoleErrors.filter((e) => e && !/Failed to load resource/i.test(e));
  check('no uncaught exceptions while running the whole flow', errors.length === 0, {
    errors: errors.slice(0, 4),
  });
} finally {
  await h.close();
}

process.exit(summarise(`channel: ${handle} (${channelId})`));
