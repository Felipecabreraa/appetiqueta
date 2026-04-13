-- App Etiquetado — esquema relacional alineado con el frontend (localStorage).
-- Motor: MySQL 5.7+ / MariaDB 10.2+ (InnoDB, utf8mb4).
-- Ejecutar en phpMyAdmin o cliente SQL del hosting tras crear la base de datos.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- Etiquetas (LabelRecord)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS labels (
  id VARCHAR(64) NOT NULL COMMENT 'Código QR / id único (app lo normaliza a mayúsculas)',
  created_at DATETIME(3) NOT NULL COMMENT 'ISO al crear el lote',
  fecha VARCHAR(64) NOT NULL COMMENT 'Fecha/hora mostrada en etiqueta',
  exportacion VARCHAR(255) NOT NULL DEFAULT '',
  empresa VARCHAR(255) NOT NULL,
  csg VARCHAR(255) NOT NULL,
  especie VARCHAR(255) NOT NULL,
  variedad VARCHAR(255) NOT NULL,
  centro_costo VARCHAR(255) NOT NULL,
  sector VARCHAR(255) NOT NULL,
  cantidad_totes INT NULL COMMENT 'Primer trackeo JC',
  jefe_cuadrilla VARCHAR(255) NOT NULL DEFAULT '' COMMENT 'Primer trackeo JC',
  PRIMARY KEY (id),
  KEY idx_labels_created_at (created_at),
  KEY idx_labels_empresa_especie (empresa, especie)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Movimientos de trazabilidad (Movement: jc | acopio)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  label_id VARCHAR(64) NOT NULL,
  type ENUM('jc', 'acopio') NOT NULL COMMENT 'jc = salida JC; acopio = llegada a acopio',
  cantidad INT UNSIGNED NOT NULL,
  at DATETIME(3) NOT NULL COMMENT 'Momento del registro (ISO en app)',
  PRIMARY KEY (id),
  KEY idx_movements_label_at (label_id, at),
  CONSTRAINT fk_movements_label
    FOREIGN KEY (label_id) REFERENCES labels (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Historial de lotes generados (BatchLogEntry)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS batch_logs (
  id CHAR(36) NOT NULL COMMENT 'UUID del lote en historial',
  created_at DATETIME(3) NOT NULL,
  count INT UNSIGNED NOT NULL COMMENT 'Cantidad de etiquetas en el lote',
  empresa VARCHAR(255) NOT NULL,
  especie VARCHAR(255) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_batch_logs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Relación lote ↔ etiquetas (orden del array labelIds en la app)
CREATE TABLE IF NOT EXISTS batch_log_labels (
  batch_id CHAR(36) NOT NULL,
  label_id VARCHAR(64) NOT NULL,
  position INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Orden dentro del lote (0 = primero)',
  PRIMARY KEY (batch_id, label_id),
  KEY idx_batch_log_labels_label (label_id),
  CONSTRAINT fk_batch_log_labels_batch
    FOREIGN KEY (batch_id) REFERENCES batch_logs (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_batch_log_labels_label
    FOREIGN KEY (label_id) REFERENCES labels (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
