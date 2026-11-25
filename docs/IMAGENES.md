# Imágenes en Cloudflare R2

## Estado (25/11/2026)

| Tema | Estado |
|---|---|
| Código para guardar imágenes en R2 (subida, lectura, reemplazo, borrado) | **Implementado y probado** con un almacenamiento en memoria |
| Producción sin R2 configurado | Con el código de la Fase 5, la subida de imágenes **falla con un mensaje claro**. Ya no hay respaldo silencioso a PostgreSQL. |
| Migración de imágenes existentes | Script listo (`npm run images:migrate`). En producción hoy hay **0 imágenes** guardadas: medido el 25/11 a las 01:40 UTC. |
| Fotos de jugadores | Eliminadas; nunca se suben a R2 |
| Cuenta de Cloudflare, bucket y token | **Falta**: los creás vos con los pasos de abajo |
| Prueba contra el R2 real | **Pendiente** hasta que exista el bucket. No se puede dar por terminada antes. |

> **Orden obligatorio:** configurá R2 en Netlify **antes** de publicar la Fase 5. Si no, los complejos no van
> a poder subir logos ni fotos: verían un error en lugar de que se guarden en la base.

## Qué hace el código

- Cada imagen se valida por su contenido real (no por la extensión).
- Se reprocesa:
  - Orientación corregida.
  - Metadatos y GPS eliminados.
  - Máximo 1600 px y límite de píxeles.
  - Conversión a WebP.
- Se guarda **primero en R2** y recién después se crea la fila en PostgreSQL, con la clave, el tipo, el tamaño y las dimensiones.
- Si R2 falla, no queda ninguna fila a medias y el usuario ve un error.
- Las claves se separan por complejo: `tenants/<id-del-complejo>/...`.
- El bucket es **privado**. Las imágenes se sirven a través de TURNUP, que comprueba que pertenezcan al complejo de la URL. Con eso, un complejo no puede pedir imágenes de otro.
- Reemplazar una imagen borra la fila vieja y el objeto viejo.
- Si borrar el objeto falla, queda un archivo huérfano en R2 (ocupa espacio), pero nunca se pierde una imagen en uso.
- Las páginas cargan las imágenes con carga diferida y tamaño reservado (sin saltos).
- Credenciales: solo como variables del servidor en Netlify. Nunca con prefijo `NEXT_PUBLIC_`, nunca en el repo.

## ¿Cloudflare pide un medio de pago? ¿Cuánto es gratis?

- Plan gratuito permanente, por mes:
  - **10 GB-mes** de almacenamiento.
  - **1 millón** de operaciones de escritura (clase A).
  - **10 millones** de lecturas (clase B).
  - Salida a Internet sin cargo.
- Por encima de eso se cobra el uso (USD 0,015 por GB-mes, USD 4,50 por millón de escrituras, USD 0,36 por millón de lecturas).
- Estimación: con WebP de ~150 KB, 10 GB son unas 60.000 imágenes. Un catálogo con decenas de complejos queda muy por debajo del límite.
- **Medio de pago:** Cloudflare suele pedir que registres una tarjeta (o PayPal) la primera vez que activás R2, aunque te quedes en el plan gratuito.
  Es una verificación, no un cobro. Si te lo pide, la decisión de cargarla es tuya: yo no lo hago.
- Recomendación: después de activarlo, en *Manage Account → Billing → Notifications* configurá un aviso de facturación por si algún día hubiera un cargo.

## Pasos que hacés vos (no pegues claves en el chat)

1. **Cuenta:** entrá a https://dash.cloudflare.com/sign-up. Si ya tenés cuenta, iniciá sesión. Verificá el email.
2. **Activar R2:** menú izquierdo → **R2 Object Storage** → *Overview*. Si pide medio de pago, ver arriba.
3. **Bucket:** **Create bucket**.
   - Nombre: `turnup-imagenes`.
   - Ubicación: *Automatic*.
   - Clase: *Standard* (el plan gratuito no cubre *Infrequent Access*).
   - Dejá el **acceso público desactivado**: no actives *Public Development URL* (r2.dev) ni dominio propio.
4. **Token de la aplicación:** R2 → *Overview* → **Manage API tokens** → **Create Account API token**. (Si no aparece "Account", usá **User API token**.)
   - Nombre: `turnup-app`.
   - Permisos: **Object Read & Write**.
   - Alcance: **Apply to specific buckets only** → `turnup-imagenes`.
   - TTL: sin vencimiento (o el que prefieras; anotá cuándo renovarlo).
   - Al crear, copiá **Access Key ID**, **Secret Access Key** y el **endpoint S3** (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`). La clave secreta se muestra una sola vez.
5. **Token de respaldo** (solo lectura): repetí el paso 4 con nombre `turnup-respaldo` y permiso **Object Read only** sobre el mismo bucket. Va a GitHub (docs/RESPALDOS.md), **no** a Netlify.
6. **Netlify** → tu sitio → *Site configuration → Environment variables → Add a variable*. Marcá *Contains secret values* en las claves y el alcance *Functions* si lo permite:

| Variable | Valor |
|---|---|
| `IMAGE_STORAGE` | `object` |
| `S3_ENDPOINT` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `S3_BUCKET` | `turnup-imagenes` |
| `S3_REGION` | `auto` |
| `S3_ACCESS_KEY_ID` | Access Key ID del token `turnup-app` |
| `S3_SECRET_ACCESS_KEY` | Secret Access Key del token `turnup-app` |

No definas `ALLOW_DB_IMAGES` en Netlify: solo existe para desarrollo.

7. Avisame cuando esté. Yo verifico, sin ver las claves:
   - Una subida de prueba en un complejo de prueba.
   - Que la fila tenga `storage=OBJECT`.
   - Que la imagen se vea.
   - El reemplazo y el borrado del objeto anterior.
   - El aislamiento: la imagen de un complejo no se sirve con la URL de otro.

## Migración de imágenes existentes (cuando haya)

```bash
npm run images:migrate                 # simulación: cuenta y mide; no escribe nada
npm run images:migrate -- --execute    # sube, vuelve a descargar y compara SHA-256; recién entonces marca la fila
npm run images:migrate -- --free-db    # SOLO con tu autorización: re-verifica cada objeto y vacía los bytes en la base
```

- `--execute` no borra nada de PostgreSQL.
- `--free-db` no vacía una fila si el objeto falta o no coincide; antes, respaldo verificado.
- El script mide el tamaño de las tablas antes y después. El espacio vuelve al almacenamiento de Neon con
  `VACUUM FULL tenant_assets, court_images;`, que bloquea esas dos tablas unos segundos.
- Hoy la base de producción ocupa ~10 MB y no tiene imágenes: no hay nada que migrar todavía.

## Recuperación

Las imágenes de R2 entran en el respaldo semanal cifrado (docs/RESPALDOS.md), con el token de solo lectura.

## Corrección de la Fase 5

La regla de `court_images` usaba `{10,300}` y PostgreSQL admite como máximo 255 repeticiones. Habría hecho
fallar toda foto de cancha en R2. Se corrigió en la migración `20261205000200`.
