const { _electron: electron } = require('playwright')
const path = require('path')
const fs = require('fs/promises')
const assert = require('node:assert/strict')
const { createStorage } = require('../electron/storage.cjs')

async function main() {
  const root = path.resolve(__dirname, '..')
  const dataDir = path.join(root, 'test-results', 'upgrade-data')
  await fs.rm(dataDir, { recursive: true, force: true })
  const storage = createStorage(dataDir)
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2HsAAAAASUVORK5CYII='
  const image = { ...await storage.saveAttachment({ dataUrl, originalName: 'old.png' }), id: crypto.randomUUID(), name: 'old.png' }
  const now = new Date().toISOString()
  const criterion = { id: crypto.randomUUID(), text: '旧版考点必要条件', decisive: true }
  const record = {
    id: crypto.randomUUID(), title: '旧版完整资料', type: '分析决策类', field: '计算机', tags: 'old', prompt: '原问题', insight: '原洞察', criteria: [criterion], attachments: [],
    models: Object.fromEntries(['doubao', 'gpt', 'opus'].map(id => [id, { actualName: id, mode: 'mode', response: `${id}原始回复`, screenshots: [structuredClone(image)], note: `${id}原备注`, judgments: { [criterion.id]: { result: id === 'doubao' ? '未达成' : '达成', evidence: `${id}旧证据` } }, testedAt: now, ruleVersion: 1, humanized: true }])),
    frozen: true, humanized: true, ruleVersion: 1, archived: false, createdAt: now, updatedAt: now, revisions: [],
  }
  record.revisions.push({ version: 1, frozenAt: now, type: record.type, prompt: record.prompt, insight: record.insight, criteria: structuredClone(record.criteria), reason: '原修订记录', modelResults: structuredClone(record.models) })
  await storage.save({ version: 1, records: [record] })
  const oldContent = await fs.readFile(storage.dataFile, 'utf8')
  const env = { ...process.env, OQS_TEST_DATA: dataDir, OQS_USE_BUILD: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: [root], executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), env })
  try {
    const page = await app.firstWindow()
    await page.getByPlaceholder('核心考点全文').waitFor()
    assert.equal(await page.getByLabel('决定性核心考点', { exact: true }).inputValue(), '考点1（决定性核心考点）：旧版考点必要条件')
    assert.equal(await page.getByLabel('豆包专家总体结果', { exact: true }).inputValue(), '未达成')
    assert.equal(await page.getByLabel('验收结果', { exact: true }).inputValue(), '通过')
    assert.equal(await page.getByLabel('决定性核心考点', { exact: true }).isEnabled(), true)
    assert.equal(await page.getByLabel('非决定性核心考点', { exact: true }).inputValue(), '')
    assert.equal(await fs.readFile(path.join(dataDir, 'records-before-v4.json'), 'utf8'), oldContent)
    assert.equal(JSON.parse(await fs.readFile(storage.dataFile, 'utf8')).version, 4)
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('button', { name: '旧版资料', exact: true }).click()
    const text = await page.locator('.export-preview').innerText()
    assert.ok(text.includes('doubao旧证据'))
    assert.ok(text.includes('原修订记录'))
    assert.ok(text.includes('opus原始回复'))
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
    await page.waitForFunction(() => [...document.querySelectorAll('.image-preview img')].every(img => img.complete && img.naturalWidth > 0))
    const backupPath = path.join(root, 'test-results', 'upgraded-backup.json')
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, backupPath)
    await page.getByRole('button', { name: '导出备份', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '开始导出', exact: true }).click()
    await page.getByText(/^全部记录备份已导出，共 \d+ 条，包含完整文本和截图。$/).waitFor()
    const backup = JSON.parse(await fs.readFile(backupPath, 'utf8'))
    assert.equal(backup.records[0].legacy.revisions[0].modelResults.opus.screenshots[0].dataUrl, dataUrl)
    assert.equal(backup.records[0].models.gpt.screenshots[0].dataUrl, dataUrl)
    console.log('Automatic legacy upgrade, original backup, editable fields, historical evidence and image export: passed')
  } finally { await app.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
