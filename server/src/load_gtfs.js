import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const GTFS_DIR = path.resolve("GTFSExport");

// Load order doesn't matter (no foreign keys), but stop_times is last because it's the slowest
const TABLES = [
  "stops",
  "routes",
  "calendar",
  "calendar_dates",
  "shapes",
  "trips",
  "stop_times",
];

// Read a file's header row and detect its line endings
function readHeader(file) {
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.alloc(64 * 1024);
  const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
  fs.closeSync(fd);

  const text = buffer.toString("utf8", 0, bytesRead);
  const firstLine = text.split(/\r?\n/)[0].replace(/^\uFEFF/, ""); // strip invisible BOM if present
  const header = firstLine.split(",").map((h) => h.replace(/"/g, "").trim());
  const lineEnding = text.includes("\r\n") ? "\\r\\n" : "\\n";

  return { header, lineEnding };
}

async function loadTable(conn, table) {
  const file = path.join(GTFS_DIR, `${table}.txt`);
  if (!fs.existsSync(file)) {
    console.warn(`⚠️  ${table}.txt not found, skipping`);
    return;
  }

  // Which columns does the MySQL table actually have?
  const [cols] = await conn.query("SHOW COLUMNS FROM ??", [table]);
  const tableCols = new Set(cols.map((c) => c.Field));

  const { header, lineEnding } = readHeader(file);

  // Map each file column to a variable, or to @skip if the table doesn't have it
  const vars = header.map((h, i) => (tableCols.has(h) ? `@v${i}` : "@skip"));
  const sets = header
    .map((h, i) => (tableCols.has(h) ? `\`${h}\` = NULLIF(@v${i}, '')` : null))
    .filter(Boolean);

  const skipped = header.filter((h) => !tableCols.has(h));
  if (skipped.length)
    console.log(`   ${table}: skipping columns ${skipped.join(", ")}`);

  await conn.query(`TRUNCATE TABLE \`${table}\``);

  const sql = `
    LOAD DATA LOCAL INFILE ${conn.escape(file)}
    INTO TABLE \`${table}\`
    CHARACTER SET utf8mb4
    FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"'
    LINES TERMINATED BY '${lineEnding}'
    IGNORE 1 LINES
    (${vars.join(", ")})
    SET ${sets.join(", ")}
  `;

  const start = Date.now();
  const [result] = await conn.query({
    sql,
    infileStreamFactory: () => fs.createReadStream(file),
  });
  const seconds = ((Date.now() - start) / 1000).toFixed(1);

  console.log(
    `✅ ${table}: ${result.affectedRows.toLocaleString()} rows in ${seconds}s`,
  );

  if (result.warningStatus > 0) {
    const [warnings] = await conn.query("SHOW WARNINGS LIMIT 5");
    console.warn(`   ${result.warningStatus} warnings, first few:`, warnings);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL in .env");
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    flags: ["+LOCAL_FILES"],
  });

  try {
    for (const table of TABLES) {
      await loadTable(conn, table);
    }
    console.log("\nDone!");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("Load failed:", err.message);
  process.exit(1);
});
