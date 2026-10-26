const { _electron: electron } = require('playwright')
const path = require('path')
const fs = require('fs/promises')

async function main() {
  const root = path.resolve(__dirname, '..')
  await fs.mkdir(path.join(root, 'test-results'), { recursive: true })
  const env = { ...process.env, OQS_TEST_DATA: path.join(root, 'test-results', 'data'), OQS_USE_BUILD: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: [root], executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), env })
  const errors = []
  try {
    const page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    await page.locator('.main-workspace').waitFor()
    await page.screenshot({ path: path.join(root, 'test-results', 'empty.png') })
    console.log('Desktop launched:', await page.title())
    console.log('Renderer errors:', errors)
  } finally { await app.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
