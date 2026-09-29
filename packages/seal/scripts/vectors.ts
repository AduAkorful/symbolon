import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildVectors } from "./buildVectors.js";

const out = fileURLToPath(new URL("../vectors/v1.json", import.meta.url));
writeFileSync(out, `${JSON.stringify(await buildVectors(), null, 2)}\n`);
console.log(`wrote ${out}`);
