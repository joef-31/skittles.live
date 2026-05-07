console.log("[state.js] loaded");

window.currentMatchId = null;
window.currentTournamentId = null;
window.lastSeenSet = null;
window.App = window.App || {};
App.Auth = App.Auth || {};
App.Features = App.Features || {};
App.Features.Match = App.Features.Match || {};
window.liveSetByMatch = {};
window.__scorerOwnsState = false;

window.tournamentContext = {
  tournamentId: null,
  editionId: null,
  stageId: null,
  groupId: null,
  activeOverviewTab: "overview",
  defaultTab: null,
  manageSubview: null,
  selectedBracketId: null,
  bracketRoundIndex: 0
};

// ---------------------------------------------
// Global player cache (for admin tools, view-as)
// ---------------------------------------------

window.allPlayers = null;

window.loadAllPlayers = async function () {
  if (window.allPlayers) return window.allPlayers;

  if (!window.supabaseClient) {
    console.warn("[players] supabaseClient not ready");
    return [];
  }

  const { data, error } = await window.supabaseClient
    .from("players")
    .select("id, name")
    .order("name");

  if (error) {
    console.error("[players] failed to load players", error);
    window.allPlayers = [];
    return [];
  }

  window.allPlayers = data || [];
  return window.allPlayers;
};


window.tournamentContext.selectedBracketId ??= null;
window.tournamentContext.bracketRoundIndex ??= 0;

function isSuperAdmin() {
  return !!window.auth?.permissions?.some(p => p.role === "super_admin");
}

function canManageTournament(tournament) {
  if (!tournament) return false;

  // Super admin
  if (isSuperAdmin()) return true;

  const perms = window.auth?.permissions || [];

  return perms.some(p => {
    // Tournament admin (scoped)
    if (
      p.role === "tournament_admin" &&
      p.scope_type === "tournament" &&
      String(p.scope_id) === String(tournament.id)
    ) {
      return true;
    }

    // Country admin (scoped by country name)
    if (
      p.role === "country_admin" &&
      p.scope_type === "country" &&
      p.scope_value === tournament.country
    ) {
      return true;
    }

    return false;
  });
}

function userOwnsMatch(match) {
  if (!match) return false;
  if (!Array.isArray(window.auth?.players)) return false;

  return (
    window.auth.players.includes(match.player1_id) ||
    window.auth.players.includes(match.player2_id)
  );
}

App.Auth.canScoreMatch = function (match) {
  if (!match || !window.auth) return false;

  // ---------------------------------------------
  // 1. Explicit permission (admin / referee / etc)
  // ---------------------------------------------
  if (
    typeof window.auth.can === "function" &&
    window.auth.can("score_match", {
      type: "match",
      id: match.id
    })
  ) {
    return true;
  }

  // ---------------------------------------------
  // 2. Player-based permission
  // ---------------------------------------------

  // Map auth user → player id
  const playerId = window.currentPlayerId || window.auth.user?.id;
  if (!playerId) return false;

  // Singles match
  if (match.player1_id && match.player2_id) {
    return (
      match.player1_id === playerId ||
      match.player2_id === playerId
    );
  }

  // Team match — ANY team member may score
  const team1Id = match.team1_id || match.team1?.id;
  const team2Id = match.team2_id || match.team2?.id;

  if (
    team1Id &&
    team2Id &&
    Array.isArray(window.currentTeamMembers)
  ) {
    return window.currentTeamMembers.some(
      m =>
        m.player_id === playerId &&
        (m.team_id === team1Id || m.team_id === team2Id)
    );
  }

  return false;
};


// ===================================================
// Realtime -> full match rehydrate (readers only)
// ===================================================
window.__matchRealtimeRehydrateTimer = null;
window.__matchRealtimeRehydrateInFlight = false;
window.__matchRealtimeRehydrateQueued = false;

/**
 * Schedule a full rehydrate of the match detail view from DB.
 * - Debounced to collapse bursts (e.g. set update + match update + throws insert)
 * - Readers only (scoring console should stay smooth and local)
 */
App.Features.Match.scheduleMatchDetailRehydrate = function (reason) {
  if (!window.currentMatchId) return;

  // Scorer stays on incremental local state; don't fight the console
	if (
	  window.isScoringConsoleOpen &&
	  window.scoringMatch?.matchId === window.currentMatchId
	) {
	  return;
	}

  // Collapse rapid-fire events into one rehydrate
  clearTimeout(window.__matchRealtimeRehydrateTimer);

  window.__matchRealtimeRehydrateTimer = setTimeout(async () => {
    // If one is already running, queue one more pass afterwards
    if (window.__matchRealtimeRehydrateInFlight) {
      window.__matchRealtimeRehydrateQueued = true;
      return;
    }

    window.__matchRealtimeRehydrateInFlight = true;

    try {
      // Optional: tag to suppress loading spinner if you want
      window.__isRealtimeRehydrate = true;

      await App.Features.Match.renderMatchDetail(
        window.currentMatchId,
        window.currentTournamentId,
		{ silent: true }
      );

    } catch (e) {
      console.error("[realtime] match rehydrate failed", reason, e);
    } finally {
      window.__isRealtimeRehydrate = false;
      window.__matchRealtimeRehydrateInFlight = false;

      if (window.__matchRealtimeRehydrateQueued) {
        window.__matchRealtimeRehydrateQueued = false;
        App.Features.Match.scheduleMatchDetailRehydrate("queued");
      }
    }
  }, 120); // 120–250ms is usually a good debounce window
};

window.initRealtimeSubscriptions = async function initRealtimeSubscriptions() {
	if (window.__realtimeInitialised) return;
	window.__realtimeInitialised = true;
	
  if (!window.supabaseClient) {
    console.warn("[realtime] supabaseClient not ready");
    return;
  }

  window.setsChannel = window.supabaseClient
    .channel("sets-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "sets" },
		async payload => {
		  const set = payload.new;
		  if (!set) return;

		  // --------------------------------------------------
		  // TOURNAMENT OVERVIEW (ALWAYS AUTHORITATIVE)
		  // --------------------------------------------------
		  const p1 = set.score_player1 ?? "";
		  const p2 = set.score_player2 ?? "";

		  window.liveSetByMatch[set.match_id] = { p1, p2 };

		  document
			.querySelectorAll(`.card[data-mid="${set.match_id}"] .mc-livebox`)
			.forEach((box, idx) => {
			  box.textContent = idx === 0 ? p1 : p2;
			  box.classList.add("is-live");
			});

		  // --------------------------------------------------
		  // MATCH DETAIL FILTERING
		  // --------------------------------------------------
		  if (
			window.currentMatchId &&
			set.match_id !== window.currentMatchId
		  ) {
			return;
		  }

		  // --------------------------------------------------
		  // SCORER VIEW (LOCAL, SMOOTH)
		  // --------------------------------------------------
			if (window.isScoringConsoleOpen) {
			  smoothUpdateSetRow(set);

			  // 🔑 If the active-set situation may have changed,
			  // recompute scoring state from DB
			  if (set.winner_player_id !== null || set.current_thrower === null) {
				const { data: sets } = await window.supabaseClient
				  .from("sets")
				  .select("*")
				  .eq("match_id", set.match_id)
				  .order("set_number", { ascending: true });

				await resetScoringStateForMatch(
				  {
					id: scoringMatch.matchId,
					status: scoringMatch.status,
					team1: scoringMatch.isTeamMatch ? { id: scoringMatch.p1Id, name: scoringMatch.p1Name } : null,
					team2: scoringMatch.isTeamMatch ? { id: scoringMatch.p2Id, name: scoringMatch.p2Name } : null,
					player1: !scoringMatch.isTeamMatch ? { id: scoringMatch.p1Id, name: scoringMatch.p1Name } : null,
					player2: !scoringMatch.isTeamMatch ? { id: scoringMatch.p2Id, name: scoringMatch.p2Name } : null,
					final_sets_player1: scoringMatch.setsP1,
					final_sets_player2: scoringMatch.setsP2
				  },
				  sets
				);
			  }

			  return;
			}

		  // --------------------------------------------------
		  // READER MATCH VIEW
		  // --------------------------------------------------
		  if (!window.__matchHydrated) {
			App.Features.Match.scheduleMatchDetailRehydrate("initial-set-sync");
			return;
		  }

			smoothUpdateSetRow(set);

			if (window.scoringCurrentSetId === set.id) {
			  // refresh thrower/scores/rotation from DB for the active set
			  await syncScoringStateFromDB(set.id);
			}
			updateStartSetVisibility();

			if (!set.winner_player_id) {
			  updateScoringHeaderUI();
			  syncHeaderTikku();
			  updateStartSetVisibility();

			  if (scoringMatch?.isTeamMatch) {
				renderTeamLineups(scoringMatch);
				syncTeamLineupsUI?.();
			  }
			}
		}
    )
    .subscribe();

	window.throwsChannel = window.supabaseClient
	  .channel("throws-realtime")
	  .on(
		"postgres_changes",
		{ event: "*", schema: "public", table: "throws" },
		async payload => {
		  const row = payload.new || payload.old;
		  if (!row) return;
		  if (row.match_id !== window.currentMatchId) return;

		  // Always rebuild from DB for the affected set if it is the current one
		  if (window.scoringCurrentSetId && row.set_id === window.scoringCurrentSetId) {
			await syncScoringStateFromDB(window.scoringCurrentSetId);
		  }

		  // keep any other UI updates you want
		  updateLiveThrowsForSet(row.set_number);
		}
	  )
	  .subscribe();
}

async function handleReaderSetStart(setRow) {
  // Guard: only for current match
  if (setRow.match_id !== window.currentMatchId) return;

  // Do NOT override scorer state
  if (window.isScoringConsoleOpen) return;

  // 1️⃣ Set local read-only state
  scoringCurrentSetId = setRow.id;
  scoringMatch.currentSetNumber = setRow.set_number;

  scoringCurrentSetSP1 = setRow.score_player1 ?? 0;
  scoringCurrentSetSP2 = setRow.score_player2 ?? 0;

  scoringCurrentThrower = setRow.current_thrower ?? null;

  // 2️⃣ Load lineups for this set
  const { data: lineups } = await supabaseClient
    .from("set_lineups")
    .select("team_id, player_id")
    .eq("set_id", setRow.id);

  window.currentSetLineups = { p1: [], p2: [] };

  if (Array.isArray(lineups)) {
    lineups.forEach(r => {
      if (r.team_id === scoringMatch.p1Id) {
        window.currentSetLineups.p1.push(r.player_id);
      }
      if (r.team_id === scoringMatch.p2Id) {
        window.currentSetLineups.p2.push(r.player_id);
      }
    });
  }

  // 3️⃣ Re-render read-only UI
  renderTeamLineups(scoringMatch);
  syncHeaderTikku();
  updateScoringHeaderUI();
  syncStartSetUI();
  updateStartSetVisibility();

  // 4️⃣ Refresh sets table
  if (typeof refreshSetsForReaders === "function") {
    refreshSetsForReaders();
  }
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
  App.Features.Match.refreshMatchSets();

  updateScoringHeaderUI();
  syncStartSetUI();
  updateStartSetVisibility();
  syncHeaderTikku();

  return true;
}

console.log("[state.js] initRealtimeSubscriptions =", typeof window.initRealtimeSubscriptions);
