import fs from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { loadDotEnv } from "./load-env.mjs"

loadDotEnv()

const OUT_DIR = path.join(process.cwd(), "data")
const OUT_FILE = path.join(OUT_DIR, "twinfun-browser-capture.json")
const TARGET_URL = "https://twin.fun/twins"
const INDEXER_URL = "https://twinindexer.memchat.io/subgraphs/name/digital"
const EXECUTABLE_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
]

function parseArgs() {
  const args = new Map()
  for (const entry of process.argv.slice(2)) {
    const [key, value] = entry.split("=")
    args.set(key, value ?? "true")
  }
  return args
}

async function launchBrowser() {
  const args = parseArgs()
  const channel = args.get("--channel") || process.env.PLAYWRIGHT_BROWSER_CHANNEL || "chrome"
  const explicitExecutable = process.env.PLAYWRIGHT_EXECUTABLE_PATH
  if (explicitExecutable) {
    return chromium.launch({
      executablePath: explicitExecutable,
      headless: true,
    })
  }

  for (const executablePath of EXECUTABLE_CANDIDATES) {
    try {
      await fs.access(executablePath)
      return chromium.launch({
        executablePath,
        headless: true,
      })
    } catch {
      // try next path
    }
  }

  try {
    return await chromium.launch({
      channel,
      headless: true,
    })
  } catch {
    return chromium.launch({
      headless: true,
    })
  }
}

async function main() {
  const browser = await launchBrowser()
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  })

  let captured = null

  page.on("response", async (response) => {
    const request = response.request()
    if (request.method() !== "POST") return
    if (!response.url().startsWith(INDEXER_URL)) return
    try {
      const postData = request.postDataJSON?.() ?? null
      const body = await response.json()
      captured = {
        capturedAt: new Date().toISOString(),
        pageUrl: TARGET_URL,
        requestUrl: response.url(),
        status: response.status(),
        operationName: postData?.operationName ?? null,
        requestBody: postData,
        responseBody: body,
      }
    } catch {
      // ignore parse errors and keep listening
    }
  })

  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 120000 })
  await page.waitForTimeout(15000)

  if (!captured) {
    throw new Error("No Twin.fun twins payload was captured from browser traffic.")
  }

  await fs.mkdir(OUT_DIR, { recursive: true })
  await fs.writeFile(OUT_FILE, JSON.stringify(captured, null, 2), "utf8")
  console.log(`Captured payload written to ${OUT_FILE}`)

  await browser.close()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
