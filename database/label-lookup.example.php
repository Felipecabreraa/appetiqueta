<?php
/**
 * Ejemplo de API para que el móvil cargue una etiqueta por id (GET).
 * Copie a su hosting, ajuste credenciales y URL en VITE_LABEL_LOOKUP_URL.
 *
 * Ejemplo de URL en .env del front:
 *   VITE_LABEL_LOOKUP_URL=https://tudominio.cl/ruta/label-lookup.php?id={{id}}
 *
 * Requisitos: tabla `labels` según schema.sql (columnas snake_case).
 * CORS: ajuste el origen a su app (no deje * en producción si hay datos sensibles).
 */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

$id = isset($_GET['id']) ? strtoupper(trim((string) $_GET['id'])) : '';
if ($id === '' || !preg_match('/^[A-Z0-9_-]{4,64}$/', $id)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'id invalido']);
    exit;
}

$host = 'localhost';
$db   = 'trn_etiqueta';
$user = 'usuario_mysql';
$pass = 'clave_mysql';
$charset = 'utf8mb4';

$dsn = "mysql:host={$host};dbname={$db};charset={$charset}";
try {
    $pdo = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'db']);
    exit;
}

$stmt = $pdo->prepare(
    'SELECT id, created_at, fecha, exportacion, empresa, csg, especie, variedad,
            centro_costo, sector, cantidad_totes, jefe_cuadrilla
     FROM labels WHERE id = ? LIMIT 1',
);
$stmt->execute([$id]);
$row = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$row) {
    http_response_code(404);
    echo json_encode(['ok' => false, 'error' => 'not_found']);
    exit;
}

echo json_encode(['ok' => true, 'label' => $row], JSON_UNESCAPED_UNICODE);
