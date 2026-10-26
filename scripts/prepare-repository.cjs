// Export only reviewed source locations. Runtime data and old distributions
// are intentionally not part of this allowlist.
const fs = require('fs/promises')
const path = require('path')
async function main() {
  const root = path.resolve(__dirname, '..'), target = await fs.mkdtemp(path.join(root, '.repository-export-'))
  const allowed = ['src', 'electron', 'scripts', 'tests', 'distribution', 'build', 'docs', '.github', '.gitignore', 'package.json', 'package-lock.json', 'vite.config.js', 'index.html', 'Start-App.cmd', '专家填写助手-v1.5.1-排序与二轮修复版']
  let files = 0, bytes = 0
  async function copy(from, to) {
    const relative = path.relative(root, from)
    // Old distribution preview images may show real records. Publish the
    // runnable extension and text instructions, without those screenshots.
    if (path.dirname(relative) === '专家填写助手-v1.5.1-排序与二轮修复版' && /\.(?:png|html)$/i.test(from)) return
    const stat = await fs.lstat(from)
    if (stat.isSymbolicLink()) throw new Error('发布目录包含文件链接，已停止：' + path.relative(root, from))
    if (stat.isDirectory()) {
      await fs.mkdir(to, { recursive: true })
      for (const name of await fs.readdir(from)) {
        if (['node_modules', 'data', 'backups', 'exports', 'test-results', '.app-cache', '.git', '.codex', '.agents'].includes(name) || name.startsWith('.env')) throw new Error('源码白名单中出现私人目录：' + name)
        await copy(path.join(from, name), path.join(to, name))
      }
      return
    }
    if (stat.size > 5 * 1024 * 1024) throw new Error('源码中出现异常大文件：' + path.relative(root, from))
    if (path.basename(from) === 'portable-records.json' && JSON.parse(await fs.readFile(from, 'utf8')).drafts.length) throw new Error('插件种子含用户记录，已停止导出')
    if (/\.(?:js|jsx|cjs|mjs|json|md|txt|yml|yaml|html|cmd|nsh)$/.test(from)) {
      const content = await fs.readFile(from, 'utf8')
      if (/ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(content)) throw new Error('文件疑似包含凭据：' + path.relative(root, from))
    }
    await fs.mkdir(path.dirname(to), { recursive: true }); await fs.copyFile(from, to); files++; bytes += stat.size
  }
  for (const name of allowed) await copy(path.join(root, name), path.join(target, name))
  await fs.copyFile(path.join(root, 'docs/README.public.md'), path.join(target, 'README.md')); files++
  console.log(JSON.stringify({ sourceDirectory: target, files, bytes, userDataIncluded: false }))
  await fs.writeFile(path.join(root, 'test-results/latest-repository-export.json'), JSON.stringify({ sourceDirectory: target, files, bytes }, null, 2))
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
