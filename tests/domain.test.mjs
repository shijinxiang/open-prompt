import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { DEFAULT_SETTINGS, MODELS, PRIMARY_MODELS, SCHEMA_VERSION, countChars, createRecord, exportText, exportQuestionsText, legacyText, missingFields, normalizeSettings, qualityWarnings, recordCompletion, recordModels, searchText, upgradeBackup, validateBackup } from '../src/domain.js'
const require = createRequire(import.meta.url)
const { createStorage, collectImages, resolveAttachment } = require('../electron/storage.cjs')
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2HsAAAAASUVORK5CYII='

test('questions TXT exports exact question bodies across archive states without extra fields or blank questions', () => {
  const records = [
    { prompt: '第一题😀\n题目原文中的“答案”二字也保留。', title: '不应导出标题', archived: false, models: { doubao: { response: '不应导出回复' } } },
    { prompt: '第二题\r\n完整问题。', archived: true, criteriaText: '不应导出考点' },
    { prompt: ' \r\n\t', title: '空题目不使用标题补齐' },
  ]
  const before = structuredClone(records)
  assert.equal(exportQuestionsText(records), '第一题😀\r\n题目原文中的“答案”二字也保留。\r\n\r\n\r\n第二题\r\n完整问题。\r\n')
  assert.equal(exportQuestionsText([{ prompt: '' }, { prompt: ' \n' }]), '')
  assert.deepEqual(records, before)
})

test('old backups leave the new optional non-decisive criteria blank without splitting existing text', () => {
  const old = createRecord()
  delete old.nonDecisiveCriteriaText
  old.criteriaText = '决定性：原文\n\n非决定性：也保留原文，不自动拆分'
  const original = structuredClone(old)
  const migrated = upgradeBackup({ version: 4, records: [old] }).records[0]
  assert.equal(migrated.nonDecisiveCriteriaText, '')
  assert.equal(migrated.criteriaText, old.criteriaText)
  assert.deepEqual(old, original)
  assert.deepEqual(missingFields(migrated), missingFields(old))
  migrated.nonDecisiveCriteriaText = '单独的可选考点\n保留换行'
  assert.equal(upgradeBackup({ version: 4, records: [migrated] }).records[0].nonDecisiveCriteriaText, migrated.nonDecisiveCriteriaText)
  assert.ok(exportText(migrated).includes(`非决定性核心考点：\n${migrated.nonDecisiveCriteriaText}`))
  assert.ok(searchText(migrated).includes('单独的可选考点'))
  assert.throws(() => validateBackup({ version: 4, records: [{ ...migrated, nonDecisiveCriteriaText: [] }] }))
})

test('v2 migration preserves remaining fields and screenshots and drops cancelled fields without new missing reminders', () => {
  const original = createRecord()
  delete original.models.model4; delete original.models.model5; delete original.quality
  original.title = 'existing'; original.notes = 'untouched notes'; original.prompt = 'original prompt'
  original.models.gpt.actualName = 'custom exact name'
  original.models.gpt.response = '**original response**\n\nUnchanged'
  original.models.gpt.screenshots = [{ id: crypto.randomUUID(), name: 'existing.png', dataUrl: png }]
  original.attachments.push({ id: crypto.randomUUID(), name: 'hidden attachment.png', dataUrl: png })
  const snapshot = structuredClone(original)
  const upgraded = upgradeBackup({ version: 2, records: [original] })
  assert.equal(upgraded.version, SCHEMA_VERSION)
  const result = upgraded.records[0]
  for (const [key, value] of Object.entries(snapshot)) {
    if (key === 'notes') { assert.equal(result.notes, undefined); continue }
    if (key === 'models') { for (const model of PRIMARY_MODELS) assert.deepEqual(result.models[model.id], value[model.id]) }
    else assert.deepEqual(result[key], value)
  }
  assert.equal(result.quality.enabled, false)
  assert.deepEqual(recordModels(result), PRIMARY_MODELS)
  assert.equal(result.models.model4.actualName, '')
  assert.equal(result.models.model5.mode, undefined)
  assert.ok(!missingFields(result).some(field => /model[45]|quality/.test(field.key)))
  assert.deepEqual(original, snapshot)
  assert.deepEqual(upgradeBackup(upgraded), upgraded)
})

test('v3 imports retain five model replies and tied rankings while discarding cancelled fields', () => {
  const record = createRecord()
  record.title = 'title'; record.type = 'How-to 类'; record.prompt = 'prompt'; record.insight = 'insight'; record.criteriaText = 'criteria'; record.acceptanceResult = '通过'
  record.quality.enabled = true
  for (const model of MODELS) Object.assign(record.models[model.id], { actualName: model.name, mode: 'actual mode', response: 'response', result: '达成', note: 'note', screenshots: [{ id: crypto.randomUUID(), name: `${model.id}.png`, dataUrl: png }] })
  record.models.model4.source = '平台甲／模型系列'; record.models.model4.networkStatus = '已开启'; record.models.model4.contextMode = 'Context 记录'; record.models.model4.collectionNote = '独立新会话，仅输入完整 Prompt。'
  record.quality.matrixText = '| 模型 | K1 |\n| 模型4 | 达成 |'
  record.quality.ranking = '模型1 = 模型3 ＞ 模型2 ＞ 模型5 ＞ 模型4'
  record.quality.rankingExplanation = ['总结：', ...MODELS.map((model, index) => `模型${index + 1}：`)].map(label => `${label}${'依据核心考点的达成集合记录本次排序。'.repeat(4)}`).join('\n\n')
  record.quality.verificationNotes = 'removed verification'
  record.notes = 'removed supplementary notes'
  const migrated = upgradeBackup({ version: 3, records: [record] }).records[0]
  assert.deepEqual(migrated.quality, { enabled: true, ranking: record.quality.ranking, rankingExplanation: record.quality.rankingExplanation })
  for (const model of MODELS) {
    const { mode, source, networkStatus, contextMode, collectionNote, ...retained } = record.models[model.id]
    assert.deepEqual(migrated.models[model.id], retained)
  }
  assert.equal(migrated.notes, undefined)
  assert.ok(countChars(record.quality.rankingExplanation) >= 300)
  assert.deepEqual(missingFields(record), [])
  assert.deepEqual(qualityWarnings(record), [])
  validateBackup({ version: 3, records: [record] })
  assert.ok(exportText(record).includes(record.quality.ranking))
  assert.doesNotMatch(exportText(migrated), /模式|来源|联网|Context|采集|待核验|矩阵|补充备注/)
  assert.doesNotMatch(exportText(record), /质检判断|审核结论|质检意见|专家返修/)
  assert.ok(!searchText(migrated).includes('context 记录'))
  assert.ok(!Object.keys(record.quality).some(key => ['judgment', 'opinion', 'reviewDecision', 'repairNotes'].includes(key)))
  record.quality.rankingExplanation = '短说明'
  assert.ok(missingFields(record).some(field => field.label.includes('不足 300 字')))
  validateBackup({ version: 3, records: [record] })
  record.quality.enabled = false
  const disabled = upgradeBackup({ version: 3, records: [record] }).records[0]
  assert.equal(disabled.models.model4.response, 'response')
  assert.equal(disabled.quality.matrixText, undefined)
  assert.equal(disabled.quality.ranking, record.quality.ranking)
  assert.ok(!exportText(disabled).includes('平台甲／模型系列'))
})

test('new schema validates both extra models even if second-round display is disabled', () => {
  const record = createRecord()
  record.models.model5.screenshots.push({ id: crypto.randomUUID(), name: 'bad', dataUrl: 'data:text/html;base64,eA==' })
  assert.throws(() => validateBackup({ version: 3, records: [record] }))
  record.models.model5.screenshots = []
  record.models.model4.networkStatus = 'discarded old state'
  record.quality.matrixText = []
  assert.doesNotThrow(() => upgradeBackup({ version: 3, records: [record] }))
  record.quality.ranking = []
  assert.throws(() => validateBackup({ version: SCHEMA_VERSION, records: [record] }))
})

test('missing field reminders identify only empty main fields and never block saving incomplete records', () => {
  const record = createRecord()
  assert.deepEqual(Object.fromEntries(PRIMARY_MODELS.map(model => [model.id, record.models[model.id].actualName])), { doubao: '豆包专家', gpt: 'GPT-5.6-Sol', opus: 'Opus 4.6' })
  assert.ok(MODELS.every(model => !('mode' in record.models[model.id])))
  const empty = missingFields(record)
  assert.ok(empty.some(field => field.key === 'prompt'))
  assert.ok(empty.some(field => field.key === 'doubao.response'))
  assert.ok(empty.some(field => field.key === 'opus.screenshots'))
  assert.ok(!empty.some(field => ['tags', 'notes', 'attachments', 'field', 'doubao.actualName', 'doubao.mode', 'gpt.actualName', 'gpt.mode', 'opus.actualName', 'opus.mode'].includes(field.key)))
  record.title = 'title'; record.type = 'How-to 类'; record.prompt = 'question'; record.insight = 'insight'; record.criteriaText = 'criteria'; record.acceptanceResult = '不通过'
  for (const model of Object.values(record.models)) Object.assign(model, { actualName: 'name', mode: 'mode', response: 'response', result: '未达成', note: 'note', screenshots: [{ id: crypto.randomUUID(), name: 'shot.png', dataUrl: png }] })
  assert.deepEqual(missingFields(record), [])
  record.models.gpt.note = '  \n'
  record.models.gpt.screenshots = []
  assert.deepEqual(missingFields(record).map(field => field.label), ['GPT-5.6-Sol · 达成性备注', 'GPT-5.6-Sol · 截图'])
  validateBackup({ version: SCHEMA_VERSION, records: [record] })
})

test('font settings persist independently and are limited to valid sizes', async () => {
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS)
  assert.equal(normalizeSettings({ fontSize: 100 }).fontSize, 20)
  assert.equal(normalizeSettings({ fontSize: 1 }).fontSize, 12)
  assert.equal(normalizeSettings({ fontSize: Number.NaN }).fontSize, DEFAULT_SETTINGS.fontSize)
  assert.equal(normalizeSettings({ fontSize: 18, theme: 'dark' }).theme, 'dark')
  assert.equal(normalizeSettings({ theme: 'invalid' }).theme, 'light')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'oqs-settings-'))
  try {
    const storage = createStorage(dir)
    assert.deepEqual(await storage.loadSettings(), {})
    await Promise.all([storage.saveSettings({ fontSize: 16 }), storage.saveSettings({ fontSize: 20 })])
    assert.deepEqual(await storage.loadSettings(), { fontSize: 20 })
    assert.deepEqual((await storage.load()).records, [])
    assert.deepEqual(await createStorage(dir).loadSettings(), { fontSize: 20 })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('blank model metadata is defaulted on load without changing explicit values, original evidence or timestamps', () => {
  const record = createRecord()
  record.models.doubao.actualName = ''
  record.models.doubao.mode = '  \n'
  record.models.gpt.actualName = ' 自定义名称 '
  record.models.gpt.mode = ' 深度研究 '
  record.models.opus.actualName = '\n'
  record.models.opus.mode = ''
  const original = structuredClone(record)
  const upgraded = upgradeBackup({ version: 2, records: [record] })
  assert.equal(upgraded.records[0].models.doubao.actualName, '豆包专家')
  assert.equal(upgraded.records[0].models.doubao.mode, undefined)
  assert.equal(upgraded.records[0].models.opus.actualName, 'Opus 4.6')
  assert.equal(upgraded.records[0].models.opus.mode, undefined)
  const { mode, ...expectedGpt } = original.models.gpt
  assert.deepEqual(upgraded.records[0].models.gpt, expectedGpt)
  assert.equal(upgraded.records[0].updatedAt, original.updatedAt)
  assert.deepEqual(record, original)
  assert.ok(!missingFields(record).some(field => field.key.endsWith('.actualName') || field.key.endsWith('.mode')))
  assert.ok(!exportText(record).includes('模式：'))
  const old = legacyRecord()
  old.models.doubao.actualName = ''; old.models.doubao.mode = ''
  const legacyUpgrade = upgradeBackup({ version: 1, records: [old] }).records[0]
  assert.equal(legacyUpgrade.models.doubao.actualName, '豆包专家')
  assert.equal(legacyUpgrade.models.doubao.mode, undefined)
  assert.equal(legacyUpgrade.legacy.models.doubao.actualName, '')
  assert.ok(PRIMARY_MODELS.every(model => !('mode' in legacyUpgrade.legacy.models[model.id])))
})

function legacyRecord() {
  const base = createRecord()
  const criterion = { id: crypto.randomUUID(), text: '识别故障边界\n保留证据', decisive: true }
  return {
    id: base.id, title: '旧记录', type: 'How-to 类', field: '计算机', tags: '恢复', prompt: '故障恢复怎么做？', insight: '先识别边界。', criteria: [criterion], attachments: [],
    models: Object.fromEntries(['doubao', 'gpt', 'opus'].map(id => [id, { actualName: id, mode: 'mode', response: `original-${id}`, screenshots: [], judgments: { [criterion.id]: { result: id === 'doubao' ? '未达成' : '达成', evidence: `evidence-${id}` } }, note: `note-${id}`, testedAt: base.createdAt, ruleVersion: 1, humanized: true }])),
    humanized: true, archived: false, frozen: true, ruleVersion: 1, revisions: [], createdAt: base.createdAt, updatedAt: base.updatedAt,
  }
}

test('free text records permit empty fields, long prompts and optional results without imposing a workflow', () => {
  const record = createRecord()
  validateBackup({ version: SCHEMA_VERSION, records: [record] })
  record.prompt = '字'.repeat(300)
  record.insight = '1. 保持原文本格式\n\n2. 可以分段'
  record.criteriaText = '自由文本\n考点一：条件 A\n考点二：条件 B'
  record.models.doubao.note = '无回复时也能先保存备注'
  record.models.doubao.result = '未达成'
  record.acceptanceResult = '通过'
  validateBackup({ version: SCHEMA_VERSION, records: [record] })
  assert.ok(exportText(record).includes(record.criteriaText))
  assert.ok(exportText(record).includes(record.prompt))
  assert.ok(searchText(record).includes('无回复时也能先保存备注'))
  assert.equal(countChars('题 A。😀'), 5)
})

test('old records are upgraded losslessly, with criteria in one text field and historical evidence retained', () => {
  const old = legacyRecord()
  old.revisions.push({ version: 1, type: old.type, frozenAt: old.createdAt, prompt: old.prompt, insight: old.insight, criteria: structuredClone(old.criteria), reason: 'historical-reason', modelResults: structuredClone(old.models) })
  const image = { id: crypto.randomUUID(), name: 'history.png', dataUrl: png }
  old.revisions[0].modelResults.opus.screenshots.push(image)
  const original = structuredClone(old)
  const upgraded = upgradeBackup({ version: 1, records: [old] })
  validateBackup(upgraded)
  const record = upgraded.records[0]
  assert.equal(record.criteriaText, '考点1（决定性核心考点）：识别故障边界\n保留证据')
  assert.equal(record.models.doubao.result, '未达成')
  assert.equal(record.models.gpt.result, '达成')
  const expectedLegacy = structuredClone(original)
  for (const model of Object.values(expectedLegacy.models)) delete model.mode
  for (const revision of expectedLegacy.revisions) for (const model of Object.values(revision.modelResults)) delete model.mode
  assert.deepEqual(record.legacy, expectedLegacy)
  assert.deepEqual(old, original)
  assert.ok(legacyText(record).includes('evidence-opus'))
  assert.ok(legacyText(record).includes('historical-reason'))
  assert.ok(collectImages(record).some(value => value.id === image.id))
  assert.deepEqual(upgradeBackup(upgraded), upgraded)
  const current = structuredClone(record)
  current.criteriaText = '改写考点'
  current.models.gpt.response = 'updated-response'
  assert.equal(current.models.gpt.note, 'note-gpt')
  assert.equal(current.models.gpt.result, '达成')
})

test('old stale judgments remain as evidence but do not become current overall results', () => {
  const old = legacyRecord()
  old.models.doubao.ruleVersion = 0
  const record = upgradeBackup({ version: 1, records: [old] }).records[0]
  assert.equal(record.models.doubao.result, '')
  assert.equal(record.legacy.models.doubao.judgments[old.criteria[0].id].result, '未达成')
})

test('backup rejects malformed images, duplicate records and invalid legacy evidence', () => {
  const record = createRecord()
  assert.throws(() => validateBackup({ version: 2, records: [record, record] }))
  record.models.doubao.screenshots.push({ id: crypto.randomUUID(), name: 'image', dataUrl: 'data:text/html;base64,eA==' })
  assert.throws(() => validateBackup({ version: 2, records: [record] }))
  record.models.doubao.screenshots = []
  record.legacy = legacyRecord()
  record.legacy.models.gpt.judgments[record.legacy.criteria[0].id].result = '部分达成'
  assert.throws(() => validateBackup({ version: 2, records: [record] }))
})

test('file storage serializes writes and exports screenshots from both current records and retained old data', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'oqs-storage-'))
  try {
    const storage = createStorage(dir)
    const record = createRecord()
    const attachment = await storage.saveAttachment({ dataUrl: png, originalName: '截图.png' })
    const image = { ...attachment, id: crypto.randomUUID(), name: '截图.png' }
    record.attachments.push(image)
    record.legacy = legacyRecord()
    record.legacy.models.opus.screenshots.push(structuredClone(image))
    await Promise.all([storage.save({ version: 2, records: [] }), storage.save({ version: 2, records: [record] })])
    assert.equal((await storage.load()).records.length, 1)
    const backup = await storage.createBackup({ version: 2, records: [record] })
    validateBackup(backup)
    assert.equal(backup.records[0].attachments[0].dataUrl, png)
    assert.equal(backup.records[0].legacy.models.opus.screenshots[0].dataUrl, png)
    assert.equal(backup.records[0].attachments[0].fileName, undefined)
    assert.equal(JSON.parse(await readFile(storage.dataFile, 'utf8')).records[0].attachments[0].fileName, attachment.fileName)
    assert.throws(() => resolveAttachment(dir, '../outside.png'))
    await assert.rejects(storage.saveAttachment({ dataUrl: 'data:text/html;base64,eA==' }))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('directory migration preserves old data and does not overwrite existing project records', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'oqs-migration-'))
  try {
    const source = createStorage(path.join(dir, 'old'))
    const target = createStorage(path.join(dir, 'project', 'data'))
    const record = legacyRecord()
    const attachment = await source.saveAttachment({ dataUrl: png, originalName: 'screenshot.png' })
    record.attachments.push({ ...attachment, id: crypto.randomUUID(), name: 'screenshot.png' })
    await source.save({ version: 1, records: [record] })
    assert.equal((await target.migrateFrom(source.root, validateBackup)).migrated, true)
    assert.deepEqual((await target.load()).records, [record])
    assert.equal(await readFile(path.join(target.attachments, attachment.fileName), 'base64'), png.split(',')[1])
    const next = upgradeBackup(await target.load())
    next.records[0].title = 'updated'
    await target.save(next)
    assert.equal((await target.migrateFrom(source.root, validateBackup)).migrated, false)
    assert.equal((await target.load()).records[0].title, 'updated')
    assert.equal((await source.load()).records[0].title, '旧记录')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('image drag exports keep original bytes and leave stored screenshots intact even when exported copies are moved', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'oqs-drag-'))
  try {
    const storage = createStorage(path.join(dir, 'data'))
    const image = await storage.saveAttachment({ dataUrl: png, originalName: 'screenshot.png' })
    const file = await storage.prepareDragExport({ ...image, name: '截图.png' }, path.join(dir, 'exports'))
    assert.equal(path.basename(file), '截图.png')
    assert.equal(await readFile(file, 'base64'), png.split(',')[1])
    await rm(file)
    assert.equal(await readFile(path.join(storage.attachments, image.fileName), 'base64'), png.split(',')[1])
    const recreated = await storage.prepareDragExport({ ...image, name: '../escaped.png' }, path.join(dir, 'exports'))
    assert.ok(recreated.startsWith(path.join(dir, 'exports') + path.sep))
    assert.throws(() => storage.prepareDragExport({ fileName: '../records.json' }, path.join(dir, 'exports')))
  } finally { await rm(dir, { recursive: true, force: true }) }
})


test('completion follows required fields and adjusts for second-round models without counting optional criteria', () => {
  const record = createRecord()
  let progress = recordCompletion(record)
  assert.equal(progress.total, 19)
  assert.equal(progress.completed, 1)
  assert.equal(progress.percent, 5)
  Object.assign(record, { title: '题目', type: 'How-to 类', prompt: '问题', insight: '洞察', criteriaText: '考点', acceptanceResult: '通过' })
  for (const model of PRIMARY_MODELS) Object.assign(record.models[model.id], { response: '回复', result: '达成', note: '备注', screenshots: [{ id: crypto.randomUUID(), name: 'shot.png', dataUrl: png }] })
  progress = recordCompletion(record)
  assert.equal(progress.percent, 100)
  assert.equal(progress.completed, progress.total)
  assert.deepEqual(progress.missing, [])
  record.quality.enabled = true
  progress = recordCompletion(record)
  assert.equal(progress.total, 31)
  assert.equal(progress.completed, 19)
  assert.equal(progress.percent, 61)
  for (const model of MODELS.filter(model => model.custom)) Object.assign(record.models[model.id], { actualName: model.name, response: '回复', result: '达成', note: '备注', screenshots: [{ id: crypto.randomUUID(), name: 'shot.png', dataUrl: png }] })
  record.quality.ranking = '模型1 > 模型2 > 模型3 > 模型4 > 模型5'
  record.quality.rankingExplanation = '短说明'
  assert.equal(recordCompletion(record).completed, 30)
  assert.equal(recordCompletion(record).percent, 97)
  record.quality.rankingExplanation = '说明'.repeat(150)
  assert.equal(recordCompletion(record).percent, 100)
  record.nonDecisiveCriteriaText = ''
  assert.equal(recordCompletion(record).percent, 100)
  record.models.model4.note = ''
  assert.equal(recordCompletion(record).percent, 97)
})
