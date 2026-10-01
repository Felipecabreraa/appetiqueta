# Diseño — <Título>

- **Spec:** <id> · **Requerimiento:** [requerimiento.md](requerimiento.md)
- **Estado:** borrador | aprobado

## 1. Resumen de la solución
<3–5 líneas.>

## 2. Impacto por capa
| Capa | Archivos | Cambio |
|---|---|---|
| BD | `database/schema.sql` | ... |
| API | `server/index.cjs` | ... |
| Frontend | `src/...` | ... |

## 3. Modelo de datos / migración
```sql
-- idempotente
```

## 4. Contrato de API
| Método | Ruta | Rol | Body | Respuesta OK | Errores |
|---|---|---|---|---|---|

## 5. Flujo / UI
<Pantallas afectadas, estados (cargando, error, vacío) y comportamiento en móvil.>

## 6. Alternativas descartadas
- ...

## 7. Tareas
| ID | Dueño | Descripción | Archivos | Depende de | CA | Paralelo |
|---|---|---|---|---|---|---|
| T-01 | dev-backend | ... | ... | — | CA-01 | sí |

## 8. Plan de pruebas
| CA | Nivel | Archivo | Caso |
|---|---|---|---|
| CA-01 | unit | `tests/unit/...test.ts` | ... |

## 9. Riesgos y rollback
- ...
