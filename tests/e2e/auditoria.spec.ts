import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { loadTestEnv } from '../../scripts/test-env.mjs'

const API = () => process.env.E2E_API_BASE!

test('CA-04 seguridad: cada lectura guarda IP y navegador de origen', async ({ request }) => {
  const login = await (
    await request.post(`${API()}/api/auth/login`, {
      data: { username: process.env.E2E_USER, password: process.env.E2E_PASS },
    })
  ).json()
  const id = `AUD${Date.now().toString(36).toUpperCase()}`.slice(0, 12)
  const batch = await request.post(`${API()}/api/labels/batch`, {
    headers: { Authorization: `Bearer ${login.token}` },
    data: {
      labels: [
        { id, fecha: '2026-01-15T08:00', empresa: 'Agrícola Esmeralda', csg: 'CSG001', especie: 'Cereza', variedad: 'Lapins', centroCosto: 'CC01', sector: 'S-AUD' },
      ],
    },
  })
  expect((await batch.json()).ok).toBe(true)

  const mov = await request.post(`${API()}/api/movements`, {
    headers: { 'user-agent': 'E2E-Auditoria/1.0' },
    data: { labelId: id, type: 'jc', cantidad: 5, precioClp: 1000, jh: 4, at: new Date().toISOString(), jcFirstRead: { jefeCuadrilla: 'Juan Pérez' } },
  })
  expect((await mov.json()).ok).toBe(true)

  const env = loadTestEnv()
  const conn = await mysql.createConnection({
    host: env.MYSQL_HOST,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
  })
  try {
    const [rows] = await conn.execute('SELECT client_ip, user_agent FROM movements WHERE label_id = ?', [id])
    const row = (rows as Array<{ client_ip: string | null; user_agent: string | null }>)[0]
    expect(row?.client_ip).toBeTruthy()
    expect(row?.user_agent).toBe('E2E-Auditoria/1.0')
  } finally {
    await conn.end()
  }
})
