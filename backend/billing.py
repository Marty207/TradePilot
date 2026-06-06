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
