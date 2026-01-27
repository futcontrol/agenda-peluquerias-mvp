import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);

  if (!body) {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const { setupKey, email, password } = body as {
    setupKey?: string;
    email?: string;
    password?: string;
  };

  const cleanSetupKey = (setupKey || "").trim();
  const envSetupKey = (process.env.SETUP_KEY || "").trim();

  if (!cleanSetupKey || cleanSetupKey !== envSetupKey) {
    return NextResponse.json({ error: "Setup key incorrecta" }, { status: 401 });
  }

  if (!email || !password || password.length < 8) {
    return NextResponse.json(
      { error: "Email o password inválidos (mín 8 chars)" },
      { status: 400 }
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!url || !serviceRoleKey) {
    return NextResponse.json({ error: "Faltan env vars" }, { status: 500 });
  }

  // Cliente ADMIN (service role)
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });

  /* ======================
     1) CREAR USUARIO
  ====================== */
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  /* ======================
     2) MARCAR SETUP COMO HECHO
  ====================== */
  const { error: configError } = await admin
    .from("app_config")
    .upsert({
      key: "setup_done",
      value: "true",
    });

  if (configError) {
    return NextResponse.json(
      { error: "Usuario creado, pero no se pudo cerrar el setup" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, userId: data.user?.id });
}
