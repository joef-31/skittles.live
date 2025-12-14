// ===========================================================
// Supabase setup
// ===========================================================

const SUPABASE_URL = "https://gewdiegidqkfvikxscts.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdld2RpZWdpZHFrZnZpa3hzY3RzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2NjQwNDIsImV4cCI6MjA4MDI0MDA0Mn0.6qMeXabS49vULjxjlksbX2eXLDVyyChSxZPYKw2RAw4";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Make supabase available to other modules if needed
window.supabaseClient = supabase;

// ===========================================================
// DATABASE HELPERS – SETS & THROWS
// ===========================================================

/**
 * Update the live set score (and optionally current thrower) for a match/set.
 *
 * Requires `current_thrower` text column on `sets` (can be NULL).
 */
async function dbUpdateLiveSetScore({ matchId, setNumber, p1, p2, thrower }) {
  const patch = {
    score_player1: p1,
    score_player2: p2,
  };

  if (typeof thrower === "string" && thrower.length > 0) {
    patch.current_thrower = thrower;
  }

  const { data, error } = await supabase
    .from("sets")
    .update(patch)
    .eq("match_id", matchId)
    .eq("set_number", setNumber);

  if (error) {
    console.error("dbUpdateLiveSetScore error:", error);
  }

  return { data, error };
}

/**
 * Fetch the set row (id + fields) for a given match + set_number.
 */
async function dbGetSet(matchId, setNumber) {
  const { data, error } = await supabase
    .from("sets")
    .select("*")
    .eq("match_id", matchId)
    .eq("set_number", setNumber)
    .maybeSingle();

  if (error) {
    console.error("dbGetSet error:", error);
  }

  return { data, error };
}

/**
 * Get or create a set row for (matchId, setNumber).
 * Used so throws always have a valid set_id.
 */
async function dbGetOrCreateSet(matchId, setNumber) {
  let { data, error } = await dbGetSet(matchId, setNumber);

  if (!error && data) {
    return { data, error: null };
  }

  // Create if not existing
  const insertPayload = {
    match_id: matchId,
    set_number: setNumber,
    score_player1: 0,
    score_player2: 0,
    winner_player_id: null,
  };

  const result = await supabase
    .from("sets")
    .insert(insertPayload)
    .select("*")
    .maybeSingle();

  if (result.error) {
    console.error("dbGetOrCreateSet insert error:", result.error);
    return { data: null, error: result.error };
  }

  return { data: result.data, error: null };
}

/**
 * Insert one throw, with correct set_id + set_number.
 * 
 * Expects:
 *  - matchId: uuid
 *  - setId: uuid (if you already resolved it – optional)
 *  - setNumber: integer
 *  - throwNumber: integer (1-based)
 *  - playerId: uuid
 *  - score: integer
 *  - isMiss: boolean
 *  - isFault: boolean
 */
async function dbInsertThrow({
  matchId,
  setId,
  setNumber,
  throwNumber,
  playerId,
  score,
  isMiss,
  isFault,
}) {
  const record = {
    match_id: matchId,
    set_id: setId || null,
    set_number: setNumber,
    throw_number: throwNumber,
    player_id: playerId,
    score: score,
    is_miss: !!isMiss,
    is_fault: !!isFault,
  };

  const { data, error } = await supabase.from("throws").insert(record);

  if (error) {
    console.error("dbInsertThrow error:", error, record);
  }

  return { data, error };
}

/**
 * Update set small-points + optional winner.
 */
async function dbUpdateSet({ matchId, setNumber, sp1, sp2, winnerId }) {
  const { data, error } = await supabase
    .from("sets")
    .update({
      score_player1: sp1,
      score_player2: sp2,
      winner_player_id: winnerId || null,
    })
    .eq("match_id", matchId)
    .eq("set_number", setNumber);

  if (error) {
    console.error("dbUpdateSet error:", error);
  }

  return { data, error };
}

/**
 * Create NEXT set with small-points reset. Used when a set is won.
 */
async function dbCreateNextSet(matchId, previousSetNumber) {
  const nextNumber = previousSetNumber + 1;

  const { data, error } = await supabase
    .from("sets")
    .insert({
      match_id: matchId,
      set_number: nextNumber,
      score_player1: 0,
      score_player2: 0,
      winner_player_id: null,
    });

  if (error) {
    console.error("dbCreateNextSet error:", error);
  }

  return { data, error };
}

// expose helpers where needed
window.dbUpdateLiveSetScore = dbUpdateLiveSetScore;
window.dbGetSet = dbGetSet;
window.dbGetOrCreateSet = dbGetOrCreateSet;
window.dbInsertThrow = dbInsertThrow;
window.dbUpdateSet = dbUpdateSet;
window.dbCreateNextSet = dbCreateNextSet;

// ========================================================
// (OLD) SCORING LOCK SYSTEM – now unused, left for reference
// ========================================================
// You can delete this section once you're happy everything works
// without locks. They are no longer called anywhere.

/**
 * Create or refresh a scoring lock (no longer used).
 */
async function dbAcquireScoringLock(matchId, scorerName) {
  const expiresAt = new Date(Date.now() + 60 * 1000).toISOString(); // 60 seconds

  const { data, error } = await supabase
    .from("scoring_locks")
    .upsert(
      {
        match_id: matchId,
        locked_by: scorerName,
        expires_at: expiresAt,
      },
      { onConflict: "match_id" }
    )
    .select()
    .maybeSingle();

  if (error) {
    console.error("dbAcquireScoringLock error:", error);
  }
  return { data, error };
}

/**
 * Release lock (no longer used).
 */
async function dbReleaseScoringLock(matchId) {
  const { error } = await supabase
    .from("scoring_locks")
    .delete()
    .eq("match_id", matchId);

  if (error) {
    console.error("dbReleaseScoringLock error:", error);
  }
}

/**
 * Check lock (no longer used).
 */
async function dbCheckScoringLock(matchId) {
  const { data, error } = await supabase
    .from("scoring_locks")
    .select("*")
    .eq("match_id", matchId)
    .maybeSingle();

  if (error) {
    console.error("dbCheckScoringLock error:", error);
  }
  return { data, error };
}

// (not exported to window on purpose)
