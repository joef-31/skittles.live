// ===========================================================
// Supabase setup
// ===========================================================

const SUPERADMIN = true; // toggle false to hide scoring button

const SUPABASE_URL = "https://gewdiegidqkfvikxscts.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdld2RpZWdpZHFrZnZpa3hzY3RzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2NjQwNDIsImV4cCI6MjA4MDI0MDA0Mn0.6qMeXabS49vULjxjlksbX2eXLDVyyChSxZPYKw2RAw4";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

// ========================================================
// SCORING LOCK SYSTEM
// ========================================================

// Create or refresh a scoring lock
async function dbAcquireScoringLock(matchId, scorerName) {
  const expiresAt = new Date(Date.now() + 60 * 1000).toISOString(); // 60 seconds

  const { data, error } = await supabase
    .from("scoring_locks")
    .upsert({
      match_id: matchId,
      locked_by: scorerName,
      expires_at: expiresAt
    }, { onConflict: "match_id" })
    .select()
    .maybeSingle();

  return { data, error };
}

// Release the lock
async function dbReleaseScoringLock(matchId) {
  await supabase.from("scoring_locks").delete().eq("match_id", matchId);
}

// Check existing lock
async function dbCheckScoringLock(matchId) {
  const { data, error } = await supabase
    .from("scoring_locks")
    .select("*")
    .eq("match_id", matchId)
    .maybeSingle();

  return { data, error };
}
