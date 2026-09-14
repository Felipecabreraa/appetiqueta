import { useState } from 'react'
import { OperationalCaptureApp } from './OperationalCaptureApp'

export function OperatorPortal() {
  const [code, setCode] = useState('')
  const [activeCode, setActiveCode] = useState('')

  if (activeCode) {
    return <OperationalCaptureApp labelId={activeCode} />
  }

  return (
    <main className="app-main">
      <section className="card" style={{ maxWidth: 520, margin: '1rem auto' }}>
        <h2 className="page-heading">Captura por QR</h2>
        <p className="sub">Escriba o pegue el código de la etiqueta para abrir el formulario.</p>
        <form
          className="label-form"
          onSubmit={(e) => {
            e.preventDefault()
            setActiveCode(code.trim().toUpperCase())
          }}
        >
          <div className="form-grid">
            <label className="full-width">
              Código de etiqueta
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Ej: QRA1B2C3"
                required
              />
            </label>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn primary">
              Abrir captura
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}
