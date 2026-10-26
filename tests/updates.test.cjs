const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs/promises'), path = require('path'), crypto = require('crypto')
const { createUpdateManager, parseSource, compareVersions, PRODUCT } = require('../electron/update-manager.cjs')
const { resolveAppPaths } = require('../electron/app-paths.cjs')
const artifact = Buffer.from('MZ local test fixture: never executed')
const manifest = (version = '0.3.1') => ({ schemaVersion: 1, productId: PRODUCT, platform: 'win32', arch: 'x64', version, notes: '测试更新', asset: { url: 'https://updates.example.test/OpenQuestionStudio-Setup.exe', size: artifact.length, sha512: crypto.createHash('sha512').update(artifact).digest('base64') } })
async function fixture(request, version = '0.3.0') {
  const root = await fs.mkdtemp(path.resolve('test-results/updater-')), calls = [], states = []
  const options = { version, installed: true, profileRoot: root, resourcesPath: root, request, runInstaller: async (file, args) => calls.push({ file, args }), onState: state => states.push(state) }
  const manager = createUpdateManager(options); await manager.initialize()
  return { root, calls, states, manager, options }
}

test('update sources and versions reject unsafe URLs and invalid versions', () => {
  assert.deepEqual(parseSource('https://github.com/owner/repo.git'), { provider: 'github', owner: 'owner', repo: 'repo' })
  assert.deepEqual(parseSource('owner/repo'), { provider: 'github', owner: 'owner', repo: 'repo' })
  assert.deepEqual(parseSource('https://updates.example.test/releases'), { provider: 'generic', url: 'https://updates.example.test/releases/' })
  for (const source of ['http://example.test/', 'https://user:secret@example.test/', 'https://example.test/?token=secret', 'https://github.com/owner/repo/releases']) assert.throws(() => parseSource(source))
  assert.equal(compareVersions('0.3.1', '0.3.0'), 1); assert.equal(compareVersions('0.3.0', '0.3.0'), 0); assert.equal(compareVersions('0.2.9', '0.3.0'), -1)
  assert.throws(() => compareVersions('0.3.0-preview', '0.3.0'))
})

test('check/download/checksum/restart recovery work and modified installers cannot run', async () => {
  const current = manifest(), f = await fixture(async url => new Response(url.endsWith('update.json') ? JSON.stringify(current) : artifact))
  await f.manager.configure('https://updates.example.test/releases', true)
  await f.manager.check(); assert.equal(f.manager.getState().status, 'available'); assert.equal(f.calls.length, 0)
  await f.manager.download(); assert.equal(f.manager.getState().status, 'downloaded'); assert.ok(f.states.some(state => state.progress?.percent === 100)); assert.equal(f.calls.length, 0)
  const restored = createUpdateManager({ ...f.options, request: () => { throw Error('No network needed for recovery') } }); await restored.initialize(); assert.equal(restored.getState().status, 'downloaded')
  await restored.install(); assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0].args, ['/S', '--updated', '--force-run'])
  const guarded = createUpdateManager(f.options); await guarded.initialize(); await fs.writeFile(f.calls[0].file, Buffer.alloc(artifact.length, 1)); await assert.rejects(guarded.install(), /已改变/); assert.equal(f.calls.length, 1)
  const newer = createUpdateManager({ ...f.options, version: '0.3.1' }); await newer.initialize(); assert.equal(newer.getState().status, 'idle')
})

test('corrupt, oversized, wrong-product, older updates and service errors never install', async () => {
  let payload = manifest(), body = Buffer.from('wrong downloaded bytes')
  const f = await fixture(async url => new Response(url.endsWith('update.json') ? JSON.stringify(payload) : body))
  await f.manager.configure('https://updates.example.test/', false); await f.manager.check(); await assert.rejects(f.manager.download()); assert.equal(f.calls.length, 0)
  assert.equal((await fs.readdir(path.join(f.root, 'updates'))).filter(name => name.endsWith('.tmp')).length, 0)
  body = Buffer.alloc(artifact.length + 1); await f.manager.check(); await assert.rejects(f.manager.download(), /大小超过/); assert.equal(f.calls.length, 0)
  payload = manifest('0.2.9'); await f.manager.check(); assert.equal(f.manager.getState().status, 'idle')
  payload.productId = 'different.product'; await assert.rejects(f.manager.check(), /不属于本软件/); assert.equal(f.calls.length, 0)
  const unavailable = await fixture(async () => new Response('unavailable', { status: 503 })); await unavailable.manager.configure('https://updates.example.test/'); await assert.rejects(unavailable.manager.check(), /503/); assert.equal(unavailable.manager.getState().status, 'error')
})

test('GitHub checks accept assets from the chosen repository and reject substituted locations', async () => {
  const value = manifest(); value.asset.url = 'https://github.com/owner/repo/releases/download/v0.3.1/setup.exe'
  let assetUrl = 'https://github.com/owner/repo/releases/download/v0.3.1/update.json'
  const f = await fixture(async url => new Response(JSON.stringify(url.includes('api.github.com') ? { assets: [{ name: 'update.json', browser_download_url: assetUrl }] } : value)))
  await f.manager.configure('owner/repo'); await f.manager.check(); assert.equal(f.manager.getState().status, 'available')
  assetUrl = 'https://github.com/another/repo/releases/download/v0.3.1/update.json'; await assert.rejects(f.manager.check(), /不一致/)
})

test('installed paths remain outside program files and reuse an existing library across upgrades', async () => {
  const root = await fs.mkdtemp(path.resolve('test-results/installed-paths-')), resourcesPath = path.join(root, 'program', 'resources'), appData = path.join(root, 'appdata'), oldData = path.join(root, 'original-project', 'data')
  await fs.mkdir(resourcesPath, { recursive: true }); await fs.mkdir(oldData, { recursive: true }); await fs.writeFile(path.join(resourcesPath, 'installed-mode.json'), '{}'); await fs.writeFile(path.join(oldData, 'records.json'), '{"version":4,"records":[]}')
  const base = { projectRoot: path.join(root, 'project'), appData, resourcesPath, executablePath: path.join(root, 'program', 'studio.exe'), portableDirectory: null, testDataRoot: null }
  const associated = resolveAppPaths({ ...base, readLibrary: () => oldData })
  assert.equal(associated.mode, 'installed'); assert.equal(associated.dataRoot, oldData); assert.equal(associated.profileRoot, path.join(root, 'original-project', '.app-cache'))
  assert.equal(resolveAppPaths({ ...base, executablePath: path.join(root, 'new-program', 'studio.exe'), readLibrary: () => { throw Error('should use saved location') } }).dataRoot, oldData)
  const standalone = resolveAppPaths({ ...base, portableDirectory: root }); assert.equal(standalone.mode, 'portable'); assert.equal(standalone.dataRoot, path.join(base.projectRoot, 'data'))
  const isolated = resolveAppPaths({ ...base, testDataRoot: path.join(root, 'test'), readLibrary: () => { throw Error('No production registry in tests') } }); assert.equal(isolated.mode, 'test')
})
