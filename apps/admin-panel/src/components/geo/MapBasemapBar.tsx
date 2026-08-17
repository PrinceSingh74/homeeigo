"use client";

import { Map, Mountain, Satellite } from "lucide-react";

export type BasemapId = "map" | "satellite" | "terrain";

const OPTIONS: Array<{ id: BasemapId; label: string; icon: typeof Map }> = [
  { id: "map", label: "Map", icon: Map },
  { id: "satellite", label: "Satellite", icon: Satellite },
  { id: "terrain", label: "Terrain", icon: Mountain },
];

export function googleMapTypeId(g: { maps: { MapTypeId: Record<string, string> } }, basemap: BasemapId) {
  if (basemap === "satellite") return g.maps.MapTypeId.HYBRID;
  if (basemap === "terrain") return g.maps.MapTypeId.TERRAIN;
  return g.maps.MapTypeId.ROADMAP;
}

export function MapBasemapBar({
  value,
  onChange,
}: {
  value: BasemapId;
  onChange: (id: BasemapId) => void;
}) {
  return (
    <div className="cmd-layer-bar gf-basemap-bar absolute right-3 top-3 z-20">
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={`cmd-layer-btn${value === option.id ? " is-on" : ""}`}
            aria-pressed={value === option.id}
          >
            <Icon size={13} />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
