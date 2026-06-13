import { writeFile } from "node:fs/promises";
import { getSnapshot } from "../server/worldCupProvider.ts";

const snapshot = await getSnapshot();

if (snapshot.status !== "ready") {
  throw new Error(`Cannot generate static snapshot: ${snapshot.providerStatus.message}`);
}

await writeFile("public/worldcup-snapshot.json", `${JSON.stringify(snapshot)}\n`);
console.log(`Generated public/worldcup-snapshot.json with ${snapshot.groups.length} groups and ${snapshot.fixtures.length} fixtures.`);
