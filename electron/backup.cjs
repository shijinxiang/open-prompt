const fs = require('fs/promises')
const { createReadStream, createWriteStream } = require('fs')
const path = require('path')
const crypto = require('crypto')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')
const { collectImages, resolveAttachment, MIME_EXTENSIONS } = require('./storage.cjs')

async function atomicWrite(destination, chunks) {
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${crypto.randomBytes(6).toString('hex')}.tmp`)
  try {
    await pipeline(Readable.from(chunks), createWriteStream(temporary, { flags: 'wx' }))
    const handle = await fs.open(temporary, 'r+')
    try { await handle.sync() } finally { await handle.close() }
    await fs.rename(temporary, destination)
    return { filePath: destination, bytes: (await fs.stat(destination)).size }
  } catch (error) { await fs.unlink(temporary).catch(() => {}); throw error }
}

// Never concatenate the entire image library into a single V8 string.
async function writeBackupFile(storage, data, destination, onProgress) {
  async function* json(value, images) {
    if (images.has(value)) {
      const image = { ...value }
      if (!image.dataUrl) {
        const extension = path.extname(image.fileName || '').slice(1).toLowerCase()
        const mime = Object.keys(MIME_EXTENSIONS).find(type => MIME_EXTENSIONS[type] === extension)
        if (!mime) throw new Error(`截图格式无效：${image.name}`)
        let bytes
        try { bytes = await fs.readFile(resolveAttachment(storage.attachments, image.fileName)) }
        catch { throw new Error(`截图文件缺失，备份已停止：${image.name}`) }
        image.dataUrl = `data:${mime};base64,${bytes.toString('base64')}`
      }
      delete image.fileName; delete image.url
      yield JSON.stringify(image)
    } else if (Array.isArray(value)) {
      yield '['
      for (let index = 0; index < value.length; index++) { if (index) yield ','; yield* json(value[index] ?? null, images) }
      yield ']'
    } else if (value && typeof value === 'object') {
      yield '{'; let first = true
      for (const [key, item] of Object.entries(value)) {
        if (item === undefined) continue
        if (!first) yield ','; first = false
        yield JSON.stringify(key) + ':'; yield* json(item, images)
      }
      yield '}'
    } else yield JSON.stringify(value)
  }
  async function* contents() {
    yield `{"version":${data.version},"exportedAt":${JSON.stringify(new Date().toISOString())},"records":[\n`
    for (let index = 0; index < data.records.length; index++) {
      if (index) yield ',\n'
      const record = data.records[index]
      yield* json(record, new Set(collectImages(record)))
      onProgress?.({ completed: index + 1, total: data.records.length })
    }
    yield '\n]}\n'
  }
  return atomicWrite(destination, contents())
}

// Parse the JSON envelope and one record at a time. UTF-8 and escape sequences
// may cross arbitrary stream boundaries; JSON.parse validates each whole value.
async function readBackupFile(filePath, onRecord, options = {}) {
  const stream = createReadStream(filePath, { encoding: 'utf8', highWaterMark: options.chunkSize || 64 * 1024 })
  const iterator = stream[Symbol.asyncIterator](); let buffer = '', position = 0, ended = false
  const invalid = () => new Error('备份 JSON 格式无效或文件不完整。')
  async function more() { if (ended) return false; const next = await iterator.next(); if (next.done) { ended = true; buffer = ''; position = 0; return false } buffer = next.value; position = 0; return true }
  async function peek() { while (position >= buffer.length) if (!await more()) return ''; return buffer[position] }
  async function space() { let char; while ((char = await peek()) && /\s/.test(char)) position++; return char }
  async function expect(char) { if (await space() !== char) throw invalid(); position++ }
  async function rawValue() {
    const first = await space(); if (!first) throw invalid()
    const container = first === '{' || first === '[', quoted = first === '"'
    const pieces = []; let depth = 0, inString = false, escaped = false, started = false
    while (true) {
      if (position >= buffer.length && !await more()) { if (container || quoted) throw invalid(); break }
      const start = position
      while (position < buffer.length) {
        const char = buffer[position]
        if (!container && !quoted && /[\s,}\]]/.test(char)) { pieces.push(buffer.slice(start, position)); return pieces.join('') }
        position++
        if (inString) {
          if (escaped) escaped = false
          else if (char === '\\') escaped = true
          else if (char === '"') { inString = false; if (quoted && !container) { pieces.push(buffer.slice(start, position)); return pieces.join('') } }
        } else if (char === '"') inString = true
        else if (char === '{' || char === '[') depth++
        else if (char === '}' || char === ']') { depth--; if (container && depth === 0) { pieces.push(buffer.slice(start, position)); return pieces.join('') } }
        started = true
      }
      pieces.push(buffer.slice(start, position))
    }
    if (!started) throw invalid()
    return pieces.join('')
  }
  try {
    if (await peek() === '\uFEFF') position++
    await expect('{'); const data = {}, keys = new Set()
    if (await space() !== '}') while (true) {
      if (await space() !== '"') throw invalid()
      const key = JSON.parse(await rawValue())
      if (keys.has(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) throw invalid()
      keys.add(key); await expect(':')
      if (key === 'records') {
        await expect('['); data.records = []
        if (await space() !== ']') while (true) {
          const record = JSON.parse(await rawValue())
          if (data.records.length >= 10000) throw new Error('单次最多导入 10000 条记录。')
          data.records.push(onRecord ? await onRecord(record, data.records.length, data) : record)
          if (await space() === ']') break
          await expect(','); if (await space() === ']') throw invalid()
        }
        await expect(']')
      } else data[key] = JSON.parse(await rawValue())
      if (await space() === '}') break
      await expect(','); if (await space() === '}') throw invalid()
    }
    await expect('}'); if (await space()) throw invalid()
    return data
  } finally { stream.destroy() }
}
const writeTextFile = (destination, text) => atomicWrite(destination, ['\uFEFF', text])
module.exports = { writeBackupFile, readBackupFile, writeTextFile }
