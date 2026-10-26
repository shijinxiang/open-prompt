const fs = require('fs/promises')
const path = require('path')
const { spawnSync } = require('child_process')

async function main() {
  const root = path.resolve(__dirname, '..')
  const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version
  const executableName = `OpenQuestionStudio-${version}.exe`
  const shareName = `开放题记录库-${version}-Windows免安装版`
  const staging = path.join(root, 'release', 'share-package')
  const bundle = path.join(staging, shareName)
  await fs.mkdir(bundle, { recursive: true })
  const allowedFiles = [executableName, 'portable-mode.json', '使用说明.txt']
  const existing = await fs.readdir(bundle)
  if (existing.some(name => !allowedFiles.includes(name))) throw new Error('分享目录中存在额外文件，请使用干净目录打包。')
  await fs.copyFile(path.join(root, 'release', executableName), path.join(bundle, executableName))
  await fs.copyFile(path.join(root, 'distribution', 'portable-mode.json'), path.join(bundle, 'portable-mode.json'))
  await fs.copyFile(path.join(root, 'distribution', '使用说明.txt'), path.join(bundle, '使用说明.txt'))
  const zipFile = path.join(root, 'release', `${shareName}.zip`)
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Compress-Archive -LiteralPath $env:OQS_SHARE_FOLDER -DestinationPath $env:OQS_SHARE_ZIP -Force -CompressionLevel Optimal'], { env: { ...process.env, OQS_SHARE_FOLDER: bundle, OQS_SHARE_ZIP: zipFile }, encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0) throw result.error || new Error(result.stderr || '分享压缩包生成失败。')
  console.log('Share package:', zipFile)
  console.log('Size MB:', ((await fs.stat(zipFile)).size / 1024 / 1024).toFixed(1))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
