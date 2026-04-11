import { chromium } from 'playwright';

const url = process.env.URL || 'http://127.0.0.1:5174';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  console.log('Navigating to', url);
  await page.goto(url, { waitUntil: 'networkidle' });
  try {
    await page.waitForFunction(() => (window as any).__mapState === 'loaded', { timeout: 20000 });
  } catch (e) {
    // proceed even if map didn't signal loaded
  }

  const result = await page.evaluate(() => {
    function info(el) {
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName,
        id: el.id || null,
        className: el.className || null,
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        offsetWidth: el.offsetWidth,
        computedOverflowX: cs.overflowX,
        computedOverflowY: cs.overflowY,
      };
    }

    function sel(n) {
      if (n.id) return `#${n.id}`;
      if (n.className && typeof n.className === 'string') return `${n.tagName.toLowerCase()}.${n.className.trim().split(/\s+/).join('.')}`;
      return n.tagName.toLowerCase();
    }

    const lm = document.getElementById('line-manager');
    const body = document.getElementById('line-manager-body');
    const overflowing = [];
    if (lm) {
      const nodes = Array.from(lm.querySelectorAll('*'));
      for (const n of nodes) {
        if (!(n instanceof HTMLElement)) continue;
        const cw = n.clientWidth || 0;
        const sw = n.scrollWidth || 0;
        if (sw > cw + 1) {
          overflowing.push({ selector: sel(n), clientWidth: cw, scrollWidth: sw });
        }
      }
    }

    return { lm: info(lm), body: info(body), overflowing };
  });

  console.log(JSON.stringify(result, null, 2));

  await browser.close();
  process.exit(0);
})();
