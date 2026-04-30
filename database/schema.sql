-- App Etiquetado — Esquema productivo, relacional y escalable.
-- Motor objetivo: MySQL 8.0+ (InnoDB, utf8mb4).
-- Incluye:
-- 1) Maestros por temporada (empresa, especie, variedad, CSG, CC)
-- 2) Relación dinámica empresa -> CC -> (especie, variedad, CSG)
-- 3) Usuarios, roles y sesiones
-- 4) Compatibilidad con flujo de etiquetas, QR y trazabilidad

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- Seguridad: roles, usuarios, sesiones
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(24) NOT NULL,
  name VARCHAR(64) NOT NULL,
  description VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(80) NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role_id TINYINT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  KEY idx_users_role (role_id),
  CONSTRAINT fk_users_role
    FOREIGN KEY (role_id) REFERENCES roles (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL COMMENT 'SHA-256 del token entregado al cliente',
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_auth_sessions_token_hash (token_hash),
  KEY idx_auth_sessions_user (user_id),
  KEY idx_auth_sessions_expires (expires_at),
  CONSTRAINT fk_auth_sessions_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Temporadas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS seasons (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(30) NOT NULL COMMENT 'Ej: 2025-2026',
  name VARCHAR(120) NOT NULL,
  starts_on DATE NULL,
  ends_on DATE NULL,
  is_current TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_seasons_code (code),
  KEY idx_seasons_current (is_current, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Catálogos maestros
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(60) NOT NULL,
  name VARCHAR(180) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_companies_code (code),
  UNIQUE KEY uq_companies_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS species (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(60) NOT NULL,
  name VARCHAR(180) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_species_code (code),
  UNIQUE KEY uq_species_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS varieties (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(60) NOT NULL,
  name VARCHAR(180) NOT NULL,
  species_id BIGINT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_varieties_code (code),
  UNIQUE KEY uq_varieties_name_species (name, species_id),
  KEY idx_varieties_species (species_id),
  CONSTRAINT fk_varieties_species
    FOREIGN KEY (species_id) REFERENCES species (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS csg_catalog (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(60) NOT NULL,
  name VARCHAR(180) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_csg_code (code),
  UNIQUE KEY uq_csg_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS jc_foremen (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(60) NOT NULL,
  name VARCHAR(180) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_jc_foremen_code (code),
  UNIQUE KEY uq_jc_foremen_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Relación maestra por temporada:
-- Empresa + CC -> Especie + Variedad + CSG
CREATE TABLE IF NOT EXISTS season_cost_centers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  season_id BIGINT UNSIGNED NOT NULL,
  company_id BIGINT UNSIGNED NOT NULL,
  center_code VARCHAR(80) NOT NULL COMMENT 'CC',
  center_name VARCHAR(180) NOT NULL DEFAULT '',
  species_id BIGINT UNSIGNED NOT NULL,
  variety_id BIGINT UNSIGNED NOT NULL,
  csg_id BIGINT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  source VARCHAR(40) NOT NULL DEFAULT 'excel',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_season_company_center (season_id, company_id, center_code),
  KEY idx_scc_company (company_id),
  KEY idx_scc_season (season_id, is_active),
  KEY idx_scc_species (species_id),
  KEY idx_scc_variety (variety_id),
  KEY idx_scc_csg (csg_id),
  CONSTRAINT fk_scc_season
    FOREIGN KEY (season_id) REFERENCES seasons (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_scc_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_scc_species
    FOREIGN KEY (species_id) REFERENCES species (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_scc_variety
    FOREIGN KEY (variety_id) REFERENCES varieties (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_scc_csg
    FOREIGN KEY (csg_id) REFERENCES csg_catalog (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS master_import_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  season_id BIGINT UNSIGNED NOT NULL,
  imported_by BIGINT UNSIGNED NOT NULL,
  source VARCHAR(40) NOT NULL DEFAULT 'excel',
  rows_received INT UNSIGNED NOT NULL,
  rows_applied INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_master_import_runs_season (season_id),
  KEY idx_master_import_runs_user (imported_by),
  CONSTRAINT fk_master_import_runs_season
    FOREIGN KEY (season_id) REFERENCES seasons (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_master_import_runs_user
    FOREIGN KEY (imported_by) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Operación de etiquetas y trazabilidad
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS labels (
  id VARCHAR(64) NOT NULL COMMENT 'Código QR / identificador único',
  created_at DATETIME(3) NOT NULL,
  fecha VARCHAR(64) NOT NULL COMMENT 'Fecha operacional definida manualmente',
  exportacion VARCHAR(255) NOT NULL DEFAULT '',
  season_id BIGINT UNSIGNED NULL,
  company_id BIGINT UNSIGNED NULL,
  season_cost_center_id BIGINT UNSIGNED NULL,
  empresa VARCHAR(255) NOT NULL,
  csg VARCHAR(255) NOT NULL,
  especie VARCHAR(255) NOT NULL,
  variedad VARCHAR(255) NOT NULL,
  centro_costo VARCHAR(255) NOT NULL,
  sector VARCHAR(255) NOT NULL COMMENT 'Manual por operador',
  cantidad_totes INT NULL COMMENT 'Primer trackeo JC',
  jefe_cuadrilla VARCHAR(255) NOT NULL DEFAULT '' COMMENT 'Primer trackeo JC',
  created_by BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_labels_created_at (created_at),
  KEY idx_labels_lookup (season_id, company_id, season_cost_center_id),
  KEY idx_labels_created_by (created_by),
  CONSTRAINT fk_labels_season
    FOREIGN KEY (season_id) REFERENCES seasons (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_labels_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_labels_scc
    FOREIGN KEY (season_cost_center_id) REFERENCES season_cost_centers (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_labels_created_by
    FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lecturas JC (salida de campo) y acopio (llegada): fuente de verdad para reportes.
-- Toda lectura que deba aparecer en el Excel global debe insertarse aquí (POST /api/movements);
-- la app no usa el navegador como sustituto de esta tabla para el reporte administrativo.
CREATE TABLE IF NOT EXISTS movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  label_id VARCHAR(64) NOT NULL,
  type ENUM('jc', 'acopio') NOT NULL,
  cantidad INT UNSIGNED NOT NULL,
  at DATETIME(3) NOT NULL,
  registered_by VARCHAR(120) NOT NULL DEFAULT '',
  precio_clp INT UNSIGNED NULL COMMENT 'Respaldo de precio en primer trackeo JC',
  created_by BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_movements_label_at (label_id, at),
  KEY idx_movements_created_by (created_by),
  CONSTRAINT fk_movements_label
    FOREIGN KEY (label_id) REFERENCES labels (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_movements_created_by
    FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS batch_logs (
  id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  count INT UNSIGNED NOT NULL,
  empresa VARCHAR(255) NOT NULL,
  especie VARCHAR(255) NOT NULL,
  created_by BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_batch_logs_created (created_at),
  KEY idx_batch_logs_created_by (created_by),
  CONSTRAINT fk_batch_logs_created_by
    FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS batch_log_labels (
  batch_id CHAR(36) NOT NULL,
  label_id VARCHAR(64) NOT NULL,
  position INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (batch_id, label_id),
  KEY idx_batch_log_labels_label (label_id),
  CONSTRAINT fk_batch_log_labels_batch
    FOREIGN KEY (batch_id) REFERENCES batch_logs (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_batch_log_labels_label
    FOREIGN KEY (label_id) REFERENCES labels (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Datos base de roles
INSERT INTO roles (code, name, description)
VALUES
  ('superadmin', 'SuperAdmin', 'Control total del sistema'),
  ('admin', 'Admin', 'Gestión operativa y administrativa'),
  ('operador', 'Operador', 'Acceso restringido a formularios operativos')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description);

SET FOREIGN_KEY_CHECKS = 1;
