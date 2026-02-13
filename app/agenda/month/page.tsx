export const dynamic = "force-dynamic";

import React, { Suspense } from "react";
import MonthClient from "./MonthClient";

export default function AgendaMonthPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: "100vh",
            padding: 18,
            background: "rgba(10,10,12,1)",
            color: "rgba(255,255,255,0.92)",
          }}
        >
          Cargando mes…
        </div>
      }
    >
      <MonthClient />
    </Suspense>
  );
}
