import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { withPlayer, withTenant } from "@/lib/db/tenant-context";
import { bookingAccessToken, claimBookingByLink } from "@/modules/booking/public-access";
import { changeBookingStatus, createBooking } from "@/modules/booking/service";
import { availabilityForDate, filterCatalog, loadCatalog } from "@/modules/marketplace/catalog";
import { getPlayerProfile, registerPlayer, updatePlayerProfile } from "@/modules/player/account";
import { cancelPlayerBooking, listPlayerBookings } from "@/modules/player/bookings";
import { listFavoriteTenantIds, toggleFavorite } from "@/modules/player/favorites";
import { createReview, listOpenReports, listPublicReviews, moderateReview, replyToReview, reportReviewAsComplex, reportReviewAsPlayer } from "@/modules/player/reviews";
import { listMyTenants } from "@/modules/access/authorize";
import { DAY, NOW, at, makeTenant, makeUser, onlineInput, owner, publicActor, resetDb } from "../support/fixtures";

const opts = { now: NOW };
beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); await owner.$disconnect(); });

const reg = (email: string, ip = "10.0.0.1") => registerPlayer({ name: "Jugadora Uno", email, password: "una-clave-de-jugador-1", acceptTerms: true, phone: "11 5555 0001", city: "Rosario" }, ip);

describe("cuenta de jugador", () => {
  it("se registra sin obtener acceso a ningún complejo; email repetido y campo trampa se rechazan", async () => {
    await makeTenant("pj4");
    const { userId } = await reg("uno@pj4.test");
    const u = await owner.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.platformRole).toBe("USER");
    expect(await owner.membership.count({ where: { userId } })).toBe(0);
    expect(await listMyTenants(userId)).toEqual([]);
    await expect(reg("UNO@pj4.test")).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
    await expect(registerPlayer({ name: "Bot", email: "bot@pj4.test", password: "una-clave-de-jugador-1", acceptTerms: true, website: "spam" }, "10.0.0.2")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(registerPlayer({ name: "Sin acuerdo", email: "x@pj4.test", password: "una-clave-de-jugador-1", acceptTerms: false as unknown as true }, "10.0.0.3")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await getPlayerProfile(userId)).toMatchObject({ phone: "11 5555 0001", city: "Rosario" });
    await updatePlayerProfile(userId, { name: "Jugadora Uno", city: "Funes", favoriteSports: ["PADEL"], notifyEmail: false, notifyReminders: true });
    expect(await getPlayerProfile(userId)).toMatchObject({ city: "Funes", favoriteSports: ["PADEL"], notifyEmail: false });
  });

  it("límite de registros por IP", async () => {
    for (let i = 0; i < 5; i++) await reg(`r${i}@pj4.test`, "10.9.9.9");
    await expect(reg("r6@pj4.test", "10.9.9.9")).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("aislamiento: un jugador no ve perfil, favoritos ni reservas de otro; el contexto de complejo no ve datos de jugador", async () => {
    const f = await makeTenant("iso4");
    const a = await reg("a@iso4.test");
    const b = await reg("b@iso4.test", "10.0.0.5");
    await toggleFavorite(a.userId, f.tenant.slug);
    const { booking } = await createBooking(f.ctx, { ...onlineInput(f.court.id, at(DAY, "20:00")), playerUserId: a.userId, origin: "MARKETPLACE" }, publicActor, opts);
    expect(await withPlayer(b.userId, (tx) => tx.playerProfile.findMany())).toHaveLength(1); // solo el propio
    expect(await withPlayer(b.userId, (tx) => tx.playerFavorite.count())).toBe(0);
    expect(await listFavoriteTenantIds(a.userId)).toEqual([f.tenant.id]);
    expect(await listFavoriteTenantIds(b.userId)).toEqual([]);
    expect(await listPlayerBookings(b.userId, NOW)).toEqual([]);
    expect((await listPlayerBookings(a.userId, NOW)).map((x) => x.id)).toEqual([booking.id]);
    // Personal del complejo: no ve perfiles ni favoritos de jugadores.
    expect(await withTenant(f.ctx, (tx) => tx.playerProfile.count())).toBe(0);
    expect(await withTenant(f.ctx, (tx) => tx.playerFavorite.count())).toBe(0);
    // Sin contexto de jugador, la función no devuelve nada.
    expect(await withTenant(f.ctx, (tx) => tx.$queryRaw<unknown[]>`SELECT * FROM app_player_bookings(10)`)).toEqual([]);
    // Un jugador no puede escribir el perfil de otro (RLS WITH CHECK).
    await expect(withPlayer(b.userId, (tx) => tx.playerProfile.update({ where: { userId: a.userId }, data: { city: "X" } }))).rejects.toThrow();
    expect(await owner.booking.findUniqueOrThrow({ where: { id: booking.id }, select: { origin: true } })).toEqual({ origin: "MARKETPLACE" });
  });

  it("vincula una reserva de invitado SOLO con el enlace privado y cancela desde Mis turnos dentro del plazo", async () => {
    const f = await makeTenant("cl4");
    const a = await reg("a@cl4.test");
    const b = await reg("b@cl4.test", "10.0.0.6");
    const { booking } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    await expect(claimBookingByLink(a.userId, f.tenant.slug, booking.code, "x".repeat(43))).rejects.toMatchObject({ code: "INVALID_LINK" });
    await claimBookingByLink(a.userId, f.tenant.slug, booking.code, bookingAccessToken(booking.id));
    await claimBookingByLink(a.userId, f.tenant.slug, booking.code, bookingAccessToken(booking.id)); // idempotente
    await expect(claimBookingByLink(b.userId, f.tenant.slug, booking.code, bookingAccessToken(booking.id))).rejects.toMatchObject({ code: "BOOKING_OWNED" });
    await expect(cancelPlayerBooking(b.userId, booking.id, NOW)).rejects.toMatchObject({ code: "BOOKING_NOT_FOUND" });
    const mine = await listPlayerBookings(a.userId, NOW);
    expect(mine[0]).toMatchObject({ code: booking.code, canCancel: true, tenantSlug: f.tenant.slug });
    await cancelPlayerBooking(a.userId, booking.id, NOW);
    expect((await listPlayerBookings(a.userId, NOW))[0]!.status).toBe("CANCELLED");
    await expect(cancelPlayerBooking(a.userId, booking.id, NOW)).rejects.toMatchObject({ code: "BOOKING_CLOSED" });
  });
});

describe("opiniones verificadas", () => {
  it("solo de turnos jugados, una por reserva; el complejo responde y denuncia; la moderación oculta", async () => {
    const f = await makeTenant("op4");
    const a = await reg("a@op4.test");
    const staff = await makeUser("staff@op4.test", { tenantId: f.tenant.id, role: "OWNER" });
    const sa = await makeUser("sa@op4.test", { platformRole: "SUPERADMIN" });
    const { booking } = await createBooking(f.ctx, { ...onlineInput(f.court.id, at(DAY, "20:00")), playerUserId: a.userId }, publicActor, opts);
    // Antes de jugar: no se puede opinar.
    await expect(createReview(a.userId, { bookingId: booking.id, rating: 5 }, NOW)).rejects.toMatchObject({ code: "REVIEW_NOT_ALLOWED" });
    const after = new Date(at(DAY, "23:00").getTime() + 3_600_000);
    await createReview(a.userId, { bookingId: booking.id, rating: 4, comment: "Buen césped" }, after);
    await expect(createReview(a.userId, { bookingId: booking.id, rating: 1 }, after)).rejects.toMatchObject({ code: "REVIEW_NOT_ALLOWED" });
    // Otro jugador no puede opinar sobre una reserva ajena.
    const b = await reg("b@op4.test", "10.0.0.7");
    await expect(createReview(b.userId, { bookingId: booking.id, rating: 1 }, after)).rejects.toMatchObject({ code: "BOOKING_NOT_FOUND" });
    // Cancelada: no elegible.
    const { booking: c2 } = await createBooking(f.ctx, { ...onlineInput(f.court.id, at(DAY, "18:00"), 90, 2), playerUserId: a.userId }, publicActor, opts);
    await changeBookingStatus(f.ctx, { bookingId: c2.id, to: "CANCELLED", expectedVersion: c2.version, reason: "x" }, { type: "USER", userId: staff.id }, opts);
    await expect(createReview(a.userId, { bookingId: c2.id, rating: 5 }, after)).rejects.toMatchObject({ code: "REVIEW_NOT_ALLOWED" });

    let pub = await listPublicReviews(f.tenant.slug);
    expect(pub).toHaveLength(1);
    expect(pub[0]).toMatchObject({ rating: 4, comment: "Buen césped", author: "Jugador 1." });
    expect(JSON.stringify(pub)).not.toContain("@");
    await replyToReview(f.ctx, pub[0]!.id, "¡Gracias por venir!", { type: "USER", userId: staff.id });
    await reportReviewAsComplex(f.ctx, pub[0]!.id, "Comentario de prueba", { type: "USER", userId: staff.id });
    await reportReviewAsPlayer(b.userId, f.tenant.slug, pub[0]!.id, "Contenido ofensivo");
    // Otro complejo no puede responder ni denunciar.
    const g = await makeTenant("op4b");
    await expect(replyToReview(g.ctx, pub[0]!.id, "hack", { type: "USER", userId: staff.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const reports = await listOpenReports(sa);
    expect(reports).toHaveLength(2);
    await moderateReview(sa, pub[0]!.id, "HIDE", "prueba");
    expect(await listPublicReviews(f.tenant.slug)).toEqual([]);
    expect(await listOpenReports(sa)).toEqual([]);
    await moderateReview(sa, pub[0]!.id, "RESTORE", "");
    pub = await listPublicReviews(f.tenant.slug);
    expect(pub[0]!.reply).toBe("¡Gracias por venir!");
    const normal = await makeUser("n@op4.test", { tenantId: f.tenant.id, role: "OWNER" });
    await expect(moderateReview(normal, pub[0]!.id, "HIDE", "")).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Catálogo con la valoración real.
    const cat = await loadCatalog();
    expect(cat.find((c) => c.slug === f.tenant.slug)).toMatchObject({ ratingAvg: 4, ratingCount: 1 });
  });
});

describe("catálogo público", () => {
  it("solo publicados y activos; filtros por texto, ciudad, deporte, precio, servicio y disponibilidad", async () => {
    const a = await makeTenant("cat4a");
    const b = await makeTenant("cat4b");
    const c = await makeTenant("cat4c");
    await owner.tenant.update({ where: { id: a.tenant.id }, data: { city: "Córdoba", services: ["Duchas"], name: "Pádel Córdoba" } });
    await owner.tenant.update({ where: { id: b.tenant.id }, data: { city: "Rosario", publicListed: false } });
    await owner.tenant.update({ where: { id: c.tenant.id }, data: { status: "SUSPENDED" } });
    await owner.court.updateMany({ where: { tenantId: a.tenant.id }, data: { covered: true } });
    const all = await loadCatalog();
    expect(all.map((x) => x.slug)).toEqual([a.tenant.slug]);
    expect(all[0]).toMatchObject({ city: "Córdoba", hasCovered: true, sports: ["PADEL"], minHourPrice: 60000 });
    expect(Object.keys(all[0]!)).not.toContain("contactPhone");
    expect(filterCatalog(all, { q: "padel cordoba" })).toHaveLength(1);
    expect(filterCatalog(all, { ciudad: "rosario" })).toHaveLength(0);
    expect(filterCatalog(all, { deporte: "futbol" })).toHaveLength(0);
    expect(filterCatalog(all, { deporte: "padel", servicio: ["Duchas"], techada: "1", precioMax: 600 })).toHaveLength(1);
    expect(filterCatalog(all, { precioMax: 500 })).toHaveLength(0);
    const avail = await availabilityForDate(all, DAY, 24, NOW);
    expect(avail.get(a.tenant.id)).toBeGreaterThan(0);
  });
});
