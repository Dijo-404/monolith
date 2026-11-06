import { installBrowserHost } from '@monolith/transport/browser';

if (window.parent === window || window.parent.location.origin !== location.origin) {
  throw new Error('Lab host requires its configured parent.');
}
const dispose = installBrowserHost();
window.addEventListener('pagehide', dispose, { once: true });
