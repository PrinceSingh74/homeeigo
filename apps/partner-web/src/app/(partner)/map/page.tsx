import { LiveMapView } from "@/components/map/LiveMapView";

export default function MapPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Live map</h1>
        <p className="text-sm text-partner-muted">
          Navigation, customer pin, and route intelligence
        </p>
      </div>
      <LiveMapView />
    </div>
  );
}
