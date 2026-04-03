import asyncio
import inspect
import json
import os
import sys
import traceback
from dataclasses import asdict, dataclass
from typing import Any

try:
    import opengradient as og
except ImportError as exc:  # pragma: no cover
    print(json.dumps({"provider": "opengradient", "content": "OpenGradient Python SDK is not installed.", "error": str(exc)}))
    sys.exit(1)


@dataclass
class OpenGradientChatResult:
    provider: str
    content: str
    modelName: str
    settlementMode: str
    transactionHash: str | None = None
    paymentHash: str | None = None
    teeId: str | None = None
    teeEndpoint: str | None = None
    teePaymentAddress: str | None = None
    teeSignature: str | None = None
    teeTimestamp: int | None = None
    finishReason: str | None = None


def _debug_enabled() -> bool:
    return (os.environ.get("OPENGRADIENT_DEBUG") or "").strip().lower() in {"1", "true", "yes", "on"}


def _debug(message: str, payload: Any | None = None) -> None:
    if not _debug_enabled():
        return

    if payload is None:
        print(f"[opengradient-debug] {message}", file=sys.stderr)
        return

    try:
        serialized = json.dumps(_serialize(payload))
    except Exception:
        serialized = repr(payload)
    print(f"[opengradient-debug] {message}: {serialized}", file=sys.stderr)


def _serialize(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
      return value
    if isinstance(value, dict):
      return {str(key): _serialize(val) for key, val in value.items()}
    if isinstance(value, (list, tuple, set)):
      return [_serialize(item) for item in value]
    if hasattr(value, "model_dump"):
      try:
        return _serialize(value.model_dump())
      except Exception:
        pass
    if hasattr(value, "__dict__"):
      try:
        return {str(key): _serialize(val) for key, val in vars(value).items() if not str(key).startswith("_")}
      except Exception:
        pass
    return repr(value)


def _deep_get(payload: Any, *paths: tuple[str, ...]) -> Any:
    node = _serialize(payload)
    for path in paths:
        current = node
        found = True
        for key in path:
            if isinstance(current, dict):
                match = None
                for existing_key, existing_value in current.items():
                    if str(existing_key).lower() == key.lower():
                        match = existing_value
                        break
                if match is None:
                    found = False
                    break
                current = match
            else:
                found = False
                break
        if found:
            return current
    return None


def _ensure_opg_approval(llm: Any) -> None:
    if not hasattr(llm, "ensure_opg_approval"):
        return

    method = llm.ensure_opg_approval
    attempts: list[tuple[str, callable]] = []

    try:
        signature = inspect.signature(method)
        params = list(signature.parameters.values())
        _debug(
            "ensure_opg_approval_signature",
            {
                "parameters": [param.name for param in params],
            },
        )
        if any(param.name == "opg_amount" for param in params):
            attempts.append(("keyword_opg_amount", lambda: method(opg_amount=0.1)))
        if len(params) >= 1:
            attempts.append(("positional_amount", lambda: method(0.1)))
        attempts.append(("no_args", lambda: method()))
    except Exception as exc:
        _debug(
            "ensure_opg_approval_signature_error",
            {
                "error_type": type(exc).__name__,
                "error_message": str(exc),
            },
        )
        attempts = [
            ("keyword_opg_amount", lambda: method(opg_amount=0.1)),
            ("positional_amount", lambda: method(0.1)),
            ("no_args", lambda: method()),
        ]

    seen: set[str] = set()
    for label, attempt in attempts:
        if label in seen:
            continue
        seen.add(label)
        try:
            _debug("ensure_opg_approval_attempt", {"mode": label})
            attempt()
            _debug("ensure_opg_approval_success", {"mode": label})
            return
        except TypeError as exc:
            _debug(
                "ensure_opg_approval_type_error",
                {
                    "mode": label,
                    "error_message": str(exc),
                },
            )
            continue

    raise RuntimeError("Unable to call ensure_opg_approval with a supported signature.")


def _normalize_model_key(value: str) -> str:
    normalized = value.strip()
    if "/" in normalized:
        normalized = normalized.split("/", 1)[1]

    return (
        normalized
        .replace("-", "_")
        .replace(".", "_")
        .replace(" ", "_")
        .upper()
    )


def _resolve_model(requested_model: str) -> tuple[Any, str]:
    enum = getattr(og, "TEE_LLM", None)
    fallback = requested_model or "GPT_5_2"
    normalized_fallback = _normalize_model_key(fallback)
    if enum is None:
        return normalized_fallback, normalized_fallback

    variants = [
        normalized_fallback,
        fallback,
    ]

    seen: set[str] = set()
    for variant in variants:
        if variant in seen:
            continue
        seen.add(variant)
        if hasattr(enum, variant):
            resolved = getattr(enum, variant)
            return resolved, normalized_fallback

    return normalized_fallback, normalized_fallback


async def main() -> None:
    raw = sys.stdin.read()
    payload = json.loads(raw) if raw else {}
    prompt = str(payload.get("prompt", "")).strip()
    twins = payload.get("twins", [])
    system_instruction = str(payload.get("systemInstruction", "")).strip()
    metadata = payload.get("metadata", {})
    requested_model = str(payload.get("model") or os.environ.get("OPENGRADIENT_MODEL") or "GPT_5_2").strip()
    private_key = (os.environ.get("OPENGRADIENT_PRIVATE_KEY") or "").strip()

    _debug(
        "bridge_input",
        {
            "prompt_length": len(prompt),
            "twins_count": len(twins) if isinstance(twins, list) else None,
            "python_executable": sys.executable,
        },
    )

    if not private_key:
        _debug("missing_private_key")
        print(json.dumps({"provider": "opengradient", "content": "OPENGRADIENT_PRIVATE_KEY is not set."}))
        return

    if not private_key.startswith("0x"):
        private_key = "0x" + private_key

    _debug(
        "private_key_ready",
        {
            "prefix": private_key[:6],
            "suffix": private_key[-4:],
            "length": len(private_key),
        },
    )

    llm = og.LLM(private_key=private_key)
    _debug("llm_initialized", {"llm_type": type(llm).__name__})
    if hasattr(llm, "ensure_opg_approval"):
        _debug("ensure_opg_approval_start", {"opg_amount": 0.1})
        _ensure_opg_approval(llm)
        _debug("ensure_opg_approval_done")

    messages = [
        {
            "role": "system",
            "content": (
                system_instruction
                or (
                    "You are TradeKeys Copilot. Answer the user's actual question directly. "
                    "Use only the provided Twin data as evidence. "
                    "Do not make unsupported predictions. Do not switch into a generic market roundup unless the user asked for one. "
                    "If the supplied Twin data is insufficient, say what is missing instead of improvising. "
                    "Keep the answer concise, grounded, and action-oriented. "
                    "If Twin data includes wallet activity tier fields such as activityTierLabel or activityTierUsdValue, "
                    "you may use them as evidence for wallet-size analysis."
                )
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "prompt": prompt,
                    "twins": twins,
                    "metadata": metadata,
                }
            ),
        },
    ]

    model, model_name = _resolve_model(requested_model)
    settlement_mode = getattr(og.x402SettlementMode, "INDIVIDUAL_FULL", og.x402SettlementMode.BATCH_HASHED)
    _debug(
        "chat_start",
        {
            "requested_model": requested_model,
            "model": model_name,
            "settlement_mode": str(getattr(settlement_mode, "value", settlement_mode)),
            "max_tokens": 600,
        },
    )

    try:
        result = await llm.chat(
            model=model,
            messages=messages,
            max_tokens=600,
            x402_settlement_mode=settlement_mode,
            stream=False,
        )
    except Exception as exc:
        _debug(
            "chat_error",
            {
                "error_type": type(exc).__name__,
                "error_message": str(exc),
                "traceback": traceback.format_exc(),
            },
        )
        raise

    _debug("chat_result_raw", result)

    chat_output = getattr(result, "chat_output", None) or {}
    content = ""
    if isinstance(chat_output, dict):
        content = str(chat_output.get("content") or chat_output.get("text") or "").strip()
    else:
        content = str(chat_output).strip()

    payload = OpenGradientChatResult(
        provider="opengradient",
        content=content,
        modelName=model_name,
        settlementMode=str(getattr(settlement_mode, "value", "INDIVIDUAL_FULL")),
        transactionHash=_deep_get(result, ("transaction_hash",), ("transactionHash",), ("proof", "transaction_hash")),
        paymentHash=_deep_get(result, ("payment_hash",), ("paymentHash",), ("proof", "payment_hash")),
        teeId=_deep_get(result, ("tee_id",), ("teeId",), ("proof", "tee_id"), ("attestation", "tee_id")),
        teeEndpoint=_deep_get(result, ("tee_endpoint",), ("teeEndpoint",), ("proof", "tee_endpoint")),
        teePaymentAddress=_deep_get(result, ("tee_payment_address",), ("teePaymentAddress",), ("paymentAddress",)),
        teeSignature=_deep_get(result, ("tee_signature",), ("teeSignature",), ("signature",)),
        teeTimestamp=_deep_get(result, ("tee_timestamp",), ("teeTimestamp",), ("timestamp",)),
        finishReason=_deep_get(result, ("finish_reason",), ("finishReason",), ("chat_output", "finish_reason")),
    )
    _debug("chat_result_serialized", asdict(payload))
    print(json.dumps(asdict(payload)))


if __name__ == "__main__":
    asyncio.run(main())
