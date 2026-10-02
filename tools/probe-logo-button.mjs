import { ENV, openHarness, fillCreateForm } from './lib/harness.mjs';

const h = await openHarness({ onLog: (m) => console.log(m) });
try {
  const token = await h.apiToken();
  await h.signIn();
  await h.reachDashboard(token);

  // The setup page REDIRECTS AWAY when nothing is pending - it is a gate, not a
  // settings page. The first version of this probe went there directly and found
  // `input: null`, which looked exactly like "the logo field is missing" and was
  // really "there was nothing to set up".
  const handle = `btn${Date.now().toString(36).slice(-6)}`;
  await h.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')]
      .find(x => /create a channel|new channel|create channel/i.test(x.textContent || ''));
    b?.click();
    return !!b;
  })()`);
  await new Promise((r) => setTimeout(r, 900));
  await h.evaluate(fillCreateForm(handle));
  await new Promise((r) => setTimeout(r, 400));
  await h.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')]
      .find(x => /^create channel$/i.test((x.textContent||'').trim()));
    b?.click();
    return !!b;
  })()`);
  await new Promise((r) => setTimeout(r, 4000));
  console.log('landed on:', await h.path());

  const dom = await h.evaluate(`(() => {
    const input = document.querySelector('input[data-track="setup-logo-input"]');
    const label = document.querySelector('[data-track="setup-logo-button"]');
    if (!input) return { input: null, bodyHasSetup: /Set up your channel/i.test(document.body.innerText) };
    const cs = getComputedStyle(input);
    return {
      inputId: input.id || null,
      labelFor: label ? label.getAttribute('for') : null,
      labelText: label ? label.textContent.trim() : null,
      computedDisplay: cs.display,
      // The property that actually decides whether a label can activate its input.
      labelControl: label && label.control ? label.control.tagName + '#' + label.control.id : null,
      idsMatch: label ? label.getAttribute('for') === input.id : null,
    };
  })()`);
  console.log('DOM:', JSON.stringify(dom, null, 2));

  const viaLabel = await h.clickOpensFileChooser('[data-track="setup-logo-button"]');
  console.log('chooser via label click:', viaLabel);

  // Separates "the label is broken" from "the file-chooser interception is broken".
  const viaInput = await h.clickOpensFileChooser('input[data-track="setup-logo-input"]');
  console.log('chooser via input click:', viaInput);
} finally {
  await h.close();
}
