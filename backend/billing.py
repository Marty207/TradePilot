import os

import stripe

from database import (
    activate_pro_subscription,
    deactivate_subscription,
    get_user_by_id,
    get_user_by_stripe_customer,
    set_stripe_customer,
)

stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")

STRIPE_PRICE_ID = os.getenv("STRIPE_PRICE_ID", "")
WEBSITE_URL = os.getenv("WEBSITE_URL", "http://localhost:3000").rstrip("/")


def stripe_configured() -> bool:
    return bool(stripe.api_key and STRIPE_PRICE_ID)


def create_checkout_session(user_id: int, email: str) -> str:
    if not stripe_configured():
        raise ValueError("Stripe is not configured on the server.")

    user = get_user_by_id(user_id)
    customer_id = user["stripe_customer_id"]

    if not customer_id:
        customer = stripe.Customer.create(email=email, metadata={"user_id": str(user_id)})
        customer_id = customer.id
        set_stripe_customer(user_id, customer_id)

    session = stripe.checkout.Session.create(
        mode="subscription",
        customer=customer_id,
        line_items=[{"price": STRIPE_PRICE_ID, "quantity": 1}],
        success_url=f"{WEBSITE_URL}/success.html?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{WEBSITE_URL}/index.html#pricing",
        metadata={"user_id": str(user_id)},
        allow_promotion_codes=True,
    )
    return session.url


def sync_user_subscription(user_id: int) -> bool:
    if not stripe_configured():
        raise ValueError("Stripe is not configured on the server.")

    user = get_user_by_id(user_id)
    if not user or not user["stripe_customer_id"]:
        return False

    subscriptions = stripe.Subscription.list(
        customer=user["stripe_customer_id"],
        status="active",
        limit=1,
    )
    if subscriptions.data:
        activate_pro_subscription(user_id)
        return True
    return False


def verify_checkout_session(session_id: str, expected_user_id: int | None = None) -> int:
    if not stripe_configured():
        raise ValueError("Stripe is not configured on the server.")

    session = stripe.checkout.Session.retrieve(session_id)
    if session.status != "complete":
        raise ValueError("Checkout is not complete yet. Wait a moment and refresh.")

    user_id = None
    metadata_user_id = (session.get("metadata") or {}).get("user_id")
    if metadata_user_id:
        user_id = int(metadata_user_id)
    elif session.get("customer"):
        user = get_user_by_stripe_customer(session["customer"])
        if user:
            user_id = user["id"]

    if not user_id:
        raise ValueError("Could not link this payment to your account.")

    if expected_user_id is not None and user_id != expected_user_id:
        raise ValueError("This payment belongs to a different account.")

    activate_pro_subscription(user_id)
    return user_id


def handle_stripe_webhook(payload: bytes, signature: str) -> None:
    webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET", "")
    if not webhook_secret:
        raise ValueError("Stripe webhook secret is not configured.")

    event = stripe.Webhook.construct_event(payload, signature, webhook_secret)

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        user_id = session.get("metadata", {}).get("user_id")
        if user_id:
            activate_pro_subscription(int(user_id))
        elif session.get("customer"):
            user = get_user_by_stripe_customer(session["customer"])
            if user:
                activate_pro_subscription(user["id"])

    elif event["type"] == "customer.subscription.created":
        subscription = event["data"]["object"]
        customer_id = subscription.get("customer")
        if customer_id:
            user = get_user_by_stripe_customer(customer_id)
            if user and subscription.get("status") == "active":
                activate_pro_subscription(user["id"])

    elif event["type"] in ("customer.subscription.deleted", "customer.subscription.updated"):
        subscription = event["data"]["object"]
        customer_id = subscription.get("customer")
        if not customer_id:
            return
        user = get_user_by_stripe_customer(customer_id)
        if not user:
            return
        if event["type"] == "customer.subscription.deleted" or subscription.get("status") != "active":
            deactivate_subscription(user["id"])
