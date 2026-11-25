"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import ui from "@/components/ui.module.css";

export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const out = async () => {
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  };
  return compact ? (
    <button type="button" className={ui.iconButton} onClick={out} aria-label="Cerrar sesión" title="Cerrar sesión">
      <LogOut size={18} strokeWidth={1.75} aria-hidden />
    </button>
  ) : (
    <button type="button" className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`} onClick={out}>
      Salir
    </button>
  );
}
