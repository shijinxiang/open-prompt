import { useEffect, useMemo, useRef } from 'react'
import { Check } from 'lucide-react'
import { displayTitle, recordCompletion } from './domain.js'

export default function BackupRecordPicker({ records, selectedIds, onChange, disabled }) {
  const root = useRef(null)
  const drag = useRef(null)
  const frame = useRef(null)
  const pointerClick = useRef(false)
  const completions = useMemo(() => new Map(records.map(record => [record.id, recordCompletion(record)])), [records])
  const selected = new Set(selectedIds)
  const groups = [
    { id: 'active', label: '未归档', records: records.filter(record => !record.archived) },
    { id: 'archived', label: '已归档', records: records.filter(record => record.archived) },
  ]

  const stop = () => {
    const pointerId = drag.current?.pointerId
    drag.current = null
    cancelAnimationFrame(frame.current)
    frame.current = null
    if (pointerId !== undefined && root.current?.hasPointerCapture(pointerId)) root.current.releasePointerCapture(pointerId)
  }
  useEffect(() => {
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    window.addEventListener('blur', stop)
    return () => {
      stop()
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      window.removeEventListener('blur', stop)
    }
  }, [])
  useEffect(() => { if (disabled) stop() }, [disabled])

  const paint = row => {
    const state = drag.current
    if (!state || !row || !root.current?.contains(row)) return
    const id = row.dataset.exportRecordId
    const group = row.dataset.exportGroup
    const ids = groups.find(value => value.id === group).records.map(record => record.id)
    const currentIndex = ids.indexOf(id)
    const previousIndex = state.group === group ? ids.indexOf(state.lastId) : currentIndex
    let changed = false
    for (const recordId of ids.slice(Math.min(previousIndex, currentIndex), Math.max(previousIndex, currentIndex) + 1)) {
      if (state.chosen.has(recordId) === state.selecting) continue
      if (state.selecting) state.chosen.add(recordId)
      else state.chosen.delete(recordId)
      changed = true
    }
    state.group = group
    state.lastId = id
    if (changed) onChange([...state.chosen])
  }
  const at = (x, y) => paint(document.elementFromPoint(x, y)?.closest('[data-export-record-id]'))
  const tick = () => {
    const state = drag.current
    if (!state || !root.current) return
    for (const panel of root.current.querySelectorAll('.backup-record-list')) {
      const rect = panel.getBoundingClientRect()
      if (state.x < rect.left || state.x > rect.right) continue
      const distance = state.y < rect.top + 28 ? state.y - rect.top - 28 : state.y > rect.bottom - 28 ? state.y - rect.bottom + 28 : 0
      if (distance) {
        panel.scrollTop += Math.sign(distance) * Math.min(18, Math.max(4, Math.abs(distance) / 3))
        at(state.x, Math.max(rect.top + 2, Math.min(rect.bottom - 2, state.y)))
      }
    }
    frame.current = requestAnimationFrame(tick)
  }
  const start = event => {
    pointerClick.current = false
    if (disabled || event.button !== 0 || event.pointerType === 'touch') return
    const row = event.target.closest('[data-export-record-id]')
    if (!row) return
    event.preventDefault()
    row.focus({ preventScroll: true })
    pointerClick.current = true
    drag.current = { pointerId: event.pointerId, selecting: !selected.has(row.dataset.exportRecordId), chosen: new Set(selectedIds), x: event.clientX, y: event.clientY }
    root.current.setPointerCapture(event.pointerId)
    paint(row)
    frame.current = requestAnimationFrame(tick)
  }
  const click = (event, id) => {
    if (disabled || (event.detail !== 0 && pointerClick.current)) return
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange([...next])
  }
  const selectGroup = groupRecords => onChange([...new Set([...selectedIds, ...groupRecords.map(record => record.id)])])

  return <div className="backup-picker" ref={root} onPointerDown={start} onPointerMove={event => {
    if (!drag.current) return
    if (!(event.buttons & 1)) { stop(); return }
    drag.current.x = event.clientX
    drag.current.y = event.clientY
    at(event.clientX, event.clientY)
  }} onLostPointerCapture={stop}>
    <div className="backup-picker-tools"><span>按住记录上下拖动可多选，再次拖过已选记录可取消。</span><button type="button" className="text-button" disabled={disabled || !records.length} onClick={() => onChange(records.map(record => record.id))}>全选</button><button type="button" className="text-button" disabled={disabled || !selectedIds.length} onClick={() => onChange([])}>清空选择</button></div>
    <div className="backup-picker-groups">{groups.map(group => <section className="backup-record-group" key={group.id} aria-label={`${group.label}记录`}>
      <div className="backup-group-heading"><h3>{group.label}<small>{group.records.filter(record => selected.has(record.id)).length} / {group.records.length}</small></h3><button type="button" className="text-button" disabled={disabled || !group.records.length} onClick={() => selectGroup(group.records)}>全选本组</button></div>
      <div className="backup-record-list" data-export-list={group.id}>{group.records.map(record => {
        const completion = completions.get(record.id)
        return <button type="button" role="checkbox" aria-checked={selected.has(record.id)} aria-label={displayTitle(record)} aria-describedby={`backup-completion-${record.id}`} title={displayTitle(record)} disabled={disabled} key={record.id} data-export-record-id={record.id} data-export-group={group.id} className={`backup-record-row ${selected.has(record.id) ? 'selected' : ''}`} onClick={event => click(event, record.id)}>
        <span className="backup-record-check" aria-hidden="true">{selected.has(record.id) && <Check size={13} />}</span><span className="backup-record-info"><span className="backup-record-title">{displayTitle(record)}</span><small>{record.type || '未分类'}{record.field ? ` · ${record.field}` : ''}</small></span>
        <span id={`backup-completion-${record.id}`} className={`backup-record-completion ${completion.missing.length ? '' : 'complete'}`} title={`已完成 ${completion.completed} / ${completion.total} 项${completion.missing.length ? `；缺失：${completion.missing.map(field => field.label).join('；')}` : '；资料完整'}`}><span>完成度 {completion.percent}%</span><span className="backup-completion-track" aria-hidden="true"><span style={{ width: `${completion.percent}%` }} /></span><small>{completion.missing.length ? `缺失 ${completion.missing.length} 项` : '资料完整'}</small></span>
      </button>})}{!group.records.length && <p className="backup-picker-empty">暂无{group.label}记录</p>}</div>
    </section>)}</div>
  </div>
}
