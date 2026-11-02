import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import pg from "pg";
import bcrypt from "bcryptjs";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
function embedText(text) {
  const vector = Array.from({ length: 384 }, () => 0);
  const words = text.toLowerCase().match(/[a-z0-9+#.-]{2,}/g) ?? [];
  const features = [...words, ...words.slice(0,-1).map((word,i)=>`${word}_${words[i+1]}`)];
  for (const feature of features) { const digest=createHash("sha256").update(feature).digest(); vector[digest.readUInt32BE(0)%384]+=digest[4]%2?1:-1; }
  const norm = Math.sqrt(vector.reduce((sum,n)=>sum+n*n,0)) || 1;
  return `[${vector.map(n=>(n/norm).toFixed(6)).join(",")}]`;
}

try {
  await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
  await pool.query(await readFile(new URL("../database/seed.sql", import.meta.url), "utf8"));
  const passwordHash = await bcrypt.hash("demo1234", 12);
  await pool.query("UPDATE users SET password_hash=$1 WHERE login IN ('pratheek','akasha','rahuldev','megha')", [passwordHash]);
  const repos = await pool.query("SELECT repo_id,full_name,description,primary_language,topics,readme FROM repositories");
  for (const r of repos.rows) await pool.query("UPDATE repositories SET summary_embedding=$1::vector WHERE repo_id=$2", [embedText([r.full_name,r.description,r.primary_language,...r.topics,r.readme].join(" ")),r.repo_id]);
  const files = await pool.query("SELECT file_id,file_path,content_excerpt FROM repository_files");
  for (const f of files.rows) await pool.query("UPDATE repository_files SET content_embedding=$1::vector WHERE file_id=$2", [embedText(`${f.file_path} ${f.content_excerpt}`),f.file_id]);
  console.log(`Database ready: ${repos.rowCount} repositories and ${files.rowCount} searchable files.`);
} catch (error) { console.error(error); process.exitCode=1; }
finally { await pool.end(); }
