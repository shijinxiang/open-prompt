const { chromium } = require('playwright')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs/promises')

async function main() {
  const root = path.resolve(__dirname, '..')
  const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version
  const executable = path.join(root, 'release', `OpenQuestionStudio-${version}.exe`)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(executable, ['--remote-debugging-port=9227'], { env, cwd: process.env.SystemRoot, windowsHide: true })
  child.on('error', error => console.error(error))
  let browser
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      try { browser = await chromium.connectOverCDP('http://127.0.0.1:9227', { timeout: 1000 }); break }
      catch { await new Promise(resolve => setTimeout(resolve, 400)) }
    }
    if (!browser) throw new Error('Portable executable did not expose its application window.')
    const page = browser.contexts()[0].pages()[0]
    await page.locator('.main-workspace').waitFor()
    const dataPath = await page.evaluate(async () => (await window.desktopApi.loadData()).dataPath)
    if (dataPath !== path.join(root, 'data')) throw new Error(`Unexpected portable data path: ${dataPath}`)
    if (await page.locator('.criteria-input').count() !== 1) throw new Error('Expected a single core criteria field.')
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByLabel('字号数值').waitFor()
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
    if (!(await page.locator('.missing-notice, .complete-notice').count())) throw new Error('Missing field indicator is absent.')
    console.log('Portable executable verified:', await page.title())
    console.log('Storage directory:', dataPath)
    await page.screenshot({ path: path.join(root, 'test-results', 'portable.png') })
    await page.evaluate(() => window.desktopApi.allowClose())
    await fs.access(executable)
  } finally { if (browser) await browser.close(); child.kill() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
