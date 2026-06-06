from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from ai_vision import analyze_chart_ai_only, analyze_chart_mtf


app = FastAPI(title="TradePilot AI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ScreenshotFrame(BaseModel):
    timeframe: str
    screenshot: str
    image_index: Optional[int] = None
    total_images: Optional[int] = None
    role: Optional[str] = None


class AnalyzeRequest(BaseModel):
    symbol: str
    screenshots: Optional[list[ScreenshotFrame]] = None
    timeframe: Optional[str] = None
    screenshot: Optional[str] = None


@app.get("/")
def home():
    return {
        "message": "TradePilot backend is running",
        "mode": "MTF",
        "docs": "/docs",
    }


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/analyze")
def analyze(request: AnalyzeRequest):
    try:
        if request.screenshots and len(request.screenshots) > 0:
            frames = [
                {
                    "timeframe": f.timeframe,
                    "screenshot": f.screenshot,
                    "image_index": f.image_index,
                    "total_images": f.total_images,
                    "role": f.role,
                }
                for f in request.screenshots
            ]
            return analyze_chart_mtf(request.symbol, frames)

        if request.screenshot:
            result = analyze_chart_ai_only(
                base64_image=request.screenshot,
                symbol=request.symbol,
                timeframe=request.timeframe or "unknown",
            )
            result["symbol"] = request.symbol
            result["timeframe"] = request.timeframe
            return result

        raise HTTPException(status_code=400, detail="No screenshots received.")
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
