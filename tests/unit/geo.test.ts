import { describe, expect, it } from "vitest";
import { directionsUrl, distanceKm, formatDistance } from "@/lib/geo";

describe("ubicación", () => {
  it("distancia por haversine y formato", () => {
    // Obelisco (CABA) → Monumento a la Bandera (Rosario): ~278 km en línea recta.
    const d = distanceKm({ lat: -34.6037, lng: -58.3816 }, { lat: -32.9477, lng: -60.6304 });
    expect(d).toBeGreaterThan(270);
    expect(d).toBeLessThan(290);
    expect(distanceKm({ lat: 1, lng: 1 }, { lat: 1, lng: 1 })).toBe(0);
    expect(formatDistance(0.35)).toBe("350 m");
    expect(formatDistance(2.345)).toBe("2,3 km");
    expect(formatDistance(42.6)).toBe("43 km");
  });
  it("cómo llegar: coordenadas exactas o búsqueda por dirección", () => {
    expect(directionsUrl({ latitude: -32.9, longitude: -60.6, address: "X" })).toBe("https://www.google.com/maps/dir/?api=1&destination=-32.9,-60.6");
    expect(directionsUrl({ latitude: null, longitude: null, address: "Calle 1", city: "Rosario", province: "Santa Fe" })).toContain("query=Calle%201%2C%20Rosario%2C%20Santa%20Fe");
    expect(directionsUrl({ latitude: null, longitude: null, address: null })).toBeNull();
  });
});
