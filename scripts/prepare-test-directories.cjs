const fs = require('fs/promises')
const path = require('path')
fs.mkdir(path.resolve(__dirname, '../test-results'), { recursive: true }).catch(error => { console.error(error); process.exitCode = 1 })
