// Печать HTML-руководства в PDF headless-браузером.
//   node печать-pdf.mjs <файл.html> <файл.pdf>
// Локально берётся установленный Chrome (путь — переменная CHROME),
// на сервере — браузер из образа playwright.
import { pathToFileURL } from 'node:url';

const [html, pdf] = process.argv.slice(2);
let chromium, opts = {};
try {
  ({ chromium } = await import('playwright-core'));
  opts.executablePath = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
} catch {
  ({ chromium } = await import('playwright'));
}
const browser = await chromium.launch(opts);
const page = await (await browser.newContext({ colorScheme: 'light' })).newPage();
await page.goto(pathToFileURL(html).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1200);
await page.emulateMedia({ media: 'print', colorScheme: 'light' });
await page.pdf({
  path: pdf, format: 'A4', printBackground: true,
  margin: { top: '12mm', bottom: '14mm', left: '10mm', right: '10mm' },
  displayHeaderFooter: true, headerTemplate: '<div></div>',
  footerTemplate: `<div style="width:100%;font-family:sans-serif;font-size:8pt;color:#8a8f9c;
    padding:0 12mm;display:flex;justify-content:space-between;">
    <span>КазДемеу · open-test.ektu.kz</span>
    <span>стр. <span class="pageNumber"></span> из <span class="totalPages"></span></span></div>`,
});
console.log('готово:', pdf);
await browser.close();
