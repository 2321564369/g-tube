import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const youtubeApiKey = Deno.env.get("YOUTUBE_API_KEY") || "";
const pinPepper = Deno.env.get("PIN_PEPPER") || "";

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
async function hash(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function db(path: string, init: RequestInit = {}) {
  const response = await fetch(supabaseUrl + "/rest/v1/" + path, {
    ...init,
    headers: {
      "apikey": serviceRoleKey,
      "Authorization": "Bearer " + serviceRoleKey,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(typeof data === "object" && data?.message ? data.message : "Database request failed.");
  return data;
}
async function createSession(userId: string, username: string) {
  const token = crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "");
  const tokenHash = await hash(token);
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  await db("galaxy_sessions", { method: "POST", body: JSON.stringify({ user_id: userId, token_hash: tokenHash, expires_at: expires }) });
  return { session: token, username };
}
async function requireUser(token: string) {
  if (!token) throw new Error("Sign in to use your profile.");
  const tokenHash = await hash(token);
  const sessions = await db("galaxy_sessions?select=user_id,expires_at&token_hash=eq." + encodeURIComponent(tokenHash) + "&limit=1");
  const session = Array.isArray(sessions) ? sessions[0] : null;
  if (!session || new Date(session.expires_at).getTime() < Date.now()) throw new Error("Your session expired. Sign in again.");
  const users = await db("galaxy_profiles?select=id,username&id=eq." + encodeURIComponent(session.user_id) + "&limit=1");
  const user = Array.isArray(users) ? users[0] : null;
  if (!user) throw new Error("Profile not found.");
  return user;
}
const allowedYoutubePaths = new Set(["search", "videos", "channels", "playlistItems"]);
const allowedDataKeys = new Set(["video_data", "watch_history", "preferences", "saved_videos", "liked_videos"]);

// Lightweight per-instance throttling for anonymous prototype searches.
const publicSearchHits = new Map<string, number[]>();
function allowPublicSearch(ip: string): boolean {
  const now = Date.now();
  const recent = (publicSearchHits.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  if (recent.length >= 25) {
    publicSearchHits.set(ip, recent);
    return false;
  }
  recent.push(now);
  publicSearchHits.set(ip, recent);
  return true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });
  if (!serviceRoleKey || !pinPepper) return reply(500, { error: "Edge Function secrets are not configured." });
  try {
    const body = await req.json();
    const action = String(body.action || "");
    if (action === "signup" || action === "login") {
      const username = String(body.username || "").trim().toLowerCase();
      const pin = String(body.pin || "");
      if (!/^[a-z0-9_-]{3,24}$/.test(username)) return reply(400, { error: "Username must be 3–24 letters, numbers, underscores, or hyphens." });
      if (!/^\d{6}$/.test(pin)) return reply(400, { error: "PIN must be exactly 6 digits." });
      const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const attempts = await db("galaxy_auth_attempts?select=id&username=eq." + encodeURIComponent(username) + "&attempted_at=gte." + encodeURIComponent(since));
      if (Array.isArray(attempts) && attempts.length >= 8) return reply(429, { error: "Too many attempts. Wait 15 minutes and try again." });
      await db("galaxy_auth_attempts", { method: "POST", body: JSON.stringify({ username }) });
      const existing = await db("galaxy_profiles?select=id,username,pin_hash&username=eq." + encodeURIComponent(username) + "&limit=1");
      const profile = Array.isArray(existing) ? existing[0] : null;
      const pinHash = await hash(username + ":" + pin + ":" + pinPepper);
      if (action === "signup") {
        if (profile) return reply(409, { error: "That username already exists. Choose another or sign in." });
        const inserted = await db("galaxy_profiles", { method: "POST", body: JSON.stringify({ username, pin_hash: pinHash }) });
        const user = Array.isArray(inserted) ? inserted[0] : null;
        if (!user) throw new Error("Could not create profile.");
        return reply(200, await createSession(user.id, username));
      }
      if (!profile || profile.pin_hash !== pinHash) return reply(401, { error: "Incorrect username or PIN." });
      return reply(200, await createSession(profile.id, username));
    }
    if (action === "youtube-public-search") {
      if (!youtubeApiKey) return reply(500, { error: "YouTube search is not configured on the server." });
      const forwarded = req.headers.get("x-forwarded-for") || "";
      const ip = forwarded.split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "unknown";
      if (!allowPublicSearch(ip)) return reply(429, { error: "Search limit reached for this connection. Wait 10 minutes and try again." });
      const raw = body.params && typeof body.params === "object" ? body.params : {};
      const q = String(raw.q || "").trim().slice(0, 100);
      if (!q) return reply(400, { error: "Enter a search term." });
      const maxResults = Math.min(20, Math.max(1, Number(raw.maxResults) || 18));
      const url = new URL("https://www.googleapis.com/youtube/v3/search");
      url.searchParams.set("part", "snippet");
      url.searchParams.set("type", "video");
      url.searchParams.set("maxResults", String(maxResults));
      url.searchParams.set("q", q);
      url.searchParams.set("safeSearch", "moderate");
      url.searchParams.set("key", youtubeApiKey);
      const response = await fetch(url);
      const data = await response.json();
      if (!response.ok || data.error) return reply(response.status, { error: data.error?.message || "YouTube search failed." });
      return reply(200, { data });
    }

    const user = await requireUser(String(body.session || ""));
    if (action === "logout") {
      const tokenHash = await hash(String(body.session || ""));
      await db("galaxy_sessions?token_hash=eq." + encodeURIComponent(tokenHash), { method: "DELETE" });
      return reply(200, { ok: true });
    }
    if (action === "youtube") {
      if (!youtubeApiKey) return reply(500, { error: "Set YOUTUBE_API_KEY in Supabase Edge Function secrets." });
      const path = String(body.path || "");
      if (!allowedYoutubePaths.has(path)) return reply(400, { error: "That YouTube API endpoint is not allowed." });
      const params = body.params && typeof body.params === "object" ? body.params : {};
      const url = new URL("https://www.googleapis.com/youtube/v3/" + path);
      for (const [key, value] of Object.entries(params)) {
        if (["key", "access_token", "Authorization"].includes(key)) continue;
        if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
      }
      url.searchParams.set("key", youtubeApiKey);
      const response = await fetch(url);
      const data = await response.json();
      if (!response.ok || data.error) return reply(response.status, { error: data.error?.message || "YouTube API request failed." });
      return reply(200, { data });
    }
    if (action === "youtube") {
      if (!youtubeApiKey) return reply(500, { error: "Set YOUTUBE_API_KEY in Supabase Edge Function secrets." });
      const path = String(body.path || "");
      if (!allowedYoutubePaths.has(path)) return reply(400, { error: "That YouTube API endpoint is not allowed." });
      const params = body.params && typeof body.params === "object" ? body.params : {};
      const url = new URL("https://www.googleapis.com/youtube/v3/" + path);
      for (const [key, value] of Object.entries(params)) {
        if (["key", "access_token", "Authorization"].includes(key)) continue;
        if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
      }
      url.searchParams.set("key", youtubeApiKey);
      const response = await fetch(url);
      const data = await response.json();
      if (!response.ok || data.error) return reply(response.status, { error: data.error?.message || "YouTube API request failed." });
      return reply(200, { data });
    }

    if (action === "data-get") {
      const key = String(body.key || "");
      if (!allowedDataKeys.has(key)) return reply(400, { error: "Unsupported profile-data key." });
      const rows = await db("galaxy_user_data?select=value&user_id=eq." + encodeURIComponent(user.id) + "&data_key=eq." + encodeURIComponent(key) + "&limit=1");
      return reply(200, { value: Array.isArray(rows) && rows[0] ? rows[0].value : null });
    }
    if (action === "data-set") {
      const key = String(body.key || "");
      if (!allowedDataKeys.has(key)) return reply(400, { error: "Unsupported profile-data key." });
      const value = body.value ?? null;
      const upsert = await db("galaxy_user_data?on_conflict=user_id,data_key", {
        method: "POST",
        headers: { "Prefer": "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({ user_id: user.id, data_key: key, value, updated_at: new Date().toISOString() })
      });
      return reply(200, { ok: true, data: upsert });
    }
    return reply(400, { error: "Unknown action." });
  } catch (error) {
    return reply(400, { error: error instanceof Error ? error.message : "Unexpected server error." });
  }
});