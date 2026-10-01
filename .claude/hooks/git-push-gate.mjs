#!/usr/bin/env node
/**
 * Hook PreToolUse (Bash): compuerta determinista antes de cualquier `git push`.
 *  1. Prohíbe push forzado.
 *  2. Producción (main): solo se publica lo que ya está en origin/developer (validado en pruebas/staging).
 *  3. Exige `npm run verify` en verde.
 * Exit 2 = bloquea la acción y devuelve el motivo a Claude.
 * La aprobación humana la da además la regla "ask" de .claude/settings.json.
 */
import { execSync } from 'node:child_process'

const input = JSON.parse(
  await new Promise((r) => {
    let d = ''
    process.stdin.on('data', (c) => (d += c))
    process.stdin.on('end', () => r(d || '{}'))
  }),
)
const raw = String(input?.tool_input?.command || '')

/** Quita heredocs y strings entre comillas para no reaccionar a texto (docs, mensajes de commit). */
function stripLiterals(cmd) {
  return cmd
    .replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\s*\1\b/g, '')
    .replace(/'[^']*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
}

const cmd = stripLiterals(raw)
const pushes = cmd
  .split(/&&|\|\||;|\||\n|\(|\)/)
  .map((s) => s.trim())
  .filter((s) => /^git(\s+-C\s+\S+)?\s+push\b/.test(s))
if (pushes.length === 0) process.exit(0)

const block = (msg) => {
  console.error(`[git-push-gate] ${msg}`)
  process.exit(2)
}
const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const branch = sh('git rev-parse --abbrev-ref HEAD')

for (const push of pushes) {
  if (/(\s--force\b|\s-f\b|--force-with-lease|\s\+\S)/.test(push)) {
    block('Push forzado prohibido en este repo.')
  }
  const args = push.split(/\s+/).slice(2).filter((a) => !a.startsWith('-'))
  const refspecs = args.slice(1)
  const targetsMain =
    refspecs.some((r) => r === 'main' || r.endsWith(':main') || r.endsWith(':refs/heads/main')) ||
    (refspecs.length === 0 && branch === 'main')
  if (targetsMain) {
    try {
      sh('git fetch origin developer --quiet')
      sh('git merge-base --is-ancestor main origin/developer')
    } catch {
      block(
        'Producción (main) solo recibe commits que ya están en origin/developer y fueron validados en pruebas. ' +
          'Primero: merge a developer → push developer → CI verde → validar staging → aprobación del usuario.',
      )
    }
  }
}

try {
  execSync('npm run verify', { stdio: ['ignore', 'pipe', 'pipe'] })
} catch (e) {
  block(`npm run verify falló; no se publica.\n${String(e.stdout || '').slice(-1500)}`)
}
process.exit(0)
