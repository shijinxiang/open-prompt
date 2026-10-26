const fs = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const { collectImages } = require('./storage.cjs')

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const revision = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
class Conflict extends Error {
  constructor(conflicts, data) { super('共享题库中的同一字段已更新，本机修改已保留，请选择保留哪个版本。'); this.code = 'SHARED_CONFLICT'; this.status = 409; this.conflicts = conflicts; this.data = data }
}
function createRepository({ storage, domain }) {
  let queue = Promise.resolve(), sequence = 0, fingerprint = '', last = null
  const listeners = new Set()
  const serial = work => { const result = queue.catch(() => {}).then(work); queue = result; return result }
  async function read() {
    const data = domain.upgradeBackup(await storage.load()), stamp = revision(data.records)
    if (stamp !== fingerprint) { fingerprint = stamp; sequence++; last = { version: domain.SCHEMA_VERSION, records: data.records, sequence, revision: stamp, dataPath: storage.root } }
    return structuredClone(last)
  }
  async function announce(source) { const data = await read(); for (const listener of listeners) listener(data, source); return data }
  async function materialize(record) {
    for (const image of collectImages(record)) if (image.dataUrl) {
      Object.assign(image, await storage.saveAttachment({ dataUrl: image.dataUrl, originalName: image.name })); delete image.dataUrl; delete image.url
    }
    return record
  }
  async function commit(records, source) { const data = domain.upgradeBackup({ version: domain.SCHEMA_VERSION, records }); await storage.save(data); return announce(source) }
  async function mergeSnapshot(base, proposed) {
    return serial(async () => {
      const current = await read(), result = domain.mergeRecordLists(base, proposed, current.records)
      if (result.conflicts.length) throw new Conflict(result.conflicts, current)
      if (equal(result.records, current.records)) return current
      return commit(result.records, 'desktop')
    })
  }
  async function patch(id, changes) {
    return serial(async () => {
      const data = await read(), index = data.records.findIndex(row => row.id === id)
      if (index < 0) { const error = new Error('记录已删除，请刷新共享题库'); error.status = 404; throw error }
      if (!Array.isArray(changes) || changes.length > 200) throw new Error('修改字段格式无效')
      const candidate = structuredClone(data.records[index]), conflicts = []
      for (const change of changes) {
        const parts = change.path
        if (!Array.isArray(parts) || !parts.length || parts.length > 5 || parts.some(key => typeof key !== 'string' || ['__proto__', 'prototype', 'constructor', 'id', 'createdAt', 'updatedAt'].includes(key))) throw new Error('修改字段无效')
        if (!['title', 'type', 'field', 'tags', 'prompt', 'insight', 'criteriaText', 'nonDecisiveCriteriaText', 'models', 'quality', 'archived', 'acceptanceResult', 'assistant'].includes(parts[0])) throw new Error('不支持修改该字段')
        let target = candidate
        for (const key of parts.slice(0, -1)) { if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) throw new Error('修改路径无效'); target = target[key] }
        const key = parts.at(-1), current = target[key]
        if (!equal(current, change.before) && !equal(current, change.after)) { conflicts.push({ id, path: parts.join('.') }); continue }
        if (change.after === undefined) delete target[key]
        else target[key] = structuredClone(change.after)
      }
      if (conflicts.length) throw new Conflict(conflicts, data)
      domain.validateBackup({ version: domain.SCHEMA_VERSION, records: [candidate] })
      candidate.updatedAt = new Date().toISOString()
      await materialize(candidate); data.records[index] = candidate
      await commit(data.records)
      return { record: candidate, revision: revision(candidate) }
    })
  }
  async function setArchived(id, archived) {
    if (typeof archived !== 'boolean') throw new Error('归档状态无效')
    return serial(async () => {
      const data = await read(), row = data.records.find(record => record.id === id)
      if (!row) { const error = new Error('记录已删除'); error.status = 404; throw error }
      if (row.archived !== archived) { row.archived = archived; row.updatedAt = new Date().toISOString(); await commit(data.records) }
      return { record: row, revision: revision(row) }
    })
  }
  async function importRecords(incoming) {
    domain.validateBackup({ version: domain.SCHEMA_VERSION, records: incoming })
    return serial(async () => {
      const data = await read(), ids = new Set(data.records.map(row => row.id)), importedIds = []
      for (const row of structuredClone(incoming)) { if (ids.has(row.id)) continue; await materialize(row); data.records.push(row); ids.add(row.id); importedIds.push(row.id) }
      if (importedIds.length) await commit(data.records)
      return { importedIds, count: importedIds.length, skipped: incoming.length - importedIds.length }
    })
  }
  async function remove(id, expectedRevision) {
    return serial(async () => {
      const data = await read(), row = data.records.find(record => record.id === id)
      if (!row) return { ok: true }
      if (expectedRevision !== revision(row)) throw new Conflict([{ id, path: '删除前记录已更新' }], data)
      await commit(data.records.filter(record => record.id !== id)); return { ok: true }
    })
  }
  async function record(id, images = false) {
    const data = await serial(read), row = data.records.find(value => value.id === id)
    if (!row) { const error = new Error('记录已删除'); error.status = 404; throw error }
    const result = images ? (await storage.createBackup({ version: domain.SCHEMA_VERSION, records: [row] })).records[0] : row
    return { record: result, revision: revision(row), baseRecord: row }
  }
  async function summaries() {
    const data = await serial(read)
    return { sequence: data.sequence, revision: data.revision, records: data.records.map(row => ({ id: row.id, title: domain.displayTitle(row), archived: row.archived, createdAt: row.createdAt, updatedAt: row.updatedAt, revision: revision(row), assistant: row.assistant || {}, fieldCount: domain.recordCompletion(row).completed })) }
  }
  let lastStat = ''
  const timer = setInterval(async () => {
    try { const stat = await fs.stat(storage.dataFile), stamp = `${stat.mtimeMs}:${stat.size}`; if (stamp === lastStat) return; lastStat = stamp; await serial(async () => { const before = fingerprint; await read(); if (before && before !== fingerprint) await announce() }) } catch {}
  }, 750)
  timer.unref?.()
  return { read: () => serial(read), mergeSnapshot, patch, setArchived, importRecords, remove, record, summaries, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) }, close: () => clearInterval(timer) }
}

async function sharedIdentity(storage, cacheRoot) {
  const identityFile = path.join(storage.root, 'library-id.json'), tokenFile = path.join(cacheRoot, 'shared-bridge.json')
  await fs.mkdir(cacheRoot, { recursive: true })
  let libraryId, token
  try { libraryId = JSON.parse(await fs.readFile(identityFile, 'utf8')).libraryId } catch {}
  if (!/^[a-zA-Z0-9_-]{12,100}$/.test(libraryId || '')) { libraryId = crypto.randomUUID(); await fs.writeFile(identityFile, JSON.stringify({ libraryId }, null, 2), { encoding: 'utf8', mode: 0o600 }) }
  try { const saved = JSON.parse(await fs.readFile(tokenFile, 'utf8')); if (saved.libraryId === libraryId) token = saved.token } catch {}
  if (!/^[a-f0-9]{64}$/.test(token || '')) { token = crypto.randomBytes(32).toString('hex'); await fs.writeFile(tokenFile, JSON.stringify({ libraryId, token }), { encoding: 'utf8', mode: 0o600 }) }
  return { libraryId, token }
}
module.exports = { createRepository, sharedIdentity, Conflict, revision }
