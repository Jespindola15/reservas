# Imágenes en Supabase Storage

TURNUP usa **Supabase solo para guardar imágenes de los complejos**. La base sigue en Neon, el sitio en
Netlify y el inicio de sesión en Better Auth. Supabase no ve usuarios, reservas ni pagos.

## Qué se guarda y cómo

- **Solo imágenes comerciales:** logo, portada, galería y fotos de canchas. Los jugadores no suben fotos.
- **Validación y procesamiento en el servidor**, antes de subir:
  - Tipo real por contenido (no por la extensión) y tope de 4 MB por archivo.
  - Orientación corregida, metadatos y GPS eliminados.
  - Conversión a **WebP de ~100–200 KB**. Si no alcanza bajando la calidad, se achica la imagen, sin pasar de calidad 55 ni de 960 px.
- **Cupo por complejo:** 60 imágenes y 25 MB en total, más los topes de cada tipo (8 de galería, 6 por cancha).
- **Aislamiento:**
  - Cada complejo tiene su carpeta (`tenants/<id-del-complejo>/...`).
  - Subir y borrar pasa siempre por TURNUP, con el permiso del panel y el complejo del usuario.
  - La clave de acceso nunca llega al navegador.
- **Lectura pública:**
  - El bucket `turnup-images` es público **solo para leer**, porque son fotos del catálogo.
  - El navegador las baja del CDN de Supabase: no consume funciones de Netlify ni la base.
  - Las URL llevan un id nuevo en cada subida y se guardan con **caché de un año**, con carga diferida (`loading="lazy"`).
  - Cada visitante descarga cada imagen una sola vez.
- **En Neon** solo queda la referencia: clave, tipo, tamaño y dimensiones. Nunca bytes ni Base64.
- **En producción no hay respaldo silencioso:**
  - Si Supabase no está configurado o falla, la subida se rechaza con un mensaje claro.
  - La imagen anterior no se borra.
- **Cambiar de proveedor** (R2, AWS S3, Backblaze, MinIO) es cambiar variables de entorno: el código habla el protocolo S3 estándar.

## Plan gratuito de Supabase (sin tarjeta)

| Límite | Valor |
|---|---|
| Almacenamiento de archivos | 1 GB (unas 6.000 imágenes de ~170 KB) |
| Transferencia | 5 GB/mes, más 5 GB/mes servidos desde caché |
| Tamaño máximo por archivo | 50 MB (TURNUP usa como máximo 2 MB) |
| Pausa por inactividad | El proyecto se pausa tras **1 semana sin actividad** |

**Pausa:**
- Mientras está pausado, las imágenes no se ven; el resto de TURNUP funciona igual.
- El workflow `storage-keepalive.yml` hace una consulta mínima cada 3 días para evitarla. Es una mitigación, no una garantía de Supabase.
- Si igual se pausa:
  - *Superadmin → Sistema y alertas* lo indica.
  - Se reactiva desde el panel de Supabase con **Restore project**. Los archivos no se pierden.

**Alertas de consumo:**
- *Superadmin → Sistema y alertas* muestra los MB usados contra el cupo (`IMAGE_STORAGE_QUOTA_MB`, 1024 por defecto).
- Avisa al 70 % y al 90 %.
- La transferencia real la mide Supabase (Proyecto → *Usage*). Al acercarse al límite, Supabase avisa por email al dueño de la cuenta.

## Pasos que hacés vos (no pegues claves en el chat)

1. **Cuenta:**
   - Entrá a https://supabase.com y hacé clic en **Start your project**.
   - Registrate con GitHub o con email. No pide tarjeta para el plan gratuito.
2. **Proyecto:**
   - **New project**.
   - Organización: la personal, con plan **Free**.
   - Nombre: `turnup-imagenes`.
   - Contraseña de base: generala y guardala. No la vamos a usar, porque la base sigue en Neon.
   - Región: **South America (São Paulo)**.
   - **Create new project**, y esperá a que termine de crearse.
3. **Bucket:**
   - Menú izquierdo → **Storage** → **New bucket**.
   - Nombre: `turnup-images`.
   - Activá **Public bucket**: permite solo leer; subir y borrar sigue requiriendo la clave secreta.
   - En *Additional configuration*:
     - **Restrict file size**: `2 MB`.
     - **Allowed MIME types**: `image/webp`.
   - **Save**.
4. **Acceso S3:**
   - **Storage** → **S3 Configuration** (o *Settings → Storage*).
   - Verificá que **S3 protocol connection** esté **activado**.
   - Copiá el **Endpoint** (`https://<ref>.storage.supabase.co/storage/v1/s3`) y la **Region** (por ejemplo `sa-east-1`).
5. **Claves para TURNUP:**
   - En esa misma página → **New access key**.
   - Descripción: `turnup-netlify`.
   - Copiá el **Access key ID** y el **Secret access key**. El secreto se muestra una sola vez.
   - Estas claves dan acceso total al almacenamiento: van solo a Netlify.
6. **Claves para el respaldo:** creá otra con **New access key**, descripción `turnup-github-respaldo`. Van solo a GitHub (docs/RESPALDOS.md).
7. **URL pública:**
   - Es `https://<ref>.supabase.co/storage/v1/object/public/turnup-images`.
   - `<ref>` es el identificador del proyecto: está en la URL del panel (`supabase.com/dashboard/project/<ref>`) y en el endpoint del paso 4.
8. **Netlify:**
   - Tu sitio → **Site configuration** → **Environment variables** → **Add a variable** → *Add a single variable*.
   - Cargá cada una con alcance **Functions** y marcá **Contains secret values** en las dos claves:

| Variable | Valor | Dónde sale |
|---|---|---|
| `IMAGE_STORAGE` | `object` | fijo |
| `S3_ENDPOINT` | `https://<ref>.storage.supabase.co/storage/v1/s3` | paso 4 |
| `S3_REGION` | p. ej. `sa-east-1` | paso 4 |
| `S3_BUCKET` | `turnup-images` | paso 3 |
| `S3_ACCESS_KEY_ID` | Access key ID de `turnup-netlify` | paso 5 |
| `S3_SECRET_ACCESS_KEY` | Secret access key de `turnup-netlify` | paso 5 |
| `IMAGE_PUBLIC_BASE_URL` | `https://<ref>.supabase.co/storage/v1/object/public/turnup-images` | paso 7 |
| `IMAGE_STORAGE_QUOTA_MB` | `1024` | cupo del plan gratuito |

Ninguna lleva prefijo `NEXT_PUBLIC_`. Si quedó de antes alguna variable de Cloudflare R2, borrala.

9. Avisame cuando esté. Sin ver las claves, verifico:
   - Una subida de prueba en un complejo de prueba.
   - Que la fila quede con `storage=OBJECT`.
   - Que la imagen se vea desde el CDN.
   - El reemplazo y el borrado del objeto anterior.
   - El aislamiento entre complejos.
   - *Superadmin → Sistema*.

## Migración de imágenes existentes (cuando haya)

Hoy producción tiene 0 imágenes guardadas en la base. Si algún complejo sube imágenes antes de activar
Supabase:

```bash
npm run images:migrate                 # simulación
npm run images:migrate -- --execute    # sube, descarga y compara SHA-256; recién entonces marca la fila
npm run images:migrate -- --free-db    # SOLO con tu autorización: re-verifica y vacía los bytes en Neon
```

## Respaldo

El respaldo semanal de GitHub descarga el bucket con las claves `turnup-github-respaldo`, lo cifra y lo
guarda con el de la base (docs/RESPALDOS.md).
