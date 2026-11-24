# Auditoría previa a la comercialización — TURNUP (24/11/2026)

Estado de cada punto: ✅ listo · ⚠️ funciona con limitaciones · ⛔ falta para vender.

| Área | Estado | Detalle |
|---|---|---|
| Seguridad y aislamiento multiempresa | ✅ | RLS en todas las tablas de negocio; rol de la app sin BYPASSRLS (verificado en producción); contexto de jugador separado del de complejo; pruebas de aislamiento automáticas (integración + E2E). |
| Permisos | ✅ | Roles dueño/admin/personal por complejo; jugadores sin acceso a paneles (404); superadmin con 2FA obligatorio. |
| Reservas simultáneas | ✅ | Restricción de exclusión en PostgreSQL (imposible superponer); idempotencia por clave; probado con concurrencia. |
| Reservas falsas | ✅ | Límite por IP y por complejo, campo trampa, máx. 4 reservas online activas por contacto, vencimiento automático de pendientes. Sin CAPTCHA (no se contrató servicio). |
| Recuperación de contraseña | ⛔ | El flujo existe, pero **los emails no se envían** hasta configurar un proveedor (Resend gratuito requiere cuenta y dominio verificado). |
| Verificación de email | ⛔ | No implementada: depende del mismo proveedor de email. Mitigado: nada se vincula por email (solo por enlace privado). |
| Backups | ⚠️ | Ramas de respaldo de Neon antes de cada migración + historial de Neon. El respaldo semanal cifrado (GitHub Actions) está listo pero **inactivo**: falta crear un usuario de solo lectura en Neon y cargar 2 secretos en GitHub. |
| Almacenamiento de imágenes | ⚠️ | En la base (WebP optimizado, ≤2 MB c/u, logo 512 px, portada 1600×600). Suficiente para decenas de complejos; con más volumen conviene mover a R2 (capa gratuita, requiere cuenta). |
| Consumo Neon | ⚠️ | Plan gratuito: 0,5 GB y 100 CU-h/mes. La tarea programada (cada 30 min) despierta la base ~48 veces/día; el resto del consumo depende de visitas. Alerta al 70 % de almacenamiento en Superadmin. |
| Consumo Netlify | ⚠️ | Plan gratuito (heredado) **compartido con tus otros sitios**: revisar Netlify → Usage cuando haya tráfico. |
| Rendimiento móvil | ✅ | Catálogo y novedades en caché (5 min), imágenes WebP con carga diferida, mapas solo a pedido, sin scripts de terceros. |
| PWA | ✅ | Instalable, abre la plataforma de jugadores; atajos; sin caché de datos privados. |
| Planes y suscripciones | ⚠️ | Planes, pruebas, límites y cobro **manual** registrado por el superadmin. Cobro automático: ver docs/MERCADOPAGO.md. |
| Onboarding de complejos | ⚠️ | El superadmin crea el complejo y asigna al dueño; el dueño completa la puesta en marcha guiada (7 pasos). No hay alta autoservicio (decisión de seguridad). |
| Legales | ⛔ | Términos y privacidad son **borradores**: revisión de abogado/a e inscripción de la base ante la AAIP antes de abrir el registro masivo. |
| Mapas | ✅ | OpenStreetMap + Leaflet (gratuito, con atribución, sin precarga), Nominatim a pedido con límite global 1/s. Política de OSM: sin SLA; si el tráfico crece, pasar a un proveedor de teselas (variable NEXT_PUBLIC_MAP_TILE_URL). |

## Costos mensuales actuales

| Servicio | Plan | Costo |
|---|---|---|
| Netlify (hosting + funciones + tarea programada) | Gratuito | US$ 0 |
| Neon (PostgreSQL) | Gratuito | US$ 0 |
| GitHub (repo + Actions para backup semanal) | Gratuito | US$ 0 |
| OpenStreetMap / Nominatim | Gratuito (uso justo) | US$ 0 |
| Email (Resend) | Gratuito al configurarlo (3.000/mes) | US$ 0 |
| Dominio propio | No contratado | — (opcional, ~ARS anual según registrador) |
| **Total hoy** | | **US$ 0/mes** |

Primeros costos esperables al crecer (requieren tu autorización): plan pago de Neon (por uso) cuando
se superen los límites gratuitos, dominio propio y, si hiciera falta, Netlify Pro.

## Capacidad estimada de la infraestructura actual

- **Almacenamiento**: la base de producción ocupa pocos MB; 0,5 GB alcanzan para cientos de miles de
  reservas. El límite real son las fotos (≈100–300 KB cada una): unas 1.000–2.000 fotos.
- **Cómputo**: Neon escala a cero cuando no hay uso. Con decenas de complejos y algunos miles de
  visitas/mes se mantiene dentro de 100 CU-h si el tráfico no es continuo las 24 h; el uso real está en
  la consola de Neon (revisar a mitad de mes).
- **Concurrencia**: la base garantiza cero superposiciones aunque reserven muchos a la vez; el límite
  práctico lo pone el plan gratuito (conexiones y CPU), suficiente para un piloto de 1–10 complejos.

## Qué falta para el primer cliente real

1. **Email** (bloqueante): cuenta de Resend + dominio verificado → recuperación de contraseña,
   confirmaciones y recordatorios. Requiere tu autorización (cuenta gratuita; el dominio es pago).
2. **Legales**: revisión profesional de términos, privacidad y condiciones; inscripción AAIP.
3. **Backup semanal**: crear el usuario de solo lectura en Neon y cargar los 2 secretos en GitHub.
4. **Datos del complejo piloto**: crearlo desde Superadmin, asignar al dueño, completar la puesta en
   marcha (ubicación en el mapa incluida) y definir su plan/prueba.
5. **Cobro**: acordar la forma de pago de la suscripción (manual hoy) y, si se quiere seña online,
   aprobar el proyecto de Mercado Pago.
