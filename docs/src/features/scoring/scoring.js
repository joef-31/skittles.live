// ===========================================================
// SCORING CONSOLE – DROP-IN (OLD BEHAVIOUR)
// ===========================================================

// file:// safe
// No imports
// No exports

window.App = window.App || {};
App.Features = App.Features || {};
App.Features.Scoring = App.Features.Scoring || {};

window.isScoringConsoleOpen = false;

// DOM references
const scP1Name = document.getElementById("scoring-p1-name");
const scP2Name = document.getElementById("scoring-p2-name");

const scP1Sets = document.getElementById("scoring-p1-sets");
const scP2Sets = document.getElementById("scoring-p2-sets");

/* const scP1SetSP = document.getElementById("scoring-p1-setsp");
const scP2SetSP = document.getElementById("scoring-p2-setsp"); */

const scCurrentThrowerLabel = document.getElementById(
  "scoring-current-thrower-label"
);

// -----------------------------------------------------------
// Internal state (IDENTICAL to old app)
// -----------------------------------------------------------

let scoringMatch = null;
let scoringCurrentSetId = null;
let scoringCurrentSetSP1 = 0;
let scoringCurrentSetSP2 = 0;
let scoringCurrentThrower = null;
let scoringThrowHistory = [];
let scoringConsecutiveMisses = { p1: 0, p2: 0 };

// -----------------------------------------------------------
// OPEN / CLOSE CONSOLE
// -----------------------------------------------------------

App.Features.Scoring.openConsole = async function () {
  const root = document.getElementById("scoring-console");
  if (!root || !scoringMatch) return;
  
    window.isScoringConsoleOpen = true;

	const canScore =
	  window.App?.Auth?.canScoreMatch?.({
		id: scoringMatch.matchId,
		player1_id: scoringMatch.p1Id,
		player2_id: scoringMatch.p2Id
	  }) === true;

  mountScoringConsole({
    mode: canScore ? "allowed" : "forbidden"
  });

  root.style.display = "block";

  if (!canScore) return;

  await recalcMatchSmallPoints(scoringMatch.matchId);
  updateScoringHeaderUI();
  syncStartSetUI();
  updateStartSetVisibility();
};

function closeScoringConsole() {
  const el = document.getElementById("scoring-console");
  if (!el) return;
  el.style.display = "none";
  
    window.isScoringConsoleOpen = false;
}

window.refreshScoringConsoleIfOpen = function () {
  if (!window.isScoringConsoleOpen) return;

  const root = document.getElementById("scoring-console");
  if (!root || !window.scoringMatch) return;

const canScore =
  window.App?.Auth?.canScoreMatch?.({
    id: scoringMatch.matchId,
    player1_id: scoringMatch.p1Id,
    player2_id: scoringMatch.p2Id
  }) === true;

  mountScoringConsole({
    mode: canScore ? "allowed" : "forbidden"
  });

  root.style.display = "block";
};


// -----------------------------------------------------------
// RESET FOR MATCH (CALLED FROM MATCH DETAIL)
// -----------------------------------------------------------

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
    status: match.status || "scheduled"
  };

  window.scoringMatch = scoringMatch;

  let currentSet = null;
  if (sets.length > 0) {
    const unfinished = sets.filter(
      s =>
        !s.winner_player_id &&
        (s.score_player1 ?? 0) < 50 &&
        (s.score_player2 ?? 0) < 50
    );
    if (unfinished.length) {
      currentSet = unfinished.reduce((a, b) =>
        a.set_number > b.set_number ? a : b
      );
    }
  }

  if (currentSet) {
    scoringCurrentSetId = currentSet.id;
    scoringCurrentSetSP1 = currentSet.score_player1 || 0;
    scoringCurrentSetSP2 = currentSet.score_player2 || 0;
    scoringCurrentThrower = currentSet.current_thrower || "p1";
    scoringMatch.currentSetNumber = currentSet.set_number;
  } else {
    const maxSet = sets.length
      ? Math.max(...sets.map(s => s.set_number || 0))
      : 0;
    scoringMatch.currentSetNumber = maxSet + 1;
    scoringCurrentSetId = null;
    scoringCurrentSetSP1 = 0;
    scoringCurrentSetSP2 = 0;
    scoringCurrentThrower = null;
  }

  scoringThrowHistory = [];
  scoringConsecutiveMisses = { p1: 0, p2: 0 };

  updateScoringHeaderUI();
  updateStartSetVisibility();
	syncStartSetUI();
	
	wireEndMatchButton();
	}

window.resetScoringStateForMatch = resetScoringStateForMatch;

// -----------------------------------------------------------
// START SET OVERLAY
// -----------------------------------------------------------

function updateStartSetVisibility() {
  const overlay = document.getElementById("start-set-overlay");
  if (!overlay || !scoringMatch) return;

  const noActiveSet = !scoringCurrentSetId;
  const noThrower = !scoringCurrentThrower;
  const matchFinished = scoringMatch.status === "finished";

  // Show ONLY when starting a set or thrower not yet defined
  if (!matchFinished && (noActiveSet || noThrower)) {
    overlay.style.display = "flex";
  } else {
    overlay.style.display = "none";
  }
}

// -----------------------------------------------------------
// START SET
// -----------------------------------------------------------

async function scoringStartSet(firstThrower) {
	console.log("[scoring] start set", scoringMatch.currentSetNumber, firstThrower);
  if (!scoringMatch) return;

  if (scoringMatch.status === "scheduled") {
    await window.supabaseClient
      .from("matches")
      .update({ status: "live" })
      .eq("id", scoringMatch.matchId);
    scoringMatch.status = "live";
  }

  const { data: setRow } = await dbGetOrCreateSet(
    scoringMatch.matchId,
    scoringMatch.currentSetNumber,
    null
  );
  
	const setNumber = scoringMatch.currentSetNumber;
	
	syncStartSetUI();
	syncLiveSetScoreUI();
	updateLiveThrowsForSet(setNumber);

  await window.supabaseClient
    .from("sets")
    .update({ current_thrower: firstThrower })
    .eq("id", setRow.id);

	scoringCurrentSetId = setRow.id;
	scoringCurrentThrower = firstThrower;
	scoringCurrentSetSP1 = setRow.score_player1 || 0;
	scoringCurrentSetSP2 = setRow.score_player2 || 0;
	scoringThrowHistory = [];

	updateStartSetVisibility();
	updateScoringHeaderUI();
}

window.scoringStartSet = scoringStartSet;

// -----------------------------------------------------------
// SCORING
// -----------------------------------------------------------

async function scoringAddScore(score, opts = {}) {
  if (!scoringMatch || !scoringCurrentSetId) return;

  const isMiss = score === 0;
  const isFault = opts.isFault === true;
  const isP1 = scoringCurrentThrower === "p1";
  const playerKey = isP1 ? "p1" : "p2";

  if (isMiss) {
    scoringConsecutiveMisses[playerKey]++;
  } else {
    scoringConsecutiveMisses[playerKey] = 0;
  }

  if (isP1) {
    scoringCurrentSetSP1 = applyScore(scoringCurrentSetSP1, score, isFault);
  } else {
    scoringCurrentSetSP2 = applyScore(scoringCurrentSetSP2, score, isFault);
  }

  const throwNumber =
    (await window.supabaseClient
      .from("throws")
      .select("id")
      .eq("match_id", scoringMatch.matchId)
      .eq("set_number", scoringMatch.currentSetNumber)
    ).data.length + 1;

  await dbInsertThrow({
    matchId: scoringMatch.matchId,
    setId: scoringCurrentSetId,
    setNumber: scoringMatch.currentSetNumber,
    throwNumber,
    playerId: isP1 ? scoringMatch.p1Id : scoringMatch.p2Id,
    score,
    isMiss,
    isFault
  });

	// After inserting the throw and recalcing SP:
	await recalcMatchSmallPoints(scoringMatch.matchId);

	// 🔴 ADD THIS BLOCK
	if (await checkThreeMissLoss(playerKey)) return;

	// Existing logic
	if (await checkSetWin()) return;


  // Flip thrower FIRST
  scoringCurrentThrower = isP1 ? "p2" : "p1";

  // Persist scores + NEXT thrower
  await dbUpdateLiveSetScore({
    matchId: scoringMatch.matchId,
    setNumber: scoringMatch.currentSetNumber,
    p1: scoringCurrentSetSP1,
    p2: scoringCurrentSetSP2,
    thrower: scoringCurrentThrower
  });

  updateScoringHeaderUI();
  syncThrowstripUI();
  updateLiveThrowsForSet(scoringMatch.currentSetNumber);
}

function applyScore(before, score, isFault) {
  if (score === 0) {
    return isFault && before >= 37 ? 25 : before;
  }
  const next = before + score;
  return next > 50 ? 25 : next;
}

async function checkThreeMissLoss(playerKey) {
  if (scoringConsecutiveMisses[playerKey] < 3) return false;

  const loserId =
    playerKey === "p1" ? scoringMatch.p1Id : scoringMatch.p2Id;
  const winnerId =
    playerKey === "p1" ? scoringMatch.p2Id : scoringMatch.p1Id;
	
	// FORCE 50–0 score on three-miss loss
	const loserIsP1 = playerKey === "p1";

	scoringCurrentSetSP1 = loserIsP1 ? 0 : 50;
	scoringCurrentSetSP2 = loserIsP1 ? 50 : 0;

  // Persist set result
  const { error: setErr } = await window.supabaseClient
    .from("sets")
    .update({
      score_player1: scoringCurrentSetSP1,
      score_player2: scoringCurrentSetSP2,
      winner_player_id: winnerId,
      current_thrower: null
    })
    .eq("id", scoringCurrentSetId);

  if (setErr) {
    console.error("[three-miss] failed to update set", setErr);
    return false;
  }

  // Update match set count
  if (winnerId === scoringMatch.p1Id) scoringMatch.setsP1++;
  if (winnerId === scoringMatch.p2Id) scoringMatch.setsP2++;

  await window.supabaseClient
    .from("matches")
    .update({
      final_sets_player1: scoringMatch.setsP1,
      final_sets_player2: scoringMatch.setsP2
    })
    .eq("id", scoringMatch.matchId);

  // Advance to next set
  scoringMatch.currentSetNumber++;
  scoringCurrentSetId = null;
  scoringCurrentSetSP1 = 0;
  scoringCurrentSetSP2 = 0;
  scoringCurrentThrower = null;
  scoringConsecutiveMisses = { p1: 0, p2: 0 };

  await recalcMatchSmallPoints(scoringMatch.matchId);

  updateScoringHeaderUI();
  syncStartSetUI();
  updateStartSetVisibility();

  return true;
}

// -----------------------------------------------------------
// SET WIN
// -----------------------------------------------------------

async function checkSetWin() {
  let winner = null;

  if (scoringCurrentSetSP1 === 50 && scoringCurrentSetSP2 < 50) {
    winner = scoringMatch.p1Id;
  } else if (scoringCurrentSetSP2 === 50 && scoringCurrentSetSP1 < 50) {
    winner = scoringMatch.p2Id;
  }

  if (!winner) return false;

  // Update set row (await + error check)
  const { error: setErr } = await window.supabaseClient
    .from("sets")
    .update({
      score_player1: scoringCurrentSetSP1,
      score_player2: scoringCurrentSetSP2,
      winner_player_id: winner,
      current_thrower: null
    })
    .eq("id", scoringCurrentSetId);

  if (setErr) {
    console.error("[checkSetWin] failed to update set", setErr);
    return false; // IMPORTANT: do not advance if DB write failed
  }

  // Increment local match sets AFTER set write succeeds
  if (winner === scoringMatch.p1Id) scoringMatch.setsP1++;
  if (winner === scoringMatch.p2Id) scoringMatch.setsP2++;

  const { error: matchErr } = await window.supabaseClient
    .from("matches")
    .update({
      final_sets_player1: scoringMatch.setsP1,
      final_sets_player2: scoringMatch.setsP2
    })
    .eq("id", scoringMatch.matchId);

  if (matchErr) {
    console.error("[checkSetWin] failed to update match", matchErr);
    // You may choose to return false here, but the set is already correct.
  }

  // Advance to next set in local state
  scoringMatch.currentSetNumber++;
  scoringCurrentSetId = null;
  scoringCurrentSetSP1 = 0;
  scoringCurrentSetSP2 = 0;
  scoringCurrentThrower = null;
  scoringConsecutiveMisses = { p1: 0, p2: 0 };

  await recalcMatchSmallPoints(scoringMatch.matchId);

  updateScoringHeaderUI();
  syncStartSetUI();
  updateStartSetVisibility();
  return true;
}


function initScoringButtons() {
  const container = document.getElementById("scoring-buttons");
  if (!container) return;

  container.innerHTML = "";

  const numbers = document.createElement("div");
  numbers.className = "scoring-numbers-grid";

  for (let i = 1; i <= 12; i++) {
    const btn = document.createElement("button");
    btn.className = "score-btn num-btn";
    btn.textContent = i;
    btn.addEventListener("click", () => scoringAddScore(i));
    numbers.appendChild(btn);
  }

  const actions = document.createElement("div");
  actions.className = "scoring-actions-grid";

  const missBtn = document.createElement("button");
  missBtn.className = "score-btn danger";
  missBtn.textContent = "X";
  missBtn.onclick = () => scoringAddScore(0);
  actions.appendChild(missBtn);

  const faultBtn = document.createElement("button");
  faultBtn.className = "score-btn danger";
  faultBtn.textContent = "FAULT";
  faultBtn.onclick = () => scoringAddScore(0, { isFault: true });
  actions.appendChild(faultBtn);

  const undoBtn = document.createElement("button");
  undoBtn.className = "score-btn special";
  undoBtn.textContent = "UNDO";
  undoBtn.onclick = scoringUndo;
  actions.appendChild(undoBtn);

  container.appendChild(numbers);
  container.appendChild(actions);
}

async function recalcMatchSmallPoints(matchId) {
  if (!matchId) return;

  const { data: sets, error } = await window.supabaseClient
    .from("sets")
    .select("score_player1, score_player2")
    .eq("match_id", matchId);

  if (error || !sets) {
    console.error("[recalcMatchSmallPoints] failed", error);
    return;
  }

  let sp1 = 0;
  let sp2 = 0;

  sets.forEach(s => {
    sp1 += Number(s.score_player1) || 0;
    sp2 += Number(s.score_player2) || 0;
  });

  // Persist (optional but correct)
  await window.supabaseClient
    .from("matches")
    .update({
      small_points_player1: sp1,
      small_points_player2: sp2
    })
    .eq("id", matchId);

  // 🔑 THIS is what you were missing
  updateMatchSPUI(sp1, sp2);
}


async function scoringUndo() {
  if (!scoringMatch) return;

  const matchId = scoringMatch.matchId;

  // 1. Find the last throw in this match (any set)
  const { data: lastThrow, error: lastErr } = await window.supabaseClient
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
  const { data: setRow, error: setErr } = await window.supabaseClient
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
  const { error: delErr } = await window.supabaseClient
    .from("throws")
    .delete()
    .eq("id", lastThrow.id);

  if (delErr) {
    console.error("Undo: failed to delete throw:", delErr);
    return;
  }

  // 4. Load remaining throws for this set
  const { data: remainingThrows, error: remErr } = await window.supabaseClient
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
  const { error: updSetErr } = await window.supabaseClient
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
    const { data: matchRow, error: mErr } = await window.supabaseClient
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

      await window.supabaseClient
        .from("matches")
        .update({
          final_sets_player1: setsP1,
          final_sets_player2: setsP2
        })
        .eq("id", matchId);
		
		await recalcMatchSmallPoints(scoringMatch.matchId);

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

// 10. Update scoring console UI (state-driven)
	if (typeof syncLiveSetScoreUI === "function") {
	  syncLiveSetScoreUI();
	}

	if (typeof syncThrowstripUI === "function") {
	  syncThrowstripUI();
	}

	if (typeof updateScoringHeaderUI === "function") {
	  updateScoringHeaderUI();
	}

  // 11. Refresh live throw view (header + set row)
  if (typeof updateLiveThrowsForSet === "function") {
    updateLiveThrowsForSet(setNumber);
  }

  // 12. If we just undid the only scoring throw that gave someone 50,
  //     we might need to hide the start-next-set overlay.
  updateStartSetVisibility();
}

async function scoringEndMatch() {
  if (!scoringMatch) return;

  await window.supabaseClient
    .from("matches")
    .update({ status: "finished" })
    .eq("id", scoringMatch.matchId);

  scoringMatch.status = "finished";

  // Kill any active set state
  scoringCurrentSetId = null;
  scoringCurrentThrower = null;

  updateStartSetVisibility();   // hides overlay
  updateScoringHeaderUI();      // refresh header
  closeScoringConsole();        // close console
}

window.scoringEndMatch = scoringEndMatch;

function wireEndMatchButton() {
  const btn = document.getElementById("end-match-btn");
  if (!btn) return;

  btn.onclick = async () => {
    if (!scoringMatch) return;

    const ok = confirm("End this match? This cannot be undone.");
    if (!ok) return;

    // 1. Persist match status
    const { error } = await window.supabaseClient
      .from("matches")
      .update({ status: "finished" })
      .eq("id", scoringMatch.matchId);

    if (error) {
      console.error("[end-match] failed", error);
      alert("Failed to end match.");
      return;
    }

    // 2. Update local state
    scoringMatch.status = "finished";
    scoringCurrentSetId = null;
    scoringCurrentThrower = null;

    // 3. UI cleanup
    closeScoringConsole();
    updateStartSetVisibility();
    updateScoringHeaderUI();
  };
}


// -----------------------------------------------------------
// UI UPDATE
// -----------------------------------------------------------

function syncStartSetUI() {

  const btnP1 = document.getElementById("start-set-with-p1");
  const btnP2 = document.getElementById("start-set-with-p2");
  const title = document.getElementById("start-set-title");

  if (!btnP1 || !btnP2 || !title || !scoringMatch) return;

  // Title
  title.textContent =
    scoringMatch.status === "scheduled"
      ? "Start match"
      : `Start set ${scoringMatch.currentSetNumber}`;

  // Button labels
  btnP1.textContent = `Start set with ${scoringMatch.p1Name}`;
  btnP2.textContent = `Start set with ${scoringMatch.p2Name}`;

  // Click handlers (rebind safely)
  btnP1.onclick = () => scoringStartSet("p1");
  btnP2.onclick = () => scoringStartSet("p2");
}

function updateMatchSPUI(sp1, sp2) {
  // Update in-memory state
  if (window.scoringMatch) {
    window.scoringMatch.matchSP1 = sp1;
    window.scoringMatch.matchSP2 = sp2;
  }

  // Update scoring console IF it exists
  const elP1 = document.getElementById("scoring-p1-sp");
  const elP2 = document.getElementById("scoring-p2-sp");

  if (elP1) elP1.textContent = sp1;
  if (elP2) elP2.textContent = sp2;
}

function syncLiveSetScoreUI() {
  const el = document.getElementById("header-live-setscore");
  if (!el) return;

  el.textContent =
    `${scoringCurrentSetSP1 ?? 0} – ${scoringCurrentSetSP2 ?? 0}`;
}

function updateScoringHeaderUI() {
  const p1NameEl = document.getElementById("scoring-p1-name");
  if (!p1NameEl) {
    // Scoring console not mounted yet — silently skip
    return;
  }

  document.getElementById("scoring-p1-name").textContent =
    scoringMatch.p1Name;

  document.getElementById("scoring-p2-name").textContent =
    scoringMatch.p2Name;

  document.getElementById("scoring-p1-sets").textContent =
    scoringMatch.setsP1;

  document.getElementById("scoring-p2-sets").textContent =
    scoringMatch.setsP2;

  document.getElementById("scoring-p1-setsp").textContent =
    scoringCurrentSetSP1;

  document.getElementById("scoring-p2-setsp").textContent =
    scoringCurrentSetSP2;

  document.getElementById("scoring-current-thrower-label").textContent =
    scoringCurrentThrower
      ? (scoringCurrentThrower === "p1"
          ? scoringMatch.p1Name
          : scoringMatch.p2Name) + " to throw"
      : "–";
}

function syncThrowstripUI() {
  const p1Strip = document.getElementById("header-throws-p1");
  const p2Strip = document.getElementById("header-throws-p2");

  if (!p1Strip || !p2Strip) return;

  p1Strip.innerHTML = "";
  p2Strip.innerHTML = "";

  scoringThrowHistory.forEach(t => {
    const el = document.createElement("span");
    el.className = "throw-pill";
    el.textContent = t.isFault ? "F" : t.isMiss ? "–" : t.score;

    if (t.player === "p1") p1Strip.appendChild(el);
    else p2Strip.appendChild(el);
  });
}



// -----------------------------------------------------------
// EXPORTS
// -----------------------------------------------------------

window.openScoringConsole = App.Features.Scoring.openConsole;
