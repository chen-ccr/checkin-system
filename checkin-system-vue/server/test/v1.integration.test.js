const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const express = require('express')
const bodyParser = require('body-parser')
const ExcelJS = require('exceljs')
const buildV1Router = require('../src/routes/v1')
const { notFoundHandler, errorHandler } = require('../src/middleware/errorHandler')
const { createTestService } = require('../src/testing/createTestService')

async function createServer() {
  const app = express()
  const service = createTestService()
  app.use(bodyParser.json())
  app.use('/api/v1', buildV1Router(service))
  app.use(notFoundHandler)
  app.use(errorHandler)
  const server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => new Promise((resolve) => server.close(resolve))
  }
}

test('API 集成：鉴权、打卡、统计、导出流程可用', async () => {
  const { baseUrl, close } = await createServer()
  try {
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'test123' })
    })
    assert.equal(loginRes.status, 200)
    const loginData = await loginRes.json()
    assert.equal(loginData.code, 'OK')
    assert.ok(loginData.data.token)
    const token = loginData.data.token

    const unauthorized = await fetch(`${baseUrl}/api/v1/stats/daily`)
    assert.equal(unauthorized.status, 401)

    const checkinRes = await fetch(`${baseUrl}/api/v1/checkins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'staff001', lat: 26.5668, lng: 107.5173 })
    })
    assert.equal(checkinRes.status, 200)
    const checkinData = await checkinRes.json()
    assert.equal(checkinData.code, 'OK')
    assert.equal(checkinData.data.source, 'ONLINE')

    const offlineRes = await fetch(`${baseUrl}/api/v1/checkins/offline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ userId: 'staff001', lat: 26.5668, lng: 107.5173, punchedAt: '2026-05-01T08:15:00' }]
      })
    })
    assert.equal(offlineRes.status, 200)
    const offlineData = await offlineRes.json()
    assert.equal(offlineData.code, 'OK')
    assert.equal(offlineData.data[0].source, 'OFFLINE')

    const statsRes = await fetch(`${baseUrl}/api/v1/stats/daily`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    assert.equal(statsRes.status, 200)
    const statsData = await statsRes.json()
    assert.equal(statsData.code, 'OK')
    assert.equal(statsData.data.total, 2)

    const exportRes = await fetch(`${baseUrl}/api/v1/admin/export`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    assert.equal(exportRes.status, 200)
    assert.equal(
      exportRes.headers.get('content-type'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    assert.ok((exportRes.headers.get('content-disposition') || '').includes('.xlsx'))
    const exportBuffer = Buffer.from(await exportRes.arrayBuffer())
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(exportBuffer)
    assert.equal(workbook.worksheets.length, 2)
    assert.equal(workbook.getWorksheet('明细报表').getRow(1).getCell(1).value, '日期')
  } finally {
    await close()
  }
})
