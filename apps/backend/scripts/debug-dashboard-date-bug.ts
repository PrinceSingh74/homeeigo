import "../src/load-env";

console.log("process.env.TZ:", process.env.TZ);
console.log("new Date() right now:", new Date().toString());
console.log("new Date().toISOString():", new Date().toISOString());

// Exact same loop as admin.service.ts dashboard()
const days = 7;
console.log("\nReproducing the exact loop from admin.service.ts:");
for (let i = days - 1; i >= 0; i--) {
  const d = new Date();
  d.setDate(d.getDate() - i);
  const start = new Date(d.setHours(0, 0, 0, 0));
  const end = new Date(d.setHours(23, 59, 59, 999));
  const dateStr = start.toISOString().slice(0, 10);
  console.log(`  i=${i}  dateStr=${dateStr}  start=${start.toISOString()}  end=${end.toISOString()}`);
}
