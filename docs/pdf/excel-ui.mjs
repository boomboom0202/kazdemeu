/* Импорт и экспорт Excel через настоящий интерфейс: снимки для инструкции
   и заодно проверка, что загрузка файла работает как задумано. */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const URL = 'https://open-test.ektu.kz';
const DIR = '/shots/golive';
mkdirSync(DIR, { recursive: true });

const bad = [];
const step = (l, ok, e = '') => {
  console.log((ok ? '  OK    ' : '  СБОЙ  ') + l + (e ? '   ' + e : ''));
  if (!ok) bad.push(l);
};

const browser = await chromium.launch();
async function open(login, password) {
  const ctx = await browser.newContext({ viewport: { width: 1340, height: 940 },
                                         deviceScaleFactor: 2, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(URL + '/login', { waitUntil: 'networkidle' });
  await page.fill('input >> nth=0', login);
  await page.fill('input[type=password]', password);
  await page.click('button:has-text("Войти")');
  await page.waitForSelector('.nav a', { timeout: 30000 });
  await page.waitForTimeout(1600);
  return { ctx, page };
}
const shot = (page, n) => page.screenshot({ path: `${DIR}/${n}.png` });

const { ctx, page } = await open('menedzher', 'Start2026!');

// ── ПЛАН ЗАКУПОК ────────────────────────────────────────────────
console.log('\n=== ПЛАН ЗАКУПОК: импорт файла заказчика ===');
await page.click('.nav a:has-text("Тендеры")');
await page.waitForTimeout(1800);
await shot(page, '39-tendery-pusto-knopki');
const head = await page.locator('.pagehead').first().innerText();
step('кнопки импорта и экспорта на месте', /Импорт из Excel/.test(head) && /Экспорт в Excel/.test(head),
     head.replace(/\n/g, ' · ').slice(0, 130));

// текст всплывающего окна с итогом импорта перехватываем
let firstAlert = '';
page.once('dialog', async d => { firstAlert = d.message(); await d.accept(); });
await page.setInputFiles('input[type=file]', '/shots/plan-zakupok.xlsx');
await page.waitForTimeout(3500);
console.log('   окно после импорта: ' + JSON.stringify(firstAlert));
step('импорт сообщил, сколько добавлено', /добавлено 3/.test(firstAlert), firstAlert);
await shot(page, '40-tendery-posle-importa');
const rows = await page.locator('table tbody tr').count();
step('лоты появились в таблице', rows >= 3, `строк: ${rows}`);

// повторная загрузка того же файла
let secondAlert = '';
page.once('dialog', async d => { secondAlert = d.message(); await d.accept(); });
await page.setInputFiles('input[type=file]', '/shots/plan-zakupok.xlsx');
await page.waitForTimeout(3500);
console.log('   окно после повторного импорта: ' + JSON.stringify(secondAlert));
step('повторная загрузка обновляет, а не удваивает',
     /добавлено 0/.test(secondAlert) && /обновлено 3/.test(secondAlert), secondAlert);
await shot(page, '41-tendery-povtornyy-import');
const rows2 = await page.locator('table tbody tr').count();
step('строк столько же, сколько было', rows2 === rows, `${rows} → ${rows2}`);

// выгрузка
const dl = page.waitForEvent('download');
await page.click('button:has-text("Экспорт в Excel")');
const file = await dl;
step('выгрузка скачивается', !!file.suggestedFilename(), file.suggestedFilename());
await file.saveAs('/shots/vygruzka-plana.xlsx');

// ── ДОГОВОРЫ ────────────────────────────────────────────────────
console.log('\n=== ДОГОВОРЫ: те же кнопки ===');
await page.click('.nav a:has-text("Договоры")');
await page.waitForTimeout(1800);
await shot(page, '42-dogovory-knopki-excel');
const head2 = await page.locator('.pagehead').first().innerText();
step('кнопки импорта и экспорта на месте', /Импорт из Excel/.test(head2), head2.replace(/\n/g, ' · ').slice(0, 130));

let cAlert = '';
page.once('dialog', async d => { cAlert = d.message(); await d.accept(); });
await page.setInputFiles('input[type=file]', '/shots/dogovory.xlsx');
await page.waitForTimeout(3500);
console.log('   окно после импорта договоров: ' + JSON.stringify(cAlert));
step('договоры загрузились', /создано 2/.test(cAlert), cAlert);
await shot(page, '43-dogovory-posle-importa');

console.log('\nИТОГ: сбоев ' + bad.length);
bad.forEach(b => console.log('   -', b));
await ctx.close();
await browser.close();
