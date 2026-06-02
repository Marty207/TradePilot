from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from ai_vision import analyze_chart_ai_only


app = FastAPI(title="TradePilot AI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    symbol: str
    timeframe: str
    screenshot: Optional[str] = None


@app.get("/")
def home():
    return {
        "message": "TradePilot backend is running",
        "mode": "AI_ONLY",
        "docs": "/docs",
    }


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/analyze")
def analyze(request: AnalyzeRequest):
    if not request.screenshot:
        raise HTTPException(status_code=400, detail="No screenshot received.")

    result = analyze_chart_ai_only(
        base64_image=request.screenshot,
        symbol=request.symbol,
        timeframe=request.timeframe,
    )

    result["symbol"] = request.symbol
    result["timeframe"] = request.timeframe
    result["mode"] = "AI_ONLY"

    return result