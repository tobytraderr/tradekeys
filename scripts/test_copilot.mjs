import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadDotEnv } from "./load-env.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, "..")

process.chdir(rootDir)
loadDotEnv()

const args = process.argv.slice(2)
const positionalArgs = args.filter((arg) => !arg.startsWith("-"))

function hasFlag(flag) {
  return args.includes(flag)
}

function getArgValue(name, fallback) {
  const index = args.indexOf(name)
  if (index === -1) return fallback
  return args[index + 1] ?? fallback
}

function getLimit() {
  const explicit = getArgValue("--limit", null)
  if (explicit !== null) {
    const parsed = Number(explicit)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 5
  }

  const equalsStyle = args.find((arg) => arg.startsWith("--limit="))
  if (equalsStyle) {
    const parsed = Number(equalsStyle.split("=")[1])
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 5
  }

  if (positionalArgs.length > 0) {
    const parsed = Number(positionalArgs[0])
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }

  return 5
}

function redactSecret(value) {
  if (!value) return null
  const trimmed = String(value).trim()
  if (trimmed.length <= 10) return `${trimmed.slice(0, 2)}***`
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`
}

function tryJsonParse(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

async function probePythonImport(pythonBin) {
  const code = [
    "import json",
    "import sys",
    "payload = {'executable': sys.executable, 'version': sys.version}",
    "try:",
    "    import opengradient as og",
    "    payload['import_ok'] = True",
    "    payload['module_file'] = getattr(og, '__file__', None)",
    "    payload['module_version'] = getattr(og, '__version__', None)",
    "except Exception as exc:",
    "    payload['import_ok'] = False",
    "    payload['error'] = str(exc)",
    "print(json.dumps(payload))",
  ].join("\n")

  return new Promise((resolve) => {
    const child = spawn(pythonBin, ["-c", code], {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    })

    let stdout = ""
    let stderr = ""

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    child.on("error", (error) => {
      resolve({ ok: false, error: error.message, stdout, stderr })
    })

    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        parsed: tryJsonParse(stdout.trim()),
      })
    })
  })
}

function loadTwinsPayload() {
  const inputFile = getArgValue("--input", null)
  if (inputFile) {
    const raw = fs.readFileSync(path.resolve(rootDir, inputFile), "utf8")
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : parsed.twins ?? []
  }

  const sampleFile = path.join(rootDir, "data", "twinfun-browser-capture.json")
  if (fs.existsSync(sampleFile)) {
    const raw = fs.readFileSync(sampleFile, "utf8")
    const parsed = JSON.parse(raw)
    const twins = parsed?.responseBody?.data?.digitalTwins ?? parsed?.data?.digitalTwins
    if (Array.isArray(twins)) {
      return twins.slice(0, getLimit())
    }
  }

  return []
}

async function runBridge() {
  const pythonBin = process.env.PYTHON_BIN || "python"
  const privateKey = process.env.OPENGRADIENT_PRIVATE_KEY || ""
  const prompt = getArgValue("--prompt", "Summarize the most active twins from the supplied context.")
  const importProbe = await probePythonImport(pythonBin)
  const rawTwins = hasFlag("--skip-twins") ? [] : loadTwinsPayload()

  const requestPayload = {
    prompt,
    twins: rawTwins,
  }

  console.log("== TradeKeys Copilot Debug ==")
  console.log(
    JSON.stringify(
      {
        cwd: rootDir,
        pythonBin,
        env: {
          OPENGRADIENT_PRIVATE_KEY: redactSecret(privateKey),
          PYTHON_BIN: process.env.PYTHON_BIN || null,
          DATABASE_URL: redactSecret(process.env.DATABASE_URL),
          SUBGRAPH_URL: process.env.SUBGRAPH_URL || null,
        },
        request: {
          promptLength: prompt.length,
          twinsCount: Array.isArray(rawTwins) ? rawTwins.length : 0,
          sampleTwinKeys:
            Array.isArray(rawTwins) && rawTwins.length > 0 && typeof rawTwins[0] === "object" && rawTwins[0] !== null
              ? Object.keys(rawTwins[0]).slice(0, 12)
              : [],
        },
        probes: {
          opengradientImport: importProbe,
        },
      },
      null,
      2
    )
  )

  if (hasFlag("--probe-only")) {
    return
  }

  const startedAt = Date.now()

  const result = await new Promise((resolve) => {
    const child = spawn(pythonBin, ["scripts/opengradient_copilot.py"], {
      cwd: rootDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        OPENGRADIENT_DEBUG: "1",
      },
    })

    let stdout = ""
    let stderr = ""

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
      if (hasFlag("--stream-stdout")) {
        process.stdout.write(`[bridge-stdout] ${chunk.toString()}`)
      }
    })

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
      process.stderr.write(`[bridge-stderr] ${chunk.toString()}`)
    })

    child.on("error", (error) => {
      resolve({
        ok: false,
        phase: "spawn",
        error: error.message,
        stdout,
        stderr,
      })
    })

    child.on("close", (code, signal) => {
      resolve({
        ok: code === 0,
        phase: "bridge",
        code,
        signal,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
        parsed: tryJsonParse(stdout.trim()),
      })
    })

    child.stdin.write(JSON.stringify(requestPayload))
    child.stdin.end()
  })

  console.log("== Bridge Result ==")
  console.log(JSON.stringify(result, null, 2))
}

runBridge().catch((error) => {
  console.error("Copilot debug script failed.")
  console.error(error)
  process.exitCode = 1
})
