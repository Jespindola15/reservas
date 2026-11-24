import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import ui from "@/components/ui.module.css";
import styles from "../home.module.css";

const FEATURES = [
  { t: "Cero turnos duplicados", d: "La base de datos garantiza que una cancha nunca se reserve dos veces, aunque 100 personas reserven al mismo tiempo." },
  { t: "Tu página de reservas", d: "Cada complejo tiene su página: deporte, cancha, fecha, horario y precio real antes de confirmar." },
  { t: "Calendario del día", d: "Columnas por cancha, estados con color, bloqueos y carga manual en un toque, desde la compu o el celular." },
  { t: "Solicitudes que vencen solas", d: "Si no aprobás una solicitud a tiempo, el turno se libera automáticamente." },
];

export const metadata = { title: "TURNUP para complejos — Gestión de reservas" };

export default function ForComplexes() {
  return (
    <>
      <TopBar>
        <Link href="/login" className={`${ui.button} ${ui.buttonSmall}`}>Ingresar</Link>
      </TopBar>
      <main>
        <section className={styles.hero}>
          <div className={ui.container}>
            <p className={ui.eyebrow}>Fútbol 5 · 7 · 11 · Pádel</p>
            <h1 className={styles.title}>
              Llená tus canchas.<br />
              <span>Sin planillas, sin superposiciones.</span>
            </h1>
            <p className={styles.lead}>
              TURNUP es la plataforma para complejos deportivos: reservas online, calendario, precios por franja y
              clientes, en un solo lugar.
            </p>
            <div className={ui.row}>
              <Link href="/login" className={ui.button}>Ingresar al panel</Link>
              <Link href="/explorar" className={`${ui.button} ${ui.buttonSecondary}`}>Ver complejos para reservar</Link>
            </div>
          </div>
        </section>
        <section className={`${ui.container} ${styles.features}`}>
          {FEATURES.map((f) => (
            <article key={f.t} className={ui.card}>
              <h2>{f.t}</h2>
              <p className={ui.muted}>{f.d}</p>
            </article>
          ))}
        </section>
      </main>
    </>
  );
}
