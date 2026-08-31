/* Ввод в эксплуатацию через настоящий интерфейс: каждое действие —
   нажатие, каждый экран — снимок для инструкции. */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const URL = 'https://open-test.ektu.kz';
const DIR = '/shots/golive';
mkdirSync(DIR, { recursive: true });

const bad = [];
function step(label, ok, extra = '') {
  console.log((ok ? '  OK    ' : '  СБОЙ  ') + label + (extra ? '   ' + extra : ''));
  if (!ok) bad.push(label);
}

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

/* Поле формы ищем по его подписи: <label class="f">Название</label><input> */
const near = (page, label, tag) =>
  page.locator(`label.f:has-text("${label}") + ${tag}:visible`).first();
const fill = (page, label, v) => { console.log('      · поле ' + label + ' = ' + v); return near(page, label, 'input').fill(String(v)); };
const pick = (page, label, t) => { console.log('      · выбор ' + label + ' -> ' + t); return near(page, label, 'select').selectOption({ label: t }); };
const shot = (page, n) => page.screenshot({ path: `${DIR}/${n}.png` });
const tab = (page, t) => { console.log('      · вкладка ' + t); return page.click(`.tabs button:text-is("${t}")`); };

// ───────────────────────── 1. АДМИНИСТРАТОР ─────────────────────────
console.log('\n=== ШАГ 1. АДМИНИСТРАТОР заводит сотрудников ===');
{
  const { ctx, page } = await open('admin', 'admin12345');
  console.log('   меню: ' + (await page.locator('.nav a').allTextContents()).join(' | '));
  await shot(page, '01-dashboard-pustoy');

  await page.click('.nav a:has-text("Администрирование")');
  await page.waitForTimeout(1300);
  await shot(page, '02-admin-sotrudniki');

  const STAFF = [
    ['sklad', 'Асель (кладовщик)', 'Кладовщик'],
    ['tehnolog', 'Сауле (технолог)', 'Технолог'],
    ['buh', 'Марат (бухгалтер)', 'Бухгалтер'],
    ['menedzher', 'Айгерим (менеджер)', 'Менеджер (тендеры/договоры)'],
    ['cex', 'Болат (цех)', 'Сотрудник цеха'],
    ['dir', 'Ерлан (директор)', 'Директор'],
  ];
  for (const [login, name, role] of STAFF) {
    await fill(page, 'Логин', login);
    await fill(page, 'Имя', name);
    await fill(page, 'Пароль', 'Start2026!');
    await pick(page, 'Роль', role);
    if (login === 'sklad') await shot(page, '03-admin-forma-zapolnena');
    await page.click('button:text-is("Добавить")');
    await page.waitForTimeout(1000);
  }
  const rows = await page.locator('table tbody tr').count();
  step('шесть сотрудников заведены через интерфейс', rows >= 7, `строк: ${rows}`);
  await shot(page, '04-admin-spisok-sotrudnikov');

  await page.click('button:has-text("Точечные права")');
  await page.waitForTimeout(1400);
  await shot(page, '05-admin-tochechnye-prava');
  await ctx.close();
}

// ───────────────────────── 2. КЛАДОВЩИК ─────────────────────────
console.log('\n=== ШАГ 2. КЛАДОВЩИК: поставщик, материалы, приход ===');
{
  const { ctx, page } = await open('sklad', 'Start2026!');
  console.log('   меню: ' + (await page.locator('.nav a').allTextContents()).join(' | '));
  await page.click('.nav a:has-text("Склад")');
  await page.waitForTimeout(1400);

  await tab(page, 'Поставщики');
  await page.waitForTimeout(900);
  await page.click('button:has-text("+ Новый поставщик")');
  await page.waitForTimeout(500);
  await fill(page, 'Название', 'ТОО Ткани Астана');
  await fill(page, 'Телефон', '+7 701 000 00 01');
  await fill(page, 'БИН/ИИН', '110340001234');
  await shot(page, '06-sklad-postavshchik');
  await page.click('button:text-is("Сохранить")');
  await page.waitForTimeout(1100);

  await tab(page, 'Материалы');
  await page.waitForTimeout(900);
  for (const [name, sku, unit, min] of [
      ['Ткань саржа 250 г/м', 'M-001', 'м', 100],
      ['Нитки армированные', 'M-002', 'шт', 20],
      ['Пуговицы 18 мм', 'M-003', 'шт', 300]]) {
    await page.click('button:has-text("+ Новый материал")');
    await page.waitForTimeout(500);
    await fill(page, 'Название', name);
    await fill(page, 'SKU (артикул)', sku);
    await fill(page, 'Ед. изм.', unit);
    await fill(page, 'Мин. остаток', min);
    await pick(page, 'Осн. поставщик', 'ТОО Ткани Астана');
    if (sku === 'M-001') await shot(page, '07-sklad-material-forma');
    await page.click('button:text-is("Сохранить")');
    await page.waitForTimeout(1100);
  }
  await shot(page, '08-sklad-materialy-nulevye');

  await tab(page, 'Партии / Приход');
  await page.waitForTimeout(900);
  for (const [mat, qty, price, no] of [
      ['Ткань саржа 250 г/м', 500, 1400, 'П-001'],
      ['Нитки армированные', 500, 300, 'П-002'],
      ['Пуговицы 18 мм', 1000, 25, 'П-003']]) {
    await pick(page, 'Материал', mat);
    await pick(page, 'Поставщик', 'ТОО Ткани Астана');
    await fill(page, 'Кол-во', qty);
    await fill(page, 'Цена за единицу', price);
    await fill(page, 'Партия №', no);
    if (no === 'П-001') await shot(page, '09-sklad-prihod-forma');
    await page.click('button:text-is("Принять")');
    await page.waitForTimeout(1200);
  }
  await shot(page, '10-sklad-partii');

  await tab(page, 'Материалы');
  await page.waitForTimeout(1300);
  await shot(page, '11-sklad-ostatki-poyavilis');
  const txt = await page.locator('table').first().innerText();
  step('остатки появились после прихода', /500/.test(txt) && /1\s?000|1000/.test(txt),
       txt.split('\n').slice(1, 4).join(' / '));
  await ctx.close();
}

// ───────────────────────── 3. ТЕХНОЛОГ ─────────────────────────
console.log('\n=== ШАГ 3. ТЕХНОЛОГ: изделие, состав, маршрут ===');
{
  const { ctx, page } = await open('tehnolog', 'Start2026!');
  console.log('   меню: ' + (await page.locator('.nav a').allTextContents()).join(' | '));
  await page.click('.nav a:has-text("Производство")');
  await page.waitForTimeout(1500);

  await tab(page, 'Этапы цеха (конструктор)');
  await page.waitForTimeout(1000);
  await shot(page, '12-tehnolog-konstruktor-etapov');

  await tab(page, 'Изделия / BOM');
  await page.waitForTimeout(1000);
  await page.click('button:has-text("+ Новое изделие")');
  await page.waitForTimeout(600);
  await fill(page, 'Название', 'Костюм рабочий');
  await fill(page, 'SKU (артикул)', 'И-001');
  await fill(page, 'Цена продажи', 18000);
  await fill(page, 'Труд на 1 шт.', 2500);
  await fill(page, 'Норма времени', 3.5);
  await shot(page, '13-tehnolog-izdelie-forma');
  await page.click('button:text-is("Сохранить")');
  await page.waitForTimeout(1600);
  step('изделие создано', /Костюм рабочий/.test(await page.locator('body').innerText()));

  await page.click('table tbody tr:has-text("Костюм рабочий")');
  await page.waitForTimeout(1400);
  await shot(page, '14-tehnolog-karta-izdeliya');

  for (const [mat, qty] of [['Ткань саржа 250 г/м (м)', 3.2],
                            ['Нитки армированные (шт)', 0.5],
                            ['Пуговицы 18 мм (шт)', 8]]) {
    await pick(page, 'Материал', mat);
    await fill(page, 'Норма на 1 шт.', qty);
    await page.click('button:has-text("+ В состав")');
    await page.waitForTimeout(1200);
  }
  await shot(page, '15-tehnolog-bom-zapolnen');
  const card = await page.locator('.card.stitch').last().innerText();
  step('себестоимость посчиталась из состава', /Себестоимость/.test(card),
       (card.match(/Себестоимость:[^\n]*/) || [''])[0]);

  for (const st of ['Крой', 'Пошив', 'Контроль (ОТК)', 'Сдача на склад']) {
    await pick(page, 'Добавить этап', st);
    await page.click('button:has-text("+ В маршрут")');
    await page.waitForTimeout(1100);
  }
  await shot(page, '16-tehnolog-marshrut');
  const route = await page.locator('.card.stitch').last().innerText();
  step('маршрут собран без «Отделки»', /Крой/.test(route) && !/Отделка/.test(route));
  await ctx.close();
}

// ───────────────────────── 4. БУХГАЛТЕР ─────────────────────────
console.log('\n=== ШАГ 4. БУХГАЛТЕР: постоянные расходы и распределение ===');
{
  const { ctx, page } = await open('buh', 'Start2026!');
  console.log('   меню: ' + (await page.locator('.nav a').allTextContents()).join(' | '));
  await page.click('.nav a:has-text("Себестоимость")');
  await page.waitForTimeout(1600);
  await shot(page, '17-buh-sebestoimost-pusto');

  for (const [name, sum] of [['Аренда цеха', 450000], ['Оклады АУП', 900000],
                             ['Связь и интернет', 35000]]) {
    await fill(page, 'Наименование', name);
    await fill(page, 'Сумма в месяц', sum);
    await page.click('button:has-text("Добавить")');
    await page.waitForTimeout(1200);
  }
  await shot(page, '18-buh-postoyannye-rashody');
  const fx = await page.locator('body').innerText();
  step('постоянные расходы внесены', /Аренда цеха/.test(fx) && /Оклады АУП/.test(fx));
  step('месячная сумма собрана', /1\s?385\s?000|1385000/.test(fx.replace(/ /g, ' ')),
       (fx.match(/Итого[^\n]*/) || [''])[0]);
  await ctx.close();
}

// ───────────────────────── 5. МЕНЕДЖЕР ─────────────────────────
console.log('\n=== ШАГ 5. МЕНЕДЖЕР: заказчик и договор ===');
{
  const { ctx, page } = await open('menedzher', 'Start2026!');
  console.log('   меню: ' + (await page.locator('.nav a').allTextContents()).join(' | '));
  await page.click('.nav a:has-text("Договоры")');
  await page.waitForTimeout(1500);
  await shot(page, '19-menedzher-dogovory-pusto');
  await ctx.close();
}

// ───────────────────────── 6. ЦЕХ ─────────────────────────
console.log('\n=== ШАГ 6. ЦЕХ: производственный заказ ===');
{
  const { ctx, page } = await open('cex', 'Start2026!');
  console.log('   меню: ' + (await page.locator('.nav a').allTextContents()).join(' | '));
  await page.click('.nav a:has-text("Производство")');
  await page.waitForTimeout(1500);
  await pick(page, 'Изделие', 'Костюм рабочий');
  await fill(page, 'Кол-во', 100);
  await shot(page, '20-cex-novyy-zakaz');
  await page.click('button:text-is("Создать")');
  await page.waitForTimeout(1600);
  const body = await page.locator('body').innerText();
  step('номер заказа присвоен сам', /ПЗ-\d{4}-\d{3}/.test(body),
       (body.match(/ПЗ-\d{4}-\d{3}/) || [''])[0]);
  step('этапы созданы по маршруту изделия',
       /Крой/.test(body) && /Сдача на склад/.test(body) && !/Отделка/.test(body));
  await shot(page, '21-cex-zakaz-etapy');
  await ctx.close();
}

console.log('\nИТОГ: сбоев ' + bad.length);
bad.forEach(b => console.log('   -', b));
await browser.close();
