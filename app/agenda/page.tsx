"use client";

import React, { Suspense, useEffect, useMemo, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

type Phase = "por_llegar" | "en_proceso" | "terminado";

type Appointment = {
  id: string;
  arrival_at: string;
  client_name: string;
  phase: Phase;
  stylist_name?: string | null;
  stylist_color?: string | null;
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toYYYYMMDD(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function timeHHMM(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function phaseLabel(phase: Phase) {
  switch (phase) {
    case "por_llegar":
      return "Por llegar";
    case "en_proceso":
      return "En proceso";
    case "terminado":
      return "Terminado";
  }
}

function phaseTint(phase: Phase) {
  switch (phase) {
    case "por_llegar":
      return "rgba(59,130,246,0.14)";
    case "en_proceso":
      return "rgba(245,158,11,0.16)";
    case "terminado":
      return "rgba(34,197,94,0.14)";
  }
}

function phaseBorder(phase: Phase) {
  switch (phase) {
    case "por_llegar":
      return "rgba(59,130,246,0.35)";
    case "en_proceso":
      return "rgba(245,158,11,0.35)";
    case "terminado":
      return "rgba(34,197,94,0.35)";
  }
}

function isNowish(iso: string, windowMinutes = 10) {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diffMin = Math.abs(now - t) / 60000;
  return diffMin <= windowMinutes;
}

function SmallButton({
  children,
  onClick,
  active,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  const bg = active ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.08)";
  const border = active ? "rgba(255,255,255,0.24)" : "rgba(255,255,255,0.14)";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "10px 12px",
        borderRadius: 14,
        border: `1px solid ${border}`,
        background: disabled ? "rgba(255,255,255,0.06)" : bg,
        color: "rgba(255,255,255,0.92)",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 900,
        fontSize: 12,
        opacity: disabled ? 0.65 : 1,
        letterSpacing: 0.2,
        userSelect: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {children}
    </button>
  );
}

/**
 * ✅ Next.js build fix:
 * useSearchParams() debe estar dentro de un componente envuelto en <Suspense>.
 */
function AgendaPageInner() {
  const searchParams = useSearchParams();
  const urlDate = searchParams.get("date") || toYYYYMMDD(new Date());
  return <AgendaInner initialDate={urlDate} />;
}

export default function AgendaPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: "100vh",
            padding: 18,
            background: "rgba(9,10,12,1)",
            color: "rgba(255,255,255,0.92)",
          }}
        >
          Cargando agenda…
        </div>
      }
    >
      <AgendaPageInner />
    </Suspense>
  );
}

/**
 * ✅ /agenda = PIZARRA PURA
 * - No crea citas
 * - No edita horas / duración / peluquera
 * - Solo: ver por fases + mover phase + (opcional) editar nombre
 * - ✅ Sync instantáneo con Realtime + fallback
 * - ✅ Filtro día robusto: [start, nextDayStart)
 * - ✅ Borrar citas SOLO desde "Terminado" (confirm + rollback)
 */
function AgendaInner({ initialDate }: { initialDate: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [selectedDate, setSelectedDate] = useState<string>(() => initialDate || toYYYYMMDD(new Date()));
  const selectedDateObj = useMemo(() => new Date(`${selectedDate}T00:00:00`), [selectedDate]);

  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dragOver, setDragOver] = useState<Phase | null>(null);

  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>("");

  const phases: Phase[] = ["por_llegar", "en_proceso", "terminado"];

  const grouped = useMemo(() => {
    const map: Record<Phase, Appointment[]> = {
      por_llegar: [],
      en_proceso: [],
      terminado: [],
    };
    for (const it of items) map[it.phase].push(it);
    for (const p of phases) {
      map[p].sort((a, b) => new Date(a.arrival_at).getTime() - new Date(b.arrival_at).getTime());
    }
    return map;
  }, [items]);

  const goToDate = (dateStr: string) => {
    setSelectedDate(dateStr);
    router.push(`/agenda?date=${dateStr}`);
  };

  // ✅ sincroniza selectedDate desde URL si navegas atrás/adelante
  useEffect(() => {
    const readFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const urlDate = params.get("date");
      if (urlDate && urlDate !== selectedDate) setSelectedDate(urlDate);
    };

    readFromUrl();
    window.addEventListener("popstate", readFromUrl);
    return () => window.removeEventListener("popstate", readFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  const loadDay = useCallback(
    async (dateStr = selectedDate) => {
      setError(null);
      setLoading(true);

      // ✅ Filtro robusto: [start, nextDayStart)
      const base = new Date(`${dateStr}T00:00:00`);
      const start = startOfDay(base);
      const nextDayStart = startOfDay(addDays(base, 1));

      const { data, error } = await supabase
        .from("appointments")
        .select("id,arrival_at,client_name,phase,stylist_name,stylist_color")
        .gte("arrival_at", start.toISOString())
        .lt("arrival_at", nextDayStart.toISOString())
        .order("arrival_at", { ascending: true });

      if (error) {
        setError(error.message);
        setItems([]);
      } else {
        setItems((data || []) as Appointment[]);
      }

      setLoading(false);
    },
    [selectedDate, supabase]
  );

  useEffect(() => {
    loadDay(selectedDate);
  }, [selectedDate, loadDay]);

  /**
   * ✅ Realtime: si alguien crea/edita/elimina citas en /agenda/schedule,
   * la pizarra se actualiza AL MOMENTO.
   */
  useEffect(() => {
    let isMounted = true;

    const channel = supabase
      .channel("realtime-appointments")
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, () => {
        if (!isMounted) return;
        loadDay(selectedDate);
      })
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [supabase, selectedDate, loadDay]);

  // ✅ Fallback suave: refresco cada 25s
  useEffect(() => {
    const t = setInterval(() => loadDay(selectedDate), 25_000);
    return () => clearInterval(t);
  }, [selectedDate, loadDay]);

  // ✅ Fallback: al volver a la app / cambiar pestaña, refresca
  useEffect(() => {
    const onFocus = () => loadDay(selectedDate);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [selectedDate, loadDay]);

  // Tick para refrescar “toca ya”
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  async function movePhase(id: string, next: Phase) {
    setError(null);
    const prev = items;
    setItems((cur) => cur.map((x) => (x.id === id ? { ...x, phase: next } : x)));

    const { error } = await supabase.from("appointments").update({ phase: next }).eq("id", id);

    if (error) {
      setItems(prev);
      setError(error.message);
    }
  }

  async function saveClientName(id: string, name: string) {
    const trimmed = (name || "").trim();
    if (!trimmed) return;

    setError(null);
    const prev = items;
    setItems((cur) => cur.map((x) => (x.id === id ? { ...x, client_name: trimmed } : x)));

    const { error } = await supabase.from("appointments").update({ client_name: trimmed }).eq("id", id);

    if (error) {
      setItems(prev);
      setError(error.message);
      return;
    }

    setEditingNameId(null);
    setEditingName("");
  }

  // ✅ Borrar SOLO desde terminado (confirm + optimistic + rollback)
  async function deleteAppointment(id: string, label?: string) {
    const ok = window.confirm(`¿Borrar definitivamente a "${label || "esta cita"}"?`);
    if (!ok) return;

    setError(null);

    const prev = items;
    setItems((cur) => cur.filter((x) => x.id !== id));

    const { error } = await supabase.from("appointments").delete().eq("id", id);

    if (error) {
      setItems(prev);
      setError(error.message);
    }
  }

  function dayTitle() {
    const d = selectedDateObj;
    return d.toLocaleDateString("es-ES", { weekday: "long", day: "2-digit", month: "long" });
  }

  // ====== ESTÉTICA ======
  const pageBg: React.CSSProperties = {
    minHeight: "100vh",
    padding: 18,
    background:
      "radial-gradient(900px 520px at 8% 6%, rgba(34,197,94,0.11), transparent 60%), radial-gradient(900px 520px at 92% 10%, rgba(59,130,246,0.10), transparent 60%), radial-gradient(900px 520px at 40% 92%, rgba(245,158,11,0.10), transparent 60%), rgba(9,10,12,1)",
    color: "rgba(255,255,255,0.92)",
  };

  const surface: React.CSSProperties = {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.06)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
    padding: 14,
    backdropFilter: "blur(10px)",
  };

  const topBar: React.CSSProperties = {
    ...surface,
    padding: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  };

  const pill: React.CSSProperties = {
    height: 38,
    padding: "0 12px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.18)",
    color: "rgba(255,255,255,0.92)",
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    fontWeight: 950,
    fontSize: 12,
    letterSpacing: 0.2,
  };

  const cardTitle: React.CSSProperties = {
    fontSize: 20,
    fontWeight: 980,
    textTransform: "capitalize",
  };

  const subText: React.CSSProperties = {
    fontSize: 12,
    opacity: 0.78,
    marginTop: 4,
    fontWeight: 850,
  };

  if (loading) {
    return (
      <div style={pageBg}>
        <div style={{ ...surface, maxWidth: 520 }}>Cargando agenda…</div>
      </div>
    );
  }

  return (
    <div style={pageBg}>
      {/* TOP BAR */}
      <div style={topBar}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 280 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.08)",
              display: "grid",
              placeItems: "center",
              fontWeight: 980,
            }}
            title="Agenda"
          >
            ✂️
          </div>

          <div>
            <div style={{ fontSize: 14, fontWeight: 980, letterSpacing: 0.2 }}>Pizarra</div>
            <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 850 }}>{dayTitle()}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={pill}>
            <SmallButton onClick={() => goToDate(toYYYYMMDD(addDays(selectedDateObj, -1)))}>◀</SmallButton>
            <SmallButton onClick={() => goToDate(toYYYYMMDD(new Date()))} active>
              Hoy
            </SmallButton>
            <SmallButton onClick={() => goToDate(toYYYYMMDD(addDays(selectedDateObj, 1)))}>▶</SmallButton>
          </div>

          <button
            type="button"
            onClick={() => router.push("/agenda/month")}
            style={{ ...pill, cursor: "pointer" }}
            title="Vista mes"
          >
            📅 Mes
          </button>

          <button
            type="button"
            onClick={() => router.push(`/agenda/schedule?date=${selectedDate}`)}
            style={{ ...pill, cursor: "pointer" }}
            title="Dar horas (agenda por horas)"
          >
            🗓️ Dar horas
          </button>
        </div>
      </div>

      {/* INFO / ERRORES */}
      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
        <div style={{ ...surface }}>
          <div>
            <div style={cardTitle}>Pizarra del día</div>
            <div style={subText}>
              Solo ejecución: mover fases y (opcional) editar nombre. Las horas/duración/peluquera se gestionan en “Dar
              horas”. En “Terminado” puedes borrar para limpiar.
            </div>
          </div>

          {error ? (
            <div style={{ marginTop: 10, fontSize: 12, color: "rgba(255,120,120,0.95)", fontWeight: 950 }}>
              {error}
            </div>
          ) : (
            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.72, fontWeight: 900 }}>
              Tip: en “Terminado” usa 🗑 para que no se acumule.
            </div>
          )}
        </div>
      </div>

      {/* BOARD */}
      <div
        style={{
          marginTop: 12,
          display: "grid",
          gridAutoFlow: "column",
          gridAutoColumns: "minmax(340px, 1fr)",
          overflowX: "auto",
          gap: 12,
          paddingBottom: 10,
          WebkitOverflowScrolling: "touch",
        }}
      >
        {phases.map((ph) => (
          <div
            key={ph}
            style={{
              borderRadius: 20,
              border: `1px solid ${phaseBorder(ph)}`,
              background: phaseTint(ph),
              padding: 12,
              minHeight: 320,
              transition: "box-shadow 120ms ease",
              boxShadow: dragOver === ph ? "0 0 0 2px rgba(255,255,255,0.22) inset" : "none",
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(ph);
            }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const id = e.dataTransfer.getData("text/plain");
              if (!id) return;
              movePhase(id, ph);
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 980, letterSpacing: 0.2 }}>{phaseLabel(ph)}</div>
              <div
                style={{
                  fontSize: 12,
                  opacity: 0.9,
                  fontWeight: 980,
                  borderRadius: 999,
                  padding: "4px 10px",
                  border: "1px solid rgba(255,255,255,0.16)",
                  background: "rgba(0,0,0,0.12)",
                }}
              >
                {grouped[ph].length}
              </div>
            </div>

            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
              {grouped[ph].length === 0 ? (
                <div
                  style={{
                    borderRadius: 16,
                    border: "1px dashed rgba(255,255,255,0.18)",
                    padding: 14,
                    fontSize: 12,
                    opacity: 0.78,
                    fontWeight: 900,
                  }}
                >
                  Arrastra aquí
                </div>
              ) : null}

              {grouped[ph].map((appt) => {
                const nowish = isNowish(appt.arrival_at, 10);
                const color = appt.stylist_color || null;
                const isEditingName = editingNameId === appt.id;

                return (
                  <div
                    key={appt.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", appt.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    style={{
                      borderRadius: 18,
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderLeft: color ? `6px solid ${color}` : "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(0,0,0,0.16)",
                      padding: 12,
                      paddingLeft: color ? 10 : 12,
                      boxShadow: nowish ? "0 0 0 2px rgba(255,255,255,0.18) inset" : "none",
                      transform: nowish ? "translateY(-1px)" : "none",
                      transition: "transform 120ms ease, box-shadow 120ms ease",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        {/* Hora (solo lectura) */}
                        <div
                          style={{
                            color: "rgba(255,255,255,0.95)",
                            fontSize: 20,
                            fontWeight: 980,
                            padding: 0,
                          }}
                          title="Hora (solo lectura en pizarra)"
                        >
                          {timeHHMM(appt.arrival_at)}
                        </div>

                        {/* Nombre (editable opcional) */}
                        {!isEditingName ? (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingNameId(appt.id);
                              setEditingName(appt.client_name || "");
                            }}
                            style={{
                              marginTop: 6,
                              border: "none",
                              background: "transparent",
                              color: "rgba(255,255,255,0.95)",
                              fontSize: 15,
                              fontWeight: 980,
                              textAlign: "left",
                              padding: 0,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              width: "100%",
                            }}
                            title="Editar nombre"
                          >
                            {appt.client_name}
                          </button>
                        ) : (
                          <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
                            <input
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              placeholder="Nombre"
                              style={{
                                height: 38,
                                borderRadius: 14,
                                border: "1px solid rgba(255,255,255,0.14)",
                                background: "rgba(255,255,255,0.06)",
                                color: "rgba(255,255,255,0.95)",
                                padding: "0 10px",
                                fontWeight: 950,
                                outline: "none",
                                width: "min(260px, 100%)",
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveClientName(appt.id, editingName);
                                if (e.key === "Escape") {
                                  setEditingNameId(null);
                                  setEditingName("");
                                }
                              }}
                              autoFocus
                            />
                            <SmallButton onClick={() => saveClientName(appt.id, editingName)} active>
                              OK
                            </SmallButton>
                            <SmallButton
                              onClick={() => {
                                setEditingNameId(null);
                                setEditingName("");
                              }}
                            >
                              cancelar
                            </SmallButton>
                          </div>
                        )}

                        {/* Peluquero (solo lectura) */}
                        {appt.stylist_name ? (
                          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.78, fontWeight: 950 }}>
                            {appt.stylist_name}
                          </div>
                        ) : null}

                        {nowish ? (
                          <div style={{ marginTop: 6, fontSize: 12, fontWeight: 950, opacity: 0.9 }}>
                            Está tocando ahora
                          </div>
                        ) : null}
                      </div>

                      {/* Acciones (mover fase + borrar si terminado) */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 72 }}>
                        {appt.phase !== "por_llegar" ? (
                          <SmallButton onClick={() => movePhase(appt.id, "por_llegar")}>↩</SmallButton>
                        ) : null}
                        {appt.phase !== "en_proceso" ? (
                          <SmallButton onClick={() => movePhase(appt.id, "en_proceso")}>▶</SmallButton>
                        ) : null}
                        {appt.phase !== "terminado" ? (
                          <SmallButton onClick={() => movePhase(appt.id, "terminado")}>✓</SmallButton>
                        ) : null}

                        {/* ✅ Borrar SOLO en terminado */}
                        {appt.phase === "terminado" ? (
                          <SmallButton onClick={() => deleteAppointment(appt.id, appt.client_name)}>🗑</SmallButton>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
