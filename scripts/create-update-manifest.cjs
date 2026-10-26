const fs = require('fs/promises')
const path = require('path')
const { createReadStream } = require('fs')
const crypto = require('crypto')

async function main() {
  const root = path.resolve(__dirname, '..'), pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  const repository = process.env.GITHUB_REPOSITORY || process.argv[2]
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '')) throw new Error('请指定发布仓库：node scripts/create-update-manifest.cjs 用户名/仓库名')
  const name = `OpenQuestionStudio-Setup-${pkg.version}.exe`, file = path.join(root, 'release', name), hash = crypto.createHash('sha512')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  let notes = `开放题记录库 ${pkg.version}`
  try { notes = await fs.readFile(path.join(root, 'distribution', 'release-notes.txt'), 'utf8') } catch {}
  const manifest = { schemaVersion: 1, productId: pkg.build.appId, platform: 'win32', arch: 'x64', version: pkg.version, notes, asset: { url: `https://github.com/${repository}/releases/download/v${pkg.version}/${name}`, size: (await fs.stat(file)).size, sha512: hash.digest('base64') } }
  await fs.writeFile(path.join(root, 'release', 'update.json'), JSON.stringify(manifest, null, 2))
  console.log('Update manifest created for', repository, pkg.version)
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
