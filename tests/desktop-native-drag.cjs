const { _electron: electron } = require('playwright')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs/promises')
const assert = require('node:assert/strict')

async function main() {
  const root = path.resolve(__dirname, '..')
  const dataDir = await fs.mkdtemp(path.join(root, 'test-results', 'native-drag-'))
  const env = { ...process.env, OQS_TEST_DATA: dataDir, OQS_USE_BUILD: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  const packaged = process.argv.includes('--packaged')
  const app = await electron.launch({ args: packaged ? [] : [root], executablePath: packaged ? path.join(root, 'release', 'win-unpacked', '开放题标注工作台.exe') : path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), env })
  try {
    const page = await app.firstWindow()
    await page.locator('.main-workspace').waitFor()
    await page.locator('header').getByRole('button', { name: '新建记录' }).click()
    const original = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 320; canvas.height = 180
      const context = canvas.getContext('2d')
      context.fillStyle = '#146f6a'; context.fillRect(0, 0, 320, 180)
      context.fillStyle = '#fff'; context.font = '28px sans-serif'; context.fillText('Drag original image', 25, 90)
      return canvas.toDataURL('image/png')
    })
    const originalBytes = Buffer.from(original.split(',')[1], 'base64')
    await page.locator('#section-doubao input[type=file]').setInputFiles({ name: 'native-drag.png', mimeType: 'image/png', buffer: originalBytes })
    const preview = page.locator('#section-doubao .image-preview')
    await preview.waitFor()
    await page.locator('.save-indicator').click()
    await page.locator('.save-indicator.saved').waitFor()
    await page.evaluate(() => { window.testPointerEvents = []; document.addEventListener('pointerdown', event => window.testPointerEvents.push({ x: event.clientX, y: event.clientY, target: event.target.className })) })
    const placement = await app.evaluate(async ({ BrowserWindow, screen }) => {
      const main = BrowserWindow.getAllWindows()[0]
      const startDrag = main.webContents.startDrag.bind(main.webContents)
      main.webContents.__nativeDragCalls = []
      main.webContents.startDrag = options => { main.webContents.__nativeDragCalls.push(options.file); return startDrag(options) }
      const display = screen.getPrimaryDisplay()
      const area = display.workArea
      main.setBounds({ x: area.x, y: area.y, width: 1120, height: 800 })
      main.setAlwaysOnTop(true)
      const receiver = new BrowserWindow({ x: Math.min(area.x + 1130, area.x + area.width - 350), y: area.y + 20, width: 350, height: 450, title: 'Native Drag Test Receiver', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } })
      receiver.__testReceiver = true
      receiver.setAlwaysOnTop(true)
      await receiver.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><body style="margin:0;height:100vh;background:#deeee6;font:20px sans-serif;display:grid;place-items:center">Drop image here<script>window.received=[];document.ondragover=e=>e.preventDefault();document.ondrop=async e=>{e.preventDefault();window.received=await Promise.all([...e.dataTransfer.files].map(async f=>({name:f.name,bytes:[...new Uint8Array(await f.arrayBuffer())]})));document.body.firstChild.textContent="Image received"}</script>'))
      main.focus()
      return { main: main.getContentBounds(), receiver: receiver.getContentBounds(), scale: display.scaleFactor }
    })
    await preview.scrollIntoViewIfNeeded()
    await page.waitForTimeout(500)
    const bounds = await preview.boundingBox()
    const sourceX = Math.round((placement.main.x + bounds.x + bounds.width / 2) * placement.scale)
    const sourceY = Math.round((placement.main.y + bounds.y + bounds.height / 2) * placement.scale)
    const targetX = Math.round((placement.receiver.x + placement.receiver.width / 2) * placement.scale)
    const targetY = Math.round((placement.receiver.y + placement.receiver.height / 2) * placement.scale)
    await new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'tests', 'native-drag-pointer.ps1'), '-SourceX', String(sourceX), '-SourceY', String(sourceY), '-TargetX', String(targetX), '-TargetY', String(targetY)], { windowsHide: true })
      let errors = ''
      child.stderr.on('data', value => { errors += value })
      child.once('error', reject)
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(errors)))
    })
    let received = []
    for (let attempt = 0; attempt < 40; attempt++) {
      received = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.__testReceiver).webContents.executeJavaScript('window.received'))
      if (received.length) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    const dragCalls = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !window.__testReceiver).webContents.__nativeDragCalls)
    const pointerEvents = await page.evaluate(() => window.testPointerEvents)
    assert.equal(received.length, 1, `System drag produced no file; geometry: ${JSON.stringify({ placement, bounds, sourceX, sourceY, targetX, targetY, dragCalls, pointerEvents })}`)
    assert.equal(received[0].name, 'native-drag.png')
    assert.deepEqual(Buffer.from(received[0].bytes), originalBytes)
    const records = JSON.parse(await fs.readFile(path.join(dataDir, 'records.json'), 'utf8')).records
    assert.deepEqual(await fs.readFile(path.join(dataDir, 'attachments', records[0].models.doubao.screenshots[0].fileName)), originalBytes)
    console.log('Real Windows file drag from saved thumbnail into a separate receiver window preserves original image bytes and stored source.')
  } finally { await app.close() }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
