const authForm = document.getElementById("auth-form");
const authMsg = document.getElementById("auth-msg");
const subscribeBtn = document.getElementById("subscribe-btn");
const authTabs = document.querySelectorAll(".auth-tab");

let authMode = "login";

function getToken() {
  return localStorage.getItem("tp_token");
}

function setToken(token) {
  if (token) localStorage.setItem("tp_token", token);
  else localStorage.removeItem("tp_token");
}

async function syncSubscription(token) {
  try {
    const res = await fetch(`${TP_API_BASE}/billing/sync`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.user;
  } catch {
    return null;
  }
}

function setAuthMessage(text, ok = false) {
  authMsg.textContent = text;
  authMsg.classList.toggle("ok", ok);
}

authTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    authMode = tab.dataset.tab;
    authTabs.forEach((t) => t.classList.toggle("active", t === tab));
    setAuthMessage("");
    document.getElementById("password").autocomplete =
      authMode === "register" ? "new-password" : "current-password";
  });
});

authForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setAuthMessage("");

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  try {
    const res = await fetch(`${TP_API_BASE}/auth/${authMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Could not sign in.");

    setToken(data.token);
    const user = data.user;
    if (user.subscription_status === "active") {
      setAuthMessage(
        `Welcome back. ${user.analyses_remaining} analyses remaining this month.`,
        true
      );
    } else {
      const synced = await syncSubscription(token);
      if (synced?.subscription_status === "active") {
        setAuthMessage(
          `Subscription active. ${synced.analyses_remaining} analyses remaining this month.`,
          true
        );
      } else {
        setAuthMessage("Signed in. Subscribe to unlock analyses.", false);
      }
    }
  } catch (error) {
    setAuthMessage(error.message || "Something went wrong.");
  }
});

subscribeBtn?.addEventListener("click", async () => {
  const token = getToken();
  if (!token) {
    setAuthMessage("Create an account or sign in first.");
    document.getElementById("account")?.scrollIntoView({ behavior: "smooth" });
    return;
  }

  try {
    const res = await fetch(`${TP_API_BASE}/billing/checkout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Checkout unavailable.");
    window.location.href = data.url;
  } catch (error) {
    setAuthMessage(error.message || "Could not start checkout.");
    document.getElementById("account")?.scrollIntoView({ behavior: "smooth" });
  }
});

const reveals = document.querySelectorAll(".reveal");
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) entry.target.classList.add("visible");
    });
  },
  { threshold: 0.12 }
);
reveals.forEach((el) => observer.observe(el));
