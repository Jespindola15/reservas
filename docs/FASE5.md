# TURNUP — Fase 5: estabilización y preparación comercial

Rama: `fase5-estabilizacion-comercial`. **Producción no se modificó**: las migraciones se probaron en una rama
aislada de Neon (copia de producción, borrada al terminar) y quedan listas para aplicar con autorización.

## 1. Error de reservas

### Qué se verificó

| Verificación | Resultado |
|---|---|
| Código publicado (`main`, e7185e1) contra una **copia exacta de los datos de producción** en una rama aislada de Neon (PostgreSQL 18.7, misma región) — reserva como invitado en camp-nou | Se creó bien (201) |
| Lo mismo con la sesión del dueño de camp-nou (sin perfil de jugador) | Se creó bien |
| API de producción: disponibilidad de camp-nou y validación de una solicitud inválida | Responden bien (200 y 400 con JSON) |
| Mismo flujo en local con la interfaz (invitado y dueño de otro complejo con sesión) | Se creó bien; queda como prueba E2E de regresión |
| Registros de producción del intento fallido (20:07 UTC) | Consumió el límite de pedidos de reserva pero **no** creó reserva, cliente ni registro de auditoría |

Conclusión: la lógica de reservas, RLS, restricciones, zona horaria, precios y migraciones **no** fallan con los
datos actuales. El pedido llegó al servidor y fue rechazado **antes** de guardarse, por una validación o una
regla de negocio. No se puede saber cuál: los errores 4xx no dejaban ningún registro, y el formulario
mostraba mensajes genéricos. Eso era el defecto de fondo, y se corrigió (no se ocultó el mensaje):

1. **Errores sin rastro**: ahora cada error de negocio se registra en los logs de Netlify (código, campos
   inválidos y un id de soporte; nunca los datos enviados).
2. **Mensajes que no ayudaban**: el formulario nombra el campo inválido ("Revisá estos datos: teléfono…") y
   muestra un código de soporte para buscarlo en los logs.
3. **Respuesta no-JSON** (p. ej. un 502 de la plataforma) se mostraba como "Problema de conexión"; ahora
   indica el estado HTTP.
4. **Campo trampa antibots llamado `website`**: el autocompletado del navegador o un gestor de contraseñas
   puede llenarlo, y entonces la reserva se rechazaba como si fuera un bot. Se renombró a un nombre sin
   significado e ignorado por los gestores de contraseñas.
5. **Teléfono**: el navegador aceptaba letras que el servidor rechaza; ahora valida igual en ambos lados.
6. **"Horario demasiado cerca"**: si el turno quedaba dentro de la anticipación mínima mientras se
   completaban los datos, ahora se recarga la grilla.

Pendiente de confirmación: después del despliegue, si el error vuelve a aparecer, el mensaje dirá qué campo
falló o mostrará un código de soporte que permite ubicarlo en los logs.

### Otros errores reales encontrados en la investigación

- **Contador de visitas de la ficha**: fallaba en silencio en producción (`$queryRaw` sobre una función SQL
  `void`). Corregido con `$executeRaw` y prueba de regresión.
- **Imágenes de canchas en R2**: la regla de la base usaba `{10,300}` y PostgreSQL admite como máximo 255
  repeticiones: toda imagen de cancha en almacenamiento de objetos habría fallado. Corregido en la migración
  `20261205000200`.

## 2. Reservas con transferencia directa (TURNUP no maneja dinero)

- **Datos de cobro** (Panel → Datos de cobro). Los cambia **solo el dueño**: un administrador podría desviar
  cobros a otra cuenta.
  - Configuración: seña fija, porcentual, total o sin seña; alias, CBU/CVU (con dígito verificador), titular,
    banco, plazo para transferir, plazo de revisión e instrucciones.
  - Vista previa para el jugador.
  - Auditoría sin guardar alias/CBU en el log.
  - Si se pide seña sin datos, las reservas online quedan bloqueadas.
- **Jugador** (widget, enlace privado y Mis turnos):
  - Pregunta si transfiere desde una cuenta a su nombre; si no, pide el titular.
  - El importe lo calcula el servidor.
  - Datos con botones de copiar, código de reserva y cuenta regresiva.
  - Mensaje: "Tu turno todavía no está confirmado…".
  - "Ya realicé la transferencia" con número de operación opcional. Sin comprobantes, DNI ni datos bancarios del jugador.
- **Estados**: el estado de la reserva y el del pago se guardan por separado.
  - De la reserva: pendiente, confirmada, rechazada, vencida, cancelada, jugada, ausente.
  - Del pago: no requerido, pendiente de transferencia, transferencia informada, verificado.
- **Retención**:
  - El turno queda tomado durante el plazo para transferir. Al informar, empieza el plazo de revisión, una sola vez.
  - El vencimiento libera el turno en el momento: la disponibilidad trata como libre una reserva vencida, y el
    vencimiento se aplica dentro de la transacción de reserva, sin depender de la tarea de 30 minutos.
  - Máximo 2 turnos sin pagar por persona. La restricción antisolapamiento sigue intacta.
- **Pago tardío**: genera una incidencia y aviso al complejo. Nunca se confirma solo un turno ya asignado a otra persona.
- **Panel → Transferencias por verificar**:
  - Pestañas: informadas, esperando, incidencias, historial. Búsqueda por nombre, titular, código o importe, y filtros por cancha y fecha.
  - Confirmar indicando el importe recibido: queda registrado quién verificó, cuándo y cuánto. No se puede confirmar dos veces.
  - Rechazar con motivo (con incidencia si llegó dinero), nota interna, WhatsApp con texto precargado (lo envía la persona) e incidencias con devolución registrada como externa.
  - La confirmación general de reservas ya no puede saltear la verificación del pago.
- **Avisos internos** (bandeja del panel y campana del jugador):
  - Al complejo: solicitud nueva, transferencia informada, alerta 45 min antes de que venza la revisión, vencimiento sin revisar e incidencias.
  - Al jugador: transferencia en revisión, confirmación, rechazo y vencimiento.
- **Pendiente**: plantillas de email de estos eventos para Resend. Hoy se ven dentro de TURNUP y no se envían por email.

## 3. Fotos de jugadores

Se eliminaron: endpoint, acción y UI. Ahora se muestra un avatar con iniciales y la migración vacía las fotos
guardadas. Las columnas se borrarán en una migración posterior al despliegue. Las fotos de complejos no se tocaron.

## 4. Imágenes en Cloudflare R2

Ver `docs/IMAGENES.md`: pasos exactos en Cloudflare, variables de Netlify y migración verificada
(`--execute` y luego `--free-db`). No se activó nada en Cloudflare.

## 5. Superadministrador

- **Usuarios**:
  - Búsqueda, filtros, orden y paginación. La ficha no muestra contraseñas, tokens ni secretos.
  - Suspender exige motivo y cierra las sesiones al instante; también reactivar, cerrar sesiones y enviar recuperación de contraseña.
  - Eliminar = anonimizar, con vista previa del impacto. Exige resolver reservas futuras y reasignar dueños, y conserva el historial de los complejos.
  - No se puede suspender ni eliminar al último superadmin ni a uno mismo.
- **Complejos**:
  - Búsqueda, filtros (activo, suspendido, archivado, en prueba, sin suscripción vigente), orden y paginación.
  - Ficha con indicadores, edición del nombre, cambio de dueño (el anterior queda como administrador), asignación de plan y vencimiento, y extensión de prueba.
  - Suspensión con motivo obligatorio: oculto del catálogo, sin reservas nuevas, datos conservados.
  - Archivo (baja lógica): solo si está suspendido y escribiendo el slug.
- Todo queda auditado. El 2FA del superadmin sigue siendo obligatorio.

## 6. Responsive

`tests/visual/responsive.spec.ts` recorre 3 interfaces en 320, 375, 390, 430, 768, 1024, 1280, 1440 y 1920 px,
guarda capturas y **falla si hay desplazamiento horizontal**.

- Antes: el inicio del panel a 320/375 px y las estadísticas a 320 px desbordaban.
- Corrección: grillas con `minmax(min(100%, N), 1fr)` en todo el sistema.
- Después: 0 desbordes en 20 páginas × 9 anchos.

**No se hizo** el rediseño visual integral de las tres interfaces pedido en los puntos 6 a 8. Esta fase
priorizó estabilidad, cobros, administración y responsive. Queda como siguiente bloque.

## 7. Respaldos

Ver `docs/RESPALDOS.md`: rol de solo lectura con BYPASSRLS, clave age, secretos de GitHub, restauración y
verificación mensual. El workflow semanal ahora también respalda las imágenes de R2. Una rama de Neon no
reemplaza el respaldo.

## 8. Pruebas

- Vitest: 29 archivos, 236 pruebas.
- Playwright E2E: 37 pruebas. Nuevas: transferencia completa, suspensión de jugador y regresión del error de reservas.
- Auditoría responsive: 3 pruebas.
- tsc, ESLint y build sin errores.
- Migraciones: aplicadas en local (dev/test/e2e) sin diferencias de esquema, y en una **rama aislada de
  Neon** (`neon-safe-migrate.mjs --dry-run`): esquema igual al código, datos intactos (3 complejos, 3 usuarios,
  1 reserva) y RLS activo.

## 9. Para publicar (requiere tu autorización)

1. `git push -u origin fase5-estabilizacion-comercial` y revisar.
2. `node scripts/ops/neon-safe-migrate.mjs` aplica las 3 migraciones. Antes crea una rama de respaldo y verifica.
   Son aditivas: no borran datos. La única escritura sobre datos existentes vacía las fotos de jugadores.
3. Merge a `main`, con lo que Netlify despliega.
4. Opcional: R2 (`docs/IMAGENES.md`) y respaldos (`docs/RESPALDOS.md`).

Rollback: `docs/ROLLBACK.md`, que restaura desde la rama de respaldo que crea el script.
