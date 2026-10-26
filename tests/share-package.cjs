const { chromium } = require('playwright')
const { spawn, spawnSync } = require('child_process')
const path = require('path')
const fs = require('fs/promises')
const os = require('os')
const crypto = require('crypto')
const assert = require('node:assert/strict')

async function main() {
  const root = path.resolve(__dirname, '..')
  const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version
  const name = `开放题记录库-${version}-Windows免安装版`
  const zip = path.join(root, 'release', `${name}.zip`)
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'oqs-share-'))
  const originalHash = crypto.createHash('sha256').update(await fs.readFile(path.join(root, 'data', 'records.json'))).digest('hex')
  let browser
  let child
  try {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Add-Type -AssemblyName System.IO.Compression.FileSystem; $archive = [System.IO.Compression.ZipFile]::OpenRead($env:OQS_TEST_ZIP); try { if ($archive.Entries.Count -ne 3) { throw "Unexpected files in share package" }; foreach ($entry in $archive.Entries) { if ([System.IO.Path]::GetFileName($entry.FullName) -notin @($env:OQS_TEST_EXE, "portable-mode.json", "使用说明.txt")) { throw "Unexpected share package entry" } }; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:OQS_TEST_ZIP, $env:OQS_TEST_EXTRACT) } finally { $archive.Dispose() }'], { env: { ...process.env, OQS_TEST_ZIP: zip, OQS_TEST_EXTRACT: temp, OQS_TEST_EXE: `OpenQuestionStudio-${version}.exe` }, windowsHide: true, encoding: 'utf8' })
    if (result.error || result.status !== 0) throw result.error || new Error(result.stderr)
    const bundle = path.join(temp, name)
    const executable = path.join(bundle, `OpenQuestionStudio-${version}.exe`)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.OQS_TEST_DATA
    const open = async () => {
      child = spawn(executable, ['--remote-debugging-port=9228'], { env, cwd: root, windowsHide: true })
      child.on('error', error => console.error(error))
      browser = null
      for (let attempt = 0; attempt < 60; attempt++) {
        try { browser = await chromium.connectOverCDP('http://127.0.0.1:9228', { timeout: 1000 }); break }
        catch { await new Promise(resolve => setTimeout(resolve, 350)) }
      }
      if (!browser) throw new Error('Share executable did not open.')
      const page = browser.contexts()[0].pages()[0]
      await page.locator('.main-workspace').waitFor()
      return page
    }
    const close = async page => {
      const exited = new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve) })
      await page.evaluate(() => window.desktopApi.allowClose())
      await exited
      await browser.close(); browser = null; child = null
    }
    let page = await open()
    const first = await page.evaluate(() => window.desktopApi.loadData())
    assert.equal(first.dataPath, path.join(bundle, 'data'))
    assert.equal(first.version, 4)
    assert.equal(first.records.length, 0)
    await page.locator('header').getByRole('button', { name: '新建记录' }).click()
    assert.equal(await page.locator('#section-question .image-section').count(), 0)
    for (const model of ['豆包专家', 'GPT-5.6-Sol', 'Opus 4.6']) {
      assert.equal(await page.getByLabel(`${model}实际名称`, { exact: true }).inputValue(), model)
      assert.equal(await page.getByLabel(`${model}模式`, { exact: true }).count(), 0)
    }
    await page.getByPlaceholder('记录标题').fill('收件人测试资料')
    await page.getByLabel('决定性核心考点', { exact: true }).fill('分享版保存的整段考点')
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2HsAAAAASUVORK5CYII=', 'base64')
    const dragHint = await page.evaluate(({ base64 }) => {
      const target = document.querySelector('#section-doubao .image-tray')
      const file = new File([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], 'recipient.png', { type: 'image/png' })
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer }))
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
      return new Promise(resolve => requestAnimationFrame(() => {
        const hint = target.querySelector('.drop-hint')?.textContent?.trim() || ''
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
        resolve(hint)
      }))
    }, { base64: png.toString('base64') })
    assert.equal(dragHint, '松开即可导入图片')
    await page.locator('#section-doubao .image-preview img').waitFor()
    await page.locator('#section-doubao').getByRole('button', { name: /复制图片：/ }).click()
    await page.getByText('图片已复制，可直接粘贴。', { exact: true }).waitFor()
    assert.equal(await page.evaluate(async () => (await navigator.clipboard.read()).some(item => item.types.includes('image/png'))), true)
    await page.getByRole('switch', { name: '二轮资料', exact: true }).check()
    for (const label of ['质检判断', '审核结论', '质检意见', '专家返修备注']) assert.equal(await page.getByLabel(label, { exact: true }).count(), 0)
    const extraModels = [
      { id: 'model4', label: '模型4', actualName: '收件人自选模型甲', networkStatus: '已开启', result: '达成' },
      { id: 'model5', label: '模型5', actualName: '收件人自选模型乙', networkStatus: '未开启', result: '未达成' },
    ]
    for (const model of extraModels) {
      assert.equal(await page.getByLabel(`${model.label}实际名称`, { exact: true }).inputValue(), '')
      await page.getByLabel(`${model.label}实际名称`, { exact: true }).fill(model.actualName)
      await page.getByLabel(`${model.label}原始回复`, { exact: true }).fill(`${model.actualName}完整回复`)
      await page.getByLabel(`${model.label}总体结果`, { exact: true }).selectOption(model.result)
      await page.getByLabel(`${model.label}达成性备注`, { exact: true }).fill(`${model.actualName}达成性证据`)
      await page.locator(`#section-${model.id} input[type=file]`).setInputFiles({ name: `${model.id}.png`, mimeType: 'image/png', buffer: png })
      await page.locator(`#section-${model.id} .image-preview img`).waitFor()
    }
    const quality = {
      enabled: true,
      ranking: '模型1 = 模型3 ＞ 模型2 = 模型4 ＞ 模型5',
      rankingExplanation: ['总结：', '模型1：', '模型2：', '模型3：', '模型4：', '模型5：'].map(label => `${label}${'按固定核心考点和原始回复证据记录达成情况及排序依据。'.repeat(3)}`).join('\n\n'),
    }
    for (const [label, key] of [['核心考点的达成性排序', 'ranking'], ['核心考点的达成性排序说明', 'rankingExplanation']]) await page.getByLabel(label, { exact: true }).fill(quality[key])
    assert.equal(await page.locator('.quality-warnings').count(), 0)
    await page.locator('.save-indicator').click()
    await page.locator('.save-indicator.saved').waitFor()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByLabel('字号数值').fill('18')
    await page.getByRole('button', { name: '黑夜模式', exact: true }).click()
    await page.locator('.settings-save-status.saved').waitFor()
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
    await page.screenshot({ path: path.join(root, 'test-results', 'share-package.png') })
    await close(page)
    const saved = JSON.parse(await fs.readFile(path.join(bundle, 'data', 'records.json'), 'utf8'))
    assert.equal(saved.version, 4)
    assert.equal(saved.records[0].title, '收件人测试资料')
    assert.deepEqual(saved.records[0].quality, quality)
    for (const [id, name] of [['doubao', '豆包专家'], ['gpt', 'GPT-5.6-Sol'], ['opus', 'Opus 4.6']]) {
      assert.equal(saved.records[0].models[id].actualName, name)
      assert.equal(saved.records[0].models[id].mode, undefined)
    }
    for (const model of extraModels) {
      const data = saved.records[0].models[model.id]
      assert.equal(data.actualName, model.actualName)
      for (const key of ['mode', 'source', 'networkStatus', 'contextMode', 'collectionNote']) assert.equal(data[key], undefined)
      assert.equal(data.response, `${model.actualName}完整回复`)
      assert.equal(data.result, model.result)
      assert.equal(data.note, `${model.actualName}达成性证据`)
      assert.equal(data.screenshots.length, 1)
      assert.deepEqual(await fs.readFile(path.join(bundle, 'data', 'attachments', data.screenshots[0].fileName)), png)
    }
    assert.equal((await fs.readdir(path.join(bundle, 'data', 'attachments'))).length, 3)
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(bundle, 'data', 'settings.json'), 'utf8')), { fontSize: 18, theme: 'dark' })
    page = await open()
    await page.getByPlaceholder('记录标题').waitFor()
    assert.equal(await page.getByPlaceholder('记录标题').inputValue(), '收件人测试资料')
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.criteria-input')).fontSize === '18px')
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
    await page.waitForFunction(() => { const img = document.querySelector('#section-doubao .image-preview img'); return img?.complete && img.naturalWidth > 0 })
    await page.locator('#section-doubao').getByRole('button', { name: /复制图片：/ }).click()
    await page.getByText('图片已复制，可直接粘贴。', { exact: true }).waitFor()
    for (const model of extraModels) {
      assert.equal(await page.getByLabel(`${model.label}实际名称`, { exact: true }).inputValue(), model.actualName)
      assert.equal(await page.getByLabel(`${model.label}原始回复`, { exact: true }).inputValue(), `${model.actualName}完整回复`)
      await page.waitForFunction(id => { const img = document.querySelector(`#section-${id} .image-preview img`); return img?.complete && img.naturalWidth > 0 }, model.id)
      await page.locator(`#section-${model.id}`).getByRole('button', { name: /复制图片：/ }).click()
      await page.getByText('图片已复制，可直接粘贴。', { exact: true }).waitFor()
    }
    assert.equal(await page.getByLabel('核心考点的达成性排序', { exact: true }).inputValue(), quality.ranking)
    assert.equal(await page.getByLabel('核心考点的达成性排序说明', { exact: true }).inputValue(), quality.rankingExplanation)
    for (const model of extraModels) {
      const section = page.locator(`#section-${model.id}`)
      await section.getByRole('button', { name: 'Markdown 预览', exact: true }).click()
      await section.getByRole('button', { name: `复制${model.label}回复`, exact: true }).click()
      await page.waitForFunction(async text => await navigator.clipboard.readText() === text, `${model.actualName}完整回复`)
    }
    assert.deepEqual((await page.evaluate(() => window.desktopApi.loadData())).records, saved.records)
    const oldRecord = structuredClone(saved.records[0])
    oldRecord.id = crypto.randomUUID(); oldRecord.title = '旧版分享备份导入'; oldRecord.notes = '已取消补充备注'
    oldRecord.quality.matrixText = '已取消矩阵'; oldRecord.quality.verificationNotes = '已取消待核验资料'
    for (const model of Object.values(oldRecord.models)) {
      Object.assign(model, { mode: '旧模式', source: '旧来源', networkStatus: '已开启', contextMode: '旧 Context', collectionNote: '旧采集备注' })
      for (const image of model.screenshots) { image.dataUrl = `data:image/png;base64,${png.toString('base64')}`; delete image.fileName }
    }
    const imported = await page.evaluate(record => window.desktopApi.applyImport({ version: 3, records: [record] }), oldRecord)
    assert.equal(imported.imported, 1)
    assert.equal(imported.data.version, 4)
    const upgraded = imported.data.records.find(record => record.id === oldRecord.id)
    assert.equal(upgraded.notes, undefined)
    assert.deepEqual(upgraded.quality, quality)
    for (const model of Object.values(upgraded.models)) {
      for (const key of ['mode', 'source', 'networkStatus', 'contextMode', 'collectionNote']) assert.equal(model[key], undefined)
      for (const image of model.screenshots) assert.deepEqual(await fs.readFile(path.join(bundle, 'data', 'attachments', image.fileName)), png)
    }
    await page.reload()
    await page.locator('.record-list').getByRole('button', { name: /旧版分享备份导入/ }).click()
    assert.equal(await page.getByLabel('核心考点的达成性排序说明', { exact: true }).inputValue(), quality.rankingExplanation)
    assert.equal(await page.getByLabel('补充备注', { exact: true }).count(), 0)
    assert.equal(await page.evaluate(() => typeof window.desktopApi.startImageDrag), 'function')
    await close(page)
    assert.equal(crypto.createHash('sha256').update(await fs.readFile(path.join(root, 'data', 'records.json'))).digest('hex'), originalHash)
    console.log('Share ZIP starts empty, excludes private data, persists five replies/rankings/images/dark theme, and imports v3 JSON with cancelled fields discarded; project records unchanged.')
  } finally {
    if (browser) await browser.close().catch(() => {})
    if (child) child.kill()
    await fs.rm(temp, { recursive: true, force: true }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
