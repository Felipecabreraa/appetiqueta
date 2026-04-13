import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { LabelSheet } from '../components/LabelSheet'
import type { LabelRecord } from '../types'

/** Conversión px CSS → mm (96 px por pulgada). */
const PX_TO_MM = 25.4 / 96

const CAPTURE_SCALE = 2

function roundMm(n: number): number {
  return Math.max(Math.round(n * 100) / 100, 0.01)
}

/**
 * Renderiza la misma `LabelSheet` que en pantalla, captura PNG y tamaño en mm
 * alineado al lienzo (misma proporción que la imagen).
 */
async function captureLabelSheetAsPng(record: LabelRecord): Promise<{
  dataUrl: string
  widthMm: number
  heightMm: number
}> {
  const mount = document.createElement('div')
  mount.setAttribute('aria-hidden', 'true')
  Object.assign(mount.style, {
    position: 'fixed',
    left: '-9999px',
    top: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '-1',
  })
  document.body.appendChild(mount)

  const root = createRoot(mount)
  root.render(createElement(LabelSheet, { record }))

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
  await new Promise((r) => setTimeout(r, 250))

  const sheet = mount.querySelector('.label-sheet') as HTMLElement | null
  if (!sheet) {
    root.unmount()
    mount.remove()
    throw new Error('No se pudo preparar la etiqueta para el PDF.')
  }

  const canvas = await html2canvas(sheet, {
    scale: CAPTURE_SCALE,
    backgroundColor: '#ffffff',
    logging: false,
    useCORS: true,
  })

  // mm deducidos del lienzo = misma relación de aspecto que el PNG (página sin bandas blancas).
  const widthMm = (canvas.width / CAPTURE_SCALE) * PX_TO_MM
  const heightMm = (canvas.height / CAPTURE_SCALE) * PX_TO_MM
  const dataUrl = canvas.toDataURL('image/png')

  root.unmount()
  mount.remove()

  return { dataUrl, widthMm, heightMm }
}

/**
 * Crea o añade una página cuyo tamaño es exactamente el de la etiqueta (mm)
 * y dibuja la imagen a página completa (0,0 → esquina inferior derecha del media box).
 */
async function appendLabelPage(
  doc: jsPDF | null,
  record: LabelRecord,
): Promise<jsPDF> {
  const { dataUrl, widthMm, heightMm } = await captureLabelSheetAsPng(record)
  const w = roundMm(widthMm)
  const h = roundMm(heightMm)

  // jsPDF intercambia dimensiones en portrait si ancho > alto; elegimos orientación para que
  // la página coincida con el rectángulo físico de la etiqueta (ancho × alto).
  const orientation = w > h ? 'landscape' : 'portrait'

  let pdf = doc
  if (pdf === null) {
    pdf = new jsPDF({
      unit: 'mm',
      format: [w, h],
      orientation,
    })
  } else {
    pdf.addPage([w, h], orientation)
  }

  const pw = pdf.internal.pageSize.getWidth()
  const ph = pdf.internal.pageSize.getHeight()
  pdf.addImage(dataUrl, 'PNG', 0, 0, pw, ph, undefined, 'FAST')

  return pdf
}

/**
 * PDF: una página por etiqueta, sin márgenes. Cada hoja tiene el tamaño exacto de la etiqueta
 * y la imagen ocupa el 100 % del ancho y alto de esa página.
 */
export async function exportLabelsPdf(
  records: LabelRecord[],
  options?: { fileName?: string },
): Promise<void> {
  if (records.length === 0) return

  let doc: jsPDF | null = null
  for (const r of records) {
    doc = await appendLabelPage(doc, r)
  }

  const stamp = new Date().toISOString().slice(0, 10)
  const name = options?.fileName ?? `etiquetas-lote-${records.length}-${stamp}.pdf`
  doc!.save(name)
}
