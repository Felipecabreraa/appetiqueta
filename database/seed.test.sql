-- Datos semilla para la BD de PRUEBAS (appetiquetado_test). Nunca aplicar en producción.
INSERT INTO seasons (code, name, starts_on, ends_on, is_current, is_active)
VALUES ('2025-2026', 'Temporada 2025-2026', '2025-07-01', '2026-06-30', 1, 1);

INSERT INTO companies (code, name) VALUES ('ESMERALDA', 'Agrícola Esmeralda'), ('E2E_EMP', 'Empresa E2E');
INSERT INTO species (code, name) VALUES ('CEREZA', 'Cereza'), ('ARANDANO', 'Arándano');
INSERT INTO varieties (code, name, species_id)
  SELECT 'LAPINS', 'Lapins', id FROM species WHERE code = 'CEREZA';
INSERT INTO varieties (code, name, species_id)
  SELECT 'DUKE', 'Duke', id FROM species WHERE code = 'ARANDANO';
INSERT INTO csg_catalog (code, name) VALUES ('CSG001', 'CSG001'), ('CSG002', 'CSG002');
INSERT INTO jc_foremen (code, name) VALUES ('JC_JUAN', 'Juan Pérez'), ('JC_MARIA', 'María Soto');

INSERT INTO season_cost_centers (season_id, company_id, center_code, center_name, species_id, variety_id, csg_id)
SELECT s.id, c.id, 'CC01', 'Cuartel 1', sp.id, v.id, g.id
FROM seasons s, companies c, species sp, varieties v, csg_catalog g
WHERE s.code = '2025-2026' AND c.code = 'ESMERALDA' AND sp.code = 'CEREZA' AND v.code = 'LAPINS' AND g.code = 'CSG001';

INSERT INTO season_cost_centers (season_id, company_id, center_code, center_name, species_id, variety_id, csg_id)
SELECT s.id, c.id, 'CC02', 'Cuartel 2', sp.id, v.id, g.id
FROM seasons s, companies c, species sp, varieties v, csg_catalog g
WHERE s.code = '2025-2026' AND c.code = 'ESMERALDA' AND sp.code = 'ARANDANO' AND v.code = 'DUKE' AND g.code = 'CSG002';
