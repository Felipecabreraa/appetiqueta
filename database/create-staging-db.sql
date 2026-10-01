-- Crear la BD y el usuario del ambiente de PRUEBAS (staging) en su servidor MySQL.
-- Ejecutar como administrador del servidor MySQL. Reemplace <clave-segura> y, si aplica, '%' por la IP/host de Render.
-- El usuario de staging NO debe tener permisos sobre la BD de producción.
CREATE DATABASE IF NOT EXISTS trn_etiquetatest CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'trn_etiquetatest'@'%' IDENTIFIED BY '<clave-segura>';
GRANT ALL PRIVILEGES ON trn_etiquetatest.* TO 'trn_etiquetatest'@'%';
FLUSH PRIVILEGES;
-- Luego: npm run db:staging:init  (aplica schema.sql usando .env.staging)
