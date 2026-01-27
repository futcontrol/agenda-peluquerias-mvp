import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => {
          // En algunas versiones TS no tipa bien cookies(), así que lo forzamos.
          const cs: any = cookieStore as any;
          if (typeof cs.getAll === "function") return cs.getAll();
          return [];
        },
        setAll: () => {
          // NO-OP aquí: la escritura real de cookies la haremos en middleware.ts
        },
      } as any,
    }
  );
}
