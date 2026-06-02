"""
ai_vision.py

AI-only trading analysis.

This file lets the AI look at the TradingView screenshot and create the setup.

Important:
- It is decision-support only.
- It does not guarantee profit.
- It should say WAIT when the chart is unclear.
"""

import os
import json
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def normalize_image_data(image_data: str):
    """
    Makes sure the image is in the correct format.

    Chrome usually sends:
    data:image/png;base64,....

    If it only sends raw base64, we wrap it.
    """

    if not image_data:
        return None

    image_data = image_data.strip()

    if image_data.startswith("data:image/"):
        return image_data

    return f"data:image/png;base64,{image_data}"


def fallback_response(message: str):
    """
    Safe backup response if AI fails.
    """

    return {
        "action": "WAIT",
        "direction": "NEUTRAL",
        "entry": None,
        "stopLoss": None,
        "targets": [],
        "confidence": 0,
        "reason": [
            message,
            "AI-only analysis could not complete."
        ],
        "aiNotes": [
            "No valid AI chart read was returned."
        ]
    }


def analyze_chart_ai_only(base64_image: str, symbol: str, timeframe: str):
    """
    Main AI-only function.

    The AI looks at the chart screenshot and returns a complete trade plan.
    """

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

Your job:
Analyze the visible chart and return ONE trade decision.

Allowed actions:
- ENTER_NOW
- PLACE_LIMIT
- WAIT
- NO_TRADE

VERY IMPORTANT RULES:
- Only suggest a trade if the setup is visually clear, and you think is best.
- Risk/reward should be at least 1:1. But Dont Risk To Much.
- Prefer WAIT if the entry, stop, or target is not obvious from the chart.
- If the chart is unclear, choose WAIT or NO_TRADE. 
- Do not guarantee profit.
- Do not overtrade.
- Do not make up exact levels if the chart levels are not visually clear.
- Prefer clean setups only.
- Entry, stop loss, and targets must make sense from visible support/resistance, trend, liquidity, or candle structure.
- If you cannot see price clearly, return WAIT, AND tell them what to do to help you see better (e.g. "Please provide a clearer screenshot with visible price levels").
- Be practical and concise.

Return ONLY valid JSON in this exact shape:

{{
  "action": "ENTER_NOW | PLACE_LIMIT | WAIT | NO_TRADE",
  "direction": "LONG | SHORT | NEUTRAL",
  "entry": number or null,
  "stopLoss": number or null,
  "targets": [number],
  "confidence": number from 0 to 100,
  "reason": [
    "short reason 1",
    "short reason 2",
    "short reason 3"
  ],
  "aiNotes": [
    "what the trader should watch next"
  ]
}}
"""

    try:
        response = client.responses.create(
            model="gpt-4.1-mini",
            input=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": prompt
                        },
                        {
                            "type": "input_image",
                            "image_url": image_url
                        }
                    ]
                }
            ]
        )

        text = response.output_text.strip()

        # Sometimes AI wraps JSON in ```json blocks.
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
        }

    except Exception as error:
        return fallback_response(str(error))