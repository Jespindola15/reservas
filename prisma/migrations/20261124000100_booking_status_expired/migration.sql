-- Fase 2 · Bloque C (1/2). Va sola: un valor nuevo de enum debe quedar
-- confirmado antes de que funciones SQL lo referencien.
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
