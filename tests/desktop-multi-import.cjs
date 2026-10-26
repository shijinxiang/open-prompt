const { _electron: electron } = require('playwright')
const fs = require('fs/promises'), path = require('path'), assert = require('node:assert/strict')
const { createStorage, collectImages } = require('../electron/storage.cjs')

async function main() {
  const root = path.resolve(__dirname, '..'), dataDir = await fs.mkdtemp(path.join(root, 'test-results/multi-import-')), storage = createStorage(dataDir)
  const { createRecord } = await import('../src/domain.js')
  const folderA = path.join(dataDir, '第一次选择的文件夹'), folderB = path.join(dataDir, '另一个导入文件夹')
  await fs.mkdir(folderA); await fs.mkdir(folderB)
  const a = createRecord(), b = createRecord(), c = createRecord(), d = createRecord()
  a.title = '已有记录必须保留'; a.prompt = '原有题目'
  b.title = '第一份内容优先'; b.prompt = '第一份题目正文'; b.models.model4.response = '完整模型4回复'; b.quality.enabled = true
  c.title = '第二份中的已归档记录'; c.archived = true; c.prompt = '已归档也正确导入'
  d.title = '坏批次不得部分导入'; d.prompt = '只在整批有效时导入'
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2HsAAAAASUVORK5CYII='
  for (const row of [b, c, d]) row.models.doubao.screenshots.push({ id: crypto.randomUUID(), name: '导入截图.png', dataUrl: png })
  const firstFile = path.join(folderA, '第一份.json'), secondFile = path.join(folderA, '第二份.json'), nextFile = path.join(folderB, '下次备份.json'), badFile = path.join(folderA, '损坏的备份.json'), validBeforeBad = path.join(folderA, '批次中有效的备份.json')
  await fs.writeFile(firstFile, JSON.stringify({ version: 4, records: [{ ...a, title: '不得覆盖已有题目' }, b] }))
  await fs.writeFile(secondFile, JSON.stringify({ version: 4, records: [{ ...b, title: '后续文件不得覆盖', prompt: '错误的后续内容' }, c] }))
  await fs.writeFile(nextFile, JSON.stringify({ version: 4, records: [d] })); await fs.writeFile(validBeforeBad, JSON.stringify({ version: 4, records: [d] })); await fs.writeFile(badFile, '{"records":[')
  await storage.save({ version: 4, records: [a] })
  const env = { ...process.env, OQS_TEST_DATA: dataDir, OQS_USE_BUILD: '1' }; delete env.ELECTRON_RUN_AS_NODE
  const executable = process.env.OQS_TEST_EXECUTABLE
  const launch = () => electron.launch({ args: executable ? [] : [root], executablePath: executable || path.join(root, 'node_modules/electron/dist/electron.exe'), env })
  let app = await launch()
  const stages = async () => (await fs.readdir(path.join(dataDir, '.app-cache'))).filter(name => name.startsWith('backup-import-'))
  const waitClean = async () => { for (let attempt = 0; attempt < 100; attempt++) { if (!(await stages()).length) return; await new Promise(resolve => setTimeout(resolve, 30)) } throw Error('Temporary import stage not cleaned') }
  let errors = []
  const mock = (paths, canceled = false) => app.evaluate(({ dialog }, result) => { dialog.showOpenDialog = async (_window, options) => { globalThis.__lastImportDialog = options; return { canceled: result.canceled, filePaths: result.paths } } }, { paths, canceled })
  const options = () => app.evaluate(() => globalThis.__lastImportDialog)
  try {
    let page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.getByPlaceholder('记录标题').waitFor()
    const open = () => page.getByRole('button', { name: '导入备份', exact: true }).first().click()
    await mock([firstFile, secondFile]); await open(); await page.getByRole('button', { name: '合并导入', exact: true }).waitFor()
    assert.ok((await options()).properties.includes('multiSelections')); assert.equal((await options()).defaultPath, undefined)
    let preview = page.getByRole('dialog')
    assert.ok((await preview.innerText()).includes('2 个文件')); assert.ok((await preview.innerText()).includes('将新增 2 条，跳过 2 条'))
    assert.deepEqual(await preview.locator('.import-file-list span').allTextContents(), ['第一份.json', '第二份.json'])
    assert.equal((await storage.load()).records.length, 1)
    await preview.getByRole('button', { name: '合并导入', exact: true }).click(); await page.getByText('已导入 2 条新记录，跳过 2 条同编号记录。', { exact: true }).waitFor(); await waitClean()
    let saved = await storage.load(); assert.equal(saved.records.length, 3); assert.deepEqual(saved.records.find(row => row.id === a.id), a)
    assert.equal(saved.records.find(row => row.id === b.id).title, b.title); assert.equal(saved.records.find(row => row.id === b.id).prompt, b.prompt)
    assert.equal(saved.records.find(row => row.id === b.id).models.model4.response, b.models.model4.response); assert.equal(saved.records.find(row => row.id === c.id).archived, true)
    for (const row of saved.records) for (const image of collectImages(row)) assert.deepEqual(await fs.readFile(path.join(storage.attachments, image.fileName)), Buffer.from(png.split(',')[1], 'base64'))
    const before = await fs.readFile(storage.dataFile), attachments = await fs.readdir(storage.attachments)
    await mock([], true); await open(); await page.waitForFunction(() => !document.querySelector('.backup-actions button:last-child').disabled)
    assert.equal((await options()).defaultPath, folderA); assert.equal(await page.getByRole('dialog').count(), 0)
    await mock([nextFile]); await open(); await page.getByRole('button', { name: '合并导入', exact: true }).waitFor(); assert.equal((await options()).defaultPath, folderA)
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click(); await waitClean()
    assert.deepEqual(await fs.readFile(storage.dataFile), before); assert.deepEqual(await fs.readdir(storage.attachments), attachments)
    await mock([], true); await open(); await page.waitForFunction(() => !document.querySelector('.backup-actions button:last-child').disabled); assert.equal((await options()).defaultPath, folderB)
    await mock([validBeforeBad, badFile]); await open(); await page.locator('.toast.error').filter({ hasText: '损坏的备份.json' }).waitFor(); await waitClean()
    assert.deepEqual(await fs.readFile(storage.dataFile), before); assert.deepEqual(await fs.readdir(storage.attachments), attachments)
    await app.close(); app = await launch(); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.getByPlaceholder('记录标题').waitFor()
    await mock([], true); await page.getByRole('button', { name: '导入备份', exact: true }).first().click(); await page.waitForFunction(() => !document.querySelector('.backup-actions button:last-child').disabled)
    assert.equal((await options()).defaultPath, folderA)
    await mock([firstFile, secondFile]); await page.getByRole('button', { name: '导入备份', exact: true }).first().click(); await page.getByRole('button', { name: '合并导入', exact: true }).waitFor()
    await page.screenshot({ path: path.join(dataDir, 'multiple-import-preview.png') })
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click(); await waitClean(); assert.deepEqual(errors, [])
    console.log('PASS multiple JSON import: per-file preview, cross-file/library duplicates, exact screenshots, all-or-none validation, cancel cleanup, folder change and restart persistence')
    console.log('Preview screenshot:', path.join(dataDir, 'multiple-import-preview.png'))
  } finally { await app.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
