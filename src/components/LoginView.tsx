import { useState } from 'react'
import { BrandLogo } from './BrandLogo'

export function LoginView({
  onLogin,
  busy,
  error,
}: {
  onLogin: (username: string, password: string) => void
  busy: boolean
  error: string | null
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const canSubmit = username.trim() !== '' && password.trim() !== '' && !busy

  return (
    <main className="app-main login-main">
      <section className="login-card">
        <div className="login-brand">
          <BrandLogo size="lg" />
          <p className="login-product">Etiquetado</p>
        </div>
        <h2>Entrar</h2>
        <p className="sub login-sub">Usuario y contraseña de su cuenta.</p>
        <form
          className="label-form login-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (!canSubmit) return
            onLogin(username.trim(), password)
          }}
        >
          <div className="form-grid">
            <label className="full-width">
              Usuario
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                placeholder="usuario"
                disabled={busy}
              />
            </label>
            <label className="full-width">
              Contraseña
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                disabled={busy}
              />
            </label>
          </div>
          <p className="muted login-help">Si no recuerda el acceso, pídalo al SuperAdmin.</p>
          {error && (
            <p className="alert error" role="alert" aria-live="assertive">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button type="submit" className="btn primary btn-block" disabled={!canSubmit}>
              {busy ? 'Entrando…' : 'Entrar'}
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}
