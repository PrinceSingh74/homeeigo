import "../../src/load-env";
import prisma from "../../src/lib/prisma";
import { seedToolRegistry } from "../../src/ai-tools/registry/tool-registry";
const db=(process.env.DATABASE_URL??"").split("/").pop()?.split("?")[0]??"";
if(process.env.APP_ENV!=="staging"||!db.includes("staging")) throw new Error("staging only");
seedToolRegistry().then(async n=>{console.log("seeded tools:",n);await prisma.$disconnect();});
