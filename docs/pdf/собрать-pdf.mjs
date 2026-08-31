import { chromium } from 'playwright';
const JOBS = [
  ['manual-manager.html',    'КазДемеу-Менеджер.pdf'],
  ['manual-accountant.html', 'КазДемеу-Бухгалтер.pdf'],
  ['manual-director.html',   'КазДемеу-Директор.pdf'],
  ['manual-worker.html',     'КазДемеу-Сотрудник-цеха.pdf'],
];
const browser = await chromium.launch();
const page = await (await browser.newContext({ colorScheme: 'light' })).newPage();
for (const [html, pdf] of JOBS) {
  await page.goto('file:///shots/pdf/' + html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  await page.emulateMedia({ media: 'print', colorScheme: 'light' });
  await page.pdf({
    path: '/shots/pdf/' + pdf, format: 'A4', printBackground: true,
    margin: { top: '12mm', bottom: '14mm', left: '10mm', right: '10mm' },
    displayHeaderFooter: true, headerTemplate: '<div></div>',
    footerTemplate: `<div style="width:100%;font-family:sans-serif;font-size:8pt;color:#8a8f9c;
      padding:0 12mm;display:flex;justify-content:space-between;">
      <span>КазДемеу · open-test.ektu.kz</span>
      <span>стр. <span class="pageNumber"></span> из <span class="totalPages"></span></span></div>`,
  });
  console.log('готово:', pdf);
}
await browser.close();
