"use client";
import { createAuthClient } from "better-auth/react";

/** Cliente de autenticación del navegador (mismo origen: /api/auth). */
export const authClient = createAuthClient();
