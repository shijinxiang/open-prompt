const fs = require('fs/promises')
const fsSync = require('fs')
const path = require('path')
const crypto = require('crypto')

const MIME_EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

function collectImages(record) {
  const modelImages = models => Object.values(models || {}).flatMap(model => model.screenshots || [])
  return [...(record.attachments || []), ...modelImages(record.models), ...((record.revisions || []).flatMap(version => modelImages(version.modelResults))), ...(record.legacy ? collectImages(record.legacy) : [])]
}

function resolveAttachment(root, fileName) {
  if (typeof fileName !== 'string' || !fileName || !/^[a-zA-Z0-9._-]+$/.test(fileName) || fileName.includes('..')) throw new Error('无效的截图文件名。')
  const filePath = path.resolve(root, fileName)
  if (path.dirname(filePath) !== path.resolve(root)) throw new Error('截图文件路径无效。')
  return filePath
}

function createStorage(root) {
  const dataFile = path.join(root, 'records.json')
  const attachments = path.join(root, 'attachments')
  const settingsFile = path.join(root, 'settings.json')
  let queue = Promise.resolve()
  let settingsQueue = Promise.resolve()

  async function loadSettings() {
    try { return JSON.parse(await fs.readFile(settingsFile, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return {}; throw error }
  }

  function saveSettings(settings) {
    const serialized = JSON.stringify(settings, null, 2)
    const operation = settingsQueue.catch(() => {}).then(async () => {
      await fs.mkdir(root, { recursive: true })
      const temp = `${settingsFile}.${crypto.randomBytes(5).toString('hex')}.tmp`
      const file = await fs.open(temp, 'wx')
      try { await file.writeFile(serialized, 'utf8'); await file.sync() } finally { await file.close() }
      try { await fs.rename(temp, settingsFile) } catch (error) { await fs.unlink(temp).catch(() => {}); throw error }
      return { ok: true }
    })
    settingsQueue = operation
    return operation
  }

  async function ensure() {
    await fs.mkdir(attachments, { recursive: true })
    try { await fs.access(dataFile) } catch { await fs.writeFile(dataFile, JSON.stringify({ version: 4, records: [] }, null, 2), { encoding: 'utf8', flag: 'wx' }) }
  }

  async function load() {
    await ensure()
    return { ...JSON.parse(await fs.readFile(dataFile, 'utf8')), dataPath: root }
  }

  async function copyDirectoryContents(source, target) {
    let entries
    try { entries = await fs.readdir(source, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return 0; throw error }
    let copied = 0
    await fs.mkdir(target, { recursive: true })
    for (const entry of entries) {
      const sourcePath = path.join(source, entry.name)
      const targetPath = path.join(target, entry.name)
      if (entry.isDirectory()) copied += await copyDirectoryContents(sourcePath, targetPath)
      else if (entry.isFile()) {
        try { await fs.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL); copied += 1 } catch (error) { if (error.code !== 'EEXIST') throw error }
      }
    }
    return copied
  }

  async function migrateFrom(sourceRoot, validate = () => {}) {
    if (!sourceRoot || path.resolve(sourceRoot) === path.resolve(root)) return { migrated: false, copied: 0 }
    const sourceData = path.join(sourceRoot, 'records.json')
    try { await fs.access(dataFile); return { migrated: false, copied: 0 } } catch (error) { if (error.code !== 'ENOENT') throw error }
    let sourceContent
    try { sourceContent = await fs.readFile(sourceData, 'utf8') } catch (error) { if (error.code === 'ENOENT') return { migrated: false, copied: 0 }; throw error }
    validate(JSON.parse(sourceContent))
    await fs.mkdir(root, { recursive: true })
    const copied = await copyDirectoryContents(path.join(sourceRoot, 'attachments'), attachments)
    try { await fs.copyFile(`${sourceData}.bak`, `${dataFile}.bak`, fs.constants.COPYFILE_EXCL) } catch (error) { if (!['ENOENT', 'EEXIST'].includes(error.code)) throw error }
    const temp = `${dataFile}.${crypto.randomBytes(5).toString('hex')}.migration.tmp`
    try {
      await fs.writeFile(temp, sourceContent, { encoding: 'utf8', flag: 'wx' })
      await fs.copyFile(temp, dataFile, fs.constants.COPYFILE_EXCL)
    } finally { await fs.unlink(temp).catch(() => {}) }
    return { migrated: true, copied: copied + 1 }
  }

  function save(data) {
    const serialized = JSON.stringify({ version: data.version, records: data.records }, null, 2)
    const operation = queue.catch(() => {}).then(async () => {
      await ensure()
      const temp = `${dataFile}.${crypto.randomBytes(5).toString('hex')}.tmp`
      const file = await fs.open(temp, 'wx')
      try { await file.writeFile(serialized, 'utf8'); await file.sync() } finally { await file.close() }
      try {
        await fs.copyFile(dataFile, `${dataFile}.bak`).catch(() => {})
        await fs.rename(temp, dataFile)
      } catch (error) { await fs.unlink(temp).catch(() => {}); throw error }
      return { ok: true }
    })
    queue = operation
    return operation
  }

  async function saveAttachment({ dataUrl, originalName }) {
    const match = String(dataUrl).match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/)
    if (!match) throw new Error('只支持 PNG、JPG、WebP 或 GIF 图片。')
    const buffer = Buffer.from(match[2], 'base64')
    if (buffer.length > 20 * 1024 * 1024) throw new Error('单张图片不能超过 20 MB。')
    if (!buffer.length) throw new Error('截图为空。')
    const source = String(originalName || 'screenshot')
    const stem = path.basename(source, path.extname(source)).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'screenshot'
    const fileName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${stem}.${MIME_EXTENSIONS[match[1]]}`
    await fs.mkdir(attachments, { recursive: true })
    await fs.writeFile(resolveAttachment(attachments, fileName), buffer, { flag: 'wx' })
    return { fileName }
  }

  async function createBackup(data) {
    const backup = structuredClone(data)
    for (const record of backup.records) {
      for (const image of collectImages(record)) {
        if (!image.dataUrl) {
          const ext = path.extname(image.fileName || '').slice(1).toLowerCase()
          const mime = Object.keys(MIME_EXTENSIONS).find(type => MIME_EXTENSIONS[type] === ext)
          if (!mime) throw new Error(`截图格式无效：${image.name}`)
          try { image.dataUrl = `data:${mime};base64,${(await fs.readFile(resolveAttachment(attachments, image.fileName))).toString('base64')}` }
          catch { throw new Error(`截图文件缺失，备份已停止：${image.name}`) }
        }
        delete image.fileName
        delete image.url
      }
    }
    return { ...backup, exportedAt: new Date().toISOString() }
  }

  function prepareDragExport(payload, exportRoot) {
    const source = resolveAttachment(attachments, payload?.fileName)
    const extension = path.extname(source).slice(1).toLowerCase()
    if (!Object.values(MIME_EXTENSIONS).includes(extension)) throw new Error('图片格式无效。')
    const stat = fsSync.statSync(source)
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error('截图文件无效或超过 20 MB。')
    const original = path.basename(String(payload.name || 'screenshot'))
    let stem = path.basename(original, path.extname(original)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 90) || 'screenshot'
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `_${stem}`
    const directory = path.join(exportRoot, payload.fileName)
    const exported = path.join(directory, `${stem}.${extension}`)
    fsSync.mkdirSync(directory, { recursive: true })
    // Keep the native drag event synchronous and offer a copy to protect the stored file.
    fsSync.copyFileSync(source, exported)
    return exported
  }

  return { root, dataFile, attachments, settingsFile, ensure, load, save, saveAttachment, createBackup, migrateFrom, loadSettings, saveSettings, prepareDragExport }
}

module.exports = { createStorage, collectImages, resolveAttachment, MIME_EXTENSIONS }
