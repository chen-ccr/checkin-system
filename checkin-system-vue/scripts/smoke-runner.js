#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { createRequire } = require('node:module')
const serverRequire = createRequire(path.join(__dirname, '../server/package.json'))
const express = serverRequire('express')
const bodyParser = serverRequire('body-parser')
const ExcelJS = serverRequire('exceljs')
const buildV1Router = serverRequire('./src/routes/v1')
const { notFoundHandler, errorHandler } = serverRequire('./src/middleware/errorHandler')
const { createTestService } = serverRequire('./src/testing/createTestService')

function parseArgs(argv) {
  const parsed = {}
  for (const arg of argv) {
    const [key, value] = arg.split('=')
    if (key.startsWith('--')) {
      parsed[key.slice(2)] = value === undefined ? 'true' : value
    }
  }
  return parsed
}

function normalizeMode(mode) {
  if (mode === 'local' || mode === 'docker') return mode
  throw new Error(`不支持的冒烟模式: ${mode}`)
}

function createApiServer() {
  const app = express()
  const service = createTestService()
  app.use(bodyParser.json())
  app.use('/api/v1', buildV1Router(service))
  app.use(notFoundHandler)
  app.use(errorHandler)
  return new Promise((resolve, reject) => {
    const server = http.createServer(app)
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({
        port: address.port,
        close: () => new Promise((done) => server.close(done))
      })
    })
  })
}

function resolveContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.html') return 'text/html; charset=utf-8'
  if (ext === '.js') return 'application/javascript; charset=utf-8'
  if (ext === '.css') return 'text/css; charset=utf-8'
  if (ext === '.json') return 'application/json; charset=utf-8'
  if (ext === '.svg') return 'image/svg+xml'
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  return 'application/octet-stream'
}

function createStaticServer(distDir, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const requestPath = decodeURIComponent((req.url || '/').split('?')[0])
      const normalizedPath = requestPath === '/' ? '/index.html' : requestPath
      const resolvedFile = path.resolve(distDir, `.${normalizedPath}`)
      if (!resolvedFile.startsWith(path.resolve(distDir))) {
        res.statusCode = 403
        res.end('Forbidden')
        return
      }
      fs.readFile(resolvedFile, (err, content) => {
        if (err) {
          res.statusCode = 404
          res.end('Not Found')
          return
        }
        res.statusCode = 200
        res.setHeader('Content-Type', resolveContentType(resolvedFile))
        res.end(content)
      })
    })
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      resolve({
        close: () => new Promise((done) => server.close(done))
      })
    })
  })
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options)
  const body = await response.json()
  return { response, body }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const mode = normalizeMode(args.mode || 'docker')
  const rootDir = path.resolve(args.rootDir || path.join(__dirname, '..'))
  const evidenceFile = path.resolve(args.evidenceFile || path.join(rootDir, 'smoke-evidence', 'smoke-last.json'))
  const serverPort = Number(args.serverPort || 3001)
  const h5Port = Number(args.h5Port || 8091)
  const adminPort = Number(args.adminPort || 8090)
  const startedAt = new Date().toISOString()
  const checks = []
  const closers = []
  const apiBaseUrl = mode === 'local' ? undefined : `http://127.0.0.1:${serverPort}`

  const record = (name, status, detail = {}) => {
    checks.push({ name, status, detail, at: new Date().toISOString() })
    const prefix = status === 'PASS' ? '[smoke] ✅' : '[smoke] ❌'
    console.log(`${prefix} ${name}`)
  }

  try {
    if (mode === 'local') {
      const h5Dist = path.join(rootDir, 'h5', 'dist')
      const adminDist = path.join(rootDir, 'admin', 'dist')
      if (!fs.existsSync(path.join(h5Dist, 'index.html'))) {
        throw new Error(`缺少前端产物: ${path.join(h5Dist, 'index.html')}`)
      }
      if (!fs.existsSync(path.join(adminDist, 'index.html'))) {
        throw new Error(`缺少前端产物: ${path.join(adminDist, 'index.html')}`)
      }

      const apiServer = await createApiServer()
      const h5Server = await createStaticServer(h5Dist, h5Port)
      const adminServer = await createStaticServer(adminDist, adminPort)
      closers.push(apiServer.close, h5Server.close, adminServer.close)
      record('本地冒烟服务启动', 'PASS', { apiPort: apiServer.port, h5Port, adminPort })
      await runChecks({ baseUrl: `http://127.0.0.1:${apiServer.port}`, h5Port, adminPort, record })
    } else {
      await runChecks({ baseUrl: apiBaseUrl, h5Port, adminPort, record })
    }

    const evidence = {
      passed: true,
      mode,
      startedAt,
      finishedAt: new Date().toISOString(),
      checks
    }
    fs.mkdirSync(path.dirname(evidenceFile), { recursive: true })
    fs.writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
    console.log(`[smoke] 证据文件: ${evidenceFile}`)
  } catch (error) {
    const evidence = {
      passed: false,
      mode,
      startedAt,
      finishedAt: new Date().toISOString(),
      checks,
      error: error.message
    }
    fs.mkdirSync(path.dirname(evidenceFile), { recursive: true })
    fs.writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
    console.error(`[smoke] 失败，证据文件: ${evidenceFile}`)
    throw error
  } finally {
    while (closers.length) {
      const close = closers.pop()
      await close()
    }
  }
}

async function runChecks({ baseUrl, h5Port, adminPort, record }) {
  const h5Res = await fetch(`http://127.0.0.1:${h5Port}`)
  if (!h5Res.ok) throw new Error(`h5 页面不可达: ${h5Res.status}`)
  record('h5 页面可访问', 'PASS', { status: h5Res.status })

  const adminRes = await fetch(`http://127.0.0.1:${adminPort}`)
  if (!adminRes.ok) throw new Error(`admin 页面不可达: ${adminRes.status}`)
  record('admin 页面可访问', 'PASS', { status: adminRes.status })

  const login = await requestJson(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'test123' })
  })
  if (login.response.status !== 200 || !login.body?.data?.token) {
    throw new Error(`登录失败: ${login.response.status}`)
  }
  const token = login.body.data.token
  record('登录鉴权可用', 'PASS', { status: login.response.status })

  const planRes = await fetch(`${baseUrl}/api/v1/checkins/plan?userId=test123`)
  if (!planRes.ok) throw new Error(`打卡计划失败: ${planRes.status}`)
  record('打卡计划接口可用', 'PASS', { status: planRes.status })

  const statsRes = await fetch(`${baseUrl}/api/v1/stats/daily`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!statsRes.ok) throw new Error(`受保护统计失败: ${statsRes.status}`)
  record('受保护统计接口可用', 'PASS', { status: statsRes.status })

  const precheckRes = await fetch(`${baseUrl}/api/v1/checkins/precheck`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'staff001', lat: 26.5668, lng: 107.5173 })
  })
  if (!precheckRes.ok) throw new Error(`围栏预检失败: ${precheckRes.status}`)
  record('围栏预检接口可用', 'PASS', { status: precheckRes.status })

  const exportRes = await fetch(`${baseUrl}/api/v1/admin/export`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!exportRes.ok) throw new Error(`导出接口失败: ${exportRes.status}`)
  const contentType = exportRes.headers.get('content-type') || ''
  const disposition = exportRes.headers.get('content-disposition') || ''
  if (!contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) {
    throw new Error(`导出content-type异常: ${contentType}`)
  }
  if (!disposition.includes('.xlsx')) {
    throw new Error(`导出content-disposition异常: ${disposition}`)
  }
  const workbook = new ExcelJS.Workbook()
  const exportBuffer = Buffer.from(await exportRes.arrayBuffer())
  await workbook.xlsx.load(exportBuffer)
  if (workbook.worksheets.length !== 2) {
    throw new Error(`导出sheet数量异常: ${workbook.worksheets.length}`)
  }
  record('xlsx双报表导出可用', 'PASS', {
    status: exportRes.status,
    contentType,
    disposition,
    worksheetCount: workbook.worksheets.length
  })
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
