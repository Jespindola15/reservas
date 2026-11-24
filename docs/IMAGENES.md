# Imágenes en Cloudflare R2 (Fase 5)

## Qué cambia

- Logos, portadas, galería, fotos de canchas y promociones dejan de guardarse como bytes en PostgreSQL
  (Neon). En la base quedan solo la referencia (`object_key`), tipo, tamaño y dimensiones.
- Cada subida se valida por firma de bytes y se reprocesa con sharp: se corrige la orientación, se borran
  los metadatos (EXIF/GPS), se limita a 1600 px y se convierte a WebP. Hay topes de tamaño y de píxeles.
- Las claves se separan por complejo: `tenants/<id-del-complejo>/brand/...` y `tenants/<id>/courts/<id>/...`.
  Las imágenes se sirven a través de TURNUP (`/api/public/<slug>/assets/...`), que verifica que pertenezcan
  a ese complejo, así que el bucket queda **privado**.
- Al reemplazar o borrar una imagen se borra también el objeto en R2.
- Los jugadores ya no tienen foto de perfil: se muestran sus iniciales. Las fotos viejas se vaciaron por
  migración y la subida directa por API se eliminó (la ruta ya no existe).
- Las credenciales de R2 solo existen como variables del servidor en Netlify. Nunca usan `NEXT_PUBLIC_`.

## Costo

Plan gratuito de R2: 10 GB-mes de almacenamiento, 1 millón de operaciones de escritura y 10 millones de
lecturas por mes, sin costo de salida. Con imágenes WebP de unos 150 KB, 10 GB alcanzan para decenas de
miles de imágenes. Cloudflare puede pedir que registres un medio de pago para activar R2, aunque te quedes
dentro del plan gratuito. **Eso lo decidís vos**: no se activa nada sin tu autorización.

## Pasos en Cloudflare (los hacés vos; no compartas las claves en el chat)

1. Entrá a https://dash.cloudflare.com → **R2 Object Storage** → activá R2 (si te lo pide, registrá el medio de pago).
2. **Create bucket** → nombre `turnup-imagenes` → ubicación *Automatic* → **sin** acceso público (no actives "Public access" ni r2.dev).
3. **R2 → Manage API tokens → Create API token**:
   - Permiso: **Object Read & Write**, solo para el bucket `turnup-imagenes`.
   - Sin vencimiento o con el que prefieras. Copiá *Access Key ID*, *Secret Access Key* y el *endpoint*
     (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`).
4. En **Netlify → Site configuration → Environment variables** creá (alcance *Functions*, no *Builds* si podés elegir):
   - `IMAGE_STORAGE=object`
   - `S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
   - `S3_BUCKET=turnup-imagenes`
   - `S3_REGION=auto`
   - `S3_ACCESS_KEY_ID=…` y `S3_SECRET_ACCESS_KEY=…` (marcalas como secretas)
5. Para el respaldo de imágenes, creá **otro** token con **Object Read only** para el mismo bucket (ver docs/RESPALDOS.md).
6. Redeploy en Netlify. Desde ese momento las imágenes nuevas van a R2. Las viejas siguen saliendo de la base
   hasta migrarlas (paso siguiente).

## Migración de las imágenes existentes (con verificación)

Desde tu computadora, con las mismas variables `S3_*` en el `.env` local (no se suben a GitHub) y la URL de
la base (rol de migración):

```bash
npm run images:migrate                 # simulación: cuenta, mide y no escribe nada
npm run images:migrate -- --execute    # sube, descarga y compara SHA-256; recién entonces marca la fila
# comprobá en la página pública que las imágenes se vean
npm run images:migrate -- --free-db    # vuelve a verificar cada objeto y solo entonces vacía los bytes en la base
```

- `--execute` no borra nada de la base. `--free-db` no vacía una fila si el objeto falta o no coincide.
- Antes de `--free-db`: respaldo verificado (docs/RESPALDOS.md).
- Espacio en Neon: al vaciar los bytes, PostgreSQL marca el espacio como reutilizable después del autovacuum,
  pero no lo devuelve al almacenamiento de Neon. Para devolverlo hace falta `VACUUM FULL tenant_assets, court_images;`
  (bloquea esas dos tablas unos segundos; hacelo en un horario de poco uso). El script informa el tamaño de
  las tablas antes y después.

## Corrección encontrada en esta fase

La regla de validación de `court_images` usaba la expresión `{10,300}`, y PostgreSQL acepta como máximo 255
repeticiones: cualquier foto de cancha guardada en R2 habría fallado con "invalid repetition count". Producción
no lo sufrió porque todavía guarda las imágenes en la base. La migración `20261205000200` la reemplaza por una
validación equivalente (`char_length` entre 10 y 300). Lo detectó la prueba `tests/integration/images-5.test.ts`.
