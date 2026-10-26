const { _electron: electron } = require('playwright')
const path = require('path')

async function main() {
  const root = path.resolve(__dirname, '..')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ executablePath: path.join(root, 'release', 'win-unpacked', '开放题标注工作台.exe'), args: [], env })
  try {
    const page = await app.firstWindow()
    await page.locator('.main-workspace').waitFor()
    const info = await page.evaluate(async () => {
      const data = await window.desktopApi.loadData()
      return { title: document.title, dataPath: data.dataPath, count: data.records.length, version: data.version }
    })
    if (info.dataPath !== path.join(root, 'data')) throw new Error(`Unexpected data path: ${info.dataPath}`)
    if (info.version !== 3) throw new Error(`Unexpected record version: ${info.version}`)
    if (await page.locator('.criteria-input').count() !== 1) throw new Error('Expected a single core criteria field.')
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByLabel('字号数值').waitFor()
    const settings = await page.evaluate(() => window.desktopApi.loadSettings())
    if (Number(await page.getByLabel('字号数值').inputValue()) !== settings.fontSize) throw new Error('Font settings did not load.')
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
    if (!(await page.locator('.missing-notice, .complete-notice').count())) throw new Error('Missing field indicator is absent.')
    console.log('Packaged desktop verified:', JSON.stringify(info))
    await page.screenshot({ path: path.join(root, 'test-results', 'packaged.png') })
  } finally { await app.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
