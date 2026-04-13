/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origen público para el QR (ej. http://192.168.1.10:5173 si escaneas desde el móvil) */
  readonly VITE_APP_ORIGIN?: string
  /**
   * URL para cargar una etiqueta por código en el móvil (GET JSON).
   * Use el marcador {{id}} (ej. https://tudominio.cl/api/label.php?id={{id}}).
   * Si no se define pero sí VITE_SYNC_API_BASE, se usa GET .../api/labels/{{id}}.
   */
  readonly VITE_LABEL_LOOKUP_URL?: string
  /** Base del API; vacío = mismo origen (producción en Render) o proxy /api en vite dev */
  readonly VITE_SYNC_API_BASE?: string
  /** Misma clave que SYNC_API_KEY en .env del servidor (cabecera X-Sync-Key en POST batch) */
  readonly VITE_SYNC_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
