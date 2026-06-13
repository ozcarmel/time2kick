import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const files = [
  "src/App.tsx",
  "src/services/dataProviders.ts",
  "src/types.ts",
  "server/worldCupProvider.ts",
  "docs/AGENT_PLAN.md",
  ".env.example",
];

const forbidden = /\b(Host Seed|Tournament Seed|HSA|HSB|Demo data|VITE_DATA_MODE|worldCupSeed)\b|\bA2\b|\bB2\b/;
const root = dirname(dirname(fileURLToPath(import.meta.url)));

const failures = [];

for (const file of files) {
  const contents = await readFile(join(root, file), "utf8");
  if (forbidden.test(contents)) {
    failures.push(file);
  }
}

if (failures.length > 0) {
  console.error(`Forbidden fake World Cup placeholders found in: ${failures.join(", ")}`);
  process.exit(1);
}

console.log("No fake World Cup placeholders found.");
