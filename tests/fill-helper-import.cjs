const { chromium } = require('playwright')
const http = require('http')
const fs = require('fs/promises')
const path = require('path')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('url')
const { createStorage } = require('../electron/storage.cjs')

async function main() {
  const root = path.resolve(__dirname, '..')
  const extension = path.resolve(process.env.QF_TEST_EXTENSION || path.join(root, '专家填写助手-v1.5.1-排序与二轮修复版', 'Chrome扩展'))
  const results = await fs.mkdtemp(path.join(root, 'test-results', 'fill-helper-import-'))
  const { createRecord, MODELS } = await import(pathToFileURL(path.join(root, 'src', 'domain.js')).href)
  const storage = createStorage(path.join(results, 'source'))
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2HsAAAAASUVORK5CYII='
  const full = createRecord()
  Object.assign(full, { title: '五模型导入 <img src=x onerror="window.__unsafe=1">', type: 'How-to 类', tags: '导入测试', archived: true, acceptanceResult: '通过', prompt: '完整问题\n\n保留换行和空格。', insight: '洞察原文\n第二段', criteriaText: '决定性考点原文\n保留列表', nonDecisiveCriteriaText: '非决定性考点独立原文\n不能并入决定性' })
  full.quality = { enabled: true, ranking: '模型1 = 模型3 ＞ 模型2 = 模型4 ＞ 模型5', rankingExplanation: '总结：保留原始排序说明。\n\n模型1：说明\n模型2：说明\n模型3：说明\n模型4：说明\n模型5：说明' }
  for (const [index, model] of MODELS.entries()) {
    Object.assign(full.models[model.id], { actualName: '原模型名称-' + index, response: `# 完整回复-${index}\n\n- 列表\n\n| A | B |\n| --- | --- |\n| 原始 | Markdown |\n\n\`\`\`js\nconst text = "原文";\n\`\`\`\n`, result: index % 2 ? '未达成' : '达成', note: `完整备注-${index}\n不截断` })
    for (let i = 0; i < 2; i++) {
      const image = await storage.saveAttachment({ dataUrl: png, originalName: `${model.id}-${i}.png` })
      full.models[model.id].screenshots.push({ ...image, id: crypto.randomUUID(), name: `${model.id}-${i}.png` })
    }
  }
  full.attachments.push({ ...await storage.saveAttachment({ dataUrl: png, originalName: '题目旧附件.png' }), id: crypto.randomUUID(), name: '题目旧附件.png' })
  const old = createRecord()
  delete old.nonDecisiveCriteriaText
  old.title = '旧记录'; old.type = '分析决策类'; old.criteriaText = '旧考点原文\n即使含非决定性字样也不自动拆分'
  old.models.doubao.response = '旧记录回复'
  full.quality.ranking = '原模型名称-0＝原模型名称-2＞原模型名称-1＝原模型名称-3＞原模型名称-4'
  const backup = await storage.createBackup({ version: 4, records: [full, old] })
  const targets = ['doubao', 'gpt56', 'claude', 'arena1', 'arena2']
  const server = http.createServer(async (req, res) => {
    try {
      const requestPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
      const file = path.resolve(extension, '.' + requestPath)
      if (!file.startsWith(extension + path.sep)) { res.writeHead(403); res.end(); return }
      const types = { '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.png': 'image/png' }
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream')
      res.end(await fs.readFile(file))
    } catch { res.writeHead(404); res.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  let browser
  try {
    browser = await chromium.launch({ executablePath: process.env.QF_TEST_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(base + '/app.html')
    await page.waitForFunction(() => document.getElementById('saveState').textContent === '已在本机保存' && !!document.querySelector('[data-field]'))
    const initialCount = await page.evaluate(async () => (await QFDB.all()).length)
    const upload = data => page.locator('#importFile').setInputFiles({ name: '记录库导出.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) })
    await upload(backup)
    await page.locator('#libraryImportNotice').filter({ hasText: '导入 2 条，跳过 0 条' }).waitFor()
    assert.equal(await page.locator('#f-question-input').inputValue(), full.prompt)
    assert.equal(await page.locator('#f-insight-description-input').inputValue(), full.criteriaText)
    assert.equal(await page.locator('#f-non-decisive-insight-description-input').inputValue(), full.nonDecisiveCriteriaText)
    assert.equal(await page.locator('input[name=question-type-radio]:checked').inputValue(), 'howTo')
    for (const [index, target] of targets.entries()) {
      assert.equal(await page.locator('#f-' + target + '-markdown-input').inputValue(), full.models[MODELS[index].id].response)
      assert.equal(await page.locator('#f-' + target + '-achievement-select').inputValue(), full.models[MODELS[index].id].result)
      assert.equal(await page.locator('#f-' + target + '-achievement-note-input').inputValue(), full.models[MODELS[index].id].note)
      assert.equal(await page.locator('#files-' + target + '-screenshot-file-input .file-item').count(), 2)
    }
    assert.deepEqual(await page.locator('[data-rank]').evaluateAll(elements => elements.map(el => el.value)), ['1', '2', '1', '2', '3'])
    assert.equal(await page.locator('#syncRanking').isChecked(), true)
    assert.equal(await page.evaluate(() => window.__unsafe), undefined)
    const state = await page.evaluate(async () => {
      const rows = await QFDB.all()
      const mapped = rows.find(row => row.id.startsWith('oqs-') && row.recordLibrary.archived)
      const images = {}
      for (const [key, files] of Object.entries(mapped.attachments)) images[key] = await Promise.all(files.map(async file => ({ name: file.name, type: file.type, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) })))
      return { count: rows.length, archived: mapped.archived, source: mapped.recordLibrary, images, old: rows.find(row => row.recordLibrary && !row.recordLibrary.archived) }
    })
    assert.equal(state.count, initialCount + 2)
    assert.equal(state.archived, true)
    assert.equal(state.old.archived, false)
    assert.equal(state.old.values['non-decisive-insight-description-input'], '')
    assert.equal(state.old.values['insight-description-input'], old.criteriaText)
    assert.equal(state.source.attachments[0].dataUrl, png)
    assert.equal(state.source.modelNames.gpt56, full.models.gpt.actualName)
    for (const images of Object.values(state.images)) for (const image of images) assert.deepEqual(Buffer.from(image.bytes), Buffer.from(png.split(',')[1], 'base64'))

    await page.locator('#f-question-input').fill('插件内的人工修改，重复导入时应保留')
    await upload(backup)
    await page.locator('#libraryImportNotice').filter({ hasText: '导入 0 条，跳过 2 条' }).waitFor()
    assert.equal(await page.locator('#f-question-input').inputValue(), '插件内的人工修改，重复导入时应保留')
    assert.equal(await page.evaluate(async () => (await QFDB.all()).length), state.count)

    const invalid = structuredClone(backup)
    invalid.records.forEach(row => row.id = crypto.randomUUID())
    invalid.records[1].models.doubao.screenshots = [{ id: crypto.randomUUID(), name: '坏图片.png', dataUrl: 'data:image/png;base64,====' }]
    await upload(invalid)
    await page.locator('#libraryImportNotice').filter({ hasText: '图片编码无效' }).waitFor()
    assert.equal(await page.evaluate(async () => (await QFDB.all()).length), state.count)
    const raw = structuredClone(backup)
    delete raw.records[0].models.doubao.screenshots[0].dataUrl
    raw.records[0].models.doubao.screenshots[0].fileName = 'local-only.png'
    await upload(raw)
    await page.locator('#libraryImportNotice').filter({ hasText: '不要直接选择 data/records.json' }).waitFor()
    assert.equal(await page.evaluate(async () => (await QFDB.all()).length), state.count)

    // Existing single-record and portable formats retain the new source information.
    const downloadJob = page.waitForEvent('download')
    await page.locator('#exportDraft').click()
    const download = await downloadJob
    const singlePath = path.join(results, 'single-record.json')
    await download.saveAs(singlePath)
    const single = JSON.parse(await fs.readFile(singlePath, 'utf8'))
    assert.equal(single.format, 'quality-fill-backup')
    assert.deepEqual(single.draft.recordLibrary, state.source)
    await upload(single)
    await page.locator('#toast').filter({ hasText: '已导入为一条新记录' }).waitFor()
    assert.equal(await page.locator('#f-non-decisive-insight-description-input').inputValue(), full.nonDecisiveCriteriaText)
    const portable = await page.evaluate(async () => {
      const rows = await QFDB.all()
      const packed = await QFPortable.pack(rows, rows.find(row => row.id.startsWith('oqs-') && row.recordLibrary.archived).id)
      const restored = await QFPortable.unpack(packed)
      return { packed, source: restored.filter(row => row.recordLibrary).map(row => row.recordLibrary), images: restored.filter(row => row.recordLibrary?.archived).map(row => Object.values(row.attachments).reduce((count, files) => count + files.length, 0)) }
    })
    assert.deepEqual(portable.source.filter(source => source.archived), [state.source, state.source])
    assert.deepEqual(portable.images, [10, 10])
    await upload(portable.packed)
    await page.locator('#toast').filter({ hasText: '已合并导入' }).waitFor()
    await page.reload()
    await page.locator('#librarySourceInfo:not([hidden])').waitFor()
    assert.equal(await page.locator('#f-non-decisive-insight-description-input').inputValue(), full.nonDecisiveCriteriaText)
    await page.locator('#librarySourceInfo summary').click()
    await page.screenshot({ path: path.join(root, 'test-results', 'fill-helper-library-import.png'), fullPage: false })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForFunction(() => document.querySelector('.records-sidebar').getBoundingClientRect().left >= window.innerWidth - 1)
    assert.equal(await page.locator('#importDraft').isVisible(), true)
    await page.screenshot({ path: path.join(root, 'test-results', 'fill-helper-library-import-narrow.png') })

    const checks = await page.evaluate(async backup => {
      const broken = structuredClone(backup)
      broken.records[0].quality.ranking = '模型1 > 模型1 > 模型3 > 模型4 > 模型5'
      broken.records[0].models.model4.note = '长备注'.repeat(1100)
      const converted = await QFRecordLibrary.convert(broken)
      const previous = []
      for (const version of [2, 3]) {
        const input = structuredClone(backup); input.version = version
        for (const record of input.records) {
          delete record.nonDecisiveCriteriaText
          if (version === 2) { delete record.quality; delete record.models.model4; delete record.models.model5 }
        }
        previous.push((await QFRecordLibrary.convert(input))[0].values['non-decisive-insight-description-input'])
      }
      const concurrent = structuredClone(backup)
      for (const record of concurrent.records) record.id = crypto.randomUUID()
      const before = (await QFDB.summaries()).length
      const imported = await Promise.all([QFRecordLibrary.importBackup(concurrent), QFRecordLibrary.importBackup(concurrent)])
      return { ranks: converted[0].ranks, sync: converted[0].syncRanking, note: converted[0].values['arena1-achievement-note-input'], warnings: converted[0].recordLibrary.warnings.length, previous, imported: imported.map(result => result.count), growth: (await QFDB.summaries()).length - before }
    }, backup)
    assert.deepEqual(checks.ranks, {})
    assert.equal(checks.sync, false)
    assert.equal(checks.note, '长备注'.repeat(1100))
    assert.ok(checks.warnings >= 2)
    assert.deepEqual(checks.previous, ['', ''])
    assert.equal(checks.imported.reduce((sum, count) => sum + count, 0), 2)
    assert.equal(checks.growth, 2)

    const zipDownloadJob = page.waitForEvent('download')
    await page.locator('#exportPortable').click()
    const zipDownload = await zipDownloadJob
    await zipDownload.saveAs(path.join(results, 'migration.zip'))
    assert.ok((await fs.stat(path.join(results, 'migration.zip'))).size > 10000)
    assert.ok(await page.evaluate(() => QFPortable.assets.includes('library-import.js') && QFPortable.assets.includes('record-library-domain.js')))

    // Use the shipped engine with a local platform simulation, never a real account.
    const demo = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await demo.goto(base + '/portable-demo.html')
    await demo.addScriptTag({ url: base + '/engine.js' })
    const payload = await page.evaluate(async () => {
      const row = (await QFDB.all()).find(row => row.id.startsWith('oqs-') && row.recordLibrary.archived)
      const fields = []
      for (const field of QFSchema.fields) {
        let value = row.values[field.id]
        if (field.type === 'file') value = await Promise.all((row.attachments[field.id] || []).map(async file => {
          const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte)
          return { name: file.name, type: file.type, lastModified: file.lastModified, base64: btoa(binary) }
        }))
        fields.push({ ...field, value })
      }
      return { draftId: row.id, fields, ranking: [['doubao', 'claude'], ['gpt56', 'arena1'], ['arena2']], overwrite: false, action: 'fill', platformOnly: false }
    })
    let report = await demo.evaluate(payload => qualityFillEngine(payload), payload)
    assert.ok(report.items.some(item => item.status === 'pending' && item.id.startsWith('arena')))
    assert.equal(await demo.locator('[data-field-id=non-decisive-insight-description-input]').inputValue(), full.nonDecisiveCriteriaText)
    assert.equal(await demo.locator('[data-field-id=doubao-screenshot-file-input]').evaluate(el => el.files.length), 2)
    await demo.locator('#unlock').check()
    report = await demo.evaluate(payload => qualityFillEngine(payload), payload)
    assert.equal(await demo.locator('[data-field-id=arena2-markdown-input]').inputValue(), full.models.model5.response)
    assert.equal(await demo.locator('[data-field-id=arena2-screenshot-file-input]').evaluate(el => el.files.length), 2)
    assert.ok(!report.items.some(item => item.status === 'error'), JSON.stringify(report.items.filter(item => item.status === 'error')))
    const legacyId = await page.evaluate(async () => {
      const source = (await QFDB.all()).find(row => row.recordLibrary?.archived)
      const legacy = structuredClone(source); legacy.id = crypto.randomUUID(); legacy.ranks = {}; legacy.syncRanking = false; delete legacy.rankingVersion
      await QFDB.putMany([legacy]); await settings.set({ activeDraftId: legacy.id }); return legacy.id
    })
    await page.reload(); await page.waitForFunction(id => typeof draft !== 'undefined' && draft?.id === id && draftState().saved >= draftState().revision, legacyId)
    assert.deepEqual(await page.locator('[data-rank]').evaluateAll(elements => elements.map(el => el.value)), ['1', '2', '1', '2', '3'])
    assert.equal(await page.locator('#syncRanking').isChecked(), true)
    await page.evaluate(async () => { draft.ranks = {}; draft.syncRanking = false; markDraftDirty(); await saveNow(); const packed = await QFPortable.pack([draft], draft.id), [restored] = await QFPortable.unpack(packed); if (restored.rankingVersion !== 2) throw Error('Missing ranking adapter marker'); await QFDB.putMany([restored]) })
    await page.reload(); await page.waitForFunction(id => typeof draft !== 'undefined' && draft?.id === id, legacyId)
    assert.deepEqual(await page.locator('[data-rank]').evaluateAll(elements => elements.map(el => el.value)), ['', '', '', '', ''])
    assert.equal(await page.locator('#syncRanking').isChecked(), false)
    assert.deepEqual(errors, [])
    console.log('Record library JSON import passed: independent criteria, five model mappings, exact Markdown/image bytes, old blank defaults, duplicate protection, atomic invalid-file rejection, native/portable backup and local staged webpage filling.')
  } finally {
    if (browser) await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
