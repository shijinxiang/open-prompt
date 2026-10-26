const fs = require('fs/promises')
const path = require('path')
const { spawnSync } = require('child_process')

async function main() {
  const root = path.resolve(__dirname, '..')
  const folder = path.join(root, '专家填写助手-v1.5.1-排序与二轮修复版')
  const extension = path.join(folder, 'Chrome扩展')
  const manifest = JSON.parse(await fs.readFile(path.join(extension, 'manifest.json'), 'utf8'))
  if (manifest.version !== '1.5.1') throw new Error('Unexpected extension version')
  await fs.copyFile(path.join(root, 'src', 'domain.js'), path.join(extension, 'record-library-domain.js'))
  const seed = JSON.parse(await fs.readFile(path.join(extension, 'portable-records.json'), 'utf8'))
  if (seed.drafts.length) throw new Error('发行包不能包含用户记录，请先导出保存并清空种子文件')
  const files = await fs.readdir(folder)
  if (files.some(name => ['data', '.app-cache', 'test-results', 'node_modules'].includes(name))) throw new Error('Unexpected private/runtime directory')
  const zip = folder + '.zip'
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Compress-Archive -LiteralPath $env:QF_PACKAGE_SOURCE -DestinationPath $env:QF_PACKAGE_ZIP -Force -CompressionLevel Optimal'], {
    env: { ...process.env, QF_PACKAGE_SOURCE: folder, QF_PACKAGE_ZIP: zip }, windowsHide: true, encoding: 'utf8',
  })
  if (result.error || result.status !== 0) throw result.error || new Error(result.stderr || 'Extension packaging failed')
  console.log('Extension ZIP:', zip)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
