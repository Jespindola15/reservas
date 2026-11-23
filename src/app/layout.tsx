import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "TURNUP — Reservas de fútbol y pádel", template: "%s · TURNUP" },
  applicationName: "TURNUP",
  description: "TURNUP: reservá canchas de fútbol y pádel online y gestioná tu complejo deportivo.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#05070d" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}
