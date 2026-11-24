# Procedimiento de rollback — TURNUP

Antes de cada migración, `scripts/ops/neon-safe-migrate.mjs` crea una rama de respaldo en Neon
(`backup-antes-de-migrar-AAAAMMDDhhmm`) y las migraciones son **aditivas** (no borran columnas ni datos).
Por eso el orden de reversión es: primero el código, y solo si hace falta, la base.

## 1. Volver a la versión anterior del sitio (minutos, sin tocar datos)

1. Netlify → sitio `turn-up-sn` → **Deploys** → elegir el deploy anterior que funcionaba → **Publish deploy**.
2. Verificar `https://turn-up-sn.netlify.app/api/health` → `{"status":"ok"}`.
3. En Git, revertir el commit problemático (`git revert <commit>` + push) para que el próximo deploy no lo reponga.

Como las migraciones son aditivas, la versión anterior del código funciona con la base nueva.

## 2. Volver la base al estado previo (solo si los datos quedaron dañados)

> Esto descarta lo ocurrido en producción desde el respaldo (reservas nuevas incluidas). Usarlo solo si es
> necesario y avisando a los complejos.

1. Neon → proyecto `turnup` → **Branches** → `production` → **Restore** → desde la rama
   `backup-antes-de-migrar-…` (Neon guarda una copia del estado actual antes de restaurar).
   Por API: `POST /projects/{id}/branches/{production}/restore` con `source_branch_id` = rama de respaldo.
2. Volver el código a la versión compatible con ese esquema (paso 1).
3. Verificar salud, inicio de sesión y una reserva de prueba en un complejo de prueba.

## 3. Respaldos disponibles

- Ramas de respaldo de Neon creadas antes de cada migración (borrar las viejas cuando ya no hagan falta:
  cada rama ocupa espacio del plan gratuito solo por los cambios posteriores).
- Respaldo semanal cifrado en GitHub Actions (`.github/workflows/backup.yml`) cuando estén cargados los secretos.
- Historial de Neon (restauración a un punto en el tiempo dentro de la ventana del plan).
