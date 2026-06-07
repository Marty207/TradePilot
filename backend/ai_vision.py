"""
ai_vision.py

AI-only trading analysis from chart screenshots.
"""

import os
import json
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def normalize_image_data(image_data: str):
    if not image_data:
        return None

    image_data = image_data.strip()

    if image_data.startswith("data:image/"):
        return image_data

    return f"data:image/png;base64,{image_data}"


def fallback_response(message: str):
    return {
        "action": "WAIT",
        "direction": "NEUTRAL",
        "entry": None,
        "stopLoss": None,
        "targets": [],
        "confidence": 0,
        "reason": [message, "AI analysis could not complete."],
        "aiNotes": ["No valid AI chart read was returned."],
        "timeframeBreakdown": [],
    }


def analyze_chart_ai_only(base64_image: str, symbol: str, timeframe: str):
    if not os.getenv("OPENAI_API_KEY"):
        return fallback_response("No OpenAI API key found.")

    image_url = normalize_image_data(base64_image)

    if not image_url:
        return fallback_response("No screenshot received.")

    prompt = f"""
You are a PROFESSIONAL futures trading chart analyst.

Market:
- Symbol: {symbol}
- Timeframe: {timeframe}

Analyze the visible chart and return ONE trade decision.

Allowed actions: ENTER_NOW, PLACE_LIMIT, WAIT, NO_TRADE

Rules:
- Only suggest a trade if the setup is visually clear.
- Risk/reward should be at least 1:1. But DONT Risk Too Much.
- Prefer WAIT if unclear.
- Entry, stop, and targets must match visible structure.
- Do not guarantee profit.

Return ONLY valid JSON:
{{
  "action": "ENTER_NOW | PLACE_LIMIT | WAIT | NO_TRADE",
  "direction": "LONG | SHORT | NEUTRAL",
  "entry": number or null,
  "stopLoss": number or null,
  "targets": [number],
  "confidence": number from 0 to 100,
  "reason": ["...", "...", "..."],
  "aiNotes": ["..."],
  "timeframeBreakdown": []
}}
"""

    return _call_vision_model(
        symbol=symbol,
        timeframe=timeframe,
        content=[
            {"type": "input_text", "text": prompt},
            {"type": "input_image", "image_url": image_url},
        ],
    )


TIMEFRAME_ROLES = {
    "1m": "Entry timing — micro structure, candles, and precise trigger",
    "5m": "Setup structure — momentum, pullbacks, and intraday pattern",
    "15m": "Session trend — key zones, trend direction, and context",
    "30m": "Higher-timeframe bias — major structure and dominant trend",
}


def _build_image_manifest(frames: list[dict]) -> str:
    lines = [
        "IMAGE MANIFEST (each screenshot is labeled immediately before its image):",
        "",
    ]
    total = len(frames)

    for frame in frames:
        idx = frame["image_index"]
        tf = frame["timeframe"]
        role = frame["role"]
        lines.append(f"  Image {idx} of {total} → TIMEFRAME: {tf} | ROLE: {role}")

    lines.append("")
    lines.append(
        "IMPORTANT: The text block directly above each image tells you exactly "
        "which timeframe that image is. Do not confuse images with each other."
    )
    return "\n".join(lines)


def _label_before_image(frame: dict) -> str:
    idx = frame["image_index"]
    total = frame["total_images"]
    tf = frame["timeframe"]
    role = frame["role"]

    return f"""
══════════════════════════════════════
IMAGE {idx} OF {total}
TIMEFRAME: {tf}
SYMBOL: same chart ({tf} candles)
ROLE: {role}

The NEXT image in this message is the {tf} chart screenshot.
Analyze ONLY this image as the {tf} timeframe.
══════════════════════════════════════
""".strip()


def analyze_chart_mtf(symbol: str, screenshots: list[dict]):
    if not os.getenv("OPENAI_API_KEY"):
        return fallback_response("No OpenAI API key found.")

    if not screenshots:
        return fallback_response("No screenshots received.")

    frames = []
    total = len(screenshots)

    for i, shot in enumerate(screenshots):
        url = normalize_image_data(shot.get("screenshot", ""))
        if not url:
            continue

        tf = shot.get("timeframe", "unknown")
        image_index = shot.get("image_index") or (i + 1)
        total_images = shot.get("total_images") or total
        role = shot.get("role") or TIMEFRAME_ROLES.get(tf, f"Chart context for {tf}")

        frames.append(
            {
                "timeframe": tf,
                "screenshot": url,
                "image_index": image_index,
                "total_images": total_images,
                "role": role,
            }
        )

    if not frames:
        return fallback_response("No valid screenshots received.")

    timeframes_list = ", ".join(f["timeframe"] for f in frames)
    manifest = _build_image_manifest(frames)

    prompt = f"""
You are a PROFESSIONAL futures trading chart analyst doing MULTI-TIMEFRAME analysis.

Market symbol: {symbol}

You will receive {len(frames)} labeled chart screenshots.
Each screenshot is preceded by a text label that states:
- image number (e.g. IMAGE 2 OF 4)
- exact timeframe (1m, 5m, 15m, or 30m)
- what that timeframe is used for (role)

{manifest}

Read images in order. Use each timeframe for its stated role only.
Synthesize ALL timeframes into ONE trade decision.

Allowed actions: ENTER_NOW, PLACE_LIMIT, WAIT, NO_TRADE

Rules:
- Only ENTER if timeframes align or conflict is minor and explained.
- Prefer WAIT if higher and lower timeframes conflict.
- In timeframeBreakdown, reference the correct timeframe label for each summary.
- Risk/reward at least 1:1 when suggesting a trade.
- Do not guarantee profit.

Return ONLY valid JSON:
{{
  "action": "ENTER_NOW | PLACE_LIMIT | WAIT | NO_TRADE",
  "direction": "LONG | SHORT | NEUTRAL",
  "entry": number or null,
  "stopLoss": number or null,
  "targets": [number],
  "confidence": number from 0 to 100,
  "reason": ["...", "...", "..."],
  "aiNotes": ["..."],
  "timeframeBreakdown": [
    {{ "timeframe": "1m", "summary": "what you saw in the 1m image" }},
    {{ "timeframe": "5m", "summary": "what you saw in the 5m image" }}
  ]
}}
"""

    content = [{"type": "input_text", "text": prompt}]

    for frame in frames:
        content.append({"type": "input_text", "text": _label_before_image(frame)})
        content.append({"type": "input_image", "image_url": frame["screenshot"]})

    return _call_vision_model(
        symbol=symbol,
        timeframe=timeframes_list,
        content=content,
    )


def _call_vision_model(symbol: str, timeframe: str, content: list):
    try:
        response = client.responses.create(
            model="gpt-4.1-mini",
            input=[{"role": "user", "content": content}],
        )

        text = response.output_text.strip()
        text = text.replace("```json", "").replace("```", "").strip()
        data = json.loads(text)

        return {
            "action": data.get("action", "WAIT"),
            "direction": data.get("direction", "NEUTRAL"),
            "entry": data.get("entry"),
            "stopLoss": data.get("stopLoss"),
            "targets": data.get("targets", []),
            "confidence": data.get("confidence", 0),
            "reason": data.get("reason", []),
            "aiNotes": data.get("aiNotes", []),
            "timeframeBreakdown": data.get("timeframeBreakdown", []),
            "symbol": symbol,
            "timeframe": timeframe,
            "mode": "MTF" if len(content) > 2 else "AI_ONLY",
        }

    except Exception as error:
        return fallback_response(str(error))
