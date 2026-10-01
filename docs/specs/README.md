# Specs del equipo agéntico

Cada necesidad que pasa por `/equipo` genera una carpeta `AAAAMMDD-slug/` con:

| Archivo | Autor | Fase |
|---|---|---|
| `estado.md` | lead | toda la vida del ciclo (fase actual, decisiones, hallazgos) |
| `requerimiento.md` | analista-requerimientos | 1 · Levantamiento (compuerta 1) |
| `diseno.md` | arquitecto | 2 · Diseño (compuerta 2) |
| `cierre.md` | lead | 8 · Cierre (matriz CA → prueba → resultado) |

Las pruebas viven en `tests/unit/` (Vitest) y `tests/e2e/` (Playwright), con el ID del CA en el nombre del test.
