/**
 * Convert docs/query.csv (ContractReview dump) into docs/query.sql multi-row INSERTs.
 * Run: npx tsx scripts/queryCsvToSql.ts
 */
import { readFileSync, writeFileSync } from "node:fs";

const INPUT = "docs/query.csv";
const OUTPUT = "docs/query.sql";
const TABLE = "ContractReview";
const CHUNK = 500; // rows per INSERT

// Postgres text[] columns: CSV holds JSON arrays ("[]", ["ID26Y-47"]), not array literals.
const ARRAY_COLS = new Set(["offerNumber", "inspectionNumber", "diDate", "orderList"]);

// Hand-rolled RFC4180 reader: xlsx/sheet libs coerce dates and numbers, losing the
// exact strings this all-text table round-trips.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') (field += '"'), i++;
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") (row.push(field), (field = ""));
    else if (ch === "\n") (row.push(field), rows.push(row), (row = []), (field = ""));
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length) (row.push(field), rows.push(row));
  return rows;
}

const [header, ...data] = parseCsv(readFileSync(INPUT, "utf8").replace(/^\uFEFF/, ""));
const cols = header.map((c) => c.trim());

const lit = (v: string) => (v === "" ? "NULL" : `'${v.replace(/'/g, "''")}'`);
const val = (col: string, v: string) =>
  ARRAY_COLS.has(col)
    ? `ARRAY[${(v.trim() ? (JSON.parse(v) as string[]) : []).map(lit).join(", ")}]::text[]`
    : lit(v);

const rows = data
  .filter((r) => r.some((c) => c !== ""))
  .map((r) => {
    if (r.length !== cols.length) throw new Error(`row ${r[0]} has ${r.length} fields, expected ${cols.length}`);
    return `  (${cols.map((c, i) => val(c, r[i])).join(", ")})`;
  });

const head = `INSERT INTO "${TABLE}" ("${cols.join('", "')}")`;
const stmts: string[] = [];
for (let i = 0; i < rows.length; i += CHUNK) {
  stmts.push(`${head}\nVALUES\n${rows.slice(i, i + CHUNK).join(",\n")};`);
}

writeFileSync(OUTPUT, stmts.join("\n\n") + "\n");
console.log(`${rows.length} rows -> ${OUTPUT} (${stmts.length} INSERT statement(s))`);
