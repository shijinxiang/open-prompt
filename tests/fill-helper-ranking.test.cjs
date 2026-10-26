const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'), path = require('path'), vm = require('vm')
const { webcrypto } = require('crypto')
const extension = path.join(__dirname, '..', '专家填写助手-v1.5.1-排序与二轮修复版/Chrome扩展')
const plain = value => JSON.parse(JSON.stringify(value))
function setup() {
  const context = vm.createContext({ structuredClone, File, Blob, Uint8Array, crypto: webcrypto, TextEncoder, atob, btoa, QFDB: { isArchived: row => !!row.archived } })
  for (const name of ['schema.js', 'library-import.js', 'shared-map.js']) vm.runInContext(fs.readFileSync(path.join(extension, name), 'utf8'), context, { filename: name })
  return context
}
async function record() {
  const { createRecord } = await import('../src/domain.js'), row = createRecord()
  row.models.model4.actualName = 'gemini-3-flash-grounding'; row.models.model5.actualName = 'grok-4.5-search'
  row.models.model4.response = '模型4完整原文'; row.models.model5.response = '模型5完整原文'
  row.quality = { enabled: true, ranking: 'GPT-5.6-Sol＝grok-4.5-search ＞ gemini-3-flash-grounding ＞ 豆包专家＝Opus 4.6', rankingExplanation: '原排序说明保留' }
  return row
}
function apply(row, changes) {
  const next = structuredClone(row)
  for (const change of changes) { let target = next; for (const key of change.path.slice(0, -1)) target = target[key]; target[change.path.at(-1)] = change.after }
  return next
}

test('ranking handles full-width equals/digits, ties, actual names and mixed labels', async () => {
  const c = setup(), r = await record()
  const expected = { gpt56: '1', arena2: '1', arena1: '2', doubao: '3', claude: '3' }
  assert.deepEqual(plain(c.QFRecordLibrary.ranking(r.quality.ranking, r)), expected)
  assert.deepEqual(plain(c.QFRecordLibrary.ranking('模型２＝模型５＞模型４＞模型１＝模型３')), expected)
  assert.deepEqual(plain(c.QFRecordLibrary.ranking('gpt-5.6-sol = 模型5 > 模型4 > 豆包专家＝Opus 4.6', r)), expected)
  assert.equal(c.QFRecordLibrary.ranking('模型1 > 模型1 > 模型3 > 模型4 > 模型5'), null)
  assert.equal(c.QFRecordLibrary.ranking('模型1 > 模型2'), null)
  assert.equal(c.QFRecordLibrary.ranking('未知模型 > 模型2 > 模型3 > 模型4 > 模型5', r), null)
  r.models.model4.actualName = r.models.model5.actualName = '同名模型'
  assert.equal(c.QFRecordLibrary.ranking('模型1 > 模型2 > 模型3 > 同名模型 = 模型5', r), null)
  assert.ok(c.QFRecordLibrary.ranking('模型1 > 模型2 > 模型3 > 模型4 = 模型5', r))
})

test('shared ranking preference never changes the library second-round switch or source ranking', async () => {
  const c = setup(), r = await record(), original = structuredClone(r)
  const row = await c.QFSharedMap.from({ record: r, baseRecord: r, revision: 'r1' }, 'test-library')
  assert.equal(row.syncRanking, true); assert.equal(c.QFRecordLibrary.completeRanks(row.ranks), true)
  row.syncRanking = false
  const changes = plain(await c.QFSharedMap.changes(row))
  assert.ok(changes.every(change => change.path.join('.') !== 'quality.enabled'))
  assert.ok(changes.every(change => change.path.join('.') !== 'quality.ranking'))
  const saved = apply(r, changes)
  assert.equal(saved.assistant.syncRanking, false); assert.deepEqual(saved.quality, original.quality); assert.deepEqual(saved.models, original.models)
  const restored = await c.QFSharedMap.from({ record: saved, baseRecord: saved, revision: 'r2' }, 'test-library')
  assert.equal(restored.syncRanking, false); assert.deepEqual(plain(restored.ranks), plain(row.ranks))
  restored.syncRanking = true; saved.quality.enabled = false
  const next = apply(saved, plain(await c.QFSharedMap.changes(restored)))
  assert.equal(next.quality.enabled, false); assert.equal(next.assistant.syncRanking, true)
  assert.deepEqual(r, original)
})

test('custom/native imports keep second-round content when webpage ranking sync is off', async () => {
  const c = setup(), r = await record(), row = await c.QFSharedMap.from({ record: r, baseRecord: r, revision: 'r1' }, 'test-library')
  row.syncRanking = false
  let converted = await c.QFSharedMap.create(row)
  assert.equal(converted.quality.enabled, true); assert.equal(converted.assistant.syncRanking, false); assert.equal(converted.models.model4.response, r.models.model4.response)
  delete row.recordLibrary
  converted = await c.QFSharedMap.create(row)
  assert.equal(converted.quality.enabled, true); assert.equal(converted.models.model5.response, r.models.model5.response)
})

test('legacy empty imported rankings repair once; deliberate manual ranks and later clearing survive', () => {
  const c = setup(), source = { rankingText: '模型2＝模型5＞模型4＞模型1＝模型3', secondRoundEnabled: true }
  const row = { ranks: {}, syncRanking: false, recordLibrary: source }
  assert.equal(c.QFRecordLibrary.repairRanking(row), true); assert.equal(row.syncRanking, true); assert.equal(row.ranks.gpt56, '1')
  row.ranks = {}; row.syncRanking = false
  assert.equal(c.QFRecordLibrary.repairRanking(row), false); assert.deepEqual(row.ranks, {}); assert.equal(row.syncRanking, false)
  const partial = { ranks: { doubao: '4' }, syncRanking: false, recordLibrary: source }
  assert.equal(c.QFRecordLibrary.repairRanking(partial), false); assert.deepEqual(partial.ranks, { doubao: '4' }); assert.equal(partial.syncRanking, false)
})
