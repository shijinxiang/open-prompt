const { _electron: electron } = require('playwright')
const fs = require('fs/promises'), path = require('path'), assert = require('node:assert/strict')
const { createStorage } = require('../electron/storage.cjs')
async function main() {
  const root = path.resolve(__dirname, '..'), dataDir = await fs.mkdtemp(path.join(root, 'test-results/update-ui-')), storage = createStorage(dataDir)
  const { createRecord } = await import('../src/domain.js'), record = createRecord(); record.title = '更新前保存验证'; record.prompt = '原始问题'
  await storage.save({ version: 4, records: [record] })
  const env = { ...process.env, OQS_TEST_DATA: dataDir, OQS_USE_BUILD: '1' }; delete env.ELECTRON_RUN_AS_NODE
  const executable = process.env.OQS_TEST_EXECUTABLE
  const app = await electron.launch({ args: executable ? [] : [root], executablePath: executable || path.join(root, 'node_modules/electron/dist/electron.exe'), env })
  try {
    const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message)); await page.getByPlaceholder('记录标题').waitFor()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByLabel('更新仓库或下载目录').fill('test-owner/open-question-studio')
    await page.getByText('启动后检查新版本', { exact: true }).locator('input').uncheck().catch(async () => page.locator('.update-automatic input').uncheck())
    await page.getByRole('button', { name: '保存更新设置', exact: true }).click(); await page.getByText('更新来源已保存。', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '检查更新', exact: true }).isDisabled(), true)
    await page.reload(); await page.getByPlaceholder('记录标题').waitFor(); await page.getByRole('button', { name: '设置', exact: true }).click()
    assert.equal(await page.getByLabel('更新仓库或下载目录').inputValue(), 'test-owner/open-question-studio'); assert.equal(await page.locator('.update-automatic input').isChecked(), false)
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
    // Only the install IPC is replaced. The real renderer save sequence runs;
    // no installer or external service is invoked during this UI test.
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      ipcMain.removeHandler('updates:install'); ipcMain.handle('updates:install', () => { globalThis.__updateTestInstallCalled = true; return { requested: true } })
      BrowserWindow.getAllWindows()[0].webContents.send('updates:state-changed', { version: '0.3.0', installed: true, status: 'downloaded', source: 'test-owner/open-question-studio', autoCheck: false, availableVersion: '0.3.1', message: '测试更新已准备好' })
    })
    await page.getByLabel('问题（Prompt）', { exact: true }).fill('安装前尚未自动保存的新问题')
    await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('button', { name: '保存并安装更新', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.update-actions .primary')?.disabled)
    assert.equal(await app.evaluate(() => globalThis.__updateTestInstallCalled), true)
    assert.equal((await storage.load()).records[0].prompt, '安装前尚未自动保存的新问题')
    await page.getByRole('button', { name: '保存并安装更新', exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(dataDir, 'update-settings.png') })
    assert.deepEqual(errors, []); console.log('PASS update settings persist, portable update is gated, and install action saves current records first')
    console.log('Screenshot:', path.join(dataDir, 'update-settings.png'))
  } finally { await app.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
