const { _electron: electron } = require('playwright')
const path = require('path')
const fs = require('fs/promises')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('url')
const { createStorage } = require('../electron/storage.cjs')

async function main() {
  const root = path.resolve(__dirname, '..')
  const dataDir = path.join(root, 'test-results', 'model-defaults-data')
  await fs.rm(dataDir, { recursive: true, force: true })
  const { createRecord } = await import(pathToFileURL(path.join(root, 'src', 'domain.js')).href)
  const record = createRecord()
  record.models.doubao.actualName = ''; record.models.doubao.mode = ' \n '
  record.models.gpt.actualName = ' 自定义名称 '; record.models.gpt.mode = ' 自定义模式 '
  record.models.opus.actualName = ' '; record.models.opus.mode = ''
  await createStorage(dataDir).save({ version: 2, records: [record] })
  const env = { ...process.env, OQS_TEST_DATA: dataDir, OQS_USE_BUILD: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: [root], executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), env })
  try {
    const page = await app.firstWindow()
    await page.getByLabel('豆包专家实际名称', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('豆包专家实际名称', { exact: true }).inputValue(), '豆包专家')
    assert.equal(await page.getByLabel('豆包专家模式', { exact: true }).count(), 0)
    assert.equal(await page.getByLabel('Opus 4.6实际名称', { exact: true }).inputValue(), 'Opus 4.6')
    assert.equal(await page.getByLabel('Opus 4.6模式', { exact: true }).count(), 0)
    assert.equal(await page.getByLabel('GPT-5.6-Sol实际名称', { exact: true }).inputValue(), ' 自定义名称 ')
    assert.equal(await page.getByLabel('GPT-5.6-Sol模式', { exact: true }).count(), 0)
    await page.locator('.missing-notice summary').click()
    assert.doesNotMatch(await page.locator('.missing-fields').innerText(), /实际名称| · 模式/)
    const loaded = JSON.parse(await fs.readFile(path.join(dataDir, 'records.json'), 'utf8'))
    assert.equal(loaded.records[0].models.doubao.actualName, '豆包专家')
    assert.equal(loaded.records[0].models.opus.mode, undefined)
    assert.equal(loaded.records[0].updatedAt, record.updatedAt)
    await page.getByLabel('豆包专家实际名称', { exact: true }).fill(' ')
    await page.getByLabel('豆包专家总体结果', { exact: true }).focus()
    assert.equal(await page.getByLabel('豆包专家实际名称', { exact: true }).inputValue(), '豆包专家')
    const saved = await page.evaluate(async () => {
      const data = await window.desktopApi.loadData()
      data.records[0].models.opus.actualName = ''; data.records[0].models.opus.mode = ''
      await window.desktopApi.saveData(data)
      return window.desktopApi.loadData()
    })
    assert.equal(saved.records[0].models.opus.actualName, 'Opus 4.6')
    assert.equal(saved.records[0].models.opus.mode, undefined)
    assert.equal(saved.records[0].models.gpt.mode, undefined)
    console.log('Existing records and direct saves get model name defaults; custom names preserved and mode removed.')
  } finally { await app.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
