---
name: levantar-requerimiento
description: Método y plantilla para levantar un requerimiento desde cero en App Etiquetado (historias de usuario, criterios de aceptación Gherkin, reglas, casos borde, preguntas abiertas). Usar al iniciar cualquier necesidad nueva.
argument-hint: "[necesidad]"
---

# Levantamiento de requerimientos

## Método
1. **Entiende el problema antes de proponer una solución.** ¿Quién lo sufre (rol: superadmin, admin, operador o jefe de cuadrilla en terreno)? ¿En qué momento del flujo (maestros → generar etiqueta → JC → acopio → reporte)? ¿Qué pasa hoy?
2. **Lee el código afectado** para describir el comportamiento actual con evidencia (`archivo:línea`). No supongas nada.
3. **Redacta las historias de usuario** con la forma *Como <rol>, quiero <capacidad>, para <beneficio>*. Cada historia debe ser INVEST: independiente, negociable, valiosa, estimable, pequeña y testeable.
4. **Escribe los criterios de aceptación en Gherkin**, numerados `CA-01`, `CA-02`… Cada CA debe poder verificarse con una prueba automatizada. Cubre siempre:
   - el camino feliz,
   - los permisos por rol (quién **no** puede),
   - las validaciones y los mensajes de error,
   - el orden JC → acopio, si aplica,
   - el comportamiento en móvil o en terreno con mala conectividad, si aplica,
   - el impacto en el Excel de trackeo o en los reportes, si aplica.
5. **Separa las reglas de negocio** (RN-01…) de los criterios. Las reglas son invariantes del dominio.
6. **Declara qué queda fuera de alcance.**
7. **Lista las preguntas abiertas** con una opción recomendada para cada una. No inventes respuestas: si algo es ambiguo, va a PREGUNTAS.

## Plantilla
Escribe `docs/specs/<id>/requerimiento.md` usando [plantilla.md](plantilla.md).

## Calidad mínima
- Ningún CA usa términos vagos ("rápido", "amigable", "correcto"). Todos son medibles.
- Cada historia tiene al menos un CA de error o de permisos.
- El vocabulario es el del dominio: etiqueta, lote, JC, acopio, totes, CC, CSG, temporada.
