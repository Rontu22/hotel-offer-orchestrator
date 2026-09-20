"use client";

import { useTransition } from "react";
import { SUPPLIER_IDS, setSupplierAvailability, type Check, type HealthReport, type SupplierId } from "@/lib/hotels";

const DOT: Record<Check["status"], string> = { up: "bg-emerald-500", down: "bg-red-500" };

const BANNER: Record<HealthReport["status"], string> = {
  ok: "border-emerald-500/40 bg-emerald-500/5",
  degraded: "border-amber-500/50 bg-amber-500/5",
  unhealthy: "border-red-500/50 bg-red-500/5",
};

const LABELS: Record<SupplierId, string> = { supplierA: "Supplier A", supplierB: "Supplier B" };

export function HealthPanel({ health, onChanged }: { health: HealthReport | null; onChanged: () => void }) {
  const [pending, startTransition] = useTransition();

  if (!health) {
    return (
      <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/5 p-4 text-sm text-red-600 dark:text-red-400">
        Health endpoint unreachable — is the API running?
      </p>
    );
  }

  const toggle = (supplier: SupplierId, available: boolean) =>
    startTransition(async () => {
      await setSupplierAvailability(supplier, available);
      onChanged();
    });

  return (
    <section className={`rounded-lg border p-4 ${BANNER[health.status]}`} aria-label="System health">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">
          System health: <span className="uppercase tracking-wide">{health.status}</span>
        </h2>
        <span className="text-xs opacity-50">{new Date(health.checkedAt).toLocaleTimeString()}</span>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        <li className="flex items-center gap-3 text-sm">
          <Status name="Redis" check={health.redis} />
        </li>
        <li className="flex items-center gap-3 text-sm">
          <Status name="Temporal" check={health.temporal} />
        </li>

        {SUPPLIER_IDS.map((id) => {
          const down = health.suppliers[id].status === "down";
          return (
            <li key={id} className="flex items-center justify-between gap-3 text-sm">
              <Status name={LABELS[id]} check={health.suppliers[id]} />
              <button
                type="button"
                disabled={pending}
                onClick={() => toggle(id, down)}
                className="rounded border border-current/25 px-2 py-0.5 text-xs font-medium opacity-70 transition-opacity hover:opacity-100 disabled:opacity-40"
              >
                {down ? "Bring up" : "Take down"}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Status({ name, check }: { name: string; check: Check }) {
  return (
    <span className="flex items-center gap-2">
      <span className={`size-2 shrink-0 rounded-full ${DOT[check.status]}`} aria-hidden />
      <span>{name}</span>
      <span className="text-xs opacity-50">
        {check.status === "up" ? `${check.latencyMs}ms` : (check.error ?? "down")}
      </span>
    </span>
  );
}
