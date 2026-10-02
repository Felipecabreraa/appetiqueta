---
name: entorno-colisiones
description: La BD de pruebas no se resetea entre proyectos desktop y movil; nombres fijos chocan con uq_*_name; otro agente puede cambiar de rama o commitear mis archivos untracked
metadata:
  type: project
---

- Las tablas de maestros tienen UNIQUE en name (ej. `csg_catalog.uq_csg_name`). Los specs corren dos veces (desktop y movil) sobre la misma BD: usar siempre sufijo único en `name`, no solo en `code`. Un name duplicado devuelve 500 `db` (comportamiento previo, no 409).
- El árbol de trabajo se comparte: en la fase 6 otro agente cambió a `developer` en medio de mi corrida y su commit (0d6a149) barrió mis archivos untracked. Antes de correr, verificar `git branch --show-current`; commitear mis specs cuanto antes con `git add` explícito.
