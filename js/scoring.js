// ===========================================================
// SCORING CONSOLE – LIVE SET SCORE + THROWER SYNC (Supabase)
// ===========================================================

// DOM references
const scoringConsole = document.getElementById("scoring-console");
const scoringCloseBtn = document.getElementById("scoring-close-btn");
const scoringButtonsContainer = document.getElementById("scoring-buttons");
const scoringMissContainer = document.getElementById("scoring-miss-container");

const scP1Name = document.getElementById("scoring-p1-name");
const scP2Name = document.getElementById("scoring-p2-name");

const scP1Sets = document.getElementById("scoring-p1-sets");
const scP2Sets = document.getElementById("scoring-p2-sets");

const scP1SP = document.getElementById("scoring-p1-sp");
const scP2SP = document.getElementById("scoring-p2-sp");

const scP1SetSP = document.getElementById("scoring-p1-setsp");
const scP2SetSP = document.getElementById("scoring-p2-setsp");

const scCurrentThrowerLabel = document.getElementById(
  "scoring-current-thrower-label"
);

// Overlay for starting match/sets
const startOverlay = document.getElementById("start-set-overlay");
const startOverlayTitle = document.getElementById("start-set-title");
const startOverlaySub = document.getElementById("start-set-sub");
const startSetWithP1Btn = document.getElementById("start-set-with-p1");
const startSetWithP2Btn = document.getElementById("start-set-with-p2");
const endMatchBtn = document.getElementById("end-match-btn");

// Current set id (uuid from sets table)
let scoringCurrentSetId = null;

// Internal state
let scoringMatch = null;
let scoringCurrentSetSP1 = 0;
let scoringCurrentSetSP2 = 0;
let scoringCurrentThrower = "p1"; // "p1" or "p2"
let scoringThrowHistory = []; // session-only, only for current set

// ===========================================================
// INIT BUTTONS — NEW UI
// ===========================================================

function initScoringButtons() {
  if (!scoringButtonsContainer || !scoringMissContainer) return;

  scoringButtonsContainer.innerHTML = "";
  scoringMissContainer.innerHTML = "";

  // NUMBERS 1–12 in grid
  for (let i = 1; i <= 12; i++) {
    const btn = document.createElement("button");
    btn.className = "score-btn num-btn";
    btn.textContent = i;
    btn.addEventListener("click", () => scoringAddScore(i));
    scoringButtonsContainer.appendChild(btn);
  }

  // MISS (X)
  const missBtn = document.createElement("button");
  missBtn.className = "score-btn special big-btn";
  missBtn.textContent = "X";
  missBtn.addEventListener("click", () => scoringAddScore(0, { isMiss: true }));
  scoringMissContainer.appendChild(missBtn);

  // FAULT
  const faultBtn = document.createElement("button");
  faultBtn.className = "score-btn special big-btn fullwidth";
  faultBtn.textContent = "FAULT";
  faultBtn.addEventListener("click", () => scoringAddScore(0, { isFault: true }));
  scoringButtonsContainer.appendChild(faultBtn);

  // UNDO
  const undoBtn = document.createElement("button");
  undoBtn.className = "score-btn danger big-btn fullwidth";
  undoBtn.textContent = "UNDO";
  undoBtn.addEventListener("click", scoringUndo);
  scoringButtonsContainer.appendChild(undoBtn);
}

window.addEventListener("DOMContentLoaded", initScoringButtons);

// ===========================================================
// START SET OVERLAY SHOW / HIDE
// ===========================================================

function showStartSetOverlay() {
  if (!startOverlay || !scoringMatch) return;

  const setNum = scoringMatch.currentSetNumber || 1;
  const isFirstSet = setNum === 1 && scoringMatch.status === "scheduled";

  startOverlayTitle.textContent = isFirstSet
    ? "Start match"
    : `Start set ${setNum}`;

  startOverlaySub.textContent = `Who throws first?`;

  // Put team names on buttons
  startSetWithP1Btn.textContent = `Start set with ${scoringMatch.p1Name}`;
  startSetWithP2Btn.textContent = `Start set with ${scoringMatch.p2Name}`;

  startOverlay.style.display = "flex";
}

function hideStartSetOverlay() {
  if (!startOverlay) return;
  startOverlay.style.display = "none";
}

if (startSetWithP1Btn) {
  startSetWithP1Btn.addEventListener("click", () =>
    scoringStartSet("p1")
  );
}
if (startSetWithP2Btn) {
  startSetWithP2Btn.addEventListener("click", () =>
    scoringStartSet("p2")
  );
}
if (endMatchBtn) {
  endMatchBtn.addEventListener("click", scoringEndMatch);
}

async function scoringStartSet(firstThrower) {
  if (!scoringMatch) return;

  const matchId   = scoringMatch.matchId;
  const setNumber = scoringMatch.currentSetNumber || 1;

  // 1. If match is still scheduled, mark it live
  if (scoringMatch.status === "scheduled") {
    await supabase
      .from("matches")
      .update({ status: "live" })
      .eq("id", matchId);

    scoringMatch.status = "live";
  }

  // 2. Ensure we have a set row – but do NOT trust its thrower
  const { data: setRow, error } = await dbGetOrCreateSet(
    matchId,
    setNumber,
    null // <-- don't let dbGetOrCreateSet decide the thrower
  );
  if (error || !setRow) {
    console.error("Failed to get/create set:", error);
    return;
  }

  // 3. BUTTON CHOICE IS SUPREME: push it into the DB
  const chosenThrower = firstThrower || "p1";

  const { data: updatedSet, error: updErr } = await supabase
    .from("sets")
    .update({ current_thrower: chosenThrower })
    .eq("id", setRow.id)
    .select()
    .maybeSingle();

  if (updErr) {
    console.error("Failed to set starting thrower:", updErr);
  }

  // 4. Update local state from the DB row
  const effectiveSet = updatedSet || setRow;

  scoringCurrentSetId  = effectiveSet.id;
  scoringCurrentThrower = chosenThrower;
  scoringCurrentSetSP1 = effectiveSet.score_player1 || 0;
  scoringCurrentSetSP2 = effectiveSet.score_player2 || 0;
  scoringThrowHistory  = [];

  // 5. UI
  scP1SetSP.textContent = scoringCurrentSetSP1;
  scP2SetSP.textContent = scoringCurrentSetSP2;

  scCurrentThrowerLabel.textContent =
    (scoringCurrentThrower === "p1"
      ? scoringMatch.p1Name
      : scoringMatch.p2Name) + " to throw";

  hideStartSetOverlay();
}
window.scoringStartSet = scoringStartSet;

async function scoringEndMatch() {
  if (!scoringMatch) return;

  const matchId = scoringMatch.matchId;

  await supabase
    .from("matches")
    .update({ status: "finished" })
    .eq("id", matchId);

  scoringMatch.status = "finished";

  hideStartSetOverlay();
  closeScoringConsole();

  // Reload match detail so UI shows FINISHED
  if (typeof loadMatchDetail === "function") {
    loadMatchDetail(matchId, scoringMatch.tournamentId);
  }
}
window.scoringEndMatch = scoringEndMatch;

// ===========================================================
// OPEN / CLOSE CONSOLE
// ===========================================================

async function openScoringConsole() {
  if (!scoringMatch) return;

  // OPTIONAL: profile-based gating (for now just SUPERADMIN override)
  if (window.canCurrentProfileScore) {
    const allowed = window.canCurrentProfileScore(scoringMatch);
    if (!allowed) {
      alert("Your current profile is not allowed to score this match.");
      return;
    }
  } else if (!SUPERADMIN) {
    // Fallback: if we turn off SUPERADMIN and have no profile system, block
    alert("Scoring disabled (no profile system configured).");
    return;
  }

  scoringConsole.style.display = "block";

  // If there is no active set row yet (new match or between sets), show overlay
  if (!scoringCurrentSetId && scoringMatch.status !== "finished") {
    showStartSetOverlay();
  } else {
    hideStartSetOverlay();
  }
}

function closeScoringConsole() {
  if (!scoringConsole) return;
  scoringConsole.style.display = "none";
  hideStartSetOverlay();
}

if (scoringCloseBtn) {
  scoringCloseBtn.addEventListener("click", closeScoringConsole);
}

// ===========================================================
// RESET FOR MATCH – called from app.js
// resetScoringStateForMatch(match, sets)
// ===========================================================

function resetScoringStateForMatch(match, sets) {
  sets = sets || [];

  scoringMatch = {
    matchId: match.id,
    tournamentId: match.tournament?.id,
    p1Id: match.player1?.id,
    p2Id: match.player2?.id,
    p1Name: match.player1?.name || "Player 1",
    p2Name: match.player2?.name || "Player 2",
    setsP1: match.final_sets_player1 ?? 0,
    setsP2: match.final_sets_player2 ?? 0,
    status: match.status || "scheduled",
  };

  window.scoringMatch = scoringMatch;

  // Find current active set (unfinished, <50–<50)
  let currentSet = null;
  if (sets.length > 0) {
    const unfinished = sets.filter(
      (s) =>
        !s.winner_player_id &&
        (s.score_player1 ?? 0) < 50 &&
        (s.score_player2 ?? 0) < 50
    );
    if (unfinished.length > 0) {
      currentSet = unfinished.reduce((a, b) =>
        a.set_number > b.set_number ? a : b
      );
    }
  }

  if (currentSet) {
    scoringMatch.currentSetNumber = currentSet.set_number;
    scoringCurrentSetId = currentSet.id;
    scoringCurrentSetSP1 = currentSet.score_player1 || 0;
    scoringCurrentSetSP2 = currentSet.score_player2 || 0;
    scoringCurrentThrower = currentSet.current_thrower || "p1";
} else {
  const maxNum =
    sets.length > 0
      ? Math.max(...sets.map((s) => s.set_number || 0))
      : 0;
  scoringMatch.currentSetNumber = maxNum + 1;
  scoringCurrentSetId  = null;
  scoringCurrentSetSP1 = 0;
  scoringCurrentSetSP2 = 0;
  // no default thrower – wait for the start-set buttons
  scoringCurrentThrower = null;
}

  scoringThrowHistory = [];

  // UI
  scP1Name.textContent = scoringMatch.p1Name;
  scP2Name.textContent = scoringMatch.p2Name;

  scP1Sets.textContent = scoringMatch.setsP1;
  scP2Sets.textContent = scoringMatch.setsP2;

  scP1SP.textContent = 0; // overall SP can be added later
  scP2SP.textContent = 0;

  scP1SetSP.textContent = scoringCurrentSetSP1;
  scP2SetSP.textContent = scoringCurrentSetSP2;

if (scoringCurrentThrower === "p1" || scoringCurrentThrower === "p2") {
  scCurrentThrowerLabel.textContent =
    (scoringCurrentThrower === "p1"
      ? scoringMatch.p1Name
      : scoringMatch.p2Name) + " to throw";
} else {
  scCurrentThrowerLabel.textContent = "–";
}

  // We no longer show the overlay here because the console may be closed.
  // The overlay is shown when the console actually opens (openScoringConsole)
}

// ===========================================================
// SCORING LOGIC – LIVE SET SCORE + THROWS + SET CREATION
// ===========================================================

async function scoringAddScore(score, opts = {}) {
  if (!scoringMatch) return;

  // Make sure we actually have a set row + set id
  if (!scoringCurrentSetId) {
    const { data: setRow, error } = await dbGetOrCreateSet(
      scoringMatch.matchId,
      scoringMatch.currentSetNumber,
      scoringCurrentThrower
    );
    if (error || !setRow) {
      console.error("Cannot ensure set row before scoring:", error);
      return;
    }
    scoringCurrentSetId = setRow.id;
  }

  const isMiss = opts.isMiss || score === 0;
  const isFault = opts.isFault || false;
  const isP1 = scoringCurrentThrower === "p1";

  // ===== APPLY LOCAL SCORING =====
  if (isP1) {
    if (isMiss) {
      if (isFault && scoringCurrentSetSP1 >= 37) scoringCurrentSetSP1 = 25;
    } else {
      scoringCurrentSetSP1 += score;
      if (scoringCurrentSetSP1 > 50) scoringCurrentSetSP1 = 25;
    }
  } else {
    if (isMiss) {
      if (isFault && scoringCurrentSetSP2 >= 37) scoringCurrentSetSP2 = 25;
    } else {
      scoringCurrentSetSP2 += score;
      if (scoringCurrentSetSP2 > 50) scoringCurrentSetSP2 = 25;
    }
  }

  // ===== SAVE THROW LOCALLY FOR immediate per-set undo (optional) =====
  scoringThrowHistory.push({
    player: isP1 ? "p1" : "p2",
    score,
    isMiss,
    isFault
  });

  // ===== DETERMINE THROW NUMBER FROM DB (robust to reloads/undos) =====
  let throwNumber = scoringThrowHistory.length;
  try {
    const { data: existingThrows } = await supabase
      .from("throws")
      .select("id")
      .eq("match_id", scoringMatch.matchId)
      .eq("set_number", scoringMatch.currentSetNumber);

    const count = existingThrows ? existingThrows.length : 0;
    throwNumber = count + 1;
  } catch (e) {
    console.warn("Failed to count existing throws, falling back to local history length.");
  }

  const playerId = isP1 ? scoringMatch.p1Id : scoringMatch.p2Id;

  // ===== INSERT THROW INTO DB =====
  await dbInsertThrow({
    matchId: scoringMatch.matchId,
    setId: scoringCurrentSetId,
    setNumber: scoringMatch.currentSetNumber,
    throwNumber,
    playerId,
    score,
    isMiss,
    isFault
  });

  // ===== UPDATE LOCAL UI =====
  scP1SetSP.textContent = scoringCurrentSetSP1;
  scP2SetSP.textContent = scoringCurrentSetSP2;

  // ===============================================================
  // CHECK FOR SET WIN (50 POINT SET)
  // ===============================================================
  let winningPlayer = null;

  if (scoringCurrentSetSP1 === 50 && scoringCurrentSetSP2 < 50) {
    winningPlayer = scoringMatch.p1Id;
  }
  if (scoringCurrentSetSP2 === 50 && scoringCurrentSetSP1 < 50) {
    winningPlayer = scoringMatch.p2Id;
  }

  if (winningPlayer) {
    // Mark set winner
    await supabase
      .from("sets")
      .update({
        winner_player_id: winningPlayer,
        score_player1: scoringCurrentSetSP1,
        score_player2: scoringCurrentSetSP2
      })
      .eq("id", scoringCurrentSetId);

    // Update match set scores
    if (winningPlayer === scoringMatch.p1Id) {
      scoringMatch.setsP1++;
    } else {
      scoringMatch.setsP2++;
    }

    await supabase
      .from("matches")
      .update({
        final_sets_player1: scoringMatch.setsP1,
        final_sets_player2: scoringMatch.setsP2
      })
      .eq("id", scoringMatch.matchId);

    // Refresh header score in match detail
    if (typeof updateOverallMatchScore === "function") {
      await updateOverallMatchScore();
    }

// === PREPARE FOR NEXT SET (BUT DO NOT START IT YET) =========
scoringMatch.currentSetNumber++;
scoringCurrentSetId  = null;
scoringCurrentSetSP1 = 0;
scoringCurrentSetSP2 = 0;
scoringThrowHistory  = [];
// Do NOT pre-pick the next thrower – wait for the buttons
scoringCurrentThrower = null;

scP1SetSP.textContent = "0";
scP2SetSP.textContent = "0";
scCurrentThrowerLabel.textContent = "–";

showStartSetOverlay();
return; // Do NOT switch thrower after set win
  }

  // ===== NORMAL THROWER SWITCH =====
  scoringCurrentThrower = isP1 ? "p2" : "p1";
  scCurrentThrowerLabel.textContent =
    (scoringCurrentThrower === "p1" ? scoringMatch.p1Name : scoringMatch.p2Name) +
    " to throw";

  // ===== SAVE SET SCORE + THROWER TO DB =====
  await dbUpdateLiveSetScore({
    matchId: scoringMatch.matchId,
    setNumber: scoringMatch.currentSetNumber,
    p1: scoringCurrentSetSP1,
    p2: scoringCurrentSetSP2,
    thrower: scoringCurrentThrower
  });

  // ===== REFRESH MATCH DETAIL ONLY IF CONSOLE IS CLOSED =====
  if (scoringConsole.style.display === "none") {
    loadMatchDetail(scoringMatch.matchId, scoringMatch.tournamentId);
  }
}

// ===========================================================
// UNDO – DB-DRIVEN, WORKS EVEN AFTER SET WIN
// ===========================================================

async function scoringUndo() {
  if (!scoringMatch) return;

  const matchId = scoringMatch.matchId;

  // 1. Find the last throw in this match (any set)
  const { data: lastThrow, error: lastErr } = await supabase
    .from("throws")
    .select("*")
    .eq("match_id", matchId)
    .order("set_number", { ascending: false })
    .order("throw_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastErr) {
    console.error("Undo: error selecting last throw:", lastErr);
    return;
  }
  if (!lastThrow) {
    // nothing to undo
    return;
  }

  const setNumber = lastThrow.set_number;
  const setId = lastThrow.set_id;

  if (!setNumber || !setId) {
    console.error("Undo: last throw missing set_number or set_id");
    return;
  }

  // 2. Get the set row to know previous winner (for match correction)
  const { data: setRow, error: setErr } = await supabase
    .from("sets")
    .select("*")
    .eq("id", setId)
    .maybeSingle();

  if (setErr || !setRow) {
    console.error("Undo: failed to load set row:", setErr);
    return;
  }

  const prevWinner = setRow.winner_player_id;

  // 3. Delete that throw
  const { error: delErr } = await supabase
    .from("throws")
    .delete()
    .eq("id", lastThrow.id);

  if (delErr) {
    console.error("Undo: failed to delete throw:", delErr);
    return;
  }

  // 4. Load remaining throws for this set
  const { data: remainingThrows, error: remErr } = await supabase
    .from("throws")
    .select("*")
    .eq("match_id", matchId)
    .eq("set_number", setNumber)
    .order("throw_number", { ascending: true });

  if (remErr) {
    console.error("Undo: failed to load remaining throws:", remErr);
    return;
  }

  // 5. Rebuild scores using the same model as display logic
  const p1Id = scoringMatch?.p1Id || setRow.player1_id || lastThrow.player1_id;
  const p2Id = scoringMatch?.p2Id || setRow.player2_id || lastThrow.player2_id;

  const model = (typeof buildThrowsModel === "function")
    ? buildThrowsModel(remainingThrows || [], p1Id, p2Id)
    : [];

  let newSP1 = 0;
  let newSP2 = 0;
  let nextThrower = "p1";

  if (model.length > 0) {
    const last = model[model.length - 1];
    newSP1 = last.cumP1;
    newSP2 = last.cumP2;
    nextThrower = last.isP1 ? "p2" : "p1";
  } else {
    // No throws left in this set -> reset scores, fallback to p1
    newSP1 = 0;
    newSP2 = 0;
    nextThrower = "p1";
  }

  // 6. Determine new winner for the set
  let newWinnerId = null;
  if (newSP1 === 50 && newSP2 < 50) {
    newWinnerId = p1Id;
  } else if (newSP2 === 50 && newSP1 < 50) {
    newWinnerId = p2Id;
  }

  // 7. Update set row
  const { error: updSetErr } = await supabase
    .from("sets")
    .update({
      score_player1: newSP1,
      score_player2: newSP2,
      current_thrower: nextThrower,
      winner_player_id: newWinnerId
    })
    .eq("id", setId);

  if (updSetErr) {
    console.error("Undo: failed to update set:", updSetErr);
  }

  // 8. If winner changed, adjust match final set scores
  if (prevWinner !== newWinnerId) {
    const { data: matchRow, error: mErr } = await supabase
      .from("matches")
      .select("id, player1_id, player2_id, final_sets_player1, final_sets_player2")
      .eq("id", matchId)
      .maybeSingle();

    if (!mErr && matchRow) {
      let setsP1 = matchRow.final_sets_player1 ?? 0;
      let setsP2 = matchRow.final_sets_player2 ?? 0;

      const mp1 = matchRow.player1_id;
      const mp2 = matchRow.player2_id;

      // remove previous winner
      if (prevWinner === mp1) setsP1 = Math.max(0, setsP1 - 1);
      if (prevWinner === mp2) setsP2 = Math.max(0, setsP2 - 1);

      // add new winner (if any)
      if (newWinnerId === mp1) setsP1++;
      if (newWinnerId === mp2) setsP2++;

      await supabase
        .from("matches")
        .update({
          final_sets_player1: setsP1,
          final_sets_player2: setsP2
        })
        .eq("id", matchId);

      // also update local scoringMatch
      scoringMatch.setsP1 = setsP1;
      scoringMatch.setsP2 = setsP2;

      if (typeof updateOverallMatchScore === "function") {
        await updateOverallMatchScore();
      }
    }
  }

  // 9. Update local JS state for current set
  scoringMatch.currentSetNumber = setNumber;
  scoringCurrentSetId = setId;
  scoringCurrentSetSP1 = newSP1;
  scoringCurrentSetSP2 = newSP2;
  scoringCurrentThrower = nextThrower;

  // Rebuild in-memory throwHistory from remainingThrows
  scoringThrowHistory = (remainingThrows || []).map((t) => {
    const isP1Throw = t.player_id === p1Id;
    const raw = t.score ?? 0;
    const isMiss = t.is_miss || raw === 0;
    const isFault = t.is_fault || false;
    return {
      player: isP1Throw ? "p1" : "p2",
      score: raw,
      isMiss,
      isFault
    };
  });

  // 10. Update scoring console UI
  scP1SetSP.textContent = scoringCurrentSetSP1;
  scP2SetSP.textContent = scoringCurrentSetSP2;
  scCurrentThrowerLabel.textContent =
    (scoringCurrentThrower === "p1"
      ? scoringMatch.p1Name
      : scoringMatch.p2Name) + " to throw";

  // 11. Refresh live throw view (header + set row)
  if (typeof updateLiveThrowsForSet === "function") {
    updateLiveThrowsForSet(setNumber);
  }

  // 12. If we just undid the only scoring throw that gave someone 50,
  //     we might need to hide the start-next-set overlay.
  if (!newWinnerId && startOverlay) {
    hideStartSetOverlay();
  }
}

// ===========================================================
// EXPOSE GLOBALLY
// ===========================================================

window.openScoringConsole = openScoringConsole;
window.resetScoringStateForMatch = resetScoringStateForMatch;
