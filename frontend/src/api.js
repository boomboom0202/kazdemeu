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

// Права по разделам приходят из /me/ — прячем меню, колонки и кнопки
export const can = (user, section) => !!user?.perms?.[section]?.read
export const canEdit = (user, section) => !!user?.perms?.[section]?.write

export const fmt = (n) => Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })
export const fmtD = (n) => Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })

export const CONTRACT_STATUS = {
  new: { label: 'Новый', color: '#8892a6' },
  negotiation: { label: 'Согласование', color: '#b8860b' },
  in_progress: { label: 'В работе', color: '#2456c8' },
  closed: { label: 'Закрыт', color: '#1d7a4f' },
  cancelled: { label: 'Отменён', color: '#b03030' },
}
