# TURNUP — Fase 5.1: finalización, rediseño y validación

Rama `fase5-estabilizacion-comercial`. **Producción no se modificó**: no hubo migraciones, deploy ni merge.
Lo único que se escribió en producción fue una reserva de prueba autorizada, que se canceló enseguida.

## 1. Reservas de prueba en producción (camp-nou)

| Prueba | Resultado |
|---|---|
| Invitado, desde la página pública con el navegador (vie 27/11, 21:00, cancha 1) | Respuesta **201**: solicitud pendiente de aprobación, código `JNKJMZ85`. **Cancelada** a los 28 s desde el enlace privado ("Tu reserva fue cancelada. El turno quedó libre."). |
| Jugador registrado | **No realizada.** Requiere iniciar sesión con contraseña, y eso lo tiene que hacer el dueño de la cuenta en el navegador integrado. |
| Logs de Netlify | La pestaña de Netlify del navegador integrado pide inicio de sesión. Si iniciás sesión, puedo leerlos. |

Producción, consultada en modo de solo lectura:
- A las 22:11 UTC alguien hizo una reserva como invitado en camp-nou y la canceló a los 16 s. Funcionó.
- Al momento de la prueba había 1 perfil de jugador.

**Conclusión honesta:** con los datos y el código actuales, reservar como invitado funciona en producción.
El error original no se pudo reproducir y no hay registro de su causa, porque la versión publicada no
registra los errores 4xx. Lo corrigió la Fase 5, que todavía no está publicada. **No se da por solucionado.**
Después de publicar, cualquier error mostrará el campo inválido o un código de soporte que se puede ubicar en los logs.

## 2. Rediseño visual

- **Sistema compartido:**
  - Variables de color, espacios, tipografía y radios en `globals.css`.
  - Componentes en `ui.module.css`: botones, campos, selectores, tarjetas, tablas que en el celular pasan a tarjetas con etiquetas, alertas, estados vacíos y de carga, insignias de estado.
  - Íconos de una sola biblioteca (Lucide).
  - `AppShell` (panel y superadmin): barra lateral en escritorio; barra inferior + menú "Más" + botón de acción en el celular.
  - `AuthLayout` para inicio de sesión y registro, y `FilterBar`: búsqueda siempre visible y filtros plegables.
- **Jugador:**
  - Inicio, explorar y búsqueda.
  - Ficha del complejo con reserva en 3 pasos:
    - "Cualquier cancha" muestra **una sola grilla de horarios** y asigna la cancha libre más barata.
    - Los horarios pasados y ocupados se ocultan por defecto.
    - En el celular hay 4 horarios por fila.
  - Resumen con precio, seña y saldo; pantalla de transferencia con alias, importe y código para copiar, y cuenta regresiva.
  - Seguimiento, Mis turnos por estado, avisos con campana y perfil: avatar con iniciales, deportes como botones, cuenta.
- **Panel:**
  - Inicio con avisos de transferencias e **incidencias** sin resolver, y agenda del día.
  - Calendario con agenda móvil.
  - Reservas, transferencias, canchas, clientes, finanzas, horarios, ajustes, cobros, página y fotos, equipo y plan.
  - En el celular: barra inferior con "Pagos" y su contador, más el botón para crear una reserva.
- **Superadmin:**
  - Resumen con ingresos de TURNUP separados del dinero de los complejos, y alertas.
  - Complejos, usuarios, planes y suscripciones, sistema, auditoría y seguridad.
  - Ficha de complejo con **edición de nombre, dirección, ciudad, provincia, teléfono y email**. El slug no se cambia para no romper enlaces.
  - Las acciones destructivas van en una zona separada.

## 3. Transferencias reforzadas

- Cada reserva guarda **la copia** de los datos de cobro mostrados: alias, CBU/CVU, titular, banco, importe, moneda, seña y política.
  - Si el complejo cambia sus datos, las reservas existentes no cambian, y se avisa al dueño si había solicitudes pendientes.
  - El jugador ve la copia solo mientras su reserva espera la transferencia o su revisión.
- Búsqueda por jugador, titular, código, importe y número de operación.
- Un mismo número de operación **no confirma dos reservas** del mismo complejo (índice único y verificación al informar).
- Se registra el **importe recibido**. Si es menor o mayor que el esperado, hace falta una decisión explícita y queda una incidencia abierta.
- Ninguna otra pantalla confirma una reserva que espera transferencia.
- Las transferencias no verificadas **no cuentan como ingresos**.
- Vencimientos, cubiertos con pruebas:
  - Informar segundos antes del vencimiento se acepta; después, queda como incidencia.
  - Si el complejo no revisa a tiempo, el turno se libera y hay aviso.
  - Un turno liberado puede tomarlo otro jugador y la reserva vieja ya no se confirma.
  - El dinero recibido de una reserva rechazada queda como incidencia.
- Las incidencias abiertas se ven en el inicio y en el contador de navegación hasta que se resuelven.

## 4. Notificaciones

Hay plantillas listas para:
- Nueva solicitud y datos para transferir.
- Transferencia informada.
- Reserva confirmada, rechazada, cancelada, modificada y vencida.
- Recordatorio.
- Incidencia de pago.

Sin duplicados: clave única por evento y bloqueo por fila. Un aviso que ya quedó desactualizado no se envía.

- **Frecuencia:**
  - La tarea programada corre cada 30 min, y el plazo para transferir es de 30 min.
  - Por eso los emails ahora se envían **apenas termina la acción**, cuando hay proveedor configurado.
  - La alerta previa de revisión sale con 45 min de anticipación.
- **Hoy no se envían emails** porque Resend no está configurado. Los avisos dentro de TURNUP funcionan igual.

## 5. Seguridad

- Prueba automática: **todas** las acciones del superadmin exigen superadmin con 2FA, y las de cobros exigen su permiso.
  Los datos bancarios los cambia solo el dueño.
- Un usuario suspendido no puede reservar como usuario autenticado. Hay doble control: la sesión y la propia reserva.
- Ya probado en la Fase 5:
  - Suspender cierra las sesiones.
  - No se puede suspender ni eliminar al último superadmin ni a uno mismo.
  - Anonimizar exige resolver las reservas futuras y reasignar los dueños, y conserva el historial financiero.
  - Archivar exige suspender antes y confirmar el slug; también se puede desarchivar.

## 6. R2 y respaldos

Ver `docs/IMAGENES.md` y `docs/RESPALDOS.md`.

- **R2:**
  - El código está listo, sin respaldo silencioso a PostgreSQL. Producción tiene 0 imágenes.
  - Falta que crees la cuenta, el bucket y el token, y que cargues las variables en Netlify **antes** de publicar.
- **Respaldos:**
  - Prueba real de volcado cifrado y restauración en una rama aislada: conteos idénticos.
  - Falta que crees el rol, la clave y los secretos, y una primera corrida del workflow.

## 7. Pruebas

- Vitest: 33 archivos, 250 pruebas.
- Playwright E2E: 37 pruebas.
- Auditoría visual: 4 recorridos.
  - Recorrido completo: registro → búsqueda → ficha → horario → reserva con seña → transferencia informada → verificación del complejo → confirmación → historial.
  - Sin desbordes en 320, 375, 390, 768, 1440 y 1920 px.
  - 199 capturas reales en `capturas/` (fuera de `test-results/`).
- tsc, ESLint y build sin errores.
- Migraciones: las 4 pendientes se probaron en una rama aislada de Neon (copia de producción, borrada al terminar).
  Resultado: esquema igual al código, datos intactos (4 complejos, 4 usuarios, 4 reservas) y RLS activo.

## 8. Para publicar (requiere tu autorización final)

1. R2 configurado en Netlify (`docs/IMAGENES.md`). Si no, la subida de imágenes queda bloqueada con un mensaje claro.
2. `git push` de la rama y revisión de las capturas.
3. `node scripts/ops/neon-safe-migrate.mjs`, que aplica estas 4 migraciones aditivas:
   - `20261205000000_fase5_transfers_admin`
   - `20261205000100_inbox_player_notify`
   - `20261205000200_transfer_expiry_alerts`
   - `20261205000300_transfer_hardening`

   Antes de aplicarlas, prueba en una rama aislada y crea una rama de respaldo. Única escritura sobre datos existentes: vacía las fotos de jugadores (hoy no hay).
4. Merge a `main`, con lo que Netlify despliega. Rollback: `docs/ROLLBACK.md`.
