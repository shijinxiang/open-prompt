import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createRecord } from '../src/domain.js'
const require = createRequire(import.meta.url)
const { createStorage } = require('../electron/storage.cjs')
const { writeBackupFile, readBackupFile } = require('../electron/backup.cjs')
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2HsAAAAASUVORK5CYII='

test('stream backup preserves text, nested screenshots, progress and source data', async () => {
  const root = await mkdtemp(path.resolve('test-results/stream-backup-')), storage = createStorage(root)
  const record = createRecord(); record.prompt = '题目😀含转义"\\\n和 records、方括号 [}]'; record.title = '导出测试'
  record.models.doubao.screenshots.push({ id: crypto.randomUUID(), name: '截图.png', ...await storage.saveAttachment({ dataUrl: png, originalName: '截图.png' }) })
  record.attachments.push(structuredClone(record.models.doubao.screenshots[0]))
  const data = { version: 4, records: [record, { ...createRecord(), title: '第二题' }] }, original = structuredClone(data)
  const file = path.join(root, '备份.json'), progress = []
  await writeBackupFile(storage, data, file, value => progress.push(value))
  const expected = await storage.createBackup(data), actual = JSON.parse(await readFile(file, 'utf8'))
  assert.deepEqual(actual.records, expected.records); assert.deepEqual(data, original)
  assert.deepEqual(progress, [{ completed: 1, total: 2 }, { completed: 2, total: 2 }])
  for (const chunkSize of [1, 2, 7, 31, 65536]) assert.deepEqual(await readBackupFile(file, null, { chunkSize }), actual)
  let count = 0
  const transformed = await readBackupFile(file, record => { count++; record.title += '-转存'; return record })
  assert.equal(count, 2); assert.equal(transformed.records[0].title, '导出测试-转存')
})

test('stream reader accepts property order and BOM, rejects invalid or incomplete JSON', async () => {
  const root = await mkdtemp(path.resolve('test-results/stream-syntax-')), file = path.join(root, 'input.json')
  for (const text of ['\uFEFF{"records":[{"prompt":"中😀文\\\\\\\""}],"version":4}', '{"records":[],"version":4}']) {
    await writeFile(file, text); assert.deepEqual(await readBackupFile(file, null, { chunkSize: 1 }), JSON.parse(text.replace(/^\uFEFF/, '')))
  }
  for (const text of ['', '[]', '{"records":[', '{"records":[{}', '{"records":[{},]}', '{"records":[],}', '{"records":[]}garbage', '{"records":[],"records":[]}', '{"records":[{"a":1,}]}', '{"records":{}}']) {
    await writeFile(file, text); await assert.rejects(readBackupFile(file, null, { chunkSize: 2 }))
  }
})

test('failed stream export preserves existing destination and removes partial temporary files', async () => {
  const root = await mkdtemp(path.resolve('test-results/stream-atomic-')), storage = createStorage(root), file = path.join(root, 'backup.json')
  await writeFile(file, 'previous valid backup')
  const record = createRecord(); record.models.gpt.screenshots.push({ id: crypto.randomUUID(), name: '丢失.png', fileName: 'missing.png' })
  await assert.rejects(writeBackupFile(storage, { version: 4, records: [record] }, file), /截图文件缺失/)
  assert.equal(await readFile(file, 'utf8'), 'previous valid backup'); assert.deepEqual(await readdir(root), ['backup.json'])
})
