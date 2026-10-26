const { _electron: electron } = require('playwright')
const path = require('path')
const fs = require('fs/promises')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('url')

async function main() {
  const root = path.resolve(__dirname, '..')
  const dataDir = await fs.mkdtemp(path.join(root, 'test-results', 'import-drag-'))
  const { createRecord, MODELS } = await import(pathToFileURL(path.join(root, 'src', 'domain.js')).href)
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2HsAAAAASUVORK5CYII='
  const fixture = version => {
    const record = createRecord()
    record.title = `v${version} imported`; record.type = 'How-to 类'; record.prompt = 'Original prompt'; record.insight = 'Original insight'; record.criteriaText = 'Original criteria'; record.acceptanceResult = '通过'; record.notes = 'Cancelled notes'
    for (const model of MODELS) Object.assign(record.models[model.id], { mode: 'Cancelled mode', source: 'Cancelled source', networkStatus: '已开启', contextMode: 'Cancelled Context', collectionNote: 'Cancelled collection', actualName: model.name, response: `# ${model.id}\n\n**Original Markdown**`, result: '达成', note: `Original note ${model.id}`, screenshots: [{ id: crypto.randomUUID(), name: `${model.id}.png`, dataUrl: png }] })
    record.quality = { enabled: true, ranking: '模型1 = 模型2 = 模型3 ＞ 模型4 = 模型5', rankingExplanation: 'Original ranking explanation', verificationNotes: 'Cancelled verification', matrixText: 'Cancelled matrix' }
    if (version === 2) { delete record.models.model4; delete record.models.model5; delete record.quality }
    return record
  }
  const fixtures = [2, 3].map(version => ({ version, record: fixture(version) }))
  const env = { ...process.env, OQS_TEST_DATA: dataDir, OQS_USE_BUILD: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  const options = { args: [root], executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), env }
  let app = await electron.launch(options)
  try {
    let page = await app.firstWindow()
    await page.locator('.main-workspace').waitFor()
    for (const { version, record } of fixtures) {
      const importPath = path.join(dataDir, `legacy-${version}.json`)
      await fs.writeFile(importPath, JSON.stringify({ version, records: [record] }), 'utf8')
      await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, importPath)
      await page.locator('.backup-actions').getByRole('button', { name: '导入备份', exact: true }).click()
      await page.getByRole('button', { name: '合并导入', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      await page.locator('.record-list').getByRole('button', { name: new RegExp(record.title) }).waitFor()
      await page.locator('.save-indicator.saved').waitFor()
      await page.getByText('已导入 1 条新记录，跳过 0 条同编号记录。', { exact: true }).waitFor()
      await page.waitForFunction(async id => (await window.desktopApi.loadData()).records.some(record => record.id === id), record.id)
      const loaded = await page.evaluate(() => window.desktopApi.loadData())
      const migrated = loaded.records.find(value => value.id === record.id)
      assert.ok(migrated, JSON.stringify({ version, expected: record.id, actual: loaded.records.map(value => value.id) }))
      assert.equal(loaded.version, 4)
      for (const key of ['title', 'type', 'prompt', 'insight', 'criteriaText', 'acceptanceResult', 'createdAt', 'updatedAt']) assert.equal(migrated[key], record[key])
      assert.equal(migrated.notes, undefined)
      for (const [id, original] of Object.entries(record.models)) {
        const model = migrated.models[id]
        for (const key of ['actualName', 'response', 'result', 'note']) assert.equal(model[key], original[key])
        for (const key of ['mode', 'source', 'networkStatus', 'contextMode', 'collectionNote']) assert.equal(model[key], undefined)
        assert.equal(model.screenshots[0].dataUrl, undefined)
        assert.equal(await fs.readFile(path.join(dataDir, 'attachments', model.screenshots[0].fileName), 'base64'), png.split(',')[1])
      }
      if (version === 3) assert.deepEqual(migrated.quality, { enabled: true, ranking: record.quality.ranking, rankingExplanation: record.quality.rankingExplanation })
    }
    await page.locator('.record-list').getByRole('button', { name: /v3 imported/ }).click()
    assert.equal(await page.getByLabel('核心考点的达成性排序', { exact: true }).inputValue(), fixtures[1].record.quality.ranking)
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      contents.__dragCalls = []
      contents.startDrag = options => contents.__dragCalls.push({ file: options.file, size: options.icon.getSize(), empty: options.icon.isEmpty() })
    })
    for (const model of MODELS) {
      const preview = page.locator(`#section-${model.id} .image-preview`)
      assert.equal(await preview.getAttribute('draggable'), 'true')
      await preview.dispatchEvent('dragstart')
      await page.waitForFunction(() => !document.querySelector('.toast.error'))
      await expectDragCall(app, model.id)
    }
    const calls = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.__dragCalls)
    assert.equal(calls.length, 5)
    for (const call of calls) {
      assert.ok(call.file.includes('drag-exports'))
      assert.equal(call.empty, false)
      assert.equal(await fs.readFile(call.file, 'base64'), png.split(',')[1])
    }
    await page.evaluate(() => window.desktopApi.startImageDrag({ fileName: '../records.json' }))
    await page.getByText('拖出图片失败：无效的截图文件名。', { exact: true }).waitFor()
    assert.equal((await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.__dragCalls)).length, 5)
    await page.getByRole('button', { name: '导出备份', exact: true }).click({ trial: true })
    const backupPath = path.join(dataDir, 'new-backup.json')
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, backupPath)
    await page.getByRole('button', { name: '导出备份', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '开始导出', exact: true }).click()
    await page.getByText(/^全部记录备份已导出，共 \d+ 条，包含完整文本和截图。$/).waitFor()
    const backup = JSON.parse(await fs.readFile(backupPath, 'utf8'))
    assert.equal(backup.version, 4)
    assert.ok(backup.records.every(record => !('notes' in record) && !('matrixText' in record.quality)))
    for (const record of backup.records) for (const model of Object.values(record.models)) {
      assert.equal(model.mode, undefined)
      for (const image of model.screenshots) assert.equal(image.dataUrl, png)
    }
    await app.close()
    app = await electron.launch(options); page = await app.firstWindow()
    await page.getByPlaceholder('记录标题').waitFor()
    const restarted = await page.evaluate(() => window.desktopApi.loadData())
    assert.equal(restarted.records.length, 2)
    await page.locator('.record-list').getByRole('button', { name: /v3 imported/ }).click()
    await page.waitForFunction(() => [...document.querySelectorAll('.image-preview img')].every(image => image.complete && image.naturalWidth > 0))
    console.log('v2/v3 complete JSON imports retain text, model replies/results/notes/rankings/images, drop cancelled fields; all five thumbnails invoke native file dragging with protected exact-byte copies; export and restart pass.')
  } finally { await app.close() }
}

async function expectDragCall(app, id) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const found = await app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.__dragCalls.some(call => call.file.endsWith(name)), `${id}.png`)
    if (found) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Native drag was not called for ${id}`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
