# Cobertura E2E de funciones críticas (20261001)

Ampliar los E2E Playwright (desktop + móvil) a funciones críticas sin pruebas. Sin cambios en `src/` ni `server/`.

- **CA-01** Generación de lote desde la UI: superadmin completa temporada/empresa/CC (CC01 autocompleta Cereza/Lapins/CSG001), sector y cantidad 3, genera; se ven etiquetas con QR y quedan en el servidor (`GET /api/labels/:id`).
- **CA-02** Validación: con campos obligatorios vacíos no se puede generar (botón deshabilitado y mensaje visible).
- **CA-03** Importación Excel de maestros: un .xlsx generado en el test (empresa, cc, especie, variedad, csg) se importa y el nuevo CC aparece en el catálogo.
- **CA-04** Excel de trackeo: tras JC + acopio de una etiqueta, el Excel descargado contiene la etiqueta en "JC - Primera lectura QR" y "Acopio - Segunda lectura QR" con las cantidades correctas.
- **CA-05** Permisos por rol en UI: operador no ve Resumen/Maestros/Usuarios ni exporta; admin no ve Maestros/Usuarios pero exporta; superadmin ve todo.
- **CA-06** API: operador recibe 403 en maestros/usuarios/export.
