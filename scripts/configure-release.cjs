const fs = require('fs/promises')
const path = require('path')
async function main() {
  const repository = process.env.GITHUB_REPOSITORY || process.argv[2]
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '')) throw new Error('请提供 GitHub 用户名/仓库名')
  const [owner, repo] = repository.split('/')
  await fs.writeFile(path.resolve(__dirname, '../distribution/update-source.json'), JSON.stringify({ source: { provider: 'github', owner, repo } }, null, 2) + '\n')
  console.log('Release update source configured:', repository)
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
