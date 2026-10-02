# Estado — 20261002-ui-carga-excel

- **Necesidad (usuario, 2026-10-02):** "necesito que generes un diseño correcto alineado a lo que ya está implementado, mejorar el diseño que generaste, no se logra visualizar qué es para qué, porque está todo junto" — pantalla Maestros → Carga desde Excel tras publicar exportar-maestros-excel en staging.
- **Tipo:** ajuste de UI (+ bug de desborde en móvil) · **Talla:** S (fases 1-lite → 3 → 4 → 5 → 6 → 7 → 8 → 9)
- **Rama:** `fix/ui-carga-excel` (desde `developer` @ d4c491b)
- **Diseño elegido por el usuario:** "Dos tarjetas: Exportar e Importar" (ver requerimiento.md).

## Fases
- [x] 0 Triage y rama
- [x] 1-lite Levantamiento — requerimiento.md (Lead), diseño elegido por el usuario
- [x] 3 Pruebas primero — qa-e2e 84a56bb: maestros-carga-excel-ui.spec.ts rojo (sin secciones; desborde 424px > 412px)
- [x] 4 Implementación — dev-frontend 477156b + capturas; Lead ef6a55b (selector con estilo de campos). Aprobación visual del usuario 2026-10-02 ("Sí, aprobado").
- [x] 5 Verificación local — /verificar APTO sobre ef6a55b: unit 328/328, E2E UI 265 ok + 9 skip, API 43/43 + CA-27 + esquema + CA-19
- [x] 6 E2E completo — suite completa 265 ok (dev-frontend y Lead); spec nuevo CA-01..CA-04 desktop+móvil
- [x] 7 Revisión — vuelta 1: APROBADO CON CAMBIOS (1 IMP a11y: role=status oculto con :empty). Corregido por el Lead con prueba primero (rojo: 0 regiones) → quitar regla :empty → verde. Menores: avisos de reimportación dentro de la región viva (aceptado por el Lead, lo pide CA-03); boceto corregido a «¿No tiene archivo?»; avisos >10000 y sin temporadas cubiertos vía el mismo role=status único (aceptado).
- [ ] 8 Staging — en curso
- [ ] 9 Producción

## Bucle de perfección
- Vuelta 1: revisor IMP a11y → prueba 'la región role=status de exportar existe y no está oculta' (rojo) → App.css sin `.master-export-info:empty` → verde (133 ok).
- Incidente: dev-frontend usó `pkill -f vite` y bajó el Vite de vista del Lead (5273); relanzado. Lección: matar solo los PID propios.

## Hallazgos fuera de alcance
(vacío)
