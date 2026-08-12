"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPinned, Plus, Trash2, Power, Loader2, Radio } from "lucide-react";
import { adminApi, type Geofence, type GeofenceInput } from "@/services/admin-api";

const EMPTY: GeofenceInput = { name: "", centerLat: 28.4595, centerLng: 77.095, radiusMeters: 500, city: "", state: "", zoneType: "SERVICE_ZONE" };
const inIndia = (lat: number, lng: number) => lat >= 6.5 && lat <= 37.5 && lng >= 67.5 && lng <= 97.5;

/** Admin > Geofences. Uses the existing /api/geo/geofences CRUD + /api/geo/geofence-events
 *  (geofence.service) — no new geofence logic. RBAC-gated (admin token). */
export default function GeofencesPage() {
  const qc = useQueryClient();
  const [city, setCity] = useState("");
  const [form, setForm] = useState<GeofenceInput>(EMPTY);
  const [selected, setSelected] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const list = useQuery({ queryKey: ["admin", "geofences", city], queryFn: () => adminApi.geofences.list({ city: city || undefined }) });
  const events = useQuery({ queryKey: ["admin", "geofence-events", selected], queryFn: () => adminApi.geofences.events({ geofenceId: selected!, limit: 50 }), enabled: !!selected });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "geofences"] });
  const createM = useMutation({ mutationFn: (b: GeofenceInput) => adminApi.geofences.create(b), onSuccess: () => { setForm(EMPTY); invalidate(); } });
  const toggleM = useMutation({ mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => adminApi.geofences.update(id, { isActive }), onSuccess: invalidate });
  const deleteM = useMutation({ mutationFn: (id: string) => adminApi.geofences.remove(id), onSuccess: () => { setSelected(null); invalidate(); } });

  const submit = () => {
    setErr("");
    if (form.name.trim().length < 2) return setErr("Name required");
    if (!inIndia(form.centerLat, form.centerLng)) return setErr("Centre must be inside India");
    if (form.radiusMeters <= 0 || form.radiusMeters > 100_000) return setErr("Radius must be 1–100000 m");
    // Duplicate prevention — same name+centre already exists.
    if ((list.data ?? []).some((g) => g.name.toLowerCase() === form.name.trim().toLowerCase() && Math.abs(g.centerLat - form.centerLat) < 1e-4 && Math.abs(g.centerLng - form.centerLng) < 1e-4))
      return setErr("A geofence with this name + centre already exists");
    createM.mutate({ ...form, name: form.name.trim() });
  };

  const geofences = list.data ?? [];
  const field =
    "w-full rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] px-3 py-2 text-sm text-[var(--color-biz-text)] placeholder:text-[var(--color-biz-muted)] outline-none transition focus:border-[var(--color-biz-accent)] focus:ring-2 focus:ring-[var(--color-biz-accent)]/25";
  const fieldLabel = "mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--color-biz-muted)]";

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-1">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-[var(--color-biz-text)] md:text-3xl">
            <MapPinned size={24} className="text-amber-400" /> Geofences
          </h1>
          <p className="mt-1 text-sm text-[var(--color-biz-muted)]">Define service coverage · society & premium zones · live entry/exit events</p>
        </div>
        <input placeholder="Filter by city…" value={city} onChange={(e) => setCity(e.target.value)}
          className="w-56 rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] px-3 py-2 text-sm text-[var(--color-biz-text)] placeholder:text-[var(--color-biz-muted)] outline-none focus:border-[var(--color-biz-accent)]" />
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Create form */}
        <div className="biz-card rounded-2xl p-5">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-[var(--color-biz-text)]">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--color-biz-accent-dim)] text-[var(--color-biz-accent)]"><Plus size={16} /></span>
            New geofence
          </h2>
          <div className="space-y-3">
            <div>
              <label className={fieldLabel}>Name</label>
              <input className={field} placeholder="e.g. DLF Camellias" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={fieldLabel}>Latitude</label><input className={field} type="number" step="0.0001" placeholder="28.4595" value={form.centerLat} onChange={(e) => setForm({ ...form, centerLat: Number(e.target.value) })} /></div>
              <div><label className={fieldLabel}>Longitude</label><input className={field} type="number" step="0.0001" placeholder="77.095" value={form.centerLng} onChange={(e) => setForm({ ...form, centerLng: Number(e.target.value) })} /></div>
            </div>
            <div>
              <label className={fieldLabel}>Radius (metres)</label>
              <input className={field} type="number" placeholder="500" value={form.radiusMeters} onChange={(e) => setForm({ ...form, radiusMeters: Number(e.target.value) })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={fieldLabel}>City</label><input className={field} placeholder="Bengaluru" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
              <div><label className={fieldLabel}>State</label><input className={field} placeholder="Karnataka" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>
            </div>
            <div>
              <label className={fieldLabel}>Zone type</label>
              <select className={field} value={form.zoneType} onChange={(e) => setForm({ ...form, zoneType: e.target.value })}>
                <option value="SERVICE_ZONE">Service zone</option>
                <option value="SOCIETY">Society</option>
                <option value="PREMIUM_AREA">Premium area</option>
                <option value="CITY">City</option>
              </select>
            </div>
            {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{err}</p>}
            <button onClick={submit} disabled={createM.isPending}
              className="w-full rounded-lg bg-[var(--color-biz-accent)] py-2.5 text-sm font-semibold text-zinc-950 shadow-lg shadow-amber-500/20 transition hover:brightness-110 disabled:opacity-50">
              {createM.isPending ? "Creating…" : "Create geofence"}
            </button>
          </div>
        </div>

        {/* List */}
        <div className="biz-card rounded-2xl p-5 lg:col-span-2">
          <h2 className="mb-4 text-base font-semibold text-[var(--color-biz-text)]">Geofences <span className="text-[var(--color-biz-muted)]">({geofences.length})</span></h2>
          {list.isLoading ? (
            <div className="flex items-center gap-2 p-6 text-[var(--color-biz-muted)]"><Loader2 className="animate-spin" /> Loading…</div>
          ) : (
            <div className="max-h-[30rem] space-y-2.5 overflow-auto pr-1">
              {geofences.map((g: Geofence) => (
                <div key={g.id} className={`rounded-xl border p-3.5 transition ${selected === g.id ? "border-[var(--color-biz-accent)] bg-[var(--color-biz-accent-dim)]" : "border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] hover:border-[var(--color-biz-accent)]/40"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <button onClick={() => setSelected(selected === g.id ? null : g.id)} className="min-w-0 text-left">
                      <span className="font-semibold text-[var(--color-biz-text)]">{g.name}</span>
                      <span className="ml-2 rounded bg-[var(--color-biz-elevated)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-biz-muted)]">{g.zoneType}</span>
                      <span className="mt-1 block text-xs text-[var(--color-biz-muted)]">{g.city ?? "—"} · {g.radiusMeters}m · {g.centerLat.toFixed(4)}, {g.centerLng.toFixed(4)}</span>
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${g.isActive ? "bg-emerald-500/15 text-emerald-300" : "bg-[var(--color-biz-elevated)] text-[var(--color-biz-muted)]"}`}>{g.isActive ? "Active" : "Off"}</span>
                      <button title="Toggle" onClick={() => toggleM.mutate({ id: g.id, isActive: !g.isActive })} className="rounded-md p-1.5 text-[var(--color-biz-muted)] transition hover:bg-[var(--color-biz-elevated)]"><Power size={15} className={g.isActive ? "text-emerald-400" : "text-[var(--color-biz-muted)]"} /></button>
                      <button title="Delete" onClick={() => deleteM.mutate(g.id)} className="rounded-md p-1.5 transition hover:bg-red-500/15"><Trash2 size={15} className="text-red-400" /></button>
                    </div>
                  </div>
                  {selected === g.id && (
                    <div className="mt-3 border-t border-[var(--color-biz-line)] pt-3">
                      <p className="mb-1.5 flex items-center gap-1 text-xs font-medium text-[var(--color-biz-muted)]"><Radio size={12} /> Entry / exit events</p>
                      {events.isLoading ? <p className="text-xs text-[var(--color-biz-muted)]">Loading…</p> : (events.data ?? []).length === 0 ? <p className="text-xs text-[var(--color-biz-muted)]">No events yet.</p> : (
                        <div className="max-h-40 space-y-1 overflow-auto">
                          {(events.data ?? []).map((ev) => (
                            <div key={ev.id} className="flex justify-between text-[11px]">
                              <span className={`font-semibold ${ev.eventType === "ENTER" ? "text-emerald-400" : "text-amber-300"}`}>{ev.eventType}</span>
                              <span className="text-[var(--color-biz-muted)]">{new Date(ev.createdAt).toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {geofences.length === 0 && <p className="rounded-xl border border-dashed border-[var(--color-biz-line)] p-6 text-center text-sm text-[var(--color-biz-muted)]">No geofences yet. Create one to define service coverage.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
