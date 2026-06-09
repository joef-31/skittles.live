// =============================================
// Tournament feature registration
// =============================================

window.App = window.App || {};
App.Features = App.Features || {};
App.Features.Tournament = App.Features.Tournament || {};

function tournamentStorageKey(tournamentId) {
  return `tournament:view:${tournamentId}`;
}

function persistTournamentView(tournamentId) {
  if (!tournamentId) return;

  const payload = {
	editionId: window.tournamentContext.editionId || null,
	stageId: window.tournamentContext.stageId || null,
	bracketId: window.tournamentContext.selectedBracketId || null
  };

  localStorage.setItem(
	tournamentStorageKey(tournamentId),
	JSON.stringify(payload)
  );
}

function buildTournamentPlayers(matches) {

  const isTeamTournament =
    Number(
      window.currentEditions?.find(
        e => e.id === window.tournamentContext?.editionId
      )?.min_team_size
    ) > 1;

  if (isTeamTournament) {
    // IMPORTANT:
    // Team matches must NOT be rewritten into player-shaped objects.
    // Standings relies on team1_id / team2_id staying intact.
    return;
  }
  
    if (!Array.isArray(matches)) {
        window.tournamentPlayers = [];
        return;
    }

    const map = new Map();

    matches.forEach(m => {
        if (m.player1?.id) {
            map.set(m.player1.id, {
                id: m.player1.id,
                name: m.player1.name
            });
        }

        if (m.player2?.id) {
            map.set(m.player2.id, {
                id: m.player2.id,
                name: m.player2.name
            });
        }
    });

    window.tournamentPlayers = Array.from(map.values());
}

App.Features.Tournament.loadTournaments = async function () {
	window.currentMatchId = null;
	window.currentTournamentId = null;
	window.matchDetailContext = null;
	window.lastSeenSet = null;

	showBackButton(null);
	setAddFriendlyVisible(false);

	showLoading("Loading tournaments…");

	// Ensure the Friendlies "tournament" row exists
	await ensureFriendliesTournamentExists();

	// Load tournaments + all matches (for the date bar)
	const [
		{ data: tournamentsData, error: tournamentsError },
		{ data: matchesData, error: matchesError },
	] = await Promise.all([
		window.supabaseClient
			.from("tournaments")
			.select("id, name")
			.order("name", { ascending: true }),
		window.supabaseClient
		  .from("matches")
		  .select(`
			id,
			tournament_id,
			match_date,
			status,
			player1_id,
			player2_id
		  `),
	]);

	if (tournamentsError) {
		console.error(tournamentsError);
		showError("Failed to load tournaments");
		return;
	}
	if (matchesError) {
		console.error(matchesError);
		// We can still render tournaments; the date bar will just have less info
	}

	let tournaments = tournamentsData || [];
	const matches = matchesData || [];
	window.currentMatches = matches;

	// Build date → set of tournament IDs (excluding Friendlies),
	// and collect ALL dates where *any* match exists (including friendlies)
	const dateToTournamentIds = {};
	const allDatesSet = new Set();

	matches.forEach((m) => {
	  // HARD EXCLUSIONS
	  if (
		!m.match_date ||
		m.status === "structure" ||
		!m.player1_id ||
		!m.player2_id
	  ) {
		return;
	  }

	  const d = isoDateOnly(m.match_date);
	  if (!d) return;

	  // Only REAL matches contribute dates
	  allDatesSet.add(d);

	  // Only real tournaments drive which cards are shown
	  if (
		m.tournament_id &&
		m.tournament_id !== FRIENDLIES_TOURNAMENT_ID
	  ) {
		if (!dateToTournamentIds[d]) {
		  dateToTournamentIds[d] = new Set();
		}
		dateToTournamentIds[d].add(m.tournament_id);
	  }
	});

	// Remove Friendlies from the sorted list so we can force it last as a special card
	tournaments = tournaments.filter(
		(t) => t.id !== FRIENDLIES_TOURNAMENT_ID
	);

	// --- Build HTML for tournaments list (as before) ---
	let html = '<div class="section-title">Tournaments</div>';

	tournaments.forEach((t) => {
		const name = t.name || "Tournament " + t.id.slice(0, 8);
		html += `
  <div class="card clickable" data-tid="${t.id}">
	<div class="title-row">
	  <div class="title">${name}</div>
	</div>
  </div>
`;
	});

	// Friendlies card always last, always present
	html += `
<div class="card clickable" data-friendlies="true">
  <div class="title-row">
	<div class="title">Friendlies</div>
	<div class="subtitle">Pickup & casual matches</div>
  </div>
</div>
`;

	setContent(html);

	// Click handlers for tournament cards
	document.querySelectorAll("[data-tid]").forEach((el) => {
	  el.addEventListener("click", () => {
		const tid = el.getAttribute("data-tid");
			if (!tid) return;

			// Mark that this navigation came from daily view
			sessionStorage.setItem("fromDailyView", "1");

			if (window.tournamentContext?.selectedDate) {
			  sessionStorage.setItem(
				"selectedDailyDate",
				window.tournamentContext.selectedDate
			  );
			}

			window.location.hash = `#/tournament/${tid}/overview`;
		});
	});

	// Click handler for Friendlies card
	const friendliesCard = document.querySelector(
		'[data-friendlies="true"]'
	);
	if (friendliesCard) {
		friendliesCard.addEventListener("click", () => {
			window.location.hash = "#/friendlies";
		});
	}

	// --- Date bar for HOME view ---
	// allDates includes any matches (including Friendlies); tournaments shown are
	// only those with matches on the selected date. Friendlies card always visible.
	const allDates = Array.from(allDatesSet).sort();
	setupHomeDateBar(allDates, dateToTournamentIds);
	
	renderBottomBar({
	canScore: false,
	canManage: false
});
window.loadTournaments = App.Features.Tournament.loadTournaments;
	const dateBar = document.getElementById("date-bar");
	if (dateBar) dateBar.style.display = "flex";
updateBottomBar();
}

async function ensureFriendliesTournamentExists() {
    const { error } = await window.supabaseClient.from("tournaments").upsert(
        {
            id: FRIENDLIES_TOURNAMENT_ID,
            name: "Friendlies",
        },
        { onConflict: "id" }
    );

    if (error) {
        console.error("Failed to ensure Friendlies tournament:", error);
    }
}

function renderTournamentSelectors(editions, stages) {
    if (!editions || !stages) return "";

    const editionOptions = editions
        .map(
            (e) => `
        <option value="${e.id}" ${
                e.id === window.tournamentContext.editionId ? "selected" : ""
            }>
            ${e.name}
        </option>
    `
        )
        .join("");

    // -----------------------------
	// Build Stage / Bracket options
	// -----------------------------

	// 1) Group stages (non-knockout)
	const groupStageOptions = stages
	  .filter(s => s.stage_type !== "knockout")
	  .map(s => `
		<option value="stage:${s.id}" ${
		  s.id === window.tournamentContext.stageId ? "selected" : ""
		}>
		  ${s.name}
		</option>
	  `);

	// 2) Knockout brackets (one per bracket_id)
	const bracketMap = {};
	stages
	  .filter(s => s.stage_type === "knockout" && s.bracket_id)
	  .forEach(s => {
		if (!bracketMap[s.bracket_id]) {
		  bracketMap[s.bracket_id] = s;
		}
	  });

	const bracketOptions = Object.keys(bracketMap).map(bracketId => `
	  <option value="bracket:${bracketId}" ${
		bracketId === window.tournamentContext.selectedBracketId ? "selected" : ""
	  }>
		Knockout – ${bracketId}
	  </option>
	`);

	const stageOptions = [...groupStageOptions, ...bracketOptions].join("");


    return `
<div class="selectors-row">
  <label>
    Edition
    <select id="edition-select">
      ${editionOptions}
    </select>
  </label>

  <label>
    Stage
    <select id="stage-select">
      ${stageOptions}
    </select>
  </label>
</div>
`;
}

function renderCountriesView(countries) {
	const html = `
<div id="tournaments-menu">
  <div class="section-title">Tournaments</div>

  <div id="countries-view">
	${Object.keys(countries)
		.sort()
		.map(
			(country) => `
		<div class="card clickable country-card"
			 data-country="${country}">
		  ${country}
		</div>
	  `
		)
		.join("")}
  </div>

  <div id="country-tournaments-view" style="display:none;"></div>
</div>
`;

	setContent(html);

	document.querySelectorAll(".country-card").forEach((card) => {
		card.addEventListener("click", () => {
			const country = card.dataset.country;
			renderCountryTournaments(
				country,
				countries[country],
				countries
			);
		});
	});
}

function renderCountryTournaments(country, tournaments, allCountries) {
	const container = document.getElementById("country-tournaments-view");
	const countriesView = document.getElementById("countries-view");

	if (!container || !countriesView) return;

	const formal = tournaments
		.filter((t) => t.type === "formal")
		.sort((a, b) => a.name.localeCompare(b.name));

	const casual = tournaments
		.filter((t) => t.type === "casual")
		.sort((a, b) => a.name.localeCompare(b.name));

	countriesView.style.display = "none";
	container.style.display = "block";

	container.innerHTML = `
<div class="menu-back">
  <button id="back-to-countries" class="text-btn">
	← All countries
  </button>
</div>

<div class="section-title">${country}</div>

${
	formal.length
		? `
  ${formal.map((t) => tournamentCardHTML(t)).join("")}
`
		: ""
}

${
	casual.length
		? `
  ${casual.map((t) => tournamentCardHTML(t)).join("")}
`
		: ""
}
`;

	document.getElementById("back-to-countries").onclick = () => {
		container.style.display = "none";
		countriesView.style.display = "block";
	};

	bindTournamentLinks();
}

function tournamentCardHTML(t) {
	return `
<div class="card clickable tournament-card"
	 data-tid="${t.id}">
  ${t.name}
</div>
`;
}

function bindTournamentLinks() {
  document.querySelectorAll(".tournament-card").forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.dataset.tid;
      if (!id) return;
      // Country view is "standings-first"
      window.location.hash = `#/tournament/${id}/overview?tab=standings`;
    });
  });
}

async function loadTournamentsMenu() {
	window.currentMatchId = null;
	window.currentTournamentId = null;
	window.matchDetailContext = null;
	window.lastSeenSet = null;

	const dateBar = document.getElementById("date-bar");
	if (dateBar) dateBar.style.display = "none";

	showBackButton(() => {
		window.location.hash = "#/tournaments";
	});

	setAddFriendlyVisible(false);

	showLoading("Loading tournaments…");

	const { data, error } = await window.supabaseClient
		.from("tournaments")
		.select("id, name, country, type")
		.neq("id", FRIENDLIES_TOURNAMENT_ID)
		.order("name", { ascending: true });

	if (error || !data) {
		showError("Failed to load tournaments");
		return;
	}

	// Group by country
	const countries = {};
	data.forEach((t) => {
		const country = t.country || "World";
		if (!countries[country]) countries[country] = [];
		countries[country].push(t);
	});

	renderCountriesView(countries);
}

function pickDefaultEdition(editions, currentEditionId) {
  if (!Array.isArray(editions) || editions.length === 0) {
    return null;
  }

  // If current edition still exists, keep it
  if (
    currentEditionId &&
    editions.some(e => e.id === currentEditionId)
  ) {
    return currentEditionId;
  }

  // Otherwise: editions are already sorted most-recent-first
  return editions[0].id;
}

async function loadTournamentOverview(tournamentId) {
  window.currentMatchId = null;
  window.currentTournamentId = tournamentId;
  window.matchDetailContext = null;
  window.tournamentContext.tournamentId = tournamentId;
  window.currentTeams = [];
  window.currentTeamMembers = [];
  window.__scorerOwnsState = false;
  
	if (!window.auth) {
	  showLoading("Loading permissions…");

	  // Retry once auth is ready
	  const retry = setInterval(() => {
		if (window.auth) {
		  clearInterval(retry);
		  loadTournamentOverview(tournamentId);
		}
	  }, 50);

	  return;
	}
	
	window.initRealtimeSubscriptions();
	
	const urlParams = new URLSearchParams(window.location.search);
	const hasTabInUrl = urlParams.has("tab");
	
	const { data: allPlayers = [] } = await window.supabaseClient
	  .from("players")
	  .select("id, name, country, is_guest")
	  .order("name");

	window.allPlayers = allPlayers;	

  if (!window.location.hash.includes("/initialisation")) {
    window.tournamentContext.manageSubview = null;
  }

  // ------------------------------------
  // Restore persisted tournament view
  // ------------------------------------
  const storageKey = tournamentStorageKey(tournamentId);
  const persisted = localStorage.getItem(storageKey);

  if (persisted) {
    try {
      const parsed = JSON.parse(persisted);

      if (!window.tournamentContext.editionId && parsed.editionId) {
        window.tournamentContext.editionId = parsed.editionId;
      }

      if (!window.tournamentContext.stageId && parsed.stageId) {
        window.tournamentContext.stageId = parsed.stageId;
      }

      if (
        !window.tournamentContext.selectedBracketId &&
        parsed.bracketId
      ) {
        window.tournamentContext.selectedBracketId = parsed.bracketId;
      }
    } catch {
      /* ignore corrupt storage */
    }
  }
  
	if (hasTabInUrl) {
	  window.tournamentContext.activeOverviewTab =
		window.tournamentContext.activeOverviewTab;
	}

  showBackButton(() => {
    window.location.hash = "#/tournaments";
  });

  setAddFriendlyVisible(false);
  showLoading("Loading tournament overview…");

  // ------------------------------------------------
  // 1) Tournament
  // ------------------------------------------------
  const { data: tournament } = await window.supabaseClient
    .from("tournaments")
	.select("id, name, country, type")
    .eq("id", tournamentId)
    .maybeSingle();

  if (!tournament) {
    showError("Failed to load tournament.");
    return;
  }

  window.currentTournament = tournament;
  
	// ------------------------------------------------
	// 1b) Teams (tournament-scoped, optional)
	// ------------------------------------------------
	let teams = [];
	let teamMembers = [];

	{
	const { data, error } = await window.supabaseClient
	.from("teams")
	.select("id, name, created_at")
	.eq("tournament_id", tournamentId)
	.order("created_at", { ascending: true });

	if (error) {
	console.error("[teams] failed to load teams", error);
	}

	teams = data || [];
	}

	if (teams.length) {
	const teamIds = teams.map(t => t.id);

	const { data, error } = await window.supabaseClient
	.from("team_members")
	.select("id, team_id, player_id")
	.in("team_id", teamIds);

	if (error) {
	console.error("[teams] failed to load team members", error);
	}

	teamMembers = data || [];
	}

	window.currentTeams = teams;
	window.currentTeamMembers = teamMembers;


  // ------------------------------------------------
  // 2) Editions (DO NOT FAIL IF EMPTY)
  // ------------------------------------------------
	const { data: editions = [] } = await window.supabaseClient
	  .from("editions")
	  .select("id, name, start_date, end_date, min_team_size")
	  .eq("tournament_id", tournamentId)
	  .order("start_date", { ascending: false });


  window.currentEditions = editions;

  // Ensure edition context if possible
	if (editions.length) {
	  if (
		!window.tournamentContext.editionId ||
		!editions.some(e => e.id === window.tournamentContext.editionId)
	  ) {
		const defaultEdition = pickDefaultEdition(editions);
		window.tournamentContext.editionId = defaultEdition?.id ?? editions[0].id;
	  }
	} else {
	  window.tournamentContext.editionId = null;
	}

  // ------------------------------------------------
  // 3) Stages (DO NOT FAIL IF EMPTY)
  // ------------------------------------------------
  let stages = [];

  if (window.tournamentContext.editionId) {
    const { data } = await window.supabaseClient
      .from("stages")
      .select("id, name, stage_type, bracket_id, edition_id, order_index, standings_config")
      .eq("edition_id", window.tournamentContext.editionId)
      .order("order_index", { ascending: true });

    stages = data || [];
  }

  window.currentStages = stages;

  // Only auto-select stage if stages exist
  if (stages.length && !window.tournamentContext.selectedBracketId) {
    if (
      !window.tournamentContext.stageId ||
      !stages.some(s => s.id === window.tournamentContext.stageId)
    ) {
      window.tournamentContext.stageId = stages[0].id;
    }
  }

  // ------------------------------------------------
  // 3b) ALL stages (for Manage tab)
  // ------------------------------------------------
  const { data: allStages = [] } = await window.supabaseClient
    .from("stages")
    .select("id, name, edition_id, stage_type, order_index")
    .in(
      "edition_id",
      editions.map(e => e.id)
    );

  // ------------------------------------------------
  // 4) Matches (safe even with no stages)
  // ------------------------------------------------
  let matches = [];

  if (window.tournamentContext.editionId) {
	let matchQuery = window.supabaseClient
	  .from("matches")
	  .select(`
		id,
		match_date,
		status,
		final_sets_player1,
		final_sets_player2,
		bracket_meta,
		match_meta,

		player1_id,
		player2_id,
		team1_id,
		team2_id,

		player1:player1_id ( id, name ),
		player2:player2_id ( id, name ),
		team1:team1_id ( id, name ),
		team2:team2_id ( id, name ),

		tournament:tournament_id ( id, name, country, type ),
		edition_id,
		stage_id,
		group_id
	  `)

      .eq("tournament_id", tournamentId)
      .eq("edition_id", window.tournamentContext.editionId);

    if (window.tournamentContext.stageId) {
      matchQuery = matchQuery.eq(
        "stage_id",
        window.tournamentContext.stageId
      );
    }

    if (window.tournamentContext.selectedBracketId) {
      const bracketStageIds = stages
        .filter(
          s =>
            s.stage_type === "knockout" &&
            s.bracket_id === window.tournamentContext.selectedBracketId
        )
        .map(s => s.id);

      if (bracketStageIds.length) {
        matchQuery = matchQuery.in("stage_id", bracketStageIds);
      }
    }

    const { data } = await matchQuery.order("match_date");
    matches = data || [];
	
	// Hydrate team joins in case Postgres FKs are missing (Supabase join returns null)
	const teamById = new Map((window.currentTeams || []).map(t => [t.id, t]));

	for (const m of matches) {
	  if (m.team1_id && !m.team1) m.team1 = teamById.get(m.team1_id) || null;
	  if (m.team2_id && !m.team2) m.team2 = teamById.get(m.team2_id) || null;
	}
  }

  window.currentMatches = matches;
  buildTournamentPlayers(matches);

  // ------------------------------------------------
  // 5) Layout ALWAYS RENDERS
  // ------------------------------------------------
	const showManage =
	  window.auth?.can("manage_tournament", {
		type: "tournament",
		id: tournament.id,
		country: tournament.country
	  });

  
  if (!showManage) {
	  const manageEl = document.getElementById("tab-manage");
	  if (manageEl) {
		manageEl.innerHTML = "";
	  }
	}

  setContent(`
    <div class="card">
      <div class="tournament-header">
        <div class="tournament-name">
          ${linkToTournament(tournament.id, tournament.name)}
        </div>
        <div class="subtitle">Tournament overview</div>
      </div>

      ${renderTournamentSelectors(editions, stages)}

      <div class="tab-row">
        <div class="tab" data-tab="daily">Today</div>
        <div class="tab" data-tab="standings">Standings</div>
        <div class="tab" data-tab="fixtures">Fixtures</div>
        <div class="tab" data-tab="results">Results</div>
        ${showManage ? `<div class="tab" data-tab="manage">Manage</div>` : ""}
        <div class="tab" data-tab="overview">Overview</div>
      </div>

      <div id="tab-daily"></div>
      <div id="tab-standings"></div>
      <div id="tab-fixtures"></div>
      <div id="tab-results"></div>
      ${showManage ? `<div id="tab-manage"></div>` : ""}
      <div id="tab-overview"></div>
    </div>
  `);
  
	// ------------------------------------------------
	// 6) Wire edition + stage selectors (CRITICAL)
	// ------------------------------------------------

	const editionSelect = document.getElementById("edition-select");
	const stageSelect   = document.getElementById("stage-select");

	// Edition change → FULL RESET
	editionSelect?.addEventListener("change", e => {
	  window.tournamentContext.editionId = e.target.value;

	  // 🔥 MUST reset edition-scoped state
	  window.tournamentContext.stageId = null;
	  window.tournamentContext.selectedBracketId = null;
	  window.tournamentContext.bracketRoundIndex = 0;

	  persistTournamentView(tournamentId);
	  loadTournamentOverview(tournamentId);
	});

	// Stage / bracket change
	stageSelect?.addEventListener("change", e => {
	  const value = e.target.value;

	  if (value.startsWith("stage:")) {
		window.tournamentContext.stageId = value.replace("stage:", "");
		window.tournamentContext.selectedBracketId = null;
	  }

	  if (value.startsWith("bracket:")) {
		window.tournamentContext.selectedBracketId =
		  value.replace("bracket:", "");
		window.tournamentContext.stageId = null;
	  }

	  persistTournamentView(tournamentId);
	  loadTournamentOverview(tournamentId);
	});


  // ------------------------------------------------
  // 7) Render tabs (each handles empty state internally)
  // ------------------------------------------------
  setupTournamentDateBar(matches);
  renderTournamentDailyTab(matches);
  renderTournamentFixturesTab(matches);
  renderTournamentResultsTab(matches);
  await renderTournamentStandingsTab(tournamentId, matches);

  if (showManage) {
    renderTournamentManageTab(
      tournament,
      editions,
      allStages,
      window.tournamentContext.manageSubview
    );
  }

  renderTournamentOverviewTab(tournament, matches);
  
  if (
	  window.tournamentContext.activeOverviewTab === "manage" &&
	  !showManage
	) {
	  window.tournamentContext.activeOverviewTab = "standings";
	}

	const finalTab =
	window.tournamentContext.activeOverviewTab || "standings";

	activateTab(finalTab);

	bindOverviewTabs();
	renderBottomBar({
	canScore: false,
	canManage: showManage,
	tournamentId
  });

  updateBottomBar();
}

async function loadTournamentStructure(tournamentId) {
  window.currentTournamentId = tournamentId;
  
	  // ------------------------------------
	  // LOAD TOURNAMENT FOR PERMISSION CHECK
	  // ------------------------------------
	  const { data: tournament, error } = await window.supabaseClient
		.from("tournaments")
		.select("id, country")
		.eq("id", tournamentId)
		.maybeSingle();

	  if (error || !tournament) {
		showError("Failed to load tournament.");
		return;
	  }

	  // ------------------------------------
	  // PERMISSION GUARD
	  // ------------------------------------
	  if (
		!window.auth?.can("manage_tournament", {
		  type: "tournament",
		  id: tournament.id,
		  country: tournament.country
		})
	  ) {
		showBackButton(() => {
		  window.location.hash = `#/tournament/${tournamentId}/overview`;
		});

		setAddFriendlyVisible(false);

		setContent(`
		  <div class="card">
			<div class="error">
			  You do not have permission to manage this tournament’s structure.
			</div>
		  </div>
		`);
		return;
	  }

  showBackButton(() => {
    window.location.hash = `#/tournament/${tournamentId}/overview?tab=manage`;
  });

  setAddFriendlyVisible(false);

  showLoading("Loading structure…");

  const { data: editions, error: edErr } = await window.supabaseClient
    .from("editions")
    .select("id,name")
    .eq("tournament_id", tournamentId)
    .order("created_at");

  if (edErr) {
    console.error(edErr);
    showError("Failed to load editions.");
    return;
  }

  setContent(`
    <div class="card">
      <div class="tournament-header">
        <div class="tournament-name">Tournament structure</div>
        <div class="subtitle">Edit editions, stages and groups</div>
      </div>

      <div id="structure-content"></div>
    </div>
  `);

  renderTournamentStructure(tournamentId);
  console.timeEnd("loadTournamentOverview");
}

function resolveAdvancementForPosition(position, totalRows, rules) {
  if (!Array.isArray(rules) || !rules.length) return null;

  for (const rule of rules) {
    switch (rule.condition) {
      case "winner":
      case "best_placed": {
        // Top N positions
        const qty = Number(rule.quantity || 1);
        if (position >= 1 && position <= qty) {
          return rule;
        }
        break;
      }

      case "runner_up": {
        // Explicit next band after winners
        // Default start = 2 if not specified
        const start = Number(rule.position || 2);
        const qty = Number(rule.quantity || 1);
        const end = start + qty - 1;

        if (position >= start && position <= end) {
          return rule;
        }
        break;
      }

      case "nth_place": {
        if (!rule.position) break;

        const start = Number(rule.position);
        const qty = Number(rule.quantity || 1);
        const end = start + qty - 1;

        if (position >= start && position <= end) {
          return rule;
        }
        break;
      }

      case "loser": {
        // Bottom N positions
        const qty = Number(rule.quantity || 1);
        const start = totalRows - qty + 1;

        if (position >= start && position <= totalRows) {
          return rule;
        }
        break;
      }

      case "all":
        return rule;
    }
  }

  // Explicit "Others" (no advancement)
  return null;
}

function renderStandingsTable(
  matches,
  sets,
  groups,
  container,
  advancementRules = [],
  standingsConfig = null,
  actualAdvancementByTarget = null
) {
	const config = standingsConfig || DEFAULT_STANDINGS_CONFIG;
  if (!container) return;

  if (!groups || !groups.length) {
    container.innerHTML = `
      <div class="card">
        <div class="error">No groups exist for this stage yet.</div>
        <div class="subtitle" style="margin-top:6px;">
          Create groups first, or upload fixtures that assign matches to groups.
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = "";
  
  container.style.setProperty(
	  "--standings-stat-cols",
	  config.columns.length
	);

  const matchesByGroup = groupMatchesByGroup(matches);

  groups.forEach(group => {
    const groupMatches = matchesByGroup.get(group.id) || [];

    const statsByPlayer = buildGroupStats(
      groupMatches,
      sets,
      config
    );

    const rows = Object.values(statsByPlayer);

    const sorted = sortStandings(rows, config.ranking);

	renderStandingsGroup({
	  container,
	  group,
	  rows: sorted,
	  config,
	  advancementRules,
	  actualAdvancementByTarget
	});
  });
}

function groupMatchesByGroup(matches = []) {
  const map = new Map();
  matches.forEach(m => {
    if (!m.group_id) return;
    if (!map.has(m.group_id)) map.set(m.group_id, []);
    map.get(m.group_id).push(m);
  });
  return map;
}

function calculateMatchPoints(stats, rules) {
  if (!rules || !rules.points) return 0;

  const {
    win = 0,
    draw = 0,
    loss = 0,
    per_set_won = 0
  } = rules.points;

  return (
    (stats.matchesWon || 0) * win +
    (stats.matchesDrawn || 0) * draw +
    (stats.matchesLost || 0) * loss +
    (stats.setsWon || 0) * per_set_won
  );
}

function buildGroupStats(matches, sets, config) {
  const stats = {};

  const isTeamTournament =
    Number(
      window.currentEditions?.find(
        e => e.id === window.tournamentContext?.editionId
      )?.min_team_size
    ) > 1;

	function ensureCompetitor(id, name) {
	  if (!stats[id]) {
		stats[id] = {
		  competitor_id: id,
		  id,              // keep for compatibility
		  name,

		  matches_played: 0,
		  matches_won: 0,
		  matches_drawn: 0,
		  matches_lost: 0,

		  sets_won: 0,
		  sets_lost: 0,

		  small_points_for: 0,
		  small_points_against: 0,

		  match_points: 0
		};
	  }
	}

  // Seed competitors
	matches.forEach(m => {
	  if (isTeamTournament) {
		if (m.team1_id && m.team1?.name)
		  ensureCompetitor(m.team1_id, m.team1.name);
		if (m.team2_id && m.team2?.name)
		  ensureCompetitor(m.team2_id, m.team2.name);
	  } else {
		if (m.player1?.id)
		  ensureCompetitor(m.player1.id, m.player1.name);
		if (m.player2?.id)
		  ensureCompetitor(m.player2.id, m.player2.name);
	  }
	});

  // Sets
	 sets.forEach(s => {
	  if (!s.match_id) return;

	  const m = matches.find(x => x.id === s.match_id);
	  if (!m || m.status === "structure") return;

	  const p1 = stats[m.player1.id];
	  const p2 = stats[m.player2.id];

	  // --- infer winner if not stored ---
	  let winnerId = s.winner_player_id;
	  if (!winnerId) {
		if (s.score_player1 > s.score_player2) {
		  winnerId = m.player1.id;
		} else if (s.score_player2 > s.score_player1) {
		  winnerId = m.player2.id;
		} else {
		  return; // draw set → ignore
		}
	  }

	  const winner = winnerId === m.player1.id ? p1 : p2;
	  const loser  = winner === p1 ? p2 : p1;

	  const wScore =
		winner === p1 ? s.score_player1 : s.score_player2;
	  const lScore =
		winner === p1 ? s.score_player2 : s.score_player1;

	  winner.sets_won++;
	  loser.sets_lost++;

	  winner.small_points_for += wScore ?? 0;
	  loser.small_points_for += lScore ?? 0;
	});
	
	// --- derive match wins / draws / losses ---
	matches.forEach(m => {
	  if (m.status === "scheduled" || m.status === "structure") return;

	  let c1, c2;

	  if (isTeamTournament) {
		if (!m.team1_id || !m.team2_id) return;
		c1 = stats[m.team1_id];
		c2 = stats[m.team2_id];
	  } else {
		if (!m.player1 || !m.player2) return;
		c1 = stats[m.player1.id];
		c2 = stats[m.player2.id];
	  }

	  if (!c1 || !c2) return;
	  
	    c1.matches_played++;
		c2.matches_played++;

		if (c1.sets_won > c2.sets_won) {
		  c1.matches_won++;
		  c2.matches_lost++;
		} else if (c2.sets_won > c1.sets_won) {
		  c2.matches_won++;
		  c1.matches_lost++;
		} else {
		  c1.matches_drawn++;
		  c2.matches_drawn++;
		}
	});

  // Derived fields
  Object.values(stats).forEach(p => {
    p.set_difference = p.sets_won - p.sets_lost;
    p.small_points_difference =
      p.small_points_for - p.small_points_against;

    p.match_points = calculateMatchPoints(p, config.metrics);
  });

  return stats;
}

function sortStandings(rows, rankingRules) {
  return [...rows].sort((a, b) => {
    for (const rule of rankingRules) {
      const av = a[rule.key] ?? 0;
      const bv = b[rule.key] ?? 0;
      if (av === bv) continue;
      return rule.direction === "asc" ? av - bv : bv - av;
    }
    return a.name.localeCompare(b.name);
  });
}

function columnLabel(key) {
  return (
    STANDINGS_STAT_DEFS.find(s => s.key === key)?.short || key
  );
}


function renderStandingsRow({
  competitor,
  index,
  columns,
  advancementRules,
  groupSize,
  actualAdvancementByTarget
}) {
  const position = index + 1;

	let advRule = null;

	for (const rule of advancementRules || []) {
	  const actualIds = actualAdvancementByTarget?.get(rule.target_stage_id);
	  const hasFinalisedActuals = actualIds && actualIds.size > 0;

	  // Finalised mode for this specific target stage
	  if (hasFinalisedActuals) {
		if (actualIds.has(competitor.competitor_id)) {
		  // Keep the rule's own condition/layer/description.
		  // Do NOT force condition: "advance".
		  advRule = rule;
		  break;
		}

		// This target has been finalised, so do not use positional fallback for it.
		continue;
	  }

	  // Pre-finalisation mode for this target stage
	  const positionalRule = resolveAdvancementForPosition(
		position,
		groupSize,
		[rule]
	  );

	  if (positionalRule) {
		advRule = positionalRule;
		break;
	  }
	}

  const advClass = advRule
    ? `adv-${advRule.condition} adv-layer-${advRule.layer}`
    : "";

  return `
    <tr>
      <td class="pos-cell ${advClass}">
        <span class="pos-number">${position}</span>
      </td>

      <td>
		<span
		  class="competitor-link"
		  data-competitor-id="${competitor.competitor_id}"
		>
		  ${competitor.name}
		</span>
      </td>

		${columns.map(key => `
		  <td style="text-align:center;">
			${competitor[key] ?? 0}
		  </td>
		`).join("")}
    </tr>
  `;
}


function renderStandingsGroup({
  container,
  group,
  rows,
  config,
  advancementRules,
  actualAdvancementByTarget
}) {
  container.insertAdjacentHTML(
    "beforeend",
    `
    <div class="standings-group-title">${group.name}</div>
    <table class="standings-table">
      <thead>
        <tr>
          <th class="pos">Pos</th>
          <th>Competitor</th>
          ${config.columns.map(col =>
            `<th style="text-align:center;">${columnLabel(col)}</th>`
          ).join("")}
        </tr>
      </thead>
      <tbody>
        ${
          rows.length
            ? rows.map((competitor, index) =>
                renderStandingsRow({
                  competitor,
                  index,
                  columns: config.columns,
                  advancementRules,
                  groupSize: rows.length,
				  actualAdvancementByTarget
                })
              ).join("")
            : `<tr>
                 <td colspan="${config.columns.length + 2}" class="empty-message">
                   No matches yet
                 </td>
               </tr>`
        }
      </tbody>
    </table>
    ${renderAdvancementLegend(advancementRules)}
  `
  );
}

function renderAdvancementLegend(advancementRules = []) {
  const rules = (advancementRules || [])
    .filter(r => (r.description || "").trim().length)
    .sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0));

  // De-dupe (common if rules are stored per position)
  const seen = new Set();
  const uniq = [];

  for (const r of rules) {
    const desc = (r.description || "").trim();
    const key = `${r.layer ?? 0}|${r.condition || ""}|${desc}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push({ ...r, description: desc });
  }

  if (!uniq.length) return "";

  return `
    <div class="adv-notes">
      ${uniq.map(r => `
        <div class="adv-note">
          <span class="pos-cell adv-${r.condition} adv-layer-${r.layer} adv-legend-bar"></span>
          <span>${r.description}</span>
        </div>
      `).join("")}
    </div>
  `;
}

const DEFAULT_STANDINGS_CONFIG = {
  metrics: {
    match_points: {
      win: 0,
      draw: 0,
      loss: 0
    }
  },
  columns: [
    "matches_played",
    "sets_won",
    "sets_lost",
    "small_points_for"
  ],
  ranking: [
    { key: "sets_won", direction: "desc" },
    { key: "small_points_for", direction: "desc" }
  ]
};

const STANDINGS_STAT_DEFS = [
  { key: "matches_played", label: "Played", short: "Pl" },
  { key: "matches_won", label: "Matches won", short: "W" },
  { key: "matches_drawn", label: "Matches drawn", short: "D" },
  { key: "matches_lost", label: "Matches lost", short: "L" },

  { key: "sets_won", label: "Sets won", short: "S+" },
  { key: "sets_lost", label: "Sets lost", short: "S−" },
  { key: "set_difference", label: "Set difference", short: "S±" },

  { key: "small_points_for", label: "Small points", short: "Pts" },
  {
    key: "small_points_difference",
    label: "Small points diff",
    short: "Pts±"
  },

  { key: "match_points", label: "Match points", short: "MP" }
];


async function renderTournamentStandingsTab(tournamentId) {
  const el = document.getElementById("tab-standings");
  if (!el) return;

  el.innerHTML = "";

  // -----------------------------
  // ENSURE MATCHES ARE AVAILABLE
  // -----------------------------
  const matches = window.currentMatches;
  if (!Array.isArray(matches)) {
    console.warn("Standings render skipped – matches not loaded yet");
    return;
  }

  // ------------------------------------
  // Load advancement rules FIRST
  // ------------------------------------
  const { data: rulesData, error: rulesError } = await window.supabaseClient
    .from("advancement_rules")
    .select(`
      id,
      source_stage_id,
      condition,
      position,
      quantity,
      layer,
      target_stage_id,
      description
    `)
    .in(
      "source_stage_id",
      window.currentStages.map(s => s.id)
    )
    .order("layer", { ascending: true });
	
	wireStageStandingsButtons();

  if (rulesError) {
    console.error(rulesError);
  }

  const advancementRules = rulesData || [];

  // ------------------------------------
  // BUILD + STORE GRAPH ONCE
  // ------------------------------------
  const stageGraph = buildStageGraph(
    window.currentStages,
    advancementRules
  );

  // IMPORTANT: persist for bracket navigation callbacks
  window.stageGraph = stageGraph;

  // ------------------------------------
  // BRACKET VIEW
  // ------------------------------------
  if (window.tournamentContext.selectedBracketId) {
    renderBracketDraw(matches, stageGraph);
    return;
  }

  // ------------------------------------
  // NORMAL STAGE VIEW
  // ------------------------------------
  const stageId = window.tournamentContext?.stageId;
  if (!stageId) {
    el.innerHTML = `<div class="empty-message">No stage selected.</div>`;
    return;
  }

  const stage = window.currentStages?.find(s => s.id === stageId);
  if (!stage) {
    el.innerHTML = `<div class="error">Stage not found.</div>`;
    return;
  }

  // ------------------------------------
  // KNOCKOUT STAGE → DRAW (non-bracket)
  // ------------------------------------
  if (stage.stage_type === "knockout") {
    const drawStages = getConnectedKnockoutStages(
      stageGraph,
      stageId
    );

    const drawWrap = document.createElement("div");
    drawWrap.id = "draw-scroll";
    el.appendChild(drawWrap);

    renderKnockoutDraw({
      stages: drawStages,
      matches,
      stageGraph
    });

    return;
  }

  // ------------------------------------
  // GROUP STAGE → STANDINGS
  // ------------------------------------
  const matchIds = matches.map(m => m.id).filter(Boolean);

  if (!matchIds.length) {
    el.innerHTML = `<div class="empty-message">No results yet.</div>`;
    return;
  }

  const { data: sets, error } = await window.supabaseClient
    .from("sets")
    .select("*")
    .in("match_id", matchIds);

  if (error) {
    console.error(error);
    el.innerHTML = `<div class="error">Failed to load standings.</div>`;
    return;
  }

  let groups = [];
  const { data: groupData, error: groupError } = await window.supabaseClient
    .from("groups")
    .select("id, name")
    .eq("stage_id", stageId)
    .order("name");

  if (!groupError) {
    groups = groupData || [];
  }

	const stageAdvancementRules =
	  (advancementRules || []).filter(r => r.source_stage_id === stageId);

	const isTeamTournament =
	  Number(
		window.currentEditions?.find(
		  e => e.id === window.tournamentContext?.editionId
		)?.min_team_size
	  ) > 1;

	const actualAdvancementByTarget = new Map();

	for (const rule of stageAdvancementRules) {
	  if (!rule.target_stage_id) continue;
	  if (actualAdvancementByTarget.has(rule.target_stage_id)) continue;

	  const ids = await getFinalisedAdvancementIds({
		sourceStageId: stageId,
		targetStageId: rule.target_stage_id,
		isTeamTournament
	  });

	  actualAdvancementByTarget.set(rule.target_stage_id, ids);
	}

	renderStandingsTable(
	  matches,
	  sets || [],
	  groups,
	  el,
	  stageAdvancementRules,
	  stage?.standings_config || null,
	  actualAdvancementByTarget
	);
}

// -----------------------
// BRACKET
// -----------------------

function getConnectedKnockoutStages(stageGraph, startStageId) {
  const visited = new Set();
  const stack = [startStageId];

  while (stack.length) {
    const current = stack.pop();
    if (visited.has(current)) continue;

    visited.add(current);

    stageGraph.edges.forEach(edge => {
      if (edge.from_stage_id === current) {
        stack.push(edge.to_stage_id);
      }
      if (edge.to_stage_id === current) {
        stack.push(edge.from_stage_id);
      }
    });
  }

  return [...visited]
    .map(id => stageGraph.stages[id])
    .filter(s => s.stage_type === "knockout");
}


function buildStageGraph(stages, advancementRules) {
  if (!Array.isArray(stages)) {
    throw new Error("buildStageGraph: stages must be an array");
  }

  if (!Array.isArray(advancementRules)) {
    throw new Error("buildStageGraph: advancementRules must be an array");
  }

  // -------------------------
  // Index stages
  // -------------------------
  const stagesById = {};
  stages.forEach(stage => {
    stagesById[stage.id] = {
      id: stage.id,
      name: stage.name,
      stage_type: stage.stage_type,
      order: stage.order
    };
  });

  // -------------------------
  // Build edges
  // -------------------------
  const edges = [];

  advancementRules.forEach(rule => {
    const fromStage = stagesById[rule.source_stage_id];
    const toStage   = stagesById[rule.target_stage_id];

    if (!fromStage) {
      console.warn(
        "Advancement rule ignored: source stage not found",
        rule
      );
      return;
    }

    if (!toStage) {
      console.warn(
        "Advancement rule ignored: target stage not found",
        rule
      );
      return;
    }

    edges.push({
      from_stage_id: rule.source_stage_id,
      to_stage_id: rule.target_stage_id,

      condition: rule.condition,              // winner | loser | position | all
      quantity: rule.quantity ?? null,         // null for knockouts
      position: rule.position ?? null,         // group stages only

      layer: rule.layer ?? 0,

      rule_id: rule.id
    });
  });

  // -------------------------
  // Deterministic ordering
  // -------------------------
  edges.sort((a, b) => {
    const aOrder = stagesById[a.from_stage_id].order;
    const bOrder = stagesById[b.from_stage_id].order;

    if (aOrder !== bOrder) return aOrder - bOrder;
    if (a.layer !== b.layer) return a.layer - b.layer;
    return a.condition.localeCompare(b.condition);
  });

  // -------------------------
  // Final graph
  // -------------------------
  return {
    stages: stagesById,
    edges
  };
}

function getBracketRounds(bracketId) {
  return window.currentStages
    .filter(s => s.bracket_id === bracketId)
    .sort((a, b) => a.order_index - b.order_index);
}

function getCurrentBracketIndex() {
  return window.tournamentContext.bracketRoundIndex ?? 0;
}

function jumpBracketIndex(delta) {
  const rounds = getBracketRounds(window.tournamentContext.selectedBracketId);
  let idx = getCurrentBracketIndex() + delta;

  idx = Math.max(0, Math.min(idx, rounds.length - 1));
  window.tournamentContext.bracketRoundIndex = idx;

  renderBracketDraw(window.currentMatches, window.stageGraph);
}


function getIncomingStageId(stageGraph, stageId) {
  const edge = stageGraph.edges.find(
    e => e.to_stage_id === stageId
  );
  return edge?.from_stage_id || null;
}

function getOutgoingStageId(stageGraph, stageId, condition) {
  const edge = stageGraph.edges.find(
    e =>
      e.from_stage_id === stageId &&
      e.condition === condition
  );
  return edge?.to_stage_id || null;
}

function resolveKnockoutAdvancement(match, stageGraph) {
  if (!match || match.status !== "completed") {
    return [];
  }

  const stageId = match.stage_id;

  // -------------------------
  // Get routing rules
  // -------------------------
  const outgoingEdges = stageGraph.edges.filter(
    edge => edge.from_stage_id === stageId
  );

  if (outgoingEdges.length === 0) {
    return [];
  }

  // -------------------------
  // Determine winner / loser
  // -------------------------
  const sets = extractValidSets(match);

  const result = determineSetWinner(
    match.player1_id,
    match.player2_id,
    sets
  );

  if (!result || !result.winner_id || !result.loser_id) {
    console.warn("Cannot resolve match outcome", match.id);
    return [];
  }

  const { winner_id, loser_id } = result;

  // -------------------------
  // Emit advancement events
  // -------------------------
  const events = [];

  outgoingEdges.forEach(edge => {
    if (edge.condition === "winner") {
      events.push({
        source_match_id: match.id,
        participant_id: winner_id,
        target_stage_id: edge.to_stage_id,
        condition: "winner",
        layer: edge.layer
      });
    }

    if (edge.condition === "loser") {
      events.push({
        source_match_id: match.id,
        participant_id: loser_id,
        target_stage_id: edge.to_stage_id,
        condition: "loser",
        layer: edge.layer
      });
    }
  });

  return events;
}

function getIncomingStage(stageId, stageGraph) {
  const edge = stageGraph.edges.find(
    e => e.to_stage_id === stageId
  );
  return edge?.from_stage_id || null;
}

async function renderBracketDraw(matches, stageGraph) {
	  if (!Array.isArray(matches)) {
	console.warn("renderBracketDraw called without matches", matches);
	return;
	}

	if (!stageGraph) {
	console.warn("renderBracketDraw called without stageGraph");
	return;
	}
  const el = document.getElementById("tab-standings");
  if (!el) return;

  el.innerHTML = "";

  const bracketId = window.tournamentContext.selectedBracketId;
  if (!bracketId) return;

  // ------------------------------------
  // Collect stages in this bracket
  // ------------------------------------
  const bracketStages = window.currentStages.filter(
    s =>
      s.stage_type === "knockout" &&
      s.bracket_id === bracketId
  );

  if (!bracketStages.length) {
    el.innerHTML = `<div class="empty-message">No rounds in this bracket.</div>`;
    return;
  }

  // ------------------------------------
  // Order rounds
  // ------------------------------------
  const rounds = [...bracketStages].sort(
    (a, b) => a.order_index - b.order_index
  );

  // Clamp round index
  let idx = window.tournamentContext.bracketRoundIndex ?? 0;
  if (idx < 0) idx = 0;
  if (idx >= rounds.length) idx = rounds.length - 1;
  window.tournamentContext.bracketRoundIndex = idx;

  const roundStage = rounds[idx];

  console.log("ROUND DEBUG", {
    roundIndex: idx,
    roundStageId: roundStage.id,
    roundStageName: roundStage.name,
    matchStageIds: matches.map(m => m.stage_id)
  });

  // ------------------------------------
  // Draw mount
  // ------------------------------------
  const drawWrap = document.createElement("div");
  drawWrap.id = "draw-scroll";
  el.appendChild(drawWrap);

  // ------------------------------------
  // Filter matches for this round
  // ------------------------------------
	const roundMatches = matches
	  .filter(m => m.stage_id === roundStage.id)
	  .sort((a, b) => {
		const aOrder = Number(a?.bracket_meta?.slot_index ?? a?.bracket_meta?.order);
		const bOrder = Number(b?.bracket_meta?.slot_index ?? b?.bracket_meta?.order);

		const aOk = Number.isFinite(aOrder);
		const bOk = Number.isFinite(bOrder);

		if (aOk && bOk) return aOrder - bOrder;
		if (aOk && !bOk) return -1;
		if (!aOk && bOk) return 1;

		return String(a.id).localeCompare(String(b.id));
	  });

  // ------------------------------------
  // Render ONE round via existing renderer
  // ------------------------------------
  renderKnockoutDraw({
    stages: [roundStage],      // single column
    matches: roundMatches,
    stageGraph
  });
}

function renderKnockoutDraw({ stages, matches, stageGraph }) {
  const container = document.getElementById("draw-scroll");
  if (!container) return;

  container.innerHTML = "";
  container.className = "draw-scroll";

  stages.forEach(stage => {
    const stageCol = document.createElement("div");
    stageCol.className = "draw-stage-column";

    const header = document.createElement("div");
    header.className = "draw-stage-header";
    header.textContent = stage.name;
    stageCol.appendChild(header);

    const matchesWrap = document.createElement("div");
    matchesWrap.className = "draw-stage-matches";

    // IMPORTANT: matches already sorted by slot_index
    const stageMatches = matches
	  .filter(m => m.stage_id === stage.id)
	  .sort((a, b) =>
		Number(a.bracket_meta?.order || 0) -
		Number(b.bracket_meta?.order || 0)
	  );

    if (!stageMatches.length) {
      const empty = document.createElement("div");
      empty.className = "draw-empty";
      empty.textContent = "No matches";
      matchesWrap.appendChild(empty);
    } else {
      stageMatches.forEach(match => {
        matchesWrap.appendChild(
          renderDrawMatchCard(match, stageGraph)
        );
      });
    }

    stageCol.appendChild(matchesWrap);
    container.appendChild(stageCol);
  });
}

async function buildBracketMetadataForEdition(editionId) {
  if (!editionId) return;

  // 1. Load knockout stages
  const { data: stages } = await window.supabaseClient
    .from("stages")
    .select("id, bracket_id, order_index")
    .eq("edition_id", editionId)
    .eq("stage_type", "knockout");

  if (!stages?.length) return;

  // 2. Load matches
  const { data: matches } = await window.supabaseClient
    .from("matches")
    .select("id, stage_id, created_at")
    .eq("edition_id", editionId);

  if (!matches?.length) return;

  // 3. Group stages by bracket
  const stagesByBracket = {};
  for (const s of stages) {
    if (!s.bracket_id) continue;
    (stagesByBracket[s.bracket_id] ||= []).push(s);
  }

  // 4. Build + persist metadata
  for (const [bracketId, bracketStages] of Object.entries(stagesByBracket)) {
    const rounds = [...bracketStages].sort(
      (a, b) => a.order_index - b.order_index
    );

    rounds.forEach((stage, roundIndex) => {
      const stageMatches = matches
        .filter(m => m.stage_id === stage.id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));

      stageMatches.forEach(async (match, slotIndex) => {
        const bracket_meta = {
          bracket_id: bracketId,
          round_index: roundIndex,
          slot_index: slotIndex,
          path: null,
          source_match_id: null
        };

        const { error } = await window.supabaseClient
          .from("matches")
          .update({ bracket_meta })
          .eq("id", match.id);

        if (error) {
          console.error("Bracket meta update failed", match.id, error);
        }
      });
    });
  }

  console.log("Bracket metadata rebuilt for edition", editionId);
}

function getBracketRoundIndexByStageId(stageId) {
  const bracketId = window.tournamentContext.selectedBracketId;
  const rounds = window.currentStages
    .filter(
      s =>
        s.stage_type === "knockout" &&
        s.bracket_id === bracketId
    )
    .sort((a, b) => a.order_index - b.order_index);

  return rounds.findIndex(s => s.id === stageId);
}

function renderDrawMatchCard(match, stageGraph) {
  const card = document.createElement("div");
  card.className = "draw-match-card";
  
  const meta =
	  typeof match.match_meta === "string"
		? JSON.parse(match.match_meta || "{}")
		: (match.match_meta || {});

  const bracketId = window.tournamentContext.selectedBracketId;

  const rounds = window.currentStages
    .filter(
      s => s.stage_type === "knockout" && s.bracket_id === bracketId
    )
    .sort((a, b) => a.order_index - b.order_index);

  const currentIdx = window.tournamentContext.bracketRoundIndex || 0;

  // -------------------------
  // Helper: jump to stage ID
  // -------------------------
	const jumpToStage = (stageId) => {
	  if (!stageId) return;

	  const idx = rounds.findIndex(s => s.id === stageId);
	  if (idx < 0) return;

	  window.tournamentContext.bracketRoundIndex = idx;
	  renderBracketDraw(window.currentMatches, stageGraph);
	};

  // ---------- LEFT (previous round) ----------
  const prev = document.createElement("div");
  prev.className = "draw-prev-slot";
  prev.textContent = "‹‹";

	const incomingStageId = getIncomingStageId(
	  stageGraph,
	  match.stage_id
	);

	if (incomingStageId) {
	  prev.onclick = (e) => {
		e.stopPropagation();

		const idx = rounds.findIndex(
		  s => s.id === incomingStageId
		);

		if (idx >= 0) {
		  window.tournamentContext.bracketRoundIndex = idx;
		  renderBracketDraw(window.currentMatches, stageGraph);
		}
	  };
	} else {
	  prev.classList.add("disabled");
	  prev.style.pointerEvents = "none";
	}

  // ---------- ROW 1 ----------
  const row1 = document.createElement("div");
  row1.className = "draw-row";

  const p1Name = document.createElement("div");
  p1Name.className = "draw-player-name";
	p1Name.textContent =
	  match.player1?.name ||
	  match.team1?.name ||
	  meta.labels?.slot1 ||
	  "—";

  const p1Score = document.createElement("div");
  p1Score.className = "draw-setscore";
  p1Score.textContent =
	Number.isInteger(match.final_sets_player1)
	  ? match.final_sets_player1
	  : "";

  const p1Adv = document.createElement("div");
  p1Adv.className = "draw-adv-slot adv-neutral";
  p1Adv.textContent = "››";

  row1.append(p1Name, p1Score, p1Adv);

  // ---------- ROW 2 ----------
  const row2 = document.createElement("div");
  row2.className = "draw-row";

  const p2Name = document.createElement("div");
  p2Name.className = "draw-player-name";
	p2Name.textContent =
	  match.player2?.name ||
	  match.team2?.name ||
	  meta.labels?.slot2 ||
	  "—";

  const p2Score = document.createElement("div");
  p2Score.className = "draw-setscore";
  p2Score.textContent =
    Number.isInteger(match.final_sets_player2)
      ? match.final_sets_player2
      : "";

  const p2Adv = document.createElement("div");
  p2Adv.className = "draw-adv-slot adv-neutral";
  p2Adv.textContent = "››";

  row2.append(p2Name, p2Score, p2Adv);

  // ---------- META ----------
  const metaCol = document.createElement("div");
  metaCol.className = "draw-meta-col";

  const date = document.createElement("div");
  date.className = "draw-meta-date";
	date.textContent =
	  match.status === "structure"
		? ""
		: (match.match_date ? new Date(match.match_date).toLocaleString() : "");

  const status = document.createElement("div");
  status.className = "draw-status-pill";
  status.textContent =
    window.liveSetByMatch?.[match.id]
      ? "LIVE"
      : (match.status || "").toUpperCase();

  status.dataset.status =
    window.liveSetByMatch?.[match.id]
      ? "live"
      : match.status;

  metaCol.append(date, status);

  const rowsWrap = document.createElement("div");
  rowsWrap.className = "draw-rows";
  rowsWrap.append(row1, row2);

  card.append(prev, metaCol, rowsWrap);

  // ---------- RESULT STATE ----------
  const p1ScoreVal = Number(match.final_sets_player1);
  const p2ScoreVal = Number(match.final_sets_player2);

  if (
    match.status === "finished" &&
    Number.isFinite(p1ScoreVal) &&
    Number.isFinite(p2ScoreVal)
  ) {
	const p1IsWinner = p1ScoreVal > p2ScoreVal;
	const p2IsWinner = p2ScoreVal > p1ScoreVal;

	const winnerNextStageId = getOutgoingStageId(
	  stageGraph,
	  match.stage_id,
	  "winner"
	);

	const loserNextStageId = getOutgoingStageId(
	  stageGraph,
	  match.stage_id,
	  "loser"
	);

	const winnerAdv = p1IsWinner ? p1Adv : p2Adv;
	const loserAdv  = p1IsWinner ? p2Adv : p1Adv;

	// WINNER PATH
	if (winnerNextStageId) {
	  winnerAdv.classList.remove("adv-neutral");
	  winnerAdv.classList.add("adv-advance");
	  winnerAdv.onclick = (e) => {
		e.stopPropagation();
		jumpToStage(winnerNextStageId);
	  };
	}

	// LOSER PATH
	if (loserNextStageId) {
	  loserAdv.classList.remove("adv-neutral");
	  loserAdv.classList.add("adv-advance");
	  loserAdv.onclick = (e) => {
		e.stopPropagation();
		jumpToStage(loserNextStageId);
	  };
	}

	// ELIMINATED STYLING
	const eliminatedAdv = p1IsWinner ? p2Adv : p1Adv;
	eliminatedAdv.classList.remove("adv-neutral");
	eliminatedAdv.classList.add("adv-eliminate");

	// Full-height arrow if only one path exists
	if (winnerNextStageId && !loserNextStageId) {
	  winnerAdv.classList.add("adv-full-height");
	}
  }
  card.classList.add("clickable");

	card.addEventListener("click", () => {
	  window.location.hash =
		`#/match/${match.id}/${window.currentTournamentId}`;
	});

  return card;
}

function renderTournamentManageTab(
  tournament,
  editions,
  allStages
) {
  const el = document.getElementById("tab-manage");
  if (!el) return;

	const canManage = window.auth?.can("manage_tournament", {
	  type: "tournament",
	  id: tournament.id,
	  country: tournament.country
	});

	if (!canManage) {
	  el.innerHTML = `
		<div class="card">
		  <div class="empty-message">
			You do not have permission to manage this tournament.
		  </div>
		</div>
	  `;
	  return;
	}
	
	el.innerHTML = `
	  <div class="manage-grid">

		<div class="card manage-card clickable" id="manage-init-card">
		  <div class="manage-title">Group initialisation</div>
		  <div class="manage-desc">
			Add players to groups without creating fixtures. Groups remain empty until explicitly initialised.
		  </div>
		  <div class="manage-actions">
			<button class="header-btn small" type="button">
			  Open initialisation
			</button>
		  </div>
		</div>

		<div class="card manage-card clickable" id="manage-structure-card">
		  <div class="manage-title">Structure</div>
		  <div class="manage-desc">
			Editions, stages, groups and advancement rules.
		  </div>
		  <div class="manage-actions">
			<button class="header-btn small" type="button">
			  Open structure manager
			</button>
		  </div>
		</div>

		<div class="card manage-card clickable" id="manage-matches-card">
		  <div class="manage-title">Matches</div>
		  <div class="manage-desc">
			Add and manage matches for this edition & stage.
		  </div>
		  <div class="manage-actions">
			<button class="header-btn small" type="button">
			  Open match manager
			</button>
		  </div>
		</div>
		
		<div class="card manage-card clickable" id="manage-teams-card">
		  <div class="manage-title">Teams</div>
		  <div class="manage-desc">
			Create and manage teams for this tournament.
		  </div>
		  <div class="manage-actions">
			<button class="header-btn small" type="button">
			  Manage teams
			</button>
		  </div>
		</div>
		
		<div class="card manage-card clickable" id="manage-format-card">
		  <div class="manage-title">Format builder</div>
		  <div class="manage-desc">
			New simplified setup for group advancement and knockout rounds.
		  </div>
		  <div class="manage-actions">
			<button class="header-btn small" type="button">
			  Open format builder
			</button>
		  </div>
		</div>

		<!-- SINGLE, correct subview container -->
		<div id="manage-subview" style="grid-column: 1 / -1;"></div>

	  </div>
	`;


	// Wire stage reorder buttons
	el.querySelectorAll("[data-action]").forEach((btn) => {
	  btn.addEventListener("click", (e) => {
		e.stopPropagation();
		reorderStage(btn.dataset.stage, btn.dataset.action);
	  });
	});

	// Group initialisation card
	const initCard = el.querySelector("#manage-init-card");
	if (initCard) {
	  initCard.addEventListener("click", () => {
		window.location.hash = `#/tournament/${tournament.id}/initialisation`;
	  });
	}

	// Add edition
	const addEditionBtn = el.querySelector("#add-edition-btn");
	if (addEditionBtn) {
	  addEditionBtn.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		createEditionPrompt(tournament.id);
	  });
	}

	// Add stage
	const addStageBtn = el.querySelector("#add-stage-btn");
	if (addStageBtn) {
	  addStageBtn.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		createStagePrompt(window.tournamentContext.editionId);
	  });
	}

	// Open match manager
	const matchesCard = el.querySelector("#manage-matches-card");
	if (matchesCard) {
	  matchesCard.addEventListener("click", () => {
		window.location.hash = `#/tournament/${tournament.id}/manage-matches`;
	  });
	}

	// Open structure manager
	const structureCard = el.querySelector("#manage-structure-card");
	if (structureCard) {
	  structureCard.addEventListener("click", () => {
		window.location.hash = `#/tournament/${tournament.id}/structure`;
	  });
	}
	
	// Open teams manager
	const teamsCard = el.querySelector("#manage-teams-card");
	if (teamsCard) {
		teamsCard.addEventListener("click", () => {
		  window.location.hash = `#/tournament/${tournament.id}/teams`;
		});
	}

	// Open format manager
	const formatCard = el.querySelector("#manage-format-card");
	if (formatCard) {
	  formatCard.addEventListener("click", () => {
		window.tournamentContext.manageSubview = "format";
		renderTournamentManageTab(tournament, editions, allStages);
	  });
	}

	// Render manage subview
	const subviewEl = el.querySelector("#manage-subview");
	if (!subviewEl) return;

	subviewEl.innerHTML = "";
	
	console.log(
	  "MANAGE SUBVIEW CHECK",
	  window.tournamentContext.manageSubview,
	  subviewEl
	);

	if (window.tournamentContext.manageSubview === "initialisation") {
	  renderTournamentInitialisation({
		tournament,
		editionId: window.tournamentContext.editionId,
		stageId: window.tournamentContext.stageId,
		container: subviewEl
	  });

	  // NEW: Knockout initialisation (group → knockout)
	  renderKnockoutInitialisation({
		tournamentId: tournament.id,
		editionId: window.tournamentContext.editionId,
		sourceStageId: window.tournamentContext.stageId,
		container: subviewEl
	  });
	}
	
	if (window.tournamentContext.manageSubview === "teams") {
	  App.Teams.renderManageTeamsSection(subviewEl);
	}
	
	if (window.tournamentContext.manageSubview === "format") {
	  if (App?.Features?.Tournament?.FormatBuilder?.render) {
		App.Features.Tournament.FormatBuilder.render({
		  tournamentId: tournament.id,
		  editionId: window.tournamentContext.editionId,
		  container: subviewEl
		});
	  } else {
		subviewEl.innerHTML = `
		  <div class="card">
			<div class="error">
			  Format builder file is not loaded.
			</div>
		  </div>
		`;
	  }
	}
}

async function loadTournamentInitialisation(tournamentId) {
  const app = document.getElementById("content");
  if (!app) return;

  app.innerHTML = `
    <div class="card">
      <div class="title">Group initialisation</div>
      <div class="subtitle">
        Add players to groups before uploading fixtures.
      </div>
    </div>
  `;

  // later:
  // renderGroupInitialisationTool(...)
}

function renderEditionsStagesList(editions, stages) {
    return `
    <div class="manage-section">
      <div class="manage-section-title">Editions & stages</div>

      ${editions
          .map(
              (edition) => `
        <div class="edition-block">
          <div class="edition-title">
            ${edition.name}
          </div>

          ${
              stages
                  .filter((s) => s.edition_id === edition.id)
                  .sort((a, b) => a.order_index - b.order_index)
                  .map(
                      (stage) => `
  <div class="stage-row" data-stage-id="${stage.id}">
    <div class="stage-name">${stage.name}</div>
    <div class="stage-type">${stage.stage_type}</div>

    <div class="stage-actions">
      <button
        class="icon-btn"
        data-action="up"
        data-stage="${stage.id}"
      >↑</button>

      <button
        class="icon-btn"
        data-action="down"
        data-stage="${stage.id}"
      >↓</button>
    </div>
  </div>
`
                  )

                  .join("") ||
              `
              <div class="empty-message">No stages</div>
            `
          }
        </div>
      `
          )
          .join("")}
    </div>
  `;
}

async function renderTournamentStructure(tournamentId) {
  const el = document.getElementById("structure-content");
  if (!el) return;

  // Load editions + stages
	const editions = window.currentEditions || [];

	const { data: stages } = await window.supabaseClient
	  .from("stages")
	  .select(`
		  id,
		  name,
		  stage_type,
		  bracket_id,
		  edition_id,
		  order_index,
		  standings_config
		`)
	  .order("order_index");
	  window.currentStages = stages || [];
	  
	const { data: advancementRules, error: arError } = await window.supabaseClient
	  .from("advancement_rules")
	  .select(`
		id,
		source_stage_id,
		source_group_id,
		condition,
		position,
		quantity,
		layer,
		target_stage_id,
		target_group_id,
		description
	  `)
	  .in(
		"source_stage_id",
		(stages || []).map(s => s.id)
	  )
	  .order("layer", { ascending: true });

	if (arError) {
	  console.error(arError);
	}
	
	const rulesByStage = new Map();

	(advancementRules || []).forEach(r => {
	  if (!rulesByStage.has(r.source_stage_id)) {
		rulesByStage.set(r.source_stage_id, []);
	  }
	  rulesByStage.get(r.source_stage_id).push(r);
	});
		  
	const { data: groups, error: groupsError } = await window.supabaseClient
	  .from("groups")
	  .select("id, name, stage_id")
	  .in(
		"stage_id",
		(stages || []).map(s => s.id)
	  );

if (groupsError) {
  console.error(groupsError);
}

  if (!editions || !editions.length) {
    el.innerHTML = `
      <div class="card">
        <div class="empty-message">No editions yet.</div>
        <button class="header-btn small" id="structure-add-edition">
          + Add edition
        </button>
      </div>
    `;
    wireStructureAddEdition(tournamentId);
    return;
  }

  const currentEditionId =
    window.tournamentContext.editionId || editions[0].id;

  const editionStages = (stages || []).filter(
    s => s.edition_id === currentEditionId
  );

	el.innerHTML = `
	  <div class="card">
		<label class="section-title">Edition</label>

		<div style="display:flex; gap:8px; align-items:center;">
		  <select id="structure-edition">
			${editions
			  .map(
				e => `
			  <option value="${e.id}" ${
				  e.id === currentEditionId ? "selected" : ""
				}>
				${e.name}
			  </option>`
			  )
			  .join("")}
		  </select>

		  <button
			class="header-btn small secondary"
			id="structure-add-edition"
		  >
			+ Add edition
		  </button>
		</div>
	  </div>

    <div id="structure-stages">
      ${
		editionStages.length
		  ? editionStages
			  .map(stage =>
				renderStageCard(
				  stage,
				  groups || [],
				  rulesByStage.get(stage.id) || []
				)
			  )
			  .join("")
          : `<div class="empty-message">No stages yet.</div>`
      }
    </div>

    <div class="card">
      <div class="card">
		  <button
			class="header-btn small"
			onclick="openAddStageModal('${currentEditionId}')"
		  >
			+ Add stage
		  </button>
	</div>
    </div>
  `;

wireStructureEditionChange(tournamentId);
wireStructureAddEdition(tournamentId);
wireStructureAddStage(currentEditionId);
wireStructureGroupButtons();
wireStructureStageAccordions();
wireStructureGroupAddButtons();

	// Standings rules buttons (GROUP stages only)
	document
	  .querySelectorAll("[data-standings-stage]")
	  .forEach(btn => {
		btn.addEventListener("click", () => {
		  openStandingsConfigModal(btn.dataset.standingsStage);
		});
	  });

	// Advancement rules buttons
	document
	  .querySelectorAll("[data-advancement-stage]")
	  .forEach(btn => {
		btn.addEventListener("click", () => {
		  const stageId = btn.dataset.advancementStage;

		  window.location.hash =
			`#/tournament/${window.currentTournamentId}/structure/advancement/${stageId}`;
		});
	  });
	  
	document
	  .querySelectorAll("[data-add-groups-stage]")
	  .forEach(btn => {
		btn.addEventListener("click", () => {
		  openAddGroupsOverlay(btn.dataset.addGroupsStage);
		});
	  });
}

async function loadStageAdvancementRules(tournamentId, stageId) {
  // --- Rehydrate minimal tournament context on refresh ---
  window.currentTournamentId = tournamentId;
  window.tournamentContext = window.tournamentContext || {};
  window.tournamentContext.stageId = stageId;

  // 1) Ensure we know the edition for this stage
  if (!window.tournamentContext.editionId) {
    const { data: stage, error: sErr } = await window.supabaseClient
      .from("stages")
      .select("id, edition_id")
      .eq("id", stageId)
      .maybeSingle();

    if (sErr || !stage?.edition_id) {
      console.error("[advancement] failed to rehydrate stage/edition", sErr, stage);
      showError("Failed to load stage context for advancement rules.");
      return;
    }

    window.tournamentContext.editionId = stage.edition_id;
  }

  // 2) Ensure we have stages for this edition (used by the dropdown)
  const edId = window.tournamentContext.editionId;

  const { data: stages, error: stErr } = await window.supabaseClient
    .from("stages")
    .select("id, name, stage_type, bracket_id, edition_id, order_index")
    .eq("edition_id", edId)
    .order("order_index");

  if (stErr) {
    console.error("[advancement] failed to load stages list", stErr);
    showError("Failed to load stages for advancement rules.");
    return;
  }

  window.currentStages = stages || [];

  showBackButton(() => {
    window.location.hash = `#/tournament/${tournamentId}/structure`;
  });

  setAddFriendlyVisible(false);

  showLoading("Loading advancement rules…");

  const { data: stage, error: stageErr } = await window.supabaseClient
    .from("stages")
    .select("id,name,stage_type")
    .eq("id", stageId)
    .maybeSingle();
	
	// ----------------------------------------
	// LOAD *ALL* STAGES FOR TARGET SELECTION
	// ----------------------------------------
	const { data: allStages, error: allStagesErr } = await window.supabaseClient
	  .from("stages")
	  .select("id,name,edition_id,order_index");

	if (allStagesErr) {
	  console.error(allStagesErr);
	} else {
	  window.currentStages = allStages || [];
	}

  if (stageErr || !stage) {
    console.error(stageErr);
    showError("Failed to load stage.");
    return;
  }

  const { data: rules, error: rulesErr } = await window.supabaseClient
    .from("advancement_rules")
    .select(`
      id,
      source_group_id,
      condition,
      position,
      quantity,
      layer,
      target_stage_id,
      target_group_id,
	  description
    `)
    .eq("source_stage_id", stageId)
    .order("layer", { ascending: true });

  if (rulesErr) {
    console.error(rulesErr);
    showError("Failed to load advancement rules.");
    return;
  }

  setContent(`
    <div class="card">
      <div class="tournament-header">
        <div class="tournament-name">${stage.name}</div>
        <div class="subtitle">Advancement rules</div>
      </div>

      <div id="advancement-rules-content"></div>
    </div>
  `);

  renderAdvancementRulesList(stage, rules || []);
  window.tournamentContext.stageId = stageId;
}

function renderAdvancementRulesList(stage, rules) {
  const el = document.getElementById("advancement-rules-content");
  if (!el) return;

if (!rules.length) {
  el.innerHTML = `
    <div class="empty-message">
      No advancement rules defined for this stage.
    </div>

    <button
      class="header-btn small secondary"
      id="add-adv-rule-btn"
    >
      + Add advancement rule
    </button>
  `;
} else {
  el.innerHTML = `
    <table class="simple-table">
      <thead>
        <tr>
          <th>Condition</th>
          <th>Qty</th>
          <th>Layer</th>
          <th>Target</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${rules.map(r => `
          <tr>
            <td>
              ${r.condition}
              ${r.position ? `(position ${r.position})` : ""}
            </td>
            <td>${r.quantity ?? "–"}</td>
            <td>${r.layer}</td>
            <td>
			  ${r.description || (r.target_stage_id ? "Advances" : "Eliminated")}
			</td>
            <td style="white-space:nowrap;">
			  <span
				class="
				  adv-indicator
				  adv-${r.condition}
				  adv-layer-${r.layer}
				"
				title="${r.condition.replace('_', ' ')} (layer ${r.layer})"
			  ></span>

			  <button
				class="icon-btn edit-adv-rule"
				data-rule-id="${r.id}"
				title="Edit rule"
			  >✏️</button>

			  <button
				class="icon-btn delete-adv-rule"
				data-rule-id="${r.id}"
				title="Delete rule"
			  >✕</button>
			</td>
          </tr>
        `).join("")}
      </tbody>
    </table>

    <button
      class="header-btn small secondary"
      id="add-adv-rule-btn"
    >
      + Add advancement rule
    </button>
  `;
}

	// Edit rule
	el.querySelectorAll(".edit-adv-rule").forEach(btn => {
	  btn.addEventListener("click", () => {
		const ruleId = btn.dataset.ruleId;
		openAdvancementRuleModal(stage.id, ruleId);
	  });
	});

	// Delete rule
	el.querySelectorAll(".delete-adv-rule").forEach(btn => {
	  btn.addEventListener("click", async () => {
		const ruleId = btn.dataset.ruleId;

		if (!confirm("Delete this advancement rule?")) return;

		const { error } = await window.supabaseClient
		  .from("advancement_rules")
		  .delete()
		  .eq("id", ruleId);

		if (error) {
		  console.error(error);
		  alert("Failed to delete rule.");
		  return;
		}

		loadStageAdvancementRules(
		  window.currentTournamentId,
		  stage.id
		);
	  });
	});

  
  const addBtn = document.getElementById("add-adv-rule-btn");
	if (addBtn) {
	  addBtn.addEventListener("click", () => {
		openAdvancementRuleModal(stage.id);
	  });
	}
}

function openAddStageModal() {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";

  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">Add stage</div>
        <button class="icon-btn modal-close">✕</button>
      </div>

		<div class="modal-body">
		  <label>
			Stage name
			<input type="text" id="stage-name" />
		  </label>

		  <label>
			Stage type
			<select id="stage-type">
			  <option value="group">Group</option>
			  <option value="knockout">Knockout</option>
			</select>
		  </label>

		  <div class="form-row" id="stage-bracket-row" style="display:none;">
			<label>
			  Bracket
			  <input
				type="text"
				id="stage-bracket-id"
				placeholder="e.g. main, b, plate"
			  />
			</label>
		  </div>

		  <label>
			Stage order
			<input
			  type="number"
			  id="stage-order"
			  min="1"
			  step="1"
			  placeholder="1 = first stage"
			/>
		  </label>
		</div>

      <div class="modal-actions">
        <button class="header-btn secondary modal-cancel">Cancel</button>
        <button class="header-btn" id="stage-save-btn">Add stage</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  
  const stageTypeSelect = modal.querySelector("#stage-type");
	const bracketRow = modal.querySelector("#stage-bracket-row");
	const bracketInput = modal.querySelector("#stage-bracket-id");

	function updateBracketVisibility() {
	  if (stageTypeSelect.value === "knockout") {
		bracketRow.style.display = "block";
	  } else {
		bracketRow.style.display = "none";
		bracketInput.value = "";
	  }
	}

	stageTypeSelect.addEventListener("change", updateBracketVisibility);
	updateBracketVisibility();


  modal.querySelector(".modal-close").onclick =
  modal.querySelector(".modal-cancel").onclick =
    () => modal.remove();

  modal.querySelector("#stage-save-btn").onclick = async () => {
    const name = modal.querySelector("#stage-name").value.trim();
    const type = modal.querySelector("#stage-type").value;
    const order = Number(modal.querySelector("#stage-order").value);

    if (!name || !type || !Number.isInteger(order) || order < 1) {
      alert("Name, type and a valid stage order are required.");
      return;
    }

    const editionId = window.tournamentContext.editionId;
    if (!editionId) {
      alert("No edition selected.");
      return;
    }

	const bracketId =
	  type === "knockout"
		? modal.querySelector("#stage-bracket-id").value.trim() || null
		: null;

	const { error } = await window.supabaseClient.from("stages").insert({
	  edition_id: editionId,
	  name,
	  stage_type: type,
	  order_index: order,
	  bracket_id: bracketId
	});

    if (error) {
      console.error(error);
      alert("Failed to add stage.");
      return;
    }

	modal.remove();

	// Clear stage selection so the new stage list refreshes cleanly
	window.tournamentContext.stageId = null;

	// STAY IN STRUCTURE MODE
	window.location.hash =
	  `#/tournament/${window.currentTournamentId}/structure`;
  };
}


function openAdvancementRuleModal(stageId, ruleId = null) {
	console.log("[adv modal] opened for stage", stageId);
  const modal = document.createElement("div");
  modal.className = "modal-overlay";

  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">Add advancement rule</div>
        <button class="icon-btn modal-close">✕</button>
      </div>

      <div class="modal-body">
        <label>
          Condition
          <select id="adv-condition">
            <option value="winner">Winner</option>
            <option value="runner_up">Runner-up</option>
            <option value="nth_place">Nth place</option>
            <option value="best_placed">Best placed</option>
            <option value="loser">Loser</option>
            <option value="all">All</option>
          </select>
        </label>

        <label>
          Position (only for nth_place)
          <input type="number" id="adv-position" min="1" />
        </label>

        <label>
          Quantity
          <input type="number" id="adv-quantity" min="1" />
        </label>

        <label>
          Layer
          <input type="number" id="adv-layer" min="1" value="1" />
        </label>
		
		<label>
		  Advances to
		  <select id="adv-target-type">
			<option value="">Eliminated</option>
			<option value="stage">Another stage</option>
		  </select>
		</label>

        <label id="adv-target-stage-row" style="display:none;">
		  Target stage
		  <select id="adv-target-stage"></select>
		</label>
		
		<label id="adv-target-group-row" style="display:none;">
		  Target group / round
		  <select id="adv-target-group"></select>
		</label>
		
		<label>
		  Description
		  <input
			type="text"
			id="adv-description"
			placeholder=""
		  />
		</label>
      </div>

      <div class="modal-actions">
        <button class="header-btn secondary modal-cancel">Cancel</button>
        <button class="header-btn" id="adv-save-btn">Save rule</button>
      </div>
    </div>
  `;
  
  // EDIT MODE: load existing rule
	if (ruleId) {
	  window.supabaseClient
		.from("advancement_rules")
		.select("*")
		.eq("id", ruleId)
		.maybeSingle()
		.then(({ data }) => {
		  if (!data) return;

		  modal.querySelector("#adv-condition").value = data.condition;
		  modal.querySelector("#adv-position").value = data.position ?? "";
		  modal.querySelector("#adv-quantity").value = data.quantity ?? "";
		  modal.querySelector("#adv-layer").value = data.layer;
		  modal.querySelector("#adv-target-stage").value =
			data.target_stage_id ?? "";
			if (data.target_stage_id) {
			  modal.querySelector("#adv-target-type").value = "stage";
			  modal.querySelector("#adv-target-stage-row").style.display = "block";
			}
			if (data.target_group_id) {
			  modal.querySelector("#adv-target-group-row").style.display = "block";
			  modal.querySelector("#adv-target-group").value =
				data.target_group_id;
			}
		  modal.querySelector("#adv-description").value = data.description ?? "";
		});
	}


  document.body.appendChild(modal);
  console.log(
  "[adv modal] context",
  window.tournamentContext
);
  
	// ---------------------------------------
	// Load stages for target selection
	// ---------------------------------------
	(async () => {
	  console.log("[adv modal] loading stages…");

	  const { data: stages, error } = await window.supabaseClient
		.from("stages")
		.select("id,name,edition_id,order_index")
		.eq("edition_id", window.tournamentContext.editionId)
		.order("order_index");

	  console.log("[adv modal] stages result", { stages, error });

	  if (error) {
		console.error(error);
		return;
	  }

	  if (!stages || !stages.length) {
		console.warn("[adv modal] NO STAGES RETURNED");
		return;
	  }

	  const currentStage = stages.find(s => s.id === stageId);
	  console.log("[adv modal] current stage", currentStage);

	  const eligibleStages = stages.filter(
		s => currentStage && s.order_index > currentStage.order_index
	  );

	  console.log("[adv modal] eligible stages", eligibleStages);

	  const stageSelect = modal.querySelector("#adv-target-stage");

	  stageSelect.innerHTML =
		`<option value="">Select stage…</option>` +
		eligibleStages
		  .map(s => `<option value="${s.id}">${s.name}</option>`)
		  .join("");
	})();
	  
	// ---------------------------------------
	// Populate eligible target stages
	// ---------------------------------------

	const currentStage = window.currentStages?.find(
	  s => s.id === stageId
	);

	const targetStageSelect =
	  modal.querySelector("#adv-target-stage");

	if (currentStage && window.currentStages) {
	  const eligibleStages = window.currentStages.filter(
		s =>
		  s.edition_id === currentStage.edition_id &&
		  s.order_index > currentStage.order_index
	  );

	  targetStageSelect.innerHTML =
		`<option value="">Select stage…</option>` +
		eligibleStages
		  .map(
			s => `<option value="${s.id}">${s.name}</option>`
		  )
		  .join("");
	}
	
	// ---------------------------------------
	// Target type toggle (Eliminated vs Stage)
	// ---------------------------------------

	const targetTypeEl =
	modal.querySelector("#adv-target-type");

	const targetStageRow =
	modal.querySelector("#adv-target-stage-row");

	const targetGroupRow =
	modal.querySelector("#adv-target-group-row");

	targetTypeEl.addEventListener("change", e => {
	const isStage = e.target.value === "stage";

	targetStageRow.style.display = isStage ? "block" : "none";
	targetGroupRow.style.display = "none";

	if (!isStage) {
	modal.querySelector("#adv-target-stage").value = "";
	modal.querySelector("#adv-target-group").innerHTML = "";
	}
	});

	// ---------------------------------------
	// Load groups when target stage changes
	// ---------------------------------------

	modal
	  .querySelector("#adv-target-stage")
	  .addEventListener("change", async e => {
		const targetStageId = e.target.value;
		const groupSelect =
		  modal.querySelector("#adv-target-group");

		targetGroupRow.style.display = "none";
		groupSelect.innerHTML = "";

		if (!targetStageId) return;

		const { data: groups, error } = await window.supabaseClient
		  .from("groups")
		  .select("id,name")
		  .eq("stage_id", targetStageId)
		  .order("name");

		if (error) {
		  console.error(error);
		  return;
		}

		if (groups && groups.length) {
		  groupSelect.innerHTML =
			`<option value="">Any group</option>` +
			groups
			  .map(
				g =>
				  `<option value="${g.id}">${g.name}</option>`
			  )
			  .join("");

		  targetGroupRow.style.display = "block";
		}
	  });
  
	const conditionEl = modal.querySelector("#adv-condition");
	const quantityEl  = modal.querySelector("#adv-quantity");
	const targetEl    = modal.querySelector("#adv-target-stage");
	const descEl      = modal.querySelector("#adv-description");

	function updateDescriptionPlaceholder() {
	  const condition = conditionEl.value;
	  const qty = quantityEl.value;
	  const target = targetEl.value;

	  let text = "";

	  switch (condition) {
		case "winner":
		  text = "Winner";
		  break;
		case "runner_up":
		  text = "Runner-up";
		  break;
		case "loser":
		  text = "Loser";
		  break;
		case "nth_place":
		  text = "Nth place";
		  break;
		case "best_placed":
		  text = qty ? `Best ${qty}` : "Best placed";
		  break;
		case "all":
		  text = "All players";
		  break;
		default:
		  text = "Qualified players";
	  }

	  if (target) {
		text += " advance";
	  } else {
		text += " eliminated";
	  }

	  descEl.placeholder = text;
	}

	// Wire updates
	[conditionEl, quantityEl, targetEl].forEach(el =>
	  el.addEventListener("change", updateDescriptionPlaceholder)
	);

	// Initial run
	updateDescriptionPlaceholder();

	  modal.querySelector(".modal-close")?.addEventListener("click", () => modal.remove());
	  modal.querySelector(".modal-cancel")?.addEventListener("click", () => modal.remove());
	  
	if (ruleId) {
	  modal.querySelector(".modal-title").textContent =
		"Edit advancement rule";
	}

	  wireAdvancementRuleSave(stageId, modal);
}

function wireAdvancementRuleSave(stageId, modal) {
  const saveBtn = modal.querySelector("#adv-save-btn");

  saveBtn.addEventListener("click", async () => {
    const condition = modal.querySelector("#adv-condition").value;
    const position  = modal.querySelector("#adv-position").value || null;
    const quantity  = modal.querySelector("#adv-quantity").value || null;
    const layer     = modal.querySelector("#adv-layer").value;
    const targetType =
	  modal.querySelector("#adv-target-type")?.value || "";

	const targetStage =
	  targetType === "stage"
		? modal.querySelector("#adv-target-stage")?.value || null
		: null;

	const targetGroup =
	  targetStage
		? modal.querySelector("#adv-target-group")?.value || null
		: null;
	const description = modal.querySelector("#adv-description").value || null;

    if (!condition || !layer) {
      alert("Condition and layer are required.");
      return;
    }

	const payload = {
	  source_stage_id: stageId,
	  condition,
	  position,
	  quantity,
	  layer,
	  target_stage_id: targetStage,
	  target_group_id: targetGroup,
	  description
	};

	let query;

	if (modal.dataset.ruleId) {
	  query = window.supabaseClient
		.from("advancement_rules")
		.update(payload)
		.eq("id", modal.dataset.ruleId);
	} else {
	  query = window.supabaseClient
		.from("advancement_rules")
		.insert(payload);
	}

	const { error } = await query;


    if (error) {
      console.error(error);
      alert("Failed to save rule.");
      return;
    }

    modal.remove();

    // Re-load rules screen
    loadStageAdvancementRules(
      window.currentTournamentId,
      stageId
    );
  });
}

async function loadStagesForEdition(editionId) {
  const container = document.getElementById("structure-stages");
  if (!container) return;

  container.innerHTML = `<div class="subtitle">Loading stages…</div>`;

  const { data: stages, error } = await window.supabaseClient
    .from("stages")
    .select("id,name,stage_type,order_index")
    .eq("edition_id", editionId)
    .order("order_index");

  if (error) {
    console.error(error);
    container.innerHTML =
      `<div class="error">Failed to load stages.</div>`;
    return;
  }

  renderStages(stages || []);
}

function renderStages(stages) {
  const container = document.getElementById("structure-stages");
  if (!container) return;

  if (!stages.length) {
    container.innerHTML = `
      <div class="empty-message">
        No stages yet.
      </div>
    `;
    return;
  }

  container.innerHTML = stages
    .map(
      s => `
      <div class="card" data-stage-id="${s.id}">
        <div class="title-row">
          <div class="title">${s.name}</div>
          <div class="pill scheduled">${s.stage_type}</div>
        </div>

        <div class="subtitle">Groups / rounds</div>
        <div class="structure-groups" id="groups-${s.id}">
          Loading…
        </div>
      </div>
    `
    )
    .join("");

  stages.forEach(stage => {
    loadGroupsForStage(stage.id);
  });
}

function renderStageCard(stage, groups, advancementRules) {
  const stageGroups = groups.filter(g => g.stage_id === stage.id);

return `
  <div class="card stage-card" data-stage-id="${stage.id}">
    <div class="stage-header">
      <div class="stage-title">
        ${stage.name}
        <span class="pill">${stage.stage_type}</span>
      </div>
    </div>

    <div class="stage-groups">
      ${
        stageGroups.length
          ? `
            <ul class="simple-list">
              ${stageGroups.map(g => `
                <li class="group-row" data-group-id="${g.id}">
                  <span>${g.name}</span>
                  <button
                    class="icon-btn delete-group"
                    data-group-id="${g.id}"
                    title="Delete"
                  >
                    ✕
                  </button>
                </li>
              `).join("")}
            </ul>
          `
          : `<div class="empty-message">No groups yet</div>`
      }
    </div>

    <button
      class="header-btn small"
      data-add-groups-stage="${stage.id}"
    >
      + Add group / round
    </button>

    ${
      stage.stage_type === "group"
        ? `
          <button
            class="header-btn small"
            data-standings-stage="${stage.id}">
            Standings rules
          </button>
        `
        : ""
    }

    <div class="structure-subsection"><br>
      <div class="subsection-title">Advancement rules</div>

      <div class="subtitle">
        Define how players advance from this stage
      </div>

      <button
        class="header-btn small secondary"
        data-advancement-stage="${stage.id}"
      >
        Manage advancement rules
      </button>
    </div>
  </div>
`;

}

async function openStandingsConfigModal(stageId) {
  const stage = window.currentStages.find(s => s.id === stageId);
  if (!stage) return;

  const config =
    stage.standings_config
      ? structuredClone(stage.standings_config)
      : structuredClone(DEFAULT_STANDINGS_CONFIG);

  const modal = document.createElement("div");
  modal.className = "modal-overlay";

  modal.innerHTML = `
    <div class="modal-card wide">
      <div class="modal-header">
        <div class="modal-title">Standings rules</div>
        <button class="icon-btn modal-close">✕</button>
      </div>

      <div class="modal-body">

        <h4>Visible columns</h4>
        <div id="sc-columns"></div>

        <h4 style="margin-top:16px;">Sorting order</h4>
        <div id="sc-ranking"></div>

      </div>

      <div class="modal-actions">
        <button class="header-btn secondary modal-cancel">Cancel</button>
        <button class="header-btn" id="sc-save">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector(".modal-close").onclick =
  modal.querySelector(".modal-cancel").onclick =
    () => modal.remove();

  renderStandingsColumnsEditor(modal, config);
  renderStandingsRankingEditor(modal, config);

modal.querySelector("#sc-save").onclick = async () => {
  console.log("[standings] SAVE CLICKED", stageId);
    if (!config.ranking.length) {
      alert("At least one sorting rule is required.");
      return;
    }

    await window.supabaseClient
      .from("stages")
      .update({ standings_config: config })
      .eq("id", stageId);

    stage.standings_config = config;

    modal.remove();
    rerenderStandingsOnly();
  };
}

function renderStandingsColumnsEditor(modal, config) {
  const el = modal.querySelector("#sc-columns");

  function redraw() {
    el.innerHTML = STANDINGS_STAT_DEFS.map(stat => {
      const checked = config.columns.includes(stat.key);
      const id = `sc-col-${stat.key}`;

      return `
        <div class="sc-check-row">
          <input
            id="${id}"
            type="checkbox"
            data-col="${stat.key}"
            ${checked ? "checked" : ""}
          />
          <label for="${id}" class="sc-check-label">${stat.label}</label>
        </div>
      `;
    }).join("");

    el.querySelectorAll("input[type=checkbox]").forEach(cb => {
      cb.onchange = () => {
        const key = cb.dataset.col;
        if (cb.checked) {
          if (!config.columns.includes(key)) config.columns.push(key);
        } else {
          config.columns = config.columns.filter(c => c !== key);
        }
      };
    });
  }

  redraw();
}

function renderStandingsRankingEditor(modal, config) {
  const el = modal.querySelector("#sc-ranking");

  function redraw() {
    el.innerHTML = config.ranking.map((r, i) => `
      <div class="ranking-row">
        <select data-idx="${i}" data-field="key">
          ${STANDINGS_STAT_DEFS.map(s =>
            `<option value="${s.key}"
              ${s.key === r.key ? "selected" : ""}>
              ${s.label}
            </option>`
          ).join("")}
        </select>

        <select data-idx="${i}" data-field="direction">
          <option value="desc" ${r.direction === "desc" ? "selected" : ""}>↓</option>
          <option value="asc" ${r.direction === "asc" ? "selected" : ""}>↑</option>
        </select>

        <button data-remove="${i}" class="icon-btn">✕</button>
      </div>
    `).join("") + `
      <button id="sc-add-rule" class="header-btn small secondary">
        + Add rule
      </button>
    `;

    el.querySelectorAll("select").forEach(sel => {
      sel.onchange = () => {
        const i = Number(sel.dataset.idx);
        config.ranking[i][sel.dataset.field] = sel.value;
      };
    });

    el.querySelectorAll("[data-remove]").forEach(btn => {
      btn.onclick = () => {
        config.ranking.splice(btn.dataset.remove, 1);
        redraw();
      };
    });

    el.querySelector("#sc-add-rule").onclick = () => {
      config.ranking.push({
        key: STANDINGS_STAT_DEFS[0].key,
        direction: "desc"
      });
      redraw();
    };
  }

  redraw();
}

function rerenderStandingsOnly() {
  if (!window.currentTournamentId) return;

  renderTournamentStandingsTab(
    window.currentTournamentId,
    window.currentMatches
  );
}

function renderTournamentTeamsPage(tournamentId) {
  setContent(`
    <div class="card">
      <div class="tournament-header">
        <div class="tournament-name">
          Teams
        </div>
        <div class="subtitle">
          ${window.currentTournament?.name || ""}
        </div>
      </div>

      <div id="teams-page-content"></div>
    </div>
  `);

  const container = document.getElementById("teams-page-content");
  App.Teams.renderManageTeamsSection(container);
}

window.App = window.App || {};
App.Teams = App.Teams || {};

App.Teams.renderManageTeamsSection = function (container) {
  const teams = window.currentTeams || [];
  const allPlayers = window.allPlayers || [];

  if (!teams.length) {
    container.innerHTML = `
      <div class="card">
        <div class="empty-message">
          No teams have been created for this event.
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
  
    <div class="teams-toolbar">
		<button class="header-btn" id="teams-bulk-import-btn">
		  Bulk import teams
		</button>
	</div>

  <div id="teams-import-panel"></div>
    <div class="card">
      <div class="table-wrap">
        <table class="teams-table">
          <thead>
            <tr>
              <th>Team</th>
              <th>#</th>
              <th>Players</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${teams.map(team => {
              const members = App.Teams.getMembersForTeam(team.id);

              const names = members
                .map(m => {
                  const player = allPlayers.find(p => p.id === m.player_id);
                  return App.Teams.formatPlayerNameShort(player);
                })
                .filter(Boolean);

              const displayNames =
                names.length > 6
                  ? `${names.slice(0, 6).join(", ")}, …`
                  : names.join(", ");

              return `
                <tr>
                  <td class="team-name">${team.name}</td>
                  <td class="team-count">${members.length}</td>
                  <td class="team-players">${displayNames || "—"}</td>
                  <td class="team-actions"></td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
  
	const importBtn = container.querySelector("#teams-bulk-import-btn");
	const panel = container.querySelector("#teams-import-panel");

	if (importBtn && panel) {
	  importBtn.addEventListener("click", () => {
		window.teamImportState.open = !window.teamImportState.open;
		App.Teams.renderImportPanel(panel);
	  });

	  // Render initial state
	  App.Teams.renderImportPanel(panel);
	}
};


function wireStructureEditionChange(tournamentId) {
  const select = document.getElementById("structure-edition");
  if (!select) return;

  select.addEventListener("change", () => {
    const editionId = select.value;

    // persist selection
    window.tournamentContext.editionId = editionId;

    // FULL RE-RENDER (THIS WAS MISSING)
    renderTournamentStructure(tournamentId);
  });
}

function wireStructureAddEdition(tournamentId) {
  const btn = document.getElementById("structure-add-edition");
  if (!btn) return;

  btn.addEventListener("click", () => {
    createEditionPrompt(tournamentId);
  });
}

function wireStructureAddStage(editionId) {
  const btn = document.getElementById("structure-add-stage");
  if (!btn) return;

  btn.addEventListener("click", () => {
    createStagePrompt(editionId);
  });
}

function wireStructureGroupButtons() {
  document.querySelectorAll("[data-stage]").forEach(btn => {
    btn.addEventListener("click", () => {
      alert("Group editor coming next");
    });
  });
}

function wireStructureStageAccordions() {
  document.querySelectorAll(".stage-toggle").forEach(toggle => {
    toggle.addEventListener("click", async () => {
      const card = toggle.closest(".stage-card");
      const body = card.querySelector(".stage-body");
      const chevron = card.querySelector(".stage-chevron");

      const open = body.classList.toggle("hidden") === false;
      chevron.textContent = open ? "▾" : "▸";

      if (open) {
        const stageId = card.dataset.stageId;
        await loadGroupsForStage(stageId);
      }
    });
  });
}

function wireStageStandingsButtons() {
  document
    .querySelectorAll("[data-standings-stage]")
    .forEach(btn => {
      btn.addEventListener("click", () => {
        openStandingsConfigModal(btn.dataset.standingsStage);
      });
    });
}

async function loadGroupsForStage(stageId) {
  const container = document.querySelector(
    `[data-groups-for="${stageId}"]`
  );
  if (!container) return;

  const { data: groups, error } = await window.supabaseClient
    .from("groups")
    .select("id,name")
    .eq("stage_id", stageId)
    .order("name");

  if (error) {
    container.innerHTML =
      `<div class="error">Failed to load groups.</div>`;
    return;
  }

  if (!groups || !groups.length) {
    container.innerHTML =
      `<div class="empty-message">No groups yet.</div>`;
    return;
  }

  container.innerHTML = groups
    .map(
      g => `
        <div class="group-row" data-group-id="${g.id}">
          <input
            type="text"
            class="group-name-input"
            value="${g.name}"
          />
          <button class="icon-btn delete-group-btn" data-group="${g.id}">
            ✕
          </button>
        </div>
      `
    )
    .join("");

  wireGroupRename();
  wireGroupDelete();
}

function wireStructureGroupAddButtons() {
  document.querySelectorAll(".add-group-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const stageId = btn.dataset.stageId;

      const name = prompt("Group name (e.g. Group A)");
      if (!name) return;

      const { error } = await window.supabaseClient
        .from("groups")
        .insert({
          stage_id: stageId,
          name
        });

      if (error) {
        alert("Failed to add group");
        return;
      }

      loadTournamentOverview(window.currentTournamentId);
    });
  });
}

function wireGroupRename() {
  document.querySelectorAll(".group-name-input").forEach(input => {
    input.addEventListener("blur", async () => {
      const row = input.closest(".group-row");
      const groupId = row.dataset.groupId;
      const name = input.value.trim();

      if (!name) return;

      await window.supabaseClient
        .from("groups")
        .update({ name })
        .eq("id", groupId);
    });
  });
}

function wireGroupDelete() {
  document.querySelectorAll(".delete-group-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const groupId = btn.dataset.group;

      if (!confirm("Delete this group?")) return;

      const { error } = await window.supabaseClient
        .from("groups")
        .delete()
        .eq("id", groupId);

      if (!error) {
        btn.closest(".group-row").remove();
      }
    });
  });
}

function wireManageEditionsStages() {
    const addEditionBtn = document.getElementById("add-edition-btn");
    const addStageBtn = document.getElementById("add-stage-btn");

    if (addEditionBtn) {
        addEditionBtn.onclick = async () => {
            const name = prompt("Edition name:");
            if (!name) return;

            await window.supabaseClient.from("editions").insert({
                tournament_id: window.currentTournamentId,
                name,
            });

            // reset context so it selects the new edition
            window.tournamentContext.editionId = null;
            window.tournamentContext.stageId = null;

            loadTournamentOverview(window.currentTournamentId);
        };
    }

	if (addStageBtn) {
	  addStageBtn.onclick = () => {
		if (!window.tournamentContext.editionId) {
		  alert("Select an edition first.");
		  return;
		}
		openAddStageModal();
	  };
	}

    const addMatchBtn = document.getElementById("add-match-btn");

    if (addMatchBtn) {
        addMatchBtn.onclick = async () => {
            try {
                const p1Name = prompt("Player 1 name:");
                if (!p1Name) return;

                const p2Name = prompt("Player 2 name:");
                if (!p2Name) return;

                // Reuse the SAME resolver logic you already have
                const p1Id = await resolvePlayerByName(p1Name);
                const p2Id = await resolvePlayerByName(p2Name);

                if (p1Id === p2Id) {
                    throw new Error("Players must be different.");
                }

                // THIS IS WHERE allowedPlayerIds GOES
                const allowedPlayerIds = (window.tournamentPlayers || []).map(
                    (p) => p.id
                );

                if (
                    !allowedPlayerIds.includes(p1Id) ||
                    !allowedPlayerIds.includes(p2Id)
                ) {
                    throw new Error(
                        "Both players must already be part of this tournament."
                    );
                }

                // Only after validation do we insert
                const { error } = await window.supabaseClient.from("matches").insert({
                    tournament_id: window.currentTournamentId,
                    edition_id: window.tournamentContext.editionId,
                    stage_id: window.tournamentContext.stageId,
                    player1_id: p1Id,
                    player2_id: p2Id,
                    status: "scheduled",
                    match_date: new Date().toISOString(),
                });

                if (error) {
                    console.error(error);
                    throw new Error("Failed to create match.");
                }

                loadManageMatches();
            } catch (err) {
                alert(err.message || "Failed to add match.");
                console.error(err);
            }
        };
    }
}

function wireManageMatchDelete() {
  document.querySelectorAll(".delete-match").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();

      const matchId = btn.dataset.mid;
      if (!matchId) return;

      // ------------------------------------
      // 🔐 Permission guard (hard block)
      // ------------------------------------
      const match = window.currentMatches?.find(m => m.id === matchId);

      if (!match) {
        alert("Match not found.");
        return;
      }

	const isEffectiveSuperAdmin =
	  window.auth?.permissions?.some(p => p.role === "super_admin");

	const canDelete =
	  isEffectiveSuperAdmin ||
	  (
		canManageTournament(window.currentTournament) &&
		match.status === "scheduled"
	  );


      if (!canDelete) {
        alert("You do not have permission to delete this match.");
        return;
      }

      // ------------------------------------
      // Confirmation
      // ------------------------------------
      if (!confirm("Delete this match?")) return;

      // ------------------------------------
      // Perform delete
      // ------------------------------------
      const { error } = await window.supabaseClient
        .from("matches")
        .delete()
        .eq("id", matchId);

      if (error) {
        console.error(error);
        alert("Failed to delete match");
        return;
      }

      // ------------------------------------
      // Reload manage matches view
      // ------------------------------------
      loadTournamentMatchesManage(window.currentTournamentId);
    });
  });
}

// =======================================================
// MANAGE: create edition / stage prompts
// =======================================================

function createEditionPrompt(tournamentId) {
  const modal = document.getElementById("edition-modal");
  if (!modal) return;

  const nameInput  = document.getElementById("edition-name");
  const startInput = document.getElementById("edition-start");
  const endInput   = document.getElementById("edition-end");
  const errorBox   = document.getElementById("edition-error");

  nameInput.value = "";
  startInput.value = "";
  endInput.value = "";
  errorBox.style.display = "none";

  modal.style.display = "flex";

  document.getElementById("edition-cancel").onclick = () => {
    modal.style.display = "none";
  };

  document.getElementById("edition-create").onclick = async () => {
    const name = nameInput.value.trim();
    const startDate = startInput.value;
    const endDate = endInput.value;

    errorBox.style.display = "none";

    if (!name || !startDate || !endDate) {
      errorBox.textContent = "All fields are required.";
      errorBox.style.display = "block";
      return;
    }

    const start = new Date(startDate);
    const end   = new Date(endDate);

    if (end < start) {
      errorBox.textContent = "End date cannot be before start date.";
      errorBox.style.display = "block";
      return;
    }

    const { error } = await window.supabaseClient
      .from("editions")
      .insert({
        tournament_id: tournamentId,
        name,
        start_date: startDate,
        end_date: endDate
      });

    if (error) {
      console.error(error);
      errorBox.textContent = "Failed to create edition.";
      errorBox.style.display = "block";
      return;
    }

    modal.style.display = "none";

    if (window.currentTournamentId) {
      loadTournamentOverview(window.currentTournamentId);
    }
  };
}

function openAddGroupsOverlay(stageId) {
  // Remove existing overlay if any
  document.querySelector(".overlay-backdrop")?.remove();

  const backdrop = document.createElement("div");
  backdrop.className = "overlay-backdrop";

  backdrop.innerHTML = `
    <div class="overlay-card" style="max-width:420px;">
      <button class="overlay-close" id="add-groups-close">✕</button>

      <h3>Add groups / rounds</h3>

      <label class="section-title">
        One per line
      </label>

      <textarea
        id="add-groups-input"
        class="form-input form-textarea"
        rows="6"
        placeholder="Group A&#10;Group B&#10;Group C"
      ></textarea>

      <div
        id="add-groups-error"
        class="error"
        style="margin-top:6px;"
      ></div>

      <div class="modal-actions">
        <button id="add-groups-cancel">Cancel</button>
        <button id="add-groups-confirm">Add</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  // Close handlers
  document
    .getElementById("add-groups-close")
    .addEventListener("click", () => backdrop.remove());

  document
    .getElementById("add-groups-cancel")
    .addEventListener("click", () => backdrop.remove());

  // Confirm handler
  document
    .getElementById("add-groups-confirm")
    .addEventListener("click", async () => {
      const textarea =
        document.getElementById("add-groups-input");
      const errorEl =
        document.getElementById("add-groups-error");

      errorEl.textContent = "";

      const names = textarea.value
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean);

      if (!names.length) {
        errorEl.textContent =
          "Please enter at least one group / round.";
        return;
      }

      const rows = names.map((name, i) => ({
        stage_id: stageId,
        name,
        order_index: i + 1
      }));

      const { error } = await window.supabaseClient
        .from("groups")
        .insert(rows);

      if (error) {
        console.error(error);
        errorEl.textContent =
          "Failed to add groups / rounds.";
        return;
      }

      backdrop.remove();
      loadTournamentStructure(window.currentTournamentId);
    });
}

async function reorderStage(stageId, direction) {
    // Load current stage
    const { data: current, error } = await window.supabaseClient
        .from("stages")
        .select("id, edition_id, order_index")
        .eq("id", stageId)
        .maybeSingle();

    if (error || !current) return;

    // Find neighbour
    const matcher =
        direction === "up"
            ? window.supabaseClient
                  .from("stages")
                  .select("*")
                  .eq("edition_id", current.edition_id)
                  .lt("order_index", current.order_index)
                  .order("order_index", { ascending: false })
                  .limit(1)
            : window.supabaseClient
                  .from("stages")
                  .select("*")
                  .eq("edition_id", current.edition_id)
                  .gt("order_index", current.order_index)
                  .order("order_index", { ascending: true })
                  .limit(1);

    const { data: neighbour } = await matcher;

    if (!neighbour || neighbour.length === 0) return;

    const other = neighbour[0];

    // Swap order_index values
    await window.supabaseClient
        .from("stages")
        .update({ order_index: other.order_index })
        .eq("id", current.id);

    await window.supabaseClient
        .from("stages")
        .update({ order_index: current.order_index })
        .eq("id", other.id);

    // Reload overview
    loadTournamentOverview(window.currentTournamentId);
}

async function loadTournamentMatchesManage(tournamentId) {
  window.currentTournamentId = tournamentId;

  showBackButton(() => {
    window.location.hash = `#/tournament/${tournamentId}/overview?tab=manage`;
  });

  setAddFriendlyVisible(false);

  // FIRST: render the shell so the container exists
  setContent(`
    <div class="card">
      <div class="tournament-header">
        <div class="tournament-name">Match manager</div>
        <div class="subtitle">Create and manage matches</div>
      </div>

      <div id="manage-matches-content"></div>
    </div>
  `);

  // NOW the container exists
  const contentEl = document.getElementById("manage-matches-content");

	const { editionId, stageId, selectedBracketId } =
	  window.tournamentContext || {};
	  
	let groups = [];

	if (stageId) {
	  const { data: g, error: gErr } = await window.supabaseClient
		.from("groups")
		.select("id, name")
		.eq("stage_id", stageId)
		.order("name");

	  if (!gErr) groups = g || [];
	}

	if (!editionId || (!stageId && !selectedBracketId)) {
	  contentEl.innerHTML = `
		<div class="card">
		  <div class="error">
			Please select an edition and a stage or bracket before managing matches.
		  </div>
		</div>
	  `;
	  return;
	}

	contentEl.innerHTML = `
	  <div class="subtitle">Loading match manager…</div>
	`;

	let query = window.supabaseClient
	  .from("matches")
		.select(`
		  id,
		  match_date,
		  status,
		  final_sets_player1,
		  final_sets_player2,
		  bracket_meta,
		  stage_id,

		  player1:player1_id ( id, name ),
		  player2:player2_id ( id, name ),

		  team1:team1_id ( id, name ),
		  team2:team2_id ( id, name )
		`)
	  .eq("tournament_id", tournamentId)
	  .eq("edition_id", editionId);

	if (stageId) {
	  // Group stage or single-stage view
	  query = query.eq("stage_id", stageId);
	} else if (selectedBracketId) {
	  // Bracket view → all knockout stages in this bracket
	  const bracketStageIds = window.currentStages
		.filter(
		  s =>
			s.stage_type === "knockout" &&
			s.bracket_id === selectedBracketId
		)
		.map(s => s.id);

	  query = query.in("stage_id", bracketStageIds);
	}

	const { data: matches, error } = await query.order(
	  "match_date",
	  { ascending: true }
	);


  if (error) {
    console.error(error);
    showError("Failed to load matches.");
    return;
  }

	if (selectedBracketId) {
	  matches.sort((a, b) => {
		const ar = a.bracket_meta?.round_index ?? 0;
		const br = b.bracket_meta?.round_index ?? 0;
		if (ar !== br) return ar - br;

		const as = a.bracket_meta?.slot_index ?? 0;
		const bs = b.bracket_meta?.slot_index ?? 0;
		return as - bs;
	  });
	}

	await ensureAllPlayersLoaded();
	renderManageMatches(matches || [], { groups });
}

function renderManageMatches(matches, { groups = [] } = {}) {
  const el = document.getElementById("manage-matches-content");
  if (!el) return;
  
    const isFriendlies =
    typeof FRIENDLIES_TOURNAMENT_ID !== "undefined" &&
    window.currentTournamentId === FRIENDLIES_TOURNAMENT_ID;
	
	const tournament = window.currentTournament;

	const isAdmin = canManageTournament(tournament);

	const isCasualPlayer =
	  tournament?.type === "casual" &&
	  Array.isArray(window.auth?.players) &&
	  window.auth.players.length > 0 &&
	  !isAdmin;
	
	// EARLY GUARD — only block tools that truly need a stage
	const hasManageTarget =
	  window.tournamentContext?.stageId ||
	  window.tournamentContext?.selectedBracketId;

	if (
	  isAdmin &&
	  !isFriendlies &&
	  !isCasualPlayer &&
	  (
		!window.tournamentContext?.editionId ||
		!hasManageTarget
	  )
	) {
	  el.innerHTML = `
		<div class="card">
		  <div class="error">
			Please select an edition and stage or bracket before managing matches.
		  </div>
		</div>
	  `;
	  return;
	}

  const isEffectiveSuperAdmin =
  window.auth?.permissions?.some(p => p.role === "super_admin");

  // ---------------------------------------------------
  // MAIN RENDER
  // ---------------------------------------------------
  el.innerHTML = `
    <div class="manage-matches-grid">

      <!-- BULK FIXTURE UPLOAD -->
	  ${isAdmin && !isFriendlies ? `
      <div class="bulk-upload-wrapper">

        <div class="set-main-row bulk-header" id="bulk-toggle">
          <div class="col left">Bulk fixture upload</div>
          <div class="col mid"></div>
          <div class="col right bulk-chevron">▸</div>
        </div>

        <div class="set-throws-expanded hidden" id="bulk-body">

          <div class="bulk-row">
            <label>
              Edition
              <select id="bulk-edition"></select>
            </label>

            <label>
              Stage
              <select id="bulk-stage"></select>
            </label>
          </div>

          <label>
            CSV input
            <textarea
              id="bulk-csv-input"
              class="form-input form-textarea"
              rows="6"
            ></textarea>
          </label>

          <input
            type="file"
            id="bulk-csv-file"
            class="form-input"
          />

          <div class="form-row-inline">
            <button class="header-btn" id="bulk-validate-btn">Validate</button>
            <button class="header-btn secondary" id="bulk-upload-btn" disabled>Upload</button>
            <button class="header-btn small secondary" id="bulk-sample-btn">
              Download sample
            </button>
          </div>

          <div id="bulk-errors" class="error"></div>
          <div id="bulk-warnings"></div>
          <div id="bulk-preview"></div>

        </div>
      </div>
	  ` : ""}

	${isAdmin ? `
	  <!-- ADMIN: FULL ADD MATCH -->
	  <div class="card">
		<div class="section-title">Add match</div>

		<label>
		  Player A
		  <input type="text" id="mm-p1" autocomplete="off" />
		</label>
		<div id="mm-p1-suggestions" class="friendly-suggestions"></div>

		<label>
		  Player B
		  <input type="text" id="mm-p2" autocomplete="off" />
		</label>
		<div id="mm-p2-suggestions" class="friendly-suggestions"></div>

		<label>
		  Scheduled date & time
		  <input type="datetime-local" id="mm-date" />
		</label><br>
		
		<label class="form-label">Group</label>
		<select id="add-match-group">
		  <option value="">— select group —</option>
		  ${groups.map(g =>
			`<option value="${g.id}">${g.name}</option>`
		  ).join("")}
		</select><br>

		<label>
		  Status
		  <select id="mm-status">
			<option value="scheduled">Scheduled</option>
			<option value="live">Live</option>
			<option value="finished">Finished</option>
		  </select>
		</label><br>

		<label>
		  Final sets
		  <div style="display:flex; gap:8px;">
			<input type="number" id="mm-s1" min="0" placeholder="P1" style="width:70px;" />
			<input type="number" id="mm-s2" min="0" placeholder="P2" style="width:70px;" />
		  </div>
		</label>

		<div class="form-row-inline" style="margin-top:10px;">
		  <button class="header-btn" id="mm-add-btn">
			Create match only
		  </button>

		  <button class="header-btn secondary" id="mm-add-sets-btn">
			Create & add sets
		  </button>
		</div>

		<div class="error" id="mm-error" style="display:none;"></div>
	  </div>
	` : ""}

	${isCasualPlayer ? `
	  <!-- CASUAL PLAYER: SLIM MATCH CREATOR -->
	  <div class="card">
		<div class="section-title">Create match</div>

		<div class="match-small">
		  Casual tournament – players may create matches.
		</div>

		<label>
		  Opponent
		  <input type="text" id="pm-opponent" autocomplete="off" />
		</label>
		<div id="pm-opponent-suggestions" class="friendly-suggestions"></div>

		<button class="header-btn" id="pm-create-btn">
		  Create match
		</button>

		<div class="error" id="pm-error" style="display:none;"></div>
	  </div>
	` : ""}

      <!-- EXISTING MATCHES -->
	  ${!isFriendlies ? `
      <div class="card">
        <div class="manage-section-header">
          <h3>Existing Matches</h3>
          <button
            id="edit-all-sets-btn"
            class="header-btn secondary"
          >
            Edit all sets
          </button>
        </div>

        <div class="matches-scroll">
          ${
            matches.length
              ? matches.map(m => `
                <div class="match-row" data-mid="${m.id}">
                  <span>
                    ${(m.team1?.name || m.player1?.name || "TBC")}
					 v
					${(m.team2?.name || m.player2?.name || "TBC")}
                    <span class="pill ${m.status}">${m.status}</span>
                  </span>
                  <span class="muted">
                    ${m.match_date ? formatDate(m.match_date) : "No date"}

				${(
				  isEffectiveSuperAdmin ||
				  (
					canManageTournament(window.currentTournament) &&
					m.status === "scheduled"
				  )
				) ? `
				  <button
					class="header-btn small danger delete-match"
					data-mid="${m.id}"
					title="Delete match"
				  >
					✕
				  </button>
				` : ""}

                  </span>
                </div>
              `).join("")
              : `<div class="empty-message">No matches yet.</div>`
          }
        </div>
      </div>
	  ` : ""}

    </div>
  `;

  // ---------------------------------------------------
  // WIRE BUTTONS (AFTER RENDER)
  // ---------------------------------------------------
	if (isAdmin) {
	  document
		.getElementById("edit-all-sets-btn")
		?.addEventListener("click", openStageSetEditor);

	  wireManageMatchAdd();
	  wireManageMatchDelete();
	  initBulkUpload();
	}

	if (isCasualPlayer) {
	  wireCasualPlayerMatchCreate();
	}
  initGroupInitialisationTool();
}

function isPlayerInTournament(playerId, matches = []) {
  if (!playerId || !Array.isArray(matches)) return false;

  return matches.some(m =>
    m.player1?.id === playerId ||
    m.player2?.id === playerId
  );
}

function wireCasualPlayerMatchCreate() {
  const input = document.getElementById("pm-opponent");
  const sug   = document.getElementById("pm-opponent-suggestions");
  const btn   = document.getElementById("pm-create-btn");
  const err   = document.getElementById("pm-error");

  if (!input || !btn) return;

  attachPlayerAutocomplete(input, sug, () => window.tournamentPlayers || []);

  btn.addEventListener("click", async () => {
    err.style.display = "none";

    const opponentId = input.dataset.playerId;
    const myId = window.auth.players[0];

    if (!opponentId || opponentId === myId) {
      err.textContent = "Please select a valid opponent.";
      err.style.display = "block";
      return;
    }

    const { error } = await window.supabaseClient
      .from("matches")
      .insert({
        tournament_id: window.currentTournament.id,
        edition_id: window.tournamentContext.editionId,
		group_id: groupId,
        stage_id: window.tournamentContext.stageId,
        player1_id: myId,
        player2_id: opponentId,
        status: "scheduled"
      });

    if (error) {
      err.textContent = "Failed to create match.";
      err.style.display = "block";
      return;
    }

    loadTournamentMatchesManage(window.currentTournament.id);
  });
}

function renderTournamentMatchesTable(matches = []) {
  const el = document.getElementById("tm-existing");
  if (!el) return;

  if (!Array.isArray(matches) || matches.length === 0) {
    el.innerHTML =
      `<div class="empty-message">No matches yet.</div>`;
    return;
  }

  el.innerHTML = matches.map(/* existing row HTML */).join("");
 
}

// =======================================================
// 16a. SETS EDITOR
// =======================================================

function openStageSetEditor() {
  const stageId = window.tournamentContext.stageId;
  const bracketId = window.tournamentContext.selectedBracketId;

  if (!stageId && !bracketId) return;

  const target = bracketId
    ? { type: "bracket", id: bracketId }
    : { type: "stage", id: stageId };

  // Remove any existing overlay
  document.querySelector(".overlay-backdrop")?.remove();

  // Create backdrop
  const backdrop = document.createElement("div");
  backdrop.className = "overlay-backdrop";

  backdrop.innerHTML = `
    <div class="overlay-card">
      <button class="overlay-close" id="bulk-set-close">✕</button>

	<h3>Edit all sets</h3>

	<div class="card" style="margin-bottom:10px;">
	  <div class="section-title">Bulk set import</div>

	  <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
		<label>
		  Number of sets
		  <input
			type="number"
			id="bulk-set-count"
			class="form-input"
			min="1"
			max="99"
			step="1"
			value="5"
			style="width:90px;"
		  />
		</label>

		<label style="display:flex; gap:6px; align-items:center; align-self:flex-end;">
		  <input type="checkbox" id="bulk-set-enable-editing" />
		  Enable manual editing
		</label>

		<label style="flex:1;">
		  CSV input
		  <textarea
			id="bulk-set-csv"
			class="form-input form-textarea"
			rows="3"
			placeholder="Paste CSV here"
		  ></textarea>
		</label>

		<div style="align-self:flex-end;">
		  <button class="header-btn secondary" id="bulk-set-parse">
			Parse CSV
		  </button>
		</div>
	  </div>

	  <div id="bulk-set-errors" class="error" style="margin-top:6px;"></div>
	</div>

	<div id="bulk-set-grid">Loading…</div>

      <div class="modal-actions">
        <button id="bulk-set-cancel">Cancel</button>
        <button id="bulk-set-save" disabled>Save results</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  // Close handlers
  document
    .getElementById("bulk-set-close")
    .addEventListener("click", () => backdrop.remove());

  document
    .getElementById("bulk-set-cancel")
    .addEventListener("click", () => backdrop.remove());

  // Load data
  loadMatchesAndSetsForBulkEditor(target);
  
	document
	  .getElementById("bulk-set-count")
	  .addEventListener("change", e => {
		const count = Number(e.target.value);
		const errorEl = document.getElementById("bulk-set-errors");

		if (!Number.isInteger(count) || count < 1 || count > 99) {
		  if (errorEl) {
			errorEl.textContent =
			  "Number of sets must be a whole number between 1 and 99.";
		  }
		  return;
		}

		if (errorEl) errorEl.textContent = "";

		stageGridModel.maxSetCount = count;
		rebuildGridSetColumns();
	  });

	document
	  .getElementById("bulk-set-parse")
	  .addEventListener("click", parseBulkSetCsv);
	  
	  document
    .getElementById("bulk-set-save")
    .addEventListener("click", saveBulkSets);
}

function rebuildGridSetColumns() {
  Object.values(stageGridModel.matches).forEach(match => {
    match.player1.sets.length = stageGridModel.maxSetCount;
    match.player2.sets.length = stageGridModel.maxSetCount;

    for (let i = 0; i < stageGridModel.maxSetCount; i++) {
      if (!match.player1.sets[i]) match.player1.sets[i] = { value: null };
      if (!match.player2.sets[i]) match.player2.sets[i] = { value: null };
    }

    recalculateFss(match);
  });

  renderBulkSetGrid();
}

function parseBulkSetCsv() {
  const text = document.getElementById("bulk-set-csv").value.trim();
  const errorEl = document.getElementById("bulk-set-errors");
  errorEl.textContent = "";

  if (!text) {
    errorEl.textContent = "CSV is empty.";
    return;
  }

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    errorEl.textContent = "CSV must contain a header and at least one row.";
    return;
  }

  const header = lines[0].split(",").map(h => h.trim());
  if (header[0] !== "p1" || header[1] !== "p2") {
    errorEl.textContent = "CSV must start with columns: p1,p2";
    return;
  }

  // Determine set columns
  const setColumns = [];
  for (let i = 4; i < header.length; i += 2) {
    setColumns.push({
      p1: header[i],
      p2: header[i + 1]
    });
  }

  const stagedUpdates = [];

  for (let r = 1; r < lines.length; r++) {
    const cells = lines[r].split(",").map(c => c.trim());

    const p1Name = cells[0];
    const p2Name = cells[1];

    if (!p1Name || !p2Name) {
      errorEl.textContent = `Row ${r + 1}: Player names are required.`;
      return;
    }

    // Find matching grid match
    const match = Object.values(stageGridModel.matches).find(
      m =>
        m.player1.name === p1Name &&
        m.player2.name === p2Name
    );

    if (!match) {
      errorEl.textContent =
        `Row ${r + 1}: No match found for "${p1Name} v ${p2Name}".`;
      return;
    }
	
	match.dirty = true;

    const updates = {
      match,
      p1Sets: [],
      p2Sets: []
    };

    setColumns.forEach((_, i) => {
		const rawP1 = cells[4 + i * 2];
		const rawP2 = cells[5 + i * 2];

		const p1Val = rawP1 === "" ? null : Number(rawP1);
		const p2Val = rawP2 === "" ? null : Number(rawP2);

		if (p1Val === null && p2Val === null) {
		  updates.p1Sets.push(null);
		  updates.p2Sets.push(null);
		  return;
		}

      if (p1Val === 50 && p2Val === 50) {
        errorEl.textContent =
          `Row ${r + 1}: 50–50 is not allowed.`;
        return;
      }

      updates.p1Sets.push(Number.isNaN(p1Val) ? null : p1Val);
      updates.p2Sets.push(Number.isNaN(p2Val) ? null : p2Val);
    });

    stagedUpdates.push(updates);
  }

  // If CSV needs more sets, expand grid
  const requiredSets = Math.max(
    stageGridModel.maxSetCount,
    ...stagedUpdates.map(u => u.p1Sets.length)
  );

  stageGridModel.maxSetCount = requiredSets;
  rebuildGridSetColumns();

  // Apply updates
  stagedUpdates.forEach(u => {
    for (let i = 0; i < requiredSets; i++) {
      u.match.player1.sets[i].value = u.p1Sets[i] ?? null;
      u.match.player2.sets[i].value = u.p2Sets[i] ?? null;
    }
    recalculateFss(u.match);
  });

  renderBulkSetGrid();
  
	const hasAnyData = Object.values(stageGridModel.matches)
	.some(matchHasAnySet);

	document.getElementById("bulk-set-save").disabled = !hasAnyData;

}

async function loadMatchesAndSetsForBulkEditor(target) {
  if (!target?.id) return;

  if (target.type === "stage") {
    return loadStageMatchesAndSets(target.id);
  }

  if (target.type === "bracket") {
    return loadBracketMatchesAndSets(target.id);
  }
}

async function loadStageMatchesAndSets(stageId) {
	  console.log("LOAD STAGE SETS", stageId);
  const gridEl = document.getElementById("bulk-set-grid");
  gridEl.textContent = "Loading…";

  const { data: matches, error: matchError } = await window.supabaseClient
    .from("matches")
    .select(`
      id,
      player1:player1_id ( id, name ),
      player2:player2_id ( id, name )
    `)
    .eq("stage_id", stageId)
	.neq("status", "structure")
    .order("match_date");

  if (matchError) {
    gridEl.textContent = "Failed to load matches";
    return;
  }

  const matchIds = matches.map(m => m.id);

  const { data: sets } = await window.supabaseClient
    .from("sets")
    .select("*")
    .in("match_id", matchIds);

  buildGridModel(matches, sets);
}

async function loadBracketMatchesAndSets(bracketId) {
  console.log("LOAD BRACKET SETS", bracketId);

  const gridEl = document.getElementById("bulk-set-grid");
  gridEl.textContent = "Loading…";

  const bracketStageIds = (window.currentStages || [])
    .filter(s =>
      s.stage_type === "knockout" &&
      s.bracket_id === bracketId
    )
    .map(s => s.id);

  if (!bracketStageIds.length) {
    gridEl.innerHTML = `
      <div class="empty-message">
        No knockout stages found for this bracket.
      </div>
    `;
    return;
  }

  const { data: matches, error: matchError } = await window.supabaseClient
    .from("matches")
    .select(`
      id,
      match_date,
      status,
      bracket_meta,
      stage_id,
      player1:player1_id ( id, name ),
      player2:player2_id ( id, name ),
      team1:team1_id ( id, name ),
      team2:team2_id ( id, name )
    `)
    .in("stage_id", bracketStageIds)
    .neq("status", "structure");

  if (matchError) {
    console.error(matchError);
    gridEl.textContent = "Failed to load bracket matches";
    return;
  }

  const orderedMatches = (matches || []).slice().sort((a, b) => {
    const ar = Number(a.bracket_meta?.round_index ?? a.bracket_meta?.round ?? 0);
    const br = Number(b.bracket_meta?.round_index ?? b.bracket_meta?.round ?? 0);
    if (ar !== br) return ar - br;

    const ao = Number(a.bracket_meta?.slot_index ?? a.bracket_meta?.order ?? 0);
    const bo = Number(b.bracket_meta?.slot_index ?? b.bracket_meta?.order ?? 0);
    if (ao !== bo) return ao - bo;

    return new Date(a.match_date || 0) - new Date(b.match_date || 0);
  });

  const matchIds = orderedMatches.map(m => m.id);

  const { data: sets, error: setsError } = await window.supabaseClient
    .from("sets")
    .select("*")
    .in("match_id", matchIds);

  if (setsError) {
    console.error(setsError);
    gridEl.textContent = "Failed to load sets";
    return;
  }

  buildGridModel(orderedMatches, sets || []);
}

let stageGridModel = null;

function buildGridModel(matches, sets) {
  stageGridModel = {
    matches: {},
    maxSetCount: 1
  };

  const setsByMatch = {};
  (sets || []).forEach(s => {
    if (!setsByMatch[s.match_id]) {
      setsByMatch[s.match_id] = [];
    }
    setsByMatch[s.match_id].push(s);
    stageGridModel.maxSetCount = Math.max(
      stageGridModel.maxSetCount,
      s.set_number
    );
  });

	matches.forEach(m => {
	  if (!m.player1 || !m.player2) return;

	  stageGridModel.matches[m.id] = {
		matchId: m.id,

		// ADD THESE TWO LINES
		player1_id: m.player1.id,
		player2_id: m.player2.id,

		player1: {
		  name: m.player1.name,
		  sets: []
		},
		player2: {
		  name: m.player2.name,
		  sets: []
		},
		derivedFss: { p1: 0, p2: 0 }
	  };
	});

  Object.values(stageGridModel.matches).forEach(match => {
    for (let i = 0; i < stageGridModel.maxSetCount; i++) {
      match.player1.sets[i] = { value: null };
      match.player2.sets[i] = { value: null };
    }
  });

  (sets || []).forEach(s => {
    const match = stageGridModel.matches[s.match_id];
    if (!match) return;

    const i = s.set_number - 1;
    match.player1.sets[i].value = s.score_player1;
    match.player2.sets[i].value = s.score_player2;
  });

  Object.values(stageGridModel.matches).forEach(recalculateFss);

  renderBulkSetGrid();
}

function determineSetWinner(p1, p2, match) {
  if (p1 === 50 && p2 <= 49) return match.player1_id;
  if (p2 === 50 && p1 <= 49) return match.player2_id;
  return null;
}

function recalculateFss(match) {
  match.derivedFss = { p1: 0, p2: 0 };

  match.player1.sets.forEach((_, i) => {
    const p1 = match.player1.sets[i].value;
    const p2 = match.player2.sets[i].value;

    if (p1 === 50 && p2 <= 49) match.derivedFss.p1++;
    if (p2 === 50 && p1 <= 49) match.derivedFss.p2++;
  });
}

function extractValidSets(match) {
  const sets = [];

  match.player1.sets.forEach((_, i) => {
    const p1 = match.player1.sets[i].value;
    const p2 = match.player2.sets[i].value;

    if (p1 == null && p2 == null) return;

    let winnerId = null;

    // EXACT rule: one side must hit 50, other ≤ 49
    if (p1 === 50 && p2 <= 49) {
      winnerId = match.player1_id;
    } else if (p2 === 50 && p1 <= 49) {
      winnerId = match.player2_id;
    }

    sets.push({
      set_number: i + 1,
      score_player1: p1,
      score_player2: p2,
      winner_player_id: winnerId
    });
  });

  return sets;
}

function wireBulkSetEditingToggle() {
  const toggle = document.getElementById("bulk-set-enable-editing");
  if (!toggle) return;

  const sync = () => {
    document
      .querySelectorAll(".bulk-set-input")
      .forEach(input => {
        input.disabled = !toggle.checked;
      });
  };

  toggle.addEventListener("change", sync);
  sync();
}

function wireBulkSetInputHandlers() {
  document
    .querySelectorAll(".bulk-set-input")
    .forEach(input => {
      input.addEventListener("input", () => {
        const editingEnabled =
          document.getElementById("bulk-set-enable-editing")?.checked === true;

        if (!editingEnabled) return;

        const match = stageGridModel.matches[input.dataset.matchId];
        if (!match) return;

        const side = input.dataset.side;
        const idx = Number(input.dataset.setIndex);

        const raw = input.value.trim();
        const value = raw === "" ? null : Number(raw);

        if (raw !== "" && Number.isNaN(value)) return;

        match[side === "p1" ? "player1" : "player2"].sets[idx].value = value;
        match.dirty = true;

        recalculateFss(match);
        renderBulkSetGrid();

        const saveBtn = document.getElementById("bulk-set-save");
        if (saveBtn) {
          saveBtn.disabled = !Object.values(stageGridModel.matches).some(matchHasAnySet);
        }
      });
    });
}

function renderBulkSetGrid() {
  const gridEl = document.getElementById("bulk-set-grid");
  gridEl.innerHTML = "";

  Object.values(stageGridModel.matches).forEach(match => {
    const block = document.createElement("div");
    block.style.borderBottom = "1px solid #ccc";
    block.style.padding = "6px 0";
	
	if (matchHasAnySet(match)) {
	block.style.background = "rgba(62, 166, 255, 0.06)";
	}


    block.innerHTML = `
      <div style="display:flex; gap:6px;">
        ${renderPlayerRow(match.player1, match, "p1")}
      </div>
      <div style="display:flex; gap:6px;">
        ${renderPlayerRow(match.player2, match, "p2")}
      </div>
    `;

    gridEl.appendChild(block);
  });
	const saveBtn = document.getElementById("bulk-set-save");
	if (saveBtn) {
	  saveBtn.disabled = !Object.values(stageGridModel.matches).some(match =>
		extractValidSets(match).length > 0
	  );
	}
	
	wireBulkSetInputHandlers();
	wireBulkSetEditingToggle();
}

async function saveBulkSets() {
  const saveBtn = document.getElementById("bulk-set-save");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  try {
    for (const match of Object.values(stageGridModel.matches)) {
      const validSets = extractValidSets(match);
      if (validSets.length === 0) continue;

      // 🚨 SAFETY CHECK
      // Prevent destructive overwrite of live-scored matches
      const { data: existingThrows, error: throwCheckErr } =
        await window.supabaseClient
          .from("throws")
          .select("id")
          .eq("match_id", match.matchId)
          .limit(1);

      if (throwCheckErr) {
        throw throwCheckErr;
      }

      if (existingThrows?.length) {
        throw new Error(
          `Blocked: ${match.player1.name} v ${match.player2.name} has throw history. Bulk set save would delete throws.`
        );
      }

      // 1️⃣ delete existing sets
      await window.supabaseClient
        .from("sets")
        .delete()
        .eq("match_id", match.matchId);

      // 2️⃣ insert new sets
      const rows = validSets.map(s => ({
        match_id: match.matchId,
        set_number: s.set_number,
        score_player1: s.score_player1,
        score_player2: s.score_player2,
        winner_player_id: s.winner_player_id
      }));

      await window.supabaseClient
        .from("sets")
        .insert(rows);

      // 3️⃣ update match summary
      await window.supabaseClient
        .from("matches")
        .update({
          status: "finished",
          final_sets_player1: match.derivedFss.p1,
          final_sets_player2: match.derivedFss.p2
        })
        .eq("id", match.matchId);
		
		if (typeof propagateKoWinner === "function") {
		  await propagateKoWinner(match.matchId);
		}
    }

    alert("Sets saved successfully");

    loadTournamentOverview(window.currentTournamentId);

  } catch (err) {
    console.error(err);
    alert(err.message || "Failed to save sets. See console.");

  } finally {
    saveBtn.textContent = "Save results";
    saveBtn.disabled = false;
  }
}

function renderPlayerRow(player, match, side) {
  return `
    <div style="width:140px;">${player.name}</div>
    <div style="width:40px; text-align:center;">
      ${match.derivedFss[side]}
    </div>
    ${player.sets.map((set, i) => `
      <input
        type="number"
        class="bulk-set-input"
        data-match-id="${match.matchId}"
        data-side="${side}"
        data-set-index="${i}"
        value="${set.value ?? ""}"
        disabled
        style="width:44px;"
      />
    `).join("")}
  `;
}

function matchHasAnySet(match) {
  return match.player1.sets.some((s, i) => {
    const p1 = s.value;
    const p2 = match.player2.sets[i]?.value;

    return (
      p1 !== null ||
      p2 !== null
    );
  });
}

async function ensureAllPlayersLoaded() {
  if (Array.isArray(window.allPlayers) && window.allPlayers.length) {
    return;
  }

  const { data, error } = await window.supabaseClient
    .from("players")
    .select("id, name")
    .order("name");

  if (error) {
    console.error("Failed to load players", error);
    window.allPlayers = [];
    return;
  }

  window.allPlayers = data || [];
}

function wireManageMatchAdd() {
	const p1Input = document.getElementById("mm-p1");
	const p2Input = document.getElementById("mm-p2");
	const dateInput = document.getElementById("mm-date");
	const p1Sug = document.getElementById("mm-p1-suggestions");
	const p2Sug = document.getElementById("mm-p2-suggestions");
	const btn = document.getElementById("mm-add-btn");
	const addSetsBtn = document.getElementById("mm-add-sets-btn");
	const err = document.getElementById("mm-error");
	const statusInput = document.getElementById("mm-status");
	const s1Input = document.getElementById("mm-s1");
	const s2Input = document.getElementById("mm-s2");


  if (!btn || !p1Input || !p2Input || !dateInput || !err) return;

	const isFriendlies =
	  typeof FRIENDLIES_TOURNAMENT_ID !== "undefined" &&
	  window.currentTournamentId === FRIENDLIES_TOURNAMENT_ID;
	  
	if (!window.allPlayers) {
	  window.allPlayers = [];
	}
	
	const editionId = window.tournamentContext?.editionId;

	const edition = window.currentEditions
	  ?.find(e => e.id === editionId);
	
	const isTeamTournament =
		Number(edition?.min_team_size) > 1;

	// Use tournament players OR all players (friendlies)
	  	const competitors = isTeamTournament
	  ? window.currentTeams
	  : (isFriendlies ? window.allPlayers : window.tournamentPlayers);

	  console.log("[match add] friendlies:", isFriendlies, {
	  allPlayers: window.allPlayers?.length,
	  tournamentPlayers: window.tournamentPlayers?.length
	});

  function showErr(msg) {
    if (!err) return;
    if (!msg) {
      err.style.display = "none";
      err.textContent = "";
    } else {
      err.style.display = "block";
      err.textContent = msg;
    }
  }

  function buildSuggestions(inputEl, sugEl) {
    if (!inputEl || !sugEl) return;
    const q = inputEl.value.trim().toLowerCase();
    sugEl.innerHTML = "";
    if (!q.length) return;

	const matches = competitors.filter((c) =>
	  (c.name || "").toLowerCase().includes(q)
	);
	
    matches.slice(0, 5).forEach((p) => {
      const div = document.createElement("div");
      div.className = "friendly-suggestion-item";
      div.textContent = p.name;
      div.dataset.playerId = p.id;
      div.addEventListener("click", () => {
        inputEl.value = p.name;
        inputEl.dataset.playerId = p.id;
        sugEl.innerHTML = "";
      });
      sugEl.appendChild(div);
    });
  }

  function findPlayerIdByInput(inputEl) {
    if (!inputEl) return null;

    if (inputEl.dataset.playerId) {
      return inputEl.dataset.playerId;
    }

    const name = (inputEl.value || "").trim().toLowerCase();
    if (!name) return null;

	const found = competitors.find(
	  (c) => (c.name || "").toLowerCase() === name
	);
    return found ? found.id : null;
  }

  p1Input.addEventListener("input", () =>
    buildSuggestions(p1Input, p1Sug)
  );
  p2Input.addEventListener("input", () =>
    buildSuggestions(p2Input, p2Sug)
  );

btn.addEventListener("click", async () => {
  showErr("");

  const p1Id = findPlayerIdByInput(p1Input);
  const p2Id = findPlayerIdByInput(p2Input);
  const dateISO = dateInput.value;

  if (!p1Id || !p2Id) {
    showErr(
	  isTeamTournament
		? "Please select two valid teams"
		: "Please select two valid players"
	);
    return;
  }

  if (!dateISO) {
    showErr("Please select a date");
    return;
  }

  try {
    const statusVal = statusInput?.value || "scheduled";
    const s1Val = Number(s1Input?.value || 0);
    const s2Val = Number(s2Input?.value || 0);
	
	const groupId =
	document.getElementById("add-match-group")?.value || null;

    const { error } = await window.supabaseClient.from("matches").insert({
      tournament_id: window.currentTournamentId,
      edition_id: window.tournamentContext.editionId,
      stage_id: window.tournamentContext.stageId,
	  group_id: groupId,
	  ...(isTeamTournament
	  ? { team1_id: p1Id, team2_id: p2Id }
	  : { player1_id: p1Id, player2_id: p2Id }),
      match_date: dateISO,
      status: statusVal,
      final_sets_player1: s1Val,
      final_sets_player2: s2Val
    });

    if (error) {
      console.error(error);
      showErr("Failed to create match");
      return;
    }

    // Clear form
    p1Input.value = "";
    p2Input.value = "";
    dateInput.value = "";
    if (statusInput) statusInput.value = "scheduled";
    if (s1Input) s1Input.value = "";
    if (s2Input) s2Input.value = "";

    loadTournamentMatchesManage(window.currentTournamentId);

  } catch (err) {
    console.error(err);
    showErr("Unexpected error creating match");
  }
});

	if (addSetsBtn) {
  addSetsBtn.addEventListener("click", async () => {
    showErr("");

    const p1Id = findPlayerIdByInput(p1Input);
    const p2Id = findPlayerIdByInput(p2Input);
    const dateISO = dateInput.value;
	
	const groupId =
	document.getElementById("add-match-group")?.value || null;

    if (!p1Id || !p2Id) {
      showErr("Please select two valid players");
      return;
    }

    if (!dateISO) {
      showErr("Please select a date");
      return;
    }

    try {
		  const statusVal = statusInput?.value || "scheduled";
		  const s1Val = Number(s1Input?.value || 0);
		  const s2Val = Number(s2Input?.value || 0);

		  const { data, error } = await window.supabaseClient
			.from("matches")
			.insert({
			  tournament_id: window.currentTournamentId,
			  edition_id: window.tournamentContext.editionId,
			  stage_id: window.tournamentContext.stageId,
			  ...(isTeamTournament
			  ? { team1_id: p1Id, team2_id: p2Id }
			  : { player1_id: p1Id, player2_id: p2Id }),
			  match_date: dateISO,
			  status: statusVal,
			  final_sets_player1: s1Val,
			  final_sets_player2: s2Val
			})
			.select("id")
			.single();

			if (error || !data) {
			  console.error(error);
			  showErr("Failed to create match");
			  return;
			}

			// Go straight to set entry screen

			window.tournamentContext.activeOverviewTab = null;
			window.tournamentContext.defaultTab = null;

			const tid = window.tournamentContext.tournamentId;

			window.location.hash =
				`#/tournament/${tid}/match/${data.id}/sets`;

			} catch (err) {
			  console.error(err);
			  showErr("Unexpected error creating match");
			}
	  });
	}

}

function wireTournamentMatchForm() {
  const p1 = document.getElementById("tm-p1");
  const p2 = document.getElementById("tm-p2");
  const p1Sug = document.getElementById("tm-p1-suggestions");
  const p2Sug = document.getElementById("tm-p2-suggestions");
  const date = document.getElementById("tm-date");
  const s1 = document.getElementById("tm-s1");
  const s2 = document.getElementById("tm-s2");
  const status = document.getElementById("tm-status");
  const btn = document.getElementById("tm-save");
  const err = document.getElementById("tm-error");

  const players = window.tournamentPlayers || [];

  function showErr(msg) {
    err.style.display = msg ? "block" : "none";
    err.textContent = msg || "";
  }

  function suggest(input, box) {
    box.innerHTML = "";
    const q = input.value.toLowerCase();
    if (!q) return;

    players
      .filter(p => p.name.toLowerCase().includes(q))
      .slice(0,5)
      .forEach(p => {
        const d = document.createElement("div");
        d.className = "friendly-suggestion-item";
        d.textContent = p.name;
        d.onclick = () => {
          input.value = p.name;
          input.dataset.id = p.id;
          box.innerHTML = "";
        };
        box.appendChild(d);
      });
  }

  p1.oninput = () => suggest(p1, p1Sug);
  p2.oninput = () => suggest(p2, p2Sug);

  btn.onclick = async () => {
    showErr("");

    if (!p1.dataset.id || !p2.dataset.id) {
      showErr("Both players must be selected from the list.");
      return;
    }

    const payload = {
      tournament_id: window.currentTournamentId,
      edition_id: window.tournamentContext.editionId,
      stage_id: window.tournamentContext.stageId,
      player1_id: p1.dataset.id,
      player2_id: p2.dataset.id,
      match_date: date.value
        ? new Date(date.value).toISOString()
        : null,
      final_sets_player1: s1.value || 0,
      final_sets_player2: s2.value || 0,
      status: status.value
    };

    const { error } = await window.supabaseClient.from("matches").insert(payload);

    if (error) {
      console.error(error);
      showErr("Failed to create match.");
      return;
    }

    await renderTournamentMatchesTable();
    p1.value = p2.value = "";
    p1.dataset.id = p2.dataset.id = "";
    s1.value = s2.value = "";
  };
}

function initBulkUpload() {
	const tournamentId = window.currentTournamentId;
	const toggle = document.getElementById("bulk-toggle");
	const body   = document.getElementById("bulk-body");
	
	  if (!toggle || !body) {
		return;
	  }
	const chevron = toggle.querySelector(".bulk-chevron");

	toggle.addEventListener("click", () => {
	  const open = body.classList.toggle("hidden") === false;
	  chevron.textContent = open ? "▾" : "▸";
	});

	const editionSel = document.getElementById("bulk-edition");
	const stageSel   = document.getElementById("bulk-stage");

	const csvInput   = document.getElementById("bulk-csv-input");
	const csvFile    = document.getElementById("bulk-csv-file");

	const validateBtn = document.getElementById("bulk-validate-btn");
	const uploadBtn   = document.getElementById("bulk-upload-btn");

	const errorsEl   = document.getElementById("bulk-errors");
	const warningsEl = document.getElementById("bulk-warnings");
	const previewEl  = document.getElementById("bulk-preview");
	const sampleBtn  = document.getElementById("bulk-sample-btn");

  if (!toggle || !body) return;

  let lastValidationResult = null;
  let warningsConfirmed = false;

  // --------------------------------------------------
  // Populate edition + stage dropdowns
  // --------------------------------------------------
  // NOTE: these assume you already have edition / stage data
  // available globally or via existing helpers.
  // Adjust data source names if needed.

  function populateSelect(select, items, selectedId) {
    select.innerHTML = `<option value="">Select…</option>`;
    items.forEach(i => {
      const opt = document.createElement("option");
      opt.value = i.id;
      opt.textContent = i.name;
      if (i.id === selectedId) opt.selected = true;
      select.appendChild(opt);
    });
  }

	if (window.currentEditions) {
	  populateSelect(
		editionSel,
		window.currentEditions,
		window.tournamentContext?.editionId || null
	  );
	}

	if (window.currentStages) {
	  populateSelect(
		stageSel,
		window.currentStages,
		window.tournamentContext?.stageId || null
	  );
	}
  
  editionSel.addEventListener("change", () => {
  const edId = editionSel.value;
  if (!edId || !window.currentStages) return;

  const filtered = window.currentStages.filter(
    s => s.edition_id === edId
  );

  populateSelect(stageSel, filtered, null);
});

  // --------------------------------------------------
  // CSV file ↔ textarea syncing
  // --------------------------------------------------
  csvFile.addEventListener("change", () => {
    const file = csvFile.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = e => {
      csvInput.value = e.target.result || "";
      resetValidation();
    };
    reader.readAsText(file);
  });

  csvInput.addEventListener("input", () => {
    csvFile.value = "";
    resetValidation();
  });

  // --------------------------------------------------
  // Sample CSV download
  // --------------------------------------------------
  sampleBtn.addEventListener("click", () => {
    const sample =
`date,time,player1,player2,round
2025-06-14,14:30,Player One,Player Two,Group A
2025-06-14,15:15,Player Three,Player Four,Group A`;

    const blob = new Blob([sample], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "fixtures-sample.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // --------------------------------------------------
  // Validate & preview
  // --------------------------------------------------
	validateBtn.addEventListener("click", async () => {
	  resetMessages();

	  uploadBtn.disabled = true;
	  warningsConfirmed = false;

	  const csvText = csvInput.value.trim();
	  const edId = editionSel.value;
	  const stVal = stageSel.value;

	  if (!csvText || !edId || !stVal) {
		errorsEl.textContent = "Edition, stage or bracket, and CSV are required.";
		return;
	  }

	  let result;

	  // --------------------------------------------------
	  // BRACKET bulk upload
	  // --------------------------------------------------
	  if (stVal.startsWith("bracket:")) {
		const bracketId = stVal.replace("bracket:", "");

		result = await validateBulkBracketFixtures({
		  csvText,
		  tournamentId,
		  editionId: edId,
		  bracketId
		});

	  // --------------------------------------------------
	  // NORMAL stage bulk upload
	  // --------------------------------------------------
	  } else {
		result = await validateBulkFixtures({
		  csvText,
		  tournamentId,
		  editionId: edId,
		  stageId: stVal
		});
	  }

	  lastValidationResult = result;
	  warningsConfirmed = false;
	  uploadBtn.disabled = true;

	  if (!result.valid) {
		renderErrors(result.errors);
		return;
	  }

	  renderPreview(result.matches);

	  if (result.warnings.length) {
		renderWarnings(result.warnings);
	  } else {
		uploadBtn.disabled = true;
		uploadBtn.disabled = false;
	  }
	});


  // --------------------------------------------------
  // Upload (atomic)
  // --------------------------------------------------
  uploadBtn.addEventListener("click", async () => {
    if (!lastValidationResult || !lastValidationResult.valid) return;
	
	const rows = lastValidationResult.matches.map(m => ({
	  tournament_id: m.tournament_id,
	  edition_id: m.edition_id,
	  stage_id: m.stage_id,
	  group_id: m.group_id || null,
	  player1_id: m.player1_id,
	  player2_id: m.player2_id,
	  match_date: m.match_date || m.match_date_utc,
	  status: "scheduled",
	  final_sets_player1: 0,
	  final_sets_player2: 0,
	  bracket_meta: m.bracket_meta || null
	}));

    const { error } = await window.supabaseClient
      .from("matches")
      .insert(rows);

    if (error) {
      errorsEl.textContent = "Upload failed. Nothing was added.";
      return;
    }

    // Reset and refresh
    resetAll();
    body.classList.add("hidden");
    toggle.textContent = "▸ Bulk fixture upload";

    if (typeof reloadManageMatches === "function") {
      reloadManageMatches();
    }
  });

  // --------------------------------------------------
  // Helpers
  // --------------------------------------------------

  function resetMessages() {
    errorsEl.textContent = "";
    warningsEl.innerHTML = "";
    previewEl.innerHTML = "";
  }

  function resetValidation() {
    resetMessages();
    uploadBtn.disabled = true;
    lastValidationResult = null;
  }

  function resetAll() {
    csvInput.value = "";
    csvFile.value = "";
    resetValidation();
  }

  function renderErrors(errors) {
    errorsEl.innerHTML = errors
      .map(e => `Row ${e.row}: ${e.message}`)
      .join("<br>");
  }

	function renderWarnings(warnings) {
	  warningsEl.innerHTML = `
		<div class="warning-block">
		  ${warnings.map(w => `
			<div class="pill scheduled">
			  ⚠ Row ${w.row ?? "?"}: ${w.message}
			</div>
		  `).join("")}
		</div>
		<label style="display:block;margin-top:8px;">
		  <input type="checkbox" id="bulk-confirm-warn">
		  I understand and want to upload anyway
		</label>
	  `;

	  document
		.getElementById("bulk-confirm-warn")
		.addEventListener("change", e => {
		  warningsConfirmed = e.target.checked;
		  uploadBtn.disabled = !warningsConfirmed;
		});
	}

  function renderPreview(matches) {
    previewEl.innerHTML = `
      <table class="simple-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Time</th>
            <th>Player 1</th>
            <th>Player 2</th>
            <th>Group / Round</th>
          </tr>
        </thead>
        <tbody>
          ${matches.map(m => `
            <tr class="${m.isDuplicate ? "row-warning" : ""}">
              <td>${new Date(m.match_date).toLocaleDateString()}</td>
              <td>${new Date(m.match_date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
              <td>${m.player1_name}</td>
              <td>${m.player2_name}</td>
              <td>
			  ${
				m.group_id
				  ? `<span class="pill live">${m.group_name || "Group"}</span>`
				  : `<span class="pill scheduled">Round: ${m.round_label}</span>`
			  }
			</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }
}

function renderTournamentInitialisation({
  tournament,
  editionId,
  stageId,
  container
}) {
	console.log("RENDER INITIALISATION CALLED");
  if (!container) return;

  container.innerHTML = `
    <div class="card">
      <div class="section-title">Group initialisation</div>

      <div class="set-main-row bulk-header" id="init-toggle">
        <div class="col left">Initialise group players</div>
        <div class="col mid"></div>
        <div class="col right init-chevron">▸</div>
      </div>

      <div class="set-throws-expanded hidden" id="init-body">

        <div class="bulk-row">
          <label>
            Group
            <select id="init-group"></select>
          </label>
        </div>

        <label>
          Players (one per line; optional “,GB”)
          <textarea
            id="init-players"
            class="form-input form-textarea"
            rows="6"
            placeholder="Dummy One\nDummy Two,GB\nDummy Three,FI"
          ></textarea>
        </label>

        <div class="form-row-inline">
          <button class="header-btn" id="init-add-btn">Add to group</button>
        </div>

        <div id="init-error" class="error"></div>
        <div id="init-result" class="subtitle"></div>

      </div>
    </div>
  `;

  // now wire behaviour
  initGroupInitialisationTool();
}


async function initGroupInitialisationTool() {
  const toggle = document.getElementById("init-toggle");
  const body = document.getElementById("init-body");
  if (!toggle || !body) return;

  const chevron = toggle.querySelector(".init-chevron");
  const groupSel = document.getElementById("init-group");
  const playersTa = document.getElementById("init-players");
  const addBtn = document.getElementById("init-add-btn");
  const errEl = document.getElementById("init-error");
  const resEl = document.getElementById("init-result");

  function setErr(msg) {
    if (!errEl) return;
    errEl.textContent = msg || "";
  }
  function setRes(msg) {
    if (!resEl) return;
    resEl.textContent = msg || "";
  }

  toggle.addEventListener("click", () => {
    const open = body.classList.toggle("hidden") === false;
    if (chevron) chevron.textContent = open ? "▾" : "▸";
  });

  // Load groups for current stage
  const stageId = window.tournamentContext?.stageId;
  if (!stageId || !groupSel) {
    setErr("Select an edition and stage first.");
    return;
  }

  const { data: groups, error: gErr } = await window.supabaseClient
    .from("groups")
    .select("id, name")
    .eq("stage_id", stageId)
    .order("name");

  if (gErr) {
    console.error(gErr);
    setErr("Failed to load groups.");
    return;
  }

  groupSel.innerHTML = `<option value="">Select…</option>` + (groups || [])
    .map(g => `<option value="${g.id}">${g.name}</option>`)
    .join("");
	
	groupSel.addEventListener("change", async () => {
	  const groupId = groupSel.value;
	  playersTa.value = "";
	  if (!groupId) return;

	  const { data, error } = await window.supabaseClient
		.from("matches")
		.select(`
		  id,
		  player1:player1_id ( name, country )
		`)
		.eq("status", "structure")
		.eq("stage_id", stageId)
		.eq("group_id", groupId)
		.order("player1(name)");

	  if (error) {
		console.error(error);
		setErr("Failed to load group players.");
		return;
	  }

	  const lines = (data || []).map(r => {
		const name = r.player1?.name;
		const country = r.player1?.country;
		return country ? `${name},${country}` : name;
	  });

	  playersTa.value = lines.join("\n");
	});


  if (!addBtn) return;

  addBtn.addEventListener("click", async () => {
    setErr("");
    setRes("");

    const groupId = groupSel.value;
    if (!groupId) {
      setErr("Group is required.");
      return;
    }

    const text = (playersTa?.value || "").trim();
    if (!text) {
      setErr("Enter at least one player.");
      return;
    }

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    setRes("Adding players…");

    const result = await syncGroupInitialisation({
	  tournamentId: window.currentTournamentId,
	  editionId: window.tournamentContext.editionId,
	  stageId: window.tournamentContext.stageId,
	  groupId,
	  lines
	});

	setRes(
	  `Added ${result.added}, removed ${result.removed}, unchanged ${result.skipped}` +
	  (result.errors.length ? `, errors ${result.errors.length}` : "")
	);

    // Refresh overview so standings picks up seeded players immediately
    loadTournamentOverview(window.currentTournamentId);
  });
}

async function syncGroupInitialisation({
  tournamentId,
  editionId,
  stageId,
  groupId,
  lines
}) {
	const edition = window.currentEditions
		?.find(e => e.id === editionId);
	
	const isTeamTournament =
		Number(edition?.min_team_size) > 1;
  
  const out = { added: 0, removed: 0, skipped: 0, errors: [] };

  const desired = lines
    .map(raw => {
      const [name, country] = raw.split(",").map(s => s.trim());
      return { name, country: country || null };
    })
    .filter(p => p.name);

	const { data: existing, error } = await window.supabaseClient
	  .from("matches")
	  .select(
		isTeamTournament
		  ? `
			  id,
			  team1_id,
			  team1:team1_id ( name )
			`
		  : `
			  id,
			  player1_id,
			  player1:player1_id ( name )
			`
	  )
    .eq("status", "structure")
    .eq("stage_id", stageId)
    .eq("group_id", groupId);

  if (error) throw error;

	const existingByName = new Map(
	  (existing || []).map(r => [
		(isTeamTournament
		  ? r.team1?.name
		  : r.player1?.name
		)?.toLowerCase(),
		r
	  ])
	);

  const desiredNames = new Set(desired.map(p => p.name.toLowerCase()));

  // Remove
  for (const [name, row] of existingByName) {
    if (!desiredNames.has(name)) {
      await window.supabaseClient.from("matches").delete().eq("id", row.id);
      out.removed++;
    }
  }

  // Add
  for (const p of desired) {
    if (existingByName.has(p.name.toLowerCase())) {
      out.skipped++;
      continue;
    }

    try {
		let competitorRow;

		if (isTeamTournament) {
		  const { data } = await window.supabaseClient
			.from("teams")
			.select("id")
			.eq("name", p.name)
			.maybeSingle();

		  if (!data) {
			throw new Error(`Team not found: ${p.name}`);
		  }

		  competitorRow = data;
		} else {
		  let { data } = await window.supabaseClient
			.from("players")
			.select("id")
			.eq("name", p.name)
			.maybeSingle();

		  if (!data) {
			const created = await window.supabaseClient
			  .from("players")
			  .insert({
				name: p.name,
				country: p.country,
				is_guest: false
			  })
			  .select("id")
			  .single();

			data = created.data;
		  }

		  competitorRow = data;
		}

	const matchPayload = {
	  tournament_id: tournamentId,
	  edition_id: editionId,
	  stage_id: stageId,
	  group_id: groupId,
	  status: "structure",
	  match_date: new Date().toISOString(),
	  final_sets_player1: 0,
	  final_sets_player2: 0
	};

	if (isTeamTournament) {
	  matchPayload.team1_id = competitorRow.id;
	  matchPayload.team2_id = null;
	} else {
	  matchPayload.player1_id = competitorRow.id;
	  matchPayload.player2_id = null;
	}

	await window.supabaseClient
	  .from("matches")
	  .insert(matchPayload);

      out.added++;
    } catch (err) {
      console.error(err);
      out.errors.push(p.name);
    }
  }

  return out;
}

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function renderKnockoutInitialisation({
  tournamentId,
  editionId,
  sourceStageId,
  container
}) {
  if (!container) return;

  container.insertAdjacentHTML("beforeend", `
    <div class="card" style="margin-top:12px;">
      <div class="section-title">Knockout initialisation</div>

      <div class="set-main-row bulk-header" id="ko-init-toggle">
        <div class="col left">Set bracket slots from group positions</div>
        <div class="col mid"></div>
        <div class="col right init-chevron">▸</div>
      </div>

      <div class="set-throws-expanded hidden" id="ko-init-body">
        <div class="bulk-row">
          <label>
            Target knockout stage
            <select id="ko-init-target-stage"></select>
          </label>
        </div>

		<div class="bulk-row" id="ko-bracket-row" style="gap:12px; display:flex; flex-wrap:wrap;">
		  <label>
			Bracket size
			<select id="ko-init-bracket-size"></select>
		  </label>

		  <label>
			Round date
			<input type="date" id="ko-init-date" class="form-input" />
		  </label>

		  <label>
			First match time
			<input type="time" id="ko-init-time" class="form-input" />
		  </label>

		  <label>
			Match interval (mins)
			<input type="number" id="ko-init-interval" class="form-input" min="0" step="1" value="0" />
		  </label>
		</div>

		<div id="ko-init-form"></div>

		<div class="form-row-inline" style="gap:8px; margin-top:10px; flex-wrap:wrap;">
		  <button class="header-btn" id="ko-init-create">Initialise bracket</button>
		  <button class="header-btn" id="ko-init-finalise">Finalise advancement</button>
		  <button class="header-btn" id="ko-init-reset">Reset stage</button>

		  <label style="display:flex; align-items:center; gap:6px; margin-left:8px;">
			<input type="checkbox" id="ko-init-clear-mapping" />
			Clear mapping on reset
		  </label>
		</div>

		<div id="ko-finalise-wrap" style="margin-top:12px;"></div>

        <div id="ko-init-error" class="error"></div>
        <div id="ko-init-result" class="subtitle"></div>
      </div>
    </div>
  `);

  initKnockoutInitialisationTool({ tournamentId, editionId, sourceStageId });
}

async function initKnockoutInitialisationTool({
  tournamentId,
  editionId,
  sourceStageId
}) {
  const toggle = document.getElementById("ko-init-toggle");
  const body = document.getElementById("ko-init-body");
  const chevron = toggle?.querySelector(".init-chevron");

  const targetSel = document.getElementById("ko-init-target-stage");
  const formEl = document.getElementById("ko-init-form");

	const createBtn = document.getElementById("ko-init-create");
	const finaliseBtn = document.getElementById("ko-init-finalise");
	const finaliseWrap = document.getElementById("ko-finalise-wrap");
	const resetBtn = document.getElementById("ko-init-reset");
	const clearMappingCb = document.getElementById("ko-init-clear-mapping");
	
	const bracketSel = document.getElementById("ko-init-bracket-size");
	const dateInput = document.getElementById("ko-init-date");
	const timeInput = document.getElementById("ko-init-time");
	const intervalInput = document.getElementById("ko-init-interval");

  const errEl = document.getElementById("ko-init-error");
  const resEl = document.getElementById("ko-init-result");

  const setErr = (m) => { if (errEl) errEl.textContent = m || ""; };
  const setRes = (m) => { if (resEl) resEl.textContent = m || ""; };

  if (!toggle || !body || !targetSel || !formEl) return;

  toggle.addEventListener("click", () => {
    const open = body.classList.toggle("hidden") === false;
    if (chevron) chevron.textContent = open ? "▾" : "▸";
  });

  const edition = window.currentEditions?.find(e => e.id === editionId);
  const isTeamTournament = Number(edition?.min_team_size) > 1;

  // Load target knockout stages from advancement rules (sourceStageId -> target_stage_id)
  const { data: ruleTargets, error: rErr } = await window.supabaseClient
    .from("advancement_rules")
    .select("target_stage_id")
    .eq("source_stage_id", sourceStageId);

  if (rErr) {
    console.error(rErr);
    setErr("Failed to load advancement rules.");
    return;
  }

  const targetStageIds = [...new Set((ruleTargets || []).map(r => r.target_stage_id).filter(Boolean))];

  const targets = (window.currentStages || [])
    .filter(s => targetStageIds.includes(s.id))
    .filter(s => s.stage_type === "knockout");

  if (!targets.length) {
    setErr("No target knockout stages found for this stage.");
    return;
  }

  targetSel.innerHTML = targets.map(s =>
    `<option value="${s.id}">${s.name || "Knockout stage"}</option>`
  ).join("");

	async function computeQualifiersForTarget(targetStageId) {
	  const { data: groups, error: gErr } = await window.supabaseClient
		.from("groups")
		.select("id")
		.eq("stage_id", sourceStageId);
	  if (gErr) throw gErr;
	  const numGroups = (groups || []).length;

	  const { data: rules, error: rErr } = await window.supabaseClient
		.from("advancement_rules")
		.select("position, quantity")
		.eq("source_stage_id", sourceStageId)
		.eq("target_stage_id", targetStageId);
	  if (rErr) throw rErr;

	  // Infer N robustly
	  let N = 0;
	  const qtyRows = (rules || []).filter(r => Number(r.quantity || 0) > 0);
	  if (qtyRows.length) {
		for (const r of qtyRows) {
		  const pos = Number(r.position || 1);
		  const qty = Number(r.quantity || 0);
		  N = Math.max(N, pos + qty - 1);
		}
	  } else {
		const positions = (rules || []).map(r => Number(r.position || 0)).filter(Boolean);
		N = positions.length ? Math.max(...positions) : 0;
	  }

	  if (!numGroups || !N) return { numGroups, N, seeds: 0 };
	  return { numGroups, N, seeds: numGroups * N };
	}
  
	// Optional UX: hide dropdown if only one target stage
	const targetRow = targetSel.closest(".bulk-row");
	if (targets.length === 1 && targetRow) {
		targetRow.style.display = "none";
	}

  async function refreshForm() {
    setErr(""); setRes("");
    const targetStageId = targetSel.value;
    if (!targetStageId) return;

    // Load groups
    const { data: groups, error: gErr } = await window.supabaseClient
      .from("groups")
      .select("id, name")
      .eq("stage_id", sourceStageId)
      .order("name");

    if (gErr) { console.error(gErr); setErr("Failed to load groups."); return; }

	const { seeds } = await computeQualifiersForTarget(targetStageId);
	if (!seeds) {
	  setErr("Cannot infer number of qualifiers (check groups + advancement rules).");
	  return;
	}

	// Offer bracket sizes >= seeds (byes if bracket > seeds)
	const minBracket = nextPow2(seeds);
	const options = [minBracket, minBracket * 2, minBracket * 4].filter(x => x <= 128);

	if (bracketSel) {
	  const prev = bracketSel.value; // preserve selection

	  // Only rewrite options if they differ
	  const nextHtml = options.map(x => `<option value="${x}">${x} (${x - seeds} byes)</option>`).join("");
	  if (bracketSel.innerHTML !== nextHtml) {
		bracketSel.innerHTML = nextHtml;
	  }

	  // Restore previous choice if still valid; otherwise default to minBracket
	  const stillValid = options.map(String).includes(prev);
	  bracketSel.value = stillValid ? prev : String(minBracket);
	}

	const bracketSize = Number(bracketSel?.value || minBracket);

/* 	// NEW: ensure structure matches exist up to bracket size (even if some already exist)
	await ensureKoStructureMatchesForFirstRound({
	  tournamentId,
	  editionId,
	  sourceStageId,
	  targetStageId,
	  bracketSize,
	  roundDate: dateInput?.value || null,
	  firstTime: timeInput?.value || null,
	  intervalMins: Number(intervalInput?.value || 10)
	});
	
	await applyKoStructureMatchTimes({
	  targetStageId,
	  roundDate: dateInput?.value || null,
	  firstTime: timeInput?.value || null,
	  intervalMins: Number(intervalInput?.value || 10)
	}); */

    // Load KO structure matches
	let { data: koMatches, error: mErr } = await window.supabaseClient
	  .from("matches")
	  .select("id, status, match_meta, bracket_meta, match_date")
	  .eq("stage_id", targetStageId)
	  .eq("status", "structure");

	if (mErr) {
	  console.error(mErr);
	  setErr("Failed to load target structure matches.");
	  return;
	}

	koMatches = (koMatches || []).sort((a, b) =>
	  Number(a.bracket_meta?.order || 0) -
	  Number(b.bracket_meta?.order || 0)
	);
	
	if (!koMatches?.length) {
	  formEl.innerHTML = `
		<div class="empty-message">
		  No bracket structure exists yet. Choose a bracket size, then click Initialise bracket.
		</div>
	  `;
	  return;
	}

    formEl.innerHTML = renderKoInitMappingForm({
      groups: groups || [],
      koMatches: koMatches || [],
      sourceStageId
    });

	wireByeDisablesPositions();
	restoreKoInitDateTimeFields(koMatches || []);
	await applyKoInitMetaToForm(koMatches || []);
  }

	targetSel.addEventListener("change", refreshForm);
	bracketSel?.addEventListener("change", refreshForm);
	await refreshForm();

	createBtn.addEventListener("click", async () => {
	  setErr(""); setRes("");
	  try {
		const targetStageId = targetSel.value;
		const bracketSize = Number(bracketSel?.value || 0);

		// Check whether mapping already exists
		const { data: existingStructure, error: existingErr } = await window.supabaseClient
		  .from("matches")
		  .select("id, match_meta")
		  .eq("stage_id", targetStageId)
		  .eq("status", "structure");

		if (existingErr) throw existingErr;

		const alreadyInitialised = (existingStructure || []).some(
		  m => m.match_meta?.init?.slot1 || m.match_meta?.init?.slot2
		);

		if (alreadyInitialised) {
		  const ok = window.confirm(
			"This bracket already has saved structure mapping. Overwrite it?"
		  );
		  if (!ok) return;
		}

		setRes("Initialising bracket structure…");

		await ensureKoStructureMatchesForFirstRound({
		  tournamentId,
		  editionId,
		  sourceStageId,
		  targetStageId,
		  bracketSize,
		  roundDate: dateInput?.value || null,
		  firstTime: timeInput?.value || null,
		  intervalMins: Number(intervalInput?.value || 10)
		});

		const mapping = readKoInitFormMapping();
		await saveKoInitMappingToStructureMatches({
		  targetStageId,
		  sourceStageId,
		  mapping
		});

		setRes("Bracket initialised.");
		await refreshForm();
		loadTournamentOverview(window.currentTournamentId);
	  } catch (e) {
		console.error(e);
		setErr(e.message || "Failed to initialise bracket.");
	  }
	});

	finaliseBtn.addEventListener("click", async () => {
	  setErr(""); setRes("");
	  try {
		const targetStageId = targetSel.value;

		setRes("Resolving qualifiers…");

		const resolvedByMatch = await resolveKoInitialisation({
		  editionId,
		  sourceStageId,
		  targetStageId
		});

		finaliseWrap.innerHTML = renderKoFinaliseTable(resolvedByMatch);
		
		document.querySelectorAll(".ko-finalise-override-toggle").forEach(cb => {
		  cb.addEventListener("change", () => {
			const selector =
			  `[data-match-id="${cb.dataset.matchId}"][data-slot="${cb.dataset.slot}"]`;

			const sel = document.querySelector(`.ko-finalise-select${selector}`);
			const other = document.querySelector(`.ko-finalise-other${selector}`);

			if (sel) sel.disabled = !cb.checked;
			if (other) other.disabled = !cb.checked;
		  });
		});

		const confirmBtn = document.getElementById("ko-finalise-confirm");
		if (confirmBtn) {
		  confirmBtn.addEventListener("click", async () => {
			setErr(""); setRes("");
			try {
			  const editedResolved = await readKoFinaliseSelections(resolvedByMatch);
			  await confirmKoInit({
				editionId,
				targetStageId,
				resolvedByMatch: editedResolved
			  });

			  setRes("Advancement finalised.");
			  finaliseWrap.innerHTML = "";
			  loadTournamentOverview(window.currentTournamentId);
			} catch (e) {
			  console.error(e);
			  setErr(e.message || "Failed to finalise advancement.");
			}
		  });
		}

		setRes("Review qualifiers, then confirm advancement.");
	  } catch (e) {
		console.error(e);
		setErr(e.message || "Failed to resolve qualifiers.");
	  }
	});

  resetBtn.addEventListener("click", async () => {
    setErr(""); setRes("");
    try {
      const targetStageId = targetSel.value;
      const clearMapping = !!clearMappingCb?.checked;

      setRes("Resetting stage…");
      await resetKoStage({
        editionId,
        targetStageId,
        clearMapping
      });

      setRes("Stage reset.");
      await refreshForm();
      loadTournamentOverview(window.currentTournamentId);
    } catch (e) {
      console.error(e);
      setErr(e.message || "Failed to reset stage.");
    }
  });
}

function renderKoInitMappingForm({ groups, koMatches, sourceStageId }) {
  const groupOptions =
    `<option value="">Group…</option>` +
    `<option value="__BYE__">BYE</option>` +
    groups.map(g => `<option value="${g.id}">${g.name}</option>`).join("");

  const posOptions = `<option value="">Pos…</option>`;

  return `
    <div class="subtitle" style="margin:8px 0 12px;">
      Set the bracket placeholders now. Finalise advancement later once standings are known.
    </div>

    <table class="standings-table" style="width:100%;">
      <thead>
        <tr>
          <th style="width:90px;">Match</th>
          <th style="text-align:left;">Slot 1</th>
          <th style="text-align:left;">Slot 2</th>
        </tr>
      </thead>
      <tbody>
        ${koMatches.map((m, idx) => `
          <tr>
            <td style="text-align:center;">${idx + 1}</td>
            <td>
              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <select class="ko-init-group" data-match-id="${m.id}" data-slot="slot1" data-source-stage="${sourceStageId}">
                  ${groupOptions}
                </select>
                <select class="ko-init-pos" data-match-id="${m.id}" data-slot="slot1">
                  ${posOptions}
                </select>
              </div>
            </td>
            <td>
              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <select class="ko-init-group" data-match-id="${m.id}" data-slot="slot2" data-source-stage="${sourceStageId}">
                  ${groupOptions}
                </select>
                <select class="ko-init-pos" data-match-id="${m.id}" data-slot="slot2">
                  ${posOptions}
                </select>
              </div>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function readKoInitFormMapping() {
  const mapping = new Map();

  const groupEls = document.querySelectorAll(".ko-init-group");
  const posEls = document.querySelectorAll(".ko-init-pos");
  const posByKey = new Map();

  posEls.forEach(p => posByKey.set(`${p.dataset.matchId}|${p.dataset.slot}`, p.value));

  groupEls.forEach(g => {
    const matchId = g.dataset.matchId;
    const slot = g.dataset.slot;
    const groupId = g.value || null;

    if (!mapping.has(matchId)) mapping.set(matchId, { slot1: null, slot2: null });

    if (!groupId) {
      mapping.get(matchId)[slot] = null;
      return;
    }

    if (groupId === "__BYE__") {
      mapping.get(matchId)[slot] = {
        group_id: "__BYE__",
        position: null,
        override_id: null,
        locked: false
      };
      return;
    }

    const pos = Number(posByKey.get(`${matchId}|${slot}`)) || null;

    mapping.get(matchId)[slot] = {
      group_id: groupId,
      position: pos,
      override_id: null,
      locked: false
    };
  });

  return mapping;
}

async function applyKoInitMetaToForm(koMatches) {
  for (const m of koMatches) {
    const init = m.match_meta?.init;
    if (!init) continue;

    for (const slot of ["slot1", "slot2"]) {
      const spec = init[slot];
      if (!spec) continue;

      const gSel = document.querySelector(
        `.ko-init-group[data-match-id="${m.id}"][data-slot="${slot}"]`
      );

      const pSel = document.querySelector(
        `.ko-init-pos[data-match-id="${m.id}"][data-slot="${slot}"]`
      );

      if (!gSel || !pSel) continue;

      gSel.value = spec.group_id || "";

      await populateKoPositionSelect({
        groupSelect: gSel,
        posSelect: pSel,
        sourceStageId: gSel.dataset.sourceStage,
        targetStageId: document.getElementById("ko-init-target-stage")?.value
      });

      pSel.value = spec.position || "";
    }
  }
}

function restoreKoInitDateTimeFields(koMatches) {
  const first = [...(koMatches || [])]
    .filter(m => m.match_date)
    .sort((a, b) =>
      Number(a.bracket_meta?.order || 0) -
      Number(b.bracket_meta?.order || 0)
    )[0];

  if (!first?.match_date) return;

  const d = new Date(first.match_date);

  const dateInput = document.getElementById("ko-init-date");
  const timeInput = document.getElementById("ko-init-time");

  if (dateInput && !dateInput.value) {
    dateInput.value = d.toISOString().slice(0, 10);
  }

  if (timeInput && !timeInput.value) {
    timeInput.value = d.toTimeString().slice(0, 5);
  }
}

async function saveKoInitMappingToStructureMatches({
  targetStageId,
  sourceStageId,
  mapping
}) {
  const matchIds = [...mapping.keys()];
  if (!matchIds.length) throw new Error("Nothing to save.");

  const { data: groups, error: gErr } = await window.supabaseClient
    .from("groups")
    .select("id, name")
    .eq("stage_id", sourceStageId);

  if (gErr) throw gErr;

  const groupNameById = new Map((groups || []).map(g => [g.id, g.name]));

  const { data: existing, error: eErr } = await window.supabaseClient
    .from("matches")
    .select("id, match_meta")
    .in("id", matchIds)
    .eq("stage_id", targetStageId)
    .eq("status", "structure");

  if (eErr) throw eErr;

  const existingById = new Map((existing || []).map(m => [m.id, m.match_meta || {}]));

  for (const matchId of matchIds) {
    const currentMeta = existingById.get(matchId) || {};
    const slots = mapping.get(matchId) || { slot1: null, slot2: null };

    const slot1Label = slots.slot1
      ? buildPlaceholderLabel({
          groupName: groupNameById.get(slots.slot1.group_id),
          position: slots.slot1.position,
          groupId: slots.slot1.group_id
        })
      : "TBD";

    const slot2Label = slots.slot2
      ? buildPlaceholderLabel({
          groupName: groupNameById.get(slots.slot2.group_id),
          position: slots.slot2.position,
          groupId: slots.slot2.group_id
        })
      : "TBD";

    const nextMeta = {
      ...currentMeta,
      init: {
        source_stage_id: sourceStageId,
        slot1: slots.slot1,
        slot2: slots.slot2
      },
      labels: {
        ...(currentMeta.labels || {}),
        slot1: slot1Label,
        slot2: slot2Label
      }
    };

    const { error } = await window.supabaseClient
      .from("matches")
      .update({ match_meta: nextMeta })
      .eq("id", matchId)
      .eq("stage_id", targetStageId)
      .eq("status", "structure");

    if (error) throw error;
  }
}

function ordinal(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "";
  const mod100 = x % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${x}th`;
  switch (x % 10) {
    case 1: return `${x}st`;
    case 2: return `${x}nd`;
    case 3: return `${x}rd`;
    default: return `${x}th`;
  }
}

function buildPlaceholderLabel({ groupName, position, groupId }) {
  if (groupId === "__BYE__") return "BYE";
  if (!groupName) groupName = "Group";
  if (!position) return `TBD (${groupName})`;
  return `${ordinal(position)} place ${groupName}`;
}

async function computeAllowedPositionsForTarget({
  sourceStageId,
  targetStageId,
  groupSize
}) {
  const { data: rules, error } = await window.supabaseClient
    .from("advancement_rules")
    .select("condition, position, quantity")
    .eq("source_stage_id", sourceStageId)
    .eq("target_stage_id", targetStageId);

  if (error) throw error;

  const allowed = new Set();

  for (const r of (rules || [])) {
    const condition = r.condition || "";
    const pos = Number(r.position || 1);
    const qty = Number(r.quantity || 1);

    // Top positions per group
    if (
      condition === "winner" ||
      condition === "nth_place" ||
      condition === "best_placed" ||
      condition === "advance"
    ) {
      for (let i = 0; i < qty; i++) {
        allowed.add(pos + i);
      }
      continue;
    }

    // Bottom positions per group
    if (condition === "loser" || condition === "eliminate") {
      const start = Math.max(1, groupSize - qty + 1);
      for (let p = start; p <= groupSize; p++) {
        allowed.add(p);
      }
      continue;
    }

    // Whole group
    if (condition === "all") {
      for (let p = 1; p <= groupSize; p++) {
        allowed.add(p);
      }
    }
  }

  return [...allowed]
    .filter(p => p >= 1 && p <= groupSize)
    .sort((a, b) => a - b);
}

async function ensureKoStructureMatchesForFirstRound({
  tournamentId,
  editionId,
  sourceStageId,
  targetStageId,
  bracketSize,
  roundDate,
  firstTime,
  intervalMins
}) {
  const { data: groups, error: gErr } = await window.supabaseClient
    .from("groups")
    .select("id")
    .eq("stage_id", sourceStageId);
  if (gErr) throw gErr;

  const numGroups = (groups || []).length;
  if (!numGroups) throw new Error("No groups exist in the source stage.");

  const { data: rules, error: rErr } = await window.supabaseClient
    .from("advancement_rules")
    .select("position, quantity")
    .eq("source_stage_id", sourceStageId)
    .eq("target_stage_id", targetStageId);
  if (rErr) throw rErr;

  let N = 0;
  const qtyRows = (rules || []).filter(r => Number(r.quantity || 0) > 0);
  if (qtyRows.length) {
    for (const r of qtyRows) {
      const pos = Number(r.position || 1);
      const qty = Number(r.quantity || 0);
      N = Math.max(N, pos + qty - 1);
    }
  } else {
    const positions = (rules || []).map(r => Number(r.position || 0)).filter(Boolean);
    N = positions.length ? Math.max(...positions) : 0;
  }

  if (!N) throw new Error("Could not infer top-N from advancement rules.");

  const seeds = numGroups * N;
  if (seeds < 2) throw new Error("Not enough qualifiers.");

  const chosen = Number(bracketSize || 0) || nextPow2(seeds);

  if (chosen < seeds) {
    throw new Error(`Bracket size ${chosen} too small for ${seeds} qualifiers.`);
  }
  if (chosen % 2 !== 0) {
    throw new Error("Bracket size must be even.");
  }

  const matchCount = chosen / 2;

const { data: existing, error: exErr } = await window.supabaseClient
  .from("matches")
  .select("id, bracket_meta, match_meta")
  .eq("stage_id", targetStageId)
  .eq("status", "structure");

if (exErr) throw exErr;

let baseDate = null;

if (roundDate && firstTime) {
  baseDate = new Date(`${roundDate}T${firstTime}:00`);
} else if (roundDate) {
  baseDate = new Date(`${roundDate}T00:00:00`);
}

const stepMs = Math.max(0, Number(intervalMins || 0)) * 60000;

const existingSorted = (existing || [])
  .slice()
  .sort((a, b) =>
    Number(a.bracket_meta?.order || 0) -
    Number(b.bracket_meta?.order || 0)
  );
  
  const surplus = existingSorted.slice(matchCount);

	if (surplus.length) {
	  const surplusIds = surplus.map(m => m.id);

	  const { error: delErr } = await window.supabaseClient
		.from("matches")
		.delete()
		.in("id", surplusIds);

	  if (delErr) throw delErr;
	}

const keptExisting = existingSorted.slice(0, matchCount);

let maxOrder = 0;

for (let i = 0; i < keptExisting.length; i++) {
  const m = existingSorted[i];
  const order = Number(m.bracket_meta?.order || 0) || i + 1;

  maxOrder = Math.max(maxOrder, order);

  const currentMeta = m.match_meta || {};

  const updatePayload = {
    bracket_meta: {
      ...(m.bracket_meta || {}),
      round: m.bracket_meta?.round || 1,
      order
    },
    match_meta: {
      ...currentMeta,
      init: currentMeta.init || {
        source_stage_id: sourceStageId,
        slot1: null,
        slot2: null
      },
      labels: {
        slot1: currentMeta.labels?.slot1 || "TBD",
        slot2: currentMeta.labels?.slot2 || "TBD",
        ...(currentMeta.labels || {})
      }
    }
  };

  if (baseDate) {
    updatePayload.match_date =
      new Date(baseDate.getTime() + (order - 1) * stepMs).toISOString();
  }

  const { error: upErr } = await window.supabaseClient
    .from("matches")
    .update(updatePayload)
    .eq("id", m.id);

  if (upErr) throw upErr;
}

const existingCount = keptExisting.length;
const toCreate = Math.max(0, matchCount - existingCount);

const inserts = [];

for (let i = 0; i < toCreate; i++) {
  const order = maxOrder + i + 1;

  inserts.push({
    tournament_id: tournamentId,
    edition_id: editionId,
    stage_id: targetStageId,
    status: "structure",
    match_date: baseDate
      ? new Date(baseDate.getTime() + (order - 1) * stepMs).toISOString()
      : null,
    final_sets_player1: 0,
    final_sets_player2: 0,
    match_meta: {
      init: {
        source_stage_id: sourceStageId,
        slot1: null,
        slot2: null
      },
      labels: {
        slot1: "TBD",
        slot2: "TBD"
      }
    },
    bracket_meta: {
      round: 1,
      order
    }
  });
}

if (inserts.length) {
  const { error: insErr } = await window.supabaseClient
    .from("matches")
    .insert(inserts);

  if (insErr) throw insErr;
}
}

async function applyKoStructureMatchTimes({
  targetStageId,
  roundDate,
  firstTime,
  intervalMins
}) {
  let baseDate = null;

  if (roundDate && firstTime) {
    baseDate = new Date(`${roundDate}T${firstTime}:00`);
  } else if (roundDate) {
    baseDate = new Date(`${roundDate}T00:00:00`);
  } else {
    return; // do nothing if no date chosen
  }

  const stepMs = Math.max(0, Number(intervalMins || 0)) * 60000;

  const { data: matches, error } = await window.supabaseClient
    .from("matches")
    .select("id, bracket_meta")
    .eq("stage_id", targetStageId)
    .eq("status", "structure");

  if (error) throw error;

  const ordered = [...(matches || [])].sort((a, b) => {
    const ao = Number(a?.bracket_meta?.order || 0);
    const bo = Number(b?.bracket_meta?.order || 0);
    return ao - bo;
  });

  for (let i = 0; i < ordered.length; i++) {
    const dt = new Date(baseDate.getTime() + i * stepMs).toISOString();

    const { error: uErr } = await window.supabaseClient
      .from("matches")
      .update({ match_date: dt })
      .eq("id", ordered[i].id);

    if (uErr) throw uErr;
  }
}

async function populateKoPositionSelect({
  groupSelect,
  posSelect,
  sourceStageId,
  targetStageId
}) {
  if (!groupSelect || !posSelect) return;

  const groupId = groupSelect.value;

  if (!groupId || groupId === "__BYE__") {
    posSelect.value = "";
    posSelect.disabled = true;
    posSelect.innerHTML = `<option value="">Pos…</option>`;
    return;
  }

  posSelect.disabled = false;

  const { data, error } = await window.supabaseClient
    .from("matches")
    .select("id")
    .eq("stage_id", sourceStageId)
    .eq("group_id", groupId)
    .eq("status", "structure");

  if (error) throw error;

  const groupSize = (data || []).length;

  const allowedPositions = await computeAllowedPositionsForTarget({
    sourceStageId,
    targetStageId,
    groupSize
  });

  posSelect.innerHTML =
    `<option value="">Pos…</option>` +
    allowedPositions.map(p => `<option value="${p}">${p}</option>`).join("");

  posSelect.disabled = allowedPositions.length === 0;
}

function wireByeDisablesPositions() {
  document.querySelectorAll(".ko-init-group").forEach(sel => {
    sel.addEventListener("change", async () => {
      const posSel = document.querySelector(
        `.ko-init-pos[data-match-id="${sel.dataset.matchId}"][data-slot="${sel.dataset.slot}"]`
      );

      await populateKoPositionSelect({
        groupSelect: sel,
        posSelect: posSel,
        sourceStageId: sel.dataset.sourceStage,
        targetStageId: document.getElementById("ko-init-target-stage")?.value
      });
    });
  });
}

function getCompetitorField(isTeamTournament, slot) {
  if (isTeamTournament) return slot === "slot1" ? "team1_id" : "team2_id";
  return slot === "slot1" ? "player1_id" : "player2_id";
}

async function resolveKoInitialisation({
  editionId,
  sourceStageId,
  targetStageId
}) {
  const edition = window.currentEditions?.find(e => e.id === editionId);
  const isTeamTournament = Number(edition?.min_team_size) > 1;

  const { data: koMatches, error: kmErr } = await window.supabaseClient
    .from("matches")
    .select("id, match_meta, status, match_date, bracket_meta")
    .eq("stage_id", targetStageId)
    .eq("status", "structure")
	
	const orderedKoMatches = (koMatches || []).sort((a, b) =>
	  Number(a.bracket_meta?.order || 0) -
	  Number(b.bracket_meta?.order || 0)
	);

  if (kmErr) throw kmErr;

  const { data: sourceMatches, error: smErr } = await window.supabaseClient
    .from("matches")
    .select(isTeamTournament
      ? `id, stage_id, group_id, status, team1_id, team2_id,
         team1:team1_id ( id, name ),
         team2:team2_id ( id, name )`
      : `id, stage_id, group_id, status, player1_id, player2_id,
         player1:player1_id ( id, name ),
         player2:player2_id ( id, name )`
    )
    .eq("stage_id", sourceStageId)
    .not("group_id", "is", null);

  if (smErr) throw smErr;

  const matchIds = (sourceMatches || []).map(m => m.id).filter(Boolean);
  if (!matchIds.length) throw new Error("No matches found in the source stage.");

  const { data: sets, error: sErr } = await window.supabaseClient
    .from("sets")
    .select("*")
    .in("match_id", matchIds);

  if (sErr) throw sErr;

  const { data: groups, error: gErr } = await window.supabaseClient
    .from("groups")
    .select("id, name")
    .eq("stage_id", sourceStageId);

  if (gErr) throw gErr;

  const participantsById = new Map();

  (sourceMatches || []).forEach(m => {
    if (isTeamTournament) {
      if (m.team1?.id) participantsById.set(m.team1.id, m.team1.name);
      if (m.team2?.id) participantsById.set(m.team2.id, m.team2.name);
    } else {
      if (m.player1?.id) participantsById.set(m.player1.id, m.player1.name);
      if (m.player2?.id) participantsById.set(m.player2.id, m.player2.name);
    }
  });

  const participants = [...participantsById.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const config = DEFAULT_STANDINGS_CONFIG;
  const matchesByGroup = groupMatchesByGroup(sourceMatches);

  const standingsByGroup = new Map();
  for (const g of (groups || [])) {
    const groupMatches = matchesByGroup.get(g.id) || [];
    const statsBy = buildGroupStats(groupMatches, sets || [], config);
    const rows = sortStandings(Object.values(statsBy), config.ranking);
    standingsByGroup.set(g.id, rows);
  }

  const groupNameById = new Map((groups || []).map(g => [g.id, g.name]));
  const resolvedByMatch = new Map();

  for (const m of orderedKoMatches) {
    const init = m.match_meta?.init;
    if (!init || init.source_stage_id !== sourceStageId) continue;

	const out = {
	  matchOrder: Number(m.bracket_meta?.order || 0),
	  slot1: null,
	  slot2: null
	};

    for (const slot of ["slot1", "slot2"]) {
      const spec = init[slot];

      if (!spec?.group_id) {
        out[slot] = {
          id: null,
          name: "—",
          sourceLabel: "Unmapped slot",
          isBye: false
        };
        continue;
      }

      if (spec.group_id === "__BYE__") {
        out[slot] = {
          id: null,
          name: "BYE",
          sourceLabel: "BYE",
          isBye: true
        };
        continue;
      }

      const sourceLabel = `${ordinal(spec.position)} place ${groupNameById.get(spec.group_id) || "Group"}`;

      if (!spec.position) {
        out[slot] = {
          id: null,
          name: "—",
          sourceLabel,
          isBye: false
        };
        continue;
      }

      const list = standingsByGroup.get(spec.group_id) || [];
      const picked = list[Number(spec.position) - 1];

      out[slot] = {
        id: picked?.competitor_id || null,
        name: picked?.name || "—",
        sourceLabel,
        isBye: false
      };
    }

    resolvedByMatch.set(m.id, out);
  }

  if (!resolvedByMatch.size) {
    throw new Error("No saved bracket mapping found. Initialise the bracket first.");
  }

  resolvedByMatch.participants = participants;
  return resolvedByMatch;
}

function renderKoFinaliseTable(resolvedByMatch) {
  const participants = resolvedByMatch.participants || [];

  const participantOptions = (selectedId) =>
    `<option value="">— Select override —</option>` +
    `<option value="__BYE__" ${selectedId === "__BYE__" ? "selected" : ""}>BYE</option>` +
    participants.map(p => `
      <option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>
        ${p.name}
      </option>
    `).join("");

  const renderSlot = (matchId, slot, resolved) => {
    const isBye = resolved?.isBye === true;
    const resolvedId = resolved?.id || "";
    const resolvedName = resolved?.name || "—";
    const sourceLabel = resolved?.sourceLabel || "";

    return `
      <div class="ko-finalise-slot">
        <div class="subtitle">${sourceLabel}</div>

        <div class="ko-finalise-resolved">
          ${resolvedName}
        </div>

        <label style="display:flex; gap:6px; align-items:center; margin-top:6px;">
          <input
            type="checkbox"
            class="ko-finalise-override-toggle"
            data-match-id="${matchId}"
            data-slot="${slot}"
            ${isBye ? "disabled" : ""}
          />
          Override
        </label>

        <select
          class="form-input ko-finalise-select"
          data-match-id="${matchId}"
          data-slot="${slot}"
          data-resolved-id="${resolvedId}"
          data-resolved-name="${resolvedName}"
          ${isBye ? "" : "disabled"}
        >
          ${participantOptions(isBye ? "__BYE__" : resolvedId)}
        </select>
		
		<input
		  class="form-input ko-finalise-other"
		  data-match-id="${matchId}"
		  data-slot="${slot}"
		  placeholder="Other / late arrival"
		  disabled
		/>
      </div>
    `;
  };

  return `
    <div class="card" style="margin-top:8px;">
      <div class="section-title">Finalise advancement</div>

      <table class="standings-table" style="width:100%;">
        <thead>
          <tr>
            <th style="width:90px;">Match</th>
            <th style="text-align:left;">Slot 1</th>
            <th style="text-align:left;">Slot 2</th>
          </tr>
        </thead>
        <tbody>
          ${[...resolvedByMatch.entries()].map(([matchId, slots], idx) => `
            <tr>
              <td style="text-align:center;">${slots.matchOrder || idx + 1}</td>
              <td>${renderSlot(matchId, "slot1", slots.slot1)}</td>
              <td>${renderSlot(matchId, "slot2", slots.slot2)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>

      <div class="form-row-inline" style="margin-top:10px;">
        <button class="header-btn" id="ko-finalise-confirm">Confirm advancement</button>
      </div>
    </div>
  `;
}

async function readKoFinaliseSelections(resolvedByMatch) {
  const out = new Map();

  for (const [matchId, slots] of resolvedByMatch.entries()) {
    out.set(matchId, {
      slot1: slots.slot1 ? { ...slots.slot1 } : null,
      slot2: slots.slot2 ? { ...slots.slot2 } : null
    });
  }

  for (const sel of document.querySelectorAll(".ko-finalise-select")) {
    const matchId = sel.dataset.matchId;
    const slot = sel.dataset.slot;
    if (!out.has(matchId)) continue;

    const toggle = document.querySelector(
      `.ko-finalise-override-toggle[data-match-id="${matchId}"][data-slot="${slot}"]`
    );

    const other = document.querySelector(
      `.ko-finalise-other[data-match-id="${matchId}"][data-slot="${slot}"]`
    );

    const otherName = other?.value?.trim() || "";
    const useOverride = toggle?.checked || sel.value === "__BYE__";

    if (!useOverride) {
      out.get(matchId)[slot] = {
        id: sel.dataset.resolvedId || null,
        name: sel.dataset.resolvedName || "—"
      };
      continue;
    }

    if (otherName) {
      let { data: player, error: findErr } = await window.supabaseClient
        .from("players")
        .select("id, name")
        .eq("name", otherName)
        .maybeSingle();

      if (findErr) throw findErr;

      if (!player) {
        const { data: created, error: createErr } = await window.supabaseClient
          .from("players")
          .insert({
            name: otherName,
            is_guest: false
          })
          .select("id, name")
          .single();

        if (createErr) throw createErr;
        player = created;
      }

      out.get(matchId)[slot] = {
        id: player.id,
        name: player.name
      };

      continue;
    }

    if (sel.value === "__BYE__") {
      out.get(matchId)[slot] = {
        id: null,
        name: "BYE"
      };
      continue;
    }

    const selected = sel.options[sel.selectedIndex];

    out.get(matchId)[slot] = {
      id: sel.value || null,
      name: selected?.textContent?.trim() || "—"
    };
  }

  return out;
}

async function confirmKoInit({
  editionId,
  targetStageId,
  resolvedByMatch
}) {
  const edition = window.currentEditions?.find(e => e.id === editionId);
  const isTeamTournament = Number(edition?.min_team_size) > 1;

  // Guard: target stage must still be empty of competitors
  const { data: existing, error: exErr } = await window.supabaseClient
    .from("matches")
    .select(isTeamTournament ? "id, status, team1_id, team2_id" : "id, status, player1_id, player2_id")
    .eq("stage_id", targetStageId);

  if (exErr) throw exErr;

  const anyFilled = (existing || []).some(m =>
    isTeamTournament ? (m.team1_id || m.team2_id) : (m.player1_id || m.player2_id)
  );
  if (anyFilled) throw new Error("Target stage already has competitors. Reset it first.");

  // Apply updates to structure matches: set competitors + status scheduled
  for (const [matchId, slots] of resolvedByMatch.entries()) {
    const aId = slots.slot1?.id ?? null;
    const bId = slots.slot2?.id ?? null;

    const f1 = getCompetitorField(isTeamTournament, "slot1");
    const f2 = getCompetitorField(isTeamTournament, "slot2");

    const patch = {
      final_sets_player1: 0,
      final_sets_player2: 0,
      [f1]: aId,
      [f2]: bId
    };

    // Allow BYE/BYE. Decide status:
    // - if both null => keep as structure (empty placeholder)
    // - otherwise => schedule the match
    patch.status = (!aId && !bId) ? "structure" : "scheduled";

    const { error } = await window.supabaseClient
      .from("matches")
      .update(patch)
      .eq("id", matchId)
      .eq("stage_id", targetStageId)
      .eq("status", "structure");

    if (error) throw error;
  }
}

async function resetKoStage({
  editionId,
  targetStageId,
  clearMapping
}) {
  const edition = window.currentEditions?.find(e => e.id === editionId);
  const isTeamTournament = Number(edition?.min_team_size) > 1;

  const { data: matches, error: mErr } = await window.supabaseClient
    .from("matches")
    .select("id, match_meta")
    .eq("stage_id", targetStageId);

  if (mErr) throw mErr;

  for (const m of (matches || [])) {
    const patch = isTeamTournament
      ? { team1_id: null, team2_id: null }
      : { player1_id: null, player2_id: null };

    patch.status = "structure";
    patch.final_sets_player1 = 0;
    patch.final_sets_player2 = 0;

	if (clearMapping) {
	  const meta = { ...(m.match_meta || {}) };
	  if (meta.init) delete meta.init;
	  if (meta.labels) delete meta.labels;
	  patch.match_meta = meta;
	}

    const { error } = await window.supabaseClient
      .from("matches")
      .update(patch)
      .eq("id", m.id);

    if (error) throw error;
  }
}

async function getFinalisedAdvancementIds({ sourceStageId, targetStageId, isTeamTournament }) {
  const { data: targetMatches, error } = await window.supabaseClient
    .from("matches")
    .select(
      isTeamTournament
        ? "id, status, team1_id, team2_id, match_meta"
        : "id, status, player1_id, player2_id, match_meta"
    )
    .eq("stage_id", targetStageId)
    .in("status", ["scheduled", "live", "finished"]);

  if (error) throw error;

  const ids = new Set();

  (targetMatches || []).forEach(m => {
    const initSource = m.match_meta?.init?.source_stage_id;

    // only count entries created/finalised from this source stage
    if (initSource && initSource !== sourceStageId) return;

    const a = isTeamTournament ? m.team1_id : m.player1_id;
    const b = isTeamTournament ? m.team2_id : m.player2_id;

    if (a) ids.add(a);
    if (b) ids.add(b);
  });

  return ids;
}

async function propagateKoWinner(matchId) {
  const editionId = window.tournamentContext?.editionId;
  const edition = window.currentEditions?.find(e => e.id === editionId);
  const isTeamTournament = Number(edition?.min_team_size) > 1;

  const { data: m, error } = await window.supabaseClient
    .from("matches")
    .select(isTeamTournament
      ? "id, status, team1_id, team2_id, final_sets_player1, final_sets_player2, bracket_meta"
      : "id, status, player1_id, player2_id, final_sets_player1, final_sets_player2, bracket_meta"
    )
    .eq("id", matchId)
    .single();

  if (error) throw error;

  if (!["finished", "final", "completed"].includes(m.status)) return;

  const aId = isTeamTournament ? m.team1_id : m.player1_id;
  const bId = isTeamTournament ? m.team2_id : m.player2_id;
  if (!aId || !bId) return;

  const aSets = Number(m.final_sets_player1 ?? 0);
  const bSets = Number(m.final_sets_player2 ?? 0);
  if (aSets === bSets) throw new Error("Knockout match cannot be a draw.");

  const winnerId = aSets > bSets ? aId : bId;

  const dest = m.bracket_meta?.feeds?.winner_to;
  if (!dest?.match_id || !dest?.slot) return;

  const field = getCompetitorField(isTeamTournament, dest.slot);

  const { error: uErr } = await window.supabaseClient
    .from("matches")
    .update({ [field]: winnerId })
    .eq("id", dest.match_id);

  if (uErr) throw uErr;
}

function openCreateTournamentModal() {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";

  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">Create tournament</div>
        <button class="icon-btn modal-close">✕</button>
      </div>

      <div class="modal-body">
        <label>
          Tournament name
          <input type="text" id="ct-name" />
        </label>
		
		<label>
		  Edition name
		  <input type="text" id="ct-edition-name" placeholder="e.g. 2026, Winter Series" />
		</label>

		<label>
		  Country
		  <select id="ct-country" required>
			<option value="">Select country…</option>

			<optgroup label="Member countries">
			  <option>Australia</option>
			  <option>Austria</option>
			  <option>Belgium</option>
			  <option>Czech Republic</option>
			  <option>Estonia</option>
			  <option>Finland</option>
			  <option>France</option>
			  <option>Germany</option>
			  <option>Great Britain</option>
			  <option>Greece</option>
			  <option>Hong Kong</option>
			  <option>Hungary</option>
			  <option>Japan</option>
			  <option>Poland</option>
			  <option>Slovakia</option>
			  <option>Spain</option>
			  <option>Switzerland</option>
			  <option>Turkey</option>
			  <option>United States</option>
			</optgroup>

			<optgroup label="International">
			  <option>Asia</option>
			  <option>Europe</option>
			  <option>World</option>
			</optgroup>

			<optgroup label="Other">
			  <option>Other</option>
			</optgroup>
		  </select>
		</label>

		<label>
		  Format
		  <select id="ct-format">
			<option value="formal" selected>
			  Formal (organiser schedules matches)
			</option>
			<option value="casual">
			  Casual (players arrange matches)
			</option>
		  </select>
		</label>
      </div>

      <div class="modal-actions">
        <button class="header-btn secondary modal-cancel">Cancel</button>
        <button class="header-btn" id="ct-create-btn">Create</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector(".modal-close").onclick =
  modal.querySelector(".modal-cancel").onclick =
    () => modal.remove();
	
	  modal.querySelector("#ct-create-btn").onclick = async () => {
		await createTournamentFromModal(modal);
	  };
}

async function createTournamentFromModal(modal) {
  const name = modal.querySelector("#ct-name").value.trim();
  const country = modal.querySelector("#ct-country").value;
  const type = modal.querySelector("#ct-format").value;
  const editionName = modal.querySelector("#ct-edition-name").value.trim();

	if (!editionName) {
	  alert("Edition name is required.");
	  return;
	}

  if (!name) {
    alert("Tournament name is required.");
    return;
  }

  if (!country) {
    alert("Please select a country.");
    return;
  }

  // --------------------------------
  // 1) Create tournament
  // --------------------------------
  const { data: tournament, error: tError } =
    await window.supabaseClient
      .from("tournaments")
		.insert({
		  name,
		  country,
		  type
		})
      .select()
      .single();

  if (tError || !tournament) {
    console.error(tError);
    alert("Failed to create tournament.");
    return;
  }

  // --------------------------------
  // 2) Auto-create first edition
  // --------------------------------
  const { data: edition, error: eError } =
    await window.supabaseClient
      .from("editions")
      .insert({
        tournament_id: tournament.id,
        name: editionName
      })
      .select()
      .single();

  if (eError || !edition) {
    console.error(eError);
    alert("Tournament created, but edition failed.");
    return;
  }

  // --------------------------------
  // 3) Set context explicitly
  // --------------------------------
  window.currentTournament = tournament;
  window.currentTournamentId = tournament.id;

  window.tournamentContext = {
    tournamentId: tournament.id,
    editionId: edition.id,
    stageId: null,
    selectedBracketId: null,
    activeOverviewTab: "manage"
  };

  modal.remove();

  // --------------------------------
  // 4) Route straight to Manage tab
  // --------------------------------
  window.location.hash =
    `#/tournament/${tournament.id}/overview?tab=manage`;
}
