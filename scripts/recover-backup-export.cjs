// Recover a complete backup without changing the source library.
const fs = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const assert = require('node:assert/strict')
const { collectImages, createStorage } = require('../electron/storage.cjs')
const { writeBackupFile, readBackupFile } = require('../electron/backup.cjs')

async function main() {
  const root = path.resolve(__dirname, '..'), storage = createStorage(path.join(root, 'data'))
  const { validateBackup } = await import('../src/domain.js')
  const snapshot = await fs.readFile(storage.dataFile), data = JSON.parse(snapshot.toString('utf8'))
  validateBackup(data)
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
  const name = `开放题记录库-全部记录-${date}-${crypto.randomBytes(3).toString('hex')}.json`, destination = path.join(root, 'backups', name)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await writeBackupFile(storage, data, destination, progress => { if (progress.completed % 25 === 0 || progress.completed === progress.total) console.log(`Export ${progress.completed}/${progress.total}`) })
  let verifiedImages = 0, verifiedRecords = 0
  const restored = await readBackupFile(destination, async (record, index) => {
    const original = data.records[index], expectedImages = collectImages(original), images = collectImages(record)
    assert.equal(images.length, expectedImages.length)
    for (const [imageIndex, image] of images.entries()) {
      const source = expectedImages[imageIndex]
      if (source.dataUrl) assert.equal(image.dataUrl, source.dataUrl)
      else {
        const expected = await fs.readFile(path.join(storage.attachments, source.fileName))
        assert.deepEqual(Buffer.from(image.dataUrl.split(',')[1], 'base64'), expected)
        delete image.dataUrl
      }
      if (Object.hasOwn(source, 'fileName')) image.fileName = source.fileName
      if (Object.hasOwn(source, 'url')) image.url = source.url
      verifiedImages++
    }
    assert.deepEqual(record, original); verifiedRecords++
    if (verifiedRecords % 25 === 0 || verifiedRecords === data.records.length) console.log(`Verify ${verifiedRecords}/${data.records.length}`)
    return record
  })
  validateBackup(restored); assert.equal(verifiedRecords, data.records.length)
  const result = { filePath: destination, records: verifiedRecords, imageReferences: verifiedImages, bytes: (await fs.stat(destination)).size, sourceSha256: crypto.createHash('sha256').update(snapshot).digest('hex'), sourceUnchanged: snapshot.equals(await fs.readFile(storage.dataFile)) }
  await fs.writeFile(path.join(root, 'test-results', 'large-backup-verification.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
