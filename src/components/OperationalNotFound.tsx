export function OperationalNotFound({
  code,
  reason = 'local',
}: {
  code: string
  reason?: 'local' | 'remote' | 'network'
}) {
  const copy =
    reason === 'network'
      ? {
          eyebrow: 'Sin conexión al servidor',
          title: 'No se pudo consultar la etiqueta',
          body: (
            <>
              No hubo respuesta correcta al buscar <strong className="operational-mono">{code}</strong>.
              Revise Wi‑Fi, que la URL de sincronización sea accesible desde el celular y que el
              servidor permita CORS desde el origen de esta app.
            </>
          ),
        }
      : reason === 'remote'
        ? {
            eyebrow: 'No existe en el servidor',
            title: 'Etiqueta no encontrada',
            body: (
              <>
                El código <strong className="operational-mono">{code}</strong> no figura en la base
                de datos enlazada (o el API respondió vacío). Verifique que la etiqueta esté
                guardada en el servidor y que la URL de consulta sea la correcta.
              </>
            ),
          }
        : {
            eyebrow: 'Solo en este navegador',
            title: 'Etiqueta no reconocida aquí',
            body: (
              <>
                El código <strong className="operational-mono">{code}</strong> no está guardado en
                este teléfono. Si generó la etiqueta en otra computadora, configure{' '}
                <code className="operational-inline-code">VITE_LABEL_LOOKUP_URL</code> en el build
                para que el móvil la descargue del servidor, o genere y use las etiquetas en el mismo
                dispositivo.
              </>
            ),
          }

  return (
    <div className="operational-app">
      <div className="operational-inner">
        <div className="operational-card operational-card--state" role="alert">
          <p className="operational-eyebrow">{copy.eyebrow}</p>
          <h1 className="operational-title">{copy.title}</h1>
          <p className="operational-lead">{copy.body}</p>
        </div>
      </div>
    </div>
  )
}
