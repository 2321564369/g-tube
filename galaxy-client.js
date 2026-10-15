(function () {
  "use strict";
  const SUPABASE_URL = "PASTE_SUPABASE_PROJECT_URL_HERE";
  const SUPABASE_ANON_KEY = "PASTE_SUPABASE_ANON_KEY_HERE";
  const FUNCTION_URL = SUPABASE_URL.replace(/\/$/, "") + "/functions/v1/galaxy-api";
  const SESSION_KEY = "galaxy_profile_session";
  let currentUsername = sessionStorage.getItem("galaxy_profile_username") || "";
  let sessionToken = sessionStorage.getItem(SESSION_KEY) || "";
  const validConfig = () => /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL) && !SUPABASE_URL.includes("PASTE_") && !SUPABASE_ANON_KEY.includes("PASTE_");

  async function request(body) {
    if (!validConfig()) throw new Error("Supabase is not configured yet. Add your project URL and anon key in galaxy-client.js.");
    const response = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": "Bearer " + SUPABASE_ANON_KEY },
      body: JSON.stringify({ ...body, session: body.session || sessionToken })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || "Supabase request failed (" + response.status + ").");
    return data;
  }
  async function authenticate(mode) {
    const username = (prompt("Choose/enter your username (3–24 letters, numbers, underscores, or hyphens):") || "").trim().toLowerCase();
    if (!/^[a-z0-9_-]{3,24}$/.test(username)) { if (username) alert("Username must be 3–24 characters: letters, numbers, _ or -."); return; }
    const pin = (prompt("Enter a 6-digit PIN:") || "").trim();
    if (!/^\d{6}$/.test(pin)) { if (pin) alert("PIN must be exactly 6 digits."); return; }
    try {
      const result = await request({ action: mode, username, pin });
      sessionToken = result.session;
      currentUsername = result.username || username;
      sessionStorage.setItem(SESSION_KEY, sessionToken);
      sessionStorage.setItem("galaxy_profile_username", currentUsername);
      updateAccountButtons();
      alert("Signed in as " + currentUsername + ".");
      if (typeof window.loadSuggestions === "function") window.loadSuggestions();
      if (typeof window.loadVideo === "function") window.loadVideo();
    } catch (error) { alert(error.message || String(error)); }
  }
  async function connect() {
    if (sessionToken) {
      if (confirm("Sign out of Galaxy-tube?")) {
        try { await request({ action: "logout" }); } catch (_) {}
        sessionToken = ""; currentUsername = "";
        sessionStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem("galaxy_profile_username");
        updateAccountButtons();
      }
      return;
    }
    await authenticate("login");
  }
  function apiKey() { return validConfig() ? "server-side" : ""; }
  function signedIn() { return !!sessionToken; }
  function token() { return sessionToken; }
  function clearToken() { sessionToken = ""; currentUsername = ""; sessionStorage.removeItem(SESSION_KEY); sessionStorage.removeItem("galaxy_profile_username"); updateAccountButtons(); }
  function updateAccountButtons() {
    const account = document.getElementById("accountPill");
    if (account) account.textContent = signedIn() ? currentUsername + " · Sign out" : "Sign in";
    const create = document.getElementById("apiKeyPill");
    if (create) create.textContent = "Create profile";
  }
  async function ytApi(path, params) {
    if (!validConfig()) throw new Error("Supabase is not configured yet. Add your project URL and anon key in galaxy-client.js.");
    const result = await request({ action: "youtube", path, params: params || {} });
    return result.data;
  }
  async function personalizedVideos() { return []; }
  async function getData(key) {
    const result = await request({ action: "data-get", key });
    return result.value;
  }
  async function setData(key, value) {
    return request({ action: "data-set", key, value });
  }
  document.addEventListener("DOMContentLoaded", function () {
    const account = document.getElementById("accountPill");
    if (account) account.onclick = connect;
    const create = document.getElementById("apiKeyPill");
    if (create) create.onclick = () => authenticate("signup");
    updateAccountButtons();
  });
  window.GalaxyYouTubeAuth = Object.freeze({ apiKey, token, signedIn, connect, clearToken, updateAccountButtons, ytApi, personalizedVideos, getData, setData, request });
  window.GalaxyYouTubeApi = Object.freeze({ ytApi, apiKey });
})();