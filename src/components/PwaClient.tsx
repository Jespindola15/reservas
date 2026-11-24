"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./pwa.module.css";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const DISMISS_KEY = "turnup.install.dismissed";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Registra el service worker, avisa cuando hay una versión nueva y ofrece instalar la app.
 * Solo se activa en producción (en desarrollo el SW interferiría con la recarga en caliente).
 */
export function PwaClient({ enabled }: { enabled: boolean }) {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [installEvt, setInstallEvt] = useState<InstallEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const updateRequested = useRef(false);

  useEffect(() => {
    if (!enabled || !("serviceWorker" in navigator)) return;
    // Solo se recarga cuando la persona eligió "Actualizar". La primera instalación del
    // service worker (clients.claim) también cambia el controlador y NO debe recargar la página:
    // perdería lo que esté escribiendo.
    const onControllerChange = () => {
      if (!updateRequested.current) return;
      updateRequested.current = false;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        const hadController = Boolean(navigator.serviceWorker.controller);
        if (reg.waiting && hadController) setWaiting(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const sw = reg.installing;
          sw?.addEventListener("statechange", () => {
            if (sw.state === "installed" && navigator.serviceWorker.controller) setWaiting(sw);
          });
        });
        // Busca actualizaciones al volver a la app.
        const check = () => document.visibilityState === "visible" && reg.update().catch(() => {});
        document.addEventListener("visibilitychange", check);
      })
      .catch(() => {});
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || readDismissed()) return;
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    if (standalone) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const ua = navigator.userAgent;
    const timer = window.setTimeout(() => {
      if (/iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua)) setIosHint(true);
    }, 0);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.clearTimeout(timer);
    };
  }, [enabled]);

  const dismiss = () => {
    setInstallEvt(null);
    setIosHint(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
  };

  if (waiting) {
    return (
      <div className={styles.bar} role="status">
        <span>Hay una versión nueva de TURNUP.</span>
        <button type="button" className={styles.primary} onClick={() => {
            updateRequested.current = true;
            waiting.postMessage({ type: "SKIP_WAITING" });
          }}>Actualizar</button>
      </div>
    );
  }
  if (installEvt) {
    return (
      <div className={styles.bar} role="region" aria-label="Instalar aplicación">
        <span>Instalá TURNUP para abrirlo como una app.</span>
        <button
          type="button"
          className={styles.primary}
          onClick={async () => {
            await installEvt.prompt();
            await installEvt.userChoice.catch(() => null);
            setInstallEvt(null);
          }}
        >
          Instalar
        </button>
        <button type="button" className={styles.ghost} onClick={dismiss} aria-label="No mostrar más">✕</button>
      </div>
    );
  }
  if (iosHint) {
    return (
      <div className={styles.bar} role="region" aria-label="Instalar aplicación">
        <span>Para instalar TURNUP: tocá <strong>Compartir</strong> y después <strong>Agregar a inicio</strong>.</span>
        <button type="button" className={styles.ghost} onClick={dismiss} aria-label="Cerrar">✕</button>
      </div>
    );
  }
  return null;
}
