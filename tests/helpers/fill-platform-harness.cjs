const fs = require('fs')
const vm = require('vm')
const path = require('path')
const { webcrypto } = require('crypto')

function event() { const listeners = []; return { addListener: listener => listeners.push(listener), emit: (...args) => { for (const listener of listeners) Promise.resolve(listener(...args)).catch(() => {}) } } }
function createBackground(extension, context, initialRows, sharedStorage) {
  const changes = event(), pages = new Map(), rows = new Map(initialRows.map(row => [row.id, structuredClone(row)]))
  const storage = sharedStorage || Object.fromEntries(['local', 'session'].map(name => {
    const data = {}
    return [name, { data, async get(keys) { if (!keys) return structuredClone(data); return Object.fromEntries((typeof keys === 'string' ? [keys] : keys).filter(key => key in data).map(key => [key, structuredClone(data[key])])) }, async set(values) { const delta = {}; for (const [key, value] of Object.entries(values)) { if (JSON.stringify(data[key]) !== JSON.stringify(value)) delta[key] = { oldValue: data[key], newValue: structuredClone(value) }; data[key] = structuredClone(value) } if (Object.keys(delta).length) changes.emit(delta, name) } }]
  }))
  storage.onChanged = changes
  let nextId = 1, listener, calls = []
  const db = { get: async id => rows.has(id) ? structuredClone(rows.get(id)) : null, summaries: async () => [...rows.values()].map(row => ({ id: row.id, name: row.name, archived: !!row.archived })), all: async () => structuredClone([...rows.values()]), isArchived: row => !!row?.archived, setArchived: async (id, archived) => { const row = rows.get(id); if (!row) throw Error('missing'); row.archived = archived; return structuredClone(row) } }
  const get = async id => { const value = pages.get(id); if (!value || value.page.isClosed()) throw Error('Tab closed'); return { id, windowId: value.windowId, index: value.index, active: value.active, url: value.page.url(), title: await value.page.title(), status: 'complete' } }
  const chrome = {
    storage,
    tabs: {
      async get(id) { return get(id) },
      async query(filter) { const result = []; for (const [id, value] of pages) { if (value.page.isClosed()) continue; const tab = await get(id); if (filter?.windowId !== undefined && tab.windowId !== filter.windowId || filter?.active !== undefined && tab.active !== filter.active) continue; if (filter?.url && !tab.url.startsWith('https://aidp.bytedance.com/')) continue; result.push(tab) } return result },
      async create(options) { const page = await context.newPage(); const id = register(page, { active: !!options.active, windowId: options.windowId || 1 }); await page.goto(options.url); return get(id) },
      async update(id, update) { const value = pages.get(id); if (update.active) { for (const other of pages.values()) if (other.windowId === value.windowId) other.active = false; value.active = true; chrome.tabs.onActivated.emit({ tabId: id, windowId: value.windowId }) } return get(id) },
      sendMessage: async () => ({}), onRemoved: event(), onUpdated: event(), onActivated: event(),
    },
    scripting: { async executeScript(request) { calls.push(request); const page = pages.get(request.target.tabId)?.page; if (!page) throw Error('Tab not found'); if (request.files) return [{ result: null }]; return [{ result: await page.evaluate(request.func, request.args?.[0]) }] } },
    runtime: { id:'a'.repeat(32), onMessage: { addListener: value => { listener = value } }, getContexts: async () => [], getURL: name => 'chrome-extension://test/' + name },
    windows: { update: async () => ({}), getCurrent: async () => ({ id: 1 }) }, sidePanel: { open: async () => ({}) },
  }
  const sandbox = vm.createContext({ console, chrome, QFDB: db, URL, fetch, AbortSignal, structuredClone, setTimeout, clearTimeout, Map, Set, File, Blob, Uint8Array, TextEncoder, crypto: webcrypto, btoa, atob, Event, addEventListener() {} })
  sandbox.importScripts = (...names) => { for (const name of names) if (name !== 'db.js') vm.runInContext(fs.readFileSync(path.join(extension, name), 'utf8'), sandbox, { filename: name }) }
  vm.runInContext(fs.readFileSync(path.join(extension, 'background.js'), 'utf8'), sandbox, { filename: 'background.js' })
  const dispatch = (message, sender = {}) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Message timed out: ' + message.type)), 45000)
    listener(message, sender, response => { clearTimeout(timeout); resolve(response) })
  })
  function register(page, options = {}) { const id = nextId++; pages.set(id, { page, windowId: options.windowId || 1, index: id, active: options.active !== false }); return id }
  return { chrome, db, rows, storage, pages, sandbox, calls, dispatch, register, get }
}

function platformHTML(extension, questionId, ids) {
  let html = fs.readFileSync(path.join(extension, 'portable-demo.html'), 'utf8')
  html = html.replace('<title>专家填写助手 · 逐步解锁演示</title>', '<title>AI数据服务平台 · 本地模拟</title>')
  html = html.replace('<main>', '<aside data-question-list style="position:fixed;left:0;top:0;width:180px;background:white">' + ids.map(id => `<button data-question-id="${id}" style="display:block;margin:8px">${id}</button>`).join('') + '</aside><main style="margin-left:210px">')
  html = html.replace('90000000001', questionId)
  html = html.replace('</main>', '<button id="submitMock">提交</button><div id="notices"></div></main>')
  html += `<script>document.getElementById('unlock').click();document.querySelectorAll('[data-question-id]').forEach(button=>button.onclick=()=>{const id=button.dataset.questionId;document.getElementById('item').textContent=id;const url=new URL(location.href);url.searchParams.set('itemID',id);history.pushState({},'',url.href);});document.getElementById('submitMock').onclick=()=>{const id=document.getElementById('item').textContent;document.querySelector('[data-question-id="'+id+'"]').remove();const notice=document.createElement('p');notice.setAttribute('role','alert');notice.textContent=window.failSubmit?'提交失败':'提交成功';document.getElementById('notices').append(notice);if(window.failSubmit){const button=document.createElement('button');button.dataset.questionId=id;button.textContent=id;document.querySelector('[data-question-list]').append(button);}};</script>`
  return html
}
module.exports = { createBackground, platformHTML }
