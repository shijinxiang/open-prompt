const fs = require('fs/promises')
const path = require('path')
const crypto = require('crypto')

function createDialogPreferences(root) {
  const file = path.join(root, 'dialog-preferences.json')
  let queue = Promise.resolve()
  async function read() {
    try { const value = JSON.parse(await fs.readFile(file, 'utf8')); return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
    catch { return {} }
  }
  async function importDirectory() {
    await queue.catch(() => {})
    let directory = (await read()).lastImportDirectory
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) return undefined
    while (true) {
      try { if ((await fs.stat(directory)).isDirectory()) return directory } catch {}
      const parent = path.dirname(directory)
      if (parent === directory) return undefined
      directory = parent
    }
  }
  function rememberImport(filePath) {
    const directory = path.dirname(path.resolve(filePath))
    const operation = queue.catch(() => {}).then(async () => {
      const current = await read()
      await fs.mkdir(root, { recursive: true })
      const temporary = `${file}.${crypto.randomBytes(5).toString('hex')}.tmp`
      try {
        await fs.writeFile(temporary, JSON.stringify({ ...current, lastImportDirectory: directory }, null, 2), { encoding: 'utf8', flag: 'wx' })
        await fs.rename(temporary, file)
      } catch (error) { await fs.unlink(temporary).catch(() => {}); throw error }
    })
    queue = operation
    return operation
  }
  return { importDirectory, rememberImport }
}
module.exports = { createDialogPreferences }
