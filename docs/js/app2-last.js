/* ========================================================================
 *  app.js
 *  Main application control logic for molkky.live
 *
 *  Responsibilities:
 *   - Router
 *   - Page load orchestration
 *   - Player/tournament contexts
 *   - Match detail loading
 *
 *  NOTE:
 *   This file uses the global, non-module structure of the current project.
 *   Functions exposed to other files remain on the window namespace.
 * ======================================================================== */


/* ========================================================================
 * 1. GLOBAL STATE
 * ======================================================================== */

window.currentMatchId			= null;
window.currentTournamentId		= null;
window.lastSeenSet				= null;

/**
 * State for the currently viewed tournament.
 * Includes active tab, selected stage, edition, group, etc.
 */
window.tournamentContext = {
	tournamentId: null,
	editionId: null,
	stageId: null,
	groupId: null,
	activeOverviewTab: "standings"
};

/**
 * State for the currently viewed player profile page.
 * Contains:
 *  - player record
 *  - all matches involving the player
 *  - active tab
 */
window.playerContext = null;

/* ========================================================================
 * 1.1 BOTTOM BAR CONFIGURATION
 * ======================================================================== */

const BOTTOM_BAR_ITEMS = [
	{
		key: "today",
		icon: "📅",
		label: "Today",
		route: "#/tournaments",
		visible: () => true
	},
	{
		key: "Tournaments",
		icon: "🌍",
		label: "Tournaments",
		route: "#/leagues",
		visible: () => true
	},
	{
		key: "add-friendly",
		icon: "➕",
		label: "Add",
		route: "#/friendlies/new",
		visible: () => true
	},
	{
		key: "score",
		icon: "🎯",
		label: "Score",
		onClick: () => openScoringConsole?.(),
		visible: () => canScoreCurrentMatch()
	}
];

function renderBottomBar() {
	throw new Error("renderBottomBar reached");

	console.log("renderBottomBar() called", {
		hash: window.location.hash,
		currentMatchId: window.currentMatchId
	});
	const track = document.getElementById("bottom-bar-track");
	if (!track) return;

	track.innerHTML = "";

	BOTTOM_BAR_ITEMS
		.filter(item => {
			try {
				return typeof item.visible === "function"
					? item.visible()
					: true;
			} catch {
				return false;
			}
		})
		.forEach(item => {
			const el = document.createElement("div");
			el.className = "nav-item";
			el.dataset.key = item.key;

			el.innerHTML = `
				<span class="nav-icon">${item.icon}</span>
				<span class="nav-label">${item.label}</span>
			`;

			el.addEventListener("click", () => {
				if (item.route) window.location.hash = item.route;
				if (item.onClick) item.onClick();
			});

			track.appendChild(el);
		});
}
console.log("renderBottomBar exists?", typeof renderBottomBar);


/* ========================================================================
 * 2. FLAG HELPERS (TEMPORARY — to be replaced with PNG asset system)
 * ======================================================================== */

/**
 * Convert country name / code into an emoji flag.
 * This is placeholder logic; later replaced with PNG flags.
 *
 * @param {string} c - country code/name
 * @returns {string} emoji or empty string
 */
function flagEmoji(c) {
	if (!c) return "";
	const code = c.trim().toUpperCase().slice(0, 2);
	if (code.length !== 2) return "";
	const cp1 = code.codePointAt(0) - 0x41 + 0x1F1E6;
	const cp2 = code.codePointAt(1) - 0x41 + 0x1F1E6;
	return String.fromCodePoint(cp1, cp2);
}


/* ========================================================================
 * 3. PLAYER LINK HANDLER (GLOBAL DELEGATION)
 * ========================================================================
 *  Clicking any element with .player-link or data-player-id navigates
 *  to the player profile page, unless inside a match card.
 * ======================================================================== */

document.addEventListener("click", (ev) => {
	const p = ev.target.closest("[data-player-id]");
	if (!p) return;

	const insideMatchCard = ev.target.closest(".match-card, .player-match-card");
	if (insideMatchCard) return;

	const playerId = p.dataset.playerId;
	if (!playerId) return;

	window.location.hash = `#/player/${playerId}`;
});

/* ========================================================================
 * 4. ROUTER
 * ========================================================================
 * 	The router reads window.location.hash and determines which page to load.
 *  Routes supported:
 *
 *   #/tournaments                              (home)
 *   #/leagues                                  (country → tournaments)
 *
 *   #/friendlies                               (friendlies overview)
 *   #/friendlies/new                           (create friendly)
 *
 *   #/tournament/<tid>?tab=<tab>               (unified overview)
 *   #/tournament/<tid>/manage-matches
 *   #/tournament/<tid>/match/<mid>/sets        (set-entry screen)
 *
 *   #/match/<mid>/<tid>                        (match detail)
 *
 *   #/player/<pid>?tab=<tab>                   (player profile)
 *
 *  If no route matches, the router defaults to #/tournaments.
 * ======================================================================== */


/**
 * Parse and resolve the current route.
 */
function handleRoute() {
	console.log("handleRoute start", window.location.hash);
	const raw = window.location.hash || "#/tournaments";
	const withoutHash = raw.replace(/^#/, "");   // remove leading "#"

	// Split path and query string
	const [pathPart, queryString] = withoutHash.split("?");

	// Remove empty entries (caused by leading "/")
	const parts = pathPart.split("/").filter(Boolean);  

	const params = new URLSearchParams(queryString || "");

	/* --------------------------------------------------------------------
 * 4.1 TOURNAMENTS HOME (DAILY VIEW)
 * #/tournaments
 * -------------------------------------------------------------------- */
if (parts[0] === "tournaments") {
	loadTournamentList();
	return;
}

/* --------------------------------------------------------------------
 * 4.2 LEAGUES MENU
 * #/leagues
 * -------------------------------------------------------------------- */
if (parts[0] === "leagues") {
	loadTournamentsMenu();
	return;
}

/* --------------------------------------------------------------------
 * 4.3 FRIENDLIES
 * #/friendlies
 * #/friendlies/new
 * -------------------------------------------------------------------- */
if (parts[0] === "friendlies" && !parts[1]) {
	loadFriendlyOverview();
	return;
}

if (parts[0] === "friendlies" && parts[1] === "new") {
	loadFriendlyCreate();
	return;
}

/* --------------------------------------------------------------------
 * 4.4 MATCH DETAIL (MUST COME EARLY)
 * #/match/<mid>/<tid>
 * -------------------------------------------------------------------- */
if (parts[0] === "match" && parts[1] && parts[2]) {
	loadMatchDetail(parts[1], parts[2]);
	return;
}

/* --------------------------------------------------------------------
 * 4.5 TOURNAMENT → MANAGE MATCHES
 * #/tournament/<tid>/manage-matches
 * -------------------------------------------------------------------- */
if (
	parts[0] === "tournament" &&
	parts[1] &&
	parts[2] === "manage-matches"
) {
	loadTournamentMatchesManage(parts[1]);
	return;
}

/* --------------------------------------------------------------------
 * 4.6 TOURNAMENT → MATCH → SET ENTRY
 * #/tournament/<tid>/match/<mid>/sets
 * -------------------------------------------------------------------- */
if (
	parts[0] === "tournament" &&
	parts[1] &&
	parts[2] === "match" &&
	parts[3] &&
	parts[4] === "sets"
) {
	loadTournamentMatchSets(parts[3], parts[1]);
	return;
}

/* --------------------------------------------------------------------
 * 4.7 TOURNAMENT → OVERVIEW (STRICT)
 * #/tournament/<tid>?tab=<tab>&date=<date>
 * -------------------------------------------------------------------- */
if (
	parts[0] === "tournament" &&
	parts[1] &&
	!parts[2]
) {
	const tid = parts[1];
	const tab = params.get("tab");
	const date = params.get("date") || null;

	window.tournamentContext.activeDate = date;

	if (tab) {
		window.tournamentContext.activeOverviewTab = tab;
	} else if (!window.tournamentContext.activeOverviewTab) {
		window.tournamentContext.activeOverviewTab = "standings";
	}

	loadTournamentOverview(tid);
	return;
}

/* --------------------------------------------------------------------
 * 4.8 PLAYER PROFILE
 * #/player/<pid>?tab=<tab>
 * -------------------------------------------------------------------- */
if (parts[0] === "player" && parts[1]) {
	loadPlayerPage(parts[1], params.get("tab") || "overview");
	return;
}

/* --------------------------------------------------------------------
 * 4.9 FALLBACK → HOME
 * -------------------------------------------------------------------- */
loadTournamentList();

}

/* ========================================================================
 * 5 LOAD TOURNAMENTS
 * ======================================================================== */

async function loadTournaments() {
    showBackButton(null);
    updateScoreButtonVisibility(false);
    setAddFriendlyVisible(false);

    showLoading("Loading tournaments…");

	const { data: matches, error } = await supabase
		.from("matches")
		.select(`
			id,
			match_date,
			tournament:tournament_id ( id, name, country )
		`)
		.order("match_date", { ascending: true });

    if (error) {
        showError("Failed to load tournaments.");
        return;
    }

    setContent(`
        <div class="card">
            <div class="tournament-header">
                <div class="tournament-name">Tournaments</div>
            </div>

            <div id="tournament-list"></div>
        </div>
    `);

    const list = document.getElementById("tournament-list");

    if (!data || data.length === 0) {
        list.innerHTML = `<div class="empty-message">No tournaments found.</div>`;
        return;
    }

    list.innerHTML = data.map(t => `
        <div class="card clickable tournament-card" data-tid="${t.id}">
            <div class="tournament-name-row">
                ${flagEmoji(t.country)} ${t.name}
            </div>
        </div>
    `).join("");

    // click → tournament overview
	list.querySelectorAll(".tournament-card").forEach(card => {
		card.addEventListener("click", () => {
			const tid = card.dataset.tid;
			const name = card.dataset.name || "";

			linkToTournament(tid, name);
		});
	});
}


/* ========================================================================
 * 5.1 TOURNAMENT LIST (HOME)
 * ========================================================================
 * 	Display the list of tournaments, grouped by date.
 * 	This is the default landing page: #/tournaments
 * ======================================================================== */

async function loadTournamentList() {
	showBackButton(null);
	updateScoreButtonVisibility(false);
	setAddFriendlyVisible(false);
	
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const todayKey = today.toISOString().split("T")[0];

	showLoading("Loading tournaments…");

	const { data: matches, error } = await supabase
	.from("matches")
	.select(`
		id,
		match_date,
		tournament:tournament_id ( id, name, country )
	`)
	.order("match_date", { ascending: true });

	const tournaments = matches || [];
	
	const matchesByDate = {};

	matches.forEach(m => {
		const d = new Date(m.match_date);
		d.setHours(0, 0, 0, 0);

		const key = d.toISOString().split("T")[0];
		if (!matchesByDate[key]) matchesByDate[key] = [];
		matchesByDate[key].push(m);
	});
	

	const matchDateSet = new Set();

	// Include dates from matches
	matches.forEach(m => {
	const d = new Date(m.match_date);
	d.setHours(0, 0, 0, 0);
	matchDateSet.add(d.toISOString().split("T")[0]);
	});
	
	const matchDates = Array.from(matchDateSet).sort();

	const pastDates = matchDates.filter(d => d < todayKey);
	const futureDates = matchDates.filter(d => d > todayKey);
	
	const visiblePast = pastDates.slice(-5);
	const visibleFuture = futureDates.slice(0, 5);
	
	const visibleDates = [
	...visiblePast,
	todayKey,
	...visibleFuture
	];

	if (!tournaments.length) {
		setContent(`
			<div class="card">
				<div class="empty-message">No tournaments found.</div>
			</div>
		`);
		return;
	}

	/* --------------------------------------------------
	 * GROUP TOURNAMENTS BY DATE
	 * -------------------------------------------------- */
	const byDate = {};

	(matches || []).forEach(m => {
		if (!m.match_date || !m.tournament) return;

		const key = dateKey(m.match_date);
		if (!key) return;

		if (!byDate[key]) byDate[key] = [];
		byDate[key].push(m);
	});

	const dates = Object.keys(byDate).sort();

	/* --------------------------------------------------
	 * ACTIVE DATE (default = today, fallback = latest)
	 * -------------------------------------------------- */

	let activeDate =
		visibleDates.includes(todayKey)
			? todayKey
			: visibleDates[visibleDates.length - 1];


	/* --------------------------------------------------
	 * PAGE SCAFFOLD (DATE BAR + LIST)
	 * -------------------------------------------------- */
	setContent(`
		<div id="date-bar-wrapper">
			<div id="date-bar"></div>
		</div>

		<div id="tournament-list"></div>
	`);

	/* --------------------------------------------------
	 * RENDER DATE BAR
	 * -------------------------------------------------- */
	const dateBar = document.getElementById("date-bar");

	dateBar.innerHTML = visibleDates.map(key => {
	const d = new Date(key);
	const isToday = key === todayKey;

	const weekday = d.toLocaleDateString("en-GB", { weekday: "short" });
	const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

	return `
		<div class="date-pill ${isToday ? "active" : ""}"
			 data-date="${key}">
			<div class="date-weekday">${weekday}</div>
			<div class="date-sub">${date}</div>
		</div>
	`;

	}).join("");


	/* --------------------------------------------------
	 * RENDER TOURNAMENTS FOR DATE
	 * -------------------------------------------------- */
	function renderListForDate(dateKeyStr) {
		const list = document.getElementById("tournament-list");
		const items = byDate[dateKeyStr] || [];

		const todayKey = new Date().toISOString().split("T")[0];
		const isToday = dateKeyStr === todayKey;

		const seen = new Set();
		const rows = [];

		/* ---------------------------------------------
		 * 1. Normal tournaments (from matches)
		 * --------------------------------------------- */
		items.forEach(m => {
			if (!m.tournament) return;

			const tid = m.tournament.id;

			// 🔴 HARD EXCLUSION: Friendlies never come from match data
			if (tid === FRIENDLIES_TOURNAMENT_ID) return;

			if (seen.has(tid)) return;
			seen.add(tid);

			rows.push(`
				<div class="card clickable tournament-card"
					 data-tid="${tid}">
					<div class="title-row">
						<div class="title">
							${flagEmoji(m.tournament.country)} ${m.tournament.name}
						</div>
					</div>
				</div>
			`);
		});


		/* ---------------------------------------------
		 * 2. Friendlies — ALWAYS LAST (Today only)
		 * --------------------------------------------- */
		
		rows.push(`
			<div class="card clickable tournament-card"
				 data-tid="${FRIENDLIES_TOURNAMENT_ID}">
				<div class="title-row">
					<div class="title">Friendlies</div>
				</div>
			</div>
		`);
		

		/* ---------------------------------------------
		 * 3. Empty state
		 * --------------------------------------------- */
		if (!rows.length) {
			list.innerHTML = `<div class="empty-message">No tournaments.</div>`;
			return;
		}

		list.innerHTML = rows.join("");

		/* ---------------------------------------------
		 * 4. Click handling
		 * --------------------------------------------- */
		list.querySelectorAll(".tournament-card").forEach(card => {
			card.addEventListener("click", () => {
				const date = card.closest("[data-date]")?.dataset.date;

				if (date) {
					window.location.hash = `#/tournament/${card.dataset.tid}?tab=fixtures&date=${date}`;
				} else {
					linkToTournament(card.dataset.tid);
				}
			});
		});
	}

	renderListForDate(activeDate);

	/* --------------------------------------------------
	 * DATE BAR CLICK HANDLING
	 * -------------------------------------------------- */
	dateBar.querySelectorAll(".date-pill").forEach(pill => {
		pill.addEventListener("click", () => {
			const d = pill.dataset.date;
			if (!d) return;

			activeDate = d;

			dateBar.querySelectorAll(".date-pill").forEach(p =>
				p.classList.toggle("active", p.dataset.date === d)
			);

			renderListForDate(d);
		});
	});
}



/* ========================================================================
 * 6. TOURNAMENT MENU (BY COUNTRY)
 * ========================================================================
 * 	Display list of countries with tournaments, each navigates to its
 * 	list of tournaments. Route: #/leagues
 * ======================================================================== */

async function loadTournamentsMenu() {
	window.currentMatchId = null;
	window.currentTournamentId = null;
	window.lastSeenSet = null;

	showBackButton(() => window.location.hash = "#/tournaments");
	updateScoreButtonVisibility(false);
	setAddFriendlyVisible(false);

	showLoading("Loading leagues…");

	const { data: tournaments, error } = await supabase
		.from("tournaments")
		.select("id, name, country")
		.order("country", { ascending: true })
		.order("name", { ascending: true });

	if (error) {
		showError("Failed to load leagues.");
		return;
	}

	if (!tournaments || tournaments.length === 0) {
		setContent(`
			<div class="card">
				<div class="subtitle">No leagues available.</div>
			</div>
		`);
		return;
	}

	// Group tournaments by country
	const grouped = {};
	for (const t of tournaments) {
		const c = t.country || "Unknown";
		if (!grouped[c]) grouped[c] = [];
		grouped[c].push(t);
	}

	let html = `<div id="league-list">`;

	for (const [country, list] of Object.entries(grouped)) {
		const flag = flagEmoji(country);

		html += `
			<div class="card league-card">
				<div class="league-title">${flag} ${country}</div>
				<div class="league-tournaments">
		`;

		html += list
			.map(t => `
			<div class="league-tournament clickable"
				 data-tid="${t.id}"
				 data-name="${t.name}">
				${t.name}
			</div>
		`)
			.join("");

		html += `
				</div>
			</div>
		`;
	}

	html += `</div>`;
	setContent(html);

	document.querySelectorAll(".league-tournament").forEach(card => {
		card.addEventListener("click", (ev) => {
			ev.preventDefault();
			ev.stopPropagation();

			const tid = card.dataset.tid;
			const name = card.dataset.name;

			if (!tid) return;

			if (name === "Friendlies") {
				window.location.hash = "#/friendlies";
				return;
			}
			
			console.log("FRIENDLIES HANDLER FIRED");

			window.location.hash = `#/tournament/${tid}`;
		});
	});

}

/* ========================================================================
 * 7. TOURNAMENT OVERVIEW (UNIFIED TABS)
 * ========================================================================
 * 	This is the main tournament page, showing tabs for:
 *   - overview (optional / deprecated)
 *   - standings
 *   - fixtures
 *   - results
 *
 *  Route: #/tournament/<tid>?tab=<tab>
 *
 *  The page always uses the same outer structure and swaps tab bodies.
 * ======================================================================== */

async function loadTournamentOverview(tournamentId) {
	window.currentTournamentId = tournamentId;
	window.currentMatchId = null;
	window.lastSeenSet = null;

	showBackButton(() => { window.location.hash = "#/tournaments"; });
	updateScoreButtonVisibility(false);
	setAddFriendlyVisible(false);

	showLoading("Loading tournament…");

	/* --------------------------------------------------------------------
	 * 7.1 Fetch tournament basic info
	 * -------------------------------------------------------------------- */
	const { data: tournament, error: tErr } = await supabase
		.from("tournaments")
		.select("id, name, country")
		.eq("id", tournamentId)
		.maybeSingle();

	if (tErr || !tournament) {
		showError("Tournament not found.");
		return;
	}

	const flag = flagEmoji(tournament.country);

	/* --------------------------------------------------------------------
	 * 7.2 Outer page scaffold
	 * -------------------------------------------------------------------- */
	setContent(`
		<div class="card" id="tournament-page">

			<div class="tournament-header">
				<div class="tournament-name">${flag} ${tournament.name}</div>
			</div>

			<div class="tab-row" id="tournament-tabs">
				<div class="tab" data-tab="standings">Standings</div>
				<div class="tab" data-tab="fixtures">Fixtures</div>
				<div class="tab" data-tab="results">Results</div>
			</div>

			<div id="tab-standings" class="tournament-tab-body" style="display:none;"></div>
			<div id="tab-fixtures"  class="tournament-tab-body" style="display:none;"></div>
			<div id="tab-results"   class="tournament-tab-body" style="display:none;"></div>

		</div>
	`);

	/* --------------------------------------------------------------------
	 * 7.3 Bind tab switching
	 * -------------------------------------------------------------------- */
	document.querySelectorAll("#tournament-tabs .tab").forEach(tabEl => {
		tabEl.addEventListener("click", () => {
			const tab = tabEl.dataset.tab;
			window.location.hash = `#/tournament/${tournamentId}?tab=${tab}`;
		});
	});

	/* --------------------------------------------------------------------
	 * 7.4 Render appropriate tab
	 * -------------------------------------------------------------------- */
	const activeTab = window.tournamentContext.activeOverviewTab || "standings";
	await renderTournamentTab(tournamentId, activeTab);
}

/* ========================================================================
 * 8 TOURNAMENT STANDINGS — FETCH + PASS TO renderStandingsTable()
 * ======================================================================== */

async function renderTournamentStandings(tournamentId) {

	const container = document.getElementById("tab-standings");
	if (!container) return;

	container.innerHTML = `<div class="subtitle">Loading standings…</div>`;

	/* -----------------------------------------------------------
	 * 1. Fetch matches for this tournament
	 * ----------------------------------------------------------- */
	const { data: matches, error: mErr } = await supabase
		.from("matches")
		.select(`
			id,
			status,
			final_sets_player1,
			final_sets_player2,
			player1:player1_id ( id, name, country ),
			player2:player2_id ( id, name, country )
		`)
		.eq("tournament_id", tournamentId);

	if (mErr || !matches) {
		container.innerHTML = `<div class="error">Failed to load matches.</div>`;
		return;
	}

	/* -----------------------------------------------------------
	 * 2. Fetch sets for these matches
	 * ----------------------------------------------------------- */
	const matchIds = matches.map(m => m.id);
	let sets = [];

	if (matchIds.length > 0) {
		const { data: sData, error: sErr } = await supabase
			.from("sets")
			.select("*")
			.in("match_id", matchIds);

		if (sErr) {
			container.innerHTML = `<div class="error">Failed to load sets.</div>`;
			return;
		}

		sets = sData;
	}

	/* -----------------------------------------------------------
	 * 3. Render standings table using YOUR function directly
	 * ----------------------------------------------------------- */
	renderStandingsTable(matches, sets, container);
}


/* ========================================================================
 * 8.5 RENDER A SPECIFIC TAB
 * ======================================================================== */

async function renderTournamentTab(tournamentId, tab) {
	// Hide all bodies first
	document.querySelectorAll(".tournament-tab-body").forEach(el => el.style.display = "none");

	// Update active tab state
	window.tournamentContext.activeOverviewTab = tab;

	// Highlight active tab
	document.querySelectorAll("#tournament-tabs .tab").forEach(el => {
		el.classList.toggle("active", el.dataset.tab === tab);
	});

	// Load tab content
	if (tab === "standings") {
		await renderTournamentStandings(tournamentId);
		document.getElementById("tab-standings").style.display = "block";
		return;
	}

	if (tab === "fixtures") {
		await renderTournamentFixtures(tournamentId);
		document.getElementById("tab-fixtures").style.display = "block";
		return;
	}

	if (tab === "results") {
		await renderTournamentResults(tournamentId);
		document.getElementById("tab-results").style.display = "block";
		return;
	}
}

/* ========================================================================
 * 9. STANDINGS TAB
 * ========================================================================
 * 	Display standings for the tournament.
 * 	Clicking a player name opens their profile page.
 * ======================================================================== */

function renderStandingsTable(matches, sets, container) {
	if (!container) return;

	// ---------------------------------------------------------
	// Build match index by ID for fast lookup
	// ---------------------------------------------------------
	const matchesById = {};
	matches.forEach(m => {
		if (m.id) matchesById[m.id] = m;
	});

	// ---------------------------------------------------------
	// Player accumulator
	// ---------------------------------------------------------
	const playerStats = {};

	function ensurePlayer(id, name, country) {
		if (!playerStats[id]) {
			playerStats[id] = {
				id,
				name,
				country,
				played: 0,
				setsWon: 0,
				setsLost: 0,
				smallPoints: 0
			};
		}
	}

	// ---------------------------------------------------------
	// Count played matches
	// ---------------------------------------------------------
	matches.forEach(m => {
		if (!m.player1?.id || !m.player2?.id) return;
		if (m.status === "scheduled") return;

		ensurePlayer(m.player1.id, m.player1.name, m.player1.country);
		ensurePlayer(m.player2.id, m.player2.name, m.player2.country);

		playerStats[m.player1.id].played += 1;
		playerStats[m.player2.id].played += 1;
	});

	// ---------------------------------------------------------
	// Aggregate set results
	// ---------------------------------------------------------
	sets.forEach(s => {
		if (!s.match_id || !s.winner_player_id) return;
		const m = matchesById[s.match_id];
		if (!m) return;

		const p1Id = m.player1.id;
		const p2Id = m.player2.id;

		ensurePlayer(p1Id, m.player1.name, m.player1.country);
		ensurePlayer(p2Id, m.player2.name, m.player2.country);

		const winner = s.winner_player_id;
		const loser = winner === p1Id ? p2Id : p1Id;

		const winnerScore = winner === p1Id ? s.score_player1 : s.score_player2;
		const loserScore  = winner === p1Id ? s.score_player2 : s.score_player1;

		playerStats[winner].setsWon += 1;
		playerStats[loser].setsLost += 1;

		playerStats[winner].smallPoints += winnerScore ?? 0;
		playerStats[loser].smallPoints  += loserScore ?? 0;
	});

	// ---------------------------------------------------------
	// Sort standings
	// ---------------------------------------------------------
	const standings = Object.values(playerStats).sort((a, b) => {
		if (b.setsWon !== a.setsWon) return b.setsWon - a.setsWon;
		if (b.smallPoints !== a.smallPoints) return b.smallPoints - a.smallPoints;
		return a.name.localeCompare(b.name);
	});

	if (!standings.length) {
		container.innerHTML = `<div class="empty-message">No results yet.</div>`;
		return;
	}

	// ---------------------------------------------------------
	// Build HTML
	// ---------------------------------------------------------
	container.innerHTML = `
		<table class="standings-table">
			<thead>
				<tr>
					<th style="text-align:center;" class="pos">Pos</th>
					<th style="text-align:left;">Player</th>
					<th style="text-align:center;">P</th>
					<th style="text-align:center;">S+</th>
					<th style="text-align:center;">S-</th>
					<th style="text-align:center;">Pts</th>
				</tr>
			</thead>
			<tbody>
				${standings.map((p, index) => {
					const flag = p.country ? flagPNG(p.country) : "";
					return `
						<tr data-pos="${index + 1}">
							<td class="pos" style="text-align:center;">${index + 1}</td>
							<td class="player-cell" style="text-align:left;">
								<span class="player-link" data-player-id="${p.id}">
									${flag} ${p.name}
								</span>
							</td>
							<td style="text-align:center;">${p.played}</td>
							<td style="text-align:center; font-weight: bold;">${p.setsWon}</td>
							<td style="text-align:center;">${p.setsLost}</td>
							<td style="text-align:center;">${p.smallPoints}</td>
						</tr>
					`;
				}).join("")}
			</tbody>
		</table>
	`;

	// ---------------------------------------------------------
	// Wire up player name links
	// ---------------------------------------------------------
	container.querySelectorAll(".player-link").forEach(link => {
		link.addEventListener("click", ev => {
			ev.stopPropagation();
			const pid = link.dataset.playerId;
			window.location.hash = `#/player/${pid}`;
		});
	});
}

/* ========================================================================
 * 10. FIXTURES TAB
 * ========================================================================
 * 	Show upcoming matches. Clicking a card loads match detail.
 * ======================================================================== */

async function renderTournamentFixtures(tournamentId) {
	const el = document.getElementById("tab-fixtures");
	el.innerHTML = `<div class="subtitle">Loading fixtures…</div>`;

	const { data: matches, error } = await supabase
		.from("matches")
		.select(`
			id,
			match_date,
			player1:player1_id ( id, name, country ),
			player2:player2_id ( id, name, country ),
			status
		`)
		.eq("tournament_id", tournamentId)
		.eq("status", "scheduled")
		.order("match_date", { ascending: true });

	if (error) {
		el.innerHTML = `<div class="error">Failed to load fixtures.</div>`;
		return;
	}

	if (!matches || matches.length === 0) {
		el.innerHTML = `<div class="empty-message">No upcoming fixtures.</div>`;
		return;
	}

	const html = matches
	.map(m => renderMatchCard(m, tournamentId))
	.join("");

	el.innerHTML = html;

	// Card linking
	el.querySelectorAll(".match-card").forEach(card => {
		card.addEventListener("click", () => {
			window.location.hash = `#/match/${card.dataset.mid}/${card.dataset.tid}`;
		});
	});
}

/* ========================================================================
 * 11. RESULTS TAB
 * ========================================================================
 * 	Shows finished matches. Clicking opens match detail.
 * ======================================================================== */

async function renderTournamentResults(tournamentId) {
	const el = document.getElementById("tab-results");
	el.innerHTML = `<div class="subtitle">Loading results…</div>`;

	const { data: matches, error } = await supabase
		.from("matches")
		.select(`
			id,
			match_date,
			status,
			final_sets_player1,
			final_sets_player2,
			player1:player1_id ( id, name, country ),
			player2:player2_id ( id, name, country )
		`)
		.eq("tournament_id", tournamentId)
		.eq("status", "finished")
		.order("match_date", { ascending: false });

	if (error) {
		el.innerHTML = `<div class="error">Failed to load results.</div>`;
		return;
	}

	if (!matches || matches.length === 0) {
		el.innerHTML = `<div class="empty-message">No results available.</div>`;
		return;
	}

		const html = matches
	.map(m => renderMatchCard(m, tournamentId))
	.join("");

	el.innerHTML = html;

	// Card linking
	el.querySelectorAll(".match-card").forEach(card => {
		card.addEventListener("click", () => {
			window.location.hash = `#/match/${card.dataset.mid}/${card.dataset.tid}`;
		});
	});
}

/* ========================================================================
 * 12. MATCH DETAIL PAGE
 * ========================================================================
 *  Route: #/match/<mid>/<tid>
 *
 *  Responsibilities:
 *   - Load match + related players + tournament
 *   - Display score, sets, throw history
 *   - Allow navigation to scoring console
 *
 *  External dependencies:
 *   - resetScoringStateForMatch(match, sets)   [scoring.js]
 *   - openScoringConsole()                     [scoring.js]
 *   - updateLiveThrowsForSet()                 [scoring.js]
 * ======================================================================== */

async function loadMatchDetail(matchId, tournamentId) {
	window.currentMatchId = matchId;
	window.currentTournamentId = tournamentId;
	window.lastSeenSet = null;

	showBackButton(() => {
	window.location.hash = `#/tournament/${tournamentId}?tab=daily`;
	});

	updateScoreButtonVisibility(true);
	setAddFriendlyVisible(false);

	showLoading("Loading match…");

	// --- Load match record ---
	const { data: match, error: matchError } = await supabase
		.from("matches")
		.select(
			`
  id,
  match_date,
  status,
  final_sets_player1,
  final_sets_player2,
  player1:player1_id ( id, name ),
  player2:player2_id ( id, name ),
  tournament:tournament_id ( id, name )
`
		)
		.eq("id", matchId)
		.maybeSingle();

	if (matchError || !match) {
		console.error(matchError);
		showError("Failed to load match");
		return;
	}

	// --- Load sets ---
	const { data: sets, error: setsError } = await supabase
		.from("sets")
		.select("*")
		.eq("match_id", matchId)
		.order("set_number", { ascending: true });

	if (setsError) {
		console.error(setsError);
		showError("Failed to load sets");
		return;
	}

	// --- Load throws ---
	const { data: throws, error: throwsError } = await supabase
		.from("throws")
		.select("*")
		.eq("match_id", matchId)
		.order("set_number", { ascending: true })
		.order("throw_number", { ascending: true });

	if (throwsError) {
		console.error(throwsError);
		showError("Failed to load throws");
		return;
	}

	// Group throws by set_number for easy lookup later
	const throwsBySet = {};
	(throws || []).forEach((t) => {
		if (!throwsBySet[t.set_number]) throwsBySet[t.set_number] = [];
		throwsBySet[t.set_number].push(t);
	});

	const p1Name = match.player1?.name || "Player 1";
	const p2Name = match.player2?.name || "Player 2";
	const tournamentName = match.tournament?.name || "Tournament";

	// Status pill
	let pillClass = "scheduled";
	let pillLabel = "Scheduled";
	if (match.status === "live") {
		pillClass = "live";
		pillLabel = "Live";
	} else if (match.status === "finished") {
		pillClass = "finished";
		pillLabel = "Finished";
	}

	const overallSets = `${match.final_sets_player1 ?? 0} – ${
		match.final_sets_player2 ?? 0
	}`;

	// Determine live set (for header + throwstrip only)
	let currentSet = null;
	if (sets && sets.length > 0) {
		currentSet = sets.find(
			(s) =>
				!s.winner_player_id &&
				(s.score_player1 ?? 0) < 50 &&
				(s.score_player2 ?? 0) < 50
		);
	}

	const liveSP1 = currentSet ? currentSet.score_player1 ?? 0 : 0;
	const liveSP2 = currentSet ? currentSet.score_player2 ?? 0 : 0;

	// --- Render header + skeleton for sets ---
	const html = `
<div class="card top-card">
  <div class="subtitle">
	<span class="nav-link" onclick="linkToTournament('${tournamentId}')">
		${tournamentName}
	</span>
</div>

  <div class="top-score-row">
	<span style="text-align: right;" class="match-header-player" data-player-id="${match.player1?.id}">
		${match.player1?.name || "Player 1"}
	</span>
	<div class="top-score">${overallSets}</div>
	<span class="match-header-player" data-player-id="${match.player2?.id}">
		${match.player2?.name || "Player 2"}
	</span>
  </div>

  <div class="live-throwstrip-row">
	<div class="live-throwstrip p1" id="header-throws-p1"></div>
	<div class="live-setscore" id="header-live-setscore">${liveSP1} – ${liveSP2}</div>
	<div class="live-throwstrip p2" id="header-throws-p2"></div>
  </div>

  <div class="match-small" style="text-align:center;">
	${formatDate(match.match_date)}
  </div>
  <div class="match-small" style="text-align:center;">
	<span class="pill ${pillClass}">${pillLabel}</span>
  </div>
</div>

<div class="card" id="match-detail">
  <div class="tab-row">
	<div class="tab active" data-tab="sets">Sets</div>
  </div>
  <div id="tab-sets"></div>
</div>
`;

	setContent(html);

	// Keep scoring console in sync
	if (SUPERADMIN) {
		resetScoringStateForMatch(match, sets || []);
	}

	const setsContainer = document.getElementById("tab-sets");
	if (!sets || sets.length === 0) {
		setsContainer.innerHTML =
			'<div class="empty-message">No sets recorded for this match yet.</div>';
		return;
	}

	// --- Build the sets list with EMPTY expanded panels ---
	let setsHtml = `<div class="sets-wrapper">`;
	let cumSetP1 = 0;
	let cumSetP2 = 0;

	sets.forEach((s) => {
		const setNum = s.set_number;
		const p1Score = s.score_player1;
		const p2Score = s.score_player2;

		const p1Win = p1Score === 50 && p2Score < 50;
		const p2Win = p2Score === 50 && p1Score < 50;

		if (p1Win) cumSetP1++;
		if (p2Win) cumSetP2++;

		const cumDisplay = `${cumSetP1}–${cumSetP2}`;

		setsHtml += `
  <div class="set-block" data-set="${setNum}">
	<div class="set-main-row" data-set="${setNum}">
	  <div class="col left ${p1Win ? "winner" : ""}">${p1Score}</div>
	  <div class="col mid">${cumDisplay}</div>
	  <div class="col right ${p2Win ? "winner" : ""}">${p2Score}</div>
	</div>
	<div class="set-throws-expanded" data-set="${setNum}" style="display:none;"></div>
  </div>
`;
	});

	setsHtml += `</div>`;
	setsContainer.innerHTML = setsHtml;

	// --- Click handler: lazily build the throws table on expand ---
	document.querySelectorAll(".set-main-row").forEach((row) => {
		row.addEventListener("click", () => {
			const setNum = Number(row.getAttribute("data-set"));
			const expanded = document.querySelector(
				`.set-throws-expanded[data-set="${setNum}"]`
			);
			if (!expanded) return;

			const isOpen = expanded.style.display === "block";

			// Close all others
			document
				.querySelectorAll(".set-throws-expanded")
				.forEach((el) => {
					el.style.display = "none";
				});

			if (isOpen) {
				// Already open → now closed
				expanded.style.display = "none";
				return;
			}

			// Build model from raw throws for THIS set
			const raw = throwsBySet[setNum] || [];
			const model = buildThrowsModel(
				raw,
				match.player1?.id,
				match.player2?.id
			);

			expanded.innerHTML = model.length
				? buildThrowsTableHTML(model, p1Name, p2Name)
				: '<div class="empty-message">No throw history for this set.</div>';

			expanded.style.display = "block";
		});
	});

	// Score button opens scoring console
	if (scoreBtn) {
		scoreBtn.onclick = openScoringConsole;
	}

	// Ensure header live set score stays in sync
	const headerSetScoreEl = document.getElementById(
		"header-live-setscore"
	);
	if (headerSetScoreEl) {
		headerSetScoreEl.textContent = `${liveSP1} – ${liveSP2}`;
	}

	// Only the live set drives the header throwstrip
	if (currentSet) {
		updateLiveThrowsForSet(currentSet.set_number);
	}
	renderBottomBar();
	updateBottomBarActive();
}



/* ========================================================================
 * 13. RENDER MATCH SETS LIST
 * ========================================================================
 *  Displays a card for every set:
 *   - 50–X or X–50 winners
 *   - unfinished set marked appropriately
 * ======================================================================== */

async function renderMatchSets(matchId) {
	const el = document.getElementById("sets-container");
	if (!el) return;

	el.innerHTML = `<div class="subtitle">Loading sets…</div>`;

	const { data: sets, error } = await supabase
		.from("sets")
		.select("*")
		.eq("match_id", matchId)
		.order("set_number", { ascending: true });

	if (error) {
		el.innerHTML = `<div class="error">Failed to load sets.</div>`;
		return;
	}

	if (!sets || sets.length === 0) {
		el.innerHTML = `<div class="empty-message">No sets recorded.</div>`;
		return;
	}

	const html = sets.map(s => {
		const num = s.set_number;
		const sp1 = s.score_player1 || 0;
		const sp2 = s.score_player2 || 0;

		const decided = !!s.winner_player_id;
		const score = `${sp1}–${sp2}`;

		return `
			<div class="set-row">
				<div class="set-number">Set ${num}</div>
				<div class="set-score ${decided ? "set-final" : "set-live"}">${score}</div>
			</div>
		`;
	}).join("");

	el.innerHTML = `
		<div class="sets-list">
			${html}
		</div>
	`;
}


/* ========================================================================
 * 14. UPDATE OVERALL MATCH SCORE
 * ========================================================================
 *  Called by scoring.js after one player wins a set.
 *  Refreshes the header score in the match detail page.
 * ======================================================================== */

async function updateOverallMatchScore() {
	if (!window.currentMatchId) return;

	const matchId = window.currentMatchId;

	const { data: match, error } = await supabase
		.from("matches")
		.select("final_sets_player1, final_sets_player2")
		.eq("id", matchId)
		.maybeSingle();

	if (error || !match) return;

	const scoreEl = document.querySelector("#match-detail-page .match-score-large");
	if (scoreEl) {
		scoreEl.textContent = `${match.final_sets_player1}–${match.final_sets_player2}`;
	}
}


/* ========================================================================
 * 15. UPDATE LIVE THROWS FOR SET  (CALLED BY scoring.js)
 * ========================================================================
 *  Displays throw history for a single set.
 *  scoring.js handles modelling (via buildThrowsModel).
 * ======================================================================== */

async function updateLiveThrowsForSet(setNumber) {
	const container = document.getElementById("throws-container");
	if (!container) return;

	if (!window.currentMatchId) {
		container.innerHTML = "";
		return;
	}

	const matchId = window.currentMatchId;

	container.innerHTML = `
		<div class="subtitle">Set ${setNumber} Throws</div>
		<div class="throws-list">Loading…</div>
	`;

	/* --------------------------------------------------------------------
	 * 15.1 Fetch throws
	 * -------------------------------------------------------------------- */
	const { data: throws, error } = await supabase
		.from("throws")
		.select("*")
		.eq("match_id", matchId)
		.eq("set_number", setNumber)
		.order("throw_number", { ascending: true });

	if (error) {
		container.innerHTML = `<div class="error">Failed to load throws.</div>`;
		return;
	}

	/* --------------------------------------------------------------------
	 * 15.2 Build throw model (delegated to scoring.js)
	 * -------------------------------------------------------------------- */
	const p1Id = window.scoringMatch?.p1Id;
	const p2Id = window.scoringMatch?.p2Id;

	let model = [];
	if (typeof buildThrowsModel === "function") {
		model = buildThrowsModel(throws, p1Id, p2Id);
	}

	if (!model || model.length === 0) {
		container.innerHTML = `<div class="empty-message">No throws yet.</div>`;
		return;
	}

	/* --------------------------------------------------------------------
	 * 15.3 Render throw list
	 * -------------------------------------------------------------------- */
	const rows = model.map(row => `
		<div class="throw-row">
			<div class="throw-num">#${row.num}</div>
			<div class="throw-p1">${row.isP1 ? row.score : ""}</div>
			<div class="throw-p2">${!row.isP1 ? row.score : ""}</div>
			<div class="throw-total">${row.cumP1}–${row.cumP2}</div>
		</div>
	`).join("");

	container.innerHTML = `
		<div class="throws-list">
			${rows}
		</div>
	`;
}

/* expose globally for scoring.js compatibility */
window.updateOverallMatchScore = updateOverallMatchScore;
window.updateLiveThrowsForSet = updateLiveThrowsForSet;

/* ========================================================================
 * 16. PLAYER PROFILE PAGE
 * ========================================================================
 *  Route: #/player/<pid>?tab=<overview|fixtures|results|teams>
 *
 *  Responsibilities:
 *   - Load player record
 *   - Load all matches involving this player
 *   - Provide tabbed profile view:
 *       • Overview   – static info + summary
 *       • Fixtures   – upcoming matches
 *       • Results    – finished matches
 *       • Teams      – (placeholder for future team logic)
 *
 *  External dependencies:
 *   - flagPNG(countryCode)
 *   - formatDate(dateStr)
 *   - loadMatchDetail(mid, tid)
 * ======================================================================== */

async function loadPlayerPage(playerId, tabFromRoute = "overview") {
	window.currentMatchId = null;
	window.currentTournamentId = null;
	window.lastSeenSet = null;

	showBackButton(() => {
		window.location.hash = "#/tournaments";
	});

	updateScoreButtonVisibility(false);
	setAddFriendlyVisible(false);

	showLoading("Loading player…");

	// 16.1 Load player record
	const { data: player, error: pErr } = await supabase
		.from("players")
		.select("id, name, country, is_guest")
		.eq("id", playerId)
		.maybeSingle();

	if (pErr || !player) {
		showError("Player not found.");
		return;
	}

	// 16.2 Load all matches involving this player
	const { data: matches, error: mErr } = await supabase
		.from("matches")
		.select(`
			id,
			match_date,
			status,
			final_sets_player1,
			final_sets_player2,
			player1:player1_id ( id, name, country ),
			player2:player2_id ( id, name, country ),
			tournament:tournament_id ( id, name )
		`)
		.or(`player1_id.eq.${playerId},player2_id.eq.${playerId}`)
		.order("match_date", { ascending: false });

	const allMatches = matches || [];

	// 16.3 Determine active tab (route param overrides saved)
	const savedTab = localStorage.getItem(`playerTab_${player.id}`) || "overview";
	const activeTab = tabFromRoute || savedTab || "overview";

	// 16.4 Store context
	window.playerContext = {
		player,
		matches: allMatches,
		activeTab
	};

	// 16.5 Render page scaffold
	setContent(`
		<div class="card" id="player-page">

			<div class="tournament-header">
				<div class="tournament-name">
					${flagPNG(player.country)} ${player.name}
				</div>
				<div class="subtitle">Player profile</div>
			</div>

			<div class="tab-row" id="player-tabs">
				<div class="tab" data-tab="overview">Overview</div>
				<div class="tab" data-tab="fixtures">Fixtures</div>
				<div class="tab" data-tab="results">Results</div>
				<div class="tab" data-tab="teams">Teams</div>
			</div>

			<div id="player-overview" style="display:none;"></div>
			<div id="player-fixtures" style="display:none;"></div>
			<div id="player-results" style="display:none;"></div>
			<div id="player-teams" style="display:none;"></div>

		</div>
	`);

	// 16.6 Wire up tab clicks → update hash (router will re-call loadPlayerPage)
	document.querySelectorAll("#player-page .tab").forEach(tabEl => {
		tabEl.addEventListener("click", (ev) => {
			ev.preventDefault();
			ev.stopPropagation();

			const tab = tabEl.dataset.tab || "overview";

			// Extract clean player ID from current hash
			const h = window.location.hash;      // "#/player/<pid>?tab=..."
			const pid = h.split("/")[2].split("?")[0];

			// Persist preferred tab for this player
			localStorage.setItem(`playerTab_${pid}`, tab);

			// Update URL → router reloads → correct tab loads
			window.location.hash = `#/player/${pid}?tab=${tab}`;
		});
	});

	// 16.7 Initial tab render
	window.playerContext.activeTab = activeTab;
}


/* ========================================================================
 * 17. PLAYER PROFILE TABS RENDERING
 * ======================================================================== */

function renderPlayerTabs() {
	const ctx = window.playerContext;
	if (!ctx) return;

	// 17.1 Update tab button active state
	document.querySelectorAll("#player-tabs .tab").forEach(t => {
		t.classList.toggle("active", t.dataset.tab === ctx.activeTab);
	});

	// 17.2 Hide all panels
	document
		.querySelectorAll("#player-overview, #player-fixtures, #player-results, #player-teams")
		.forEach(el => el.style.display = "none");

	// 17.3 Show selected panel
	const panel = document.getElementById(`player-${ctx.activeTab}`);
	if (panel) panel.style.display = "block";

	// 17.4 Render tab content
	if (ctx.activeTab === "overview") renderPlayerOverviewPanel(ctx);
	if (ctx.activeTab === "fixtures") renderPlayerFixturesPanel(ctx);
	if (ctx.activeTab === "results") renderPlayerResultsPanel(ctx);
	if (ctx.activeTab === "teams") renderPlayerTeamsPanel(ctx);
}


/* ------------------------------------------------------------------------
 * 17.1 Overview tab
 * ------------------------------------------------------------------------ */

function renderPlayerOverviewPanel(ctx) {
	const p = ctx.player;

	const el = document.getElementById("player-overview");
	if (!el) return;

	el.innerHTML = `
		<div class="overview-grid">
			<div class="overview-item">
				<div class="label">Name</div>
				<div class="value">${p.name}</div>
			</div>
			<div class="overview-item">
				<div class="label">Country</div>
				<div class="value">${p.country || "—"}</div>
			</div>
			<div class="overview-item">
				<div class="label">Guest</div>
				<div class="value">${p.is_guest ? "Yes" : "No"}</div>
			</div>
			<div class="overview-item">
				<div class="label">Matches played</div>
				<div class="value">${ctx.matches.length}</div>
			</div>
		</div>
	`;
}


/* ------------------------------------------------------------------------
 * 17.2 Results tab
 * ------------------------------------------------------------------------ */

function renderPlayerResultsPanel(ctx) {
	const el = document.getElementById("player-results");
	if (!el) return;

	const finished = ctx.matches.filter(m => m.status === "finished");

	if (!finished.length) {
		el.innerHTML = `<div class="empty-message">No results yet.</div>`;
		return;
	}

	const playerId = ctx.player.id;

	el.innerHTML = finished.map(m => {
		const isP1 = m.player1.id === playerId;
		const opponent = isP1 ? m.player2 : m.player1;

		const oppFlag = flagPNG(opponent.country);

		const scoreFor = isP1 ? m.final_sets_player1 : m.final_sets_player2;
		const scoreAgainst = isP1 ? m.final_sets_player2 : m.final_sets_player1;

		const dateLabel = formatDate(m.match_date);
		const tournamentName = m.tournament?.name || "";

		// W / D / L pill
		let pillClass = "pill-blue";
		let pillText = "D";
		if (scoreFor > scoreAgainst) {
			pillClass = "pill-green";
			pillText = "W";
		} else if (scoreFor < scoreAgainst) {
			pillClass = "pill-red";
			pillText = "L";
		}

		return `
			<div class="card clickable player-match-card"
				data-mid="${m.id}"
				data-tid="${m.tournament.id}">

				<div class="pm-row-1">
					<div class="pm-opponent">
						${oppFlag} ${opponent.name}
					</div>

					<div class="pm-middle">
						<div class="pm-score">${scoreFor}–${scoreAgainst}</div>
						<div class="pm-pill ${pillClass}">${pillText}</div>
					</div>
				</div>

				<div class="pm-subrow">${dateLabel} • ${tournamentName}</div>
			</div>
		`;
	}).join("");

	// Make result cards clickable → match detail
	list.querySelectorAll(".tournament-card").forEach(card => {
		card.addEventListener("click", () => {
			const tid = card.dataset.tid;
			const name = card.dataset.name || "";

			linkToTournament(tid, name);
		});
	});
}


/* ------------------------------------------------------------------------
 * 17.3 Fixtures tab
 * ------------------------------------------------------------------------ */

function renderPlayerFixturesPanel(ctx) {
	const el = document.getElementById("player-fixtures");
	if (!el) return;

	const upcoming = ctx.matches.filter(m => m.status === "scheduled");

	if (!upcoming.length) {
		el.innerHTML = `<div class="empty-message">No upcoming fixtures.</div>`;
		return;
	}

	const playerId = ctx.player.id;

	el.innerHTML = upcoming.map(m => {
		const isP1 = m.player1.id === playerId;
		const opponent = isP1 ? m.player2 : m.player1;

		const oppFlag = opponent.country ? flagPNG(opponent.country) : "";

		const dateLabel = formatDate(m.match_date);
		const tournamentName = m.tournament?.name || "";

		return `
			<div class="card clickable player-match-card"
				data-mid="${m.id}"
				data-tid="${m.tournament.id}">

				<div class="pm-row-1">
					<div class="pm-opponent">
						${oppFlag} ${opponent.name}
					</div>

					<div class="pm-score upcoming">–</div>
					<div class="pm-pill pm-pill-scheduled">–</div>
				</div>

				<div class="pm-subrow">
					${dateLabel} • ${tournamentName}
				</div>
			</div>
		`;
	}).join("");

	// Make fixture cards clickable → match detail
	el.querySelectorAll("[data-mid]").forEach(card => {
		card.addEventListener("click", () => {
			const mid = card.dataset.mid;
			const tid = card.dataset.tid;
			window.location.hash = `#/match/${mid}/${tid}`;
		});
	});
}


/* ------------------------------------------------------------------------
 * 17.4 Teams tab
 * ------------------------------------------------------------------------ */

function renderPlayerTeamsPanel(ctx) {
	const el = document.getElementById("player-teams");
	if (!el) return;

	// Teams system not implemented yet — placeholder
	el.innerHTML = `
		<div class="empty-message">
			Teams will be added later.
		</div>
	`;
}


/* ========================================================================
 * 18. GLOBAL PLAYER LINK HANDLER
 * ========================================================================
 *  Any element with .player-link[data-player-id="<uuid>"] will navigate
 *  to that player's profile.
 * ======================================================================== */

document.addEventListener("click", (ev) => {
	const link = ev.target.closest(".player-link");
	if (!link) return;

	const pid = link.dataset.playerId;
	if (!pid) return;

	ev.preventDefault();
	ev.stopPropagation();

	window.location.hash = `#/player/${pid}`;
});

/* ========================================================================
 * 19. TOURNAMENT MATCH MANAGEMENT PAGE
 * ========================================================================
 *  Route: #/tournament/<tid>/manage-matches
 *
 *  Responsibilities:
 *   - List all matches for a tournament (simple admin view)
 *   - Provide "Add match" form restricted to tournament players
 *
 *  Notes:
 *   - Relies on window.tournamentPlayers (set in tournament overview)
 *   - Uses wireManageMatchAdd() for the form behaviour
 * ======================================================================== */

async function loadTournamentMatchesManage(tournamentId) {
	window.currentMatchId = null;
	window.currentTournamentId = tournamentId;
	window.lastSeenSet = null;

	showBackButton(() => {
		window.location.hash = `#/tournament/${tournamentId}?tab=manage`;
	});

	updateScoreButtonVisibility(false);
	setAddFriendlyVisible(false);

	showLoading("Loading matches…");

	// 19.1 Load tournament (for header)
	const { data: tournament, error: tErr } = await supabase
		.from("tournaments")
		.select("id, name, country")
		.eq("id", tournamentId)
		.maybeSingle();

	if (tErr || !tournament) {
		showError("Tournament not found.");
		return;
	}

	// 19.2 Load matches for this tournament
	const { data: matches, error: mErr } = await supabase
		.from("matches")
		.select(`
			id,
			match_date,
			status,
			final_sets_player1,
			final_sets_player2,
			player1:player1_id ( id, name ),
			player2:player2_id ( id, name )
		`)
		.eq("tournament_id", tournamentId)
		.order("match_date", { ascending: true });

	if (mErr) {
		console.error(mErr);
		showError("Failed to load matches.");
		return;
	}

	// 19.3 Render page
	setContent(`
		<div class="card" id="manage-matches-page">

			<div class="tournament-header">
				<div class="tournament-name">
					${flagPNG(tournament.country)} ${tournament.name}
				</div>
				<div class="subtitle">Manage matches</div>
			</div>

			<div class="manage-section">
				<div class="section-title">Add match</div>

				<div class="manage-match-form">
					<div class="form-row">
						<label>Player 1</label>
						<input id="mm-p1" type="text" autocomplete="off" />
						<div id="mm-p1-suggestions" class="friendly-suggestions"></div>
					</div>

					<div class="form-row">
						<label>Player 2</label>
						<input id="mm-p2" type="text" autocomplete="off" />
						<div id="mm-p2-suggestions" class="friendly-suggestions"></div>
					</div>

					<div class="form-row">
						<label>Date &amp; time</label>
						<input id="mm-date" type="datetime-local" />
					</div>

					<div id="mm-error" class="error" style="display:none;"></div>

					<div class="form-actions">
						<button id="mm-add-btn" class="header-btn">
							Add match
						</button>
					</div>
				</div>
			</div>

			<div class="manage-section">
				<div class="section-title">Existing matches</div>
				<div id="manage-matches-list"></div>
			</div>

		</div>
	`);

	// 19.4 Render matches list
	renderManageMatchesList(matches || []);

	// 19.5 Wire form behaviour
	wireManageMatchAdd();
}


/* ------------------------------------------------------------------------
 * 19.1 Render matches list (simple admin view)
 * ------------------------------------------------------------------------ */

function renderManageMatchesList(matches) {
	const listEl = document.getElementById("manage-matches-list");
	if (!listEl) return;

	if (!matches || !matches.length) {
		listEl.innerHTML = `<div class="empty-message">No matches yet.</div>`;
		return;
	}

	const rows = matches.map(m => {
		const p1 = m.player1?.name || "Player 1";
		const p2 = m.player2?.name || "Player 2";
		const dateLabel = formatDate(m.match_date);

		const sets1 = m.final_sets_player1 ?? 0;
		const sets2 = m.final_sets_player2 ?? 0;

		const status = m.status || "scheduled";

		return `
			<div class="card clickable manage-match-row"
				data-mid="${m.id}"
				data-tid="${m.tournament_id || window.currentTournamentId}">

				<div class="mm-main">
					<div class="mm-players">
						<span>${p1}</span>
						<span class="mm-vs">vs</span>
						<span>${p2}</span>
					</div>

					<div class="mm-score">
						${sets1}–${sets2}
					</div>
				</div>

				<div class="mm-sub">
					<span>${dateLabel || ""}</span>
					<span class="mm-status">${status}</span>
				</div>
			</div>
		`;
	}).join("");

	listEl.innerHTML = rows;

	// Click → go to match detail
	listEl.querySelectorAll(".manage-match-row").forEach(row => {
		row.addEventListener("click", () => {
			const mid = row.dataset.mid;
			const tid = row.dataset.tid || window.currentTournamentId;
			if (!mid || !tid) return;
			window.location.hash = `#/match/${mid}/${tid}`;
		});
	});
}


/* ========================================================================
 * 20. ADD MATCH FORM (MANAGE VIEW)
 * ========================================================================
 *  Uses tournamentPlayers (window.tournamentPlayers) for suggestions.
 * ======================================================================== */

function wireManageMatchAdd() {
	const p1Input = document.getElementById("mm-p1");
	const p2Input = document.getElementById("mm-p2");
	const dateInput = document.getElementById("mm-date");
	const p1Sug = document.getElementById("mm-p1-suggestions");
	const p2Sug = document.getElementById("mm-p2-suggestions");
	const btn = document.getElementById("mm-add-btn");
	const err = document.getElementById("mm-error");

	if (!btn || !p1Input || !p2Input || !dateInput || !err) return;

	const tournamentPlayers = window.tournamentPlayers || [];
	const allowedPlayerIds = tournamentPlayers.map((p) => p.id);

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

		const matches = tournamentPlayers.filter((p) =>
			(p.name || "").toLowerCase().includes(q)
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

		// If user picked from suggestions we already have the id
		if (inputEl.dataset.playerId) {
			return inputEl.dataset.playerId;
		}

		const name = (inputEl.value || "").trim().toLowerCase();
		if (!name) return null;

		const found = tournamentPlayers.find(
			(p) => (p.name || "").toLowerCase() === name
		);
		return found ? found.id : null;
	}

	// Typeahead wiring
	p1Input.addEventListener("input", () => buildSuggestions(p1Input, p1Sug));
	p2Input.addEventListener("input", () => buildSuggestions(p2Input, p2Sug));

	btn.onclick = async () => {
		showErr("");

		const dateVal = dateInput.value;
		if (!dateVal) {
			showErr("Please select a date and time.");
			return;
		}

		const p1Id = findPlayerIdByInput(p1Input);
		const p2Id = findPlayerIdByInput(p2Input);

		if (!p1Id || !p2Id) {
			showErr("Both players must already be part of this tournament.");
			return;
		}

		if (!allowedPlayerIds.includes(p1Id) || !allowedPlayerIds.includes(p2Id)) {
			showErr("Both players must already be part of this tournament.");
			return;
		}

		if (p1Id === p2Id) {
			showErr("Players must be different.");
			return;
		}

		try {
			const { error } = await supabase.from("matches").insert({
				tournament_id: window.currentTournamentId,
				edition_id: window.tournamentContext?.editionId || null,
				stage_id: window.tournamentContext?.stageId || null,
				player1_id: p1Id,
				player2_id: p2Id,
				match_date: new Date(dateVal).toISOString(),
				status: "scheduled",
			});

			if (error) throw error;

			// Clear form
			p1Input.value = "";
			p2Input.value = "";
			dateInput.value = "";
			p1Input.dataset.playerId = "";
			p2Input.dataset.playerId = "";
			if (p1Sug) p1Sug.innerHTML = "";
			if (p2Sug) p2Sug.innerHTML = "";

			// Reload matches list in-place
			await loadTournamentMatchesManage(window.currentTournamentId);
		} catch (e) {
			console.error(e);
			showErr("Failed to create match.");
		}
	};
}


/* ========================================================================
 * 21. STAGE REORDERING (MANAGE TAB)
 * ========================================================================
 *  Called from "move up/down" controls in the stages list.
 *  Swaps order_index of two stages in the same edition.
 * ======================================================================== */

async function reorderStage(stageId, direction) {
	// Load current stage
	const { data: current, error } = await supabase
		.from("stages")
		.select("id, edition_id, order_index")
		.eq("id", stageId)
		.maybeSingle();

	if (error || !current) return;

	// Find neighbour in the desired direction
	const matcher =
		direction === "up"
			? supabase
				.from("stages")
				.select("*")
				.eq("edition_id", current.edition_id)
				.lt("order_index", current.order_index)
				.order("order_index", { ascending: false })
				.limit(1)
			: supabase
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
	await supabase
		.from("stages")
		.update({ order_index: other.order_index })
		.eq("id", current.id);

	await supabase
		.from("stages")
		.update({ order_index: current.order_index })
		.eq("id", other.id);

	// Reload overview for current tournament context
	if (window.currentTournamentId) {
		loadTournamentOverview(window.currentTournamentId);
	}
}

/* ========================================================================
 * 22. MATCH SET ENTRY PAGE (Manual Input)
 * ========================================================================
 *  Route: #/tournament/<tid>/match/<mid>/sets
 *
 *  Responsibilities:
 *   - Allow manual correction or entry of set scores
 *   - Integrate with scoring.js model
 *   - Provide UI scaffolding for each set
 *
 *  External dependencies:
 *   - scoring.js (start-set logic, scoring state handlers)
 *   - updateLiveThrowsForSet() (for historical correction)
 * ======================================================================== */

async function loadTournamentMatchSets(matchId, tournamentId) {
	window.currentMatchId = matchId;
	window.currentTournamentId = tournamentId;
	window.lastSeenSet = null;

	showBackButton(() => {
		window.location.hash = `#/match/${matchId}/${tournamentId}`;
	});

	updateScoreButtonVisibility(false);
	setAddFriendlyVisible(false);

	showLoading("Loading set editor…");

	/* --------------------------------------------------------------------
	 * 22.1 Load match
	 * -------------------------------------------------------------------- */
	const { data: match, error: mErr } = await supabase
		.from("matches")
		.select(`
			id,
			status,
			match_date,
			player1:player1_id ( id, name, country ),
			player2:player2_id ( id, name, country ),
			final_sets_player1,
			final_sets_player2,
			tournament:tournament_id ( id, name )
		`)
		.eq("id", matchId)
		.maybeSingle();

	if (mErr || !match) {
		showError("Match not found.");
		return;
	}

	const p1 = match.player1;
	const p2 = match.player2;

	const f1 = flagPNG(p1.country);
	const f2 = flagPNG(p2.country);

	const date = formatDate(match.match_date);

	/* --------------------------------------------------------------------
	 * 22.2 Load sets
	 * -------------------------------------------------------------------- */
	const { data: sets, error: sErr } = await supabase
		.from("sets")
		.select("*")
		.eq("match_id", matchId)
		.order("set_number", { ascending: true });

	if (sErr) {
		showError("Failed to load sets.");
		return;
	}

	/* --------------------------------------------------------------------
	 * 22.3 Render page
	 * -------------------------------------------------------------------- */
	setContent(`
		<div class="card" id="set-editor-page">

			<div class="match-detail-header">
				<div class="match-title-row">
					<div>${f1} ${p1.name}</div>
					<div class="match-score-large">
						${match.final_sets_player1}–${match.final_sets_player2}
					</div>
					<div>${f2} ${p2.name}</div>
				</div>

				<div class="match-sub">${date} • ${match.tournament?.name || ""}</div>
				<div class="match-status">Manual set entry</div>
			</div>

			<div id="set-editor-container"></div>

		</div>
	`);

	renderSetEditor(sets);
}


/* ========================================================================
 * 23. RENDER SET EDITOR (LIST OF SETS)
 * ======================================================================== */

function renderSetEditor(sets = []) {
	const container = document.getElementById("set-editor-container");
	if (!container) return;

	if (!sets.length) {
		container.innerHTML = `<div class="empty-message">No sets yet.</div>`;
		return;
	}

	const html = sets.map(s => {
		const id = s.id;
		const num = s.set_number;
		const sp1 = s.score_player1 ?? 0;
		const sp2 = s.score_player2 ?? 0;

		return `
			<div class="set-edit-row" data-set-id="${id}">
				<div class="set-edit-number">Set ${num}</div>

				<div class="set-edit-input">
					<label>P1</label>
					<input type="number" class="set-sp1" value="${sp1}" />
				</div>

				<div class="set-edit-input">
					<label>P2</label>
					<input type="number" class="set-sp2" value="${sp2}" />
				</div>

				<button class="set-save-btn header-btn small">Save</button>
			</div>
		`;
	}).join("");

	container.innerHTML = `
		<div class="set-edit-list">
			${html}
		</div>
	`;

	// Wire up save buttons
	container.querySelectorAll(".set-edit-row").forEach(row => {
		const btn = row.querySelector(".set-save-btn");
		btn.addEventListener("click", () => saveSetRow(row));
	});
}


/* ========================================================================
 * 24. SAVE A SINGLE SET ROW
 * ======================================================================== */

async function saveSetRow(row) {
	const setId = row.dataset.setId;
	const sp1 = parseInt(row.querySelector(".set-sp1")?.value || "0", 10);
	const sp2 = parseInt(row.querySelector(".set-sp2")?.value || "0", 10);

	if (!setId) return;

	try {
		await supabase
			.from("sets")
			.update({
				score_player1: sp1,
				score_player2: sp2
			})
			.eq("id", setId);

		showToast("Set saved.");
	} catch (e) {
		console.error(e);
		showError("Failed to save set.");
	}
}

/* ========================================================================
 * 25. FRIENDLY MATCH LIST / CREATE SCREEN
 * ========================================================================
 *  Routes:
 *    #/friendlies
 *    #/friendlies/new
 *
 *  Responsibilities:
 *   - Provide a standalone, always-available tournament container
 *   - Allow adding friendlies without editions or stages
 *   - Reuse match detail and scoring views
 * ======================================================================== */

const FRIENDLIES_TOURNAMENT_ID = "11111111-1111-1111-1111-111111111111";


/* ========================================================================
 * 25.1 Friendly Matches Overview (acts like a tournament overview)
 * ======================================================================== */

async function loadFriendlyOverview() {
	window.currentMatchId = null;
	window.currentTournamentId = FRIENDLIES_TOURNAMENT_ID;
	window.lastSeenSet = null;

	showBackButton(() => window.location.hash = "#/tournaments");
	updateScoreButtonVisibility(false);
	setAddFriendlyVisible(true);

	showLoading("Loading friendlies…");

	/* Friendlies don't have editions or stages. We treat them as:
	   tournament_id = FRIENDLIES_TOURNAMENT_ID
	*/

	const { data: matches, error } = await supabase
		.from("matches")
		.select(`
			id,
			match_date,
			status,
			final_sets_player1,
			final_sets_player2,
			player1:player1_id ( id, name, country ),
			player2:player2_id ( id, name, country )
		`)
		.eq("tournament_id", FRIENDLIES_TOURNAMENT_ID)
		.order("match_date", { ascending: false });

	if (error) {
		showError("Failed to load friendlies.");
		return;
	}

	setContent(`
		<div class="card" id="friendlies-page">

			<div class="tournament-header">
				<div class="tournament-name">Friendlies</div>
				<div class="subtitle">All friendly matches</div>
			</div>

			<div id="friendlies-list"></div>
		</div>
	`);

	renderFriendliesList(matches || []);
}


/* ========================================================================
 * 25.2 Render Friendlies List
 * ======================================================================== */

function renderFriendliesList(list) {
	const el = document.getElementById("friendlies-list");
	if (!el) return;

	if (!list.length) {
		el.innerHTML = `<div class="empty-message">No friendlies yet.</div>`;
		return;
	}

	el.innerHTML = list.map(m => {
		const p1 = m.player1;
		const p2 = m.player2;

		return `
			<div class="card clickable friendly-row"
				data-mid="${m.id}"
				data-tid="${FRIENDLIES_TOURNAMENT_ID}">

				<div class="friendly-main">
					<div class="friendly-names">
						${flagPNG(p1.country)} ${p1.name}
						<span class="friendly-vs">vs</span>
						${flagPNG(p2.country)} ${p2.name}
					</div>

					<div class="friendly-score">
						${m.final_sets_player1 ?? 0}–${m.final_sets_player2 ?? 0}
					</div>
				</div>

				<div class="friendly-sub">${formatDate(m.match_date)}</div>
			</div>
		`;
	}).join("");

	el.querySelectorAll(".friendly-row").forEach(row => {
		row.addEventListener("click", () => {
			const mid = row.dataset.mid;
			const tid = row.dataset.tid;
			window.location.hash = `#/match/${mid}/${tid}`;
		});
	});
}


/* ========================================================================
 * 26. FRIENDLY CREATION FORM
 * ======================================================================== */

async function loadFriendlyCreate() {
	window.currentMatchId = null;
	window.currentTournamentId = FRIENDLIES_TOURNAMENT_ID;
	window.lastSeenSet = null;

	showBackButton(() => window.location.hash = "#/friendlies");
	updateScoreButtonVisibility(false);
	setAddFriendlyVisible(false);

	setContent(`
		<div class="card" id="friendly-create">
			<div class="tournament-header">
				<div class="tournament-name">New Friendly</div>
				<div class="subtitle">Create a friendly match</div>
			</div>

			<div class="friendly-form">
				<div class="form-row">
					<label>Player 1</label>
					<input id="fr-p1" />
					<div id="fr-p1-sug" class="friendly-suggestions"></div>
				</div>

				<div class="form-row">
					<label>Player 2</label>
					<input id="fr-p2" />
					<div id="fr-p2-sug" class="friendly-suggestions"></div>
				</div>

				<div class="form-row">
					<label>Date</label>
					<input id="fr-date" type="datetime-local" />
				</div>

				<div id="fr-error" class="error" style="display:none;"></div>

				<div class="form-actions">
					<button id="fr-create-btn" class="header-btn">
						Create Friendly
					</button>
				</div>
			</div>
		</div>
	`);

	wireFriendlyForm();
}


/* ========================================================================
 * 27. Friendly Creation Logic
 * ======================================================================== */

function wireFriendlyForm() {
	const p1 = document.getElementById("fr-p1");
	const p2 = document.getElementById("fr-p2");
	const dateInput = document.getElementById("fr-date");
	const sug1 = document.getElementById("fr-p1-sug");
	const sug2 = document.getElementById("fr-p2-sug");
	const btn = document.getElementById("fr-create-btn");
	const err = document.getElementById("fr-error");

	if (!btn) return;

	function showErr(msg) {
		if (!msg) {
			err.style.display = "none";
			err.textContent = "";
		} else {
			err.style.display = "block";
			err.textContent = msg;
		}
	}

	// Basic autocompletion from the "players" database
	async function runAutocomplete(inputEl, sugEl) {
		const q = (inputEl.value || "").trim().toLowerCase();
		if (!q) {
			sugEl.innerHTML = "";
			return;
		}

		const { data } = await supabase
			.from("players")
			.select("id, name")
			.ilike("name", `%${q}%`)
			.limit(5);

		sugEl.innerHTML = "";
		(data || []).forEach(p => {
			const item = document.createElement("div");
			item.className = "friendly-suggestion-item";
			item.textContent = p.name;
			item.dataset.playerId = p.id;

			item.onclick = () => {
				inputEl.value = p.name;
				inputEl.dataset.playerId = p.id;
				sugEl.innerHTML = "";
			};

			sugEl.appendChild(item);
		});
	}

	p1.oninput = () => runAutocomplete(p1, sug1);
	p2.oninput = () => runAutocomplete(p2, sug2);

	btn.onclick = async () => {
		showErr("");

		const p1Id = p1.dataset.playerId || null;
		const p2Id = p2.dataset.playerId || null;
		const dateVal = dateInput.value;

		if (!p1Id || !p2Id) {
			showErr("Both players must exist in the system.");
			return;
		}
		if (p1Id === p2Id) {
			showErr("Players must be different.");
			return;
		}
		if (!dateVal) {
			showErr("Please enter a date.");
			return;
		}

		try {
			await supabase.from("matches").insert({
				tournament_id: FRIENDLIES_TOURNAMENT_ID,
				player1_id: p1Id,
				player2_id: p2Id,
				match_date: new Date(dateVal).toISOString(),
				status: "scheduled",
				final_sets_player1: 0,
				final_sets_player2: 0,
			});

			window.location.hash = "#/friendlies";
		} catch (e) {
			console.error(e);
			showErr("Failed to create friendly.");
		}
	};
}

/* ========================================================================
 * 28. UTILITY FUNCTIONS
 * ========================================================================
 *  A consolidated area for:
 *   - Flag helpers
 *   - Link helpers (player/tournament navigation)
 *   - Generic formatting utilities
 *   - Misc minor helpers used across app.js
 * ======================================================================== */


/* ------------------------------------------------------------------------
 * 28.1 Country Flag Helpers (PNG + Emoji)
 * ------------------------------------------------------------------------
 *  CURRENT STATE:
 *   - You use flagPNG() for players/tournaments
 *   - You also have flagEmoji() (kept for backwards compatibility)
 *
 *  LATER:
 *   - You said you want to migrate to:
 *       /img/flags/<Full Country Name>.png
 *   - That can be handled here once your assets exist.
 * ------------------------------------------------------------------------ */

function flagPNG(countryName) {
	if (!countryName) return "";
	const safe = countryName.toLowerCase().replace(/\s+/g, "-");
	return `<img class="flag-icon" src="img/flags/${safe}.png" alt="${countryName}">`;
}

function flagEmoji(code) {
	// Fallback for now; can be deleted once PNG assets are fully deployed
	if (!code || code.length !== 2) return "";
	const base = 127397;
	return String.fromCodePoint(code.charCodeAt(0) + base)
	     + String.fromCodePoint(code.charCodeAt(1) + base);
}

function renderMatchCard(m, tournamentId) {
	const p1 = m.player1;
	const p2 = m.player2;

	const p1Name = p1?.name || "—";
	const p2Name = p2?.name || "—";

	const dateLabel = formatDate(m.match_date);

	const setsScore1 = m.final_sets_player1 ?? "–";
	const setsScore2 = m.final_sets_player2 ?? "–";

	const status = m.status || "scheduled";

	let statusClass = "scheduled";
	let statusLabel = "Scheduled";

	if (status === "live") {
		statusClass = "live";
		statusLabel = "Live";
	}
	if (status === "finished") {
		statusClass = "finished";
		statusLabel = "Final";
	}

	// Live set boxes (placeholder until live logic reattached)
	const liveSet = status === "live";
	const liveP1 = "";
	const liveP2 = "";

	return `
		<div class="card clickable match-card"
		     data-mid="${m.id}"
		     data-tid="${tournamentId}">

			<div class="match-card-grid">

				<div class="mc-meta">${dateLabel}</div>

				<div class="mc-player">
					${flagPNG(p1.country)} ${p1Name}
				</div>

				<div class="mc-livebox ${liveSet ? "is-live" : ""}">
					${liveP1}
				</div>

				<div class="mc-setscore">${setsScore1}</div>

				<div class="mc-meta">
					<span class="pill ${statusClass}">${statusLabel}</span>
				</div>

				<div class="mc-player">
					${flagPNG(p2.country)} ${p2Name}
				</div>

				<div class="mc-livebox ${liveSet ? "is-live" : ""}">
					${liveP2}
				</div>

				<div class="mc-setscore">${setsScore2}</div>

			</div>
		</div>
	`;
}



/* ------------------------------------------------------------------------
 * 28.2 Navigation Helpers
 * ------------------------------------------------------------------------ */

function linkToPlayer(playerId, tab = "overview") {
	if (!playerId) return;
	window.location.hash = `#/player/${playerId}?tab=${tab}`;
}

function linkToTournament(tid) {
	if (!tid) return;

	// Friendlies special-case
	if (tid === FRIENDLIES_TOURNAMENT_ID) {
		window.location.hash = "#/friendlies";
		return;
	}

	window.location.hash = `#/tournament/${tid}`;
}


function linkToMatch(mid, tid) {
	if (!mid || !tid) return;
	window.location.hash = `#/match/${mid}/${tid}`;
}


/* ------------------------------------------------------------------------
 * 28.3 Formatting Helpers
 * ------------------------------------------------------------------------ */

function isoDateOnly(date) {
	if (!date) return "";
	const d = new Date(date);
	return d.toISOString().split("T")[0];
}

function toLocalDate(date) {
	if (!date) return "";
	return new Date(date).toLocaleDateString("en-GB");
}

function toLocalDateTime(date) {
	if (!date) return "";
	return new Date(date).toLocaleString("en-GB", {
		day: "numeric",
		month: "short",
		year: "2-digit",
		hour: "2-digit",
		minute: "2-digit"
	});
}

function dateKey(dateStr) {
	if (!dateStr) return null;
	const d = new Date(dateStr);
	return d.toISOString().split("T")[0]; // YYYY-MM-DD
}

function isToday(dateKeyStr) {
	const today = new Date().toISOString().split("T")[0];
	return dateKeyStr === today;
}

/* ------------------------------------------------------------------------
 * 28.4 UI Helpers
 * ------------------------------------------------------------------------ */

function showToast(msg) {
	if (!msg) return;

	const toast = document.createElement("div");
	toast.className = "toast";
	toast.textContent = msg;
	document.body.appendChild(toast);

	setTimeout(() => toast.classList.add("show"), 10);
	setTimeout(() => {
		toast.classList.remove("show");
		setTimeout(() => toast.remove(), 300);
	}, 2000);
}

function setAddFriendlyVisible(isVisible) {
	const btn = document.getElementById("add-friendly-btn");
	if (!btn) return;
	btn.style.display = isVisible ? "inline-flex" : "none";
}

/* ------------------------------------------------------------------------
 * 28.5 BOTTOM BAR HELPERS
 * ------------------------------------------------------------------------ */

function isMatchDetailView() {
	const raw = window.location.hash || "";
	const parts = raw.replace(/^#/, "").split("/").filter(Boolean);
	return parts.length === 3 && parts[0] === "match";
}

function canScoreCurrentMatch() {
	const raw = window.location.hash || "";
	const parts = raw.replace(/^#/, "").split("/").filter(Boolean);

	const result = {
		hash: raw,
		parts,
		currentMatchId: window.currentMatchId,
		isMatchRoute: parts[0] === "match" && parts[1] && parts[2],
		SUPERADMIN: typeof SUPERADMIN !== "undefined" ? SUPERADMIN : "undef"
	};

	console.log("canScoreCurrentMatch()", result);

	if (parts[0] !== "match") return false;
	if (!parts[1] || !parts[2]) return false;
	if (!window.currentMatchId) return false;

	if (typeof SUPERADMIN !== "undefined" && SUPERADMIN) return true;

	return false;
}


function updateBottomBarActive() {
	const hash = window.location.hash || "#/tournaments";

	document.querySelectorAll("#bottom-bar .nav-item").forEach(el => {
		el.classList.remove("active");

		const key = el.dataset.key;

		if (key === "today" && hash.startsWith("#/tournaments") && !hash.includes("/all")) {
			el.classList.add("active");
		}
		if (key === "tournaments" && hash.startsWith("#/tournaments/all")) {
			el.classList.add("active");
		}
		if (key === "leagues" && hash.startsWith("#/leagues")) {
			el.classList.add("active");
		}
		if (key === "add-friendly" && hash.startsWith("#/friendlies")) {
			el.classList.add("active");
		}
	});
}


/* ========================================================================
 * 29. HASH LISTENER + INITIAL BOOT
 * ======================================================================== */

window.addEventListener("hashchange", handleRoute);

// kick off initial route
handleRoute();
