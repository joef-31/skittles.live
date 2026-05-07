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
window.__localThrowInFlight = false;

// -----------------------------------------------------------
// Global scoring state (must be accessible to realtime + console)
// -----------------------------------------------------------
window.scoringMatch = window.scoringMatch || null;

window.scoringCurrentSetId = window.scoringCurrentSetId || null;
window.scoringCurrentSetSP1 = window.scoringCurrentSetSP1 ?? 0;
window.scoringCurrentSetSP2 = window.scoringCurrentSetSP2 ?? 0;
window.scoringCurrentThrower = window.scoringCurrentThrower || null;

window.scoringThrowHistory = Array.isArray(window.scoringThrowHistory)
  ? window.scoringThrowHistory
  : [];
window.scoringConsecutiveMisses = window.scoringConsecutiveMisses || { p1: 0, p2: 0 };


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
// Current set lineups (TEAM MATCHES ONLY)
// -----------------------------------------------------------

window.currentSetLineups = {
  p1: [], // array of player_ids, in throw order
  p2: []
};


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

function buildSideModel(match) {
	const isTeamMatch = Boolean(match.team1 && match.team2);

	return {
		p1: isTeamMatch
			? {
					type: "team",
					id: match.team1.id,
					name: match.team1.name,
					lineup: [],          // ← intentionally empty for now
					currentIndex: 0
				}
			: {
					type: "player",
					id: match.player1.id,
					name: match.player1.name,
					lineup: Array.isArray(window.currentSetLineups?.p1)
					  ? window.currentSetLineups.p1
					  : [],
					currentIndex: 0
				},

		p2: isTeamMatch
			? {
					type: "team",
					id: match.team2.id,
					name: match.team2.name,
					lineup: [],          // ← intentionally empty for now
					currentIndex: 0
				}
			: {
					type: "player",
					id: match.player2.id,
					name: match.player2.name,
					lineup: Array.isArray(window.currentSetLineups?.p2)
					  ? window.currentSetLineups.p2
					  : [],
					currentIndex: 0
				}
	};
}

function getCurrentThrowerPlayerId() {
  if (!scoringMatch || !scoringCurrentThrower) return null;

  const side = scoringMatch.sideModel?.[scoringCurrentThrower];
  if (!side) return null;

  // Singles or fallback
  if (side.type === "player") {
    return side.id;
  }

  // Team but no lineup yet
  if (!Array.isArray(side.lineup) || side.lineup.length === 0) {
    return null;
  }

  return side.lineup[side.currentIndex] ?? null;
}

async function resetScoringStateForMatch(match, sets) {
	window.__scorerOwnsState = true;
	let currentSet = null;

	const { data: dbSets } = await window.supabaseClient
	  .from("sets")
	  .select("*")
	  .eq("match_id", match.id)
	  .order("set_number", { ascending: false });

	const effectiveSets = Array.isArray(dbSets) ? dbSets : sets;
	
	sets = sets || [];

	const isTeamMatch = Boolean(match.team1 && match.team2);

	scoringMatch = {
		matchId: match.id,
		tournamentId: match.tournament?.id,
		editionId: match.edition_id,
		minTeamSize: Number(match.min_team_size) || 0,
		isTeamMatch,

		// competitor IDs (player OR team)
		p1Id: isTeamMatch ? match.team1.id : match.player1?.id,
		p2Id: isTeamMatch ? match.team2.id : match.player2?.id,

		// display names
		p1Name: isTeamMatch
			? match.team1?.name || "Team 1"
			: match.player1?.name || "Player 1",

		p2Name: isTeamMatch
			? match.team2?.name || "Team 2"
			: match.player2?.name || "Player 2",

		setsP1: match.final_sets_player1 ?? 0,
		setsP2: match.final_sets_player2 ?? 0,
		status: match.status || "scheduled"
	};
	
	scoringMatch.sideModel = buildSideModel(match);

	window.scoringMatch = scoringMatch;

	// ACTIVE SET MUST BE THROWS-LED (authoritative)
	const { data: lastThrow, error: lastThrowErr } = await window.supabaseClient
	  .from("throws")
	  .select("set_id,set_number,side,throw_number")
	  .eq("match_id", match.id)
	  .order("set_number", { ascending: false })
	  .order("throw_number", { ascending: false })
	  .limit(1)
	  .maybeSingle();

	if (lastThrowErr) console.error("[resetScoringStateForMatch] lastThrowErr", lastThrowErr);

	if (!lastThrow?.set_id) {
	  // no throws in match → no active set yet
	  const maxSetNum = (effectiveSets || []).length
		? Math.max(...effectiveSets.map(s => Number(s.set_number) || 0))
		: 0;

	  window.scoringMatch.currentSetNumber = maxSetNum + 1;
	  window.scoringCurrentSetId = null;
	  window.scoringCurrentSetSP1 = 0;
	  window.scoringCurrentSetSP2 = 0;
	  window.scoringCurrentThrower = null;

	} else {
	  // last throw determines the active set number/id
	  const activeSetId = lastThrow.set_id;
	  const activeSetNum = Number(lastThrow.set_number) || 1;

	  const { data: activeSet, error: setErr } = await window.supabaseClient
		.from("sets")
		.select("id,set_number,score_player1,score_player2,current_thrower,winner_player_id")
		.eq("id", activeSetId)
		.maybeSingle();

	  if (setErr) console.error("[resetScoringStateForMatch] setErr", setErr);

	  const finished =
		activeSet?.winner_player_id ||
		Number(activeSet?.score_player1) >= 50 ||
		Number(activeSet?.score_player2) >= 50;

	  if (finished) {
		// last throw was in a finished set → next set not started yet
		window.scoringMatch.currentSetNumber = activeSetNum + 1;
		window.scoringCurrentSetId = null;
		window.scoringCurrentSetSP1 = 0;
		window.scoringCurrentSetSP2 = 0;
		window.scoringCurrentThrower = null;
		} else {
		  // active unfinished set
		  const derivedThrower =
			activeSet?.current_thrower ||
			(lastThrow.side === "p1" ? "p2" : "p1");

		  // ✅ THIS is the missing piece: bind currentSet so later code doesn't wipe state
		  currentSet = {
			id: activeSetId,
			set_number: activeSetNum,
			score_player1: Number(activeSet?.score_player1) || 0,
			score_player2: Number(activeSet?.score_player2) || 0,
			current_thrower: derivedThrower
		  };

		  // keep your existing window state writes (fine)
		  window.scoringMatch.currentSetNumber = activeSetNum;
		  window.scoringCurrentSetId = activeSetId;
		  window.scoringCurrentSetSP1 = currentSet.score_player1;
		  window.scoringCurrentSetSP2 = currentSet.score_player2;
		  window.scoringCurrentThrower = derivedThrower;
		}
	}

	if (currentSet) {
		window.scoringCurrentSetId = currentSet.id;
		window.scoringCurrentSetSP1 = currentSet.score_player1 || 0;
		window.scoringCurrentSetSP2 = currentSet.score_player2 || 0;
		window.scoringCurrentThrower = currentSet.current_thrower;
		window.scoringMatch.currentSetNumber = currentSet.set_number;
	} else {
		const maxSet = (effectiveSets || []).length
			? Math.max(...(effectiveSets || []).map(s => s.set_number || 0))
			: 0;
		window.scoringMatch.currentSetNumber = maxSet + 1;
		window.scoringCurrentSetId = null;
		window.scoringCurrentSetSP1 = 0;
		window.scoringCurrentSetSP2 = 0;
		window.scoringCurrentThrower = null;
	}
	
	if (currentSet && scoringMatch.isTeamMatch) {
	  const { data: lineups } = await window.supabaseClient
		.from("set_lineups")
		.select("team_id, player_id")
		.eq("set_id", currentSet.id);

	  if (Array.isArray(lineups)) {
		scoringMatch.sideModel.p1.lineup = lineups
		  .filter(r => r.team_id === scoringMatch.p1Id)
		  .map(r => r.player_id);

		scoringMatch.sideModel.p2.lineup = lineups
		  .filter(r => r.team_id === scoringMatch.p2Id)
		  .map(r => r.player_id);

		// Derive currentIndex from existing throws
		const throwsSoFar = (await window.supabaseClient
		  .from("throws")
		  .select("player_id")
		  .eq("set_id", currentSet.id)
		  .order("throw_number", { ascending: true })
		).data || [];

		["p1", "p2"].forEach(sideKey => {
		  const side = scoringMatch.sideModel[sideKey];

		  if (side.type !== "team" || !side.lineup.length) {
			side.currentIndex = 0;
			return;
		  }

		  const throwsByThisSide = throwsSoFar.filter(t =>
			side.lineup.includes(t.player_id)
		  );

		  side.currentIndex =
			throwsByThisSide.length % side.lineup.length;
		});
	  }
	}

	updateScoringHeaderUI();
	updateStartSetVisibility();
	syncStartSetUI();
	syncTeamLineupsUI();
	
	wireEndMatchButton();
	  
	scoringConsecutiveMisses = { p1: 0, p2: 0 };
	scoringThrowHistory = [];
}

window.resetScoringStateForMatch = resetScoringStateForMatch;

async function rebuildLocalThrowStateFromDB(matchId, setNumber) {
  const { data: throws } = await window.supabaseClient
    .from("throws")
    .select("side, score, is_miss, is_fault")
    .eq("match_id", matchId)
    .eq("set_number", setNumber)
    .order("throw_number");

  scoringThrowHistory = (throws || []).map(t => ({
    player: t.side,
    score: Number(t.score) || 0,
    isMiss: t.is_miss === true || Number(t.score) === 0,
    isFault: t.is_fault === true
  }));

  window.scoringConsecutiveMisses =
    recomputeConsecutiveMissesFromThrows(throws || []);
}


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
	if (scoringMatch.isTeamMatch) {
	  const { p1, p2 } = window.currentSetLineups;

	  if (p1.includes(null) || p2.includes(null)) {
		alert("All lineup slots must be filled before starting the set.");
		return;
	  }
	}
	
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
	  firstThrower   // 👈 SET IT HERE
	);
	
	// After dbGetOrCreateSet returns setRow
	if (!setRow?.id) {
	  console.error("[startSet] no setRow returned");
	  return;
	}

	// ✅ Authoritative local state so UI + scoring works immediately
	window.scoringCurrentSetId = setRow.id;
	window.scoringCurrentThrower = firstThrower;

	window.scoringCurrentSetSP1 = setRow.score_player1 ?? 0;
	window.scoringCurrentSetSP2 = setRow.score_player2 ?? 0;

	// If you always start a new set at 0–0, force it here:
	window.scoringCurrentSetSP1 = 0;
	window.scoringCurrentSetSP2 = 0;


	// Ensure side indices are aligned
	if (scoringMatch.isTeamMatch && scoringMatch.sideModel?.[firstThrower]) {
	  scoringMatch.sideModel[firstThrower].currentIndex = 0;
	}
	
	if (scoringMatch.isTeamMatch) {
	  const rows = [];

	  window.currentSetLineups.p1.forEach(playerId => {
		rows.push({
		  set_id: setRow.id,
		  team_id: scoringMatch.p1Id,
		  player_id: playerId
		});
	  });

	  window.currentSetLineups.p2.forEach(playerId => {
		rows.push({
		  set_id: setRow.id,
		  team_id: scoringMatch.p2Id,
		  player_id: playerId
		});
	  });
	  
	if (scoringMatch.isTeamMatch) {
	  scoringMatch.sideModel.p1.lineup = [...window.currentSetLineups.p1];
	  scoringMatch.sideModel.p2.lineup = [...window.currentSetLineups.p2];

	  scoringMatch.sideModel.p1.currentIndex = 0;
	  scoringMatch.sideModel.p2.currentIndex = 0;
	}

	  await window.supabaseClient
		.from("set_lineups")
		.delete()
		.eq("set_id", setRow.id);

	  await window.supabaseClient
		.from("set_lineups")
		.insert(rows);
	}

	const setNumber = scoringMatch.currentSetNumber;
	
	syncStartSetUI();
	syncLiveSetScoreUI();
	updateLiveThrowsForSet(setNumber);

	await window.supabaseClient
		.from("sets")
		.update({ current_thrower: firstThrower })
		.eq("id", setRow.id);
		
		if (scoringMatch.sideModel?.[firstThrower]) {
			scoringMatch.sideModel[firstThrower].currentIndex = 0;
		}

	updateStartSetVisibility();
	syncTeamLineupsUI();
	
	await syncScoringStateFromDB(setRow.id);
}

window.scoringStartSet = scoringStartSet;

// -----------------------------------------------------------
// SCORING
// -----------------------------------------------------------

async function scoringAddScore(score, opts = {}) {
  if (!window.scoringMatch || !window.scoringCurrentSetId) return;

  const isMiss = score === 0;
  const isFault = opts.isFault === true;
  const isP1 = window.scoringCurrentThrower === "p1";
  const playerKey = isP1 ? "p1" : "p2";

  // Insert throw (DB is source of truth)
  window.__localThrowInFlight = true;
  await dbInsertThrow({
    matchId: window.scoringMatch.matchId,
    setId: window.scoringCurrentSetId,
    setNumber: window.scoringMatch.currentSetNumber,
	throwerSide: window.scoringCurrentThrower,
    playerId: getCurrentThrowerPlayerId(),
    score,
    isMiss,
    isFault
  });
  window.__localThrowInFlight = false;

  // Recalculate small points (derived)
  await recalcMatchSmallPoints(scoringMatch.matchId);

  // Three-miss loss ends the set
  if (await checkThreeMissLoss(playerKey)) {
    return;
  }

  // Normal set win ends the set
  if (await checkSetWin()) {
    return;
  }

  // 🔑 AUTHORITATIVE REBUILD FROM DB
  // This keeps Browser A in sync with Browser B
  await syncScoringStateFromDB(window.scoringCurrentSetId);

  // 🔁 Ensure UI reflects rebuilt state
  syncTeamLineupsUI?.();
  syncHeaderTikku();
}

function applyScore(before, score, isFault) {
	if (score === 0) {
		return isFault && before >= 37 ? 25 : before;
	}
	const next = before + score;
	return next > 50 ? 25 : next;
}

function rebuildSetStateFromThrows(throws) {
  let sp1 = 0;
  let sp2 = 0;

  // consecutive misses at end-of-sequence per side
  const misses = { p1: 0, p2: 0 };

  // next thrower is the side of the next throw to be taken
  // if there are throws, it's the opposite of the last throw's side
  let nextThrower = "p1";

  const arr = Array.isArray(throws) ? throws : [];

  // 1) Rebuild cumulative scores from recorded side + fault/miss flags
  for (const t of arr) {
    const side = t.side;
    if (side !== "p1" && side !== "p2") continue;

    const score = Number(t.score) || 0;
    const isFault = t.is_fault === true;

    if (side === "p1") sp1 = applyScore(sp1, score, isFault);
    else sp2 = applyScore(sp2, score, isFault);
  }

  // 2) Next thrower
  for (let i = arr.length - 1; i >= 0; i--) {
    const side = arr[i]?.side;
    if (side === "p1" || side === "p2") {
      nextThrower = side === "p1" ? "p2" : "p1";
      break;
    }
  }

  // 3) Consecutive misses from the tail (per side)
  const done = { p1: false, p2: false };
  for (let i = arr.length - 1; i >= 0; i--) {
    const t = arr[i];
    const side = t?.side;
    if (side !== "p1" && side !== "p2") continue;
    if (done[side]) continue;

    const missLike = t.is_miss === true || Number(t.score) === 0;
    if (missLike) misses[side] += 1;
    else done[side] = true;

    if (done.p1 && done.p2) break;
  }

	const throwHistory = arr.map(t => ({
	  player: t.side,
	  score: Number(t.score) || 0,
	  isMiss: t.is_miss === true || Number(t.score) === 0,
	  isFault: t.is_fault === true
	}));

	return { sp1, sp2, nextThrower, misses, throwHistory };
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

function recomputeConsecutiveMissesFromThrows(throws) {
  const misses = { p1: 0, p2: 0 };
  const done = { p1: false, p2: false };

  for (let i = (throws?.length || 0) - 1; i >= 0; i--) {
    const t = throws[i];
    const side = t.side;

    if (side !== "p1" && side !== "p2") continue;
    if (done[side]) continue;

    const isMissLike =
      t.is_miss === true ||
      Number(t.score) === 0;

    if (isMissLike) {
      misses[side]++;
    } else {
      done[side] = true;
      if (done.p1 && done.p2) break;
    }
  }

  return misses;
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

	// --------------------------------------------------
	// CASE: first throw undone → abandon the set
	// --------------------------------------------------
	if ((remainingThrows || []).length === 0) {

	  await window.supabaseClient
		.from("sets")
		.delete()
		.eq("id", setId);

	  window.scoringCurrentSetId = null;
	  window.scoringCurrentThrower = null;
	  window.scoringCurrentSetSP1 = 0;
	  window.scoringCurrentSetSP2 = 0;

	  scoringMatch.currentSetNumber =
		Math.max(1, scoringMatch.currentSetNumber - 1);

	  updateScoringHeaderUI();
	  syncLiveSetScoreUI();
	  updateStartSetVisibility();
	  syncHeaderTikku();

	  return;
	}

	const rebuilt = rebuildSetStateFromThrows(remainingThrows || []);

	let newSP1 = rebuilt.sp1;
	let newSP2 = rebuilt.sp2;
	let nextThrower = rebuilt.nextThrower;

	if (remErr) {
		console.error("Undo: failed to load remaining throws:", remErr);
		return;
	}

	// 7. Update set row (UNDO: winner can only be cleared)
	const { error: updSetErr } = await window.supabaseClient
	  .from("sets")
	  .update({
		score_player1: newSP1,
		score_player2: newSP2,
		current_thrower: nextThrower,
		winner_player_id: null
	  })
	  .eq("id", setId);

	// 8. If the set previously had a winner, remove exactly one match-level set win
	if (prevWinner) {
	  const { data: matchRow, error: mErr } = await window.supabaseClient
		.from("matches")
		.select(
		  "id, final_sets_player1, final_sets_player2, team1_id, team2_id, player1_id, player2_id"
		)
		.eq("id", matchId)
		.maybeSingle();

	  if (!mErr && matchRow) {
		let setsP1 = matchRow.final_sets_player1 ?? 0;
		let setsP2 = matchRow.final_sets_player2 ?? 0;

		const isTeamMatch = Boolean(matchRow.team1_id || matchRow.team2_id);

		if (isTeamMatch) {
		  // Determine which team the winning PLAYER belonged to
		  if (
			window.currentTeamMembers?.some(
			  m => m.player_id === prevWinner && m.team_id === matchRow.team1_id
			)
		  ) {
			setsP1 = Math.max(0, setsP1 - 1);
		  } else if (
			window.currentTeamMembers?.some(
			  m => m.player_id === prevWinner && m.team_id === matchRow.team2_id
			)
		  ) {
			setsP2 = Math.max(0, setsP2 - 1);
		  }
		} else {
		  if (prevWinner === matchRow.player1_id) {
			setsP1 = Math.max(0, setsP1 - 1);
		  } else if (prevWinner === matchRow.player2_id) {
			setsP2 = Math.max(0, setsP2 - 1);
		  }
		}

		await window.supabaseClient
		  .from("matches")
		  .update({
			final_sets_player1: setsP1,
			final_sets_player2: setsP2
		  })
		  .eq("id", matchId);

		// keep derived values correct
		await recalcMatchSmallPoints(matchId);
	  }
	}
	
	const { data: freshMatch, error: fmErr } = await window.supabaseClient
	  .from("matches")
	  .select("final_sets_player1, final_sets_player2")
	  .eq("id", matchId)
	  .maybeSingle();

	if (!fmErr && freshMatch) {
	  scoringMatch.setsP1 = freshMatch.final_sets_player1 ?? 0;
	  scoringMatch.setsP2 = freshMatch.final_sets_player2 ?? 0;
	}
	
	if (typeof App?.Features?.Match?.refreshMatchHeader === "function") {
		App.Features.Match.refreshMatchHeader();
	}

	// 9. Update local JS state for current set
	scoringMatch.currentSetNumber = setNumber;
	window.scoringCurrentSetId = setId;
	
	// Team matches: recompute which player is "next" for each side
	if (scoringMatch?.isTeamMatch) {
	  const p1Lineup = scoringMatch.sideModel?.p1?.lineup || [];
	  const p2Lineup = scoringMatch.sideModel?.p2?.lineup || [];

	  // Safety: only if lineups exist
	  if (p1Lineup.length && p2Lineup.length) {
		let p1Throws = 0;
		let p2Throws = 0;

		(remainingThrows || []).forEach(t => {
		  const pid = t.player_id;
		  if (!pid) return;

		  // Determine side by lineup membership (fast + reliable if lineups are disjoint)
		  if (p1Lineup.includes(pid)) p1Throws++;
		  else if (p2Lineup.includes(pid)) p2Throws++;
		});

		scoringMatch.sideModel.p1.currentIndex = p1Throws % p1Lineup.length;
		scoringMatch.sideModel.p2.currentIndex = p2Throws % p2Lineup.length;
	  }
	}

// 10. Update scoring console UI (state-driven)
	await syncScoringStateFromDB(setId); // use the setId you already have, not window-scoped
	
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

	updateStartSetVisibility();	 // hides overlay
	updateScoringHeaderUI();			// refresh header
	closeScoringConsole();				// close console
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
	ensureTeamLineupsInitialised();

  if (
    scoringMatch?.sideModel?.p1?.type === "team"
  ) {
    const minSize =
      Number(
        scoringMatch.minTeamSize
      ) || 0;

    const needsInit =
      !window.currentSetLineups ||
      !Array.isArray(window.currentSetLineups.p1) ||
      !Array.isArray(window.currentSetLineups.p2) ||
      window.currentSetLineups.p1.length !== minSize ||
      window.currentSetLineups.p2.length !== minSize;

    if (needsInit) {
      window.currentSetLineups = {
        p1: Array(minSize).fill(null),
        p2: Array(minSize).fill(null)
      };
    }
  }

  const btnP1 = document.getElementById("start-set-with-p1");
  const btnP2 = document.getElementById("start-set-with-p2");
  const title = document.getElementById("start-set-title");

  if (!btnP1 || !btnP2 || !title || !scoringMatch) return;

  // Title
  title.textContent =
    scoringMatch.status === "scheduled"
      ? "Start match"
      : `Start set ${scoringMatch.currentSetNumber}`;

  btnP1.textContent = `Start set with ${scoringMatch.p1Name}`;
  btnP2.textContent = `Start set with ${scoringMatch.p2Name}`;

  btnP1.onclick = () => scoringStartSet("p1");
  btnP2.onclick = () => scoringStartSet("p2");

  if (scoringMatch.sideModel?.p1?.type === "team") {
    renderSetLineupSlots();
    wireSetLineupSelection();
  } else {
    const editor = document.getElementById("set-lineup-editor");
    const slots = document.getElementById("set-lineup-slots");
    if (editor) editor.innerHTML = "";
    if (slots) slots.innerHTML = "";
  }
}

function ensureTeamLineupsInitialised() {
  if (!scoringMatch?.isTeamMatch) return;
  if (window.currentSetLineups?.p1?.length > 0) return;

  const editionId = window.tournamentContext?.editionId;
  if (!editionId) return; // too early, try again later

  const edition = window.currentEditions?.find(e => e.id === editionId);
  const minSize = Number(edition?.min_team_size);

  if (!minSize || minSize < 1) return;

  window.currentSetLineups = {
    p1: Array(minSize).fill(null),
    p2: Array(minSize).fill(null)
  };
}

function renderSetLineupSlots() {
  const wrap = document.getElementById("set-lineup-slots");
  if (!wrap || !window.scoringMatch) return;

  const members = window.currentTeamMembers || [];

  const playersByTeam = {
    p1: members
      .filter(m => m.team_id === scoringMatch.sideModel.p1.id)
      .map(m => ({
        id: m.player_id,
        name:
          window.allPlayers.find(p => p.id === m.player_id)?.name || "Unknown"
      })),
    p2: members
      .filter(m => m.team_id === scoringMatch.sideModel.p2.id)
      .map(m => ({
        id: m.player_id,
        name:
          window.allPlayers.find(p => p.id === m.player_id)?.name || "Unknown"
      }))
  };

  wrap.innerHTML = `
    <div class="set-lineup-hint">
		Select the players who will play this set
	</div>
	
    <div class="set-lineup-grid">
      ${renderSetLineupSlotsHTML("p1", playersByTeam.p1)}
      ${renderSetLineupSlotsHTML("p2", playersByTeam.p2)}
    </div>
  `;
}

function renderSetLineupSlotsHTML(sideKey, players) {
  const slots = window.currentSetLineups[sideKey] || [];

  return `
    <div class="set-lineup-column">
      <div class="set-lineup-title">
        ${scoringMatch.sideModel[sideKey].name}
      </div>

      ${slots.map((pid, idx) => `
        <select
          class="set-lineup-select"
          data-side="${sideKey}"
          data-slot="${idx}"
        >
          <option value="">— empty —</option>

          ${players.map(p => `
            <option
              value="${p.id}"
              ${p.id === pid ? "selected" : ""}
            >
              ${p.name}
            </option>
          `).join("")}
        </select>
      `).join("")}
    </div>
  `;
}

function wireSetLineupSelection() {
  document
    .querySelectorAll(".set-lineup-select")
    .forEach(select => {
      select.onchange = () => {
        const side = select.dataset.side;
        const slotIndex = Number(select.dataset.slot);
        const playerId = select.value || null;

        assignPlayerToSlot(side, slotIndex, playerId);
      };
    });
}

function openPlayerPicker(side, slotIndex) {
  const sideModel = scoringMatch.sideModel[side];
  const teamId = sideModel.id;

  const members = window.currentTeamMembers
    .filter(m => m.team_id === teamId)
    .map(m => ({
      id: m.player_id,
      name:
        window.allPlayers.find(p => p.id === m.player_id)?.name ||
        "Unknown"
    }));

  const options = members
    .map((p, i) => `${i + 1}. ${p.name}`)
    .join("\n");

  const input = prompt(
    `Select player for slot ${slotIndex + 1}:\n\n${options}`
  );

  const idx = Number(input) - 1;
  if (!members[idx]) return;

  assignPlayerToSlot(side, slotIndex, members[idx].id);
}

function assignPlayerToSlot(side, slotIndex, playerId) {
  // Remove from all other slots
  ["p1", "p2"].forEach(s => {
    window.currentSetLineups[s] =
      window.currentSetLineups[s].map(pid =>
        pid === playerId ? null : pid
      );
  });

  // Assign (or clear)
  window.currentSetLineups[side][slotIndex] = playerId;

  renderSetLineupSlots();
  wireSetLineupSelection();
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
			
	// -----------------------------
	// Miss counter (debug + UI)
	// -----------------------------
	const missElP1 = document.getElementById("scoring-p1-misses");
	const missElP2 = document.getElementById("scoring-p2-misses");

	function renderMisses(el, count) {
		if (!el) return;

		if (!count || count < 1) {
			el.textContent = "";
			el.classList.add("hidden");
			return;
		}

		el.textContent = Array(count).fill("X").join(" ");
		el.classList.remove("hidden");
	}

	renderMisses(
		missElP1,
		window.scoringConsecutiveMisses?.p1 ?? 0
	);

	renderMisses(
		missElP2,
		window.scoringConsecutiveMisses?.p2 ?? 0
	);
	
	syncHeaderTikku()
}

function deriveTeamRotationFromThrows(throwsArr) {
  const match = window.scoringMatch;
  const p1Lineup = match?.sideModel?.p1?.lineup || [];
  const p2Lineup = match?.sideModel?.p2?.lineup || [];

  const arrRaw = Array.isArray(throwsArr) ? throwsArr : [];
  const arr = [...arrRaw].filter(t => Number(t?.throw_number) > 0);

  if (!match?.isTeamMatch || !p1Lineup.length || !p2Lineup.length) {
    return { nextSide: null, p1Index: 0, p2Index: 0 };
  }

  if (arr.length === 0) {
    return { nextSide: null, p1Index: 0, p2Index: 0 };
  }

  // Sort by throw_number
  arr.sort((a, b) => Number(a.throw_number) - Number(b.throw_number));

  const other = (s) => (s === "p1" ? "p2" : "p1");

  // Try to map a throw to a side using explicit side or player_id membership
  function sideFromRow(t) {
    if (t?.side === "p1" || t?.side === "p2") return t.side;
    const pid = t?.player_id;
    if (!pid) return null;
    if (p1Lineup.includes(pid)) return "p1";
    if (p2Lineup.includes(pid)) return "p2";
    return null;
  }

  // Determine starting side using throw #1 if present
  let startSide = null;
  const t1 = arr.find(t => Number(t.throw_number) === 1) || arr[0];
  startSide = sideFromRow(t1);

  // If still unknown, pick a sane default (but parity will still work)
  if (startSide !== "p1" && startSide !== "p2") {
    startSide = "p1";
  }

  // Now we can derive a side for EVERY throw deterministically:
  // odd throw_number => startSide, even => other(startSide)
  function canonicalSide(t) {
    const n = Number(t.throw_number) || 0;
    const explicit = sideFromRow(t);
    if (explicit === "p1" || explicit === "p2") return explicit;
    return (n % 2 === 1) ? startSide : other(startSide);
  }

  // Count throws by canonical side
  let p1Throws = 0;
  let p2Throws = 0;
  let maxN = 0;

  for (const t of arr) {
    const n = Number(t.throw_number) || 0;
    if (n > maxN) maxN = n;

    const s = canonicalSide(t);
    if (s === "p1") p1Throws++;
    else if (s === "p2") p2Throws++;
  }

  // Next side is opposite of the side who took throw maxN
  // (equivalently: if maxN even => nextSide = startSide; odd => other)
  const nextSide = (maxN % 2 === 0) ? startSide : other(startSide);

  const p1Index = p1Throws % p1Lineup.length;
  const p2Index = p2Throws % p2Lineup.length;

  return { nextSide, p1Index, p2Index };
}

function syncThrowstripUI() {
  const p1Strip = document.getElementById("header-throws-p1");
  const p2Strip = document.getElementById("header-throws-p2");
  if (!p1Strip || !p2Strip) return;

  const history = Array.isArray(window.scoringThrowHistory)
    ? window.scoringThrowHistory
    : [];

  p1Strip.innerHTML = "";
  p2Strip.innerHTML = "";

  if (history.length === 0) return;

  history.forEach(t => {
    const el = document.createElement("span");
    el.className = "throw-box";
    el.textContent = t.isFault ? "F" : t.isMiss ? "–" : t.score;

    if (t.player === "p1") p1Strip.appendChild(el);
    else p2Strip.appendChild(el);
  });
}

async function syncScoringStateFromDB(setId) {
  if (!setId || !window.supabaseClient) return;

  // 1) Load authoritative set row (scores + thrower are DB-led)
  const { data: setRow, error: setErr } = await window.supabaseClient
    .from("sets")
    .select("id, match_id, set_number, score_player1, score_player2, current_thrower, winner_player_id")
    .eq("id", setId)
    .maybeSingle();

  if (setErr || !setRow) {
    console.error("[syncScoringStateFromDB] failed to load set row", setErr);
    return;
  }

  // 2) Load authoritative throws for this set
  const { data: throws, error: thrErr } = await window.supabaseClient
    .from("throws")
    .select("*")
    .eq("set_id", setId)
    .order("throw_number", { ascending: true });

  if (thrErr) {
    console.error("[syncScoringStateFromDB] failed to load throws", thrErr);
    return;
  }

	// --- after you have: setRow, throws[], and (for team matches) sideModel.p1.lineup / sideModel.p2.lineup populated

	const arr = Array.isArray(throws) ? throws : [];

	// Scores are DB-led
	window.scoringCurrentSetSP1 = Number(setRow.score_player1) || 0;
	window.scoringCurrentSetSP2 = Number(setRow.score_player2) || 0;

	// Active set identity
	window.scoringCurrentSetId = setRow.id;
	window.scoringMatch.currentSetNumber = setRow.set_number;

	// --- TEAM MATCH ROTATION (AUTHORITATIVE) ---
	if (window.scoringMatch?.isTeamMatch) {
	  const rot = deriveTeamRotationFromThrows(arr);

	  window.scoringMatch.sideModel.p1.currentIndex = rot.p1Index ?? 0;
	  window.scoringMatch.sideModel.p2.currentIndex = rot.p2Index ?? 0;

	  window.scoringCurrentThrower = rot.nextSide ?? null;
	} else {
	  // Singles: fall back to DB
	  window.scoringCurrentThrower = setRow.current_thrower || null;
	}

	// Misses + history
	window.scoringConsecutiveMisses =
	  recomputeConsecutiveMissesFromThrows(arr);

	window.scoringThrowHistory = arr.map(t => ({
	  player: (t.side === "p2" ? "p2" : "p1"),
	  score: Number(t.score) || 0,
	  isMiss: t.is_miss === true || Number(t.score) === 0,
	  isFault: t.is_fault === true
	}));

	// UI refresh (single authoritative redraw)
	updateScoringHeaderUI();
	syncLiveSetScoreUI();
	syncTeamLineupsUI?.();
	syncHeaderTikku();
}


// -----------------------------------------------------------
// EXPORTS
// -----------------------------------------------------------

window.openScoringConsole = App.Features.Scoring.openConsole;
