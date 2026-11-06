import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyFrameInventory, collectFrameDescriptors } from './hosting-frames.mjs';

const worker = () => ({ monolithTitle: true, monolithSource: true, hidden: true, noSrcdoc: true });
const challenge = () => ({ hidden: false, blankSource: true, noSrcdoc: true, unnamed: true, onePixel: true,
  hiddenAtOrigin: true, challengeReadable: true, challengeSource: true, challengeParameters: true });

describe('live runner frame ownership boundary (SIMULATED)', () => {
  it('requires no global frames in preview before startup', () => {
    expect(classifyFrameInventory([])).toEqual({ valid: true, total: 0, monolith: 0, cloudflare: 0, unknown: 0 });
    expect(classifyFrameInventory([challenge()]).valid).toBe(false);
  });
  it('separately counts exactly recognized hosting and application frames in deployed mode', () => {
    expect(classifyFrameInventory([challenge(), worker()], { allowCloudflare: true }))
      .toEqual({ valid: true, total: 2, monolith: 1, cloudflare: 1, unknown: 0 });
    expect(classifyFrameInventory([challenge()], { allowCloudflare: true }).monolith).toBe(0);
    expect(classifyFrameInventory([worker()]).monolith).toBe(1);
  });
  for (const field of ['monolithTitle', 'monolithSource', 'hidden', 'noSrcdoc']) {
    it(`rejects a worker-looking frame with an invalid ${field}`, () => {
      expect(classifyFrameInventory([{ ...worker(), [field]: false }], { allowCloudflare: true }).valid).toBe(false);
    });
  }
  for (const field of Object.keys(challenge())) {
    it(`does not ignore a hidden frame without confirmed ${field}`, () => {
      expect(classifyFrameInventory([{ ...challenge(), [field]: field === 'hidden' }], { allowCloudflare: true }))
        .toMatchObject({ valid: false, cloudflare: 0, unknown: 1 });
    });
  }
  it('rejects duplicate hosting or worker frames', () => {
    expect(classifyFrameInventory([challenge(), challenge()], { allowCloudflare: true }).valid).toBe(false);
    expect(classifyFrameInventory([worker(), worker()], { allowCloudflare: true }).valid).toBe(false);
  });
  it('does not treat plausible attributes alone as Cloudflare source evidence', () => {
    const frame = { blankSource: true, noSrcdoc: true, unnamed: true, onePixel: true, hiddenAtOrigin: true };
    expect(classifyFrameInventory([frame], { allowCloudflare: true }).valid).toBe(false);
  });
  it('keeps unknown additional frames visible even alongside known frames', () => {
    expect(classifyFrameInventory([worker(), challenge(), {}], { allowCloudflare: true }))
      .toMatchObject({ valid: false, monolith: 1, cloudflare: 1, unknown: 1 });
  });
  it('rejects malformed inputs and truthy strings rather than widening the exemption', () => {
    for (const frames of [null, {}, Array.from({ length: 65 }, worker), [null], ['hidden']]) {
      expect(classifyFrameInventory(frames, { allowCloudflare: true }).valid).toBe(false);
    }
    expect(classifyFrameInventory([challenge()], { allowCloudflare: 'true' }).valid).toBe(false);
    expect(classifyFrameInventory([{ ...challenge(), challengeParameters: 'true' }], { allowCloudflare: true }).valid).toBe(false);
  });
});

afterEach(() => vi.unstubAllGlobals());
const origin = 'https://monolith.host';
function fakeChallenge() {
  const attributes = new Map([['width', '1'], ['height', '1']]);
  const params = { r: '0123456789abcdef', t: btoa('1793994000') };
  const scripts = [{ getAttribute: () => `${origin}/cdn-cgi/challenge-platform/scripts/jsd/main.js?ray=${params.r}` }];
  const frame = { title: '', id: '', name: '', hidden: false,
    getAttribute: (name) => attributes.get(name) ?? null, hasAttribute: (name) => attributes.has(name),
    getBoundingClientRect: () => ({ width: 1, height: 1 }),
    style: { position: 'absolute', top: '0px', left: '0px', visibility: 'hidden' },
    contentDocument: { querySelectorAll: () => scripts }, contentWindow: { '__CF$cv$params': params } };
  return { frame, attributes, params, scripts };
}
function inspect(frame) {
  vi.stubGlobal('document', { querySelectorAll: () => [frame] });
  const descriptors = collectFrameDescriptors({ origin });
  return { descriptors, inventory: classifyFrameInventory(descriptors, { allowCloudflare: true }) };
}

describe('actual DOM descriptor collector with synthetic browser objects', () => {
  it('recognizes matching same-origin challenge script and canonical parameters without exporting their values', () => {
    const f = fakeChallenge(); const result = inspect(f.frame);
    expect(result.inventory).toMatchObject({ valid: true, monolith: 0, cloudflare: 1 });
    const publicJson = JSON.stringify(result.descriptors);
    for (const value of [f.params.r, f.params.t, origin, '1793994000']) expect(publicJson).not.toContain(value);
  });
  for (const source of [
    `https://other.host/cdn-cgi/challenge-platform/scripts/jsd/main.js?ray=0123456789abcdef`,
    `https://user:synthetic@monolith.host/cdn-cgi/challenge-platform/scripts/jsd/main.js?ray=0123456789abcdef`,
    `${origin}/cdn-cgi/challenge-platform/scripts/jsd/other.js?ray=0123456789abcdef`,
    `${origin}/cdn-cgi/challenge-platform/scripts/jsd/main.js?ray=0123456789abcdef&extra=synthetic`,
    `${origin}/cdn-cgi/challenge-platform/scripts/jsd/main.js?ray=0123456789abcdef&ray=0123456789abcdef`,
    `${origin}/cdn-cgi/challenge-platform/scripts/jsd/main.js?ray=0123456789abcdef#fragment`,
    `${origin}/cdn-cgi/challenge-platform/scripts/jsd/main.js?ray=ffffffffffffffff`,
    'https://',
  ]) {
    it(`rejects an unrecognized or inconsistent challenge source: ${source}`, () => {
      const f = fakeChallenge(); f.scripts[0].getAttribute = () => source;
      expect(inspect(f.frame).inventory.valid).toBe(false);
    });
  }
  for (const time of ['not-base64', btoa('stable-user'), btoa('17939940000'), `${btoa('1793994000')} `]) {
    it(`rejects malformed or noncanonical challenge time ${time}`, () => {
      const f = fakeChallenge(); f.params.t = time;
      expect(inspect(f.frame).inventory.valid).toBe(false);
    });
  }
  it('rejects extra challenge fields, multiple source scripts and unreadable child documents', () => {
    let f = fakeChallenge(); f.params.extra = 'synthetic'; expect(inspect(f.frame).inventory.valid).toBe(false);
    f = fakeChallenge(); f.scripts.push(f.scripts[0]); expect(inspect(f.frame).inventory.valid).toBe(false);
    f = fakeChallenge(); Object.defineProperty(f.frame, 'contentDocument', { get() { throw new Error('SIMULATED_CROSS_ORIGIN'); } });
    expect(inspect(f.frame).inventory.valid).toBe(false);
  });
  it('does not ignore src, srcdoc or visible impostor frames even with matching challenge metadata', () => {
    for (const attribute of ['src', 'srcdoc']) {
      const f = fakeChallenge(); f.attributes.set(attribute, 'synthetic'); expect(inspect(f.frame).inventory.valid).toBe(false);
    }
    const f = fakeChallenge(); f.frame.style.visibility = 'visible'; expect(inspect(f.frame).inventory.valid).toBe(false);
  });
});
