import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const URL = 'https://open-test.ektu.kz';

// для каждой роли: логин и список экранов
const ROLES = {
  manager: {
    login: 'aigerim',
    screens: [
      ['01-dashboard',  null],
      ['02-tenders',    'Тендеры'],
      ['03-contracts',  'Договоры'],
      ['04-contract',   'CONTRACT_DETAIL'],
      ['05-production', 'Производство'],
      ['06-analytics',  'Аналитика'],
    ],
  },
  accountant: {
    login: 'marat',
    screens: [
      ['01-dashboard', null],
      ['02-finance',   'Финансы'],
      ['03-costprice', 'Себестоимость'],
      ['04-contracts', 'Договоры'],
      ['05-analytics', 'Аналитика'],
    ],
  },
  director: {
    login: 'director',
    screens: [
      ['01-dashboard',  null],
      ['02-analytics',  'Аналитика'],
      ['03-tenders',    'Тендеры'],
      ['04-finance',    'Финансы'],
      ['05-production', 'Производство'],
    ],
  },
  worker: {
    login: 'bolat',
    screens: [
      ['01-dashboard',  null],
      ['02-production', 'Производство'],
      ['03-products',   'PRODUCTS_TAB'],
    ],
  },
};

const browser = await chromium.launch();

for (const [role, cfg] of Object.entries(ROLES)) {
  const dir = `/shots/all/${role}`;
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  await page.goto(`${URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('input >> nth=0', cfg.login);
  await page.fill('input[type=password]', 'demo12345');
  await page.click('button:has-text("Войти")');
  await page.waitForSelector('.nav a', { timeout: 30000 });
  await page.waitForTimeout(1800);

  const menu = await page.locator('.nav a').allTextContents();
  console.log(`\n== ${role} (${cfg.login}) — пунктов меню: ${menu.length}`);
  console.log('   ' + menu.join(' | '));

  for (const [name, nav] of cfg.screens) {
    try {
      if (nav === 'CONTRACT_DETAIL') {
        await page.click('.nav a:has-text("Договоры")');
        await page.waitForTimeout(1600);
        await page.locator('table tbody tr td a, table tbody tr td:first-child').first().click();
        await page.waitForTimeout(2200);
      } else if (nav === 'PRODUCTS_TAB') {
        await page.click('.nav a:has-text("Производство")');
        await page.waitForTimeout(1500);
        await page.click('button:has-text("Изделия / BOM")');
        await page.waitForTimeout(1600);
      } else if (nav) {
        await page.click(`.nav a:has-text("${nav}")`);
        await page.waitForTimeout(2200);
      }
      await page.screenshot({ path: `${dir}/${name}.png` });
      console.log('   снято:', name);
    } catch (e) {
      console.log('   ПРОПУЩЕН:', name, '—', String(e).split('\n')[0].slice(0, 90));
    }
  }
  await ctx.close();
}

await browser.close();
console.log('\nГОТОВО');
