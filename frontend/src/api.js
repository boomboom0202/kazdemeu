import axios from 'axios'

// Бесплатный Render засыпает после 15 минут простоя, и первый запрос к
// просыпающемуся сервису часто отваливается по таймауту или 502/503.
// Раньше такие сбои приводили к пустой странице, поэтому здесь —
// ограниченное ожидание и автоповтор.
export const api = axios.create({ baseURL: '/api', timeout: 30000 })

const MAX_RETRIES = 3
const RETRY_STATUSES = [502, 503, 504]

// Сбой, который имеет смысл повторить: сеть недоступна, истёк таймаут
// или шлюз ещё не поднял приложение. Ошибки 4xx повторять бессмысленно.
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

    // Повтор с нарастающей паузой: 0.8с, 1.6с, 3.2с
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

// Права приходят из /me/ по всем ключам: и разделам («warehouse»), и их
// частям («warehouse.batches»). Точечное правило уже учтено на сервере —
// здесь только читаем итог.
export const can = (user, key) => !!user?.perms?.[key]?.read
export const canEdit = (user, key) => !!user?.perms?.[key]?.write

// Виден ли раздел вообще: сам раздел или хотя бы одна его часть.
// Нужно для меню и вкладок — человеку могли выдать одну вкладку склада,
// не открывая склад целиком.
export const canAny = (user, section) => {
  const perms = user?.perms
  if (!perms) return false
  if (perms[section]?.read) return true
  const prefix = section + '.'
  return Object.keys(perms).some(k => k.startsWith(prefix) && perms[k].read)
}

export const fmt = (n) => Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })
export const fmtD = (n) => Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })

export const CONTRACT_STATUS = {
  new: { label: 'Новый', color: '#8892a6' },
  negotiation: { label: 'Согласование', color: '#b8860b' },
  in_progress: { label: 'В работе', color: '#2456c8' },
  closed: { label: 'Закрыт', color: '#1d7a4f' },
  cancelled: { label: 'Отменён', color: '#b03030' },
}

// Имена полей, как их называет пользователь, а не как они зовутся в базе
const FIELD_NAMES = {
  number: 'Номер', name: 'Наименование', sku: 'Артикул', title: 'Название',
  amount: 'Сумма', qty: 'Количество', price: 'Цена', unit_price: 'Цена за единицу',
  customer: 'Заказчик', product: 'Изделие', material: 'Материал', supplier: 'Поставщик',
  deadline: 'Срок', signed_date: 'Дата подписания', due_date: 'Срок платежа',
  date: 'Дата', category: 'Категория', monthly_amount: 'Сумма в месяц',
  base_price: 'Цена продажи', labor_cost: 'Оплата труда', norm_hours: 'Норма времени',
  min_stock: 'Минимальный остаток', code: 'Код', position: 'Порядок',
  username: 'Логин', password: 'Пароль', role: 'Роль', template: 'Этап',
}

/**
 * Человеческий текст ошибки вместо сырого JSON.
 * DRF отдаёт либо {"detail": "..."} , либо словарь по полям
 * {"sku": ["Уже существует."]} — второе показывать как есть нельзя.
 */
export function apiError(e, fallback = 'Не удалось выполнить действие') {
  if (e?.code === 'ECONNABORTED') return 'Сервер долго не отвечает. Попробуйте ещё раз.'
  const d = e?.response?.data
  if (!d) return e?.message === 'Network Error'
    ? 'Нет связи с сервером. Проверьте подключение и повторите.'
    : fallback
  if (typeof d === 'string') return d
  if (d.detail) return d.detail
  const lines = []
  for (const [field, val] of Object.entries(d)) {
    const text = Array.isArray(val) ? val.join(' ') : String(val)
    lines.push(field === 'non_field_errors' ? text : `${FIELD_NAMES[field] || field}: ${text}`)
  }
  return lines.length ? lines.join('\n') : fallback
}
