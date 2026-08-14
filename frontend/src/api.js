import axios from 'axios'

export const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((config) => {
  const t = localStorage.getItem('access')
  if (t) config.headers.Authorization = `Bearer ${t}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config
    if (error.response?.status === 401 && !original._retry && localStorage.getItem('refresh')) {
      original._retry = true
      try {
        const { data } = await axios.post('/api/auth/refresh/', { refresh: localStorage.getItem('refresh') })
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
