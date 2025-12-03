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

const scCurrentThrowerLabel = document.getElementById("scoring-current-thrower-label");

// Internal state
let scoringMatch = null;
let scoringCurrentSetSP1 = 0;
let scoringCurrentSetSP2 = 0;
let scoringCurrentThrower = "p1";
let scoringThrowHistory = [];

// ===========================================================
// INIT BUTTONS
// ===========================================================

function initScoringButtons() {
  if (!scoringButtonsContainer || !scoringMissContainer) return;

  scoringButtonsContainer.innerHTML = "";
  scoringMissContainer.innerHTML = "";

  // Miss (X)
  const missBtn = document.createElement("button");
  missBtn.className = "score-btn special";
  missBtn.textContent = "Miss (X)";
  missBtn.addEventListener("click", () => scoringAddScore(0, { isMiss: true }));
  scoringMissContainer.appendChild(missBtn);

  // 1–12 buttons
  for (let i = 1; i <= 12; i++) {
    const btn = document.createElement("button");
    btn.className = "score-btn";
    btn.textContent = i;
    btn.addEventListener("click", () => scoringAddScore(i));
    scoringButtonsContainer.appendChild(btn);
  }

  // Fault
  const faultBtn = document.createElement("button");
  faultBtn.className = "score-btn special wide";
  faultBtn.textContent = "Fault";
  faultBtn.addEventListener("click", () => scoringAddScore(0, { isFault: true }));
  scoringButtonsContainer.appendChild(faultBtn);

  // Undo
  const undoBtn = document.createElement("button");
  undoBtn.className = "score-btn danger wide";
  undoBtn.textContent = "Undo";
  undoBtn.addEventListener("click", scoringUndo);
  scoringButtonsContainer.appendChild(undoBtn);
}

// Make sure buttons exist once DOM is ready
window.addEventListener("DOMContentLoaded", initScoringButtons);

// ===========================================================
// OPEN / CLOSE
// ===========================================================

function openScoringConsole() {
  if (!scoringMatch) {
    console.warn("Scoring console opened without a match loaded.");
    return;
  }
  scoringConsole.style.display = "block";
}

function closeScoringConsole() {
  scoringConsole.style.display = "none";
}

if (scoringCloseBtn) {
  scoringCloseBtn.addEventListener("click", closeScoringConsole);
}

// ===========================================================
// RESET FOR MATCH
// Called from app.js: resetScoringStateForMatch(match, sets)
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
  };

  // expose for realtime updater
  window.scoringMatch = scoringMatch;


  // === FIND CURRENT LIVE SET (or next set number) ======================
  let currentSet = null;

  if (sets.length > 0) {
    const unfinished = sets.filter(
      (s) => !s.winner_player_id && (s.score_player1 ?? 0) < 50 && (s.score_player2 ?? 0) < 50
    );

    if (unfinished.length > 0) {
      // Highest-numbered unfinished set
      currentSet = unfinished.reduce((a, b) =>
        a.set_number > b.set_number ? a : b
      );
    } else {
      // All sets are finished: next one would be last set_number + 1
      const maxNum = Math.max(...sets.map((s) => s.set_number || 0));
      scoringMatch.currentSetNumber = maxNum + 1;
    }
  }

  if (!scoringMatch.currentSetNumber) {
    // If not already determined above
    if (currentSet) {
      scoringMatch.currentSetNumber = currentSet.set_number;
    } else if (sets.length > 0) {
      const maxNum = Math.max(...sets.map((s) => s.set_number || 0));
      scoringMatch.currentSetNumber = maxNum + 1;
    } else {
      scoringMatch.currentSetNumber = 1;
    }
  }

  // === INITIALISE SET SCORE ============================================
  if (currentSet && currentSet.set_number === scoringMatch.currentSetNumber) {
    scoringCurrentSetSP1 = currentSet.score_player1 || 0;
    scoringCurrentSetSP2 = currentSet.score_player2 || 0;
    scoringCurrentThrower = currentSet.current_thrower || "p1";
  } else {
    scoringCurrentSetSP1 = 0;
    scoringCurrentSetSP2 = 0;
    scoringCurrentThrower = "p1";
  }

  // === RESET THROW SEQUENCE (session-only) =============================
  scoringThrowHistory = [];

  // === UPDATE UI =======================================================
  scP1Name.textContent = scoringMatch.p1Name;
  scP2Name.textContent = scoringMatch.p2Name;

  scP1Sets.textContent = scoringMatch.setsP1;
  scP2Sets.textContent = scoringMatch.setsP2;

  scP1SP.textContent = scoringCurrentSetSP1;
  scP2SP.textContent = scoringCurrentSetSP2;

  scP1SetSP.textContent = scoringCurrentSetSP1;
  scP2SetSP.textContent = scoringCurrentSetSP2;

  scCurrentThrowerLabel.textContent =
    (scoringCurrentThrower === "p1" ? scoringMatch.p1Name : scoringMatch.p2Name) +
    " to throw";
}

// ===========================================================
// SCORING LOGIC – LIVE SET SCORE + THROWER TO DB + SET CREATION
// ===========================================================

async function scoringAddScore(score, opts = {}) {
  if (!scoringMatch) return;

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

  scoringThrowHistory.push({
    player: isP1 ? "p1" : "p2",
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
      .update({ winner_player_id: winningPlayer })
      .eq("match_id", scoringMatch.matchId)
      .eq("set_number", scoringMatch.currentSetNumber);

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

    // Create the next set
    await dbCreateNextSet(
      scoringMatch.matchId,
      scoringMatch.currentSetNumber
    );

    // Reset local state for the new set
    scoringMatch.currentSetNumber++;
    scoringCurrentSetSP1 = 0;
    scoringCurrentSetSP2 = 0;
    scoringThrowHistory = [];
    scoringCurrentThrower = "p1";

    scP1SetSP.textContent = "0";
    scP2SetSP.textContent = "0";
    scCurrentThrowerLabel.textContent =
      scoringMatch.p1Name + " to throw";

    return; // END OF SET-WIN LOGIC — do NOT switch thrower
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


// ===============================================================
// CREATE NEXT SET FOR A MATCH
// ===============================================================

async function dbCreateNextSet(matchId, previousSetNumber) {
  const nextNumber = previousSetNumber + 1;

  const { error } = await supabase
    .from("sets")
    .insert({
      match_id: matchId,
      set_number: nextNumber,
      score_player1: 0,
      score_player2: 0,
      winner_player_id: null
    });

  if (error) console.error("Create next set error:", error);
}

window.dbCreateNextSet = dbCreateNextSet;

// ===========================================================
// UNDO – SESSION + DB SET SCORE
// ===========================================================

async function scoringUndo() {
  if (!scoringMatch) return;
  if (scoringThrowHistory.length === 0) return;

  // Remove last throw from local history
  scoringThrowHistory.pop();

  // Rebuild local set score from remaining history
  scoringCurrentSetSP1 = 0;
  scoringCurrentSetSP2 = 0;
  scoringCurrentThrower = "p1";

  scoringThrowHistory.forEach((t) => {
    const isP1 = t.player === "p1";
    const score = t.score || 0;
    const isMiss = t.isMiss || score === 0;
    const isFault = t.isFault || false;

    if (isP1) {
      if (isMiss) {
        if (isFault && scoringCurrentSetSP1 >= 37) scoringCurrentSetSP1 = 25;
      } else {
        scoringCurrentSetSP1 += score;
        if (scoringCurrentSetSP1 > 50) scoringCurrentSetSP1 = 25;
      }
      scoringCurrentThrower = "p2";
    } else {
      if (isMiss) {
        if (isFault && scoringCurrentSetSP2 >= 37) scoringCurrentSetSP2 = 25;
      } else {
        scoringCurrentSetSP2 += score;
        if (scoringCurrentSetSP2 > 50) scoringCurrentSetSP2 = 25;
      }
      scoringCurrentThrower = "p1";
    }
  });

  // Update UI
  scP1SetSP.textContent = scoringCurrentSetSP1;
  scP2SetSP.textContent = scoringCurrentSetSP2;

  scCurrentThrowerLabel.textContent =
    (scoringCurrentThrower === "p1" ? scoringMatch.p1Name : scoringMatch.p2Name) +
    " to throw";

  // Update DB set row to rebuilt scores + thrower
  if (typeof dbUpdateLiveSetScore === "function") {
    await dbUpdateLiveSetScore({
      matchId: scoringMatch.matchId,
      setNumber: scoringMatch.currentSetNumber,
      p1: scoringCurrentSetSP1,
      p2: scoringCurrentSetSP2,
      thrower: scoringCurrentThrower,
    });
  }

  // Refresh view to reflect new scores
  if (typeof loadMatchDetail === "function") {
    loadMatchDetail(scoringMatch.matchId, scoringMatch.tournamentId);
  }
}

// ===========================================================
// EXPOSE GLOBALLY FOR app.js
// ===========================================================

window.openScoringConsole = openScoringConsole;
window.resetScoringStateForMatch = resetScoringStateForMatch;
