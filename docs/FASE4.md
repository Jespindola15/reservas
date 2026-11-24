# Fase 4 — Plataforma para jugadores (marketplace)

TURNUP pasa a tener tres interfaces independientes sobre el mismo backend:

| Interfaz | Rutas | Quién |
|---|---|---|
| Plataforma de jugadores | `/`, `/explorar`, `/<complejo>`, `/mis-turnos`, `/perfil`, `/cuenta/*` | Cualquiera (invitado) o jugador con cuenta |
| Panel del complejo | `/panel/<complejo>/*` | Dueño, administrador, personal (membresías) |
| Superadministración | `/admin/*` (con 2FA) | Superadmin de TURNUP |

La landing comercial para complejos se movió a `/para-complejos`. Los enlaces públicos de cada complejo
(`/<slug>`) y los enlaces privados de reserva siguen funcionando igual.

## Seguridad y separación de datos

- **Rol de jugador global**: un usuario sin membresías. Registrarse nunca da acceso a un panel; las rutas
  `/panel/*` y `/admin/*` devuelven 404. El registro es propio (servidor), con límite por IP, campo trampa y
  aceptación de términos; el alta directa de Better Auth sigue deshabilitada.
- **Contexto de jugador** (`withPlayer`): fija `app.player_id`, una variable DISTINTA de la del complejo. RLS
  en `player_profiles` y `player_favorites` = solo filas propias. Un empleado que además es jugador no mezcla
  contextos.
- **Reservas del jugador** en todos los complejos: función `app_player_bookings` (SECURITY DEFINER) que solo
  devuelve filas con `player_user_id = app.player_id`. Sin esa variable, devuelve vacío.
- **Vincular reservas de invitado**: solo con el **enlace privado** (código + token HMAC) que recibió quien
  reservó. Nunca por coincidencia de email/teléfono. Una reserva ya vinculada a otra cuenta no se puede tomar.
- **Reserva con sesión**: la API asocia la cuenta solo si el `Origin` es el propio sitio (anti-CSRF); si no,
  se reserva como invitado. La disponibilidad y el antisolapamiento se validan igual que siempre en el servidor.
- **Datos públicos separados**: catálogo, novedades y opiniones salen de funciones SECURITY DEFINER que solo
  devuelven columnas públicas (sin emails, teléfonos de clientes ni datos administrativos). Autor de opiniones
  abreviado ("Juan P.").
- **Datos mínimos**: perfil con nombre, email, y opcionalmente teléfono, ciudad, deportes y foto (256 px WebP,
  privada). Visitas a fichas = contador diario sin IP.

## Funcionalidades

- **Inicio**: saludo, búsqueda + ciudad, deportes, próximo turno, botón "Reservar", favoritos, novedades
  reales publicadas por complejos (con vencimiento), destacados (primero tu ciudad y mejor valorados con
  opiniones reales).
- **Explorar**: catálogo de complejos activos y publicados; búsqueda por nombre/zona, ciudad, deporte, precio
  máximo por hora, prestaciones, canchas techadas y **turnos libres en una fecha** (disponibilidad real,
  calculada para los primeros 24 resultados para cuidar la base). Vista de listado; el modelo de datos queda
  listo para un mapa cuando los complejos carguen coordenadas (la geolocalización del navegador se ofrecerá
  recién entonces, con consentimiento).
- **Ficha**: logo, portada, galería, dirección, ciudad, WhatsApp, teléfono, redes, deportes, canchas con
  superficie, dimensiones, techada/descubierta, iluminación y capacidad, prestaciones, seña, política de
  cancelación, opiniones verificadas con respuesta del complejo y denuncia, favoritos.
- **Reserva**: calendario horizontal (14 días) → cancha con características → duración y horarios →
  resumen (complejo, dirección, cancha, deporte, fecha, horario, duración, total, **seña y saldo**, política de
  cancelación) → confirmación. Con sesión, datos precargados y la reserva queda en "Mis turnos".
- **Mis turnos**: próximos e historial en todos los complejos, cancelación dentro del plazo, opinar sobre turnos
  jugados, vincular reservas de invitado.
- **Perfil**: datos, foto opcional, deportes favoritos, preferencias de notificaciones (respetadas al enviar),
  favoritos, acceso al panel si además administra un complejo.
- **Opiniones**: 1–5 estrellas + comentario, una por reserva jugada (confirmada y terminada o marcada como
  jugada) dentro de 90 días. El complejo responde y denuncia; **no puede borrar**. La moderación (ocultar /
  mantener / restaurar) la hace el superadmin en `/admin/moderacion`.
- **Panel del complejo**: publicar/ocultar en el catálogo (el enlace directo sigue), ciudad, fotos, prestaciones,
  características de canchas, seña, novedad/promoción, opiniones, y en Estadísticas: visitas a la ficha y
  reservas desde el catálogo vs. enlace directo.
- **Pagos**: arquitectura preparada (`src/modules/payments/provider.ts`) sin cobros online ni simulaciones.

## Navegación y PWA

Barra inferior (móvil) / superior (escritorio): Inicio, Explorar, Mis turnos, Perfil.
La PWA instalada abre el inicio de jugadores; atajos: Reservar cancha, Mis turnos, Calendario del complejo.
El service worker sigue sin cachear páginas ni datos privados.

## Alcance

TURNUP se enfoca exclusivamente en la gestión de complejos y las reservas deportivas. Quedan **fuera del
alcance** (no se implementan ni se planifican): organización de partidos, partidos abiertos, búsqueda de
jugadores, grupos, invitaciones deportivas, división de gastos, clases, torneos y rankings.

## Migraciones (aditivas)

- `20261201000000_players_marketplace`: `player_profiles`, `player_favorites`, `reviews`, `review_reports`,
  `tenant_daily_views`; columnas `bookings.player_user_id`, `bookings.origin`, `courts.surface/dimensions/
  covered/lighting`, `tenants.city/deposit_*`; RLS, CHECKs, funciones públicas y de jugador.
- `20261201000100_announcements`: novedades/promociones con vencimiento y su función pública.

## Pendiente

- Mapa y orden por distancia (requiere que los complejos carguen coordenadas).
- Verificación del email del jugador (requiere el proveedor de email en producción).
- Cobro de señas con Mercado Pago (arquitectura lista, sin implementar).
- Revisión legal de términos/privacidad antes de abrir el registro masivo.
