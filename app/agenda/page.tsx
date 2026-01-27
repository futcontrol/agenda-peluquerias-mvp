"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
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

type Stylist = {
  id: string; // para editar sin líos
  name: string;
  color: string;
};

const STORAGE_KEY_STYLISTS = "agenda_stylists_v1";

// Defaults (se puede editar desde el panel)
const DEFAULT_STYLISTS: Stylist[] = [
  { id: "sty_1", name: "Cristina", color: "#22c55e" },
  { id: "sty_2", name: "Laura", color: "#3b82f6" },
  { id: "sty_3", name: "Marta", color: "#f59e0b" },
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function clampMinuteTo5(d: Date) {
  const m = d.getMinutes();
  const rounded = Math.round(m / 5) * 5;
  d.setMinutes(rounded === 60 ? 0 : rounded);
  if (rounded === 60) d.setHours(d.getHours() + 1);
  d.setSeconds(0, 0);
  return d;
}

function defaultTimePlus10() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 10);
  clampMinuteTo5(d);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toYYYYMMDD(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
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

function parseHHMM(hhmm: string) {
  const [hh, mm] = (hhmm || "").split(":").map((x) => parseInt(x, 10));
  const H = Number.isFinite(hh) ? Math.min(Math.max(hh, 0), 23) : 0;
  const M = Number.isFinite(mm) ? Math.min(Math.max(mm, 0), 59) : 0;
  return { H, M };
}

// ✅ Hora siempre HH:MM (":" fijo) — normalización FINAL
function formatTimeKeepColon(input: string) {
  const digits = (input || "").replace(/\D/g, "").slice(0, 4);
  const hh = digits.slice(0, 2);
  const mm = digits.slice(2, 4);

  const HH = hh.padEnd(2, "0");
  const MM = mm.padEnd(2, "0");

  let H = Math.min(Math.max(parseInt(HH || "0", 10), 0), 23);
  let M = Math.min(Math.max(parseInt(MM || "0", 10), 0), 59);

  return `${pad(H)}:${pad(M)}`;
}

function handleTimeInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
  const input = e.currentTarget;
  const start = input.selectionStart ?? 0;
  const end = input.selectionEnd ?? 0;

  // Evita borrar el ":" en medio
  if (e.key === "Backspace") {
    if (start === 3 && end === 3) {
      e.preventDefault();
      input.setSelectionRange(2, 2);
      return;
    }
  }
  if (e.key === "Delete") {
    if (start === 2 && end === 2) {
      e.preventDefault();
      input.setSelectionRange(3, 3);
      return;
    }
  }
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

function addMinutesToHHMM(hhmm: string, minutes: number) {
  const { H, M } = parseHHMM(hhmm);
  const d = new Date();
  d.setHours(H, M, 0, 0);
  d.setMinutes(d.getMinutes() + minutes);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function SmallButton({
  children,
  onClick,
  active,
  danger,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  const bg = danger
    ? "rgba(239,68,68,0.14)"
    : active
    ? "rgba(255,255,255,0.16)"
    : "rgba(255,255,255,0.08)";

  const border = danger
    ? "rgba(239,68,68,0.28)"
    : active
    ? "rgba(255,255,255,0.24)"
    : "rgba(255,255,255,0.14)";

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

function PrimaryButton({
  children,
  onClick,
  disabled,
  type,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type || (onClick ? "button" : "submit")}
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 46,
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.14)",
        background: disabled ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.12)",
        color: "rgba(255,255,255,0.95)",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 950,
        letterSpacing: 0.2,
        padding: "0 14px",
        userSelect: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {children}
    </button>
  );
}

type UndoState = null | {
  expiresAt: number;
  row: {
    user_id: string;
    client_name: string;
    arrival_at: string;
    phase: Phase;
    stylist_name?: string | null;
    stylist_color?: string | null;
  };
};

/**
 * ✅ Next.js build fix:
 * useSearchParams() debe estar dentro de un componente envuelto en <Suspense>.
 * - AgendaPage: wrapper con <Suspense>
 * - AgendaPageInner: usa useSearchParams y pasa `initialDate` a la agenda real
 */

function AgendaPageInner() {
  const searchParams = useSearchParams();
  const urlDate = searchParams.get("date") || toYYYYMMDD(new Date());
  return <AgendaInner initialDate={urlDate} />;
}

export default function AgendaPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", padding: 18, background: "rgba(9,10,12,1)", color: "rgba(255,255,255,0.92)" }}>Cargando agenda…</div>}>
      <AgendaPageInner />
    </Suspense>
  );
}

/**
 * ✅ Componente real de la agenda (todo lo que ya tenías),
 * solo que ahora recibe initialDate y NO llama a useSearchParams.
 */
function AgendaInner({ initialDate }: { initialDate: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // ✅ día inicial: viene por prop (desde ?date=YYYY-MM-DD), si no hoy
  const [selectedDate, setSelectedDate] = useState<string>(() => initialDate || toYYYYMMDD(new Date()));

  // ✅ si cambia la URL (navegación interna), sincroniza selectedDate desde window.location
  useEffect(() => {
    // Mantiene el comportamiento previo de “si vienes de /agenda/month y trae date”
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

  useEffect(() => {
    const t = setInterval(() => {
      loadDay(selectedDate);
    }, 20000);

    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  useEffect(() => {
    const onFocus = () => loadDay(selectedDate);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  const selectedDateObj = useMemo(() => new Date(`${selectedDate}T00:00:00`), [selectedDate]);

  // ✅ peluqueros (persisten en localStorage)
  const [stylists, setStylists] = useState<Stylist[]>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY_STYLISTS) : null;
      if (!raw) return DEFAULT_STYLISTS;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as Stylist[];
      return DEFAULT_STYLISTS;
    } catch {
      return DEFAULT_STYLISTS;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY_STYLISTS, JSON.stringify(stylists));
    } catch {
      // ignore
    }
  }, [stylists]);

  // Datos
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Crear
  const [clientName, setClientName] = useState("");

  // ✅ IMPORTANTE: draft libre para poder escribir siempre
  const [timeDraft, setTimeDraft] = useState(defaultTimePlus10());

  const [stylistId, setStylistId] = useState<string>(() => DEFAULT_STYLISTS[0]?.id || "sty_1");
  const [creating, setCreating] = useState(false);

  // UI panel peluqueros
  const [stylistsOpen, setStylistsOpen] = useState(false);

  // Edit hora inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingHHMM, setEditingHHMM] = useState<string>("");

  // Drag feedback
  const [dragOver, setDragOver] = useState<Phase | null>(null);

  // Undo delete (10s)
  const [undo, setUndo] = useState<UndoState>(null);

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
  }, [items, phases]);

  const selectedStylist = useMemo(() => {
    return stylists.find((s) => s.id === stylistId) || stylists[0] || DEFAULT_STYLISTS[0];
  }, [stylists, stylistId]);

  // Si borran la peluquera seleccionada, re-selecciona la primera
  useEffect(() => {
    if (!stylists.some((s) => s.id === stylistId)) {
      setStylistId(stylists[0]?.id || DEFAULT_STYLISTS[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stylists]);

  // ✅ helper: navegar a una fecha y mantener URL
  const goToDate = (dateStr: string) => {
    setSelectedDate(dateStr);
    router.push(`/agenda?date=${dateStr}`);
  };

  // Autofocus al entrar
  useEffect(() => {
    const t = setTimeout(() => nameInputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, []);

  // Escape cierra modal
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setStylistsOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function getStylistColorFor(appt: Appointment) {
    if (appt.stylist_color) return appt.stylist_color;
    if (appt.stylist_name) {
      const s = stylists.find((x) => x.name === appt.stylist_name);
      if (s?.color) return s.color;
    }
    return null;
  }

  async function loadDay(dateStr = selectedDate) {
    setError(null);
    setLoading(true);

    const d = new Date(`${dateStr}T00:00:00`);
    const start = startOfDay(d);
    const end = endOfDay(d);

    const { data, error } = await supabase
      .from("appointments")
      .select("id,arrival_at,client_name,phase,stylist_name,stylist_color")
      .gte("arrival_at", start.toISOString())
      .lte("arrival_at", end.toISOString())
      .order("arrival_at", { ascending: true });

    if (error) {
      setError(error.message);
      setItems([]);
    } else {
      setItems((data || []) as Appointment[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadDay(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  // Tick para refrescar “toca ya”
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // Undo expiry
  useEffect(() => {
    if (!undo) return;
    const ms = Math.max(0, undo.expiresAt - Date.now());
    const t = setTimeout(() => setUndo(null), ms);
    return () => clearTimeout(t);
  }, [undo]);

  async function createQuickAppointment(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const name = clientName.trim();
    if (!name) {
      nameInputRef.current?.focus();
      return;
    }

    setCreating(true);
    try {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;

      const userId = authData.user?.id;
      if (!userId) throw new Error("No hay sesión");

      const stylist = selectedStylist;

      // ✅ normalizamos aquí (y no mientras escribes)
      const safeTime = formatTimeKeepColon(timeDraft);
      const { H, M } = parseHHMM(safeTime);

      const arrival = new Date(`${selectedDate}T00:00:00`);
      arrival.setHours(H, M, 0, 0);

      const tempId = `tmp_${Math.random().toString(16).slice(2)}`;
      const optimistic: Appointment = {
        id: tempId,
        client_name: name,
        arrival_at: arrival.toISOString(),
        phase: "por_llegar",
        stylist_name: stylist?.name ?? null,
        stylist_color: stylist?.color ?? null,
      };
      setItems((prev) => [...prev, optimistic]);

      const { data, error } = await supabase
        .from("appointments")
        .insert({
          user_id: userId,
          client_name: name,
          arrival_at: arrival.toISOString(),
          phase: "por_llegar",
          stylist_name: stylist?.name ?? null,
          stylist_color: stylist?.color ?? null,
        })
        .select("id,arrival_at,client_name,phase,stylist_name,stylist_color")
        .single();

      if (error) {
        setItems((prev) => prev.filter((x) => x.id !== tempId));
        throw error;
      }

      setItems((prev) => prev.map((x) => (x.id === tempId ? (data as Appointment) : x)));

      setClientName("");
      // mantenemos la “siguiente” rápida (como antes)
      setTimeDraft(addMinutesToHHMM(safeTime, 10));
      setTimeout(() => nameInputRef.current?.focus(), 80);
    } catch (e: any) {
      setError(e?.message ?? "Error creando cita");
    } finally {
      setCreating(false);
    }
  }

  async function movePhase(id: string, next: Phase) {
    const prev = items;
    setItems((cur) => cur.map((x) => (x.id === id ? { ...x, phase: next } : x)));

    const { error } = await supabase.from("appointments").update({ phase: next }).eq("id", id);

    if (error) {
      setItems(prev);
      setError(error.message);
    }
  }

  async function updateArrivalTime(id: string, hhmm: string) {
    const safe = formatTimeKeepColon(hhmm);
    const { H, M } = parseHHMM(safe);

    const arrival = new Date(`${selectedDate}T00:00:00`);
    arrival.setHours(H, M, 0, 0);

    const prev = items;
    setItems((cur) =>
      cur.map((x) => (x.id === id ? { ...x, arrival_at: arrival.toISOString() } : x))
    );

    const { error } = await supabase
      .from("appointments")
      .update({ arrival_at: arrival.toISOString() })
      .eq("id", id);

    if (error) {
      setItems(prev);
      setError(error.message);
      return;
    }

    setEditingId(null);
    setEditingHHMM("");
  }

  async function deleteAppointment(appt: Appointment) {
    setError(null);

    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;

    setItems((cur) => cur.filter((x) => x.id !== appt.id));

    const { error } = await supabase.from("appointments").delete().eq("id", appt.id);

    if (error) {
      setItems((cur) =>
        [...cur, appt].sort(
          (a, b) => new Date(a.arrival_at).getTime() - new Date(b.arrival_at).getTime()
        )
      );
      setError(error.message);
      return;
    }

    if (userId) {
      setUndo({
        expiresAt: Date.now() + 10_000,
        row: {
          user_id: userId,
          client_name: appt.client_name,
          arrival_at: appt.arrival_at,
          phase: appt.phase,
          stylist_name: appt.stylist_name ?? null,
          stylist_color: appt.stylist_color ?? null,
        },
      });
    }
  }

  async function undoDelete() {
    if (!undo) return;
    const row = undo.row;
    setUndo(null);

    const tempId = `tmp_${Math.random().toString(16).slice(2)}`;
    const optimistic: Appointment = {
      id: tempId,
      client_name: row.client_name,
      arrival_at: row.arrival_at,
      phase: row.phase,
      stylist_name: row.stylist_name ?? null,
      stylist_color: row.stylist_color ?? null,
    };
    setItems((prev) => [...prev, optimistic]);

    const { data, error } = await supabase
      .from("appointments")
      .insert(row)
      .select("id,arrival_at,client_name,phase,stylist_name,stylist_color")
      .single();

    if (error) {
      setItems((prev) => prev.filter((x) => x.id !== tempId));
      setError(error.message);
      return;
    }

    setItems((prev) => prev.map((x) => (x.id === tempId ? (data as Appointment) : x)));
  }

  function dayTitle() {
    const d = selectedDateObj;
    return d.toLocaleDateString("es-ES", { weekday: "long", day: "2-digit", month: "long" });
  }

  // ====== ESTÉTICA (más lovable) ======
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

  const inputBase: React.CSSProperties = {
    height: 46,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.18)",
    color: "rgba(255,255,255,0.95)",
    padding: "0 12px",
    fontWeight: 900,
    outline: "none",
  };

  const cardTitle: React.CSSProperties = {
    fontSize: 20,
    fontWeight: 980,
    textTransform: "capitalize",
  };
  const subText: React.CSSProperties = { fontSize: 12, opacity: 0.78, marginTop: 4, fontWeight: 850 };

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
            onClick={() => setStylistsOpen(true)}
            style={{ ...pill, cursor: "pointer" }}
            title="Gestionar peluqueros"
          >
            👥 Peluqueros
          </button>
        </div>
      </div>

      {/* CREAR + INFO */}
      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
        <div style={{ ...surface }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={cardTitle}>Nueva cita</div>
              <div style={subText}>Enter crea · Hora libre (HH:MM)</div>
            </div>
          </div>

          <form onSubmit={createQuickAppointment} style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              ref={nameInputRef}
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Nombre (ej. Marta)"
              style={{ ...inputBase, flex: "1 1 240px" }}
            />

            {/* Selector estilizado peluquero */}
            <div
              style={{
                ...inputBase,
                padding: "0 10px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                minWidth: 190,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: selectedStylist?.color || "rgba(255,255,255,0.6)",
                  boxShadow: "0 0 0 2px rgba(255,255,255,0.14)",
                }}
              />
              <select
                value={stylistId}
                onChange={(e) => setStylistId(e.target.value)}
                style={{
                  appearance: "none",
                  WebkitAppearance: "none",
                  MozAppearance: "none",
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  color: "rgba(255,255,255,0.95)",
                  fontWeight: 950,
                  width: "100%",
                  cursor: "pointer",
                }}
              >
                {stylists.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <span style={{ opacity: 0.7, fontWeight: 950 }}>▾</span>
            </div>

            {/* ✅ Hora: ahora SIEMPRE escribible (no formateamos mientras tecleas) */}
            <input
              type="text"
              value={timeDraft}
              onChange={(e) => setTimeDraft(e.target.value)}
              onBlur={() => setTimeDraft(formatTimeKeepColon(timeDraft))}
              inputMode="numeric"
              placeholder="HH:MM"
              style={{ ...inputBase, width: 120, textAlign: "center" }}
            />

            <PrimaryButton disabled={creating || clientName.trim().length === 0} type="submit">
              {creating ? "Creando…" : "+ Añadir"}
            </PrimaryButton>
          </form>

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
            <SmallButton onClick={() => setTimeDraft(addMinutesToHHMM(formatTimeKeepColon(timeDraft), -10))}>-10</SmallButton>
            <SmallButton onClick={() => setTimeDraft(defaultTimePlus10())} active>
              Próxima
            </SmallButton>
            <SmallButton onClick={() => setTimeDraft(addMinutesToHHMM(formatTimeKeepColon(timeDraft), 10))}>+10</SmallButton>

            {error ? (
              <div style={{ marginLeft: "auto", fontSize: 12, color: "rgba(255,120,120,0.95)", fontWeight: 950 }}>
                {error}
              </div>
            ) : (
              <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.72, fontWeight: 900 }}>
                Tip: en móvil, si el drag & drop se hace incómodo, usa ▶ ✓ ↩ para mover rápido.
              </div>
            )}
          </div>
        </div>

        {/* UNDO */}
        {undo ? (
          <div
            style={{
              ...surface,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.07)",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 950 }}>
              Cita eliminada · <span style={{ opacity: 0.78, fontWeight: 850 }}>Puedes deshacer (10s)</span>
            </div>
            <SmallButton onClick={undoDelete} active>
              Deshacer
            </SmallButton>
          </div>
        ) : null}
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
                const isEditing = editingId === appt.id;
                const color = getStylistColorFor(appt);

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
                        {/* Hora */}
                        {!isEditing ? (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(appt.id);
                              setEditingHHMM(timeHHMM(appt.arrival_at));
                            }}
                            style={{
                              border: "none",
                              background: "transparent",
                              color: "rgba(255,255,255,0.95)",
                              fontSize: 20,
                              fontWeight: 980,
                              cursor: "pointer",
                              padding: 0,
                            }}
                            title="Editar hora"
                          >
                            {timeHHMM(appt.arrival_at)}
                          </button>
                        ) : (
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <input
                              value={editingHHMM}
                              onChange={(e) => setEditingHHMM(formatTimeKeepColon(e.target.value))}
                              onKeyDown={handleTimeInputKeyDown}
                              inputMode="numeric"
                              placeholder="HH:MM"
                              style={{
                                width: 96,
                                height: 36,
                                borderRadius: 14,
                                border: "1px solid rgba(255,255,255,0.14)",
                                background: "rgba(255,255,255,0.06)",
                                color: "rgba(255,255,255,0.95)",
                                padding: "0 10px",
                                fontWeight: 980,
                                textAlign: "center",
                                outline: "none",
                              }}
                              onKeyDownCapture={(e) => {
                                if (e.key === "Enter") updateArrivalTime(appt.id, editingHHMM);
                                if (e.key === "Escape") {
                                  setEditingId(null);
                                  setEditingHHMM("");
                                }
                              }}
                              autoFocus
                            />
                            <SmallButton onClick={() => updateArrivalTime(appt.id, editingHHMM)} active>
                              OK
                            </SmallButton>
                            <SmallButton
                              onClick={() => {
                                setEditingId(null);
                                setEditingHHMM("");
                              }}
                            >
                              cancelar
                            </SmallButton>
                          </div>
                        )}

                        {/* Nombre */}
                        <div
                          style={{
                            marginTop: 6,
                            fontSize: 15,
                            fontWeight: 980,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {appt.client_name}
                        </div>

                        {/* Peluquero */}
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

                      {/* Acciones */}
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

                        <SmallButton danger onClick={() => deleteAppointment(appt)}>
                          Borrar
                        </SmallButton>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* MODAL PELUQUEROS */}
      {stylistsOpen ? (
        <div
          onMouseDown={() => setStylistsOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "grid",
            placeItems: "center",
            padding: 16,
            zIndex: 50,
          }}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: "min(720px, 100%)",
              borderRadius: 20,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(20,22,26,0.86)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
              backdropFilter: "blur(12px)",
              padding: 14,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 980 }}>Peluqueros</div>
                <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 900 }}>
                  Edita nombres y colores (se guardan en este dispositivo)
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <SmallButton
                  onClick={() => {
                    const id = `sty_${Math.random().toString(16).slice(2)}`;
                    setStylists((prev) => [...prev, { id, name: "Nueva", color: "#a3a3a3" }]);
                    setStylistId((cur) => cur || id);
                  }}
                  active
                >
                  + Añadir
                </SmallButton>
                <SmallButton onClick={() => setStylistsOpen(false)}>Cerrar</SmallButton>
              </div>
            </div>

            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              {stylists.map((s) => (
                <div
                  key={s.id}
                  style={{
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.05)",
                    padding: 12,
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <input
                    type="color"
                    value={s.color}
                    onChange={(e) => {
                      const val = e.target.value;
                      setStylists((prev) => prev.map((x) => (x.id === s.id ? { ...x, color: val } : x)));
                    }}
                    style={{
                      width: 44,
                      height: 34,
                      border: "1px solid rgba(255,255,255,0.14)",
                      borderRadius: 12,
                      background: "transparent",
                      padding: 0,
                      cursor: "pointer",
                    }}
                    aria-label="Color"
                  />

                  <input
                    value={s.name}
                    onChange={(e) => {
                      const val = e.target.value;
                      setStylists((prev) => prev.map((x) => (x.id === s.id ? { ...x, name: val } : x)));
                    }}
                    placeholder="Nombre"
                    style={{
                      height: 40,
                      borderRadius: 14,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(0,0,0,0.22)",
                      color: "rgba(255,255,255,0.95)",
                      padding: "0 12px",
                      fontWeight: 900,
                      outline: "none",
                      flex: "1 1 260px",
                    }}
                  />

                  <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                    <SmallButton
                      danger
                      disabled={stylists.length <= 1}
                      onClick={() => {
                        if (stylists.length <= 1) return;
                        setStylists((prev) => prev.filter((x) => x.id !== s.id));
                      }}
                    >
                      Eliminar
                    </SmallButton>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75, fontWeight: 900 }}>
              Nota: las citas ya guardadas mantienen su color/nombre guardado. Si quieres que se “actualicen” todas, lo
              hacemos luego con un script (no hace falta para el MVP).
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
