import { AuroraBackground } from "@/components/AuroraBackground";

/** Aurora mesh for home, services, bookings, wallet — navbar lives in parent layout. */
export function AuroraNavShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuroraBackground />
      {children}
    </>
  );
}
