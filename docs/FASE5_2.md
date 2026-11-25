# Fase 5.2 — Pulido final y lanzamiento

Rama: `fase5-estabilizacion-comercial`. Nada de esto está en producción: no se aplicaron
migraciones ni se publicó (esta fase no agrega migraciones).

## Correcciones visuales

| Punto | Qué se hizo |
|---|---|
| Pantalla de transferencia | `/{slug}/reserva/{código}` muestra, mientras la reserva espera la transferencia, una pantalla propia: resumen, cuenta regresiva, importe, alias, titular, botones de copiar, número de operación opcional, botón para informar y contacto con el complejo (WhatsApp / llamar). |
| Barras en medio de la página | Era un efecto de las capturas de página completa de Playwright (los elementos `fixed` se repiten). Las capturas ahora fijan esos elementos al tomar la imagen y además se guarda la captura real de pantalla (`--pantalla.png`, `--final.png`). La auditoría falla si un botón o enlace queda tapado por una barra, encabezado o botón flotante en anchos menores a 768 px. |
| Calendario en móvil | Pestañas por cancha con libres/ocupados; la cancha elegida muestra una grilla de horas (libre, ocupado, bloqueado, pasado). La lista completa del día queda plegada. |
| Tarjetas de transferencias | Resumen compacto (jugador, cancha, horario, importe, estado, tiempo restante) con Confirmar / Rechazar / WhatsApp a la vista; datos y acciones secundarias desplegables. |
| Eventos técnicos | `src/lib/audit-labels.ts` traduce todas las acciones de auditoría (p. ej. `booking.transfer.reported` → "Transferencia informada"). La auditoría del superadmin tiene filtro por tipo y resume los metadatos en lenguaje natural. La auditoría visual falla si aparece un nombre técnico en pantalla. |
| Fechas, horas y moneda | `src/lib/format.ts`: DD/MM/AAAA, 24 h, ARS, zona Argentina. Aplicado en panel, superadmin y páginas del jugador. |
| Formularios del superadmin | Componente `EditPanel` (modal nativo): editar datos del complejo, cambiar dueño, asignar plan/vencimiento, extender prueba, suspender, archivar, editar nombre de usuario, suspender y eliminar cuenta, nuevo plan, editar plan, registrar pago, nuevo complejo y asignar administrador. El modal se cierra solo al guardar y deja el mensaje junto al botón. |
| Cancha más barata | Antes de confirmar se indica qué cancha se asignó y su precio. |

## Validación funcional

- Reserva pendiente recuperable: se guarda el enlace privado en el dispositivo (solo en el navegador del jugador) y aparece un aviso en la ficha del complejo y en Mis turnos; con cuenta, la reserva figura en Mis turnos.
- Cuenta regresiva con hora del servidor: se corrige la diferencia de reloj del dispositivo y no se reinicia al recargar (el vencimiento lo fija el servidor).
- Avisos del panel en vivo: `PanelLive` consulta `/api/panel/{slug}/avisos` cada 60 s solo con la pestaña visible y con uso reciente (se detiene tras 20 min sin interacción, para que Neon pueda suspenderse). Si cambia algún contador, refresca la vista sin recargar. Cada consulta son tres `COUNT` indexados.
- Enlaces privados: `Referrer-Policy: no-referrer` en la página de la reserva; no se registran URLs en los logs de la aplicación; no hay analítica de terceros.
- Plazo vencido después de informar: el jugador ve instrucciones claras y botones para contactar al complejo.

## Superadministrador (confirmado con pruebas)

Crear, editar, suspender, reactivar, archivar y desarchivar complejos; editar el nombre de usuarios; suspender, reactivar y anonimizar usuarios; cambiar dueños y asignar administradores; planes, suscripciones, vencimientos, pruebas y pagos; motivos de suspensión visibles en listados y fichas; historial de acciones con filtros. Se mantienen: 2FA obligatorio, protección del último superadmin, confirmaciones con texto escrito para acciones destructivas.

## Imágenes: Supabase Storage

Ver `docs/IMAGENES.md`. Bucket `turnup-images`, lectura pública solo de fotos comerciales, escritura únicamente desde el servidor con claves S3 guardadas en Netlify, límites por complejo (60 imágenes / 25 MB), WebP de 100–200 KB, alertas de uso al 70 % y 90 %, respaldo y tarea de mantenimiento contra la pausa por inactividad.

## Pruebas

- Vitest: 33 archivos, 254 pruebas.
- Playwright E2E: 37 pruebas (escritorio y móvil), incluidas la actualización en vivo del panel, los modales del superadmin y el acceso al endpoint de contadores.
- Auditoría visual: 320, 375, 390, 768, 1440 y 1920 px, con controles tapados y textos técnicos. Capturas en `capturas/` (no se suben a GitHub).

## Pendiente

- Prueba de reserva de un jugador registrado en producción (requiere iniciar sesión en el navegador).
- Configurar Supabase, variables de Netlify y secretos de GitHub (guía en la entrega).
- Aplicar las migraciones de la Fase 5 y publicar, con autorización.
