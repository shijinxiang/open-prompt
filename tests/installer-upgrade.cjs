const { _electron: electron } = require('playwright')
const fs = require('fs/promises'), path = require('path'), crypto = require('crypto')
const { spawnSync } = require('child_process')
const assert = require('node:assert/strict')
const { createStorage } = require('../electron/storage.cjs')

async function main() {
  const root = path.resolve(__dirname, '..'), fixture = await fs.mkdtemp(path.join(root, 'test-results/installer-upgrade-'))
  const currentVersion = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version
  const nonce = crypto.randomBytes(5).toString('hex'), executableName = 'OqsUpgradeTest-' + nonce
  const installRoot = path.join(fixture, 'program'), dataRoot = path.join(fixture, 'library'), storage = createStorage(dataRoot)
  const { createRecord } = await import('../src/domain.js'), record = createRecord(); record.title = '独立安装升级测试'; record.prompt = '原始题目'
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2HsAAAAASUVORK5CYII='
  record.models.doubao.screenshots.push({ id: crypto.randomUUID(), name: '保留图片.png', ...await storage.saveAttachment({ dataUrl: png, originalName: 'test.png' }) })
  await storage.save({ version: 4, records: [record] })
  const emptyInclude = path.join(fixture, 'test-installer.nsh'); await fs.writeFile(emptyInclude, '; No production registry association or shortcuts in this disposable test.\n')
  async function build(version) {
    const output = path.join(fixture, 'build-' + version), config = path.join(fixture, 'config-' + version + '.json')
    const base = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).build
    await fs.access(path.join(root, base.electronDist, 'electron.exe'))
    await fs.writeFile(config, JSON.stringify({ ...base, electronDist: path.resolve(root, base.electronDist), appId: 'com.openquestionlabeling.test.' + nonce, productName: executableName, extraMetadata: { version }, directories: { output }, win: { ...base.win, executableName }, nsis: { ...base.nsis, include: emptyInclude, createDesktopShortcut: false, createStartMenuShortcut: false, runAfterFinish: false, uninstallDisplayName: 'OQS disposable upgrade test ' + nonce } }))
    console.log('Building disposable installer', version)
    const result = spawnSync(process.execPath, [path.join(root, 'node_modules/electron-builder/out/cli/cli.js'), '--win', 'nsis', '--publish', 'never', '--config', config], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 600000, env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false', ELECTRON_SKIP_BINARY_DOWNLOAD: '1' } })
    if (result.status !== 0) throw Error((result.error?.message || '') + '\n' + (result.stderr || result.stdout || 'Installer build failed').slice(-6000))
    return path.join(output, `OpenQuestionStudio-Setup-${version}.exe`)
  }
  function assertTarget(file) { const relative = path.relative(fixture, path.resolve(file)); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Test target escaped fixture') }
  async function install(file, chooseDirectory = false) {
    assertTarget(file); assertTarget(installRoot)
    const result = spawnSync(file, chooseDirectory ? ['/S', '/D=' + installRoot] : ['/S'], { windowsHide: true, encoding: 'utf8', timeout: 120000 })
    if (result.status !== 0) throw result.error || Error('Test installation failed: ' + result.status)
    assert.ok((await fs.stat(path.join(installRoot, executableName + '.exe'))).size > 0)
  }
  const env = { ...process.env, OQS_TEST_DATA: dataRoot }; delete env.ELECTRON_RUN_AS_NODE
  async function open(version, edit) {
    const app = await electron.launch({ executablePath: path.join(installRoot, executableName + '.exe'), env })
    try {
      const page = await app.firstWindow(); await page.getByPlaceholder('记录标题').waitFor()
      assert.equal(await app.evaluate(({ app }) => app.getVersion()), version)
      if (edit) { await page.getByLabel('问题（Prompt）', { exact: true }).fill(edit); await page.locator('.save-indicator').click(); await page.locator('.save-indicator.saved').waitFor() }
      else assert.equal(await page.getByLabel('问题（Prompt）', { exact: true }).inputValue(), '安装升级前保存的资料')
    } finally { await app.close() }
  }
  let installed = false
  try {
    const first = await build('0.3.1'); await install(first, true); installed = true; await open('0.3.1', '安装升级前保存的资料')
    const before = await fs.readFile(storage.dataFile), imageBefore = await fs.readFile(path.join(storage.attachments, record.models.doubao.screenshots[0].fileName))
    const second = await build(currentVersion); await install(second); await open(currentVersion)
    assert.deepEqual(await fs.readFile(storage.dataFile), before); assert.deepEqual(await fs.readFile(path.join(storage.attachments, record.models.doubao.screenshots[0].fileName)), imageBefore)
    console.log(`PASS actual NSIS custom-directory install 0.3.1 -> overwrite upgrade ${currentVersion} without /D: chosen directory reused and records/screenshots remained identical`)
  } finally {
    if (installed) {
      const uninstaller = (await fs.readdir(installRoot)).find(name => /^Uninstall.*\.exe$/i.test(name))
      if (uninstaller) { const file = path.join(installRoot, uninstaller); assertTarget(file); spawnSync(file, ['/S'], { windowsHide: true, timeout: 120000 }) }
      assert.ok((await fs.stat(storage.dataFile)).size > 0)
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
