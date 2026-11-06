/* global document */

// Serialized into the actual page by Playwright. Return only bounded booleans;
// never export challenge IDs, URLs, timestamps or arbitrary frame attributes.
export function collectFrameDescriptors({ origin }) {
  return [...document.querySelectorAll('iframe')].map((frame) => {
    const descriptor = {
      monolithTitle: frame.title === 'Monolith disposable worker host',
      monolithSource: frame.getAttribute('src') === `${origin}/assets/worker-host.html`,
      hidden: frame.hidden === true,
      blankSource: !frame.hasAttribute('src'),
      noSrcdoc: !frame.hasAttribute('srcdoc'),
      unnamed: !frame.id && !frame.name && !frame.title,
      onePixel: frame.getAttribute('width') === '1' && frame.getAttribute('height') === '1'
        && frame.getBoundingClientRect().width === 1 && frame.getBoundingClientRect().height === 1,
      hiddenAtOrigin: frame.style.position === 'absolute' && frame.style.top === '0px'
        && frame.style.left === '0px' && frame.style.visibility === 'hidden',
      challengeReadable: false, challengeSource: false, challengeParameters: false,
    };
    try {
      const child = frame.contentDocument;
      const scripts = child ? [...child.querySelectorAll('script[src]')] : [];
      const params = frame.contentWindow?.['__CF$cv$params'];
      descriptor.challengeReadable = child !== null;
      if (scripts.length === 1) {
        const source = new URL(scripts[0].getAttribute('src'), origin);
        descriptor.challengeSource = source.origin === origin && source.username === '' && source.password === ''
          && source.pathname === '/cdn-cgi/challenge-platform/scripts/jsd/main.js' && source.hash === ''
          && [...source.searchParams.keys()].join(',') === 'ray'
          && /^[0-9a-f]{16}$/.test(source.searchParams.get('ray') ?? '');
        if (params && typeof params === 'object' && !Array.isArray(params)
          && Object.keys(params).sort().join(',') === 'r,t'
          && typeof params.r === 'string' && typeof params.t === 'string') {
          const time = atob(params.t);
          descriptor.challengeParameters = descriptor.challengeSource && params.r === source.searchParams.get('ray')
            && /^\d{10}$/.test(time) && btoa(time) === params.t;
        }
      }
    } catch { /* A cross-origin, malformed or unrecognized frame earns no hosting exemption. */ }
    return descriptor;
  });
}

// This identifies an observed hosting footprint; it is not an authenticity or
// anonymity proof. The separate served-document check pins the hosting addition.
export function classifyFrameInventory(frames, { allowCloudflare = false } = {}) {
  if (!Array.isArray(frames) || frames.length > 64) {
    return { valid: false, total: 0, monolith: 0, cloudflare: 0, unknown: 1 };
  }
  let monolith = 0; let cloudflare = 0; let unknown = 0;
  for (const frame of frames) {
    if (frame && frame.monolithTitle === true && frame.monolithSource === true
      && frame.hidden === true && frame.noSrcdoc === true) monolith++;
    else if (allowCloudflare === true && frame && frame.hidden === false && frame.blankSource === true && frame.noSrcdoc === true
      && frame.unnamed === true && frame.onePixel === true && frame.hiddenAtOrigin === true
      && frame.challengeReadable === true && frame.challengeSource === true && frame.challengeParameters === true) cloudflare++;
    else unknown++;
  }
  return { valid: unknown === 0 && monolith <= 1 && cloudflare <= 1,
    total: frames.length, monolith, cloudflare, unknown };
}
