"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

export default function SetupPage() {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupKey, setSetupKey] = useState("");

  /* ======================
     COMPROBAR SI SETUP YA ESTÁ HECHO
  ====================== */
  useEffect(() => {
    async function checkSetup() {
      const { data, error } = await supabase
        .from("app_config")
        .select("value")
        .eq("key", "setup_done")
        .maybeSingle();

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      // Si setup_done = true → fuera
      if (data?.value === "true") {
        window.location.href = "/login";
        return;
      }

      setLoading(false);
    }

    checkSetup();
  }, [supabase]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const res = await fetch("/api/setup/create-shared-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, setupKey }),
    });

    const json = await res.json();

    if (!res.ok) {
      setError(json.error || "Error");
      return;
    }

    // Setup hecho → login
    window.location.href = "/login";
  }

  if (loading) {
    return (
      <div style={{ padding: 40 }}>
        <p>Cargando…</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 420, margin: "80px auto", padding: 20 }}>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 12 }}>
        Setup inicial
      </h1>

      <p style={{ opacity: 0.7, marginBottom: 20 }}>
        Crear usuario compartido de la peluquería
      </p>

      <form
        onSubmit={submit}
        style={{ display: "grid", gap: 12 }}
      >
        <input
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <input
          placeholder="Contraseña"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <input
          placeholder="Setup key"
          value={setupKey}
          onChange={(e) => setSetupKey(e.target.value)}
          required
        />

        <button type="submit" style={{ fontWeight: 800 }}>
          Crear usuario
        </button>
      </form>

      {error && (
        <p style={{ marginTop: 12, color: "red" }}>
          {error}
        </p>
      )}
    </div>
  );
}
