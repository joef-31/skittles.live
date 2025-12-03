// ===========================================================
// Supabase setup
// ===========================================================

const SUPERADMIN = true; // toggle false to hide scoring button

const SUPABASE_URL = "https://gewdiegidqkfvikxscts.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdld2RpZWdpZHFrZnZpa3hzY3RzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2NjQwNDIsImV4cCI6MjA4MDI0MDA0Mn0.6qMeXabS49vULjxjlksbX2eXLDVyyChSxZPYKw2RAw4";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==================================================================
// REALTIME LISTENER — smooth updates (no full view refresh)
// ==================================================================

const setsChannel = supabase
  .channel("sets-realtime")
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "sets",
    },
    async (payload) => {
      if (!window.currentMatchId || !window.currentTournamentId) return;

      const updated = payload.new;
      if (!updated) return;

      if (updated.match_id !== window.currentMatchId) return;

      smoothUpdateSetRow(updated);
    }
  )
  .subscribe();

// ===========================================================
// DATABASE WRITE HELPERS
// ===========================================================

/**
 * Update the live set score (and optionally current thrower) for a match/set.
 *
 * Expects a `current_thrower` text column on the `sets` table.
 */
async function dbUpdateLiveSetScore({ matchId, setNumber, p1, p2, thrower }) {
  const patch = {
    score_player1: p1,
    score_player2: p2,
  };

  // Only send thrower if provided and non-empty
  if (typeof thrower === "string" && thrower.length > 0) {
    patch.current_thrower = thrower;
  }

  return await supabase
    .from("sets")
    .update(patch)
    .eq("match_id", matchId)
    .eq("set_number", setNumber);
}
