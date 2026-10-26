import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rmdir } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createRecord, combineBackups } from '../src/domain.js'
const require = createRequire(import.meta.url)
const { createDialogPreferences } = require('../electron/dialog-preferences.cjs')

test('multiple backups combine in order, keep the first duplicate and retain source counts', () => {
  const a = createRecord(), b = createRecord(), c = createRecord()
  a.title = '文件一的原始记录'; b.title = '同编号采用文件一'; c.archived = true
  const laterB = { ...structuredClone(b), title: '后续同编号不得覆盖' }
  const inputs = [{ name: '第一份.json', data: { version: 4, records: [a, b] } }, { name: '第二份.json', data: { version: 4, records: [laterB, c] } }]
  const original = structuredClone(inputs), combined = combineBackups(inputs)
  assert.deepEqual(combined.records, [a, b, c]); assert.equal(combined.recordCount, 4); assert.equal(combined.duplicateAcrossFiles, 1)
  assert.deepEqual(combined.files, [{ name: '第一份.json', count: 2, duplicates: 0 }, { name: '第二份.json', count: 2, duplicates: 1 }])
  assert.deepEqual(inputs, original)
  assert.throws(() => combineBackups([...inputs, { name: '坏文件.json', data: { version: 4, records: [{}] } }]))
})

test('import folder persists across instances, updates sequentially and falls back to the closest existing parent', async () => {
  const root = await mkdtemp(path.resolve('test-results/import-directory-')), cache = path.join(root, 'profile'), first = path.join(root, '题库一'), second = path.join(root, '题库二')
  await mkdir(first); await mkdir(second)
  const prefs = createDialogPreferences(cache)
  assert.equal(await prefs.importDirectory(), undefined)
  await prefs.rememberImport(path.join(first, '备份.json'))
  assert.equal(await createDialogPreferences(cache).importDirectory(), first)
  await Promise.all([prefs.rememberImport(path.join(first, '另一份.json')), prefs.rememberImport(path.join(second, '最后选择.json'))])
  assert.equal(await createDialogPreferences(cache).importDirectory(), second)
  await rmdir(second)
  assert.equal(await prefs.importDirectory(), root)
})
