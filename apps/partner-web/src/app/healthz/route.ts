/**
 * Liveness for the hosting platform's probe: this Next.js server answers.
 *
 * Deliberately no backend call — a backend outage must not make the platform restart healthy web
 * servers (the backend has its own /livez and /readyz). Never cached.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "alive", app: "partner-web" }, { headers: { "cache-control": "no-store" } });
}
