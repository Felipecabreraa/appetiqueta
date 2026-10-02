# Cierre — Lectura QR multiusuario sin errores

- **Origen:** pedido del usuario: "no pueden haber errores en las lecturas; es multiusuario; cada persona escanea y completa el formulario de su lectura; los datos deben guardarse correctamente".
- **Proceso:** auditoría del revisor-codigo (veredicto inicial NO APTO: 2 bloqueantes, 7 importantes, 9 menores) + pruebas E2E con varios celulares simulados.
- **Rama:** fix/qr-multiusuario → developer · **Producción:** pendiente de aprobación.

## Correcciones
| Hallazgo | Corrección |
|---|---|
| B1 Decimales truncados en silencio (2,5 totes → 2 en BD) | Cliente y servidor exigen enteros; el servidor rechaza con 400 en vez de truncar; topes máximos |
| B2 Hora de la lectura tomada del reloj del celular | La fija el servidor |
| I1 Si la BD rechaza una conexión, el proceso se cae para todos | 503 `db_unavailable` en las 4 rutas transaccionales + manejador global de promesas rechazadas |
| I2 Formulario armado desde el caché sin confirmar; sin aviso si falla la verificación | Siempre se verifica con el servidor antes de mostrar el formulario; si no se puede, aviso visible |
| I3 El perdedor de una carrera queda en un formulario desactualizado | Ante 409 de estado: re-sincroniza y muestra la fase real con el aviso (móvil y escritorio) |
| I4/W1 JC de escritorio sin precio (y con el servidor estricto fallaría siempre) | Campo Precio (CLP) en "Registrar lecturas"; el servidor exige precio y JH en el primer JC |
| I5 Doble envío en escritorio | Bloqueo desde el inicio del registro |
| I6 Límites por IP bajos para cuadrillas detrás de la misma IP | Lecturas 600/min, consultas 1200/min, login solo cuenta los intentos fallidos; `/api/health` expone `clientIp` para verificar la IP real en Render |
| M1/W3 Mensaje de red en inglés o engañoso | Mensaje en español que indica re-escanear para confirmar |
| M2 Sin timeout | 20 s en las llamadas a la API |
| M3 Se borraban los datos digitados al llegar la sincronización | Ya no hay formulario antes de verificar |
| M4/M5 Entradas laxas y sin topes | Validación estricta en el servidor (JC ≥ 1, enteros, topes) |
| M7 Redirección abierta desde el lector QR interno | Solo se siguen enlaces de la propia app |

## Decisiones (a confirmar por el usuario)
- Acopio = 0 totes se acepta (pérdida total). Topes: 100.000 totes, $100.000.000 CLP, 10.000 JH.
- Autoría de las lecturas en terreno (nombre del operario): pendiente de definir (M8).

## Evidencia
| Escenario | Prueba | Resultado |
|---|---|---|
| 8 celulares registran JC y acopio de 8 etiquetas en paralelo; datos exactos en BD | multiusuario.spec.ts | ✅ (3 repeticiones) |
| 2 celulares guardan el JC de la misma etiqueta a la vez | ídem | ✅ gana uno; el otro ve el aviso y pasa a acopio |
| Celular con caché viejo | ídem | ✅ ve el estado real |
| Formulario abierto con estado viejo no registra un segundo JC | ídem | ✅ |
| Validaciones del formulario (0, decimales) | ídem | ✅ |
| El servidor rechaza cantidades inválidas | ídem | ✅ |
| Hora del servidor | ídem | ✅ |
| Sin conexión: aviso de "no se pudo verificar" | ídem | ✅ |
| Escritorio: primer JC con precio y JH, luego acopio | registro-escritorio.spec.ts | ✅ desktop + móvil |
| Carga: 300 etiquetas, 16 lecturas concurrentes | test:e2e:api | ✅ 43/43 |
| Regresión | verify (33 unit) · build · Playwright 42/42 · E2E API 43/43 | ✅ |

## Segunda revisión (commit b705fe7): 3 regresiones corregidas
| Hallazgo | Corrección | Prueba |
|---|---|---|
| R1 El login con countIf se podía saltar con una ráfaga en paralelo | Se cuenta al entrar y se descuenta al terminar si no fue fallo | `rateLimit.test.ts`: 50 intentos simultáneos → pasan 3 |
| R2 El timeout global de 20 s cortaba la importación y la exportación | Timeout solo en llamadas de terreno; el resto sin límite | revisión + regresión E2E (maestros Excel, Excel de trackeo) |
| R3 `AbortSignal.timeout` no existe en iOS < 16 | Helper `timeoutSignal` con respaldo | `timeout.test.ts` |
| I7 El arranque en frío de Free superaba 20 s | Timeout de terreno de 60 s | — |
| N1 Etiqueta borrada en el servidor pero en caché | Se muestra "no encontrada" (manda el servidor) | revisión |
| N3/N4/N6 | Mensaje de datos inválidos específico; mensaje de red propio en escritorio; indentación | revisión |

## Aprobación para producción
- **Fecha:** 2026-10-01 · **Usuario:** respuesta textual "Apruebo publicar" a la pregunta "¿Apruebas publicar en PRODUCCIÓN (etiqueta.trn.cl)?", tras ver el paquete (auditoría APTO, evidencia de pruebas, cambios visibles, migración y rollback).
- **Alcance:** todo lo acumulado en `developer` hasta este commit (equipo agéntico, CI, ambientes, guardián, seguridad de lecturas, cobertura E2E, lectura QR multiusuario, IP real tras Cloudflare).
