import { useEffect, useRef, useState } from 'react'

const key = 'oqs-workspace-layout'
const initial = () => {
  let value; try { value = JSON.parse(localStorage.getItem(key) || '{}') } catch {}
  return { sidebarCollapsed: value?.sidebarCollapsed === true, recordsHidden: value?.recordsHidden === true, recordWidth: Number.isFinite(value?.recordWidth) ? Math.min(480, Math.max(220, value.recordWidth)) : 300 }
}
export default function useWorkspaceLayout() {
  const [prefs, setPrefs] = useState(initial), [compact, setCompact] = useState(() => window.innerWidth <= 1000)
  const [sidebarDrawer, setSidebarDrawer] = useState(false), [recordsDrawer, setRecordsDrawer] = useState(false)
  const drag = useRef(null)
  const closeDrawers = () => { setSidebarDrawer(false); setRecordsDrawer(false) }
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(prefs)) } catch {} }, [prefs])
  useEffect(() => {
    const media = matchMedia('(max-width: 1000px)'), changed = () => { setCompact(media.matches); closeDrawers() }
    media.addEventListener('change', changed)
    const escape = event => { if (event.key === 'Escape') closeDrawers() }
    window.addEventListener('keydown', escape)
    return () => { media.removeEventListener('change', changed); window.removeEventListener('keydown', escape) }
  }, [])
  const sidebarVisible = compact ? sidebarDrawer : !prefs.sidebarCollapsed
  const recordsVisible = compact ? recordsDrawer : !prefs.recordsHidden
  const resize = (width, element) => {
    const limit = Math.min(480, element.parentElement.clientWidth * .45)
    setPrefs(current => ({ ...current, recordWidth: Math.max(220, Math.min(limit, width)) }))
  }
  return {
    compact, sidebarVisible, recordsVisible, closeDrawers,
    className: `app-shell${prefs.sidebarCollapsed ? ' sidebar-collapsed' : ''}${prefs.recordsHidden ? ' records-hidden' : ''}${compact ? ' compact-layout' : ''}${sidebarDrawer ? ' sidebar-drawer-open' : ''}${recordsDrawer ? ' records-drawer-open' : ''}`,
    style: { '--record-panel-width': `${prefs.recordWidth}px` },
    toggleSidebar: () => compact ? setSidebarDrawer(value => !value) : setPrefs(current => ({ ...current, sidebarCollapsed: !current.sidebarCollapsed })),
    toggleRecords: () => compact ? setRecordsDrawer(value => !value) : setPrefs(current => ({ ...current, recordsHidden: !current.recordsHidden })),
    chooseFilter: () => { setSidebarDrawer(false); if (compact) setRecordsDrawer(true) },
    splitter: {
      onPointerDown: event => { if (event.button !== 0) return; event.preventDefault(); drag.current = { pointerId: event.pointerId, x: event.clientX, width: prefs.recordWidth }; event.currentTarget.setPointerCapture(event.pointerId) },
      onPointerMove: event => { if (drag.current?.pointerId === event.pointerId) resize(drag.current.width + event.clientX - drag.current.x, event.currentTarget) },
      onPointerUp: event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) },
      onPointerCancel: () => { drag.current = null }, onLostPointerCapture: () => { drag.current = null },
      onKeyDown: event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); resize(event.key === 'Home' ? 220 : event.key === 'End' ? 480 : prefs.recordWidth + (event.key === 'ArrowLeft' ? -16 : 16), event.currentTarget) } },
      'aria-valuenow': Math.round(prefs.recordWidth),
    },
  }
}
