"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import ui from "@/components/ui.module.css";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`}
      onClick={async () => {
        await authClient.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      Salir
    </button>
  );
}
