const { _electron: electron } = require('playwright')
const fs = require('fs/promises'), path = require('path'), assert = require('node:assert/strict')
const { collectImages } = require('../electron/storage.cjs')
const { readBackupFile } = require('../electron/backup.cjs')
async function main() {
  const root = path.resolve(__dirname, '..'), proof = JSON.parse(await fs.readFile(path.join(root, 'test-results/large-backup-verification.json'), 'utf8'))
  assert.ok(proof.bytes > require('buffer').constants.MAX_STRING_LENGTH, 'fixture must exceed the V8 string limit')
  const dataDir = await fs.mkdtemp(path.join(root, 'test-results/large-import-')), cacheRoot = path.join(dataDir, '.app-cache')
  const env = { ...process.env, OQS_TEST_DATA: dataDir, OQS_USE_BUILD: '1' }; delete env.ELECTRON_RUN_AS_NODE
  const executable = process.env.OQS_TEST_EXECUTABLE
  const app = await electron.launch({ args: executable ? [] : [root], executablePath: executable || path.join(root, 'node_modules/electron/dist/electron.exe'), env })
  const stages = async () => (await fs.readdir(cacheRoot)).filter(name => name.startsWith('backup-import-'))
  const waitClean = async () => { for (let attempt = 0; attempt < 100; attempt++) { if (!(await stages()).length) return; await new Promise(resolve => setTimeout(resolve, 50)) } throw Error('Import staging was not cleaned') }
  try {
    const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message))
    await page.locator('.main-workspace').waitFor()
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, proof.filePath)
    await page.getByRole('button', { name: '导入备份', exact: true }).first().click()
    await page.getByRole('button', { name: '合并导入', exact: true }).waitFor({ timeout: 120000 })
    assert.equal((await page.evaluate(() => desktopApi.loadData())).records.length, 0)
    assert.equal((await fs.readdir(path.join(dataDir, 'attachments'))).length, 0)
    assert.equal((await stages()).length, 1)
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click(); await waitClean()
    console.log('Large import preview/cancel: source and target records unchanged, temporary screenshots cleaned')
    await page.getByRole('button', { name: '导入备份', exact: true }).first().click()
    await page.getByRole('button', { name: '合并导入', exact: true }).waitFor({ timeout: 120000 })
    await page.getByRole('button', { name: '合并导入', exact: true }).click()
    await page.getByText(`已导入 ${proof.records} 条新记录，跳过 0 条同编号记录。`, { exact: true }).waitFor({ timeout: 120000 })
    await waitClean()
    const actual = JSON.parse(await fs.readFile(path.join(dataDir, 'records.json'), 'utf8'))
    assert.equal(actual.records.length, proof.records)
    let imageCount = 0
    for (const record of actual.records) for (const image of collectImages(record)) { assert.ok((await fs.stat(path.join(dataDir, 'attachments', image.fileName))).size > 0); assert.equal(image.dataUrl, undefined); imageCount++ }
    assert.equal(imageCount, proof.imageReferences)
    const destination = path.join(dataDir, 'large-export.json')
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, destination)
    await page.evaluate(() => { window.__backupProgress = []; desktopApi.onBackupProgress(progress => window.__backupProgress.push(progress)) })
    await page.getByRole('button', { name: '导出备份', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '开始导出', exact: true }).click()
    await page.getByText(`全部记录备份已导出，共 ${proof.records} 条，包含完整文本和截图。`, { exact: true }).waitFor({ timeout: 120000 })
    assert.ok((await fs.stat(destination)).size > require('buffer').constants.MAX_STRING_LENGTH)
    assert.deepEqual(await page.evaluate(() => window.__backupProgress.at(-1)), { completed: proof.records, total: proof.records })
    let exportedImages = 0
    const exported = await readBackupFile(destination, record => { for (const image of collectImages(record)) { assert.ok(image.dataUrl.startsWith('data:image/')); exportedImages++; delete image.dataUrl } return record })
    assert.equal(exported.records.length, proof.records); assert.equal(exportedImages, proof.imageReferences)
    assert.deepEqual(errors, [])
    console.log(`PASS large JSON restored and exported through desktop UI: ${actual.records.length} records / ${imageCount} screenshots, progress reached 100%`)
  } finally { await app.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
