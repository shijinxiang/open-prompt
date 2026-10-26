const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

function inside(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
}
function readInstallerLibrary() {
  if (process.platform !== 'win32') return null
  try {
    const command = "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); (Get-ItemProperty -LiteralPath 'HKCU:\\Software\\OpenQuestionStudio' -Name LibraryPath -ErrorAction SilentlyContinue).LibraryPath"
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim() || null
  } catch { return null }
}
function resolveAppPaths({ projectRoot, appData, resourcesPath, executablePath, portableDirectory, testDataRoot, readLibrary = readInstallerLibrary }) {
  if (testDataRoot) return { mode: 'test', dataRoot: testDataRoot, profileRoot: path.join(testDataRoot, '.app-cache'), configRoot: path.join(testDataRoot, '.installation') }
  const installed = !portableDirectory && fs.existsSync(path.join(resourcesPath, 'installed-mode.json'))
  if (!installed) return { mode: portableDirectory ? 'portable' : 'project', dataRoot: path.join(projectRoot, 'data'), profileRoot: path.join(projectRoot, '.app-cache'), configRoot: null }
  const configRoot = path.join(appData, 'OpenQuestionStudio'), locationFile = path.join(configRoot, 'library-location.json')
  let configured
  try { configured = JSON.parse(fs.readFileSync(locationFile, 'utf8')).dataRoot } catch {}
  const external = configured || readLibrary()
  if (external && typeof external === 'string' && path.isAbsolute(external) && !inside(external, path.dirname(executablePath)) && fs.existsSync(path.join(external, 'records.json'))) {
    if (!configured) { try { fs.mkdirSync(configRoot, { recursive: true }); fs.writeFileSync(locationFile, JSON.stringify({ dataRoot: path.resolve(external) }, null, 2), { flag: 'wx' }) } catch {} }
    return { mode: 'installed', dataRoot: path.resolve(external), profileRoot: path.basename(external).toLowerCase() === 'data' ? path.join(path.dirname(external), '.app-cache') : path.join(external, '.app-cache'), configRoot }
  }
  return { mode: 'installed', dataRoot: path.join(configRoot, 'data'), profileRoot: path.join(configRoot, '.app-cache'), configRoot }
}
module.exports = { resolveAppPaths, inside }
