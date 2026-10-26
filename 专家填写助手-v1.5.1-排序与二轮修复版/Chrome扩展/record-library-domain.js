export const SCHEMA_VERSION = 4
export const MODELS = [
  { id: 'doubao', name: '豆包专家', mark: '豆', color: 'coral' },
  { id: 'gpt', name: 'GPT-5.6-Sol', mark: 'G', color: 'green' },
  { id: 'opus', name: 'Opus 4.6', mark: 'O', color: 'violet' },
  { id: 'model4', name: '模型4', mark: '4', color: 'ochre', custom: true },
  { id: 'model5', name: '模型5', mark: '5', color: 'blue', custom: true },
]
export const PRIMARY_MODELS = MODELS.filter(model => !model.custom)
export const EXTRA_MODELS = MODELS.filter(model => model.custom)
export const TYPES = ['分析决策类', '开放推荐类', 'How-to 类']
export const DEFAULT_SETTINGS = { fontSize: 14, theme: 'light' }
export const FONT_SIZE_LIMITS = { min: 12, max: 20 }
export function normalizeSettings(value) {
  const size = value?.fontSize
  return { fontSize: typeof size === 'number' && Number.isFinite(size) ? Math.min(FONT_SIZE_LIMITS.max, Math.max(FONT_SIZE_LIMITS.min, Math.round(size))) : DEFAULT_SETTINGS.fontSize, theme: value?.theme === 'dark' ? 'dark' : 'light' }
}
export const uid = () => crypto.randomUUID()
// Merge independent edits made by the desktop and the local filling assistant.
// Arrays (including screenshots) are one field; modified values are never guessed.
export function mergeRecordLists(base, local, remote, preferLocal = true) {
  const conflicts = []
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const object = value => value && typeof value === 'object' && !Array.isArray(value)
  const merge = (before, mine, theirs, id, path = []) => {
    if (equal(mine, before)) return structuredClone(theirs)
    if (equal(theirs, before) || equal(mine, theirs)) return structuredClone(mine)
    if (path.join('.') === 'updatedAt' && typeof mine === 'string' && typeof theirs === 'string') return mine > theirs ? mine : theirs
    if (object(before) && object(mine) && object(theirs)) {
      const result = {}
      for (const key of new Set([...Object.keys(before), ...Object.keys(mine), ...Object.keys(theirs)])) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) continue
        const value = merge(before[key], mine[key], theirs[key], id, [...path, key])
        if (value !== undefined) result[key] = value
      }
      return result
    }
    conflicts.push({ id, path: path.join('.') || '记录', local: mine, remote: theirs })
    return structuredClone(preferLocal ? mine : theirs)
  }
  const before = new Map(base.map(row => [row.id, row])), mine = new Map(local.map(row => [row.id, row])), theirs = new Map(remote.map(row => [row.id, row]))
  const records = []
  for (const id of new Set([...mine.keys(), ...theirs.keys()])) {
    const row = merge(before.get(id), mine.get(id), theirs.get(id), id)
    if (row !== undefined) records.push(row)
  }
  return { records, conflicts }
}
export const countChars = text => Array.from(text || '').length
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id) && !['__proto__', 'prototype', 'constructor'].includes(id)

export function createRecord() {
  const now = new Date().toISOString()
  return {
    id: uid(), title: '', type: '', field: '计算机', tags: '', prompt: '', insight: '', criteriaText: '', nonDecisiveCriteriaText: '',
    models: Object.fromEntries(MODELS.map(model => [model.id, createModel(model)])),
    quality: createQuality(), attachments: [], acceptanceResult: '', archived: false, createdAt: now, updatedAt: now,
  }
}

function createModel(model) {
  return { actualName: model.custom ? '' : model.name, response: '', screenshots: [], result: '', note: '' }
}

export function createQuality() {
  return { enabled: false, ranking: '', rankingExplanation: '' }
}

export function recordModels(record) { return record.quality?.enabled ? MODELS : PRIMARY_MODELS }

function validateImages(images) {
  if (!Array.isArray(images) || images.length > 500) throw new Error('截图列表格式无效，单个区域最多 500 张图片。')
  for (const image of images) {
    if (!image || !validId(image.id) || typeof image.name !== 'string') throw new Error('截图数据格式无效。')
    if (image.dataUrl !== undefined && (typeof image.dataUrl !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/.test(image.dataUrl) || image.dataUrl.length > 28 * 1024 * 1024)) throw new Error('截图格式无效或图片超过 20 MB。')
    if (image.fileName !== undefined && (typeof image.fileName !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(image.fileName) || image.fileName.includes('..'))) throw new Error('截图文件名无效。')
    if (!image.dataUrl && !image.fileName) throw new Error('截图缺少数据。')
  }
}

function requireStrings(value, keys, context = '记录') {
  for (const key of keys) if (typeof value?.[key] !== 'string') throw new Error(`${context}的 ${key} 字段格式无效。`)
}

function validateLegacyCriteria(criteria) {
  if (!Array.isArray(criteria) || criteria.length > 200) throw new Error('旧版考点列表格式无效。')
  const seen = new Set()
  for (const criterion of criteria) {
    if (!criterion || !validId(criterion.id) || seen.has(criterion.id) || typeof criterion.text !== 'string' || typeof criterion.decisive !== 'boolean') throw new Error('旧版考点结构无效。')
    seen.add(criterion.id)
  }
}

function validateLegacyModels(models) {
  for (const model of PRIMARY_MODELS) {
    const value = models?.[model.id]
    requireStrings(value, ['actualName', 'response', 'note', 'testedAt'], model.name)
    if (typeof value.humanized !== 'boolean' || !(value.ruleVersion === null || (Number.isInteger(value.ruleVersion) && value.ruleVersion >= 0))) throw new Error('旧版模型状态无效。')
    if (!value.judgments || typeof value.judgments !== 'object' || Array.isArray(value.judgments)) throw new Error('旧版判定结构无效。')
    for (const [id, judgment] of Object.entries(value.judgments)) {
      if (!validId(id) || !judgment || !['', '达成', '未达成'].includes(judgment.result) || typeof judgment.evidence !== 'string') throw new Error('旧版判定格式无效。')
    }
    validateImages(value.screenshots)
  }
}

function validateLegacyRecord(record) {
  requireStrings(record, ['title', 'prompt', 'insight', 'tags', 'createdAt', 'updatedAt'])
  if (!validId(record.id) || !TYPES.includes(record.type) || record.field !== '计算机' || !Number.isInteger(record.ruleVersion) || record.ruleVersion < 0 || ['archived', 'frozen', 'humanized'].some(key => typeof record[key] !== 'boolean')) throw new Error('旧版记录格式无效。')
  if (!Array.isArray(record.revisions)) throw new Error('旧版历史资料格式无效。')
  validateLegacyCriteria(record.criteria)
  validateLegacyModels(record.models)
  validateImages(record.attachments)
  const versions = new Set()
  for (const version of record.revisions) {
    requireStrings(version, ['prompt', 'insight', 'reason', 'frozenAt'], '旧版历史资料')
    if (!Number.isInteger(version.version) || version.version < 1 || versions.has(version.version) || !TYPES.includes(version.type) || Number.isNaN(Date.parse(version.frozenAt))) throw new Error('旧版历史版本格式无效。')
    versions.add(version.version)
    validateLegacyCriteria(version.criteria)
    if (version.modelResults) validateLegacyModels(version.modelResults)
  }
}

export function validateBackup(data) {
  if (!data || ![1, 2, 3, SCHEMA_VERSION].includes(data.version) || !Array.isArray(data.records)) throw new Error('备份格式无效，请使用应用导出的完整 JSON 备份。')
  if (data.records.length > 10000) throw new Error('单次最多导入 10000 条记录。')
  const ids = new Set()
  for (const record of data.records) {
    if (!record || !validId(record.id) || ids.has(record.id)) throw new Error('记录编号无效或重复。')
    ids.add(record.id)
    if (Number.isNaN(Date.parse(record.createdAt)) || Number.isNaN(Date.parse(record.updatedAt))) throw new Error('记录日期格式无效。')
    if (data.version === 1) { validateLegacyRecord(record); continue }
    requireStrings(record, ['title', 'type', 'field', 'prompt', 'insight', 'criteriaText', 'tags', 'acceptanceResult', 'createdAt', 'updatedAt'])
    if (record.nonDecisiveCriteriaText !== undefined && typeof record.nonDecisiveCriteriaText !== 'string') throw new Error('非决定性核心考点格式无效。')
    if (record.assistant !== undefined) {
      const value = record.assistant
      if (!value || typeof value !== 'object' || Array.isArray(value) || (value.overwriteMode !== undefined && !['none', 'all', 'later'].includes(value.overwriteMode))) throw new Error('填写助手设置格式无效。')
      if (value.ranks !== undefined && (!value.ranks || typeof value.ranks !== 'object' || Array.isArray(value.ranks) || Object.entries(value.ranks).some(([key, rank]) => !['doubao', 'gpt56', 'claude', 'arena1', 'arena2'].includes(key) || typeof rank !== 'string' || !/^[1-5]?$/.test(rank)))) throw new Error('填写助手名次格式无效。')
    }
    if (!['', ...TYPES].includes(record.type) || typeof record.archived !== 'boolean' || !['', '通过', '不通过'].includes(record.acceptanceResult)) throw new Error('记录分类或结果格式无效。')
    validateImages(record.attachments)
    for (const model of data.version === 2 ? PRIMARY_MODELS : MODELS) {
      const value = record.models?.[model.id]
      requireStrings(value, ['actualName', 'response', 'result', 'note'], model.name)
      if (!['', '达成', '未达成'].includes(value.result)) throw new Error(`${model.name} 的结果格式无效。`)
      validateImages(value.screenshots)
    }
    if (data.version >= 3) {
      const quality = record.quality
      requireStrings(quality, ['ranking', 'rankingExplanation'], '二轮资料')
      if (typeof quality.enabled !== 'boolean') throw new Error('二轮资料开关格式无效。')
    }
    if (record.legacy !== undefined) validateLegacyRecord(record.legacy)
  }
  return data
}

function legacyOverall(record, modelId) {
  const criteria = record.criteria.filter(criterion => criterion.decisive)
  const model = record.models[modelId]
  if (!record.frozen || model.ruleVersion !== record.ruleVersion || !criteria.length) return ''
  if (criteria.some(criterion => model.judgments[criterion.id]?.result === '未达成')) return '未达成'
  return criteria.every(criterion => model.judgments[criterion.id]?.result === '达成') ? '达成' : ''
}

function criteriaText(criteria) {
  return criteria.map((criterion, index) => criterion.text.trim() ? `考点${index + 1}（${criterion.decisive ? '决定性' : '非决定性'}核心考点）：${criterion.text}` : '').filter(Boolean).join('\n\n')
}

export function upgradeBackup(input) {
  validateBackup(input)
  if (input.version >= 2) {
    const upgraded = { ...input, version: SCHEMA_VERSION, records: input.records.map(normalizeModelDefaults) }
    validateBackup(upgraded)
    return upgraded
  }
  return {
    ...input, version: SCHEMA_VERSION,
    records: input.records.map(old => {
      const record = { ...createRecord(), id: old.id, title: old.title, type: old.type, field: old.field, tags: old.tags, prompt: old.prompt, insight: old.insight, criteriaText: criteriaText(old.criteria), attachments: structuredClone(old.attachments), archived: old.archived, createdAt: old.createdAt, updatedAt: old.updatedAt, legacy: structuredClone(old) }
      for (const model of PRIMARY_MODELS) {
        const data = old.models[model.id]
        record.models[model.id] = { actualName: data.actualName.trim() ? data.actualName : model.name, response: data.response, screenshots: structuredClone(data.screenshots), result: legacyOverall(old, model.id), note: data.note }
      }
      const allResults = PRIMARY_MODELS.every(model => record.models[model.id].result)
      const wasComplete = old.frozen && old.humanized && old.prompt.trim() && countChars(old.prompt) <= 100 && old.insight.trim() && old.criteria.every(criterion => criterion.text.trim()) && PRIMARY_MODELS.every(model => {
        const value = old.models[model.id]
        return value.actualName.trim() && value.response.trim() && value.screenshots.length && value.note.trim() && value.humanized && old.criteria.every(criterion => value.judgments[criterion.id]?.result && value.judgments[criterion.id]?.evidence?.trim())
      })
      if (allResults && wasComplete) record.acceptanceResult = record.models.doubao.result === '未达成' && ['gpt', 'opus'].some(id => record.models[id].result === '达成') ? '通过' : '不通过'
      return normalizeModelDefaults(record)
    }),
  }
}

function normalizeModelDefaults(record) {
  const next = structuredClone(record)
  next.nonDecisiveCriteriaText ??= ''
  next.models = { ...next.models, ...Object.fromEntries(MODELS.map(model => {
    const data = next.models[model.id] || createModel(model)
    return [model.id, { ...createModel(model), ...data, actualName: model.custom || data.actualName.trim() ? data.actualName : model.name }]
  })) }
  const quality = next.quality || {}
  next.quality = { enabled: quality.enabled ?? false, ranking: quality.ranking ?? '', rankingExplanation: quality.rankingExplanation ?? '' }
  removeCancelledFields(next)
  return next
}

function removeCancelledFields(record) {
  delete record.notes
  const cleanModels = models => {
    for (const model of Object.values(models || {})) {
      for (const key of ['mode', 'source', 'networkStatus', 'contextMode', 'collectionNote']) delete model[key]
    }
  }
  cleanModels(record.models)
  for (const revision of record.revisions || []) cleanModels(revision.modelResults)
  if (record.legacy) removeCancelledFields(record.legacy)
}

export function imageCount(record) { return record.attachments.length + MODELS.reduce((count, model) => count + record.models[model.id].screenshots.length, 0) }
const REQUIRED_RECORD_FIELDS = [['title', '标题'], ['type', '问题类型'], ['field', '领域'], ['prompt', '问题（Prompt）'], ['insight', '关键洞察'], ['criteriaText', '决定性核心考点']]
const REQUIRED_MODEL_FIELDS = [['response', '原始回复'], ['result', '总体结果'], ['note', '达成性备注']]
export function missingFields(record) {
  const missing = REQUIRED_RECORD_FIELDS.filter(([key]) => !record[key]?.trim()).map(([key, label]) => ({ key, label }))
  const modelList = record.quality?.enabled ? MODELS : PRIMARY_MODELS
  for (const model of modelList) {
    const data = record.models[model.id]
    if (model.custom) {
      if (!data.actualName.trim()) missing.push({ key: `${model.id}.actualName`, label: `${model.name} · 准确名称` })
    }
    for (const [key, name] of REQUIRED_MODEL_FIELDS) {
      if (!data[key]?.trim()) missing.push({ key: `${model.id}.${key}`, label: `${model.name} · ${name}` })
    }
    if (!data.screenshots.length) missing.push({ key: `${model.id}.screenshots`, label: `${model.name} · 截图` })
  }
  if (!record.acceptanceResult?.trim()) missing.push({ key: 'acceptanceResult', label: '验收结果' })
  if (record.quality?.enabled) {
    const quality = record.quality
    if (!quality.ranking.trim()) missing.push({ key: 'quality.ranking', label: '五模型达成性排序' })
    if (!quality.rankingExplanation.trim()) missing.push({ key: 'quality.rankingExplanation', label: '排序说明' })
    else if (countChars(quality.rankingExplanation) < 300) missing.push({ key: 'quality.rankingExplanation', label: `排序说明不足 300 字（当前 ${countChars(quality.rankingExplanation)} 字）` })
  }
  return missing
}

export function recordCompletion(record) {
  const missing = missingFields(record)
  const total = REQUIRED_RECORD_FIELDS.length + 1 + recordModels(record).reduce((count, model) => count + REQUIRED_MODEL_FIELDS.length + 1 + (model.custom ? 1 : 0), 0) + (record.quality?.enabled ? 2 : 0)
  const completed = total - missing.length
  return { total, completed, percent: Math.round(completed * 100 / total), missing }
}

export function qualityWarnings(record) {
  if (!record.quality.enabled) return []
  const warnings = []
  const named = MODELS.map(model => ({ model, name: record.models[model.id].actualName.trim().toLowerCase() })).filter(value => value.name)
  if (new Set(named.map(value => value.name)).size !== named.length) warnings.push('模型名称重复，请核验五个模型是否不同。')
  const quality = record.quality
  if (quality.ranking.trim()) {
    const ranking = quality.ranking.replace(/\s/g, '').replaceAll('＞', '>')
    const match = ranking.match(/^模型[1-5](?:[>=]模型[1-5]){4}$/)
    if (!match || new Set(ranking.match(/[1-5]/g)).size !== 5) warnings.push('排序应包含模型1至模型5各一次，关系使用 ＞ 或 =。')
  }
  if (quality.rankingExplanation.trim()) {
    const explanation = quality.rankingExplanation
    const labels = ['总结', ...MODELS.map((model, index) => `模型${index + 1}`)]
    const absent = labels.filter(label => !new RegExp(`${label}\\s*[:：]`).test(explanation))
    if (absent.length) warnings.push(`排序说明未包含：${absent.join('、')}。`)
  }
  return warnings
}
export function displayTitle(record) { return record.title.trim() || record.prompt.trim().slice(0, 36) || '未命名记录' }
export function exportQuestionsText(records) {
  const prompts = records.filter(record => typeof record.prompt === 'string' && record.prompt.trim()).map(record => record.prompt.replace(/\r\n|\r|\n/g, '\r\n'))
  return prompts.length ? prompts.join('\r\n\r\n\r\n') + '\r\n' : ''
}
export function searchText(record) {
  return [record.title, record.type, record.field, record.prompt, record.insight, record.criteriaText, record.nonDecisiveCriteriaText, record.tags, ...MODELS.flatMap(model => { const data = record.models[model.id]; return [data.actualName, data.response, data.note] }), record.quality?.ranking, record.quality?.rankingExplanation].join('\n').toLowerCase()
}

export function exportText(record) {
  const lines = [`标题：${record.title}`, `题目类型：${record.type}`, `题目领域：${record.field}`, `标签：${record.tags}`, '', `问题（Prompt）：\n${record.prompt}`, '', `关键洞察（Insight）：\n${record.insight}`, '', `决定性核心考点：\n${record.criteriaText}`, '', `非决定性核心考点：\n${record.nonDecisiveCriteriaText || ''}`, '']
  for (const model of MODELS) {
    const data = record.models[model.id]
    if (model.custom && !record.quality?.enabled && !data.actualName && !data.response && !data.note && !data.screenshots.length && !data.result) continue
    lines.push(`===== ${model.name} =====`, `实际名称：${model.custom ? data.actualName : data.actualName.trim() ? data.actualName : model.name}`, `${model.custom ? '决定性核心考点是否达成' : '总体结果'}：${data.result}`, '', `原始回复：\n${data.response}`, '', `达成性备注：\n${data.note}`, `截图：${data.screenshots.map(image => image.name).join('；')}`, '')
  }
  const quality = record.quality
  if (quality && (quality.enabled || Object.values(quality).some(value => typeof value === 'string' && value.trim()))) {
    lines.push('===== 二轮模型与五模型排序 =====', `核心考点的达成性排序：${quality.ranking}`, '', `核心考点的达成性排序说明：\n${quality.rankingExplanation}`, '')
  }
  lines.push(`验收结果：${record.acceptanceResult}`, `题目附件：${record.attachments.map(image => image.name).join('；')}`)
  return lines.join('\n')
}

export function legacyText(record) {
  const old = record.legacy
  if (!old) return ''
  const lines = ['原逐考点记录', '', criteriaText(old.criteria), '']
  const appendModels = (models, criteria) => {
    for (const model of PRIMARY_MODELS) {
      const value = models[model.id]
      lines.push(`===== ${model.name} =====`, `实际名称：${value.actualName}`, '', value.response, '')
      for (const [id, judgment] of Object.entries(value.judgments)) {
        const index = criteria.findIndex(criterion => criterion.id === id)
        lines.push(`${index < 0 ? id : `考点${index + 1}`}：${judgment.result}`, judgment.evidence, '')
      }
      lines.push(`达成性备注：${value.note}`, '')
    }
  }
  appendModels(old.models, old.criteria)
  for (const version of old.revisions) {
    lines.push(`===== 历史版本 v${version.version} =====`, `时间：${version.frozenAt}`, `修订原因：${version.reason}`, '', version.prompt, '', version.insight, '', criteriaText(version.criteria), '')
    if (version.modelResults) appendModels(version.modelResults, version.criteria)
  }
  return lines.join('\n')
}
