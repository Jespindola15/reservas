import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import ui from "@/components/ui.module.css";

export default function Home() {
  return (
    <>
      <TopBar>
        <Link href="/login" className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`}>
          Ingresar
        </Link>
      </TopBar>
      <main className={`${ui.container} ${ui.page}`}>
        <section className={ui.stack} style={{ maxWidth: 680, paddingTop: "2rem" }}>
          <h1 style={{ fontSize: "2.2rem" }}>Tu complejo, reservas online sin superposiciones.</h1>
          <p className={ui.muted}>
            Plataforma para complejos de fútbol y pádel: página pública de reservas, panel para el dueño y
            control de turnos con garantía de que una cancha nunca se reserva dos veces.
          </p>
          <p className={ui.muted}>
            ¿Querés reservar? Entrá a la página de tu complejo, por ejemplo <code>/padel-centro</code>.
          </p>
        </section>
      </main>
    </>
  );
}
