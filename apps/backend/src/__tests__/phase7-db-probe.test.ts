import { describe, it, expect } from "bun:test";
import prisma from "../lib/prisma";

describe("DB connection probe", () => {
  it("reports what bun test actually connects to", async () => {
    const info = await prisma.$queryRawUnsafe<any[]>(
      `SELECT current_database() as db, inet_server_port() as port, inet_server_addr()::text as addr`,
    );
    console.log("CONNECTED TO:", JSON.stringify(info));

    const exists = await prisma.$queryRawUnsafe<any[]>(
      `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name='vision_images') as exists`,
    );
    console.log("vision_images exists (from bun test):", JSON.stringify(exists));

    expect(info).toBeTruthy();
  });
});
