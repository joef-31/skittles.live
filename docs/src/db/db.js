// ===========================================================
// DATABASE HELPERS – SETS & THROWS
// ===========================================================

/**
 * Update the live set score (and optionally current thrower) for a match/set.
 *
 * Requires `current_thrower` text column on `sets` (can be NULL).
 */
async function dbUpdateLiveSetScore({
  matchId,
  setNumber,
  p1,
  p2,
  thrower
}) {
  const { error } = await supabaseClient
    .from("sets")
    .update({
      score_player1: p1,
      score_player2: p2,
      current_thrower: thrower
    })
    .eq("match_id", matchId)
    .eq("set_number", setNumber)
    .is("winner_player_id", null);

  if (error) {
    console.error("[dbUpdateLiveSetScore] failed", error);
  }
}

/**
 * Fetch the set row (id + fields) for a given match + set_number.
 */
async function dbGetSet(matchId, setNumber) {
  const { data, error } = await supabaseClient
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
async function dbGetOrCreateSet(matchId, setNumber, firstThrower = null) {
  const upsertRow = {
    match_id: matchId,
    set_number: setNumber,
    score_player1: 0,
    score_player2: 0,
    winner_player_id: null
  };

  if (firstThrower) {
    upsertRow.current_thrower = firstThrower;
  }

  const { data, error } = await supabaseClient
    .from("sets")
    .upsert(upsertRow, { onConflict: "match_id,set_number" })
    .select("*")
    .single();

  if (error) {
    console.error("dbGetOrCreateSet error:", error);
    return { data: null, error };
  }

  return { data, error: null };
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
  throwerSide,   // ← already passed in
  playerId,
  score,
  isMiss,
  isFault
}) {
  // Get next throw number (authoritative)
  const { data: rows, error: countErr } = await supabaseClient
    .from("throws")
    .select("throw_number")
    .eq("set_id", setId)
    .order("throw_number", { ascending: false })
    .limit(1);

  if (countErr) {
    console.error("[dbInsertThrow] failed to get last throw", countErr);
    throw countErr;
  }

  const nextThrowNumber =
    rows && rows.length ? rows[0].throw_number + 1 : 1;

  // Insert throw — INCLUDING side
  const { error: insertErr } = await supabaseClient
    .from("throws")
    .insert({
      match_id: matchId,
      set_id: setId,
      set_number: setNumber,
      throw_number: nextThrowNumber,
      side: throwerSide,          // THIS IS THE FIX
      player_id: playerId,
      score,
      is_miss: isMiss,
      is_fault: isFault
    });

  if (insertErr) {
    console.error("[dbInsertThrow] insert failed", insertErr);
    throw insertErr;
  }
}

/**
 * Update set small-points + optional winner.
 */
async function dbUpdateSet({ matchId, setNumber, sp1, sp2, winnerId }) {
  const { data, error } = await supabaseClient
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

  const { data, error } = await supabaseClient
    .from("sets")
    .upsert({
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

if (typeof window.initSetsMatchListRealtime === "function") {
  window.initSetsMatchListRealtime();
}

// expose helpers where needed
window.dbUpdateLiveSetScore = dbUpdateLiveSetScore;
window.dbGetSet = dbGetSet;
window.dbGetOrCreateSet = dbGetOrCreateSet;
window.dbInsertThrow = dbInsertThrow;
window.dbUpdateSet = dbUpdateSet;
window.dbCreateNextSet = dbCreateNextSet;