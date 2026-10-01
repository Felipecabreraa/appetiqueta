---
name: desplegar
description: Publica cambios en el ambiente de PRUEBAS (rama developer → Render appetiqueta-dev) o en PRODUCCIÓN (rama main → Render appetiqueta) con todas las compuertas. Producción exige la aprobación explícita y registrada del usuario.
argument-hint: "pruebas | produccion"
---

# Desplegar — destino: $ARGUMENTS

Estado actual:
!`git status --short --branch`

## Compuertas comunes (si falla una, no se publica)
1. El árbol de trabajo está limpio y todo está commiteado en la rama de trabajo.
2. `/verificar` completo en verde, en esta misma sesión y después del último cambio.
3. `docs/specs/<id>/cierre.md` existe, con la matriz CA → prueba → resultado y todo en verde.

## Destino `pruebas` (staging)
1. `git switch developer && git pull --ff-only origin developer`
2. `git merge --no-ff feat/<slug>` (si hay conflictos, resuélvelos y repite `/verificar`)
3. `git push origin developer`. El usuario confirma en el aviso de permiso y el hook `git-push-gate` vuelve a correr `verify`.
4. Espera el CI: `gh run watch` o `gh run list --branch developer --limit 1`. Si falla, revisa el log (`gh run view --log-failed`) y vuelve a la fase 4.
5. Cuando el CI está verde, Render despliega `appetiqueta-dev`. Corre el smoke remoto: `E2E_REMOTE_URL=<url-staging> npm run test:smoke:remote`.
6. Informa al usuario la URL de staging y qué debe probar (los CA).

## Destino `produccion`
**Precondición absoluta:** en esta conversación, el usuario respondió de forma explícita que aprueba publicar en producción este cambio (no vale una aprobación anterior ni de otro cambio). Si no la hay, **detente** y pídela con AskUserQuestion, mostrando el resumen, la URL de staging, las migraciones y el rollback.

1. Registra la aprobación en `cierre.md`: fecha, hora y frase textual del usuario.
2. `git switch main && git pull --ff-only origin main`
3. `git merge --ff-only origin/developer` (o `--no-ff` si `main` tiene hotfixes). Producción solo recibe lo que ya está en `developer`.
4. `git push origin main`. Pasa por el aviso de permiso y por el hook, que verifica que `main` ⊆ `origin/developer`.
5. Espera el CI de `main`. Render despliega `appetiqueta` cuando pasa.
6. Smoke remoto de solo lectura: `E2E_REMOTE_URL=<url-produccion> npm run test:smoke:remote`.
7. Si el smoke falla: avisa de inmediato y propone el rollback (redeploy del commit anterior desde Render, o `git revert` + push con nueva aprobación). Nunca uses `push --force`.
8. Vuelve a `developer` y confirma que `main` y `developer` están alineados.

## Nunca
- Hacer push forzado, commits directos en `main` o desplegar con pruebas en rojo u omitidas.
- Ejecutar pruebas con escritura contra staging o producción. Sobre esos ambientes solo se corre el smoke `@smoke`.
- Leer o modificar `.env` / `.env.production`.
