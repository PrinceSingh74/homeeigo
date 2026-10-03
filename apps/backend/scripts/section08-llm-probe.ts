/**
 * Live LLM provider probe — no secrets logged.
 *   cd apps/backend && bun --env-file=.env run scripts/section08-llm-probe.ts
 */
import { invokeAiGateway, getAiHealth } from "../src/ai/gateway/ai-gateway";
import prisma from "../src/lib/prisma";

async function main() {
  const health = await getAiHealth();
  console.log(JSON.stringify({ health: { status: health.status, primary: health.primary, groq: health.groq?.health, gemini: health.gemini?.health } }));

  const user = await prisma.user.findFirst({ where: { email: "partner@homigo.demo" }, select: { id: true } });
  if (!user) throw new Error("partner not found");
  const provider = await prisma.provider.findFirst({ where: { userId: user.id }, select: { id: true } });
  if (!provider) throw new Error("provider not found");

  const t0 = Date.now();
  try {
    const r = await invokeAiGateway({
      actor: { actorId: user.id, actorRole: "PARTNER", ipAddress: "127.0.0.1", traceId: "s08-llm-probe" },
      endpoint: "partner",
      input: {
        message: "Give me one practical tip to stay productive on the platform today.",
        templateId: "partner.copilot.v1",
        context: { partnerId: provider.id, userId: user.id },
      },
      tools: { enabled: true, intent: "GENERAL", userRole: "VENDOR", allowWrites: false },
    });
    console.log(
      JSON.stringify({
        ok: true,
        provider: r.provider,
        model: r.model,
        fallbackUsed: r.fallbackUsed,
        latencyMs: Date.now() - t0,
        contentPreview: r.content?.slice(0, 120),
      }),
    );
  } catch (e) {
    const err = e as { code?: string; message?: string; status?: string };
    console.log(JSON.stringify({ ok: false, code: err.code, status: err.status, message: err.message?.slice(0, 200), latencyMs: Date.now() - t0 }));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
