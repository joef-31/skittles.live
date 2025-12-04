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

let SCORER_NAME = localStorage.getItem("scorerProfile") || "Guest";

window.setScorerProfile = function(name) {
  SCORER_NAME = name;
  localStorage.setItem("scorerProfile", name);
};

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

// Save a throw into Supabase
async function dbInsertThrow({
  matchId,
  setId,
  setNumber,
  throwNumber,
  playerId,
  score,
  isMiss,
  isFault
}) {
  return await supabase.from("throws").insert({
    match_id: matchId,
    set_id: setId || null,     // <-- NEW
    set_number: setNumber,
    throw_number: throwNumber,
    player_id: playerId,
    score: score,
    is_miss: isMiss || false,
    is_fault: isFault || false
  });
}


// Update a set's small points + winner if needed
async function dbUpdateSet({ matchId, setNumber, sp1, sp2, winnerId }) {
  return await supabase.from("sets")
    .update({
      score_player1: sp1,
      score_player2: sp2,
      winner_player_id: winnerId || null
    })
    .eq("match_id", matchId)
    .eq("set_number", setNumber);
}


// ========================================================
// SCORING LOCK SYSTEM — SAFE + SELF-RECLAIMING
// ========================================================

// Who the scorer is (temporary local identity)
// Later: replace with supabase.auth.getUser()
const LOCAL_SCORER_ID = "local-user";

// Acquire or refresh lock (TTL = 25 seconds)
async function dbAcquireScoringLock(matchId) {
  const expiresAt = new Date(Date.now() + 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("scoring_locks")
    .upsert(
      {
        match_id: matchId,
        locked_by: SCORER_NAME,
        expires_at: expiresAt
      },
      { onConflict: "match_id" }
    )
    .select()
    .maybeSingle();

  return { data, error };
}

const scorerSelect = document.getElementById("profile-select");
if (scorerSelect) {
  scorerSelect.addEventListener("change", () => {
    window.currentScorer = scorerSelect.value;
  });
  window.currentScorer = scorerSelect.value; // initial
}

// Release lock
async function dbReleaseScoringLock(matchId) {
  await supabase
    .from("scoring_locks")
    .delete()
    .eq("match_id", matchId);
}

// Check lock state
async function dbCheckScoringLock(matchId) {
  const { data, error } = await supabase
    .from("scoring_locks")
    .select("*")
    .eq("match_id", matchId)
    .maybeSingle();

  if (!data) return { data, error: null };

  const now = Date.now();
  const expired =
    data.expires_at && new Date(data.expires_at).getTime() < now;

  // If it's your lock → you're allowed in
  if (data.locked_by === SCORER_NAME) return { data: null, error: null };

  if (expired) return { data: null, error: null };

  return { data, error: null };
}


// Refresh lock silently (only if you own it)
async function dbRefreshScoringLock(matchId) {
  const { data: lock } = await dbCheckScoringLock(matchId);
  if (!lock) return;

  if (lock.locked_by !== LOCAL_SCORER_ID) return;

  // Extend TTL
  const expiresAt = new Date(Date.now() + 25 * 1000).toISOString();
  await supabase
    .from("scoring_locks")
    .update({ expires_at: expiresAt })
    .eq("match_id", matchId);
}

// Refresh lock
async function refreshScoreButtonLock(matchId) {
  const scoreBtn = document.getElementById("scoreBtn");
  if (!scoreBtn) return;

  const { data: lock } = await dbCheckScoringLock(matchId);

  // who am I?
  const me = window.currentScorer || "Unknown";

  if (!lock) {
    // no lock
    scoreBtn.dataset.locked = "no";
    return;
  }

  // lock exists
  if (lock.locked_by === me) {
    // I own the lock – do NOT show "Locked"
    scoreBtn.dataset.locked = "no";
  } else {
    // someone else owns the lock
    scoreBtn.dataset.locked = "yes";
  }
}


// Auto-refresh every 10 seconds while console is open
setInterval(() => {
  const consoleVisible =
    document.getElementById("scoring-console")?.style.display === "block";

  if (consoleVisible && window.scoringMatch) {
    dbRefreshScoringLock(window.scoringMatch.matchId);
  }
}, 10_000);
