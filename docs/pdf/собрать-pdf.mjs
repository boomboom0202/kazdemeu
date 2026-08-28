import { chromium } from 'playwright';

const JOBS = [
  { html: '/shots/pdf/manual-warehouse.html', pdf: '/shots/pdf/КазДемеу-Кладовщик.pdf' },
  { html: '/shots/pdf/manual-tech.html',      pdf: '/shots/pdf/КазДемеу-Технолог.pdf' },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ colorScheme: 'light' });
const page = await ctx.newPage();

for (const job of JOBS) {
  await page.goto('file://' + job.html, { waitUntil: 'networkidle' });
  // ждём шрифты, иначе в PDF попадёт запасная гарнитура
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  await page.emulateMedia({ media: 'print', colorScheme: 'light' });
  await page.pdf({
    path: job.pdf,
    format: 'A4',
    printBackground: true,
    margin: { top: '12mm', bottom: '14mm', left: '10mm', right: '10mm' },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `<div style="width:100%;font-family:sans-serif;font-size:8pt;color:#8a8f9c;
        padding:0 12mm;display:flex;justify-content:space-between;">
        <span>КазДемеу · open-test.ektu.kz</span>
        <span>стр. <span class="pageNumber"></span> из <span class="totalPages"></span></span>
      </div>`,
  });
  console.log('готово:', job.pdf);
}

await browser.close();
