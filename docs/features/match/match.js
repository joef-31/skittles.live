// =============================================
// Match rendering (read-only)
// =============================================
window.App = window.App || {};
App.Features = App.Features || {};
App.Features.Match = App.Features.Match || {};

App.Features.Match.renderMatchDetail = async function (matchId, tournamentId) {

  window.currentMatchId = matchId;
  window.currentTournamentId = tournamentId;
  window.lastSeenSet = null;
  App.Utils.DOM.showLoading("Loading match…");

  // -----------------------
  // Load match
  // -----------------------
  const { data: match, error: matchError } =
    await window.supabaseClient
      .from("matches")
		.select(`
		  id,
		  match_date,
		  status,
		  final_sets_player1,
		  final_sets_player2,
		  player1:player1_id ( id, name ),
		  player2:player2_id ( id, name ),
		  team1:team1_id ( id, name ),
		  team2:team2_id ( id, name ),
		  edition_id,
		  tournament:tournament_id ( id, name )
		`)
      .eq("id", matchId)
      .maybeSingle();

  if (matchError || !match) {
    console.error(matchError);
    App.Utils.DOM.showError("Failed to load match");
    return;
  }
  
	  // Ensure globals exist (match route may bypass overview)
	window.currentTeamMembers = Array.isArray(window.currentTeamMembers)
	  ? window.currentTeamMembers
	  : [];

	window.allPlayers = Array.isArray(window.allPlayers)
	  ? window.allPlayers
	  : [];
	  
	  let editionMinTeamSize = null;

	if (match.edition_id) {
	  const { data: edition, error } = await window.supabaseClient
		.from("editions")
		.select("id, min_team_size")
		.eq("id", match.edition_id)
		.maybeSingle();

	  if (!error && edition) {
		editionMinTeamSize = Number(edition.min_team_size) || 0;
	  }
	}

  // -----------------------
  // Load sets
  // -----------------------
  const { data: sets, error: setsError } =
    await window.supabaseClient
      .from("sets")
      .select("*")
      .eq("match_id", matchId)
      .order("set_number");

  if (setsError) {
    console.error(setsError);
    App.Utils.DOM.showError("Failed to load sets");
    return;
  }
  
  const liveSet = sets.find(s => !s.winner_player_id);

  // -----------------------
  // Load throws
  // -----------------------
  const { data: throwsData, error: throwsError } =
    await window.supabaseClient
      .from("throws")
      .select("*")
      .eq("match_id", matchId)
      .order("set_number")
      .order("throw_number");

  if (throwsError) {
    console.error(throwsError);
    App.Utils.DOM.showError("Failed to load throws");
    return;
  }
  
	const isTeamTournament = Boolean(match.team1 || match.team2);
	
	if (window.allPlayers.length === 0) {
	  const { data, error } = await window.supabaseClient
		.from("players")
		.select("id, name");

	  if (!error) {
		window.allPlayers = data || [];
	  }
	}
	  
	const p1Name = isTeamTournament
	  ? match.team1?.name || "Team 1"
	  : match.player1?.name || "Player 1";

	const p2Name = isTeamTournament
	  ? match.team2?.name || "Team 2"
	  : match.player2?.name || "Player 2";
	  
		// -----------------------
		// Load team members (team matches only)
		// -----------------------
		if (isTeamTournament) {
		  const teamIds = [
			match.team1?.id,
			match.team2?.id
		  ].filter(Boolean);

		  if (teamIds.length) {
			const { data: members, error } = await window.supabaseClient
			  .from("team_members")
			  .select("team_id, player_id")
			  .in("team_id", teamIds);

			if (error) {
			  console.error("[team_members] load failed", error);
			  window.currentTeamMembers = [];
			} else {
			  window.currentTeamMembers = members || [];
			}
		  } else {
			window.currentTeamMembers = [];
		  }
		}

	// --------------------------------------------------
	// Match detail context (used by scoring + live views)
	// --------------------------------------------------
	window.matchDetailContext = {
	  matchId,
	  tournamentId,

	  p1Id: isTeamTournament
		? match.team1?.id ?? null
		: match.player1?.id ?? null,

	  p2Id: isTeamTournament
		? match.team2?.id ?? null
		: match.player2?.id ?? null,

	  p1Name,
	  p2Name
	};
	
	renderBottomBar();
	
	// -----------------------
	// Load set lineups (team matches only)
	// -----------------------
	window.currentSetLineups = { p1: [], p2: [] };

	if (isTeamTournament && sets?.length) {
	  const liveSet = sets.find(s => !s.winner_player_id);

	  if (liveSet) {
		const { data: lineups, error } = await window.supabaseClient
		  .from("set_lineups")
		  .select("team_id, player_id")
		  .eq("set_id", liveSet.id);

		if (!error && Array.isArray(lineups)) {
		  lineups.forEach(row => {
			if (row.team_id === match.team1?.id) {
			  window.currentSetLineups.p1.push(row.player_id);
			} else if (row.team_id === match.team2?.id) {
			  window.currentSetLineups.p2.push(row.player_id);
			}
		  });
		}
	  }
	}
  
	// ===================================================
	// Initialise scoring system for this match
	// ===================================================
	if (
	  window.resetScoringStateForMatch &&
	  typeof window.resetScoringStateForMatch === "function"
	) {
	  resetScoringStateForMatch(
		  {
			...match,
			min_team_size: editionMinTeamSize
		  },
		  sets || []
		);
	} else {
	  console.warn(
		"[match] resetScoringStateForMatch not available – scoring disabled"
	  );
	}

  // -----------------------
  // Group throws by set
  // -----------------------
  const throwsBySet = {};
  (throwsData || []).forEach(t => {
    if (!throwsBySet[t.set_number]) {
      throwsBySet[t.set_number] = [];
    }
    throwsBySet[t.set_number].push(t);
  });

  // -----------------------
  // Status pill
  // -----------------------
  let pillClass = "scheduled";
  let pillLabel = "Scheduled";

  if (match.status === "live") {
    pillClass = "live";
    pillLabel = "Live";
  } else if (match.status === "finished") {
    pillClass = "finished";
    pillLabel = "Finished";
  }

  const overallSets =
    `${match.final_sets_player1 ?? 0} – ${match.final_sets_player2 ?? 0}`;
	
	console.log("[match header]", {
	isTeamTournament,
	p1Name,
	p2Name,
	team1: match.team1,
	team2: match.team2
	});

  // -----------------------
  // Render header + container
  // -----------------------
  App.Utils.DOM.setContent(`
    <div class="card top-card">
      <div class="subtitle">
        ${match.tournament?.name || "Tournament"}
      </div>

      <div class="top-score-row">
		<span class="match-header-player" data-side="p1" style="text-align:right;">
		  ${p1Name}
		</span>

		<div class="top-score">${overallSets}</div>

		<span class="match-header-player" data-side="p2">
		  ${p2Name}
		</span>
      </div>
	  
		  <div class="live-throwstrip-row">
			<div class="live-throwstrip p1" id="header-throws-p1"></div>
			<div class="live-setscore" id="header-live-setscore"></div>
			<div class="live-throwstrip p2" id="header-throws-p2"></div>
		  </div>
	  
		<div class="team-lineups" id="team-lineups"></div>

		  <div class="current-thrower" id="scoring-current-thrower-label"></div>

      <div class="match-small" style="text-align:center;">
        ${formatDate(match.match_date)}
      </div>

      <div class="match-small" style="text-align:center;">
        <span class="pill ${pillClass}">${pillLabel}</span>
      </div>
    </div>

    <div class="card">
      <div class="tab-row">
        <div class="tab active">Sets</div>
      </div>
      <div id="tab-sets"></div>
    </div>
  `);
	
	renderTeamLineups(window.scoringMatch);
	syncHeaderTikku();
  
	  if (liveSet) {
	  // 1️⃣ Live set score
	  const headerScore = document.getElementById("header-live-setscore");
	  if (headerScore) {
		const sp1 = liveSet.score_player1 ?? 0;
		const sp2 = liveSet.score_player2 ?? 0;
		headerScore.textContent = `${sp1} – ${sp2}`;
	  }

	  // 2️⃣ Live throwstrips
	  await updateLiveThrowsForSet(liveSet.set_number);
	}

  // -----------------------
  // Render sets (expandable)
  // -----------------------
	const c1Id = isTeamTournament ? match.team1?.id : match.player1?.id;
	const c2Id = isTeamTournament ? match.team2?.id : match.player2?.id;

	App.Features.Match.renderMatchSets(
	  sets,
	  throwsBySet,
	  c1Id,
	  c2Id,
	  p1Name,
	  p2Name
	);

  // -----------------------
  // Bottom bar (contextual)
  // -----------------------
  if (App.UI && App.UI.updateBottomBar) {
    App.UI.updateBottomBar();
  }
};

function syncHeaderTikku() {
  document
    .querySelectorAll(".match-header-player")
    .forEach(el => el.querySelector(".tikku-icon")?.remove());

  if (!scoringCurrentSetId || !scoringCurrentThrower) return;

	const target = document.querySelector(
	  `.match-header-player[data-side="${scoringCurrentThrower}"]`
	);
  if (!target) return;

  const img = document.createElement("img");
  img.src = "assets/icon-tikku.svg";
  img.className = "tikku-icon";

  target.prepend(img);
}

function isPlayableMatch(m) {
  return (
    m.player1?.id &&
    m.player2?.id &&
    m.status !== "structure"
  );
}

function renderMatchCards(
    matches,
    tournamentId,
    liveSetByMatch,
    dateFilter,
    targetId = "tab-matches"
) {
    const matchesContainer = document.getElementById(targetId);
    if (!matchesContainer) return;
	
	const isTeamTournament =
	  Number(
		window.currentEditions?.find(
		  e => e.id === window.tournamentContext?.editionId
		)?.min_team_size
	  ) > 1;

    let filtered = matches;

    if (dateFilter) {
        filtered = matches.filter(
            (m) => isoDateOnly(m.match_date) === dateFilter
        );
    }

    if (!filtered.length) {
        matchesContainer.innerHTML =
            '<div class="empty-message">No matches to display.</div>';
        return;
    }

    let html = '<div class="section-title">Matches</div>';

    filtered.forEach((m) => {
		const p1Name = isTeamTournament
		  ? m.team1?.name || "TBC"
		  : m.player1?.name || "Player 1";

		const p2Name = isTeamTournament
		  ? m.team2?.name || "TBC"
		  : m.player2?.name || "Player 2";

        const setsScore1 = m.final_sets_player1 ?? 0;
        const setsScore2 = m.final_sets_player2 ?? 0;

        const status = m.status || "scheduled";
        let statusClass = "scheduled";
        let statusLabel = "Scheduled";

        if (status === "live") {
            statusClass = "live";
            statusLabel = "Live";
        } else if (status === "finished") {
            statusClass = "finished";
            statusLabel = "Finished";
        }

        const dateLabel = formatDate(m.match_date);

        const liveSet = status === "live" ? liveSetByMatch[m.id] : null;
        const liveP1 = liveSet ? liveSet.p1 : "";
        const liveP2 = liveSet ? liveSet.p2 : "";
        html += `
  <div class="card clickable" data-mid="${m.id}" data-tid="${tournamentId}">
    <div class="match-card-grid">
      <div class="mc-meta">${dateLabel}</div>

      <div class="mc-player">${p1Name}</div>

      <div class="mc-livebox ${liveSet ? "is-live" : ""}">
        ${liveP1}
      </div>

      <div class="mc-setscore">${setsScore1}</div>

      <div class="mc-meta">
        <span class="pill ${statusClass}">${statusLabel}</span>
      </div>

      <div class="mc-player">${p2Name}</div>

      <div class="mc-livebox ${liveSet ? "is-live" : ""}">
        ${liveP2}
      </div>

      <div class="mc-setscore">${setsScore2}</div>
    </div>
  </div>
`;
    });

    matchesContainer.innerHTML = html;
	
	// Hydrate live set scores once cards exist in the DOM
	const matchIds = filtered.map(m => m.id);
	window.loadInitialLiveSetScores(matchIds);

    matchesContainer.querySelectorAll("[data-mid]").forEach((el) => {
        el.addEventListener("click", () => {
            const mid = el.dataset.mid;
            const tid = el.dataset.tid;
            window.location.hash = `#/match/${mid}/${tid}`;
        });
    });
}

// -----------------------
// DAILY
// -----------------------

function renderTournamentDailyTab(matches) {
  const container = document.getElementById("tab-daily");
  if (!container) return;

  // ------------------------------------
  // Ensure selected date exists (FIRST LOAD FIX)
  // ------------------------------------
  if (!window.tournamentContext.selectedDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    window.tournamentContext.selectedDate = today.toISOString();
  }

  const selectedDate = new Date(window.tournamentContext.selectedDate);

  // ------------------------------------
  // Filter matches for selected day
  // ------------------------------------
  const filtered = matches.filter(m => {
    if (!m.match_date) return false;

    const d = new Date(m.match_date);
    return (
      d.getFullYear() === selectedDate.getFullYear() &&
      d.getMonth() === selectedDate.getMonth() &&
      d.getDate() === selectedDate.getDate()
    );
  });

  // ------------------------------------
  // Render
  // ------------------------------------
  container.innerHTML = "";

  if (!filtered.length) {
    container.innerHTML =
      `<div class="empty-message">No matches scheduled for this day.</div>`;
    return;
  }

  renderMatchCards(
    filtered,
    window.currentTournamentId,
    {},          // liveSetByMatch (unchanged)
    null,        // date already applied
    "tab-daily"
  );

  // ------------------------------------
  // Prime live boxes
  // ------------------------------------
  document.querySelectorAll("#tab-daily .card[data-mid]").forEach(card => {
    const mid = card.dataset.mid;
    const live = window.liveSetByMatch?.[mid];
    if (!live) return;

    const boxes = card.querySelectorAll(".mc-livebox");
    if (boxes.length !== 2) return;

    boxes[0].textContent = live.p1 ?? "";
    boxes[1].textContent = live.p2 ?? "";
    boxes[0].classList.add("is-live");
    boxes[1].classList.add("is-live");
  });
}

// -----------------------
// FIXTURES
// -----------------------

function renderTournamentFixturesTab(matches) {
    const el = document.getElementById("tab-fixtures");
    if (!el) return;

    const upcoming = matches.filter(
		m => ["scheduled", "live"].includes(m.status)
	);

    if (!upcoming.length) {
        el.innerHTML =
            `<div class="empty-message">No upcoming fixtures.</div>`;
        return;
    }

    el.innerHTML = `<div id="tab-matches"></div>`;

    renderMatchCards(
        upcoming,
        window.currentTournamentId,
        {},
        null,
        "tab-fixtures"
    );
}

// -----------------------
// RESULTS
// -----------------------

function renderTournamentResultsTab(matches) {
  const el = document.getElementById("tab-results");

  const finished = matches
    .filter(m => m.status === "finished")
    .sort((a, b) => {
      const da = a.match_date ? new Date(a.match_date) : 0;
      const db = b.match_date ? new Date(b.match_date) : 0;
      return db - da; // newest first
    });

  if (!finished.length) {
    el.innerHTML =
      `<div class="empty-message">No results yet.</div>`;
    return;
  }

  el.innerHTML = `<div id="tab-matches"></div>`;

  renderMatchCards(
    finished,
    window.currentTournamentId,
    {},
    null,
    "tab-results"
  );
}

function renderTournamentOverviewTab(tournament, matches) {
    const el = document.getElementById("tab-overview");
    if (!el) return;

    const total = matches.length;
    const finished = matches.filter(m => m.status === "finished").length;
    const upcoming = matches.filter(m => m.status === "scheduled").length;

    el.innerHTML = `
<div class="overview-grid">
  <div class="overview-item">
    <div class="label">Tournament</div>
    <div class="value">${tournament.name}</div>
  </div>

  <div class="overview-item">
    <div class="label">Matches</div>
    <div class="value">${total}</div>
  </div>

  <div class="overview-item">
    <div class="label">Finished</div>
    <div class="value">${finished}</div>
  </div>

  <div class="overview-item">
    <div class="label">Upcoming</div>
    <div class="value">${upcoming}</div>
  </div>
</div>
`;
}

async function loadMatchThrowsUpload(matchId) {
  showBackButton(() => window.history.back());

  setContent(`
    <div class="card">
      <div class="tournament-header">
        <div class="tournament-name">Upload throws</div>
        <div class="subtitle">CSV format</div>
      </div>

      <textarea id="throws-csv" rows="10" placeholder="set,throw,p1,p2"></textarea>

      <button class="header-btn" id="upload-throws-btn">
        Upload throws
      </button>

      <div class="error" id="throws-error" style="display:none;"></div>
    </div>
  `);

  document.getElementById("upload-throws-btn").onclick = async () => {
    try {
      const text = document.getElementById("throws-csv").value.trim();
      if (!text) throw new Error("CSV is empty.");

      const lines = text.split("\n").slice(1);

      for (const line of lines) {
        const [setNum, throwNum, p1, p2] = line.split(",").map(v => v.trim());

        if (p1 !== "") {
          await window.supabaseClient.from("throws").insert({
            match_id: matchId,
            set_number: Number(setNum),
            throw_number: Number(throwNum),
            score: Number(p1)
          });
        }

        if (p2 !== "") {
          await window.supabaseClient.from("throws").insert({
            match_id: matchId,
            set_number: Number(setNum),
            throw_number: Number(throwNum),
            score: Number(p2)
          });
        }
      }

      alert("Throws uploaded.");
      window.location.hash = `#/match/${matchId}/${window.currentTournamentId}`;
    } catch (err) {
      const box = document.getElementById("throws-error");
      box.textContent = err.message;
      box.style.display = "block";
    }
  };
}

async function loadTournamentMatchSets(matchId, tournamentId) {
	console.log("[loadTournamentMatchSets] called", matchId);

  window.currentMatchId = matchId;
  window.currentTournamentId = tournamentId;
  window.lastSeenSet = null;

  showBackButton(() => {
    window.location.hash = `#/tournament/${tournamentId}/matches`;
  });
  setAddFriendlyVisible(false);

  showLoading("Loading set scores…");

  const { data: match, error } = await window.supabaseClient
    .from("matches")
    .select(`
      id,
      final_sets_player1,
      final_sets_player2,
      player1:player1_id ( id, name ),
      player2:player2_id ( id, name )
    `)
    .eq("id", matchId)
    .maybeSingle();

  if (error || !match) {
    console.error(error);
    showError("Failed to load match.");
    return;
  }

  const setsToCreate =
    (match.final_sets_player1 ?? 0) + (match.final_sets_player2 ?? 0);

  if (!setsToCreate) {
    showError("This match has no completed sets.");
    return;
  }

  const rowsHtml = Array.from({ length: setsToCreate }, (_, i) => {
    const setNo = i + 1;
    return `
	  <tr data-set="${setNo}">
        <td>Set ${setNo}</td>
        <td>
          <input
            type="number"
            min="0"
            max="50"
            data-set="${setNo}"
            data-p="1"
          />
        </td>
		<td class="cum-cell" data-set="${setNo}"> – </td>
        <td>
          <input
            type="number"
            min="0"
            max="50"
            data-set="${setNo}"
            data-p="2"
          />
        </td>
      </tr>
    `;
  }).join("");

  setContent(`
    <div class="card">
      <div class="tournament-header">
        <div class="tournament-name">Add set scores</div>
        <div class="subtitle">
          ${match.player1?.name || "Player 1"} vs ${match.player2?.name || "Player 2"}
        </div>
      </div>

      <table class="simple-table">
        <thead>
          <tr>
            <th>Set</th>
            <th>${match.player1?.name || "Player 1"}</th>
			<th>${match.final_sets_player1} – ${match.final_sets_player2}</th>
            <th>${match.player2?.name || "Player 2"}</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <button id="save-set-scores" class="header-btn" style="margin-top:15px;">
        Save set scores
      </button>
    </div>
  `);
  
	function updateCumulativeDisplay() {
	  let cumP1 = 0;
	  let cumP2 = 0;

	  const rows = document.querySelectorAll('tr[data-set]');

	  rows.forEach((row) => {
		const p1Input = row.querySelector('input[data-set][data-p="1"]');
		const cumCell = row.querySelector(".cum-cell");
		const p2Input = row.querySelector('input[data-set][data-p="2"]');

		const p1 = Number(p1Input?.value || 0);
		const p2 = Number(p2Input?.value || 0);

		// Count a set win only when exactly one player has 50.
		const p1Wins = (p1 === 50 && p2 !== 50);
		const p2Wins = (p2 === 50 && p1 !== 50);

		if (p1Wins) cumP1 += 1;
		if (p2Wins) cumP2 += 1;

		if (cumCell) cumCell.textContent = `${cumP1} – ${cumP2}`;
	  });
	}

// Wire live updates
document
  .querySelectorAll('input[data-set][data-p]')
  .forEach((input) => {
    input.addEventListener("input", updateCumulativeDisplay);
  });

// Initial render
updateCumulativeDisplay();

  const saveBtn = document.getElementById("save-set-scores");
  if (!saveBtn) return;

  saveBtn.addEventListener("click", async () => {
    // Collect all inputs
    const inputs = Array.from(
      document.querySelectorAll("input[data-set][data-p]")
    );

    // Group by set number, and combine P1/P2 into the same object
    const grouped = {};
    inputs.forEach((input) => {
      const setNo = input.dataset.set;   // e.g. "1"
      const player = input.dataset.p;    // "1" or "2"
      const value = Number(input.value || 0);

      if (!grouped[setNo]) {
        grouped[setNo] = { p1: 0, p2: 0 };
      }

      if (player === "1") {
        grouped[setNo].p1 = value;
      } else if (player === "2") {
        grouped[setNo].p2 = value;
      }
    });

    const rows = Object.keys(grouped).map((setNoStr) => {
      const setNo = Number(setNoStr);
      const { p1, p2 } = grouped[setNoStr];

      let winnerId = null;
      if (p1 === 50 && p2 < 50 && match.player1?.id) {
        winnerId = match.player1.id;
      } else if (p2 === 50 && p1 < 50 && match.player2?.id) {
        winnerId = match.player2.id;
      }

      return {
        match_id: matchId,
        set_number: setNo,
        score_player1: p1,
        score_player2: p2,
        winner_player_id: winnerId,
      };
    });

    // Optional: you may want to delete existing sets for this match first
    // await window.supabaseClient.from("sets").delete().eq("match_id", matchId);

    const { error: insertError } = await window.supabaseClient
      .from("sets")
      .insert(rows);

    if (insertError) {
      console.error(insertError);
      alert("Failed to save set scores.");
      return;
    }

    window.location.hash = `#/match/${matchId}/${tournamentId}`;
  });
}

function renderTeamLineups() {
  const wrap = document.getElementById("team-lineups");
  if (!wrap) return;

  if (!window.scoringMatch?.isTeamMatch) {
    wrap.innerHTML = "";
    return;
  }

  const members = Array.isArray(window.currentTeamMembers)
    ? window.currentTeamMembers
    : [];

const renderTeam = (sideModel, sideKey) => {
  if (!sideModel || sideModel.type !== "team") return "";

  const teamId = sideModel.id;
  const teamName = sideModel.name;

  const activeLineup = Array.isArray(sideModel.lineup)
    ? sideModel.lineup
    : [];

  const teamMembers = members
    .filter(m => m.team_id === teamId)
    .map(m => m.player_id);

  if (!teamMembers.length) return "";

  // Do we have an active set?
  const hasActiveSet =
    Boolean(scoringCurrentSetId) && activeLineup.length > 0;

  // Active players = lineup order
  const activePlayers = hasActiveSet
    ? activeLineup.filter(pid => teamMembers.includes(pid))
    : [];

  // Substitutes = remaining team members
  const subs = teamMembers.filter(
    pid => !activePlayers.includes(pid)
  );

  const renderPlayer = (pid, isActive, idx = null) => {
    const name =
      window.allPlayers.find(p => p.id === pid)?.name || "Unknown";

    const showTikku =
      isActive &&
      scoringCurrentSetId &&
      scoringCurrentThrower === sideKey &&
      sideModel.currentIndex === idx;

    return `
      <div class="team-player ${isActive ? "active" : "substitute"}">
        <span class="tikku-slot">
          ${showTikku ? `<img src="assets/icon-tikku.svg" class="tikku-icon">` : ""}
        </span>
        <span class="player-name">${name}</span>
      </div>
    `;
  };

  return `
    <div class="team-column">
      <div class="team-name">${teamName}</div>

      ${activePlayers.map((pid, idx) =>
        renderPlayer(pid, true, idx)
      ).join("")}

      ${subs.length
        ? `<div class="team-subs">
            ${subs.map(pid => renderPlayer(pid, false)).join("")}
          </div>`
        : ""}
    </div>
  `;
};

  wrap.innerHTML = `
	${renderTeam(scoringMatch.sideModel.p1, "p1")}
	${renderTeam(scoringMatch.sideModel.p2, "p2")}
  `;
}

function syncTeamLineupsUI() {
  if (!window.scoringMatch?.isTeamMatch) return;
  if (typeof renderTeamLineups !== "function") return;

  renderTeamLineups(window.scoringMatch);
}

async function DEV_resetMatch(matchId) {
  await supabaseClient.from("throws").delete().eq("match_id", matchId);
  await supabaseClient.from("sets").delete().eq("match_id", matchId);
  await supabaseClient.from("matches").update({
    final_sets_player1: 0,
    final_sets_player2: 0,
    status: "scheduled"
  }).eq("id", matchId);
}

/*
(async () => {
  const matchId = window.currentMatchId;

  if (!matchId) {
    console.error("No currentMatchId found");
    return;
  }

  await supabaseClient.from("throws").delete().eq("match_id", matchId);
  await supabaseClient.from("sets").delete().eq("match_id", matchId);
  await supabaseClient
    .from("matches")
    .update({
      final_sets_player1: 0,
      final_sets_player2: 0,
      status: "scheduled"
    })
    .eq("id", matchId);

  console.log("Match fully reset:", matchId);
})();
*/