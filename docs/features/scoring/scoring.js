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

function advanceThrowerWithinSide(sideKey) {
	const side = scoringMatch.sideModel?.[sideKey];
	if (!side || side.type !== "team") return;

	side.currentIndex =
		(side.currentIndex + 1) % side.lineup.length;
}

async function resetScoringStateForMatch(match, sets) {
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
		scoringCurrentThrower = currentSet.current_thrower;
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

	scoringThrowHistory = [];
	scoringConsecutiveMisses = { p1: 0, p2: 0 };

	updateScoringHeaderUI();
	updateStartSetVisibility();
	syncStartSetUI();
	syncTeamLineupsUI();
	
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

	// 🔑 IMMEDIATELY update local state
	scoringCurrentSetId = setRow.id;
	scoringCurrentThrower = firstThrower;

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

	scoringCurrentSetId = setRow.id;
	scoringCurrentThrower = firstThrower;
	if (scoringMatch.isTeamMatch) {
		scoringMatch.sideModel.p1.lineup = [...window.currentSetLineups.p1];
		scoringMatch.sideModel.p2.lineup = [...window.currentSetLineups.p2];
		scoringMatch.sideModel.p1.currentIndex = 0;
		scoringMatch.sideModel.p2.currentIndex = 0;
	}
	scoringCurrentSetSP1 = setRow.score_player1 || 0;
	scoringCurrentSetSP2 = setRow.score_player2 || 0;
	scoringThrowHistory = [];

	updateStartSetVisibility();
	updateScoringHeaderUI();
	syncHeaderTikku();
	syncTeamLineupsUI();
	renderTeamLineups(window.scoringMatch);
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
		playerId: getCurrentThrowerPlayerId(),
		score,
		isMiss,
		isFault
	});

	// After inserting the throw and recalcing SP:
	await recalcMatchSmallPoints(scoringMatch.matchId);

	if (await checkThreeMissLoss(playerKey)) return;

	// Existing logic
	if (await checkSetWin()) return;

	advanceThrowerWithinSide(scoringCurrentThrower);

	// Flip thrower FIRST
	scoringCurrentThrower = isP1 ? "p2" : "p1";
	
	syncTeamLineupsUI();

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
	syncHeaderTikku();
	updateLiveThrowsForSet(scoringMatch.currentSetNumber);
	renderTeamLineups(window.scoringMatch);
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

	const losingSide = playerKey;
	const winningSide = playerKey === "p1" ? "p2" : "p1";

	let winnerId = null;

	if (scoringMatch.isTeamMatch) {
	  winnerId = getLastThrowerPlayerId(winningSide);
	} else {
	  winnerId = winningSide === "p1"
		? scoringMatch.p1Id
		: scoringMatch.p2Id;
	}

	if (!winnerId) {
	  console.error("[three-miss] could not resolve winning player");
	  return false;
	}
	
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

function getLastThrowerPlayerId(sideKey) {
  const side = scoringMatch.sideModel?.[sideKey];
  if (!side || side.type !== "team") return null;

  if (!Array.isArray(side.lineup) || side.lineup.length === 0) return null;

  return side.lineup[side.currentIndex];
}

// -----------------------------------------------------------
// SET WIN
// -----------------------------------------------------------

async function checkSetWin() {
  let winningSide = null;

  // 1️⃣ Detect a winning condition (SIDE, not ID)
  if (scoringCurrentSetSP1 === 50 && scoringCurrentSetSP2 < 50) {
    winningSide = "p1";
  } else if (scoringCurrentSetSP2 === 50 && scoringCurrentSetSP1 < 50) {
    winningSide = "p2";
  }

  if (!winningSide) return false;

  // 2️⃣ Resolve the ACTUAL PLAYER who won the set
  const winningPlayerId = scoringMatch.isTeamMatch
    ? getCurrentThrowerPlayerId()
    : scoringMatch[`${winningSide}Id`];

  if (!winningPlayerId) {
    console.error("[checkSetWin] No winning player could be resolved");
    return false;
  }

  // 3️⃣ Persist set result (PLAYER id only — FK-safe)
  const { error: setErr } = await window.supabaseClient
    .from("sets")
    .update({
      score_player1: scoringCurrentSetSP1,
      score_player2: scoringCurrentSetSP2,
      winner_player_id: winningPlayerId,
      current_thrower: null
    })
    .eq("id", scoringCurrentSetId);

  if (setErr) {
    console.error("[checkSetWin] failed to update set", setErr);
    return false;
  }

  // 4️⃣ Update local match set counters
  if (winningSide === "p1") scoringMatch.setsP1++;
  if (winningSide === "p2") scoringMatch.setsP2++;

  const { error: matchErr } = await window.supabaseClient
    .from("matches")
    .update({
      final_sets_player1: scoringMatch.setsP1,
      final_sets_player2: scoringMatch.setsP2
    })
    .eq("id", scoringMatch.matchId);

  if (matchErr) {
    console.error("[checkSetWin] failed to update match", matchErr);
  }

  // 5️⃣ Advance local state
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
  syncHeaderTikku();

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
	//		 we might need to hide the start-next-set overlay.
	updateStartSetVisibility();
	
	renderTeamLineups(window.scoringMatch);
	syncHeaderTikku();
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
	
	syncHeaderTikku()
}

function syncThrowstripUI() {
	const p1Strip = document.getElementById("header-throws-p1");
	const p2Strip = document.getElementById("header-throws-p2");
	if (!p1Strip || !p2Strip) return;

	p1Strip.innerHTML = "";
	p2Strip.innerHTML = "";

	const startSide = scoringCurrentThrower
		? scoringCurrentThrower
		: "p1"; // fallback, should rarely be used

	scoringThrowHistory.forEach((t, idx) => {
		const el = document.createElement("span");
		el.className = "throw-pill";
		el.textContent = t.isFault ? "F" : t.isMiss ? "–" : t.score;

		// Determine side based on start side + parity
		const isEven = idx % 2 === 1;
		const side =
			startSide === "p1"
				? (isEven ? "p2" : "p1")
				: (isEven ? "p1" : "p2");

		if (side === "p1") p1Strip.appendChild(el);
		else p2Strip.appendChild(el);
	});
}

// -----------------------------------------------------------
// EXPORTS
// -----------------------------------------------------------

window.openScoringConsole = App.Features.Scoring.openConsole;
