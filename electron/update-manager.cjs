const fs = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const { createWriteStream, createReadStream } = require('fs')
const { Readable, Transform } = require('stream')
const { pipeline } = require('stream/promises')

function parseSource(input) {
  const text = String(input || '').trim()
  if (!text) return null
  const github = text.match(/^(?:https:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/)
  if (github) return { provider: 'github', owner: github[1], repo: github[2] }
  let url
  try { url = new URL(text) } catch { throw new Error('请输入 GitHub 仓库地址或 HTTPS 更新目录。') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('更新目录必须使用不含账号、密码或查询参数的 HTTPS 地址。')
  if (url.hostname === 'github.com') throw new Error('GitHub 地址应为“用户或组织名/仓库名”。')
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return { provider: 'generic', url: url.href }
}
const sourceText = source => source?.provider === 'github' ? `${source.owner}/${source.repo}` : source?.provider === 'generic' ? source.url : ''
function notesText(notes) { return typeof notes === 'string' ? notes.slice(0, 8000) : Array.isArray(notes) ? notes.map(item => `${item.version || ''}\n${item.note || ''}`).join('\n').slice(0, 8000) : '' }

const PRODUCT = 'com.openquestionlabeling.studio'
function compareVersions(a, b) {
  const parse = value => { if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error('更新版本号必须为稳定版，例如 1.2.3。'); return value.split('.').map(Number) }
  const aa = parse(a), bb = parse(b)
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] > bb[i] ? 1 : -1
  return 0
}
function validateManifest(value, currentVersion, baseUrl) {
  if (!value || value.schemaVersion !== 1 || value.productId !== PRODUCT || value.platform !== 'win32' || value.arch !== 'x64') throw new Error('更新文件不属于本软件的 Windows 64 位版本。')
  compareVersions(value.version, currentVersion)
  const asset = value.asset
  if (!asset || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > 1024 * 1024 * 1024 || typeof asset.sha512 !== 'string' || Buffer.from(asset.sha512, 'base64').length !== 64 || Buffer.from(asset.sha512, 'base64').toString('base64') !== asset.sha512) throw new Error('更新文件的大小或校验信息无效。')
  const url = new URL(asset.url, baseUrl)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || !url.pathname.toLowerCase().endsWith('.exe')) throw new Error('安装包必须来自 HTTPS 下载地址。')
  return { ...value, asset: { ...asset, url: url.href } }
}
async function fileDigest(file) { const hash = crypto.createHash('sha512'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('base64') }

function createUpdateManager({ version, installed, profileRoot, resourcesPath, request = fetch, runInstaller, onState = () => {} }) {
  const settingsFile = path.join(profileRoot, 'update-settings.json')
  const downloadRoot = path.join(profileRoot, 'updates'), pendingFile = path.join(downloadRoot, 'pending.json')
  let source = null, autoCheck = true, active = false, manifest = null, downloadedFile = null
  let state = { version, installed, status: 'unconfigured', source: '', autoCheck: true, availableVersion: null, progress: null, message: '' }
  const emit = patch => { state = { ...state, ...patch, source: sourceText(source), autoCheck }; onState(structuredClone(state)); return structuredClone(state) }
  async function initialize() {
    let saved = {}
    try { saved = JSON.parse(await fs.readFile(settingsFile, 'utf8')) || {} } catch {}
    let bundled = null
    try { bundled = JSON.parse(await fs.readFile(path.join(resourcesPath, 'update-source.json'), 'utf8')).source } catch {}
    try { source = parseSource(saved.source || sourceText(bundled)) } catch { source = null }
    autoCheck = saved.autoCheck !== false
    emit({ status: source ? 'idle' : 'unconfigured', message: !installed ? '当前为免安装或开发版。安装一次安装版后，即可在软件内升级。' : source ? '可检查新版本。' : '尚未配置更新仓库，可先正常使用软件。' })
    try {
      const pending = JSON.parse(await fs.readFile(pendingFile, 'utf8'))
      if (installed && source && pending.source === sourceText(source)) {
        const candidate = validateManifest(pending.manifest, version, pending.manifest.asset.url)
        if (compareVersions(candidate.version, version) > 0) {
          const file = path.join(downloadRoot, `OpenQuestionStudio-Setup-${candidate.version}.exe`)
          if ((await fs.stat(file)).size === candidate.asset.size && await fileDigest(file) === candidate.asset.sha512) {
            manifest = candidate; downloadedFile = file
            emit({ status: 'downloaded', availableVersion: candidate.version, message: '已恢复下载完成的更新，可保存资料后安装。' })
          }
        }
      }
    } catch {}
    return structuredClone(state)
  }
  async function configure(input, checkAutomatically = true) {
    if (active || state.status === 'installing') throw new Error('正在处理更新，请完成后再修改更新来源。')
    const next = parseSource(input)
    const temporary = settingsFile + '.' + crypto.randomBytes(5).toString('hex') + '.tmp'
    await fs.mkdir(profileRoot, { recursive: true })
    try { await fs.writeFile(temporary, JSON.stringify({ source: sourceText(next), autoCheck: !!checkAutomatically }, null, 2), { flag: 'wx' }); await fs.rename(temporary, settingsFile) }
    catch (error) { await fs.unlink(temporary).catch(() => {}); throw error }
    source = next; autoCheck = !!checkAutomatically
    manifest = null; downloadedFile = null
    await fs.unlink(pendingFile).catch(() => {})
    return emit({ status: source ? 'idle' : 'unconfigured', availableVersion: null, progress: null, message: source ? '更新来源已保存。' : '更新来源已清除。' })
  }
  function ready() {
    if (!installed) throw new Error('请先使用安装版，再进行应用内升级。')
    if (!source) throw new Error('请先配置更新仓库或 HTTPS 更新目录。')
  }
  async function json(url) {
    const response = await request(url, { headers: { Accept: 'application/json', 'User-Agent': 'OpenQuestionStudio/' + version }, signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error(`更新服务返回 HTTP ${response.status}。`)
    const pieces = []; let bytes = 0
    for await (const chunk of Readable.fromWeb(response.body)) { bytes += chunk.length; if (bytes > 1024 * 1024) throw new Error('更新清单过大。'); pieces.push(chunk) }
    return JSON.parse(Buffer.concat(pieces).toString('utf8'))
  }
  async function operation(kind) {
    if (active) throw new Error('正在处理更新，请稍后再试。')
    if (kind === 'download' && state.status !== 'available') throw new Error('请先检查并确认有可下载的新版本。')
    active = true
    try {
      ready()
      if (kind === 'check') {
        emit({ status: 'checking', progress: null, message: '正在检查新版本…' })
        let url
        if (source.provider === 'github') {
          const release = await json(`https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/releases/latest`)
          const asset = release.assets?.find(item => item.name === 'update.json')
          if (!asset?.browser_download_url) throw new Error('该仓库尚未发布带 update.json 的安装版。')
          const location = new URL(asset.browser_download_url)
          const prefix = `/${source.owner}/${source.repo}/releases/download/`
          if (location.origin !== 'https://github.com' || !location.pathname.startsWith(prefix)) throw new Error('更新清单地址与所选仓库不一致。')
          url = location.href
        } else url = new URL('update.json', source.url).href
        const candidate = validateManifest(await json(url), version, url)
        if (source.provider === 'github' && !candidate.asset.url.startsWith(`https://github.com/${source.owner}/${source.repo}/releases/download/`)) throw new Error('安装包地址与所选仓库不一致。')
        if (compareVersions(candidate.version, version) > 0) { manifest = candidate; emit({ status: 'available', availableVersion: candidate.version, releaseNotes: notesText(candidate.notes), message: `发现新版本 ${candidate.version}。` }) }
        else { manifest = null; emit({ status: 'idle', availableVersion: null, message: '当前已是最新版本。' }) }
      } else {
        emit({ status: 'downloading', progress: { percent: 0 }, message: '正在下载更新…' })
        await fs.mkdir(downloadRoot, { recursive: true })
        const destination = path.join(downloadRoot, `OpenQuestionStudio-Setup-${manifest.version}.exe`), temporary = destination + '.' + crypto.randomBytes(5).toString('hex') + '.tmp'
        try {
          const response = await request(manifest.asset.url, { signal: AbortSignal.timeout(30 * 60 * 1000) })
          if (!response.ok || !response.body) throw new Error(`安装包下载失败：HTTP ${response.status}。`)
          let bytes = 0, previous = -1
          const hash = crypto.createHash('sha512')
          const progress = new Transform({ transform(chunk, _encoding, callback) {
            bytes += chunk.length
            if (bytes > manifest.asset.size) return callback(new Error('安装包大小超过更新清单，下载已停止。'))
            hash.update(chunk)
            const percent = Math.floor(bytes * 100 / manifest.asset.size)
            if (percent !== previous) { previous = percent; emit({ status: 'downloading', progress: { percent, transferred: bytes, total: manifest.asset.size }, message: '正在下载更新…' }) }
            callback(null, chunk)
          } })
          await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(temporary, { flags: 'wx' }))
          if (bytes !== manifest.asset.size || hash.digest('base64') !== manifest.asset.sha512) throw new Error('安装包校验不一致，未安装，请重新检查更新。')
          await fs.rename(temporary, destination)
          await fs.writeFile(pendingFile, JSON.stringify({ source: sourceText(source), manifest }, null, 2))
          downloadedFile = destination
          emit({ status: 'downloaded', availableVersion: manifest.version, progress: { percent: 100 }, message: '更新已下载并校验。点击安装后会先保存资料，再重启软件。' })
        } catch (error) { await fs.unlink(temporary).catch(() => {}); throw error }
      }
      return structuredClone(state)
    } catch (error) { emit({ status: 'error', message: '更新失败：' + error.message }); throw error }
    finally { active = false }
  }
  async function install() {
    if (state.status !== 'downloaded') throw new Error('更新尚未下载完成。')
    try {
      ready()
      if (!downloadedFile || (await fs.stat(downloadedFile)).size !== manifest.asset.size || await fileDigest(downloadedFile) !== manifest.asset.sha512) throw new Error('下载后的安装包已改变，请重新下载。')
      emit({ status: 'installing', message: '正在安装更新…' })
      await runInstaller(downloadedFile, ['/S', '--updated', '--force-run'])
    }
    catch (error) { emit({ status: 'error', message: '无法启动更新安装：' + error.message }); throw error }
  }
  return { initialize, configure, getState: () => structuredClone(state), check: () => operation('check'), download: () => operation('download'), install, canInstall: () => state.status === 'downloaded', shouldAutoCheck: () => installed && !!source && autoCheck && state.status !== 'downloaded' }
}
module.exports = { createUpdateManager, parseSource, sourceText, validateManifest, compareVersions, fileDigest, PRODUCT }
