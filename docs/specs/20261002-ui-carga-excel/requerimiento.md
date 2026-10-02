# UI de Maestros → Carga desde Excel: separar Exportar e Importar

- **Estado:** aprobado (el usuario eligió el diseño "Dos tarjetas" el 2026-10-02)
- **Talla:** S · **Dueño:** dev-frontend (solo `src/components/MasterDataView.tsx` y `src/App.css`; sin cambios de API, BD ni permisos)

## Problema (capturas `antes-desktop.png`, `antes-movil.png`)
1. El selector y el botón de exportar quedaron dentro del formulario de importación, entre los campos y el botón "Importar maestros".
2. Los avisos de reimportación (P1/P10) aparecen debajo de "Importar maestros" aunque se refieren a la exportación.
3. "Descargar plantilla Excel", "Exportar" e "Importar" están juntos, sin títulos que expliquen su propósito.
4. **Bug móvil:** "Nombre temporada", "Archivo Excel" y "Marcar como temporada actual" desbordan el ancho de la pantalla (scroll horizontal).

## Diseño elegido
```
┌─ Exportar maestros ───────────────────────┐
│ Descarga los maestros de una temporada    │
│ para revisarlos o editarlos y volver a    │
│ importarlos.                              │
│ Temporada a exportar [2025-2026 (act.) ▾] │
│ [ Exportar maestros a Excel ]             │
│ (avisos de exportación, role="status")    │
└───────────────────────────────────────────┘
┌─ Importar maestros desde Excel ───────────┐
│ Carga o actualiza empresas, especies,     │
│ variedades, CC y CSG de una temporada.    │
│ ¿No tienes archivo? Descargar plantilla   │
│ 1 Temporada: Código · Nombre · Actual     │
│ 2 Archivo: [Elegir archivo]               │
│   Columnas esperadas: …                   │
│ [ Importar maestros ]                     │
│ (resultado / errores de importación)      │
└───────────────────────────────────────────┘
```
En móvil las tarjetas se apilan y todos los campos ocupan el 100 % del ancho, sin desborde.

## Criterios de aceptación
```gherkin
CA-01 Dos bloques separados con título
  Dado un admin o superadmin en Maestros → Carga desde Excel (desktop y móvil)
  Entonces ve una sección "Exportar maestros" y otra "Importar maestros desde Excel", cada una con su título (heading) y una línea que explica para qué sirve
  Y la sección de exportar aparece antes que la de importar

CA-02 Cada control en su bloque
  Entonces "Temporada a exportar" y "Exportar maestros a Excel" están solo dentro de la sección de exportar
  Y "Código temporada", "Nombre temporada", "Marcar como temporada actual", "Archivo Excel", el texto de columnas esperadas y "Importar maestros" están solo dentro de la sección de importar
  Y "Descargar plantilla Excel" está dentro de la sección de importar

CA-03 Avisos en su bloque
  Entonces los avisos de exportación (reimportar con mismo código y nombre, temporada actual, temporada inactiva, >10000 filas, error de carga con "Reintentar", sin temporadas) aparecen dentro de la sección de exportar, con role="status" y nunca role="alert"
  Y los mensajes de resultado o error de la importación aparecen dentro de la sección de importar

CA-04 Sin desborde horizontal en móvil
  Dado el proyecto movil (Pixel 7)
  Entonces ningún control del panel #panel-maestros-excel excede el ancho de la ventana (no hay scroll horizontal de la página)

CA-05 Sin regresión funcional
  Entonces exportar, importar, la plantilla y la ida y vuelta siguen funcionando igual (todas las pruebas existentes de maestros-exportar*, maestros-excel y maestros-* pasan, ajustando solo localizadores si la estructura cambia, sin debilitar aserciones)
```

## Reglas
- Mismos textos de botones, labels y avisos ya aprobados (para no romper accesibilidad ni pruebas); se agregan solo títulos y líneas descriptivas.
- Reutilizar las clases y el estilo de tarjetas existentes de la app (por ejemplo los de `MastersAdminPanel` / `.card`), sin introducir un sistema visual nuevo.
- Secciones con `<section aria-labelledby>` y heading, para que sean identificables por lector de pantalla y por pruebas.

## Fuera de alcance
Cambios de comportamiento de exportar/importar, textos de avisos, la pestaña Mantenimiento en pantalla.
