const http = require('http')
const crypto = require('crypto')

async function startSharedBridge({ repository, identity, port = 17843 }) {
  const originAllowed = origin => !origin || /^chrome-extension:\/\/[a-p]{32}$/.test(origin) || /^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(origin)
  const body = request => new Promise((resolve, reject) => {
    let size = 0, chunks = []
    request.on('data', chunk => { size += chunk.length; if (size > 160 * 1024 * 1024) { reject(Object.assign(new Error('单次导入过大，请分批导入'), { status: 413 })); request.destroy(); return } chunks.push(chunk) })
    request.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { reject(new Error('JSON格式无效')) } }); request.on('error', reject)
  })
  let address
  const server = http.createServer(async (request, response) => {
    const reply = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)) }
    try {
      if (request.headers.host !== `127.0.0.1:${address.port}` || !originAllowed(request.headers.origin)) return reply(403, { error: '不允许的连接来源' })
      if (request.headers.origin) response.setHeader('Access-Control-Allow-Origin', request.headers.origin)
      response.setHeader('Vary', 'Origin'); response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); response.setHeader('Access-Control-Allow-Private-Network', 'true')
      if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return }
      const token = String(request.headers.authorization || '').replace(/^Bearer /, ''), expected = Buffer.from(identity.token)
      if (Buffer.byteLength(token) !== expected.length || !crypto.timingSafeEqual(Buffer.from(token), expected)) return reply(401, { error: '连接码无效，请从存题软件重新复制连接码' })
      const url = new URL(request.url, `http://127.0.0.1:${address.port}`)
      if (request.method === 'GET' && url.pathname === '/v1/info') return reply(200, { libraryId: identity.libraryId, version: 1, name: '开放题记录库' })
      if (request.method === 'GET' && url.pathname === '/v1/records') return reply(200, await repository.summaries())
      const match = url.pathname.match(/^\/v1\/records\/([A-Za-z0-9_-]{1,100})(?:\/(patch|archive|delete))?$/)
      if (match && request.method === 'GET' && !match[2]) return reply(200, await repository.record(match[1], url.searchParams.get('images') === '1'))
      if (request.method === 'POST' && url.pathname === '/v1/import') return reply(200, await repository.importRecords((await body(request)).records))
      if (match && request.method === 'POST') {
        const data = await body(request)
        if (match[2] === 'patch') return reply(200, await repository.patch(match[1], data.changes))
        if (match[2] === 'archive') return reply(200, await repository.setArchived(match[1], data.archived))
        if (match[2] === 'delete') return reply(200, await repository.remove(match[1], data.revision))
      }
      reply(404, { error: '接口不存在' })
    } catch (error) { if (!response.headersSent) reply(error.status || 400, { error: error.message, code: error.code, conflicts: error.conflicts }) }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  address = server.address()
  return { port: address.port, pairingCode: `oqs-shared:v1:${address.port}:${identity.libraryId}:${identity.token}`, libraryId: identity.libraryId, close: () => new Promise(resolve => server.close(resolve)) }
}
module.exports = { startSharedBridge }
