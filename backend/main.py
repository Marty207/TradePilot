import os
from typing import Optional

import stripe
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr

from ai_vision import analyze_chart_ai_only, analyze_chart_mtf
from auth import get_current_user, get_optional_user, login_user, register_user
from billing import (
    create_checkout_session,
    handle_stripe_webhook,
    stripe_configured,
    sync_user_subscription,
    verify_checkout_session,
)
from database import (
    analyses_limit_for_user,
    get_usage_count,
    increment_usage,
    init_db,
    user_access_payload,
)

AUTH_REQUIRED = os.getenv("AUTH_REQUIRED", "false").lower() == "true"

app = FastAPI(title="TradePilot AI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()


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


class AuthRequest(BaseModel):
    email: EmailStr
    password: str


class VerifySessionRequest(BaseModel):
    session_id: str


@app.get("/")
def home():
    return {
        "message": "TradePilot backend is running",
        "mode": "MTF",
        "auth": True,
        "billing": stripe_configured(),
        "docs": "/docs",
    }


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/auth/register")
def register(request: AuthRequest):
    return register_user(request.email, request.password)


@app.post("/auth/login")
def login(request: AuthRequest):
    return login_user(request.email, request.password)


@app.get("/auth/me")
def me(user=Depends(get_current_user)):
    return user_access_payload(user)


@app.post("/billing/checkout")
def billing_checkout(user=Depends(get_current_user)):
    if not stripe_configured():
        raise HTTPException(status_code=503, detail="Billing is not configured yet.")
    try:
        url = create_checkout_session(user["id"], user["email"])
        return {"url": url}
    except ValueError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except stripe.error.StripeError as error:
        raise HTTPException(status_code=502, detail=str(error.user_message or error)) from error


@app.post("/billing/sync")
def billing_sync(user=Depends(get_current_user)):
    if not stripe_configured():
        raise HTTPException(status_code=503, detail="Billing is not configured yet.")
    try:
        from database import get_user_by_id

        active = sync_user_subscription(user["id"])
        refreshed = get_user_by_id(user["id"])
        payload = user_access_payload(refreshed)
        if not active and payload["subscription_status"] != "active":
            raise HTTPException(
                status_code=404,
                detail="No active subscription found for this account.",
            )
        return {"ok": True, "user": payload}
    except ValueError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except stripe.error.StripeError as error:
        raise HTTPException(status_code=502, detail=str(error.user_message or error)) from error


@app.post("/billing/verify-session")
def billing_verify_session(
    request: VerifySessionRequest,
    user=Depends(get_optional_user),
):
    if not stripe_configured():
        raise HTTPException(status_code=503, detail="Billing is not configured yet.")
    try:
        from database import get_user_by_id

        expected_user_id = user["id"] if user else None
        user_id = verify_checkout_session(request.session_id, expected_user_id)
        return {"ok": True, "user": user_access_payload(get_user_by_id(user_id))}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except stripe.error.StripeError as error:
        raise HTTPException(status_code=502, detail=str(error.user_message or error)) from error


@app.post("/billing/webhook")
async def billing_webhook(request: Request):
    payload = await request.body()
    signature = request.headers.get("stripe-signature", "")
    try:
        handle_stripe_webhook(payload, signature)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except stripe.error.SignatureVerificationError as error:
        raise HTTPException(status_code=400, detail="Invalid webhook signature.") from error
    return {"received": True}


def require_analyze_access(user=Depends(get_optional_user)):
    if user:
        used = get_usage_count(user["id"])
        limit = analyses_limit_for_user(user)
        if limit == 0:
            raise HTTPException(
                status_code=402,
                detail="Subscribe for $20/month to start analyzing charts.",
            )
        if used >= limit:
            raise HTTPException(
                status_code=402,
                detail=f"Monthly limit reached ({limit} analyses). Renews next month.",
            )
        return user

    if AUTH_REQUIRED:
        raise HTTPException(status_code=401, detail="Sign in to analyze charts.")
    return None


@app.post("/analyze")
def analyze(request: AnalyzeRequest, user=Depends(require_analyze_access)):
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
            result = analyze_chart_mtf(request.symbol, frames)
        elif request.screenshot:
            result = analyze_chart_ai_only(
                base64_image=request.screenshot,
                symbol=request.symbol,
                timeframe=request.timeframe or "unknown",
            )
            result["symbol"] = request.symbol
            result["timeframe"] = request.timeframe
        else:
            raise HTTPException(status_code=400, detail="No screenshots received.")

        if user:
            increment_usage(user["id"])
            from database import get_user_by_id

            result["usage"] = user_access_payload(get_user_by_id(user["id"]))

        return result
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
