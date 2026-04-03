import fs from "node:fs/promises"
import path from "node:path"
import pg from "pg"
import { loadDotEnv } from "./load-env.mjs"

loadDotEnv()

const { Pool } = pg
const DATABASE_URL = process.env.DATABASE_URL
const MIGRATIONS_DIR = path.join(process.cwd(), "migrations")

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required.")
  process.exit(1)
}

async function listMigrationFiles() {
  const entries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
}

async function ensureMigrationsTable(pool) {
  await pool.query(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    );
  `)
}

async function getAppliedMigrationIds(pool) {
  const result = await pool.query(`select id from schema_migrations order by id asc`)
  return new Set(result.rows.map((row) => String(row.id)))
}

async function applyMigration(pool, fileName) {
  const filePath = path.join(MIGRATIONS_DIR, fileName)
  const sql = await fs.readFile(filePath, "utf8")
  await pool.query("begin")
  try {
    await pool.query(sql)
    await pool.query(`insert into schema_migrations (id) values ($1) on conflict (id) do nothing`, [
      fileName,
    ])
    await pool.query("commit")
    console.log(`Applied ${fileName}`)
  } catch (error) {
    await pool.query("rollback")
    throw error
  }
}

async function main() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
  })

  try {
    await ensureMigrationsTable(pool)
    const [files, applied] = await Promise.all([listMigrationFiles(), getAppliedMigrationIds(pool)])

    for (const fileName of files) {
      if (applied.has(fileName)) {
        continue
      }

      await applyMigration(pool, fileName)
    }

    console.log("Database migrations are up to date.")
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
