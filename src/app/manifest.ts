import type { MetadataRoute } from "next";

/** Manifest de la PWA. La app instalada abre el panel; los jugadores siguen usando el link del complejo. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/panel",
    name: "TURNUP — Reservas de fútbol y pádel",
    short_name: "TURNUP",
    description: "Gestioná las reservas de tu complejo y reservá canchas de fútbol y pádel.",
    start_url: "/panel?source=pwa",
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
      { name: "Calendario", url: "/panel?ir=calendario", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Reservas", url: "/panel?ir=reservas", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
