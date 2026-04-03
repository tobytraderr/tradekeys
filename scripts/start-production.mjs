import { spawn } from "node:child_process"
import path from "node:path"

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      ...options,
    })

    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`))
    })
  })
}

function shouldRunMigrations() {
  const value = (process.env.RUN_DB_MIGRATIONS_ON_START || "true").trim().toLowerCase()
  return ["1", "true", "yes", "on"].includes(value)
}

async function main() {
  if (shouldRunMigrations()) {
    await run(process.execPath, [path.join("scripts", "migrate.mjs")])
  }

  const nextBin = path.join("node_modules", "next", "dist", "bin", "next")
  const port = process.env.PORT || "3000"

  const child = spawn(process.execPath, [nextBin, "start", "-H", "0.0.0.0", "-p", port], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  })

  child.on("error", (error) => {
    console.error(error)
    process.exit(1)
  })

  child.on("close", (code) => {
    process.exit(code ?? 0)
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
