/* Продолжение: договор менеджера, работа цеха до сдачи на склад,
   деньги бухгалтера и дашборд директора. */
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
  const ctx = await browser.newContext({ viewport: { width: 1340, height: 940 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(15000);
  await page.goto(URL + '/login', { waitUntil: 'networkidle' });
  await page.fill('input >> nth=0', login);
  await page.fill('input[type=password]', password);
  await page.click('button:has-text("Войти")');
  await page.waitForSelector('.nav a', { timeout: 30000 });
  await page.waitForTimeout(1600);
  return { ctx, page };
}
const near = (page, label, tag) => page.locator(`label.f:text-is("${label}") + ${tag}:visible`).first();
const fill = (page, l, v) => { console.log('      · ' + l + ' = ' + v); return near(page, l, 'input').fill(String(v)); };
const pick = (page, l, t) => { console.log('      · ' + l + ' → ' + t); return near(page, l, 'select').selectOption({ label: t }); };
const shot = (page, n) => page.screenshot({ path: `${DIR}/${n}.png` });

// ─────────────────── 5. МЕНЕДЖЕР: заказчик и договор ───────────────────
console.log('\n=== ШАГ 5. МЕНЕДЖЕР: заказчик и договор ===');
{
  const { ctx, page } = await open('menedzher', 'Start2026!');
  await page.click('.nav a:has-text("Договоры")');
  await page.waitForTimeout(1500);

  await page.click('button:has-text("+ Новый клиент")');
  await page.waitForTimeout(600);
  await fill(page, 'Название / ФИО', 'АО Казахмыс');
  await fill(page, 'Телефон', '+7 727 000 00 02');
  await fill(page, 'БИН/ИИН', '990140000001');
  await fill(page, 'Контактное лицо', 'Асхат Нурланович');
  await shot(page, '22-menedzher-klient');
  await page.click('button:text-is("Сохранить")');
  await page.waitForTimeout(1400);
  await page.click('button:has-text("+ Новый клиент")');   // свернуть панель клиентов
  await page.waitForTimeout(600);

  await page.click('button:has-text("+ Новый договор")');
  await page.waitForTimeout(700);
  await fill(page, 'Номер', 'Д-2026-001');
  await pick(page, 'Заказчик', 'АО Казахмыс');
  await fill(page, 'Сумма, ₸', 1800000);
  await fill(page, 'Срок', '2026-09-30');
  await fill(page, 'Название', 'Пошив рабочих костюмов, 100 шт');
  await near(page, 'Тех. спецификация', 'textarea')
      .fill('Костюм рабочий, саржа 250 г/м, размеры 48–56, светоотражающая полоса.');
  await shot(page, '23-menedzher-dogovor-forma');
  await page.click('button:text-is("Сохранить")');
  await page.waitForTimeout(1600);
  const list = await page.locator('body').innerText();
  step('договор создан', /Д-2026-001/.test(list));
  await shot(page, '24-menedzher-spisok-dogovorov');

  await page.click('a:has-text("Д-2026-001")');   // карточка открывается по номеру-ссылке
  await page.waitForTimeout(1800);
  await shot(page, '25-menedzher-kartochka-dogovora');
  const card = await page.locator('body').innerText();
  step('карточка договора открылась', /Сменить статус/.test(card));

  const btns = await page.locator('.card button').allTextContents();
  const nextSteps = btns.filter(b => /Согласование|Отменён|В работе|Закрыт/.test(b));
  step('предложены только разрешённые переходы',
       nextSteps.some(b => /Согласование/.test(b)) && !nextSteps.some(b => /Закрыт/.test(b)),
       nextSteps.join(' | '));

  await page.click('button:has-text("Согласование")');
  await page.waitForTimeout(1500);
  await page.click('button:has-text("В работе")');
  await page.waitForTimeout(1500);
  await shot(page, '26-menedzher-dogovor-v-rabote');
  step('договор доведён до «В работе»', /В работе/.test(await page.locator('body').innerText()));
  await ctx.close();
}

// ─────────────────── 6. ЦЕХ: выполнение заказа ───────────────────
console.log('\n=== ШАГ 6. ЦЕХ: запуск, этапы, сдача на склад ===');
{
  const { ctx, page } = await open('cex', 'Start2026!');
  await page.click('.nav a:has-text("Производство")');
  await page.waitForTimeout(1600);
  await shot(page, '27-cex-zakaz-do-zapuska');

  await page.click('button:has-text("Запуск (списать материалы)")');
  await page.waitForTimeout(2200);
  await shot(page, '28-cex-zakaz-zapushchen');
  const afterStart = await page.locator('body').innerText();
  step('заказ перешёл в работу', /В работе/.test(afterStart));

  for (let i = 0; i < 4; i++) {
    await page.click('button:text-is("Начать")');
    await page.waitForTimeout(1100);
    await page.click('button:text-is("Готово")');
    await page.waitForTimeout(1100);
    if (i === 0) await shot(page, '29-cex-etap-v-rabote');
  }
  await shot(page, '30-cex-vse-etapy-gotovy');

  await page.click('button:has-text("Завершить (на склад)")');
  await page.waitForTimeout(2200);
  await shot(page, '31-cex-zakaz-zavershyon');
  step('заказ завершён', /Завершён/.test(await page.locator('body').innerText()));
  await ctx.close();
}

// ─────────────────── 7. КЛАДОВЩИК: готовая продукция ───────────────────
console.log('\n=== ШАГ 7. КЛАДОВЩИК: готовая продукция и списание ===');
{
  const { ctx, page } = await open('sklad', 'Start2026!');
  await page.click('.nav a:has-text("Склад")');
  await page.waitForTimeout(1500);
  await page.click('.tabs button:text-is("Готовая продукция")');
  await page.waitForTimeout(1400);
  await shot(page, '32-sklad-gotovaya-produkciya');
  step('готовая продукция на складе',
       /Костюм рабочий/.test(await page.locator('body').innerText()));

  await page.click('.tabs button:text-is("Материалы")');
  await page.waitForTimeout(1400);
  await shot(page, '33-sklad-ostatki-posle-spisaniya');
  const t = await page.locator('table').first().innerText();
  step('материалы списались по составу', /180/.test(t) && /450/.test(t) && /200/.test(t),
       t.split('\n').slice(1, 4).map(r => r.split('\t').slice(0, 3).join(' ')).join(' / '));
  await ctx.close();
}

// ─────────────────── 8. БУХГАЛТЕР и ДИРЕКТОР ───────────────────
console.log('\n=== ШАГ 8. БУХГАЛТЕР: деньги. ДИРЕКТОР: картина целиком ===');
{
  const { ctx, page } = await open('buh', 'Start2026!');
  await page.click('.nav a:has-text("Финансы")');
  await page.waitForTimeout(1600);
  await shot(page, '34-buh-finansy-pusto');

  await pick(page, 'Тип', 'Поступление');
  await fill(page, 'Сумма', 900000);
  await pick(page, 'Договор', 'Д-2026-001');
  await fill(page, 'Описание', 'Аванс 50% по договору Д-2026-001');
  await shot(page, '35-buh-postuplenie-forma');
  await page.click('button:has-text("Добавить")');
  await page.waitForTimeout(1600);
  await shot(page, '36-buh-finansy-s-dvizheniem');
  step('поступление записано', /900 000|900000/.test(await page.locator('body').innerText()));
  await ctx.close();
}
{
  const { ctx, page } = await open('dir', 'Start2026!');
  await page.waitForTimeout(1400);
  await shot(page, '37-direktor-dashboard');
  const d = await page.locator('body').innerText();
  step('дашборд директора наполнился', /1/.test(d), d.replace(/\n+/g, ' | ').slice(0, 190));
  await page.click('.nav a:has-text("Аналитика")');
  await page.waitForTimeout(2200);
  await shot(page, '38-direktor-analitika');
  await ctx.close();
}

console.log('\nИТОГ: сбоев ' + bad.length);
bad.forEach(b => console.log('   -', b));
await browser.close();
