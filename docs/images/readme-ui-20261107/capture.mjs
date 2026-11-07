import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [modulePath, origin, output] = process.argv.slice(2);
if (!modulePath || !origin || !output) throw new Error('Usage: node capture.mjs <playwright-module> <loopback-origin> <output-directory>');
const local = (url) => {
  const parsed = new URL(url);
  return ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
};
if (!local(origin)) throw new Error('Capture origin must be loopback');
const { chromium } = await import(pathToFileURL(resolve(modulePath)).href);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--disable-background-networking'] });
const result = { capturedAt: new Date().toISOString(), browserVersion: browser.version(), viewport: { width: 1440, height: 1050 }, externalAttempts: [], pageErrors: [], consoleErrors: [], captures: [] };
try {
  const context = await browser.newContext({ viewport: result.viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', locale: 'en-GB', timezoneId: 'Asia/Kolkata' });
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('data:') || url.startsWith('blob:') || local(url)) return route.continue();
    result.externalAttempts.push({ url, method: route.request().method() });
    await route.abort('blockedbyclient');
  });
  await context.routeWebSocket(/.*/, (websocket) => {
    if (local(websocket.url())) websocket.connectToServer();
    else { result.externalAttempts.push({ url: websocket.url(), method: 'WebSocket' }); websocket.close(); }
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => result.pageErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
  for (const item of [
    { path: '/?mode=simulated', file: 'dashboard-simulated.png', heading: 'Follow a request' },
    { path: '/?page=docs', file: 'developer-docs.png', heading: 'Route reads privately, or fail closed. Then prove it.' },
  ]) {
    await page.goto(new URL(item.path, origin).href, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: item.heading, exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: resolve(output, item.file), fullPage: false, animations: 'disabled' });
    result.captures.push({ file: item.file, path: item.path, title: await page.title() });
  }
  await context.close();
} finally { await browser.close(); }
await writeFile(resolve(output, 'capture-result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
if (result.externalAttempts.length || result.pageErrors.length || result.consoleErrors.length) process.exitCode = 1;
