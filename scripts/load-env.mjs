import fs from "node:fs"
import path from "node:path"

function parseLine(line) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith("#")) return null
  const separatorIndex = trimmed.indexOf("=")
  if (separatorIndex <= 0) return null
  const key = trimmed.slice(0, separatorIndex).trim()
  let value = trimmed.slice(separatorIndex + 1).trim()

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }

  return { key, value }
}

export function loadDotEnv() {
  const envFiles = [".env.local", ".env"]

  for (const fileName of envFiles) {
    const filePath = path.join(process.cwd(), fileName)
    if (!fs.existsSync(filePath)) continue

    const content = fs.readFileSync(filePath, "utf8")
    for (const line of content.split(/\r?\n/)) {
      const entry = parseLine(line)
      if (!entry) continue
      if (process.env[entry.key] === undefined) {
        process.env[entry.key] = entry.value
      }
    }
  }
}
