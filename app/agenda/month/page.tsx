"use client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toYYYYMMDD(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfMonth(d: Date) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfNextMonth(d: Date) {
  const x = new Date(d);
  x.setDate(1);
  x.setMonth(x.getMonth() + 1);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfCalendarGrid(month: Date) {
  const first = startOfMonth(month);
  const day = first.getDay();
  const mondayIndex = (day + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - mondayIndex);
  start.setHours(0, 0, 0, 0);
  return start;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function sameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function badgeForCount(n: number) {
  if (n >= 12) return { bg: "rgba(239,68,68,0.22)", border: "rgba(239,68,68,0.35)" };
  if (n >= 7) return { bg: "rgba(245,158,11,0.22)", border: "rgba(245,158,11,0.35)" };
  if (n >= 3) return { bg: "rgba(59,130,246,0.18)", border: "rgba(59,130,246,0.32)" };
  return { bg: "rgba(255,255,255,0.08)", border: "rgba(255,255,255,0.14)" };
}

/**
 * ✅ build-safe:
 * useSearchParams() dentro de Suspense
 */
function AgendaMonthInner() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const sp = useSearchParams();

  const [month, setMonth] = useState<Date>(() => {
    const q = sp.get("date"); // YYYY-MM-DD
    const base = q ? new Date(`${q}T00:00:00`) : new Date();
    base.setDate(1);
    base.setHours(0, 0, 0, 0);
    return base;
  });

  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const monthLabel = useMemo(() => {
    return month.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  }, [month]);

  const gridStart = useMemo(() => startOfCalendarGrid(month), [month]);

  const days = useMemo(() => {
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [gridStart]);

  useEffect(() => {
    async function loadMonth() {
      setLoading(true);
      setError(null);

      // ✅ filtro robusto: [monthStart, nextMonthStart)
      const from = startOfMonth(month).toISOString();
      const to = startOfNextMonth(month).toISOString();

      const { data, error } = await supabase
        .from("appointments")
        .select("arrival_at")
        .gte("arrival_at", from)
        .lt("arrival_at", to);

      if (error) {
        setError(error.message);
        setCounts({});
        setLoading(false);
        return;
      }

      const map: Record<string, number> = {};
      for (const row of data || []) {
        const iso = row.arrival_at as string;
        const d = new Date(iso);
        const key = toYYYYMMDD(d);
        map[key] = (map[key] || 0) + 1;
      }

      setCounts(map);
      setLoading(false);
    }

    loadMonth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const containerStyle: React.CSSProperties = {
    minHeight: "100vh",
    padding: 18,
    background:
      "radial-gradient(1200px 800px at 20% 10%, rgba(255,255,255,0.06), transparent 60%), rgba(10,10,12,1)",
    color: "rgba(255,255,255,0.92)",
  };

  const cardStyle: React.CSSProperties = {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.06)",
    padding: 14,
  };

  const btnStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.08)",
    color: "rgba(255,255,255,0.92)",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 12,
  };

  const btnPrimary: React.CSSProperties = {
    ...btnStyle,
    background: "rgba(255,255,255,0.12)",
  };

  // ✅ “día representativo” del mes para links
  const monthAnchorDate = useMemo(() => toYYYYMMDD(startOfMonth(month)), [month]);

  return (
    <div style={containerStyle}>
      <style>{`
        @media (max-width: 520px) {
          .monthHeader { padding: 12px !important; }
          .monthTitle { font-size: 18px !important; }
          .monthSubtitle { display: none !important; }

          .monthBtns button {
            padding: 7px 9px !important;
            border-radius: 11px !important;
            font-size: 12px !important;
          }

          .monthInfo { padding: 10px 12px !important; font-size: 12px !important; }
          .monthCard { padding: 10px !important; }

          .grid { gap: 6px !important; }
          .weekHdr { font-size: 11px !important; }

          .dayCell {
            padding: 8px !important;
            min-height: 58px !important;
            border-radius: 14px !important;
          }

          .dayNum { font-size: 12px !important; opacity: 0.9 !important; }

          .badge {
            font-size: 11px !important;
            padding: 3px 7px !important;
            min-width: 28px !important;
          }

          .badgeZero { display: none !important; }
          .dayText { display: none !important; }
          .todayTag { font-size: 10px !important; margin-top: 4px !important; opacity: 0.85 !important; }
          .legend { display: none !important; }
        }
      `}</style>

      {/* HEADER (STICKY) */}
      <div
        className="monthHeader"
        style={{
          ...cardStyle,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
          position: "sticky",
          top: 0,
          zIndex: 20,
          backdropFilter: "blur(10px)",
          background: "rgba(20,20,24,0.72)",
        }}
      >
        <div>
          <div className="monthTitle" style={{ fontSize: 20, fontWeight: 950, textTransform: "capitalize" }}>
            {monthLabel}
          </div>
          <div className="monthSubtitle" style={{ fontSize: 12, opacity: 0.78, marginTop: 4 }}>
            Pulsa un día para abrir “Dar hora”
          </div>
        </div>

        <div className="monthBtns" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            style={btnStyle}
            onClick={() => {
              const x = new Date(month);
              x.setMonth(x.getMonth() - 1);
              x.setDate(1);
              x.setHours(0, 0, 0, 0);
              setMonth(x);
            }}
          >
            ◀ Mes
          </button>

          <button
            style={btnPrimary}
            onClick={() => {
              const now = new Date();
              now.setDate(1);
              now.setHours(0, 0, 0, 0);
              setMonth(now);
            }}
          >
            Actual
          </button>

          <button
            style={btnStyle}
            onClick={() => {
              const x = new Date(month);
              x.setMonth(x.getMonth() + 1);
              x.setDate(1);
              x.setHours(0, 0, 0, 0);
              setMonth(x);
            }}
          >
            Mes ▶
          </button>

          <button style={btnPrimary} onClick={() => router.push(`/agenda/schedule?date=${toYYYYMMDD(new Date())}`)}>
            Ir a hoy
          </button>

          <button style={btnStyle} onClick={() => router.push(`/agenda?date=${monthAnchorDate}`)}>
            Vista diaria
          </button>
        </div>
      </div>

      {/* INFO */}
      <div className="monthInfo" style={{ marginTop: 12, ...cardStyle }}>
        {loading ? (
          <div style={{ fontSize: 13, opacity: 0.8, fontWeight: 900 }}>Cargando ocupación…</div>
        ) : error ? (
          <div style={{ fontSize: 13, fontWeight: 900, color: "rgba(255,120,120,0.95)" }}>{error}</div>
        ) : (
          <div style={{ fontSize: 13, opacity: 0.85, fontWeight: 900 }}>
            Ocupación por día: número de citas guardadas
          </div>
        )}
      </div>

      {/* CALENDARIO */}
      <div
        className="monthCard"
        style={{
          marginTop: 12,
          ...cardStyle,
          maxHeight: "calc(100vh - 210px)",
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <div className="grid" style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 8 }}>
          {["L", "M", "X", "J", "V", "S", "D"].map((w) => (
            <div
              key={w}
              className="weekHdr"
              style={{ fontSize: 12, opacity: 0.75, fontWeight: 950, textAlign: "center" }}
            >
              {w}
            </div>
          ))}
        </div>

        <div style={{ height: 10 }} />

        <div className="grid" style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 8 }}>
          {days.map((d) => {
            const key = toYYYYMMDD(d);
            const n = counts[key] || 0;
            const inMonth = sameMonth(d, month);

            const isToday = key === toYYYYMMDD(new Date());
            const badge = badgeForCount(n);

            return (
              <button
                key={key}
                onClick={() => router.push(`/agenda/schedule?date=${key}`)}
                className="dayCell"
                style={{
                  textAlign: "left",
                  borderRadius: 16,
                  border: isToday ? "1px solid rgba(255,255,255,0.26)" : "1px solid rgba(255,255,255,0.10)",
                  background: inMonth ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)",
                  padding: 10,
                  minHeight: 94,
                  cursor: "pointer",
                  opacity: inMonth ? 1 : 0.55,
                  transition: "transform 120ms ease, border 120ms ease, background 120ms ease",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)";
                  (e.currentTarget as HTMLButtonElement).style.background = inMonth
                    ? "rgba(255,255,255,0.07)"
                    : "rgba(255,255,255,0.03)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
                  (e.currentTarget as HTMLButtonElement).style.background = inMonth
                    ? "rgba(255,255,255,0.05)"
                    : "rgba(255,255,255,0.02)";
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                  <div className="dayNum" style={{ fontSize: 14, fontWeight: 950 }}>
                    {d.getDate()}
                  </div>

                  <div
                    className={`badge ${n === 0 ? "badgeZero" : ""}`}
                    style={{
                      fontSize: 12,
                      fontWeight: 950,
                      padding: "4px 8px",
                      borderRadius: 999,
                      border: `1px solid ${badge.border}`,
                      background: badge.bg,
                      color: "rgba(255,255,255,0.92)",
                      minWidth: 38,
                      textAlign: "center",
                    }}
                    title="Número de citas"
                  >
                    {n}
                  </div>
                </div>

                <div className="dayText" style={{ marginTop: 8, fontSize: 12, opacity: 0.78, fontWeight: 900 }}>
                  {n === 0 ? "Libre" : n === 1 ? "1 cita" : `${n} citas`}
                </div>

                {isToday ? (
                  <div className="todayTag" style={{ marginTop: 6, fontSize: 11, opacity: 0.9, fontWeight: 950 }}>
                    Hoy
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="legend" style={{ marginTop: 14, fontSize: 12, opacity: 0.75, fontWeight: 900 }}>
          Colores ocupación: <span style={{ opacity: 0.85 }}>3+</span> · <span style={{ opacity: 0.85 }}>7+</span> ·{" "}
          <span style={{ opacity: 0.85 }}>12+</span>
        </div>
      </div>
    </div>
  );
}

export default function AgendaMonthPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: "100vh", padding: 18, background: "rgba(10,10,12,1)", color: "rgba(255,255,255,0.92)" }}>
          Cargando mes…
        </div>
      }
    >
      <AgendaMonthInner />
    </Suspense>
  );
}
