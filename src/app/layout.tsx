import { PwaClient } from "@/components/PwaClient";
import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "TURNUP — Reservas de fútbol y pádel", template: "%s · TURNUP" },
  applicationName: "TURNUP",
  description: "TURNUP: reservá canchas de fútbol y pádel online y gestioná tu complejo deportivo.",
  appleWebApp: { capable: true, title: "TURNUP", statusBarStyle: "black-translucent" },
  icons: { icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }, { url: "/icons/icon-192.png", sizes: "192x192" }], apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#05070d" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Render dinámico en todas las páginas: requisito para el nonce de la CSP (src/proxy.ts).
  await connection();
  return (
    <html lang="es-AR">
      <body>
        {children}
        <PwaClient enabled={process.env.NODE_ENV === "production" && process.env.PWA_DISABLED !== "1"} />
      </body>
    </html>
  );
}
