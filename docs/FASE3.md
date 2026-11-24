# TURNUP — Fase 3: autonomía, notificaciones, PWA y preparación comercial

Estado al 24/11/2026. Todo lo marcado como verificado se probó **localmente** (PostgreSQL 16, build de producción,
Chromium). Nada se probó contra la producción real ni contra servicios externos (Resend, R2, Netlify).

## Terminado

### A. Auditoría del despliegue
Ver `docs/INFRAESTRUCTURA.md` §1 (lo verificado y lo que falta confirmar con acceso a Netlify/base).
Cambio derivado: en serverless el temporizador interno se desactiva solo; el único scheduler es la función
programada de Netlify, que ahora llama a `/api/internal/jobs/tick`.

### B. Notificaciones por email
- **Outbox** en PostgreSQL (`notifications`): la reserva y su aviso se guardan en la **misma transacción**; el envío
  ocurre después. Si el proveedor falla, la reserva no se ve afectada.
- **Deduplicación**: clave única por evento (`booking:<id>:confirmed:v<versión>`, `...:reminder:<inicio>`, etc.).
- **Reintentos** con espera creciente (1, 5, 15, 60, 240 min; máx. 6 intentos). Errores permanentes → `FAILED`.
- Procesamiento concurrente seguro (`FOR UPDATE SKIP LOCKED`); tareas trabadas > 10 min se recuperan.
- **Se arma al enviar**: si la reserva cambió (p. ej. se canceló antes del envío), el aviso viejo se omite.
- Jugador: solicitud recibida, confirmación, cancelación (por el complejo o por el jugador), rechazo,
  reprogramación, recordatorio (N horas antes, configurable) y vencimiento de la solicitud.
- Dueño: nueva reserva/solicitud, cancelación online, resumen diario configurable (hora local).
- Cuenta: recuperación de contraseña e invitación al equipo. El enlace viaja **cifrado** en la cola y se borra
  al enviarse (el payload queda en `NULL`).
- Proveedores: `resend` (preparado, **no configurado ni probado contra el servicio real**), `log` (desarrollo:
  imprime asunto y destinatario redactado, no envía), `memory` (pruebas), `disabled`. Producción sin
  `EMAIL_PROVIDER` = desactivado. **Las pruebas no envían emails reales.**
- Plantillas HTML + texto con identidad TURNUP (negro/azul, lima), datos escapados.
- Ajustes del complejo: activar/desactivar, a jugadores, al complejo, email de avisos, horas del recordatorio,
  resumen diario y su hora.

**Evaluación de Resend**: API HTTP simple (sin SDK), idempotencia nativa (`Idempotency-Key`, la usamos con el id
de la notificación), errores 429/5xx reintentables, y tiene un plan gratuito (confirmar los límites vigentes en
su sitio antes de contratar). Para activarlo: crear cuenta, verificar el dominio (SPF/DKIM), y cargar
`EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`. No se creó ninguna cuenta.

### C. Usuarios, seguridad y equipos
- **Recuperación de contraseña** (`/recuperar`, `/restablecer`) con Better Auth: token de un solo uso, vence en
  1 h, cierra todas las sesiones al cambiarla, misma respuesta exista o no la cuenta, límites por IP (5/15 min,
  solo si hay cabecera de IP) y por email (3/hora, siempre).
- **Equipo** (`/panel/<slug>/equipo`): invitar por email (enlace de un solo uso, 7 días), asignar rol, cambiar
  rol, quitar/reactivar acceso (cierra sesiones), revocar invitaciones. Aceptación con cuenta existente (hay que
  ingresar con ese email) o creando la cuenta.
- Reglas: el dueño gestiona administradores y personal; el administrador solo personal; nadie cambia sus propios
  permisos; el dueño no puede ser modificado. **Doble control**: en la app y en PostgreSQL (trigger
  `memberships_guard` para el rol de la app). Probado intentando escalar por SQL directo.
- Auditoría de cambios de permisos (`team.member.permissions_changed`, con antes/después), invitaciones y
  aceptaciones. Límite de miembros por plan.
- **CSP**: se eliminó `'unsafe-inline'` de **scripts** (nonce por solicitud + `strict-dynamic`). Queda en
  **estilos** (React/Next inyectan atributos `style`); riesgo bajo.
- **CSRF/sesiones** (revisado): cookies `httpOnly`, `Secure`, `SameSite=Lax`; Better Auth valida el `Origin` en
  las mutaciones; las Server Actions de Next validan origen; sesiones de 7 días renovadas 1 vez por día; al
  desactivar un miembro o resetear la contraseña se borran sus sesiones.
- **2FA (evaluado, no implementado)**: Better Auth trae el plugin `twoFactor` (TOTP + códigos de respaldo).
  Encaja con la arquitectura; requiere una migración (tabla `two_factor`) y pantallas de enrolamiento. Recomendado
  como obligatorio para superadmin y opcional para dueños en la próxima iteración.
- Endpoints internos: `tick` y `expire-pending` responden 404 sin `CRON_SECRET` configurado, 401 con secreto
  incorrecto (comparación en tiempo constante) y tienen rate limit.
- Rate limiting sin bloqueos globales: si falta la cabecera de IP, los límites por IP se relajan (×20) en vez de
  bloquear a todos; los límites por cuenta siguen activos.

### D. PWA
- Manifest (`/manifest.webmanifest`), íconos 192/512/maskable/SVG/apple-touch, modo standalone, atajos
  (Calendario, Reservas), color de tema, metadatos de iOS.
- Service worker mínimo (`public/sw.js`): **nunca** cachea páginas, API, disponibilidad, reservas, imágenes ni
  POST. Solo cachea `/_next/static/*` (archivos con hash) e íconos. Sin red → `/offline`, que explica que no se
  puede reservar sin conexión.
- Actualizaciones: aviso “Hay una versión nueva” con botón *Actualizar*. Se encontró y corrigió un error: la
  primera instalación del SW recargaba la página y borraba lo que el usuario estaba escribiendo (lo detectó E2E).
- Botón de instalación (Android/Chrome) e instrucciones para iPhone (*Compartir → Agregar a inicio*).
- Barra inferior en el panel móvil (Inicio, Calendario, Reservas, Clientes).

### E. Operación autónoma
Ver `docs/INFRAESTRUCTURA.md` §3–§6: tick único, `job_runs`, alertas, `/api/health`, logs redactados,
limpieza con retención definida, scripts de backup y prueba de restauración (probados localmente).

### F. Panel y comercial
- Superadmin: planes (crear/editar, precio, límites de canchas y miembros, activo), asignación de plan a un
  complejo (la suscripción anterior queda como historial; bajar de plan no borra nada, solo impide crear más y
  avisa), visor de auditoría con filtros (complejo, acción, origen, fechas) y paginación. Sin cobros.
- Límites aplicados en el servidor: canchas (`createCourt`) y miembros (`inviteMember`).
- Exportación CSV de reservas (con los filtros actuales) y clientes: permiso `data.export` (dueño/admin), máx.
  10.000 filas, protección contra inyección de fórmulas, BOM UTF-8, auditada, rate limit.
- Vista **mensual** del calendario (conteo por día, pendientes, cierres; filtro por cancha).
- Reordenar canchas (orden de la página pública) e imágenes.
- Avisos al cambiar horarios o cargar cierres: “N reservas activas quedaron fuera del nuevo horario (códigos)”.
  No se modifican: el complejo decide.
- Optimización de imágenes y abstracción S3/R2 (ver infraestructura §7).

### G. Calidad
- **Vitest: 159 pruebas, 14 archivos, todas aprobadas** (117 de fases anteriores + 42 nuevas).
  Nuevas: `notifications` (10), `auth-team` (11), `ops-commercial` (13), `pwa` (4), `redaction` (4); además se
  actualizaron `courts-admin` (imagen real, EXIF) y los ajustes.
- **Playwright: 22 pruebas aprobadas** (15 anteriores + 7 nuevas) contra el build de producción.
- TypeScript estricto y ESLint sin errores; `db:drift` sin diferencias (dev y test); build de producción OK.
- CI: `.github/workflows/ci.yml` (PostgreSQL efímero, migraciones, deriva, tipos, lint, Vitest, build, E2E).
  **No se pudo ejecutar acá** (requiere GitHub). No toca el despliegue de Netlify.

## Migraciones nuevas
- `20261125000000_phase3_team_notifications_ops`: ajustes de notificaciones del complejo, `memberships.is_active`,
  límites de plan, imágenes en objeto, tablas `invitations`, `notifications`, `job_runs` (con RLS), trigger de
  permisos, `app_expire_pending_bookings` ahora encola el aviso de vencimiento.
- `20261125000100_membership_guard_runtime_only`: el trigger aplica solo al rol de la app (migraciones y seed no
  quedan bloqueados).

Ambas aditivas. Aplicadas a las bases locales `reservas_dev`, `reservas_test`, `reservas_e2e`. **No** a producción.

## Pendiente (no hecho en esta fase)
- Configurar Resend, R2, monitor externo, webhook de alertas y backups en producción (requieren cuentas/autorización).
- Confirmar el estado real de producción (ver checklist en INFRAESTRUCTURA §1).
- 2FA, CAPTCHA, verificación del contacto del jugador.
- Recortar imágenes en el navegador; arrastrar y soltar en el calendario.
- Manifest por complejo (hoy la app instalada abre el panel); push notifications; API versionada para app nativa.
- Mercado Pago / cobros: excluido por pedido.
