const { chromium } = require('playwright')
const http = require('http')
const fs = require('fs/promises')
const path = require('path')
const assert = require('node:assert/strict')

async function main() {
  const root = path.resolve(__dirname, '..')
  const extension = path.resolve(process.env.QF_TEST_EXTENSION || path.join(root, '专家填写助手-v1.5.1-排序与二轮修复版', 'Chrome扩展'))
  const results = await fs.mkdtemp(path.join(root, 'test-results', 'fill-helper-archive-'))
  const server = http.createServer(async (req, res) => {
    try {
      const file = path.resolve(extension, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname))
      if (!file.startsWith(extension + path.sep)) { res.writeHead(403); res.end(); return }
      res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html;charset=utf-8', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream')
      res.end(await fs.readFile(file))
    } catch { res.writeHead(404); res.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ executablePath: process.env.QF_TEST_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
    const page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    const base = `http://127.0.0.1:${server.address().port}`
    const ready = page => page.waitForFunction(() => document.querySelector('[data-field]') && document.getElementById('draftSelect').value)
    const status = (page, archived) => page.locator(`[data-record-filter=${archived ? 'archived' : 'active'}]`)
    const card = id => page.locator(`[data-switch-record="${id}"]`).locator('..')
    const upload = data => page.locator('#importFile').setInputFiles({ name: '归档测试.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) })

    // Seed the real previous database version, including File objects and source metadata.
    await page.goto(base + '/portable-demo.html')
    await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('quality-fill-local-v1', 3)
        request.onupgradeneeded = () => { for (const name of ['drafts', 'summaries']) request.result.createObjectStore(name, { keyPath: 'id' }); request.result.createObjectStore('meta') }
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
      })
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2HsAAAAASUVORK5CYII='), char => char.charCodeAt(0))
      const rows = [
        { id: 'old-native', name: '待归档的旧记录', values: { 'question-input': '旧版原问题', 'doubao-markdown-input': '# 完整原回复\n\n不改写' }, attachments: { 'doubao-screenshot-file-input': [new File([png], '原截图.png', { type: 'image/png', lastModified: 1234567 })] }, ranks: { doubao: '1' }, overwrite: false, syncRanking: false, updatedAt: 100000 },
        { id: 'old-source', name: '原JSON已归档题目', overwrite: true, values: { 'question-input': '来源问题' }, attachments: {}, ranks: {}, createdAt: 200000, updatedAt: 200000, recordLibrary: { format: 'open-question-studio', recordId: 'source-id', archived: true, tags: '保留标签', modelNames: {} } },
      ]
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['drafts', 'summaries'], 'readwrite')
        for (const row of rows) { tx.objectStore('drafts').put(row); tx.objectStore('summaries').put({ id: row.id, name: row.name, updatedAt: row.updatedAt, fieldCount: 1 }) }
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error)
      })
      db.close()
      localStorage.setItem('qf_activeDraftId', JSON.stringify('old-native'))
      localStorage.setItem('qf_reportsByTarget', JSON.stringify({ preserved: { draftId: 'old-native', text: '既有补填报告' } }))
    })
    await page.goto(base + '/app.html'); await ready(page)
    const migration = await page.evaluate(async () => {
      const native = await QFDB.get('old-native'), source = await QFDB.get('old-source')
      const file = native.attachments['doubao-screenshot-file-input'][0]
      return { native: { archived: native.archived, overwriteMode: native.overwriteMode, values: native.values, createdAt: native.createdAt, updatedAt: native.updatedAt }, sourceArchived: source.archived, sourceMode: source.overwriteMode, sourceMetadata: source.recordLibrary, file: { name: file.name, type: file.type, lastModified: file.lastModified, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) }, summaries: await QFDB.summaries() }
    })
    assert.equal(migration.native.archived, false)
    assert.equal(migration.native.overwriteMode, 'none')
    assert.equal(migration.sourceMode, 'all')
    assert.equal(migration.native.createdAt, 100000)
    assert.equal(migration.native.updatedAt, 100000)
    assert.equal(migration.sourceArchived, true)
    assert.equal(migration.sourceMetadata.archived, true)
    assert.equal(migration.file.name, '原截图.png')
    assert.equal(migration.file.lastModified, 1234567)
    assert.equal(migration.summaries.find(row => row.id === 'old-source').archived, true)
    assert.equal(await page.locator('#recordList .record-item').count(), 1)
    assert.equal(await page.locator('#activeRecordCount').innerText(), '1')
    assert.equal(await page.locator('#archivedRecordCount').innerText(), '1')

    // Archive saves pending edits and retains the record id, images, ranks and report.
    await page.locator('#f-question-input').fill('归档前刚刚编辑的问题')
    await page.locator('#archiveDraft').click()
    await page.waitForFunction(() => !document.getElementById('draftArchiveBadge').hidden && !document.getElementById('archiveDraft').disabled)
    assert.equal(await status(page, true).getAttribute('aria-pressed'), 'true')
    assert.equal(await page.locator('#recordList .record-item').count(), 2)
    const archived = await page.evaluate(async () => {
      const row = await QFDB.get('old-native'), image = row.attachments['doubao-screenshot-file-input'][0]
      return { archived: row.archived, question: row.values['question-input'], reply: row.values['doubao-markdown-input'], ranks: row.ranks, image: Array.from(new Uint8Array(await image.arrayBuffer())), reports: JSON.parse(localStorage.getItem('qf_reportsByTarget')) }
    })
    assert.equal(archived.archived, true)
    assert.equal(archived.question, '归档前刚刚编辑的问题')
    assert.equal(archived.reply, migration.native.values['doubao-markdown-input'])
    assert.deepEqual(archived.image, migration.file.bytes)
    assert.deepEqual(archived.ranks, { doubao: '1' })
    assert.equal(archived.reports.preserved.text, '既有补填报告')
    await page.reload(); await ready(page)
    assert.equal(await page.locator('#archiveDraft').innerText(), '恢复')

    // Restoring another record leaves the current selection intact.
    await card('old-source').getByRole('button', { name: '恢复', exact: true }).click()
    await page.waitForFunction(() => document.getElementById('activeRecordCount').textContent === '1' && !document.getElementById('archiveDraft').disabled)
    assert.equal(await page.locator('#draftSelect').inputValue(), 'old-native')
    assert.equal(await page.locator('#f-question-input').inputValue(), archived.question)
    await status(page, false).click()
    await card('old-source').getByRole('button', { name: /原JSON已归档题目/ }).click()
    await page.waitForFunction(() => document.getElementById('draftSelect').value === 'old-source' && !document.getElementById('archiveDraft').disabled)
    assert.equal(await page.locator('#draftArchiveBadge').isVisible(), false)
    assert.equal(await page.evaluate(async () => (await QFDB.get('old-source')).recordLibrary.archived), true)

    const downloadJob = page.waitForEvent('download')
    await page.locator('#exportDraft').click()
    const download = await downloadJob, singlePath = path.join(results, 'restored-single.json')
    await download.saveAs(singlePath)
    const single = JSON.parse(await fs.readFile(singlePath, 'utf8'))
    assert.equal(single.draft.archived, false)
    await upload(single)
    await page.locator('#toast').filter({ hasText: '已导入为一条新记录' }).waitFor()
    assert.equal(await page.locator('#draftArchiveBadge').isVisible(), false)
    const olderSingle = structuredClone(single); delete olderSingle.draft.archived
    await upload(olderSingle)
    await page.locator('#toast').filter({ hasText: '已导入为一条新记录' }).waitFor()
    await page.waitForFunction(() => !document.getElementById('draftArchiveBadge').hidden)
    const invalid = structuredClone(single); invalid.draft.archived = 'true'
    const beforeInvalid = await page.evaluate(async () => (await QFDB.summaries()).length)
    await upload(invalid)
    await page.locator('#toast').filter({ hasText: '归档状态无效' }).waitFor()
    assert.equal(await page.evaluate(async () => (await QFDB.summaries()).length), beforeInvalid)

    const packed = await page.evaluate(async () => {
      const rows = await QFDB.all(), packed = await QFPortable.pack(rows, document.getElementById('draftSelect').value), restored = await QFPortable.unpack(packed)
      return { packed, before: rows.map(row => ({ id: row.id, archived: row.archived })), restored: restored.map(row => ({ id: row.id, archived: row.archived })) }
    })
    assert.deepEqual(packed.restored, packed.before)
    await upload(packed.packed)
    await page.locator('#toast').filter({ hasText: '已合并导入' }).waitFor()
    assert.equal(await page.evaluate(async () => (await QFDB.summaries()).filter(row => row.archived).length), packed.before.filter(row => row.archived).length * 2)

    await page.locator('#newDraft').click()
    await page.locator('#toast').filter({ hasText: '已新建空白记录' }).waitFor()
    assert.equal(await status(page, false).getAttribute('aria-pressed'), 'true')
    const id = await page.locator('#draftSelect').inputValue()
    await page.evaluate(async id => { window._staleArchiveRow = structuredClone(await QFDB.get(id)); window._staleArchiveRow.values['question-input'] = '其他窗口保存的最新文字' }, id)
    const second = await context.newPage(); second.on('pageerror', error => errors.push(error.message))
    await second.goto(base + '/app.html'); await ready(second)
    assert.equal(await second.locator('#draftSelect').inputValue(), id)
    // A change arriving during another operation is processed after it finishes.
    await page.evaluate(() => { switching = true; syncQuickState() })
    await second.locator('#archiveDraft').click()
    await second.waitForFunction(() => !document.getElementById('draftArchiveBadge').hidden && !document.getElementById('archiveDraft').disabled)
    await page.evaluate(() => { switching = false; syncQuickState() })
    await page.waitForFunction(() => !document.getElementById('draftArchiveBadge').hidden && !document.getElementById('archiveDraft').disabled)
    await page.evaluate(() => QFDB.put(window._staleArchiveRow))
    assert.equal(await page.evaluate(async id => (await QFDB.get(id)).archived, id), true)
    await second.locator('#archiveDraft').click()
    await page.waitForFunction(() => document.getElementById('draftArchiveBadge').hidden && !document.getElementById('archiveDraft').disabled)
    assert.equal(await second.locator('#f-question-input').inputValue(), '其他窗口保存的最新文字')
    assert.equal(await page.evaluate(async id => (await QFDB.get(id)).archived, id), false)
    await second.close()

    // Existing archived-record deletion retains the current unarchived record.
    await status(page, true).click()
    page.once('dialog', dialog => dialog.accept())
    await card('old-native').getByRole('button', { name: '删除', exact: true }).click()
    await page.locator('#toast').filter({ hasText: '已删除“待归档的旧记录”' }).waitFor()
    assert.equal(await page.locator('#draftSelect').inputValue(), id)
    assert.equal(await page.evaluate(() => QFDB.get('old-native')), undefined)
    assert.ok(await page.evaluate(() => QFDB.get('old-source')))

    const zipJob = page.waitForEvent('download')
    await page.locator('#exportPortable').click()
    const zip = await zipJob
    await zip.saveAs(path.join(results, 'archive-migration.zip'))
    assert.ok((await fs.stat(path.join(results, 'archive-migration.zip'))).size > 10000)
    await page.screenshot({ path: path.join(root, 'test-results', 'fill-helper-archive.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('#toggleRecords').click()
    await page.waitForFunction(() => document.querySelector('.records-sidebar').getBoundingClientRect().left < window.innerWidth - 100)
    assert.equal(await status(page, true).isVisible(), true)
    assert.equal(await status(page, false).isVisible(), true)
    await page.screenshot({ path: path.join(root, 'test-results', 'fill-helper-archive-narrow.png') })
    assert.deepEqual(errors, [])
    console.log('Plugin archive passed: v3 database migration with original images, archive/restore and counters, pending edits, native/portable backups, legacy-source status fallback, invalid flags, multi-window synchronization and stale-save protection, deletion and narrow sidebar.')
    console.log('Archive migration ZIP:', path.join(results, 'archive-migration.zip'))
  } finally {
    if (browser) await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
