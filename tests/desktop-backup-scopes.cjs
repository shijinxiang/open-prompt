const { _electron: electron } = require('playwright')
const path = require('path')
const fs = require('fs/promises')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('url')
const { createStorage } = require('../electron/storage.cjs')

async function main() {
  const root = path.resolve(__dirname, '..')
  await fs.mkdir(path.join(root, 'test-results'), { recursive: true })
  const dataDir = await fs.mkdtemp(path.join(root, 'test-results', 'backup-scopes-'))
  const storage = createStorage(dataDir)
  const { createRecord, validateBackup } = await import(pathToFileURL(path.join(root, 'src', 'domain.js')).href)
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2HsAAAAASUVORK5CYII='
  const records = []
  for (const [index, archived] of [false, true, false].entries()) {
    const record = createRecord()
    record.title = `范围测试-${index}`
    record.prompt = `完整问题-${index}`
    record.archived = archived
    const image = { ...await storage.saveAttachment({ dataUrl: png, originalName: `${index}.png` }), id: crypto.randomUUID(), name: `${index}.png` }
    record.attachments.push(structuredClone(image))
    for (const model of Object.values(record.models)) {
      model.response = `完整回复-${index}`
      model.screenshots.push(structuredClone(image))
    }
    records.push(record)
  }
  await storage.save({ version: 4, records })
  const env = { ...process.env, OQS_TEST_DATA: dataDir, OQS_USE_BUILD: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  const packagedExecutable = process.env.OQS_TEST_EXECUTABLE
  const app = await electron.launch({
    args: packagedExecutable ? [] : [root],
    executablePath: packagedExecutable || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), env,
  })
  const errors = []
  try {
    const page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    await page.getByPlaceholder('记录标题').waitFor()
    // Include an edit made just before export, while hiding every record with search.
    await page.getByPlaceholder('记录标题').fill('刚编辑的记录')
    await page.getByLabel('搜索记录').fill('不存在的搜索结果')
    assert.equal(await page.locator('.record-item').count(), 0)
    const open = async () => {
      await page.getByRole('button', { name: '导出备份', exact: true }).click()
      const dialog = page.getByRole('dialog')
      assert.equal(await dialog.getByRole('radio', { name: '全部记录', exact: true }).isChecked(), true)
      assert.equal(await dialog.getByRole('radio').count(), 4)
      return dialog
    }
    let dialog = await open()
    assert.deepEqual(await dialog.locator('.backup-scope-option b').allTextContents(), ['3 条', '2 条', '1 条', '已选 0 条'])
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    assert.equal(await page.getByRole('dialog').count(), 0)

    // Canceling the native save picker keeps the chosen scope available for retry.
    dialog = await open()
    await dialog.getByRole('radio', { name: '未归档', exact: true }).check()
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }) })
    await dialog.getByRole('button', { name: '开始导出', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.modal-actions .primary').disabled)
    assert.equal(await dialog.getByRole('radio', { name: '未归档', exact: true }).isChecked(), true)
    await dialog.getByRole('button', { name: '取消', exact: true }).click()

    const expectedRecords = (await storage.load()).records
    assert.equal(expectedRecords[0].title, '刚编辑的记录')
    for (const [label, archived] of [['全部记录', null], ['未归档', false], ['已归档', true]]) {
      const filePath = path.join(dataDir, `${label}.json`)
      await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, filePath)
      dialog = await open()
      await dialog.getByRole('radio', { name: label, exact: true }).check()
      const selected = archived === null ? expectedRecords : expectedRecords.filter(record => record.archived === archived)
      assert.equal(await dialog.locator('.backup-summary').innerText(), `将导出 ${selected.length} 条记录。`)
      await dialog.getByRole('button', { name: '开始导出', exact: true }).click()
      await page.getByText(`${label}备份已导出，共 ${selected.length} 条，包含完整文本和截图。`, { exact: true }).waitFor()
      const backup = JSON.parse(await fs.readFile(filePath, 'utf8'))
      validateBackup(backup)
      const expected = await storage.createBackup({ version: 4, records: selected })
      assert.deepEqual(backup.records, expected.records)
      assert.equal(await page.getByRole('dialog').count(), 0)
      assert.deepEqual((await storage.load()).records, expectedRecords)
    }

    // A failed write leaves the selection available and reports the actual error.
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, path.join(dataDir, 'missing-directory', 'backup.json'))
    dialog = await open()
    await dialog.getByRole('radio', { name: '已归档', exact: true }).check()
    await dialog.getByRole('button', { name: '开始导出', exact: true }).click()
    await page.locator('.toast.error').waitFor()
    assert.equal(await dialog.getByRole('radio', { name: '已归档', exact: true }).isChecked(), true)
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    assert.deepEqual((await storage.load()).records, expectedRecords)

    // Verify both empty categories and an entirely empty library.
    for (const [remaining, emptyLabel] of [[records.filter(record => !record.archived), '已归档'], [records.filter(record => record.archived), '未归档'], [[], '全部记录']]) {
      await page.evaluate(records => window.desktopApi.saveData({ version: 4, records }), remaining)
      await page.reload()
      await page.locator('.main-workspace').waitFor()
      dialog = await open()
      await dialog.getByRole('radio', { name: emptyLabel, exact: true }).check()
      assert.equal(await dialog.getByRole('button', { name: '开始导出', exact: true }).isDisabled(), true)
      assert.match(await dialog.locator('.backup-summary').innerText(), /暂无记录/)
      await dialog.getByRole('button', { name: '取消', exact: true }).click()
    }

    // Check the new dialog with the existing theme and maximum font settings.
    await page.evaluate(async records => {
      await window.desktopApi.saveData({ version: 4, records })
      await window.desktopApi.saveSettings({ theme: 'dark', fontSize: 20 })
    }, expectedRecords)
    await page.reload()
    await page.locator('.main-workspace').waitFor()
    await page.waitForFunction(() => document.documentElement.dataset.fontSize === '20')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720))
    dialog = await open()
    await page.screenshot({ path: path.join(root, 'test-results', 'backup-scopes-dark.png') })
    assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth), false)
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await page.evaluate(() => window.desktopApi.saveSettings({ theme: 'light', fontSize: 14 }))
    await page.reload()
    await page.locator('.main-workspace').waitFor()
    await page.waitForFunction(() => document.documentElement.dataset.fontSize === '14')
    await open()
    await page.screenshot({ path: path.join(root, 'test-results', 'backup-scopes.png') })
    assert.deepEqual(errors, [])
    console.log('Backup scopes: all/active/archived, full images, pending edits, search independence, cancel/retry, errors, empty ranges and themes passed')
  } finally { await app.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
