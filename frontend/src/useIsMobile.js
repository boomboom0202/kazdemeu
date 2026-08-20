import { useEffect, useState } from 'react'

/**
 * Recharts задаёт размеры числами, а не CSS, поэтому пару мест
 * (ширину подписей оси и долю круговой диаграммы) приходится
 * переключать из JS. Для всего остального хватает media queries.
 */
export function useIsMobile(breakpoint = 600) {
  const query = `(max-width: ${breakpoint}px)`
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  )

  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = e => setIsMobile(e.matches)
    setIsMobile(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])

  return isMobile
}
