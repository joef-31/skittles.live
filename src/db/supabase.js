// ===========================================================
// Supabase setup (SINGLE SOURCE OF TRUTH)
// ===========================================================

// file:// safe
// No imports
// No exports

window.App = window.App || {};
App.DB = App.DB || {};

// -----------------------------------------------------------
// Supabase credentials
// -----------------------------------------------------------

const SUPABASE_URL = "https://gewdiegidqkfvikxscts.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdld2RpZWdpZHFrZnZpa3hzY3RzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2NjQwNDIsImV4cCI6MjA4MDI0MDA0Mn0.6qMeXabS49vULjxjlksbX2eXLDVyyChSxZPYKw2RAw4";

// -----------------------------------------------------------
// Client initialisation
// -----------------------------------------------------------

const supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

// Expose via App namespace
App.DB.supabaseClient = supabaseClient;

// Legacy compatibility (temporary)
Object.defineProperty(window, "supabaseClient", {
  value: supabaseClient,
  writable: false,
  configurable: false,
});

async function resolveOrCreatePlayerByName(
    name,
    { allowGuest = true } = {}
) {
    const clean = (name || "").trim();
    if (!clean) throw new Error("Player name required.");

    // Try exact match first
    const { data: existing } = await window.supabaseClient
        .from("players")
        .select("id, is_guest")
        .ilike("name", clean)
        .maybeSingle();

    if (existing?.id) {
        if (!allowGuest && existing.is_guest) {
            throw new Error("Guest players are not allowed here.");
        }
        return existing.id;
    }

    const isGuest = !clean.includes(" ");

    if (isGuest && !allowGuest) {
        throw new Error("Guest players are not allowed here.");
    }

    const { data, error } = await window.supabaseClient
        .from("players")
        .insert({
            name: clean,
            is_guest: isGuest,
        })
        .select("id")
        .maybeSingle();

    if (error || !data) {
        throw new Error("Failed to create player.");
    }

    return data.id;
}
