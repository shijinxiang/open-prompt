const DB_NAME = 'open-question-studio-preview'

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('workspace')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function loadData() {
  if (window.desktopApi) return window.desktopApi.loadData()
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workspace', 'readonly')
    const req = tx.objectStore('workspace').get('data')
    req.onsuccess = () => resolve(req.result || { version: 4, records: [] })
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}

export async function saveData(data) {
  if (window.desktopApi) {
    const result = await window.desktopApi.saveData(data)
    if (result?.ok === false) { const error = new Error(result.message); error.code = result.code; error.latestData = result.data; throw error }
    return result
  }
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workspace', 'readwrite')
    tx.objectStore('workspace').put(data, 'data')
    tx.oncomplete = () => { db.close(); resolve({ ok: true }) }
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadSettings() {
  if (window.desktopApi) return window.desktopApi.loadSettings()
  return JSON.parse(localStorage.getItem('open-question-studio-settings') || '{}')
}

export async function saveSettings(settings) {
  if (window.desktopApi) return window.desktopApi.saveSettings(settings)
  localStorage.setItem('open-question-studio-settings', JSON.stringify(settings))
  return { ok: true }
}

export async function storeImage(file) {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('请选择 PNG、JPG、WebP 或 GIF 图片。')
  if (file.size > 20 * 1024 * 1024) throw new Error('单张图片不能超过 20 MB。')
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
  const base = { id: crypto.randomUUID(), name: file.name || `截图-${Date.now()}.png`, size: file.size, createdAt: new Date().toISOString() }
  if (window.desktopApi) return { ...base, ...await window.desktopApi.saveAttachment({ dataUrl, originalName: base.name }) }
  return { ...base, dataUrl }
}

export const imageSource = (image) => image.dataUrl || (window.desktopApi ? `attachment://local/${encodeURIComponent(image.fileName)}` : '')

function pngBlob(source) {
  return new Promise((resolve, reject) => {
    const original = new Image()
    original.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = original.naturalWidth
      canvas.height = original.naturalHeight
      try {
        canvas.getContext('2d').drawImage(original, 0, 0)
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法复制图片。')), 'image/png')
      } catch (error) { reject(error) }
    }
    original.onerror = () => reject(new Error('无法读取图片，请确认截图文件完整。'))
    original.src = source
  })
}

export async function copyImage(image) {
  if (window.desktopApi) {
    const result = await window.desktopApi.copyImage({ fileName: image.fileName, dataUrl: image.dataUrl })
    if (!result.requiresConversion) return result
    const png = await pngBlob(result.dataUrl)
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(png)
    })
    return window.desktopApi.copyImage({ dataUrl })
  }
  if (!navigator.clipboard?.write || !window.ClipboardItem) throw new Error('当前浏览器不支持复制图片，请使用桌面程序。')
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob(imageSource(image)) })])
}

export function downloadText(text, fileName, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
