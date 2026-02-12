"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
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
  duration_min?: number | null;
};

type Stylist = {
  id: string;
  name: string;
  color: string;
};

const STORAGE_KEY_STYLISTS = "agenda_stylists_v1";

const DEFAULT_STYLISTS: Stylist[] = [
  { id: "sty_1", name: "Cristina", color: "#22c55e" },
  { id: "sty_2", name: "Laura", color: "#3b82f6" },
  { id: "sty_3", name: "Marta", color: "#f59e0b" },
];

const DURATION_OPTIONS = [15, 30, 45, 60, 90];
const DEFAULT_DURATION = 30;

const START_HOUR = 9;
const END_HOUR = 20;
const STEP_MIN = 15;

// UI tuning
const ROW_H = 56;
const COL_MIN_W = 240;

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

function parseHHMM(hhmm: string) {
  const [hh, mm] = (hhmm || "").split(":").map((x) => parseInt(x, 10));
  const H = Number.isFinite(hh) ? Math.min(Math.max(hh, 0), 23) : 0;
  const M = Number.isFinite(mm) ? Math.min(Math.max(mm, 0), 59) : 0;
  return { H, M };
}

function buildSlots(fromHH = START_HOUR, toHH = END_HOUR, stepMin = STEP_MIN) {
  const out: string[] = [];
  for (let h = fromHH; h <= toHH; h++) {
    for (let m = 0; m < 60; m += stepMin) {
      if (h === toHH && m > 0) break;
      out.push(`${pad(h)}:${pad(m)}`);
    }
  }
  return out;
}

function dayTitle(yyyyMMdd: string) {
  const d = new Date(`${yyyyMMdd}T00:00:00`);
  return d.toLocaleDateString("es-ES", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}

function timeHHMM(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function addMinutes(dateMs: number, minutes: number) {
  return dateMs + minutes * 60_000;
}

function clampDuration(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_DURATION;
  if (value <= 0) return DEFAULT_DURATION;
  return Math.min(24 * 60, Math.round(value));
}

// overlap real: [aStart, aEnd) vs [bStart, bEnd)
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

function msToHHMM(ms: number) {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
        userSelect: "none",
        WebkitTapHighlightColor: "transparent",
        opacity: disabled ? 0.65 : 1,
      }}
    >
      {children}
    </button>
  );
}

type Banner =
  | null
  | {
      kind: "error";
      title: string;
      message: string;
      actionLabel?: string;
      onAction?: () => void;
    }
  | {
      kind: "info";
      title: string;
      message: string;
      actionLabel?: string;
      onAction?: () => void;
    };

/** Suspense wrapper para useSearchParams */
function SchedulePageInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [stylists] = useState<Stylist[]>(() => {
    try {
      const raw =
        typeof window !== "undefined"
          ? window.localStorage.getItem(STORAGE_KEY_STYLISTS)
          : null;
      if (!raw) return DEFAULT_STYLISTS;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as Stylist[];
      return DEFAULT_STYLISTS;
    } catch {
      return DEFAULT_STYLISTS;
    }
  });

  const urlDate = sp.get("date") || toYYYYMMDD(new Date());
  const [selectedDate, setSelectedDate] = useState(urlDate);

  useEffect(() => {
    if (urlDate !== selectedDate) setSelectedDate(urlDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlDate]);

  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<Banner>(null);

  const slots = useMemo(() => buildSlots(START_HOUR, END_HOUR, STEP_MIN), []);
  const dayBase = useMemo(() => new Date(`${selectedDate}T00:00:00`), [selectedDate]);

  const dayStartMs = useMemo(() => {
    const d = new Date(`${selectedDate}T00:00:00`);
    d.setHours(START_HOUR, 0, 0, 0);
    return d.getTime();
  }, [selectedDate]);

  const dayEndMs = useMemo(() => {
    const d = new Date(`${selectedDate}T00:00:00`);
    d.setHours(END_HOUR, 0, 0, 0);
    return d.getTime();
  }, [selectedDate]);

  const [quickDuration, setQuickDuration] = useState<number>(DEFAULT_DURATION);

  const [createOpen, setCreateOpen] = useState(false);
  const [createStylist, setCreateStylist] = useState<Stylist | null>(null);
  const [createHHMM, setCreateHHMM] = useState<string>("09:00");
  const [createDuration, setCreateDuration] = useState<number>(DEFAULT_DURATION);
  const [clientName, setClientName] = useState("");
  const [creating, setCreating] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editAppt, setEditAppt] = useState<Appointment | null>(null);
  const [editName, setEditName] = useState("");
  const [editHHMM, setEditHHMM] = useState("09:00");
  const [editDuration, setEditDuration] = useState<number>(DEFAULT_DURATION);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function loadDay(dateStr: string) {
    setBanner(null);
    setLoading(true);

    // ✅ Filtro robusto: [start, nextDayStart)
    const base = new Date(`${dateStr}T00:00:00`);
    const start = startOfDay(base);
    const nextDayStart = startOfDay(addDays(base, 1));

    const { data, error } = await supabase
      .from("appointments")
      .select("id,arrival_at,client_name,phase,stylist_name,stylist_color,duration_min")
      .gte("arrival_at", start.toISOString())
      .lt("arrival_at", nextDayStart.toISOString())
      .order("arrival_at", { ascending: true });

    if (error) {
      setBanner({
        kind: "error",
        title: "No se ha podido cargar",
        message: error.message,
      });
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

  const goToDate = (dateStr: string) => {
    router.push(`/agenda/schedule?date=${dateStr}`);
  };

  const openCreate = (s: Stylist, hhmm: string) => {
    setBanner(null);
    setCreateStylist(s);
    setCreateHHMM(hhmm);
    setCreateDuration(clampDuration(quickDuration));
    setClientName("");
    setCreateOpen(true);
  };

  const openEdit = (appt: Appointment) => {
    setBanner(null);
    setEditAppt(appt);
    setEditName(appt.client_name || "");
    setEditHHMM(timeHHMM(appt.arrival_at));
    setEditDuration(clampDuration(appt.duration_min ?? DEFAULT_DURATION));
    setEditOpen(true);
  };

  const intervalsByStylist = useMemo(() => {
    const map = new Map<string, { appt: Appointment; start: number; end: number }[]>();
    for (const s of stylists) map.set(s.name, []);

    for (const ap of items) {
      const name = ap.stylist_name || "";
      if (!name) continue;
      if (!map.has(name)) map.set(name, []);
      const start = new Date(ap.arrival_at).getTime();
      const dur = clampDuration(ap.duration_min ?? DEFAULT_DURATION);
      const end = addMinutes(start, dur);
      map.get(name)!.push({ appt: ap, start, end });
    }

    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => a.start - b.start);
      map.set(k, arr);
    }
    return map;
  }, [items, stylists]);

  function computeNewIntervalMs(dateStr: string, hhmm: string, durationMin: number) {
    const { H, M } = parseHHMM(hhmm);
    const start = new Date(`${dateStr}T00:00:00`);
    start.setHours(H, M, 0, 0);
    const s = start.getTime();
    const e = addMinutes(s, clampDuration(durationMin));
    return { s, e, iso: start.toISOString() };
  }

  function findOverlap(stylistName: string | null, newStart: number, newEnd: number, ignoreId?: string) {
    if (!stylistName) return null;
    const list = intervalsByStylist.get(stylistName) || [];
    for (const it of list) {
      if (ignoreId && it.appt.id === ignoreId) continue;
      if (overlaps(newStart, newEnd, it.start, it.end)) return it;
    }
    return null;
  }

  function findNextFreeStart(stylistName: string, fromStartMs: number, durationMin: number, ignoreId?: string) {
    const dur = clampDuration(durationMin);
    const latestStart = dayEndMs - dur;
    if (fromStartMs > latestStart) return null;

    const stepMs = STEP_MIN * 60_000;

    let t = fromStartMs;
    const offset = (t - dayStartMs) % stepMs;
    if (offset !== 0) t = t - offset;

    for (let cur = Math.max(t, dayStartMs); cur <= latestStart; cur += stepMs) {
      const end = addMinutes(cur, dur);
      const conflict = findOverlap(stylistName, cur, end, ignoreId);
      if (!conflict) return cur;
    }
    return null;
  }

  function canFitHere(stylistName: string, startMs: number, durationMin: number) {
    const dur = clampDuration(durationMin);
    const end = addMinutes(startMs, dur);
    if (startMs < dayStartMs) return false;
    if (end > dayEndMs) return false;
    const conflict = findOverlap(stylistName, startMs, end);
    return !conflict;
  }

  async function createAppointment() {
    if (!createStylist) return;

    const name = clientName.trim();
    if (!name) return;

    const dur = clampDuration(createDuration);
    const { s, e, iso } = computeNewIntervalMs(selectedDate, createHHMM, dur);

    if (s < dayStartMs || e > dayEndMs) {
      setBanner({
        kind: "error",
        title: "Fuera de horario",
        message: `La cita debe estar entre ${pad(START_HOUR)}:00 y ${pad(END_HOUR)}:00.`,
      });
      return;
    }

    const conflict = findOverlap(createStylist.name, s, e);
    if (conflict) {
      const next = findNextFreeStart(createStylist.name, s, dur);
      const conflictLabel = `${msToHHMM(conflict.start)}–${msToHHMM(conflict.end)}`;

      setBanner({
        kind: "error",
        title: "Se solapa",
        message: `Choca con “${conflict.appt.client_name}” (${conflictLabel}).`,
        actionLabel: next ? `Colocar a ${msToHHMM(next)}` : undefined,
        onAction: next
          ? () => {
              setBanner(null);
              setCreateHHMM(msToHHMM(next));
            }
          : undefined,
      });
      return;
    }

    setCreating(true);
    setBanner(null);

    try {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;

      const userId = authData.user?.id;
      if (!userId) throw new Error("No hay sesión");

      const tempId = `tmp_${Math.random().toString(16).slice(2)}`;

      const optimistic: Appointment = {
        id: tempId,
        client_name: name,
        arrival_at: iso,
        phase: "por_llegar",
        stylist_name: createStylist.name,
        stylist_color: createStylist.color,
        duration_min: dur,
      };

      setItems((prev) => [...prev, optimistic]);

      const { data, error } = await supabase
        .from("appointments")
        .insert({
          user_id: userId,
          client_name: name,
          arrival_at: iso,
          phase: "por_llegar",
          stylist_name: createStylist.name,
          stylist_color: createStylist.color,
          duration_min: dur,
        })
        .select("id,arrival_at,client_name,phase,stylist_name,stylist_color,duration_min")
        .single();

      if (error) {
        setItems((prev) => prev.filter((x) => x.id !== tempId));
        throw error;
      }

      setItems((prev) => prev.map((x) => (x.id === tempId ? (data as Appointment) : x)));
      setCreateOpen(false);

      setBanner({
        kind: "info",
        title: "Cita creada",
        message: `${name} · ${createStylist.name} · ${createHHMM} · ${dur} min`,
      });
    } catch (e: any) {
      setBanner({
        kind: "error",
        title: "Error creando cita",
        message: e?.message ?? "Error creando cita",
      });
    } finally {
      setCreating(false);
    }
  }

  async function saveEdit() {
    if (!editAppt) return;

    const name = editName.trim();
    if (!name) return;

    const dur = clampDuration(editDuration);
    const { s, e, iso } = computeNewIntervalMs(selectedDate, editHHMM, dur);

    if (s < dayStartMs || e > dayEndMs) {
      setBanner({
        kind: "error",
        title: "Fuera de horario",
        message: `La cita debe estar entre ${pad(START_HOUR)}:00 y ${pad(END_HOUR)}:00.`,
      });
      return;
    }

    const stylistName = editAppt.stylist_name ?? null;
    const conflict = findOverlap(stylistName, s, e, editAppt.id);

    if (conflict && stylistName) {
      const next = findNextFreeStart(stylistName, s, dur, editAppt.id);
      const conflictLabel = `${msToHHMM(conflict.start)}–${msToHHMM(conflict.end)}`;

      setBanner({
        kind: "error",
        title: "Se solapa",
        message: `Choca con “${conflict.appt.client_name}” (${conflictLabel}).`,
        actionLabel: next ? `Mover a ${msToHHMM(next)}` : undefined,
        onAction: next
          ? () => {
              setBanner(null);
              setEditHHMM(msToHHMM(next));
            }
          : undefined,
      });
      return;
    }

    setSaving(true);
    setBanner(null);

    const prev = items;
    setItems((cur) =>
      cur.map((x) => (x.id === editAppt.id ? { ...x, client_name: name, arrival_at: iso, duration_min: dur } : x))
    );

    const { error } = await supabase
      .from("appointments")
      .update({ client_name: name, arrival_at: iso, duration_min: dur })
      .eq("id", editAppt.id);

    if (error) {
      setItems(prev);
      setBanner({ kind: "error", title: "Error guardando", message: error.message });
      setSaving(false);
      return;
    }

    setSaving(false);
    setEditOpen(false);
    setEditAppt(null);

    setBanner({
      kind: "info",
      title: "Guardado",
      message: `${name} · ${editHHMM} · ${dur} min`,
    });
  }

  async function deleteFromEdit() {
    if (!editAppt) return;

    setDeleting(true);
    setBanner(null);

    const prev = items;
    const deletedLabel = `${editAppt.client_name} · ${timeHHMM(editAppt.arrival_at)}`;

    setItems((cur) => cur.filter((x) => x.id !== editAppt.id));

    const { error } = await supabase.from("appointments").delete().eq("id", editAppt.id);

    if (error) {
      setItems(prev);
      setBanner({ kind: "error", title: "Error eliminando", message: error.message });
      setDeleting(false);
      return;
    }

    setDeleting(false);
    setEditOpen(false);
    setEditAppt(null);

    setBanner({ kind: "info", title: "Eliminada", message: deletedLabel });
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

  const topBar: React.CSSProperties = {
    ...surface,
    padding: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    position: "sticky",
    top: 12,
    zIndex: 20,
  };

  const inputStyle: React.CSSProperties = {
    height: 38,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.22)",
    color: "rgba(255,255,255,0.95)",
    padding: "0 12px",
    fontWeight: 900,
    outline: "none",
  };

  const selectStyle: React.CSSProperties = {
    height: 38,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.22)",
    color: "rgba(255,255,255,0.95)",
    padding: "0 12px",
    fontWeight: 900,
    outline: "none",
    cursor: "pointer",
  };

  function blockGeometry(startMs: number, durationMin: number) {
    const dur = clampDuration(durationMin);
    const topMin = (startMs - dayStartMs) / 60_000;
    const top = (topMin / STEP_MIN) * ROW_H;
    const height = (dur / STEP_MIN) * ROW_H;
    return { top, height };
  }

  function clampToDay(startMs: number) {
    return Math.max(dayStartMs, Math.min(startMs, dayEndMs));
  }

  const gridTotalHeight = useMemo(() => {
    return (slots.length - 1) * ROW_H + ROW_H;
  }, [slots.length]);

  const slotMsList = useMemo(() => {
    const arr: { hhmm: string; ms: number }[] = [];
    for (const hhmm of slots) {
      const { H, M } = parseHHMM(hhmm);
      const d = new Date(`${selectedDate}T00:00:00`);
      d.setHours(H, M, 0, 0);
      arr.push({ hhmm, ms: d.getTime() });
    }
    return arr;
  }, [slots, selectedDate]);

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
            🗓️
          </div>

          <div>
            <div style={{ fontSize: 14, fontWeight: 980, letterSpacing: 0.2 }}>Dar hora</div>
            <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 850 }}>{dayTitle(selectedDate)}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={pill}>
            <SmallButton onClick={() => goToDate(toYYYYMMDD(addDays(new Date(`${selectedDate}T00:00:00`), -1)))}>
              ◀
            </SmallButton>

            <SmallButton onClick={() => goToDate(toYYYYMMDD(new Date()))} active>
              Hoy
            </SmallButton>

            <SmallButton onClick={() => goToDate(toYYYYMMDD(addDays(new Date(`${selectedDate}T00:00:00`), 1)))}>
              ▶
            </SmallButton>
          </div>

          <input
            type="date"
            value={selectedDate}
            onChange={(e) => {
              const v = e.target.value;
              if (v) goToDate(v);
            }}
            style={inputStyle}
            aria-label="Seleccionar fecha"
            title="Seleccionar fecha"
          />

          <div style={pill} title="Duración usada al pulsar en Libre">
            ⏱️
            <select
              value={quickDuration}
              onChange={(e) => setQuickDuration(parseInt(e.target.value, 10))}
              style={selectStyle}
            >
              {DURATION_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </div>

          <div style={{ ...pill, cursor: "pointer" }} onClick={() => router.push(`/agenda/month?date=${selectedDate}`)}>
            ✂️ Volver
          </div>
        </div>
      </div>

      {/* BANNER */}
      {banner ? (
        <div
          style={{
            ...surface,
            marginTop: 12,
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            border:
              banner.kind === "error"
                ? "1px solid rgba(239,68,68,0.28)"
                : "1px solid rgba(255,255,255,0.10)",
            background: banner.kind === "error" ? "rgba(239,68,68,0.10)" : "rgba(255,255,255,0.06)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 980, fontSize: 13 }}>
              {banner.kind === "error" ? "⚠️ " : "✅ "}
              {banner.title}
            </div>
            <div style={{ fontSize: 12, opacity: 0.88, fontWeight: 850, marginTop: 4 }}>{banner.message}</div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
            {banner.actionLabel && banner.onAction ? (
              <SmallButton onClick={banner.onAction} active>
                {banner.actionLabel}
              </SmallButton>
            ) : null}
            <SmallButton onClick={() => setBanner(null)}>Cerrar</SmallButton>
          </div>
        </div>
      ) : null}

      {/* GRID */}
      <div style={{ ...surface, marginTop: 12 }}>
        <div style={{ fontSize: 12, opacity: 0.78, fontWeight: 900 }}>
          Pulsa un hueco <b>Libre</b> para crear. Pulsa una <b>cita</b> para editar.
        </div>

        <div style={{ marginTop: 12, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <div
            style={{
              minWidth: 860,
              display: "grid",
              gridTemplateColumns: `110px repeat(${stylists.length}, minmax(${COL_MIN_W}px, 1fr))`,
              gap: 10,
              alignItems: "start",
            }}
          >
            {/* Header row */}
            <div style={{ ...pill, justifyContent: "center" }}>Hora</div>
            {stylists.map((s) => (
              <div key={s.id} style={{ ...pill, justifyContent: "center" }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: s.color,
                    boxShadow: "0 0 0 2px rgba(255,255,255,0.14)",
                  }}
                />
                {s.name}
              </div>
            ))}

            {/* Time column */}
            <div
              style={{
                position: "relative",
                height: gridTotalHeight,
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(0,0,0,0.12)",
                overflow: "hidden",
              }}
            >
              {slotMsList.map(({ hhmm }, idx) => {
                const y = idx * ROW_H;
                const isHour = hhmm.endsWith(":00");
                return (
                  <div
                    key={hhmm}
                    style={{
                      position: "absolute",
                      top: y,
                      left: 0,
                      right: 0,
                      height: ROW_H,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 950,
                      fontSize: isHour ? 12 : 11,
                      opacity: isHour ? 0.9 : 0.55,
                      borderTop: idx === 0 ? "none" : "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    {hhmm}
                  </div>
                );
              })}
            </div>

            {/* Each stylist column */}
            {stylists.map((s) => {
              const list = intervalsByStylist.get(s.name) || [];

              return (
                <div
                  key={s.id}
                  style={{
                    position: "relative",
                    height: gridTotalHeight,
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(0,0,0,0.12)",
                    overflow: "hidden",
                  }}
                >
                  {/* slot grid lines + “Libre” */}
                  {slotMsList.map(({ hhmm, ms }, idx) => {
                    const y = idx * ROW_H;
                    const isLast = idx === slotMsList.length - 1;
                    if (isLast) {
                      return (
                        <div
                          key={`${s.id}_${hhmm}`}
                          style={{
                            position: "absolute",
                            top: y,
                            left: 0,
                            right: 0,
                            height: ROW_H,
                            borderTop: idx === 0 ? "none" : "1px solid rgba(255,255,255,0.06)",
                          }}
                        />
                      );
                    }

                    const showFree = canFitHere(s.name, ms, quickDuration);

                    return (
                      <div
                        key={`${s.id}_${hhmm}`}
                        style={{
                          position: "absolute",
                          top: y,
                          left: 0,
                          right: 0,
                          height: ROW_H,
                          borderTop: idx === 0 ? "none" : "1px solid rgba(255,255,255,0.06)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "0 10px",
                          pointerEvents: "none",
                        }}
                      >
                        {showFree ? (
                          <button
                            type="button"
                            onClick={() => openCreate(s, hhmm)}
                            style={{
                              pointerEvents: "auto",
                              height: 32,
                              borderRadius: 999,
                              border: "1px solid rgba(255,255,255,0.10)",
                              background: "rgba(255,255,255,0.04)",
                              color: "rgba(255,255,255,0.78)",
                              fontWeight: 950,
                              fontSize: 12,
                              padding: "0 10px",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 8,
                            }}
                            title={`Crear ${quickDuration} min a las ${hhmm} (${s.name})`}
                          >
                            <span style={{ opacity: 0.85 }}>Libre</span>
                            <span style={{ opacity: 0.65 }}>+{quickDuration}’</span>
                          </button>
                        ) : null}

                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 999,
                            background: s.color,
                            opacity: 0.45,
                            flexShrink: 0,
                          }}
                        />
                      </div>
                    );
                  })}

                  {/* Appointment blocks */}
                  {list.map(({ appt, start, end }) => {
                    const dur = clampDuration(appt.duration_min ?? DEFAULT_DURATION);
                    const safeStart = clampToDay(start);
                    const { top, height } = blockGeometry(safeStart, dur);

                    const bg = "rgba(255,255,255,0.08)";
                    const border = "rgba(255,255,255,0.14)";

                    return (
                      <div
                        key={appt.id}
                        onClick={() => openEdit(appt)}
                        style={{
                          position: "absolute",
                          top: Math.max(0, top) + 6,
                          left: 10,
                          right: 10,
                          height: Math.max(42, height - 12),
                          borderRadius: 16,
                          border: `1px solid ${border}`,
                          background: bg,
                          boxShadow: "0 10px 20px rgba(0,0,0,0.25)",
                          cursor: "pointer",
                          overflow: "hidden",
                          display: "grid",
                          placeItems: "center",
                          padding: 10,
                        }}
                        title={`Editar · ${appt.client_name} · ${msToHHMM(start)}–${msToHHMM(end)}`}
                      >
                        <div
                          style={{
                            position: "absolute",
                            top: 8,
                            left: 8,
                            width: 10,
                            height: 10,
                            borderRadius: 999,
                            background: s.color,
                            boxShadow: "0 0 0 2px rgba(0,0,0,0.25)",
                          }}
                        />

                        <div style={{ textAlign: "center", minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 980,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              padding: "0 18px",
                            }}
                          >
                            {appt.client_name}
                          </div>

                          <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 900, marginTop: 6 }}>
                            {msToHHMM(start)}–{msToHHMM(end)} · {dur} min
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.70, fontWeight: 850 }}>
          Consejo: cambia la duración arriba (⏱️) y verás que “Libre” solo aparece donde cabe esa duración.
        </div>
      </div>

      {/* MODAL CREAR */}
      {createOpen && createStylist ? (
        <div
          onMouseDown={() => setCreateOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "grid",
            placeItems: "center",
            padding: 16,
            zIndex: 60,
          }}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: "min(560px, 100%)",
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
                <div style={{ fontSize: 16, fontWeight: 980 }}>Crear cita</div>
                <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 900 }}>
                  {dayTitle(selectedDate)} · {createHHMM} · {createStylist.name}
                </div>
              </div>
              <SmallButton onClick={() => setCreateOpen(false)}>Cerrar</SmallButton>
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Nombre (ej. Marta)"
                style={{
                  height: 46,
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(0,0,0,0.22)",
                  color: "rgba(255,255,255,0.95)",
                  padding: "0 12px",
                  fontWeight: 900,
                  outline: "none",
                  flex: "1 1 260px",
                }}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") createAppointment();
                  if (e.key === "Escape") setCreateOpen(false);
                }}
              />

              <select
                value={createDuration}
                onChange={(e) => setCreateDuration(parseInt(e.target.value, 10))}
                style={{
                  height: 46,
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(0,0,0,0.22)",
                  color: "rgba(255,255,255,0.95)",
                  padding: "0 12px",
                  fontWeight: 900,
                  outline: "none",
                  cursor: "pointer",
                  width: 150,
                }}
                title="Duración"
              >
                {DURATION_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <SmallButton onClick={() => setCreateOpen(false)}>Cancelar</SmallButton>
              <SmallButton onClick={createAppointment} active disabled={creating || clientName.trim().length === 0}>
                {creating ? "Creando…" : "Crear"}
              </SmallButton>
            </div>

            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75, fontWeight: 900 }}>
              Solape real por intervalo (hora + duración) + sugerencia automática del siguiente hueco.
            </div>
          </div>
        </div>
      ) : null}

      {/* MODAL EDITAR */}
      {editOpen && editAppt ? (
        <div
          onMouseDown={() => {
            setEditOpen(false);
            setEditAppt(null);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "grid",
            placeItems: "center",
            padding: 16,
            zIndex: 70,
          }}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: "min(600px, 100%)",
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
                <div style={{ fontSize: 16, fontWeight: 980 }}>Editar cita</div>
                <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 900 }}>
                  {dayTitle(selectedDate)} · {editAppt.stylist_name ?? "—"}
                </div>
              </div>
              <SmallButton
                onClick={() => {
                  setEditOpen(false);
                  setEditAppt(null);
                }}
              >
                Cerrar
              </SmallButton>
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Nombre"
                style={{
                  height: 46,
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(0,0,0,0.22)",
                  color: "rgba(255,255,255,0.95)",
                  padding: "0 12px",
                  fontWeight: 900,
                  outline: "none",
                  flex: "1 1 260px",
                }}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEdit();
                  if (e.key === "Escape") {
                    setEditOpen(false);
                    setEditAppt(null);
                  }
                }}
              />

              <input
                value={editHHMM}
                onChange={(e) => setEditHHMM(e.target.value)}
                placeholder="HH:MM"
                inputMode="numeric"
                style={{
                  width: 120,
                  height: 46,
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(0,0,0,0.22)",
                  color: "rgba(255,255,255,0.95)",
                  padding: "0 12px",
                  fontWeight: 900,
                  outline: "none",
                  textAlign: "center",
                }}
              />

              <select
                value={editDuration}
                onChange={(e) => setEditDuration(parseInt(e.target.value, 10))}
                style={{
                  height: 46,
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(0,0,0,0.22)",
                  color: "rgba(255,255,255,0.95)",
                  padding: "0 12px",
                  fontWeight: 900,
                  outline: "none",
                  cursor: "pointer",
                  width: 150,
                }}
                title="Duración"
              >
                {DURATION_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <SmallButton danger onClick={deleteFromEdit} disabled={deleting}>
                {deleting ? "Eliminando…" : "Eliminar"}
              </SmallButton>

              <div style={{ display: "flex", gap: 10 }}>
                <SmallButton
                  onClick={() => {
                    setEditOpen(false);
                    setEditAppt(null);
                  }}
                >
                  Cancelar
                </SmallButton>
                <SmallButton onClick={saveEdit} active disabled={saving || editName.trim().length === 0}>
                  {saving ? "Guardando…" : "Guardar"}
                </SmallButton>
              </div>
            </div>

            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75, fontWeight: 900 }}>
              Si se solapa, te propondrá moverla al siguiente hueco libre.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function SchedulePage() {
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
          Cargando…
        </div>
      }
    >
      <SchedulePageInner />
    </Suspense>
  );
}
