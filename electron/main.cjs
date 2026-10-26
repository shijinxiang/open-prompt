const { app, BrowserWindow, ClipboardItem, clipboard, dialog, ipcMain, nativeImage, nativeTheme, net, protocol, shell } = require('electron')
const path = require('path')
const fs = require('fs/promises')
const crypto = require('crypto')
const { pathToFileURL } = require('url')
const { createStorage, MIME_EXTENSIONS, resolveAttachment, collectImages } = require('./storage.cjs')
const { writeBackupFile, readBackupFile, writeTextFile } = require('./backup.cjs')
const { createRepository, sharedIdentity } = require('./shared-repository.cjs')
const { startSharedBridge } = require('./shared-bridge.cjs')
const { createDialogPreferences } = require('./dialog-preferences.cjs')
const { resolveAppPaths, inside } = require('./app-paths.cjs')
const { createUpdateManager } = require('./update-manager.cjs')
const { spawn } = require('child_process')

const isDev = !app.isPackaged
const testDataRoot = process.env.OQS_TEST_DATA ? path.resolve(process.env.OQS_TEST_DATA) : null
const portableDirectory = app.isPackaged ? process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath) : null
const standalonePortable = portableDirectory && require('fs').existsSync(path.join(portableDirectory, 'portable-mode.json'))

function findProjectRoot() {
  if (testDataRoot) return testDataRoot
  if (standalonePortable) return path.resolve(portableDirectory)
  const starts = isDev ? [path.resolve(__dirname, '..')] : [process.env.PORTABLE_EXECUTABLE_DIR, path.dirname(process.execPath), process.cwd()].filter(Boolean)
  const checked = new Set()
  for (const start of starts) {
    let current = path.resolve(start)
    while (!checked.has(current)) {
      checked.add(current)
      try {
        const manifest = JSON.parse(require('fs').readFileSync(path.join(current, 'package.json'), 'utf8'))
        if (manifest.name !== 'open-question-labeling-studio') throw new Error('Different project')
        require('fs').accessSync(path.join(current, 'Start-App.cmd'))
        return current
      } catch {}
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
  }
  return isDev ? path.resolve(__dirname, '..') : path.resolve(process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath))
}

const projectRoot = findProjectRoot()
const appPaths = resolveAppPaths({ projectRoot, appData: app.getPath('appData'), resourcesPath: process.resourcesPath, executablePath: process.execPath, portableDirectory: app.isPackaged ? process.env.PORTABLE_EXECUTABLE_DIR : null, testDataRoot })
const dataRoot = appPaths.dataRoot
app.setPath('userData', appPaths.profileRoot)
const storage = createStorage(dataRoot)
const dialogPreferences = createDialogPreferences(app.getPath('userData'))
const legacyRoot = testDataRoot || standalonePortable ? null : path.join(app.getPath('appData'), 'OpenQuestionStudio', 'workspace')
let mainWindow
let canClose = false
let closing = false
let validateBackup
let upgradeBackup
let normalizeSettings
let schemaVersion
let exportQuestionsText
let combineBackups
let repository, sharedBridge, sharedBridgeError = '', desktopBaseline = null
let backupImportStage = null
let updateManager, pendingUpdateInstall = false, pendingRestart = false
async function discardBackupImport(importId) {
  const stage = backupImportStage
  if (!stage || (importId && stage.id !== importId)) return
  backupImportStage = null
  const resolved = path.resolve(stage.storage.root), expected = path.resolve(app.getPath('userData'))
  if (path.dirname(resolved) !== expected || !path.basename(resolved).startsWith('backup-import-')) throw new Error('备份暂存目录无效')
  await fs.rm(resolved, { recursive: true, force: true })
}
protocol.registerSchemesAsPrivileged([{ scheme: 'attachment', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

function trusted(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('无效的应用请求。')
}
function handle(channel, callback) { ipcMain.handle(channel, async (event, ...args) => { trusted(event); return callback(...args) }) }

async function createWindow() {
  await storage.ensure()
  mainWindow = new BrowserWindow({
    width: 1360, height: 880, minWidth: 520, minHeight: 400,
    backgroundColor: '#f7f8fa', title: '开放题记录库', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', event => event.preventDefault())
  mainWindow.on('close', event => {
    if (canClose) return
    event.preventDefault()
    if (!closing) { closing = true; mainWindow.webContents.send('window:before-close') }
  })
  if (isDev && !process.env.OQS_USE_BUILD && !process.argv.includes('--production')) await mainWindow.loadURL('http://127.0.0.1:5173')
  else await mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

handle('data:load', async () => { const data = await repository.read(); desktopBaseline = data.records; return data })
handle('data:save', async data => {
  try {
    const base = data.baseRecords || desktopBaseline || (await repository.read()).records
    const saved = await repository.mergeSnapshot(base, upgradeBackup(data).records)
    desktopBaseline = saved.records; return { ok: true, data: saved }
  } catch (error) {
    if (error.code === 'SHARED_CONFLICT') return { ok: false, code: error.code, message: error.message, conflicts: error.conflicts, data: error.data }
    throw error
  }
})
handle('shared:info', () => sharedBridge ? { available: true, pairingCode: sharedBridge.pairingCode, libraryId: sharedBridge.libraryId, port: sharedBridge.port } : { available: false, message: sharedBridgeError || '共享服务尚未启动' })
handle('application:info', () => ({ version: app.getVersion(), mode: appPaths.mode, dataRoot, installRoot: path.dirname(process.execPath) }))
handle('updates:state', () => updateManager.getState())
handle('updates:configure', ({ source, autoCheck }) => updateManager.configure(source, autoCheck))
handle('updates:check', () => updateManager.check())
handle('updates:download', () => updateManager.download())
handle('updates:install', () => { if (!updateManager.canInstall()) throw new Error('更新尚未下载完成。'); pendingUpdateInstall = true; mainWindow.close(); return { requested: true } })
handle('library:choose', async () => {
  if (appPaths.mode !== 'installed') throw new Error('当前版本直接使用程序旁的题库；安装版可关联已有题库。')
  const selected = await dialog.showOpenDialog(mainWindow, { title: '选择原题库的 data 文件夹或其上级文件夹', properties: ['openDirectory'] })
  if (selected.canceled || !selected.filePaths[0]) return { canceled: true }
  let directory = path.resolve(selected.filePaths[0])
  if (!require('fs').existsSync(path.join(directory, 'records.json')) && require('fs').existsSync(path.join(directory, 'data', 'records.json'))) directory = path.join(directory, 'data')
  if (inside(directory, path.dirname(process.execPath))) throw new Error('题库需要放在软件安装目录之外，才能在升级、卸载时保留。')
  const data = upgradeBackup(JSON.parse(await fs.readFile(path.join(directory, 'records.json'), 'utf8')))
  await fs.mkdir(appPaths.configRoot, { recursive: true })
  const locationFile = path.join(appPaths.configRoot, 'library-location.json'), temporary = locationFile + '.tmp'
  await fs.writeFile(temporary, JSON.stringify({ dataRoot: directory }, null, 2), 'utf8'); await fs.rename(temporary, locationFile)
  return { canceled: false, dataRoot: directory, count: data.records.length }
})
handle('application:restart', () => { pendingRestart = true; mainWindow.close(); return { requested: true } })
handle('settings:load', async () => { const settings = normalizeSettings(await storage.loadSettings()); nativeTheme.themeSource = settings.theme; return settings })
handle('settings:save', async value => { const settings = normalizeSettings(value); nativeTheme.themeSource = settings.theme; return storage.saveSettings(settings) })
handle('attachment:save', payload => storage.saveAttachment(payload))
ipcMain.on('attachment:drag', (event, payload) => {
  trusted(event)
  try {
    const file = storage.prepareDragExport(payload, path.join(app.getPath('userData'), 'drag-exports'))
    let icon = nativeImage.createFromPath(file)
    if (icon.isEmpty()) icon = nativeImage.createFromBitmap(Buffer.alloc(32 * 32 * 4).fill(Buffer.from([120, 125, 20, 255])), { width: 32, height: 32 })
    event.sender.startDrag({ file, icon: icon.resize({ width: 96, height: 72, quality: 'good' }) })
  } catch (error) { event.sender.send('attachment:drag-error', error.message) }
})
handle('attachment:copy', async payload => {
  let buffer
  let mime
  if (payload?.fileName) {
    const filePath = resolveAttachment(storage.attachments, payload.fileName)
    mime = Object.keys(MIME_EXTENSIONS).find(type => MIME_EXTENSIONS[type] === path.extname(filePath).slice(1).toLowerCase())
    if (!mime) throw new Error('图片格式无效。')
    const stat = await fs.stat(filePath)
    if (stat.size > 20 * 1024 * 1024) throw new Error('图片超过 20 MB，无法复制。')
    buffer = await fs.readFile(filePath)
  } else {
    const dataUrl = payload?.dataUrl
    if (typeof dataUrl !== 'string' || dataUrl.length > 28 * 1024 * 1024) throw new Error('图片数据无效。')
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/)
    if (!match) throw new Error('图片数据无效。')
    mime = match[1]
    buffer = Buffer.from(match[2], 'base64')
  }
  const image = nativeImage.createFromBuffer(buffer)
  if (image.isEmpty()) return { requiresConversion: true, dataUrl: `data:${mime};base64,${buffer.toString('base64')}` }
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([image.toPNG()], { type: 'image/png' }) })])
  return { ok: true }
})
handle('backup:export', async payload => {
  const data = upgradeBackup(payload)
  const result = await dialog.showSaveDialog(mainWindow, { defaultPath: `开放题标注备份-${new Date().toLocaleDateString('en-CA')}.json`, filters: [{ name: '完整 JSON 备份', extensions: ['json'] }] })
  if (result.canceled || !result.filePath) return { canceled: true }
  await writeBackupFile(storage, data, result.filePath, progress => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('backup:progress', progress)
  })
  return { canceled: false, filePath: result.filePath }
})
handle('questions:export', async payload => {
  if (!Array.isArray(payload?.prompts) || payload.prompts.length > 10000 || payload.prompts.some(prompt => typeof prompt !== 'string')) throw new Error('导出题目格式无效。')
  const prompts = payload.prompts.filter(prompt => prompt.trim())
  if (!prompts.length) throw new Error('所选记录没有题目正文。')
  const result = await dialog.showSaveDialog(mainWindow, { title: '导出题目 TXT', defaultPath: `开放题目-${prompts.length}题-${new Date().toLocaleDateString('en-CA')}.txt`, filters: [{ name: '仅题目 TXT', extensions: ['txt'] }] })
  if (result.canceled || !result.filePath) return { canceled: true }
  await writeTextFile(result.filePath, exportQuestionsText(prompts.map(prompt => ({ prompt }))))
  return { canceled: false, filePath: result.filePath, count: prompts.length }
})
handle('backup:import', async () => {
  const defaultPath = await dialogPreferences.importDirectory()
  const result = await dialog.showOpenDialog(mainWindow, { title: '选择一个或多个 JSON 备份', properties: ['openFile', 'multiSelections'], ...(defaultPath ? { defaultPath } : {}), filters: [{ name: '完整 JSON 备份', extensions: ['json'] }] })
  if (result.canceled || !result.filePaths[0]) return { canceled: true }
  await dialogPreferences.rememberImport(result.filePaths[0])
  await discardBackupImport()
  const stageRoot = await fs.mkdtemp(path.join(app.getPath('userData'), 'backup-import-'))
  const stage = { id: crypto.randomUUID(), storage: createStorage(stageRoot) }
  backupImportStage = stage
  try {
    const inputs = []
    for (const [index, filePath] of result.filePaths.entries()) {
      const name = path.basename(filePath)
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('backup:import-progress', { index: index + 1, total: result.filePaths.length, name })
      try {
        const data = await readBackupFile(filePath, async record => {
          for (const image of collectImages(record)) if (image.dataUrl) {
            Object.assign(image, await stage.storage.saveAttachment({ dataUrl: image.dataUrl, originalName: image.name }))
            delete image.dataUrl; delete image.url
          }
          return record
        })
        // Validate each file before combining, including duplicate IDs within it.
        inputs.push({ name, data: upgradeBackup(data) })
      } catch (error) { throw new Error(`文件“${name}”导入失败：${error.message}`) }
    }
    return { canceled: false, data: { ...combineBackups(inputs), importId: stage.id } }
  } catch (error) { await discardBackupImport(stage.id); throw error }
})
handle('backup:discard-import', async importId => { await discardBackupImport(importId); return { ok: true } })
handle('backup:apply', async payload => {
  const incoming = upgradeBackup(payload)
  if (incoming.importId) {
    const stage = backupImportStage
    if (!stage || stage.id !== incoming.importId) throw new Error('导入预览已过期，请重新选择备份文件。')
    const existingIds = new Set((await repository.read()).records.map(record => record.id))
    for (const record of incoming.records) if (!existingIds.has(record.id)) for (const image of collectImages(record)) {
      const source = resolveAttachment(stage.storage.attachments, image.fileName)
      const destination = resolveAttachment(storage.attachments, image.fileName)
      await fs.mkdir(storage.attachments, { recursive: true })
      try { await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL) } catch (error) { if (error.code !== 'EEXIST') throw error }
    }
  }
  const mergedResult = await repository.importRecords(incoming.records)
  const data = await repository.read(); desktopBaseline = data.records
  if (incoming.importId) await discardBackupImport(incoming.importId)
  return { data, imported: mergedResult.count, skipped: mergedResult.skipped }

})
handle('data:open-folder', async () => { await shell.openPath(storage.root); return storage.root })
ipcMain.on('window:allow-close', async event => {
  trusted(event); await discardBackupImport().catch(() => {})
  try {
    if (pendingUpdateInstall) { pendingUpdateInstall = false; await updateManager.install(); canClose = true; app.quit() }
    else { if (pendingRestart) { pendingRestart = false; app.relaunch() } canClose = true; mainWindow.close() }
  } catch (error) { pendingUpdateInstall = false; canClose = false; closing = false; mainWindow.webContents.send('updates:error', error.message) }
})
ipcMain.on('window:cancel-close', event => { trusted(event); closing = false; pendingUpdateInstall = false; pendingRestart = false })

const lock = app.requestSingleInstanceLock()
if (!lock) app.quit()
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus() } })
  app.whenReady().then(async () => {
    const domain = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'domain.js')).href)
    validateBackup = domain.validateBackup
    upgradeBackup = domain.upgradeBackup
    normalizeSettings = domain.normalizeSettings
    schemaVersion = domain.SCHEMA_VERSION
    exportQuestionsText = domain.exportQuestionsText
    combineBackups = domain.combineBackups
    await storage.migrateFrom(legacyRoot, validateBackup)
    const existing = await storage.load()
    if (existing.version < schemaVersion) {
      const upgraded = upgradeBackup(existing)
      validateBackup(upgraded)
      try { await fs.copyFile(storage.dataFile, path.join(storage.root, `records-before-v${schemaVersion}.json`), fs.constants.COPYFILE_EXCL) } catch (error) { if (error.code !== 'EEXIST') throw error }
      await storage.save(upgraded)
    } else {
      const normalized = upgradeBackup(existing)
      if (JSON.stringify(existing.records) !== JSON.stringify(normalized.records)) await storage.save(normalized)
    }
    repository = createRepository({ storage, domain })
    repository.subscribe((data, source) => { if (source !== 'desktop' && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('data:changed', data) })
    const identity = await sharedIdentity(storage, app.getPath('userData'))
    const requestedPort = process.env.OQS_BRIDGE_PORT !== undefined ? Number(process.env.OQS_BRIDGE_PORT) : testDataRoot ? 0 : 17843
    for (let attempt = 0; attempt < 10; attempt++) {
      try { sharedBridge = await startSharedBridge({ repository, identity, port: requestedPort ? requestedPort + attempt : 0 }); break }
      catch (error) { sharedBridgeError = error.message; if (error.code !== 'EADDRINUSE') break }
    }
    protocol.handle('attachment', async request => {
      try {
        const url = new URL(request.url)
        if (url.hostname !== 'local') return new Response('Not found', { status: 404 })
        return net.fetch(pathToFileURL(resolveAttachment(storage.attachments, decodeURIComponent(url.pathname.slice(1)))).href)
      } catch { return new Response('Not found', { status: 404 }) }
    })
    updateManager = createUpdateManager({
      version: app.getVersion(), installed: appPaths.mode === 'installed', profileRoot: app.getPath('userData'), resourcesPath: process.resourcesPath,
      request: (url, options) => net.fetch(url, options),
      onState: state => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updates:state-changed', state) },
      runInstaller: (file, args) => new Promise((resolve, reject) => { const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true }); child.once('error', reject); child.once('spawn', () => { child.unref(); resolve() }) }),
    })
    await updateManager.initialize()
    await createWindow()
    if (updateManager.shouldAutoCheck()) { const timer = setTimeout(() => updateManager.check().catch(() => {}), 15000); timer.unref() }
  }).catch(error => { dialog.showErrorBox('启动失败', error.message); app.quit() })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => { repository?.close(); sharedBridge?.close().catch(() => {}) })
}
