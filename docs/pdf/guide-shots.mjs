// Снимки для руководства «Как работать»: не страницы целиком, а тот блок,
// о котором идёт речь рядом в тексте. Снимаются в живой системе.
//   node guide-shots.mjs <папка для снимков> <папка с таблицами заказчика> [адрес]
// Логин и пароль — переменные SHOTS_USER / SHOTS_PASSWORD (администратор).
import { chromium } from 'playwright-core';

const OUT = process.argv[2];
const XL = process.argv[3];
const BASE = process.argv[4] || 'http://127.0.0.1:8011';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const b = await chromium.launch({ executablePath: CHROME });
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1.6 })).newPage();
p.setDefaultTimeout(25000);
const errors = [];
p.on('pageerror', e => errors.push(String(e)));
p.on('dialog', d => d.dismiss());

const settle = async () => { await p.waitForLoadState('networkidle'); await p.waitForTimeout(700) };
const nav = async (label) => { await p.click(`.nav a:text-is("${label}")`); await settle() };
const done = []

// Блок страницы с отступом; высокий обрезается, чтобы влезть на страницу PDF
async function part(selector, name, maxH = 1000) {
  const loc = p.locator(selector).first();
  await loc.scrollIntoViewIfNeeded();
  await p.waitForTimeout(250);
  const box = await loc.boundingBox();
  const sy = await p.evaluate(() => window.scrollY);
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true,
    clip: { x: Math.max(box.x - 8, 0), y: box.y + sy - 8, width: box.width + 16, height: Math.min(box.height + 16, maxH) } });
  done.push(name)
}
// Рабочая область без меню, сверху страницы
async function main(name, height = 820) {
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(200);
  const box = await p.locator('.main').boundingBox();
  await p.screenshot({ path: `${OUT}/${name}.png`, clip: { x: box.x, y: 0, width: box.width, height } });
  done.push(name)
}
async function api(method, url, body) {
  return p.evaluate(async ([method, url, body]) => {
    const r = await fetch('/api' + url, { method, headers: { 'Content-Type': 'application/json',
      Authorization: 'Bearer ' + localStorage.getItem('access') }, body: body ? JSON.stringify(body) : undefined })
    return r.json()
  }, [method, url, body])
}

await p.goto(BASE + '/login', { waitUntil: 'networkidle' });
await p.fill('input >> nth=0', process.env.SHOTS_USER || 'shots');
await p.fill('input[type=password]', process.env.SHOTS_PASSWORD || 'Shots2026!!');
await p.click('button:has-text("Войти")');
await p.waitForSelector('.nav a'); await settle();

// общий вид: меню и тендеры
// выигранный лот без договора — чтобы на снимке была кнопка «В договор»
const found = await api('GET', '/tenders/?search=17300512-1')
let t = (found.results || []).find(x => x.purchase_no === '17300512-1')
if (!t) {
  t = await api('POST', '/tenders/', { customer_name: 'АО «Шымкент Жылу»', item_name: 'Куртка рабочая утеплённая',
    qty: 150, price: 21000, plan_price: 19500, cost_per_unit: 12800, purchase_no: '17300512-1', delivery_days: '60 дней' })
  console.log('лот:', JSON.stringify(t).slice(0, 200))
}
for (const s of ['submitted', 'won']) {
  if (t.status !== 'won') t = await api('POST', `/tenders/${t.id}/set_status/`, { status: s })
}
// список тендеров загрузился при входе, до того как лот стал выигранным, — перечитываем страницу
await p.reload({ waitUntil: 'networkidle' }); await p.waitForSelector('.nav a');
await nav('Тендеры / План закупок');
await p.screenshot({ path: `${OUT}/01-obshiy-vid.png`, clip: { x: 0, y: 0, width: 1360, height: 620 } }); done.push('01-obshiy-vid')
// таблица лотов шире окна — на время снимка окно шире, чтобы кнопка «В договор» попала целиком
await p.setViewportSize({ width: 1900, height: 900 }); await p.waitForTimeout(400)
await part('tr:has-text("17300512-1")', '02-tender-v-dogovor')
await p.setViewportSize({ width: 1360, height: 900 }); await p.waitForTimeout(300)

await nav('Договоры'); await main('03-reestr', 760)
await p.click('button:has-text("Импорт «Расходы.xlsx»")'); await settle();
const card = '.card.stitch:has(h2:has-text("Загрузка «Расходы.xlsx»"))';
await p.setInputFiles(`${card} input[type=file]`, `${XL}/Расходы.xlsx`);
await p.waitForSelector(`${card} table`); await p.waitForTimeout(500);
await part(card, '04-import-rashodov', 900)
await p.click(`${card} button:has-text("Закрыть")`); await settle();

await p.click('tbody tr:has-text("Павлодар") >> nth=0'); await p.waitForSelector('.tabs button'); await settle();
await main('05-dogovor', 900)
await part('.card:has(h2:text-is("Куда ушли деньги"))', '06-kuda-ushli-dengi')
await p.click('.tabs button:has-text("Оплаты")'); await settle(); await part('.card:has(table.sheet)', '07-oplaty')
await p.click('.tabs button:has-text("Цех")'); await settle();
await p.click('button:has-text("Запустить в цех")'); await settle();
// сетка размеров: строки — размеры с 44 через один, колонки — роста со 158 через 6 см
await p.waitForSelector('.sizegrid table');
for (const [chest, height, qty] of [[48, 170, 12], [50, 176, 20], [52, 176, 35],
                                    [54, 176, 27], [54, 182, 35], [56, 182, 29]])
  await p.locator('.sizegrid tbody tr').nth((chest - 44) / 2)
    .locator('.cellin').nth((height - 158) / 6).fill(String(qty));
await settle();
await part('.card.stitch:has(h2:text-is("Запустить в цех"))', '08-zapusk-v-ceh')
await p.click('button:has-text("Отмена")'); await settle();
await part('.card:has(.toolbar b:text-is("Заказы цеха по договору"))', '09-ceh-po-dogovoru')

await nav('Цех'); await main('10-ceh-dogovory', 820)
// папка договора: изделия, листы этапов и исполнители только по нему
await p.click('.ordercard:has-text("Куртка АУП")'); await p.waitForSelector('nav.linktabs >> nth=1'); await settle();
await main('10-ceh-papka-dogovora', 760)
await p.click('.linktabs a:has-text("Крой")'); await p.waitForSelector('table.sheet'); await settle();
// форма кроя заполнена: заказ, размер со свободными штуками, штуки и метраж — видна подсказка «можно ещё»
const pick = async (nth, text) => {
  const sel = p.locator('.card.stitch select').nth(nth)
  const value = await sel.evaluate((s, text) => [...s.options].find(o => o.text.includes(text))?.value, text)
  await sel.selectOption(value); await p.waitForTimeout(250)
}
await pick(0, 'Куртка АУП'); await pick(1, '54/176'); await pick(2, 'Сауле')
await p.fill('.card.stitch input[placeholder*="Наср"]', 'Ербол')
await p.fill('.card.stitch input[type=number] >> nth=0', '10')
await p.fill('.card.stitch input[placeholder="метров"]', '24.3')
await p.click('.card.stitch button:has-text("+ материал")')
await p.fill('.card.stitch input[placeholder="материал"] >> nth=1', 'подклад')
await p.fill('.card.stitch input[placeholder="метров"] >> nth=1', '29.5'); await p.waitForTimeout(300)
await part('.card.stitch:has(h2:has-text("Записать"))', '11-list-kroy-forma')
await part('.card:has(.toolbar b:text-is("Записи по дням"))', '12-list-kroy', 820)
await p.click('.linktabs a:has-text("Чистка")'); await p.waitForSelector('table.sheet'); await settle();
await part('.card:has(.toolbar b:text-is("Что можно взять в работу"))', '13-mozhno-vzyat', 760)
await p.click('.linktabs a:has-text("Вышивка")'); await p.waitForSelector('table.sheet'); await settle();
await part('.card:has(.toolbar b:text-is("Записи по дням"))', '14-list-vyshivka', 600)
await p.click('.linktabs a:has-text("Тигин")'); await p.waitForSelector('table.sheet.grid'); await settle();
await part('.card:has(table.sheet.grid)', '15-list-tigin', 900)
await nav('Цех');
await p.click('.ordercard:has-text("Костюм МАЭК")'); await p.waitForSelector('nav.linktabs >> nth=1'); await settle();
await p.click('.card .ordercard >> nth=0'); await p.waitForSelector('table.sheet'); await settle();
await part('.card:has(h2:text-is("Размер × этап"))', '16-razmer-etap')
await p.click('table.sheet tbody tr.clickable >> nth=1'); await p.waitForSelector('.drill'); await p.waitForTimeout(300);
await part('.card:has(h2:text-is("Размер × этап"))', '17-proval-v-razmer', 900)
await p.click('.linktabs a:has-text("Настройка этапов")'); await settle(); await part('.card:has(table)', '18-nastroyka-etapov')
await p.click('.linktabs a:has-text("Исполнители")'); await settle(); await part('.card:has(table)', '19-ispolniteli')

await nav('Склад');
await p.click('.tabs button:has-text("Выдача в цех")'); await settle(); await part('.card.stitch', '20-vydacha-v-ceh')
await p.click('.tabs button:has-text("Готовая продукция")'); await settle(); await part('.card:has(.toolbar b:text-is("Готовая продукция"))', '21-gotovaya-produkciya')

await nav('Финансы'); await main('22-finansy-svodka', 900)
await part('.card:has(.toolbar b:text-is("По договорам"))', '23-finansy-po-dogovoram', 640)
await p.click('.tabs button:has-text("административные")'); await p.waitForSelector('table.matrix'); await settle();
await part('.card:has(table.matrix)', '24-adm-rashody')

await nav('Аналитика'); await main('25-analitika', 900)

await nav('Администрирование'); await p.click('.tabs button:has-text("Точечные права")'); await settle();
const opts = await p.locator('select >> nth=0').locator('option').allTextContents()
const tech = opts.findIndex(o => o.includes('Технолог'))
await p.selectOption('select >> nth=0', { index: tech > 0 ? tech : 1 }); await settle();
await part('.card:has(h2:text-is("Договоры"))', '26-prava-tehnologa')

console.log('снято:', done.length, done.join(' '))
console.log('ошибки:', errors.length ? errors : 'нет')
await b.close();
