import { supabase } from "@/lib/supabaseClient";

export default async function AgendaPage() {
  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .order("start_at", { ascending: true })
    .limit(20);

  return (
    <main style={{ padding: 16 }}>
      <h1>Agenda</h1>

      {error ? (
        <pre style={{ marginTop: 12, color: "crimson" }}>
          Error: {error.message}
        </pre>
      ) : (
        <pre style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </main>
  );
}
