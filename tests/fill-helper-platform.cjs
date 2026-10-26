const { chromium } = require('playwright')
const fs = require('fs/promises')
const path = require('path')
const assert = require('node:assert/strict')
const { createBackground, platformHTML } = require('./helpers/fill-platform-harness.cjs')

async function main() {
  const root = path.resolve(__dirname, '..'), extension = path.join(root, '专家填写助手-v1.5.1-排序与二轮修复版', 'Chrome扩展')
  const ids = ['900000000101', '900000000102', '900000000103']
  const rows = ['a', 'b', 'c'].map((id, index) => ({ id, name: '记录' + id.toUpperCase(), archived: false, overwriteMode: 'all', overwrite: true, createdAt: index + 1, updatedAt: index + 1, values: { 'question-input': '问题' + id, 'doubao-markdown-input': '模型1-' + id, 'arena1-markdown-input': '模型4-' + id, 'arena2-markdown-input': '模型5-' + id, 'ranking-reason-input': '排序说明-' + id }, attachments: {}, ranks: {}, syncRanking: false }))
  const browser = await chromium.launch({ executablePath: process.env.QF_TEST_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
  const errors = []
  try {
    await context.route('https://aidp.bytedance.com/**', async route => {
      const url = new URL(route.request().url())
      if (/\.(js|css|png|json)$/.test(url.pathname)) {
        const file = path.join(extension, path.basename(url.pathname))
        try { await route.fulfill({ body: await fs.readFile(file), contentType: url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'application/octet-stream' }) } catch { await route.fulfill({ status: 404, body: '' }) }
      } else await route.fulfill({ contentType: 'text/html;charset=utf-8', body: platformHTML(extension, url.searchParams.get('itemID') || ids[0], ids) })
    })
    const bg = createBackground(extension, context, rows)
    const call = async (type, values = {}) => { const result = await bg.dispatch({ type, ...values }); assert.equal(result.ok, true, result.error); return result.result }
    const first = await context.newPage(); first.on('pageerror', error => errors.push(error.message))
    const tabA = bg.register(first, { active: true })
    await first.goto(`https://aidp.bytedance.com/task?taskId=mock&itemID=${ids[0]}`)
    const keyA = `${tabA}:${ids[0]}`
    assert.equal((await call('qf-fill', { draftId: 'a', targetKey: keyA })).draftId, 'a')
    assert.equal((await call('qf-fill', { draftId: 'b', targetKey: keyA })).draftId, 'a')
    assert.equal(await first.locator('[data-field-id=question-input]').inputValue(), '问题a')
    // Open the next question in a separate tab, preserving the original page.
    const chosenB = await call('qf-select-target', { draftId: 'b', targetKey: `${tabA}:${ids[1]}`, editorId: 'test-editor' })
    assert.notEqual(chosenB.target.tabId, tabA)
    assert.ok(first.url().includes(ids[0]))
    const keyB = chosenB.targetKey
    assert.equal((await call('qf-fill', { draftId: 'b', targetKey: keyB })).draftId, 'b')
    assert.equal((await call('qf-select-target', { draftId: 'b', targetKey: keyA, editorId: 'test-editor' })).draftId, 'a')
    await call('qf-bind-record', { draftId: 'c', targetKey: keyA })
    assert.equal((await call('qf-fill', { draftId: 'b', targetKey: keyA })).draftId, 'c')
    assert.equal(await first.locator('[data-field-id=question-input]').inputValue(), '问题c')
    await call('qf-bind-record', { draftId: 'a', targetKey: keyA })
    const originalBindings = (await bg.storage.local.get('questionRecordBindings')).questionRecordBindings
    assert.equal(originalBindings[ids[0]].firstDraftId, 'a')
    assert.equal(originalBindings[ids[0]].draftId, 'a')
    const tabB = chosenB.target.tabId, second = bg.pages.get(tabB).page
    const createTab = bg.chrome.tabs.create
    bg.chrome.tabs.create = async options => { if (options.url.includes(ids[2])) await new Promise(resolve => setTimeout(resolve, 400)); return createTab(options) }
    const oldSelection = bg.dispatch({ type: 'qf-select-target', draftId: 'a', targetKey: `${tabA}:${ids[2]}`, editorId: 'race-editor' })
    await new Promise(resolve => setTimeout(resolve, 30))
    const newSelection = bg.dispatch({ type: 'qf-select-target', draftId: 'b', targetKey: keyB, editorId: 'race-editor' })
    const raced = await Promise.all([oldSelection, newSelection])
    assert.equal(raced[0].result.stale, true)
    assert.equal(raced[1].result.draftId, 'b')
    bg.chrome.tabs.create = createTab

    // Real editor DOM with a mock Chrome transport; only the extension-origin
    // check is adapted to the local test origin. All UI logic runs unchanged.
    await context.route('http://127.0.0.1:43127/**', async route => {
      const name = path.basename(new URL(route.request().url()).pathname), file = path.join(extension, name)
      try {
        let body = await fs.readFile(file)
        if (name === 'app.js') body = Buffer.from(body.toString().replace("location.protocol==='chrome-extension:' && !!globalThis.chrome?.runtime?.id", "!!globalThis.chrome?.runtime?.id"))
        await route.fulfill({ body, contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.html') ? 'text/html;charset=utf-8' : name.endsWith('.css') ? 'text/css' : name.endsWith('.json') ? 'application/json' : 'image/png' })
      } catch { await route.fulfill({ status: 404, body: '' }) }
    })
    const editor = await context.newPage(); editor.on('pageerror', error => errors.push(error.message))
    await editor.exposeFunction('__qfBridge', async request => {
      if (request.op === 'message') return bg.dispatch(request.message)
      if (request.op === 'get') return bg.storage[request.area].get(request.keys)
      if (request.op === 'set') return bg.storage[request.area].set(request.values)
      if (request.op === 'tab') return bg.get(request.id)
      if (request.op === 'activate') return bg.chrome.tabs.update(request.id, { active: true })
      return { id: 1 }
    })
    await editor.addInitScript(() => {
      globalThis.__qfStorageListeners = []
      const area = name => ({ get: keys => __qfBridge({ op: 'get', area: name, keys }), set: values => __qfBridge({ op: 'set', area: name, values }) })
      globalThis.chrome = { runtime: { id: 'test', sendMessage: message => __qfBridge({ op: 'message', message }), getURL: name => 'http://127.0.0.1:43127/' + name }, storage: { local: area('local'), session: area('session'), onChanged: { addListener: listener => __qfStorageListeners.push(listener) } }, tabs: { get: id => __qfBridge({ op: 'tab', id }), update: (id) => __qfBridge({ op: 'activate', id }) }, windows: { getCurrent: async () => ({ id: 1 }), update: async () => ({}) } }
    })
    bg.storage.onChanged.addListener((changes, area) => { if (!editor.isClosed()) editor.evaluate(({ changes, area }) => { for (const listener of __qfStorageListeners) listener(changes, area) }, { changes, area }).catch(() => {}) })
    await editor.goto('http://127.0.0.1:43127/app.html')
    await editor.waitForFunction(() => !!document.querySelector('[data-field]'))
    await editor.evaluate(async rows => { await QFDB.putMany(rows); await draftList(); await selectDraft('a', true) }, rows)
    // Background and editor now share the actual browser database.
    bg.db.get = id => editor.evaluate(id => QFDB.get(id), id)
    bg.db.summaries = () => editor.evaluate(() => QFDB.summaries())
    bg.db.setArchived = (id, archived) => editor.evaluate(async ({ id, archived }) => { const row = await QFDB.setArchived(id, archived); window.dispatchEvent(new Event('qf-archive-changed')); return row }, { id, archived })
    await editor.locator('#targetTab').selectOption(keyB)
    await editor.waitForFunction(() => document.getElementById('draftSelect').value === 'b' && !document.getElementById('fillBtn').disabled)
    assert.equal(await editor.locator('#f-question-input').inputValue(), '问题b')
    await editor.locator('#targetTab').selectOption(keyA)
    await editor.waitForFunction(() => document.getElementById('draftSelect').value === 'a' && !document.getElementById('fillBtn').disabled)
    await editor.locator('#draftSelect').selectOption('c')
    await editor.waitForFunction(() => document.getElementById('draftSelect').value === 'c' && !document.getElementById('fillBtn').disabled)
    assert.equal((await bg.storage.local.get('questionRecordBindings')).questionRecordBindings[ids[0]].draftId, 'c')
    await editor.locator('#targetTab').selectOption(keyB)
    await editor.waitForFunction(() => document.getElementById('draftSelect').value === 'b' && !document.getElementById('fillBtn').disabled)
    await editor.locator('#targetTab').selectOption(keyA)
    await editor.waitForFunction(() => document.getElementById('draftSelect').value === 'c' && !document.getElementById('fillBtn').disabled)
    await editor.locator('#overwriteMode').selectOption('later')
    const mode = await editor.evaluate(async () => { await saveNow(); const packed = await QFPortable.pack([await QFDB.get('c')], 'c'); return (await QFPortable.unpack(packed))[0].overwriteMode })
    assert.equal(mode, 'later')
    const popupContext = await call('qf-tab-context', { tabId: tabA })
    assert.equal(popupContext.draftId, 'c')
    assert.equal(popupContext.overwriteMode, 'later')

    // Observe a real DOM question switch and submission, including stale URL.
    await first.exposeFunction('__platformMessage', message => bg.dispatch(message, { tab: { id: tabA } }))
    await first.evaluate(() => { globalThis.chrome = { runtime: { sendMessage: message => __platformMessage(message) } } })
    await first.addScriptTag({ path: path.join(extension, 'question-probe.js') })
    await first.addScriptTag({ path: path.join(extension, 'platform-watch.js') })
    await first.locator(`[data-question-id="${ids[1]}"]`).click()
    await editor.waitForFunction(() => document.getElementById('draftSelect').value === 'b' && document.getElementById('targetTab').value.endsWith(':900000000102'))
    await first.evaluate(() => { window.failSubmit = true })
    await first.locator('#submitMock').click()
    assert.equal((await call('qf-tabs', { force: true })).tabs.some(tab => tab.questionId === ids[1]), true)
    assert.equal(await editor.evaluate(async () => (await QFDB.get('b')).archived), false)
    await first.evaluate(() => { window.failSubmit = false })
    await first.locator('#submitMock').click()
    await editor.waitForFunction(async () => (await QFDB.get('b')).archived)
    await editor.waitForFunction(() => !Array.from(document.getElementById('targetTab').options).some(option => option.value.endsWith(':900000000102')))
    assert.ok(first.url().includes(ids[1]))
    assert.equal((await call('qf-tabs', { force: true })).tabs.some(tab => tab.questionId === ids[1]), false)
    const blocked = await bg.dispatch({ type: 'qf-fill', draftId: 'a', targetKey: keyB })
    assert.equal(blocked.ok, false)
    // A removed list item disappears without treating loading/removal as proof of submission.
    await first.evaluate(id => document.querySelector(`[data-question-id="${id}"]`).remove(), ids[2])
    for (const value of bg.pages.values()) value.active = false
    assert.equal((await call('qf-tabs', { force: true })).tabs.some(tab => tab.questionId === ids[2]), false)
    assert.equal(await editor.evaluate(async () => (await QFDB.get('c')).archived), false)
    await editor.evaluate(() => QFDB.setArchived('c', true))
    const hidden = await call('qf-tabs', { force: true })
    assert.equal(hidden.tabs.some(tab => tab.questionId === ids[0]), false)
    await editor.screenshot({ path: path.join(root, 'test-results', 'fill-helper-binding.png') })

    // Scoped overwrite uses the real shipped engine, including previous history.
    const form = await context.newPage(); form.on('pageerror', error => errors.push(error.message))
    await form.goto(`https://aidp.bytedance.com/task?taskId=overwrite&itemID=${ids[2]}`)
    await form.addScriptTag({ path: path.join(extension, 'engine.js') })
    const fields = [
      { id: 'question-input', type: 'text', section: 'author', label: '题目', value: '新题目' },
      { id: 'doubao-markdown-input', type: 'text', section: 'doubao', label: '模型1', value: '模型1新回复' },
      { id: 'arena1-markdown-input', type: 'text', section: 'arena1', label: '模型4', value: '模型4新回复' },
      { id: 'arena2-markdown-input', type: 'text', section: 'arena2', label: '模型5', value: '模型5新回复' },
      { id: 'ranking-reason-input', type: 'text', section: 'ranking', label: '排序说明', value: '新排序说明' },
    ]
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2HsAAAAASUVORK5CYII='
    for (const [section, label] of [['doubao', '模型1截图'], ['arena1', '模型4截图']]) {
      await form.locator(`[data-field-id=${section}-screenshot-file-input]`).setInputFiles({ name: '旧截图.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
      fields.push({ id: section + '-screenshot-file-input', type: 'file', section, label, value: [{ name: '新截图.png', type: 'image/png', lastModified: 10, base64: png }] })
    }
    await form.evaluate(() => {
      window.imageDeletes = { doubao: 0, arena1: 0 }
      for (const section of ['doubao', 'arena1']) {
        const button = document.createElement('button'); button.dataset.fieldId = section + '-screenshot-delete-0'; button.textContent = '删除旧截图'
        button.onclick = () => { window.imageDeletes[section]++; button.remove() }
        document.querySelector(`[data-field-id=${section}-response-card]`).append(button)
      }
    })
    await form.evaluate(fields => { for (const field of fields.filter(field => field.type !== 'file')) document.querySelector(`[data-field-id="${field.id}"]`).value = '网页原值' }, fields)
    const execute = async (overwriteMode, ranking = null) => form.evaluate(payload => qualityFillEngine(payload), { draftId: 'overwrite-test', fields, overwriteMode, ranking, expectedQuestionId: ids[2], platformOnly: true })
    await execute('none')
    assert.deepEqual(await form.evaluate(() => window.imageDeletes), { doubao: 0, arena1: 0 })
    assert.equal(await form.locator('[data-field-id=arena1-markdown-input]').inputValue(), '网页原值')
    await execute('later', [['claude', 'doubao'], ['gpt56', 'arena1'], ['arena2']])
    assert.equal(await form.locator('[data-field-id=question-input]').inputValue(), '网页原值')
    assert.equal(await form.locator('[data-field-id=doubao-markdown-input]').inputValue(), '网页原值')
    assert.equal(await form.locator('[data-field-id=arena1-markdown-input]').inputValue(), '模型4新回复')
    assert.equal(await form.locator('[data-field-id=ranking-reason-input]').inputValue(), '新排序说明')
    assert.deepEqual(await form.evaluate(() => window.imageDeletes), { doubao: 0, arena1: 1 })
    assert.equal(await form.locator('[data-field-id=doubao-screenshot-file-input]').evaluate(el => el.files[0].name), '旧截图.png')
    assert.equal(await form.locator('[data-field-id=arena1-screenshot-file-input]').evaluate(el => el.files[0].name), '新截图.png')
    fields[2].value = '模型4再次改写'
    await execute('later')
    assert.equal(await form.locator('[data-field-id=arena1-markdown-input]').inputValue(), '模型4再次改写')
    await execute('all', [['doubao'], ['gpt56'], ['claude'], ['arena1'], ['arena2']])
    assert.equal(await form.locator('[data-field-id=question-input]').inputValue(), '新题目')
    assert.equal(await form.locator('[data-field-id=doubao-markdown-input]').inputValue(), '模型1新回复')
    assert.deepEqual(await form.evaluate(() => window.imageDeletes), { doubao: 1, arena1: 1 })
    fields[0].value = '覆盖全部再次改写题目'
    await execute('all')
    assert.equal(await form.locator('[data-field-id=question-input]').inputValue(), fields[0].value)
    await form.locator('[data-field-id=question-input]').fill('')
    await execute('later')
    assert.equal(await form.locator('[data-field-id=question-input]').inputValue(), fields[0].value)
    await form.addScriptTag({ path: path.join(extension, 'question-probe.js') })
    await form.evaluate(id => { const hidden = document.createElement('span'); hidden.style.display = 'none'; hidden.textContent = '已提交'; document.querySelector(`[data-question-id="${id}"]`).append(hidden) }, ids[0])
    const cleanProbe = await form.evaluate(() => qualityQuestionProbe())
    assert.ok(cleanProbe.questions.some(question => question.questionId === ids[0]))
    await form.evaluate(id => document.querySelector(`[data-question-id="${id}"]`).dataset.status = 'completed', ids[1])
    assert.ok((await form.evaluate(() => qualityQuestionProbe())).retiredQuestionIds.includes(ids[1]))
    assert.deepEqual(errors, [])
    console.log('Platform fixes passed: first binding and explicit replacement, cross-tab reuse, real editor target/record following, platform navigation observation, failed/successful submission, stale URL and archive cleanup, persistent overwrite modes, scoped/history-aware overwrite and rankings.')
  } finally { await context.close(); await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
