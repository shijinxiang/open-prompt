const { _electron: electron } = require('playwright')
const fs = require('fs/promises'), path = require('path'), zlib = require('zlib'), assert = require('node:assert/strict')
const { createStorage } = require('../electron/storage.cjs')

function png(width, height) {
  const crc = buffer => { let value = 0xffffffff; for (const byte of buffer) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0) } return (value ^ 0xffffffff) >>> 0 }
  const chunk = (name, data) => { const type = Buffer.from(name), header = Buffer.alloc(4), tail = Buffer.alloc(4); header.writeUInt32BE(data.length); tail.writeUInt32BE(crc(Buffer.concat([type, data]))); return Buffer.concat([header, type, data, tail]) }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
  const data = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const offset = y * (width * 3 + 1) + 1 + x * 3; const grid = x % 100 < 3 || y % 100 < 3; data[offset] = grid ? 35 : 210 + x % 40; data[offset + 1] = grid ? 120 : 220 + y % 30; data[offset + 2] = grid ? 115 : 245 }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(data)), chunk('IEND', Buffer.alloc(0))])
}
async function main() {
  const root = path.resolve(__dirname, '..'), dataDir = await fs.mkdtemp(path.join(root, 'test-results/workspace-')), storage = createStorage(dataDir)
  const { createRecord, exportQuestionsText } = await import('../src/domain.js')
  const records = Array.from({ length: 3 }, (_, index) => ({ ...createRecord(), title: `PRIVATE-TITLE-${index}`, archived: index === 1, prompt: index === 0 ? '题目一：保留问题原文。\n第二段😀' : index === 1 ? '题目二：已归档的问题。' : '', insight: 'PRIVATE-INSIGHT', criteriaText: 'PRIVATE-CRITERIA' }))
  const originals = [png(1600, 1200), png(600, 900)]
  for (const [index, buffer] of originals.entries()) records[0].models.doubao.screenshots.push({ id: crypto.randomUUID(), name: `缩放测试${index + 1}.png`, ...await storage.saveAttachment({ dataUrl: 'data:image/png;base64,' + buffer.toString('base64'), originalName: 'zoom.png' }) })
  records[0].models.doubao.response = 'PRIVATE-ANSWER'
  records[2].models.doubao.screenshots.push({ id: crypto.randomUUID(), name: '缺失的截图.png', fileName: 'missing.png' })
  await storage.save({ version: 4, records })
  const env = { ...process.env, OQS_TEST_DATA: dataDir, OQS_USE_BUILD: '1' }; delete env.ELECTRON_RUN_AS_NODE
  const executable = process.env.OQS_TEST_EXECUTABLE
  const app = await electron.launch({ args: executable ? [] : [root], executablePath: executable || path.join(root, 'node_modules/electron/dist/electron.exe'), env })
  try {
    const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message))
    await page.getByPlaceholder('记录标题').waitFor()
    assert.ok((await page.locator('.topbar').boundingBox()).height <= 56)
    assert.ok((await page.locator('.summary-strip').boundingBox()).height <= 50)
    const header = page.locator('.topbar')
    const detailWidth = (await page.locator('.detail-panel').boundingBox()).width
    await header.getByRole('button', { name: '收起侧边栏', exact: true }).click(); assert.equal(await page.locator('.sidebar').isVisible(), false)
    assert.ok((await page.locator('.detail-panel').boundingBox()).width > detailWidth + 150)
    await page.reload(); await page.getByPlaceholder('记录标题').waitFor(); assert.equal(await page.locator('.sidebar').isVisible(), false)
    await header.getByRole('button', { name: '展开侧边栏', exact: true }).click()
    await header.getByRole('button', { name: '收起记录列表', exact: true }).click(); assert.equal(await page.locator('.record-panel').isVisible(), false)
    await header.getByRole('button', { name: '展开记录列表', exact: true }).click()
    const separator = page.getByRole('separator', { name: '调整记录列表宽度' }), beforeWidth = (await page.locator('.record-panel').boundingBox()).width, splitBox = await separator.boundingBox()
    await page.mouse.move(splitBox.x + 3, splitBox.y + 100); await page.mouse.down(); await page.mouse.move(splitBox.x + 65, splitBox.y + 100, { steps: 5 }); await page.mouse.up()
    assert.ok((await page.locator('.record-panel').boundingBox()).width > beforeWidth + 50)
    await separator.focus(); await page.keyboard.press('ArrowLeft')

    await page.locator('#section-doubao .image-preview').first().click()
    const viewer = page.getByRole('dialog', { name: '图片预览' }), stage = page.locator('.lightbox-stage'), photo = stage.locator('img'), output = viewer.getByLabel('图片缩放比例')
    await page.waitForFunction(() => document.querySelector('.lightbox-stage img')?.naturalWidth === 1600)
    const fit = Number.parseInt(await output.innerText()), originalBounds = await photo.boundingBox(), stageBox = await stage.boundingBox()
    const scrollBefore = await page.locator('.detail-scroll').evaluate(element => element.scrollTop)
    const point = { x: stageBox.x + stageBox.width / 2 + 25, y: stageBox.y + stageBox.height / 2 + 25 }
    await page.mouse.move(point.x, point.y); await page.mouse.wheel(0, -400); await page.waitForFunction(value => Number.parseInt(document.querySelector('.lightbox-controls output').textContent) > value, fit)
    const enlarged = await photo.boundingBox(); assert.ok(enlarged.width > originalBounds.width * 1.5)
    assert.ok(Math.abs((point.x - originalBounds.x) / originalBounds.width - (point.x - enlarged.x) / enlarged.width) < .01)
    assert.equal(await page.locator('.detail-scroll').evaluate(element => element.scrollTop), scrollBefore)
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()), 1)
    await page.mouse.down(); await page.mouse.move(point.x + 90, point.y + 80, { steps: 5 }); await page.mouse.up(); assert.ok(Math.abs((await photo.boundingBox()).x - enlarged.x) > 20)
    await page.screenshot({ path: path.join(dataDir, 'image-zoom.png') })
    await viewer.getByRole('button', { name: '适应窗口', exact: true }).click(); assert.equal(Number.parseInt(await output.innerText()), fit)
    await viewer.getByRole('button', { name: '1:1 原图', exact: true }).click(); assert.equal(await output.innerText(), '100%')
    await page.keyboard.press('ArrowRight'); await page.waitForFunction(() => document.querySelector('.lightbox-stage img')?.naturalWidth === 600)
    await page.keyboard.press('ArrowLeft'); await page.waitForFunction(() => document.querySelector('.lightbox-stage img')?.naturalWidth === 1600)
    await page.keyboard.press('Escape'); assert.equal(await viewer.count(), 0)
    for (const [index, image] of records[0].models.doubao.screenshots.entries()) assert.deepEqual(await fs.readFile(path.join(storage.attachments, image.fileName)), originals[index])

    // TXT exports operate on prompts only, including archived questions and unsaved text.
    records[0].prompt = '刚编辑的题目一\n保留换行和表情😀'; await page.getByLabel('问题（Prompt）', { exact: true }).fill(records[0].prompt)
    const openText = async () => { await page.getByRole('button', { name: '导出题目 TXT', exact: true }).click(); const dialog = page.getByRole('dialog'); assert.equal(await dialog.getByLabel('导出格式').inputValue(), 'questions-txt'); return dialog }
    for (const [scope, chosen] of [['全部记录', records], ['未归档', records.filter(record => !record.archived)], ['已归档', records.filter(record => record.archived)]]) {
      const target = path.join(dataDir, scope + '.txt'); await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, target)
      const dialog = await openText(); await dialog.getByRole('radio', { name: scope, exact: true }).check(); await dialog.getByRole('button', { name: '开始导出', exact: true }).click()
      await page.getByText(`${scope}题目 TXT 已导出，共 ${chosen.filter(record => record.prompt.trim()).length} 道，仅包含题目正文。`, { exact: true }).waitFor()
      const text = await fs.readFile(target, 'utf8'); assert.equal(text, '\uFEFF' + exportQuestionsText(chosen)); assert.equal(text.includes('PRIVATE'), false)
    }
    let dialog = await openText(); await dialog.getByRole('radio', { name: '选择特定记录', exact: true }).check()
    await dialog.getByRole('checkbox').filter({ hasText: records[2].title }).click(); assert.equal(await dialog.getByRole('button', { name: '开始导出', exact: true }).isDisabled(), true)
    await dialog.getByRole('checkbox').filter({ hasText: records[1].title }).click()
    const target = path.join(dataDir, '指定题目.txt'); await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, target)
    await dialog.getByRole('button', { name: '开始导出', exact: true }).click(); await page.getByText('选择特定记录题目 TXT 已导出，共 1 道，仅包含题目正文。', { exact: true }).waitFor(); assert.equal(await fs.readFile(target, 'utf8'), '\uFEFF' + exportQuestionsText([records[1]]))
    dialog = await openText(); await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }) }); await dialog.getByRole('button', { name: '开始导出', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.modal-actions .primary').disabled); assert.equal(await dialog.getByLabel('导出格式').inputValue(), 'questions-txt'); await dialog.getByRole('button', { name: '取消', exact: true }).click()

    // Native 520 x 400 window + largest supported font stays usable.
    assert.deepEqual(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMinimumSize()), [520, 400])
    await page.evaluate(() => desktopApi.saveSettings({ theme: 'dark', fontSize: 20 })); await page.reload(); await page.getByPlaceholder('记录标题').waitFor()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(520, 400)); await page.waitForFunction(() => innerWidth <= 520)
    assert.equal(await page.locator('.sidebar').isVisible(), false); assert.equal(await page.locator('.record-panel').isVisible(), false)
    assert.ok((await page.locator('.detail-panel').boundingBox()).width > 450)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await header.getByRole('button', { name: '展开记录列表', exact: true }).click(); assert.equal(await page.locator('.record-panel').isVisible(), true)
    await page.locator('.record-list .record-item').first().click(); assert.equal(await page.locator('.record-panel').isVisible(), false)
    await header.getByRole('button', { name: '展开侧边栏', exact: true }).click(); assert.equal(await page.locator('.sidebar').isVisible(), true)
    await page.locator('.sidebar').getByRole('button', { name: /已归档/ }).click(); assert.equal(await page.locator('.sidebar').isVisible(), false); assert.equal(await page.locator('.record-panel').isVisible(), true)
    await page.locator('.record-list .record-item').first().click(); assert.equal(await page.locator('.record-panel').isVisible(), false)
    await page.screenshot({ path: path.join(dataDir, 'workspace-narrow-dark.png') })
    await header.getByRole('button', { name: '展开侧边栏', exact: true }).click(); dialog = await openText(); assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth), false); await page.screenshot({ path: path.join(dataDir, 'txt-narrow-dark.png') }); await dialog.getByRole('button', { name: '取消', exact: true }).click()
    assert.equal(await page.locator('.sidebar').isVisible(), false)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 880)); await page.evaluate(() => desktopApi.saveSettings({ theme: 'light', fontSize: 14 })); await page.reload(); await page.getByPlaceholder('记录标题').waitFor(); await page.screenshot({ path: path.join(dataDir, 'workspace-wide.png') })
    assert.deepEqual(errors, []); console.log('PASS image zoom/pan/navigation; questions-only TXT scopes and cancel; sidebar/list collapse, splitter and 520x400 layout')
    console.log('Screenshots:', dataDir)
  } finally { await app.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
