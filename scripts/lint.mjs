import { spawn } from "node:child_process"
import path from "node:path"

console.log("Running repository validation (TypeScript-backed lint gate)...")

const tscEntry = path.join(process.cwd(), "node_modules", "typescript", "bin", "tsc")

const child = spawn(process.execPath, [tscEntry, "--noEmit"], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: process.env,
})

child.on("close", (code) => {
  process.exit(code ?? 1)
})

child.on("error", (error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
