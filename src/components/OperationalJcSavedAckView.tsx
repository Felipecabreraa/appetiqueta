/** Tras guardar solo el primer proceso (JC): cierre sin abrir el formulario de acopio. */
export function OperationalJcSavedAckView({ labelId }: { labelId: string }) {
  const id = labelId.trim().toUpperCase()
  return (
    <div className="operational-app">
      <div className="operational-inner">
        <div className="operational-card operational-card--state">
          <p className="operational-eyebrow">Salida de campo</p>
          <h1 className="operational-title">Registro guardado</h1>
          <p className="operational-lead">
            La salida de esta etiqueta quedó registrada. La llegada al acopio es{' '}
            <strong>otro proceso</strong>: cuando corresponda, en el acopio deberán{' '}
            <strong>volver a escanear el mismo código QR</strong> de la etiqueta; en ese momento se
            abrirá solo el formulario de recepción.
          </p>
          <div className="operational-code-pill">{id}</div>
          <p className="operational-meta operational-meta--spaced">
            Puede cerrar esta pantalla. No es necesario continuar aquí para el acopio.
          </p>
        </div>
      </div>
    </div>
  )
}
