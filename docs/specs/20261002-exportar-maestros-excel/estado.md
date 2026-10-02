# Estado — 20261002-exportar-maestros-excel

- **Necesidad (usuario):** "Necesito también generar la funcionalidad de poder exportar los módulos a Excel."
- **Alcance definido con el usuario (2026-10-02):** solo **Maestros** (Trazabilidad ya exporta; Dashboard, Generar y Usuarios quedan fuera). Formato **igual al de la plantilla de importación**, para que el archivo exportado se pueda editar y volver a importar. Ciclo aparte del de admin-maestros.
- **Tipo:** funcionalidad · **Talla:** L (incluye corregir la importación: P3, P4, P5)
- **Rama:** `feat/exportar-maestros-excel` (desde `developer` @ 2a2f458, que ya incluye admin-maestros)
- **Carpeta de trabajo:** `/Users/felipelagos/Projects/appetiquetado-export` (git worktree; la carpeta principal la usa el ciclo `fix/esquema-y-errores-login`)

## Fases
- [x] 0 Triage y rama
- [x] 1 Levantamiento — compuerta 1 aprobada por el usuario el 2026-10-02 ("Aprobar lo recomendado: exportar + arreglar importación"): P1..P11 con la opción recomendada.
- [x] 2 Diseño — revisor: APROBADO CON CAMBIOS (3 IMP + 5 MEN, resueltos en iteración 2, §11). **Compuerta 2 aprobada por el usuario el 2026-10-02 ("Sí, aprobado").**
  - Decisiones del Lead (2026-10-02) sobre §10 del diseño: (1) 6 columnas (con NOMBRE CC) en plantilla, exportación y No importables; corregir CA-01/CA-06. (2) Celda NOMBRE CC vacía conserva el nombre. (3) Temporadas inactivas en el selector con " (inactiva)" + aviso. (4) CA-18 usa el proyecto `movil` (Pixel 7). (5) Renombrado por colisión de código → hallazgo fuera de alcance.
- [x] 3 Pruebas primero — unit en rojo (2dbb96b); E2E UI/API 27 rojos + 2 invariantes verdes por proyecto; runner de volumen CA-19 rojo (500 por P5); regresión 122 ok + 8 skip.
- [x] 4 Implementación — backend 909c77e, d275bf8; frontend 93fc1da, e65049b
- [x] 5 Verificación local — /verificar APTO en serie (2026-10-02): lint/tsc/build ok, unit 328/328, E2E UI 216 ok + 8 skip intencionales, E2E API 43/43 + CA-27 + esquema-arranque + CA-19 OK. Los intermitentes de la fase 4 se debían a la BD compartida entre devs.
- [x] 6 E2E completo — qa-e2e (cc839ff): CA-01..CA-22 + P1/P3/P4/P5/P10/P11/P14 + MEN-6 en verde; 9 bordes nuevos (concurrencia de importación, edición combinada, espacios, temporada inactiva); E2E UI 234 ok + 8 skip; API 43/43 + CA-27 + esquema + CA-19. Sin bugs.
- [x] 7 Revisión — revisor: **APROBADO** (4 menores diferidos). Lead acepta el texto "No se pudo generar el archivo Excel. Intente nuevamente." como adicional.
- [ ] 8 Staging — en curso
- [ ] 9 Producción

## Bucle de perfección
(vacío)

## Hallazgos fuera de alcance
- Menores del revisor (fase 7): (1) si otra persona borra la temporada elegida entre la carga y el clic, el aviso dice "sin relaciones" en vez de "ya no existe" (MasterDataView.tsx:84-91); (2) parseMasterWorkbook lee la hoja entera para la fila 1 (masterExcel.ts:93); (3) texto de error genérico no especificado (aceptado); (4) mensajes en `.master-export-info` hermano y no dentro de `.master-export` (actualizar §5.2).
- (qa-e2e) Reimportar un archivo exportado antes de una edición pisa esa edición (última escritura gana). Considerar una línea de ayuda en pantalla.
- (P16) `POST /api/admin/relations` no valida que la variedad pertenezca a la especie de la relación; Mantenimiento permite cambiar la especie de una variedad con relaciones.
- Importación: si el toCode de un nombre nuevo coincide con el código de otra fila, la renombra (preexistente).
- (P7) Variedades homónimas en especies distintas: la importación las mueve de especie. Deuda previa, otro ciclo.
