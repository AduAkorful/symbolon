import { migrateDb } from "./index.js";

// Applies the generated migrations to the database at DATABASE_URL. Run it before a deploy that changes the schema.
const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
await migrateDb(url);
console.log("Migrations applied.");
