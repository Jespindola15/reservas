import type { MetadataRoute } from "next";

/**
 * Manifest de la PWA. La app instalada abre la plataforma de jugadores (inicio); el equipo de un
 * complejo llega a su panel con el atajo "Panel del complejo" o desde Perfil.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "TURNUP — Reservas de fútbol y pádel",
    short_name: "TURNUP",
    description: "Gestioná las reservas de tu complejo y reservá canchas de fútbol y pádel.",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#05070d",
    theme_color: "#05070d",
    lang: "es-AR",
    dir: "ltr",
    categories: ["sports", "business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      { name: "Reservar cancha", url: "/explorar", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Mis turnos", url: "/mis-turnos", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Calendario del complejo", url: "/panel?ir=calendario", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
