const AUTH_TOKEN_KEY = "tp_auth_token";
const AUTH_USER_KEY = "tp_auth_user";

async function getStoredToken() {
  const result = await chrome.storage.local.get(AUTH_TOKEN_KEY);
  return result[AUTH_TOKEN_KEY] || null;
}

async function setStoredAuth(token, user) {
  await chrome.storage.local.set({
    [AUTH_TOKEN_KEY]: token,
    [AUTH_USER_KEY]: user,
  });
}

async function clearStoredAuth() {
  await chrome.storage.local.remove([AUTH_TOKEN_KEY, AUTH_USER_KEY]);
}

async function getStoredUser() {
  const result = await chrome.storage.local.get(AUTH_USER_KEY);
  return result[AUTH_USER_KEY] || null;
}

async function authFetch(path, options = {}) {
  const token = await getStoredToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${TP_API_BASE}${path}`, {
    ...options,
    headers,
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function loginAccount(email, password) {
  const { response, data } = await authFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(formatAuthError(data));
  }
  await setStoredAuth(data.token, data.user);
  return data.user;
}

async function registerAccount(email, password) {
  const { response, data } = await authFetch("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(formatAuthError(data));
  }
  await setStoredAuth(data.token, data.user);
  return data.user;
}

async function syncSubscription() {
  const { response, data } = await authFetch("/billing/sync", { method: "POST" });
  if (!response.ok) return null;
  const token = await getStoredToken();
  await setStoredAuth(token, data.user);
  return data.user;
}

async function refreshAccount() {
  const token = await getStoredToken();
  if (!token) return null;

  const { response, data } = await authFetch("/auth/me");
  if (!response.ok) {
    await clearStoredAuth();
    return null;
  }
  await setStoredAuth(token, data);
  if (data.subscription_status !== "active") {
    const synced = await syncSubscription();
    if (synced) return synced;
  }
  return data;
}

async function startCheckout() {
  const { response, data } = await authFetch("/billing/checkout", {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(formatAuthError(data));
  }
  chrome.tabs.create({ url: data.url });
}

function formatAuthError(data) {
  if (!data?.detail) return "Something went wrong. Try again.";
  if (typeof data.detail === "string") return data.detail;
  if (Array.isArray(data.detail)) {
    return data.detail.map((item) => item.msg || String(item)).join(". ");
  }
  return String(data.detail);
}

async function getAuthHeaders() {
  const token = await getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
