import { NextResponse } from "next/server"
import {
  attachWalletSessionCookie,
  buildWalletSessionErrorResponse,
  clearWalletSessionCookie,
  createWalletChallenge,
  getWalletSessionStatus,
  verifyWalletChallenge,
} from "@/lib/server/wallet-session"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const account = url.searchParams.get("account")?.trim()
  const status = await getWalletSessionStatus(request, account)
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { account?: string } | null

  try {
    const challenge = createWalletChallenge(request, body?.account?.trim() ?? "")
    return NextResponse.json(challenge, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return buildWalletSessionErrorResponse(
      400,
      error instanceof Error ? error.message : "Failed to create wallet verification challenge."
    )
  }
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { account?: string; nonce?: string; signature?: string }
    | null

  try {
    const session = await verifyWalletChallenge({
      account: body?.account?.trim() ?? "",
      nonce: body?.nonce?.trim() ?? "",
      signature: body?.signature?.trim() ?? "",
    })
    const response = NextResponse.json(
      {
        authenticated: true,
        account: session.account,
        expiresAt: session.expiresAt,
      },
      { headers: { "Cache-Control": "no-store" } }
    )
    attachWalletSessionCookie(response, { token: session.token, request })
    return response
  } catch (error) {
    return buildWalletSessionErrorResponse(
      400,
      error instanceof Error ? error.message : "Wallet verification failed."
    )
  }
}

export async function DELETE(request: Request) {
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
  await clearWalletSessionCookie(response, request)
  return response
}
