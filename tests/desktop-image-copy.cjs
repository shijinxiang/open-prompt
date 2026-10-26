const { _electron: electron } = require('playwright')
const path = require('path')
const fs = require('fs/promises')
const { pathToFileURL } = require('url')
const assert = require('node:assert/strict')
const { createStorage } = require('../electron/storage.cjs')

async function main() {
  const root = path.resolve(__dirname, '..')
  const dataDir = await fs.mkdtemp(path.join(root, 'test-results', 'image-copy-'))
  const storage = createStorage(dataDir)
  const { createRecord } = await import(pathToFileURL(path.join(root, 'src', 'domain.js')).href)
  const record = createRecord()
  record.title = '截图复制测试'
  const smallPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2HsAAAAASUVORK5CYII='
  const oldAttachment = { ...await storage.saveAttachment({ dataUrl: smallPng, originalName: 'old-attachment.png' }), id: crypto.randomUUID(), name: 'old-attachment.png' }
  record.attachments.push(oldAttachment)
  await storage.save({ version: 2, records: [record] })
  const env = { ...process.env, OQS_TEST_DATA: dataDir, OQS_USE_BUILD: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: [root], executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), env })
  const errors = []
  let previousClipboard
  try {
    previousClipboard = await app.evaluate(async ({ clipboard }) => {
      const items = await clipboard.read()
      if (items.some(item => item.types.includes('image/png'))) {
        const item = items.find(value => value.types.includes('image/png'))
        return { image: Array.from(new Uint8Array(await (await item.getType('image/png')).arrayBuffer())) }
      }
      return { text: await clipboard.readText() }
    })
    const page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    await page.getByPlaceholder('记录标题').waitFor()
    assert.equal(await page.locator('#section-question .image-section').count(), 0)
    assert.equal(await page.getByLabel('题目附件粘贴区域').count(), 0)
    assert.equal(await page.locator('.image-tray').count(), 3)
    const formats = await page.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 360; canvas.height = 240
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#f04432'; ctx.fillRect(0, 0, 180, 240)
      ctx.fillStyle = '#178991'; ctx.fillRect(180, 0, 180, 240)
      ctx.fillStyle = '#fff'; ctx.font = '24px sans-serif'; ctx.fillText('Full size screenshot', 20, 70)
      const output = []
      for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
        const url = type === 'image/gif' ? 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' : canvas.toDataURL(type)
        const image = new Image()
        image.src = url
        await image.decode()
        const decoded = document.createElement('canvas')
        decoded.width = image.naturalWidth; decoded.height = image.naturalHeight
        decoded.getContext('2d').drawImage(image, 0, 0)
        output.push({ type, url, expected: decoded.toDataURL('image/png'), width: image.naturalWidth, height: image.naturalHeight })
      }
      return output
    })
    for (const [index, format] of formats.entries()) {
      const extension = format.type.split('/')[1]
      const target = ['doubao', 'gpt', 'opus', 'opus'][index]
      const imageBuffer = Buffer.from(format.url.split(',')[1], 'base64')
      await page.locator(`#section-${target} input[type=file]`).setInputFiles({ name: `screenshot-long-name-${target}.${extension}`, mimeType: format.type, buffer: imageBuffer })
      await page.locator(`#section-${target} .image-preview img`).waitFor()
      console.log('Copy format:', format.type)
      await page.locator(`#section-${target}`).getByRole('button', { name: /复制图片：/ }).last().click()
      await page.locator('.toast').waitFor()
      assert.equal((await page.locator('.toast').innerText()).trim(), '图片已复制，可直接粘贴。')
      const copied = await app.evaluate(async ({ clipboard, nativeImage }, sources) => {
        const items = await clipboard.read()
        const item = items.find(value => value.types.includes('image/png'))
        if (!item) throw new Error('Clipboard does not contain an image.')
        const bytes = Buffer.from(await (await item.getType('image/png')).arrayBuffer())
        const actual = nativeImage.createFromBuffer(bytes)
        const sourceImage = nativeImage.createFromBuffer(Buffer.from(sources.original, 'base64'))
        const expected = sourceImage.isEmpty() ? nativeImage.createFromBuffer(Buffer.from(sources.decoded, 'base64')) : sourceImage
        return { size: actual.getSize(), pixelsEqual: actual.toBitmap().equals(expected.toBitmap()) }
      }, { original: imageBuffer.toString('base64'), decoded: format.expected.split(',')[1] })
      assert.deepEqual(copied.size, { width: format.width, height: format.height })
      assert.equal(copied.pixelsEqual, true)
      await page.getByRole('button', { name: '关闭通知', exact: true }).click()
    }
    await page.locator('#section-doubao').getByRole('button', { name: /复制图片：/ }).click()
    await page.getByText('图片已复制，可直接粘贴。', { exact: true }).waitFor()
    const pasteTarget = page.locator('#section-opus .image-tray')
    await pasteTarget.focus()
    await page.keyboard.press('Control+V')
    await page.waitForFunction(() => document.querySelectorAll('#section-opus .image-item').length === 3)
    assert.equal(await page.locator('#section-opus .image-preview img').last().evaluate(img => img.naturalWidth), 360)
    await page.locator('.save-indicator').click()
    await page.locator('.save-indicator.saved').waitFor()
    const dataBeforeCopy = await page.evaluate(() => window.desktopApi.loadData())
    const restoredBackup = await storage.createBackup(dataBeforeCopy)
    const imported = structuredClone(restoredBackup.records[0])
    imported.id = crypto.randomUUID(); imported.title = '导入截图复制测试'
    const imageCountBeforeImport = (await fs.readdir(storage.attachments)).length
    const importFile = path.join(dataDir, 'image-copy-import.json')
    await fs.writeFile(importFile, JSON.stringify({ version: 2, records: [imported] }), 'utf8')
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, importFile)
    await page.getByRole('button', { name: '导入备份', exact: true }).click()
    await page.getByRole('button', { name: '合并导入' }).click()
    await page.getByText('已导入 1 条新记录，跳过 0 条同编号记录。').waitFor()
    await page.locator('.record-list').getByRole('button', { name: /导入截图复制测试/ }).click()
    await page.locator('#section-doubao').getByRole('button', { name: /复制图片：/ }).click()
    await page.getByText('图片已复制，可直接粘贴。', { exact: true }).waitFor()
    assert.equal(await app.evaluate(async ({ clipboard }) => clipboard.has('image/png')), true)
    const finalBackup = await storage.createBackup(await page.evaluate(() => window.desktopApi.loadData()))
    assert.equal(finalBackup.records[0].attachments[0].dataUrl, smallPng)
    assert.equal(finalBackup.records[1].attachments[0].dataUrl, smallPng)
    assert.ok((await fs.readdir(storage.attachments)).length > imageCountBeforeImport)
    await fs.access(path.join(storage.attachments, oldAttachment.fileName))
    await assert.rejects(page.evaluate(() => window.desktopApi.copyImage({ fileName: '../records.json' })))
    await assert.rejects(page.evaluate(() => window.desktopApi.copyImage({ dataUrl: 'data:text/html;base64,eA==' })))
    await page.locator('#section-gpt .image-tray').scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(root, 'test-results', 'image-copy.png') })
    assert.deepEqual(errors, [])
    console.log('PNG/JPEG/WebP/GIF copied at original size and pixels; native clipboard paste works; imported screenshots copy; old attachments remain in backup.')
  } finally {
    if (previousClipboard) await app.evaluate(async ({ clipboard, ClipboardItem }, previous) => {
      if (previous.image) await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(previous.image)], { type: 'image/png' }) })])
      else await clipboard.writeText(previous.text)
    }, previousClipboard).catch(() => {})
    await app.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
