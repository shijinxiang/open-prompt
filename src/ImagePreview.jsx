import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react'
import { imageSource } from './storage.js'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export default function ImagePreview({ images, index, onIndex, onClose }) {
  const image = images[index]
  const stage = useRef(null), close = useRef(null), drag = useRef(null), fitScale = useRef(1)
  const [natural, setNatural] = useState({ width: 0, height: 0 })
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [failed, setFailed] = useState(false)
  const bounds = (next, rect = stage.current.getBoundingClientRect()) => ({
    scale: next.scale,
    x: clamp(next.x, -Math.max(0, (natural.width * next.scale - rect.width) / 2), Math.max(0, (natural.width * next.scale - rect.width) / 2)),
    y: clamp(next.y, -Math.max(0, (natural.height * next.scale - rect.height) / 2), Math.max(0, (natural.height * next.scale - rect.height) / 2)),
  })
  const zoom = (scale, point) => {
    if (!natural.width) return
    const rect = stage.current.getBoundingClientRect()
    setView(current => {
      const next = clamp(typeof scale === 'function' ? scale(current.scale) : scale, Math.min(.1, fitScale.current), 8)
      const x = point ? point.x - rect.left - rect.width / 2 : 0
      const y = point ? point.y - rect.top - rect.height / 2 : 0
      return bounds({ scale: next, x: x - (x - current.x) * next / current.scale, y: y - (y - current.y) * next / current.scale }, rect)
    })
  }
  const fit = () => setView({ scale: fitScale.current, x: 0, y: 0 })
  useLayoutEffect(() => {
    if (!natural.width) return
    const resize = () => {
      const rect = stage.current.getBoundingClientRect(), previous = fitScale.current
      fitScale.current = Math.max(.001, Math.min(1, (rect.width - 32) / natural.width, (rect.height - 32) / natural.height))
      setView(current => Math.abs(current.scale - previous) < .001 ? { scale: fitScale.current, x: 0, y: 0 } : bounds(current, rect))
    }
    resize()
    const observer = new ResizeObserver(resize); observer.observe(stage.current)
    return () => observer.disconnect()
  }, [natural.width, natural.height])
  useEffect(() => {
    const target = stage.current
    const wheel = event => {
      event.preventDefault()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? target.clientHeight : 1)
      zoom(value => value * Math.exp(-clamp(delta, -800, 800) * .002), { x: event.clientX, y: event.clientY })
    }
    target.addEventListener('wheel', wheel, { passive: false })
    return () => target.removeEventListener('wheel', wheel)
  }, [natural.width, natural.height])
  useEffect(() => {
    const previousFocus = document.activeElement, overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'; close.current.focus()
    return () => { document.body.style.overflow = overflow; if (previousFocus?.isConnected) previousFocus.focus() }
  }, [])
  useEffect(() => {
    const key = event => {
      const action = { Escape: onClose, ArrowLeft: () => index > 0 && onIndex(index - 1), ArrowRight: () => index < images.length - 1 && onIndex(index + 1), '+': () => zoom(value => value * 1.25), '=': () => zoom(value => value * 1.25), '-': () => zoom(value => value / 1.25), '0': fit, '1': () => zoom(1) }[event.key]
      if (action) { event.preventDefault(); event.stopPropagation(); action() }
      if (event.key === 'Tab') {
        const buttons = [...event.currentTarget.document.querySelectorAll('.lightbox button:not(:disabled)')]
        const first = buttons[0], last = buttons.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [index, images.length, natural.width, natural.height])
  const stopDrag = event => {
    drag.current = null; setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const canPan = natural.width * view.scale > (stage.current?.clientWidth || Infinity) || natural.height * view.scale > (stage.current?.clientHeight || Infinity)
  return <div className="lightbox" role="dialog" aria-modal="true" aria-label="图片预览">
    <div className="lightbox-toolbar"><span>{image.name} · {index + 1} / {images.length}</span><button ref={close} className="icon-button" title="关闭图片" aria-label="关闭图片" onClick={onClose}><X size={20} /></button></div>
    <div className="lightbox-content">
      <button className="icon-button" title="上一张" aria-label="上一张" disabled={index === 0} onClick={() => onIndex(index - 1)}><ChevronLeft /></button>
      <div ref={stage} className={`lightbox-stage ${canPan ? 'can-pan' : ''} ${dragging ? 'dragging' : ''}`} aria-label="滚轮缩放、拖动查看图片"
        onPointerDown={event => { if (event.button !== 0 || !canPan) return; event.preventDefault(); drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, view }; setDragging(true); event.currentTarget.setPointerCapture(event.pointerId) }}
        onPointerMove={event => { const current = drag.current; if (current?.pointerId === event.pointerId) setView(bounds({ ...current.view, x: current.view.x + event.clientX - current.x, y: current.view.y + event.clientY - current.y })) }}
        onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={() => { drag.current = null; setDragging(false) }}
        onDoubleClick={event => zoom(Math.abs(view.scale - fitScale.current) < .001 ? (fitScale.current < .99 ? 1 : 2) : fitScale.current, { x: event.clientX, y: event.clientY })}>
        <img alt={image.name} draggable={false} src={imageSource(image)} onLoad={event => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setFailed(true)}
          style={{ width: natural.width * view.scale, height: natural.height * view.scale, visibility: natural.width ? 'visible' : 'hidden', transform: `translate(-50%,-50%) translate(${view.x}px,${view.y}px)` }} />
        {failed && <p className="lightbox-error">图片无法读取，请检查截图文件是否存在。</p>}
      </div>
      <button className="icon-button" title="下一张" aria-label="下一张" disabled={index === images.length - 1} onClick={() => onIndex(index + 1)}><ChevronRight /></button>
    </div>
    <div className="lightbox-controls"><button disabled={!natural.width} onClick={() => zoom(value => value / 1.25)} title="缩小图片" aria-label="缩小图片"><ZoomOut size={17} /></button><output aria-label="图片缩放比例">{Math.max(1, Math.round(view.scale * 100))}%</output><button disabled={!natural.width} onClick={() => zoom(value => value * 1.25)} title="放大图片" aria-label="放大图片"><ZoomIn size={17} /></button><button disabled={!natural.width} onClick={fit}><Maximize2 size={16} />适应窗口</button><button disabled={!natural.width} onClick={() => zoom(1)}>1:1 原图</button><span>滚轮缩放 · 放大后拖动查看 · Esc 关闭</span></div>
  </div>
}
