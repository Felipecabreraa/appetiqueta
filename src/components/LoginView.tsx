import { useState } from 'react'

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
      <section className="card login-card">
        <div className="login-brand">
          <div className="brand-mark" aria-hidden>
            <span className="brand-mark-inner">A</span>
          </div>
          <div>
            <p className="page-eyebrow">Acceso seguro</p>
            <h2>Ingreso al sistema</h2>
          </div>
        </div>
        <p className="sub login-sub">Use su cuenta según rol para entrar a módulos administrativos u operativos.</p>
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
                placeholder="••••••••"
                disabled={busy}
              />
            </label>
          </div>
          <p className="muted login-help">Si no recuerda su acceso, solicite restablecimiento al SuperAdmin.</p>
          {error && (
            <p className="alert error" role="alert" aria-live="assertive">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button type="submit" className="btn primary btn-block" disabled={!canSubmit}>
              {busy ? 'Ingresando...' : 'Ingresar'}
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}
