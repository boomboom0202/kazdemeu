import axios from 'axios'

// Ограниченное ожидание и автоповтор: первый запрос к только что
// перезапущенному серверу иногда отваливается по таймауту или 502/503.
export const api = axios.create({ baseURL: '/api', timeout: 30000 })

const MAX_RETRIES = 3
const RETRY_STATUSES = [502, 503, 504]

const isTransient = (error) => {
  if (error.code === 'ECONNABORTED' || error.code === 'ERR_NETWORK') return true
  if (!error.response) return true
  return RETRY_STATUSES.includes(error.response.status)
}

api.interceptors.request.use((config) => {
  const t = localStorage.getItem('access')
  if (t) config.headers.Authorization = `Bearer ${t}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config
    if (original && isTransient(error)) {
      original._retryCount = (original._retryCount || 0) + 1
      if (original._retryCount <= MAX_RETRIES) {
        const pause = 800 * Math.pow(2, original._retryCount - 1)
        await new Promise((r) => setTimeout(r, pause))
        return api(original)
      }
    }
    if (error.response?.status === 401 && !original._retry && localStorage.getItem('refresh')) {
      original._retry = true
      try {
        const { data } = await axios.post('/api/auth/refresh/',
          { refresh: localStorage.getItem('refresh') }, { timeout: 30000 })
        localStorage.setItem('access', data.access)
        original.headers.Authorization = `Bearer ${data.access}`
        return api(original)
      } catch {
        localStorage.clear()
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

// Права приходят из /me/ по всем ключам: разделам («warehouse») и их частям
// («warehouse.receipts»). Точечные правила уже учтены на сервере.
export const can = (user, key) => !!user?.perms?.[key]?.read
export const canEdit = (user, key) => !!user?.perms?.[key]?.write

// Виден ли раздел: сам раздел или хотя бы одна его часть
export const canAny = (user, section) => {
  const perms = user?.perms
  if (!perms) return false
  if (perms[section]?.read) return true
  const prefix = section + '.'
  return Object.keys(perms).some(k => k.startsWith(prefix) && perms[k].read)
}

export const fmt = (n) => Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })
export const fmtD = (n) => Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
// Деньги, которых человеку не показывают, приходят как null
export const money = (n) => (n === null || n === undefined ? '—' : fmt(n))

// Дата в поле ввода — по местному времени: toISOString даёт UTC,
// и в Алматы после полуночи до пяти утра подставлялось бы вчера.
export const today = () => {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}
export const dm = (s) => (s ? `${String(s).slice(8, 10)}.${String(s).slice(5, 7)}` : '')
export const dmy = (s) => (s ? `${String(s).slice(8, 10)}.${String(s).slice(5, 7)}.${String(s).slice(0, 4)}` : '')

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
export const monthLabel = (m) => (!m || m === 'none' ? 'без даты' : `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`)

export const CONTRACT_STATUS = {
  new: { label: 'Новый', color: '#8892a6' },
  negotiation: { label: 'Согласование', color: '#b8860b' },
  in_progress: { label: 'В работе', color: '#2456c8' },
  closed: { label: 'Закрыт', color: '#1d7a4f' },
  cancelled: { label: 'Отменён', color: '#b03030' },
}

export const EXPENSE_KINDS = [
  ['delivery', 'Доставка'], ['travel', 'Командировки'], ['samples', 'Образцы и лекала'],
  ['fabric', 'Ткань и материалы'], ['accessories', 'Фурнитура и шевроны'],
  ['sewing', 'Пошив, крой, вышивка'], ['packaging', 'Упаковка'], ['purchase', 'Закуп товара'],
  ['percent', 'Проценты и сертификаты'], ['legal', 'Пени, суды, документы'], ['other', 'Прочее'],
]

export const STAGE_KINDS = {
  cut: 'Крой — штуки и расход ткани',
  count: 'Штуки по размерам',
  sewing: 'Пошив — партии бригад, готовность по дням',
}

// Имена полей, как их называет пользователь, а не как они зовутся в базе
const FIELD_NAMES = {
  number: 'Номер', name: 'Наименование', sku: 'Артикул', title: 'Предмет закупки',
  amount: 'Сумма', qty: 'Количество', price: 'Цена', unit_price: 'Цена за единицу',
  customer: 'Заказчик', product: 'Изделие', material: 'Материал', supplier: 'Поставщик',
  deadline: 'Срок', signed_date: 'Дата подписания', date: 'Дата', category: 'Статья',
  min_stock: 'Минимальный остаток', position: 'Порядок', username: 'Логин', password: 'Пароль',
  role: 'Роль', batch_no: 'Номер партии', received_at: 'Дата приёмки', status: 'Статус',
  unit: 'Единица измерения', bin_iin: 'БИН/ИИН', phone: 'Телефон', contract: 'Договор',
  note: 'Примечание', first_name: 'Имя', is_active: 'Активен', client: 'Для кого',
  sizes_text: 'Размеры', sewing_rate: 'Расценка', brigade: 'Бригада', ready: 'Готовность',
  meters: 'Метраж', leader: 'Бригадир', people: 'Людей в бригаде', size: 'Размер', planned: 'План',
  kind: 'Вид', started: 'Дата выдачи', purchase_no: 'Номер закупки', own_company: 'Фирма',
  platform: 'Площадка', contract_no: 'Номер договора', investor: 'Инвестор',
  delivery_place: 'Место поставки', delivery_terms: 'Срок поставки',
  planned_execution: 'Планируемый срок', comment: 'Комментарий', month: 'Месяц',
  stage: 'Этап', template_ids: 'Этапы', extra: 'Доп. колонка', extra_label: 'Доп. колонка',
  materials: 'Расход ткани', monthly_plan: 'План в месяц', work_order: 'Заказ цеха',
  reason: 'Операция', customer_name: 'Заказчик', item_name: 'Товар',
}

/**
 * Человеческий текст ошибки вместо сырого JSON.
 * DRF отдаёт либо {"detail": "..."}, либо словарь по полям.
 */
export function apiError(e, fallback = 'Не удалось выполнить действие') {
  if (e?.code === 'ECONNABORTED') return 'Сервер долго не отвечает. Попробуйте ещё раз.'
  const d = e?.response?.data
  if (!d) return e?.message === 'Network Error'
    ? 'Нет связи с сервером. Проверьте подключение и повторите.'
    : fallback
  if (typeof d === 'string') return d.length > 300 ? fallback : d
  if (d.detail) return d.detail
  const lines = []
  for (const [field, val] of Object.entries(d)) {
    const text = Array.isArray(val) ? val.map(v => (typeof v === 'object' ? JSON.stringify(v) : v)).join(' ') : String(val)
    lines.push(field === 'non_field_errors' ? text : `${FIELD_NAMES[field] || field}: ${text}`)
  }
  return lines.length ? lines.join('\n') : fallback
}

// Скачать файл, который сервер отдаёт по API (выгрузки в Excel)
export async function download(url, filename) {
  const r = await api.get(url, { responseType: 'blob' })
  const href = URL.createObjectURL(r.data)
  const a = document.createElement('a')
  a.href = href; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

/**
 * Справочник «выбрать или вписать»: площадка, своя фирма. Название ищется
 * в списке без учёта регистра; нет такого — заводится и добавляется в список.
 * Возвращает id или null, если поле пустое.
 */
export async function pickOrCreate(name, list, url, setList) {
  const n = (name || '').trim()
  if (!n) return null
  const found = list.find(x => x.name.toLowerCase() === n.toLowerCase())
  if (found) return found.id
  const { data } = await api.post(url, { name: n })
  setList(l => [...l, data])
  return data.id
}
