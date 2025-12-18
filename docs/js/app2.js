// -------------------------------------------------------
// Fixed IDs / constants
// -------------------------------------------------------

const FRIENDLIES_TOURNAMENT_ID = "11111111-1111-1111-1111-111111111111";

// -------------------------------------------------------
// Global route / view state
// -------------------------------------------------------

window.currentMatchId = null;
window.currentTournamentId = null;
window.lastSeenSet = null;

// -------------------------------------------------------
// Tournament-scoped context (edition / stage aware)
// -------------------------------------------------------

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

window.tournamentContext.selectedBracketId ??= null;
window.tournamentContext.bracketRoundIndex ??= 0;

// =======================================================
// 2. LOW-LEVEL PURE HELPERS (NO DOM, NO SIDE EFFECTS)
// =======================================================

function isoDateOnly(iso) {
    if (!iso) return null;
    return iso.split("T")[0];
}

function isToday(dateStr) {
    return dateStr === new Date().toISOString().split("T")[0];
}

function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("en-GB", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

// =======================================================
// 3. GENERIC UI HELPERS & FLAG RENDERING
// =======================================================

/* DOM roots */

const contentEl = document.getElementById("content");
const backBtn = document.getElementById("back-btn");
const scoreBtn = document.getElementById("score-btn");
const addFriendlyBtn = document.getElementById("add-friendly-btn");

/* Content helpers */

function setContent(html) {
    if (!contentEl) return;
    contentEl.innerHTML = html;
}

function showLoading(message) {
    setContent(
        `<div class="card"><div class="empty-message">${message}</div></div>`
    );
}

function showError(message) {
    setContent(
        `<div class="card"><div class="error">${message}</div></div>`
    );
}

/* Header/global button helpers */

function showBackButton(handlerOrNull) {
    if (!backBtn) return;

    if (!handlerOrNull) {
        backBtn.style.display = "none";
        backBtn.onclick = null;
        return;
    }

    backBtn.style.display = "inline-block";
    backBtn.onclick = handlerOrNull;
}

function updateScoreButtonVisibility(show) {
    if (!scoreBtn) return;

    if (show && (typeof SUPERADMIN === "undefined" || SUPERADMIN)) {
        scoreBtn.style.display = "inline-flex";
    } else {
        scoreBtn.style.display = "none";
    }
}

function setAddFriendlyVisible(visible) {
    if (!addFriendlyBtn) return;
    addFriendlyBtn.style.display = visible ? "inline-flex" : "none";
}

/* Tournament links */

function linkToTournament(tId, label, tab = "standings") {
    return `<a href="#/tournament/${tId}?tab=${tab}" class="nav-link">${label}</a>`;
}

/* Flag helper */

function flagPNG(country) {
    if (!country) return "";

    const cc = country.trim().toLowerCase();

    // ISO-2 already
    if (/^[a-z]{2}$/.test(cc)) {
        return `<img class="flag-icon" src="assets/flags/${cc}.svg">`;
    }

    // Name → ISO mapping
    const nameToIso = {
        "great britain": "gb",
        "united kingdom": "gb",
        "finland": "fi",
        "france": "fr",
        "sweden": "se",
        "estonia": "ee",
        "norway": "no",
        "ireland": "ie",
        "usa": "us",
        "united states": "us",
    };

    const iso = nameToIso[cc];
    if (!iso) {
        return `<img class="flag-icon" src="/assets/flags/world.svg">`;
    }

    return `<img class="flag-icon" src="/assets/flags/${iso}.svg">`;
}

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

// =======================================================
// 4. AUTH, PERMISSIONS & ROLE HELPERS
// =======================================================

function renderAuthControls() {
  const container = document.getElementById("auth-controls");
  if (!container) return;

  container.innerHTML = "";

  if (!window.currentUser) {
    const btn = document.createElement("button");
    btn.className = "header-btn small";
    btn.textContent = "Log in";
    btn.onclick = openLoginModal;
    container.appendChild(btn);
    return;
  }

  // Logged in
  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.gap = "8px";
  wrapper.style.alignItems = "center";

  if (window.SUPERADMIN) {
    const badge = document.createElement("div");
    badge.className = "pill live";
    badge.textContent = "Admin";
    wrapper.appendChild(badge);
  }

  const logoutBtn = document.createElement("button");
  logoutBtn.className = "header-btn small secondary";
  logoutBtn.textContent = "Log out";
  logoutBtn.onclick = openLogoutConfirmModal;

  wrapper.appendChild(logoutBtn);
  container.appendChild(wrapper);
}


(async () => {
  if (!window.supabaseClient) {
    console.error("[init] supabaseClient missing");
    return;
  }

  if (typeof initAuth === "function") {
    await initAuth();
  }

  if (typeof initRealtimeSubscriptions === "function") {
    initRealtimeSubscriptions();
  }

  renderAuthControls();
})();

function isSuperAdmin() {
    return typeof SUPERADMIN !== "undefined" && SUPERADMIN === true;
}

function canManageTournament(tournament) {
    if (!tournament) return false;

    // SUPERADMIN can manage everything
    if (isSuperAdmin()) return true;

    // Extend later with tournament-specific roles if needed
    return false;
}

function canScoreMatch() {
  // Admins can always score, users only when match is live
  return (
    isSuperAdmin() ||
    (window.currentUser?.role === "user" &&
     typeof window.currentMatchId === "string")
  );
}

// =======================================================
// 5. TOURNAMENT PLAYER CACHE & BUILDERS
// =======================================================

// Global cache of players relevant to the *current* tournament
window.tournamentPlayers = [];

/**
 * Build tournamentPlayers from matches already loaded.
 * Used for autocomplete, validation, and match creation.
 */
function buildTournamentPlayers(matches) {
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

// =======================================================
// 6. PLAYER RESOLUTION & AUTOCOMPLETE HELPERS
// =======================================================

async function resolveOrCreatePlayerByName(
    name,
    { allowGuest = true } = {}
) {
    const clean = (name || "").trim();
    if (!clean) throw new Error("Player name required.");

    // Try exact match first
    const { data: existing } = await window.supabaseClient
        .from("players")
        .select("id, is_guest")
        .ilike("name", clean)
        .maybeSingle();

    if (existing?.id) {
        if (!allowGuest && existing.is_guest) {
            throw new Error("Guest players are not allowed here.");
        }
        return existing.id;
    }

    const isGuest = !clean.includes(" ");

    if (isGuest && !allowGuest) {
        throw new Error("Guest players are not allowed here.");
    }

    const { data, error } = await window.supabaseClient
        .from("players")
        .insert({
            name: clean,
            is_guest: isGuest,
        })
        .select("id")
        .maybeSingle();

    if (error || !data) {
        throw new Error("Failed to create player.");
    }

    return data.id;
}

/**
 * Generic autocomplete binder.
 * Expects a live player source function (e.g. tournamentPlayers).
 */
function attachPlayerAutocomplete(inputEl, suggestionsEl, playerSourceFn) {
    if (!inputEl || !suggestionsEl) return;

    inputEl.addEventListener("input", () => {
        const q = inputEl.value.trim().toLowerCase();
        suggestionsEl.innerHTML = "";
        if (!q) return;

        const players = playerSourceFn() || [];
        players
            .filter(p => (p.name || "").toLowerCase().includes(q))
            .slice(0, 5)
            .forEach(p => {
                const div = document.createElement("div");
                div.className = "friendly-suggestion-item";
                div.textContent = p.name;
                div.onclick = () => {
                    inputEl.value = p.name;
                    inputEl.dataset.playerId = p.id;
                    suggestionsEl.innerHTML = "";
                };
                suggestionsEl.appendChild(div);
            });
    });
}

// =======================================================
// 7. THROWS / SCORING MODEL HELPERS
// =======================================================

function buildThrowsModel(throws, player1Id, player2Id) {
    let cumP1 = 0;
    let cumP2 = 0;
    const model = [];

    (throws || []).forEach((t) => {
        const isP1 = t.player_id === player1Id;
        const raw = t.score ?? 0;
        const miss = raw === 0;
        const fault = t.is_fault === true;

        let before = isP1 ? cumP1 : cumP2;
        let displayScore = "";

        if (miss) {
            if (fault && before >= 37) {
                displayScore = "X↓";
                if (isP1) cumP1 = 25;
                else cumP2 = 25;
            } else {
                displayScore = "X";
            }
        } else {
            let tentative = before + raw;
            const bust = tentative > 50;
            if (bust) {
                displayScore = raw + "↓";
                if (isP1) cumP1 = 25;
                else cumP2 = 25;
            } else {
                displayScore = String(raw);
                if (isP1) cumP1 = tentative;
                else cumP2 = tentative;
            }
        }

        model.push({
            throw_number: t.throw_number,
            isP1,
            rawScore: raw,
            displayScore,
            cumP1,
            cumP2,
        });
    });

    return model;
}

function throwBoxHTML(raw) {
    const v = String(raw);
    let cls = "throw-box";
    if (v.includes("X")) cls += " miss";
    else if (v.includes("↓")) cls += " reset";
    return `<div class="${cls}">${v}</div>`;
}

// =======================================================
// 8. GENERIC UI HELPERS (LOADING, ERRORS, TABS, NAVIGATION)
// =======================================================

function bindOverviewTabs() {
  document.querySelectorAll(".tab-row .tab").forEach(tab => {
    tab.addEventListener("click", () => {
      const tabName = tab.dataset.tab;
      if (!tabName) return;

      // 1. Switch UI ONLY
      activateTab(tabName);

      // 2. Update URL silently (NO routing)
      const tid = window.currentTournamentId;
      history.replaceState(
        null,
        "",
        `#/tournament/${tid}?tab=${tabName}`
      );
    });
  });
}

function renderBottomBar() {
  const existing = document.getElementById("bottom-bar");
  if (existing) existing.remove();

	const canScore =
	  window.currentMatchId &&
	  window.SUPERADMIN === true;
	  
	const buttons = [];

	if (canScore) {
	  buttons.push({
		id: "score",
		label: "Score",
		icon: "icon-score.svg",
		onClick: () => {
		  openScoringConsole();
		}
	  });
	}

	const canManage =
	  !window.currentMatchId &&
	  !!window.currentTournament &&
	  canManageTournament(window.currentTournament);
	  
	const isFriendlies =
	window.currentTournamentId === FRIENDLIES_TOURNAMENT_ID;

	const canAddFriendly =
	  isFriendlies &&
	  !window.currentMatchId;

	  
	if (
	  window.currentTournament &&
	  canManageTournament(window.currentTournament)
	) {
	  buttons.push({
		id: "manage",
		label: "Manage",
		icon: "icon-manage.svg",
		onClick: () => {
		  window.location.hash =
			`#/tournament/${window.currentTournament.id}/overview?tab=manage`;
		}
	  });
	}
	
  const bar = document.createElement("div");
  bar.id = "bottom-bar";

  bar.innerHTML = `
    <div class="bottom-bar-inner">

      <button class="bb-item" data-action="today">
        <img src="assets/icon-today.svg" alt="" />
        <span>Today</span>
      </button>

      <button class="bb-item" data-action="tournaments">
        <img src="assets/icon-tournaments.svg" alt="" />
        <span>Tournaments</span>
      </button>

      ${
        canScore
          ? `
        <button class="bb-item" data-action="score">
          <img src="assets/icon-score.svg" alt="" />
          <span>Score</span>
        </button>
      `
          : ""
      }
	  
	${
	canAddFriendly
		? `
	  <button class="bb-item" data-action="add-friendly">
		<img src="assets/icon-add.svg" alt="" />
		<span>Add friendly</span>
	  </button>
	`
		: ""
	}

      ${
        canManage
          ? `
        <button class="bb-item" data-action="manage">
          <img src="assets/icon-manage.svg" alt="" />
          <span>Manage</span>
        </button>
      `
          : ""
      }

    </div>
  `;

  document.body.appendChild(bar);

  // ---- Wiring ----
  bar.querySelectorAll(".bb-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;

		if (action === "today") {
		  window.location.hash = "#/tournaments";
		}

		if (action === "tournaments") {
		  window.location.hash = "#/leagues";
		}

		if (action === "add-friendly" && canAddFriendly) {
		  window.location.hash = "#/friendlies/new";
		}

		if (action === "score" && canScore) {
		  openScoringConsole();
		}

		if (action === "manage" && canManage) {
		  window.location.hash =
			`#/tournament/${window.currentTournamentId}/overview?tab=manage`;
		}
    });
  });
}


function updateBottomBar() {
  const ctx = {
    canScore: !!window.currentMatchId && isSuperAdmin(),
    canManage:
      window.currentTournamentId &&
      canManageTournament(window.currentTournament),
    matchId: window.currentMatchId,
    tournamentId: window.currentTournamentId,
  };

  renderBottomBar(ctx);
}

function activateTab(tabName) {
    if (!tabName) return;

    // Tabs
    document.querySelectorAll(".tab-row .tab").forEach(t => {
        t.classList.toggle("active", t.dataset.tab === tabName);
    });

    // Panels
    document.querySelectorAll("[id^='tab-']").forEach(el => {
        el.style.display = "none";
    });

    const active = document.getElementById(`tab-${tabName}`);
    if (active) active.style.display = "block";

    // Persist state
    window.tournamentContext.activeOverviewTab = tabName;

    // === DATE BAR VISIBILITY (single source of truth) ===
    const dateBar = document.getElementById("date-bar");
    if (dateBar) {
        dateBar.style.display = tabName === "daily" ? "flex" : "none";
    }
}

function updateDailyTabLabel(dateStr) {
    const tab = document.querySelector('.tab[data-tab="daily"]');
    if (!tab) return;

    const today = new Date().toISOString().split("T")[0];

    if (!dateStr || dateStr === today) {
        tab.textContent = "Today";
        return;
    }

    const label = new Date(dateStr).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "2-digit",
        month: "short",
    });

    tab.textContent = label;
}


// =======================================================
// 9. HEADER CONTROLS & GLOBAL BUTTONS
// =======================================================

// =======================================================
// 10. TOURNAMENT CONTEXT & GLOBAL VIEW STATE
// =======================================================

window.currentUser = {
  name: "Guest",
  role: "guest", // "guest" | "user" | "admin"
};

// =======================================================
// 10a. TOURNAMENTS MENU
// =======================================================

async function loadTournaments() {
	window.currentMatchId = null;
	window.currentTournamentId = null;
	window.lastSeenSet = null;

	const dateBar = document.getElementById("date-bar");
	if (dateBar) dateBar.style.display = "flex";

	showBackButton(null);
	updateScoreButtonVisibility(false);
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

// =======================================================
// 11. TOURNAMENT SELECTORS (EDITION / STAGE)
// =======================================================

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

document.addEventListener("click", (ev) => {
    const el = ev.target.closest(".match-header-player");
    if (!el) return;

    ev.preventDefault();
    ev.stopPropagation();

    const pid = el.dataset.playerId;
    if (!pid) return;

    window.location.hash = `#/player/${pid}`;
});

document.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".tab-btn");
    if (!btn) return;

    const page = btn.closest("#player-page");
    if (!page) return;

    const tab = btn.dataset.tab;

    // Extract pid safely
    const h = window.location.hash;      // "#/player/<pid>?tab=..."
    const pid = h.split("/")[2].split("?")[0]; // keep only the UUID

    // Update URL (this triggers router → reloads correct tab)
    window.location.hash = `#/player/${pid}?tab=${tab}`;
});

async function loadTournamentsMenu() {
	window.currentMatchId = null;
	window.currentTournamentId = null;
	window.lastSeenSet = null;

	const dateBar = document.getElementById("date-bar");
	if (dateBar) dateBar.style.display = "none";

	showBackButton(() => {
		window.location.hash = "#/tournaments";
	});

	updateScoreButtonVisibility(false);
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

// =======================================================
// 12. TOURNAMENT OVERVIEW TAB RENDERERS (READ-ONLY)
// =======================================================

async function loadTournamentOverview(tournamentId) {
  window.currentMatchId = null;
  window.currentTournamentId = tournamentId;
  window.tournamentContext.tournamentId = tournamentId;
  // Only clear manageSubview if we are NOT explicitly routing to one
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

  showBackButton(() => {
    window.location.hash = "#/tournaments";
  });
  updateScoreButtonVisibility(false);
  setAddFriendlyVisible(false);

  showLoading("Loading tournament overview…");

  // 1) Load base tournament data
  const { data: tournament, error: tError } = await window.supabaseClient
    .from("tournaments")
    .select("id, name, country, type")
    .eq("id", tournamentId)
    .maybeSingle();

  if (tError || !tournament) {
    console.error(tError);
    showError("Failed to load tournament.");
    return;
  }
  
  window.currentTournament = tournament;

  const tournamentName = tournament.name || "Tournament";

  // 2) Load editions for this tournament
  const { data: editions, error: editionsError } = await window.supabaseClient
    .from("editions")
    .select("id, name")
    .eq("tournament_id", tournamentId)
    .order("name", { ascending: true });

  if (editionsError) {
    console.error(editionsError);
    showError("Failed to load editions.");
    return;
  }

  if (!editions || editions.length === 0) {
    showError("No editions found for this tournament.");
    return;
  }

  // Ensure we have a valid editionId in context
  if (
    !window.tournamentContext.editionId ||
    !editions.some(e => e.id === window.tournamentContext.editionId)
  ) {
    window.tournamentContext.editionId = editions[0].id;
  }

  // 3) Load stages for the selected edition
	const { data: stages, error: stagesError } = await window.supabaseClient
	  .from("stages")
	  .select("id, name, stage_type, bracket_id, edition_id, order_index")
	  .eq("edition_id", window.tournamentContext.editionId)
	  .order("order_index", { ascending: true });
	
	window.currentEditions = editions || [];
	window.currentStages = stages || [];

  if (stagesError) {
    console.error(stagesError);
    showError("Failed to load stages.");
    return;
  }

  if (!stages || stages.length === 0) {
    showError("No stages found for this edition.");
    return;
  }

	// Ensure we have a valid stageId in context
	// BUT do NOT auto-select a stage when a bracket is selected
	if (!window.tournamentContext.selectedBracketId) {
	  if (
		!window.tournamentContext.stageId ||
		!stages.some(s => s.id === window.tournamentContext.stageId)
	  ) {
		window.tournamentContext.stageId = stages[0].id;
	  }
	}

  // 3b) Load ALL stages for manage tab (for all editions)
  const { data: allStages, error: allStagesError } = await window.supabaseClient
    .from("stages")
    .select("id, name, edition_id, stage_type, order_index")
    .in(
      "edition_id",
      editions.map(e => e.id)
    );

  if (allStagesError) {
    console.error(allStagesError);
  }

	// 4) Load matches filtered by edition + stage OR bracket
	let matchQuery = window.supabaseClient
	  .from("matches")
	  .select(`
		id,
		match_date,
		status,
		final_sets_player1,
		final_sets_player2,
		bracket_meta,
		player1:player1_id ( id, name ),
		player2:player2_id ( id, name ),
		tournament:tournament_id ( id, name, country, type ),
		edition_id,
		stage_id,
		group_id
	  `)
	  .eq("tournament_id", tournamentId)
	  .eq("edition_id", window.tournamentContext.editionId);

	// ------------------------------------
	// Group stage view (single stage)
	// ------------------------------------
	if (window.tournamentContext.stageId) {
	  matchQuery = matchQuery.eq(
		"stage_id",
		window.tournamentContext.stageId
	  );
	}

	// ------------------------------------
	// Bracket view (all rounds in bracket)
	// ------------------------------------
	if (window.tournamentContext.selectedBracketId) {
	  const bracketStageIds = window.currentStages
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

	const { data: matchesRaw, error: matchError } =
	  await matchQuery.order("match_date", { ascending: true });


  if (matchError) {
    console.error(matchError);
    showError("Failed to load matches for this edition/stage.");
    return;
  }

  const matches = matchesRaw || [];
  
  window.currentMatches = matches;
  
  console.log("MATCHES DEBUG", {
	  tournamentId,
	  editionId: window.tournamentContext.editionId,
	  selectedStageId: window.tournamentContext.stageId,
	  selectedBracketId: window.tournamentContext.selectedBracketId,
	  loadedMatchesCount: matches.length,
	  loadedMatchStageIds: matches.map(m => m.stage_id)
	});


  // Populate the global player cache for this tournament
  buildTournamentPlayers(matches);

  const showManage = canManageTournament(tournament);

  // 5) Base layout with selectors + tabs
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


	  <div id="tab-daily" style="display:none;"></div>
      <div id="tab-standings" style="display:none;"></div>
      <div id="tab-fixtures" style="display:none;"></div>
      <div id="tab-results" style="display:none;"></div>
      ${showManage ? `<div id="tab-manage" style="display:none;"></div>` : ""}
      <div id="tab-overview"></div>
    </div>
  `);

  // 6) Wire selectors to reload with new context
	document.getElementById("edition-select")?.addEventListener("change", e => {
	  window.tournamentContext.editionId = e.target.value;
	  window.tournamentContext.stageId = null;
	  window.tournamentContext.bracketId = null;

	  persistTournamentView(tournamentId);
	  loadTournamentOverview(tournamentId);
	});

	document.getElementById("stage-select")?.addEventListener("change", e => {
	  const value = e.target.value;

	  // ---- GROUP STAGE SELECTED ----
	  if (value.startsWith("stage:")) {
		window.tournamentContext.stageId =
		  value.replace("stage:", "");

		window.tournamentContext.selectedBracketId = null;
		window.tournamentContext.bracketRoundIndex = 0;
	  }

	  // ---- BRACKET SELECTED ----
	  if (value.startsWith("bracket:")) {
		window.tournamentContext.selectedBracketId =
		  value.replace("bracket:", "");

		window.tournamentContext.stageId = null; //  THIS WAS MISSING
		window.tournamentContext.bracketRoundIndex = 0;
	  }

	  persistTournamentView(tournamentId);
	  loadTournamentOverview(tournamentId);
	});


  // 7) Render tabs
	renderTournamentDailyTab(matches);
	updateDailyTabLabel(window.tournamentContext.selectedDate);
	if (window.tournamentContext.activeOverviewTab === "daily") {
		setupTournamentDateBar(matches);
	}
	renderTournamentDailyTab(matches);
	renderTournamentFixturesTab(matches);
	renderTournamentResultsTab(matches);
	await renderTournamentStandingsTab(tournamentId, matches);

	if (canManageTournament(tournament)) {
	  renderTournamentManageTab(
		tournament,
		editions,
		allStages,
		window.tournamentContext.manageSubview
	  );
	}

	// ONLY render Overview when needed
	if (
	  !window.tournamentContext.activeOverviewTab ||
	  window.tournamentContext.activeOverviewTab === "overview"
	) {
	  renderTournamentOverviewTab(tournament, matches);
	}

	bindOverviewTabs();

	// FINAL: activate tab
	activateTab(
	  window.tournamentContext.activeOverviewTab || "standings"
	);
  
  const defaultTab =
  window.tournamentContext.defaultTab ||
  window.tournamentContext.activeOverviewTab ||
  "standings";

	// consume it
	window.tournamentContext.defaultTab = null;

	const tabEl = document.querySelector(`.tab[data-tab="${defaultTab}"]`);
	if (tabEl) tabEl.click();
	
	if (window.location.hash.includes("tab=daily")) {
	activateTab("daily");
	}
	renderBottomBar({
	canScore: false,
	canManage: showManage,
	tournamentId: tournamentId
	});
updateBottomBar();

console.log(
  "STAGES LOADED:",
  window.currentStages.map(s => ({
    name: s.name,
    type: s.stage_type,
    bracket: s.bracket_id
  }))
);
}

async function loadTournamentStructure(tournamentId) {
  window.currentTournamentId = tournamentId;

  showBackButton(() => {
    window.location.hash = `#/tournament/${tournamentId}/overview?tab=manage`;
  });

  updateScoreButtonVisibility(false);
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

function renderStandingsTable(matches, sets, groups, container, advancementRules = []) {
	const matchesByGroup = new Map();

	(matches || []).forEach(m => {
		if (!m.group_id) return;
		if (!matchesByGroup.has(m.group_id)) {
			matchesByGroup.set(m.group_id, []);
		}
		matchesByGroup.get(m.group_id).push(m);
	});

	if (!container) return;

	const matchesById = {};
	matches.forEach((m) => {
		if (m.id) matchesById[m.id] = m;
	});

	const playerStats = {};
	function ensurePlayer(id, name) {
		if (!playerStats[id]) {
			playerStats[id] = {
				id,
				name,
				played: 0,
				setsWon: 0,
				setsLost: 0,
				smallPoints: 0,
			};
		}
	}

	// Played matches
	matches.forEach((m) => {
		if (!m.player1?.id || !m.player2?.id) return;
		if (m.status === "scheduled") return;

		ensurePlayer(m.player1.id, m.player1.name);
		ensurePlayer(m.player2.id, m.player2.name);

		playerStats[m.player1.id].played += 1;
		playerStats[m.player2.id].played += 1;
	});

	// Sets → results
	sets.forEach((s) => {
		if (!s.match_id || !s.winner_player_id) return;
		const m = matchesById[s.match_id];
		if (!m) return;

		const p1Id = m.player1.id;
		const p2Id = m.player2.id;

		ensurePlayer(p1Id, m.player1.name);
		ensurePlayer(p2Id, m.player2.name);

		const winner = s.winner_player_id;
		const loser = winner === p1Id ? p2Id : p1Id;

		const winnerScore =
			winner === p1Id ? s.score_player1 : s.score_player2;
		const loserScore =
			winner === p1Id ? s.score_player2 : s.score_player1;

		playerStats[winner].setsWon += 1;
		playerStats[loser].setsLost += 1;

		playerStats[winner].smallPoints += winnerScore ?? 0;
		playerStats[loser].smallPoints += loserScore ?? 0;
	});

	if (!groups || groups.length === 0) {
		container.innerHTML = `
			<div class="card">
				<div class="error">
					No groups exist for this stage yet.
				</div>
				<div class="subtitle" style="margin-top:6px;">
					Create groups first, or upload fixtures that assign matches to groups.
				</div>
			</div>
		`;
		return;
	}

	container.innerHTML = "";

	groups.forEach(group => {
		const groupMatches = matchesByGroup.get(group.id) || [];

		// Reset per-group stats
		const playerStats = {};

		function ensurePlayer(id, name) {
			if (!playerStats[id]) {
				playerStats[id] = {
					id,
					name,
					played: 0,
					setsWon: 0,
					setsLost: 0,
					smallPoints: 0,
				};
			}
		}
		
		// Seed players from ANY match in the group
		groupMatches.forEach(m => {
			if (m.player1?.id) {
				ensurePlayer(m.player1.id, m.player1.name);
			}
			if (m.player2?.id) {
				ensurePlayer(m.player2.id, m.player2.name);
			}
		});

		// Played matches (exclude scheduled + structure)
		groupMatches.forEach((m) => {
			if (!m.player1?.id || !m.player2?.id) return;
			if (m.status === "scheduled") return;
			if (m.status === "structure") return;

			ensurePlayer(m.player1.id, m.player1.name);
			ensurePlayer(m.player2.id, m.player2.name);

			playerStats[m.player1.id].played += 1;
			playerStats[m.player2.id].played += 1;
		});

		// Sets → results
		sets.forEach((s) => {
			if (!s.match_id || !s.winner_player_id) return;

			const m = groupMatches.find(x => x.id === s.match_id);
			if (!m) return;
			if (m.status === "structure") return;

			const p1Id = m.player1.id;
			const p2Id = m.player2.id;

			ensurePlayer(p1Id, m.player1.name);
			ensurePlayer(p2Id, m.player2.name);

			const winner = s.winner_player_id;
			const loser = winner === p1Id ? p2Id : p1Id;

			const winnerScore =
				winner === p1Id ? s.score_player1 : s.score_player2;
			const loserScore =
				winner === p1Id ? s.score_player2 : s.score_player1;

			playerStats[winner].setsWon += 1;
			playerStats[loser].setsLost += 1;

			playerStats[winner].smallPoints += winnerScore ?? 0;
			playerStats[loser].smallPoints += loserScore ?? 0;
		});

		const standings = Object.values(playerStats).sort((a, b) => {
			if (b.setsWon !== a.setsWon) return b.setsWon - a.setsWon;
			if (b.smallPoints !== a.smallPoints)
				return b.smallPoints - a.smallPoints;
			return a.name.localeCompare(b.name);
		});

		container.insertAdjacentHTML(
			"beforeend",
			`
			<div class="standings-group-title">${group.name}</div>
			<table class="standings-table">
			  <thead>
				<tr>
				  <th style="text-align:center;" class="pos">Pos</th>
				  <th style="text-align:left;">Player</th>
				  <th style="text-align:center;">P</th>
				  <th style="text-align:center;">SW</th>
				  <th style="text-align:center;">SL</th>
				  <th style="text-align:center;">SP</th>
				</tr>
			  </thead>
				<tbody>
				${
				  standings.length
					? standings.map((p, index) => {
						const position = index + 1;
						const groupSize = standings.length;

						const advRule = resolveAdvancementForPosition(
						  position,
						  groupSize,
						  advancementRules
						);

						const advClass = advRule
						  ? `adv-${advRule.condition} adv-layer-${advRule.layer}`
						  : "";

						return `
						  <tr>
							<td style="text-align:center;" class="pos-cell ${advClass}">
							<span class="pos-number">${position}</span>
							</td>
							<td style="text-align:left;">
							  <span class="player-link" data-player-id="${p.id}">
								${p.name}
							  </span>
							</td>
							<td style="text-align:center;">${p.played}</td>
							<td style="text-align:center;">${p.setsWon}</td>
							<td style="text-align:center;">${p.setsLost}</td>
							<td style="text-align:center;">${p.smallPoints}</td>
						  </tr>
						`;
					  }).join("")
					: `<tr><td colspan="6" class="empty-message">No matches yet</td></tr>`
				}
				</tbody>
			</table>
		`
		);
		if (advancementRules.length) {
		  const notes = advancementRules
			.map(r => {
			  if (!r.description) return null;

			  return `
			  <div class="pos-cell adv-note adv-${r.condition} adv-layer-${r.layer}">
				${r.description}
			  </div>
			  `;
			})
			.filter(Boolean)
			.join("");

		  if (notes) {
			const notesEl = document.createElement("div");
			notesEl.className = "adv-notes";
			notesEl.innerHTML = notes;
			container.appendChild(notesEl);
		  }
		}

	});
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
        const p1Name = m.player1?.name || "Player 1";
        const p2Name = m.player2?.name || "Player 2";

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
	loadInitialLiveSetScores(matchIds);

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

    const upcoming = matches.filter(m => m.status === "scheduled");

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

// -----------------------
// STANDINGS
// -----------------------

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

  renderStandingsTable(
    matches,
    sets || [],
    groups,
    el,
    advancementRules
  );

  console.log("Standings tab:", stage.name, stage.stage_type);
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
    const aSlot = Number(a?.bracket_meta?.slot_index);
    const bSlot = Number(b?.bracket_meta?.slot_index);

    const aOk = Number.isFinite(aSlot);
    const bOk = Number.isFinite(bSlot);

    if (aOk && bOk) return aSlot - bSlot;
    if (aOk && !bOk) return -1;
    if (!aOk && bOk) return 1;

    // deterministic fallback
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
    const stageMatches = matches;

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
  p1Name.textContent = match.player1?.name || "—";

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
  p2Name.textContent = match.player2?.name || "—";

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
  date.textContent = match.match_date
    ? new Date(match.match_date).toLocaleString()
    : "";

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


// -----------------------
// OVERVIEW (SUMMARY)
// -----------------------

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

// =======================================================
// 13. TOURNAMENT MANAGE TAB (UI RENDERERS)
// =======================================================

function renderTournamentManageTab(
  tournament,
  editions,
  allStages
) {
  const el = document.getElementById("tab-manage");
  if (!el) return;

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
	  .select("id,name,stage_type,edition_id,order_index")
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

  updateScoreButtonVisibility(false);
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
    window.tournamentContext.stageId = null;
    loadTournamentOverview(window.currentTournamentId);
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
</div>
  `;
}

function wireStructureEditionChange(tournamentId) {
  const sel = document.getElementById("structure-edition");
  if (!sel) return;

  sel.addEventListener("change", () => {
    window.tournamentContext.editionId = sel.value;
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

// =======================================================
// 14. TOURNAMENT MANAGE TAB (EVENT WIRING / MUTATIONS)
// =======================================================

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

// =======================================================
// MANAGE: create edition / stage prompts
// =======================================================

async function createEditionPrompt(tournamentId) {
  const name = prompt("Edition name (e.g. 2025):");
  if (!name) return;

  const { error } = await window.supabaseClient
    .from("editions")
    .insert({ tournament_id: tournamentId, name: name.trim() });

  if (error) {
    console.error(error);
    alert("Failed to create edition.");
    return;
  }

  // Reload current tournament overview so the manage tab reflects the change
  if (window.currentTournamentId) {
    loadTournamentOverview(window.currentTournamentId);
  }
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

// =======================================================
// 15. TOURNAMENT MATCH MANAGER (OVERLAY / PAGE LOADER)
// =======================================================

async function loadTournamentMatchesManage(tournamentId) {
  window.currentTournamentId = tournamentId;

  showBackButton(() => {
    window.location.hash = `#/tournament/${tournamentId}/overview?tab=manage`;
  });

  updateScoreButtonVisibility(false);
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
		player2:player2_id ( id, name )
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

  renderManageMatches(matches || []);
}


// =======================================================
// 16. MATCH MANAGER — MAIN RENDERER
// =======================================================

function renderManageMatches(matches) {
  const el = document.getElementById("manage-matches-content");
  if (!el) return;

  // ---------------------------------------------------
  // EARLY GUARD — MUST BE BEFORE innerHTML RENDER
  // ---------------------------------------------------
  if (
    !window.tournamentContext?.editionId ||
    !window.tournamentContext?.stageId
  ) {
    el.innerHTML = `
      <div class="card">
        <div class="error">
          Please select an edition and stage before managing matches.
        </div>
      </div>
    `;
    return;
  }

  // ---------------------------------------------------
  // MAIN RENDER
  // ---------------------------------------------------
  el.innerHTML = `
    <div class="manage-matches-grid">

      <!-- BULK FIXTURE UPLOAD -->
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

      <!-- ADD MATCH -->
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

      <!-- EXISTING MATCHES -->
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
                    ${m.player1?.name || "TBC"} v ${m.player2?.name || "TBC"}
                    <span class="pill ${m.status}">${m.status}</span>
                  </span>
                  <span class="muted">
                    ${m.match_date ? formatDate(m.match_date) : "No date"}
                    <button
                      class="header-btn small danger delete-match"
                      data-mid="${m.id}"
                      title="Delete match"
                    >
                      ✕
                    </button>
                  </span>
                </div>
              `).join("")
              : `<div class="empty-message">No matches yet.</div>`
          }
        </div>
      </div>

    </div>
  `;

  // ---------------------------------------------------
  // WIRE BUTTONS (AFTER RENDER)
  // ---------------------------------------------------
  document
    .getElementById("edit-all-sets-btn")
    ?.addEventListener("click", openStageSetEditor);

  wireManageMatchAdd();

  initBulkUpload({
    tournamentId: window.currentTournamentId,
    editionId: window.tournamentContext.editionId,
    stageId: window.tournamentContext.stageId
  });

  initGroupInitialisationTool();
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
  if (!stageId) return;

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
		  <select id="bulk-set-count">
			<option value="1">1 set</option>
			<option value="2">2 sets</option>
			<option value="3">3 sets</option>
			<option value="4">4 sets</option>
			<option value="5">5 sets</option>
		  </select>
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
  loadStageMatchesAndSets(stageId);
  
	document
	  .getElementById("bulk-set-count")
	  .addEventListener("change", e => {
		const count = Number(e.target.value);
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
}

async function saveBulkSets() {
  const saveBtn = document.getElementById("bulk-set-save");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  try {
    for (const match of Object.values(stageGridModel.matches)) {
      const validSets = extractValidSets(match);
      if (validSets.length === 0) continue;

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

      await window.supabaseClient.from("sets").insert(rows);

      // 3️⃣ update match summary
      await window.supabaseClient
        .from("matches")
        .update({
          status: "finished",
          final_sets_player1: match.derivedFss.p1,
          final_sets_player2: match.derivedFss.p2
        })
        .eq("id", match.matchId);
    }

    alert("Sets saved successfully");
    loadTournamentOverview(window.currentTournamentId);

  } catch (err) {
    console.error(err);
    alert("Failed to save sets. See console.");
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
    ${player.sets.map(set => `
      <input
        type="number"
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

// =======================================================
// 17. TOURNAMENT INITIALISATION
// =======================================================

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

    const { error } = await window.supabaseClient.from("matches").insert({
      tournament_id: window.currentTournamentId,
      edition_id: window.tournamentContext.editionId,
      stage_id: window.tournamentContext.stageId,
      player1_id: p1Id,
      player2_id: p2Id,
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
			  player1_id: p1Id,
			  player2_id: p2Id,
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

function initBulkUpload({ tournamentId, editionId, stageId }) {
	const toggle = document.getElementById("bulk-toggle");
	const body   = document.getElementById("bulk-body");
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
    populateSelect(editionSel, window.currentEditions, editionId);
  }

  if (window.currentStages) {
    populateSelect(stageSel, window.currentStages, stageId);
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
              <td>${new Date(m.match_date_utc).toLocaleDateString()}</td>
              <td>${new Date(m.match_date_utc).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
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
  const out = { added: 0, removed: 0, skipped: 0, errors: [] };

  const desired = lines
    .map(raw => {
      const [name, country] = raw.split(",").map(s => s.trim());
      return { name, country: country || null };
    })
    .filter(p => p.name);

  const { data: existing, error } = await window.supabaseClient
    .from("matches")
    .select(`
      id,
      player1_id,
      player1:player1_id ( name )
    `)
    .eq("status", "structure")
    .eq("stage_id", stageId)
    .eq("group_id", groupId);

  if (error) throw error;

  const existingByName = new Map(
    (existing || []).map(r => [r.player1.name.toLowerCase(), r])
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
      let { data: player } = await window.supabaseClient
        .from("players")
        .select("id")
        .eq("name", p.name)
        .maybeSingle();

      if (!player) {
        const { data: created } = await window.supabaseClient
          .from("players")
          .insert({
            name: p.name,
            country: p.country,
            is_guest: false
          })
          .select("id")
          .single();

        player = created;
      }

      await window.supabaseClient.from("matches").insert({
        tournament_id: tournamentId,
        edition_id: editionId,
        stage_id: stageId,
        group_id: groupId,
        status: "structure",
        player1_id: player.id,
        player2_id: null,
        match_date: new Date().toISOString(),
        final_sets_player1: 0,
        final_sets_player2: 0
      });

      out.added++;
    } catch (err) {
      console.error(err);
      out.errors.push(p.name);
    }
  }

  return out;
}

// =======================================================
// 18. MATCH DETAIL VIEW (HEADER + SETS LIST)
// =======================================================

async function loadMatchDetail(matchId, tournamentId) {
    window.currentMatchId = matchId;
    window.currentTournamentId = tournamentId;
    window.lastSeenSet = null;

    showBackButton(() => {
        window.location.hash = `#/tournament/${tournamentId}/overview?tab=daily`;
    });

    updateScoreButtonVisibility(true);
    setAddFriendlyVisible(false);

    showLoading("Loading match…");

    // --- Load match ---
    const { data: match, error: matchError } = await window.supabaseClient
        .from("matches")
        .select(`
            id,
            match_date,
            status,
            final_sets_player1,
            final_sets_player2,
            player1:player1_id ( id, name ),
            player2:player2_id ( id, name ),
            tournament:tournament_id ( id, name )
        `)
        .eq("id", matchId)
        .maybeSingle();

    if (matchError || !match) {
        console.error(matchError);
        showError("Failed to load match");
        return;
    }

    // --- Load sets ---
    const { data: sets, error: setsError } = await window.supabaseClient
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
    const { data: throws, error: throwsError } = await window.supabaseClient
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

    // Group throws by set
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

    const overallSets = `${match.final_sets_player1 ?? 0} – ${match.final_sets_player2 ?? 0}`;

    // Determine current live set
    let currentSet = null;
    if (sets && sets.length > 0) {
        currentSet = sets.find(
            s =>
                !s.winner_player_id &&
                (s.score_player1 ?? 0) < 50 &&
                (s.score_player2 ?? 0) < 50
        );
    }

    const liveSP1 = currentSet ? currentSet.score_player1 ?? 0 : 0;
    const liveSP2 = currentSet ? currentSet.score_player2 ?? 0 : 0;

    // --- Render ---
    setContent(`
<div class="card top-card">
  <div class="subtitle">${linkToTournament(tournamentId, tournamentName)}</div>

  <div class="top-score-row">
    <span style="text-align:right;" class="match-header-player" data-player-id="${match.player1?.id}">
      ${p1Name}
    </span>
    <div class="top-score">${overallSets}</div>
    <span class="match-header-player" data-player-id="${match.player2?.id}">
      ${p2Name}
    </span>
  </div>

  <div class="live-throwstrip-row">
    <div class="live-throwstrip p1" id="header-throws-p1"></div>
    <div class="live-setscore" id="header-live-setscore">${liveSP1} – ${liveSP2}</div>
    <div class="live-throwstrip p2" id="header-throws-p2"></div>
  </div>

  <div style="text-align:center;" class="match-small">${formatDate(match.match_date)}</div>
  <div style="text-align:center;" class="match-small">
    <span class="pill ${pillClass}">${pillLabel}</span>
  </div>
</div>

<div class="card" id="match-detail">
  <div class="tab-row">
    <div class="tab active" data-tab="sets">Sets</div>
  </div>
  <div id="tab-sets"></div>
</div>
`);

	// Match-detail context used by throw rendering (independent of scoring console)
	window.matchDetailContext = {
	  matchId,
	  tournamentId,
	  p1Id: match.player1?.id || null,
	  p2Id: match.player2?.id || null,
	  p1Name,
	  p2Name
	};

    if (currentSet) {
	  requestAnimationFrame(() => {
		updateLiveThrowsForSet(currentSet.set_number);
	  });
	}


	renderMatchSets(
	  sets || [],
	  throwsBySet,
	  match.player1?.id,
	  match.player2?.id,
	  p1Name,
	  p2Name
	);

    if (SUPERADMIN) {
        resetScoringStateForMatch(match, sets || []);
    }
	renderBottomBar({
	canScore: isSuperAdmin(),   // or canScoreMatch()
	canManage: canManageTournament(match.tournament),
	matchId,
	tournamentId
	});
updateBottomBar();
}

async function loadMatchThrowsUpload(matchId) {
  showBackButton(() => window.history.back());
  updateScoreButtonVisibility(false);

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

  window.currentMatchId = matchId;
  window.currentTournamentId = tournamentId;
  window.lastSeenSet = null;

  showBackButton(() => {
    window.location.hash = `#/tournament/${tournamentId}/matches`;
  });
  updateScoreButtonVisibility(false);
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

	
	document
		.querySelectorAll('input[data-set][data-p]')
		.forEach(input => {
		input.addEventListener("input", updateCumulativeDisplay);
	});

// Initial calculation (for prefills)
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

// =======================================================
// 19. MATCH SETS RENDERING + EXPANSION
// =======================================================

function renderMatchSets(sets, throwsBySet, p1Id, p2Id, p1Name, p2Name) {
  const setsContainer = document.getElementById("tab-sets");

  if (!setsContainer) {
    console.error("[renderMatchSets] #tab-sets not found");
    return;
  }
  const container = document.getElementById("tab-sets");
  if (!container) return;

  if (!Array.isArray(sets) || sets.length === 0) {
    container.innerHTML =
      '<div class="empty-message">No sets recorded for this match yet.</div>';
    return;
  }

  let html = `<div class="sets-wrapper">`;

  let cumP1 = 0;
  let cumP2 = 0;

  sets.forEach((s) => {
    const setNum = s.set_number;
    const p1Score = s.score_player1 ?? "";
    const p2Score = s.score_player2 ?? "";

    const p1Win = s.winner_player_id === p1Id;
    const p2Win = s.winner_player_id === p2Id;

    if (p1Win) cumP1++;
    if (p2Win) cumP2++;

    html += `
      <div class="set-block" data-set="${setNum}">
        <div class="set-main-row" data-set="${setNum}">
          <div class="col left ${p1Win ? "winner" : ""}">${p1Score}</div>
          <div class="col mid">${cumP1}–${cumP2}</div>
          <div class="col right ${p2Win ? "winner" : ""}">${p2Score}</div>
        </div>
        <div class="set-throws-expanded" data-set="${setNum}" style="display:none;"></div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;

  // Expand handler (lazy-build throws)
  container.querySelectorAll(".set-main-row").forEach((row) => {
    row.addEventListener("click", () => {
      const setNum = Number(row.dataset.set);
      const expanded = container.querySelector(
        `.set-throws-expanded[data-set="${setNum}"]`
      );
      if (!expanded) return;

      const isOpen = expanded.style.display === "block";

      container
        .querySelectorAll(".set-throws-expanded")
        .forEach((el) => (el.style.display = "none"));

      if (isOpen) return;

      const raw = throwsBySet[setNum] || [];
      const model = buildThrowsModel(raw, p1Id, p2Id);

      expanded.innerHTML = model.length
        ? buildThrowsTableHTML(model, p1Name, p2Name)
        : '<div class="empty-message">No throw history for this set.</div>';

      expanded.style.display = "block";
    });
  });
}


// =======================================================
// 20. ADD FRIENDLY
// =======================================================

async function loadFriendlyCreate() {
  window.currentMatchId = null;
  window.currentTournamentId = FRIENDLIES_TOURNAMENT_ID;
  window.lastSeenSet = null;

  showBackButton(() => {
    window.location.hash = "#/friendlies";
  });
  updateScoreButtonVisibility(false);
  setAddFriendlyVisible(false);

  showLoading("Preparing friendly creator…");

  await ensureFriendliesTournamentExists();

  const { data: players, error } = await window.supabaseClient
    .from("players")
    .select("id, name, is_guest")
    .order("name", { ascending: true });

  const allPlayers = players || [];
  if (error) {
    console.error(error);
  }

  // Build a default local datetime for the input (now)
  const now = new Date();
  const defaultLocal = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16); // "YYYY-MM-DDTHH:mm"

  const html = `
    <div class="card">
      <div class="tournament-header">
        <div class="tournament-name">Create friendly match</div>
        <div class="subtitle">Pickup game – results still count for real players</div>
      </div>

      <div class="section-title">Players</div>

      <div class="match-small">
        Tip: single name = guest (no profile). Full name = real player (with profile).
      </div>

      <div class="friendly-form">
        <label>
          Player A
          <input type="text" id="friendly-p1-input" placeholder="Player 1 name" autocomplete="off" />
        </label>
        <div id="friendly-p1-suggestions" class="friendly-suggestions"></div>

        <label>
          Player B
          <input type="text" id="friendly-p2-input" placeholder="Player 2 name" autocomplete="off" />
        </label>
        <div id="friendly-p2-suggestions" class="friendly-suggestions"></div>

        <label>
          Scheduled date &amp; time
          <input type="datetime-local" id="friendly-date-input" value="${defaultLocal}" />
        </label>

        <button id="friendly-create-btn" class="header-btn" style="margin-top:10px;">
          Create &amp; score this match
        </button>

        <div id="friendly-error" class="error" style="margin-top:6px; display:none;"></div>
      </div>
    </div>
  `;

  setContent(html);

  const p1Input = document.getElementById("friendly-p1-input");
  const p2Input = document.getElementById("friendly-p2-input");
  const p1Sug = document.getElementById("friendly-p1-suggestions");
  const p2Sug = document.getElementById("friendly-p2-suggestions");
  const createBtn = document.getElementById("friendly-create-btn");
  const errBox = document.getElementById("friendly-error");
  const dateInput = document.getElementById("friendly-date-input");

  function showErrorMessage(msg) {
    if (!errBox) return;
    if (!msg) {
      errBox.style.display = "none";
      errBox.textContent = "";
    } else {
      errBox.style.display = "block";
      errBox.textContent = msg;
    }
  }

  function buildSuggestions(inputEl, sugEl) {
    if (!inputEl || !sugEl) return;
    const q = inputEl.value.trim().toLowerCase();
    sugEl.innerHTML = "";
    if (q.length < 1) return;

    const matches = allPlayers.filter(p =>
      (p.name || "").toLowerCase().includes(q)
    );

    const topMatches = matches.slice(0, 5);
    topMatches.forEach(p => {
      const div = document.createElement("div");
      div.className = "friendly-suggestion-item";
      const label = p.is_guest ? `${p.name} (Guest)` : p.name;
      div.textContent = label;
      div.dataset.playerId = p.id;
      div.addEventListener("click", () => {
        inputEl.value = p.name;
        inputEl.dataset.playerId = p.id;
        inputEl.dataset.isGuest = p.is_guest ? "true" : "false";
        sugEl.innerHTML = "";
      });
      sugEl.appendChild(div);
    });
  }

  p1Input?.addEventListener("input", () =>
    buildSuggestions(p1Input, p1Sug)
  );
  p2Input?.addEventListener("input", () =>
    buildSuggestions(p2Input, p2Sug)
  );

  if (createBtn) {
    createBtn.addEventListener("click", async () => {
      showErrorMessage("");

      try {
        const p1Id = await resolveOrCreatePlayerByName(
          p1Input.value,
          { allowGuest: true }
        );

        const p2Id = await resolveOrCreatePlayerByName(
          p2Input.value,
          { allowGuest: true }
        );

        if (p1Id === p2Id) {
          throw new Error("Players must be different.");
        }

        const dateVal = dateInput?.value;
        const scheduledIso = dateVal
          ? new Date(dateVal).toISOString()
          : new Date().toISOString();

        const { data: inserted, error: matchErr } = await window.supabaseClient
          .from("matches")
          .insert({
            tournament_id: FRIENDLIES_TOURNAMENT_ID,
            player1_id: p1Id,
            player2_id: p2Id,
            status: "scheduled",
            match_date: scheduledIso,
            final_sets_player1: 0,
            final_sets_player2: 0,
          })
          .select("id")
          .maybeSingle();

        if (matchErr || !inserted) {
          console.error(matchErr);
          throw new Error("Failed to create friendly match.");
        }

        const newMatchId = inserted.id;
        window.location.hash = `#/match/${newMatchId}/${FRIENDLIES_TOURNAMENT_ID}`;
      } catch (e) {
        console.error(e);
        showErrorMessage(e.message || "Failed to create friendly.");
      }
    });
  }
}

// =======================================================
// 21. THROWS TABLE RENDERING HELPERS
// =======================================================

function buildThrowsTableHTML(model, p1Name, p2Name) {
    if (!model || model.length === 0) {
        return `<div class="empty-message">No throw history for this set.</div>`;
    }

    const p1Seq = [];
    const p2Seq = [];

    model.forEach((r) => {
        if (r.isP1) {
            p1Seq.push({ score: r.displayScore, total: r.cumP1 });
        } else {
            p2Seq.push({ score: r.displayScore, total: r.cumP2 });
        }
    });

    const rows = [];
    const maxRows = Math.max(p1Seq.length, p2Seq.length);

    for (let i = 0; i < maxRows; i++) {
        const p1 = p1Seq[i];
        const p2 = p2Seq[i];

        const p1ScoreStr = String(p1 ? p1.score ?? "" : "");
        const p2ScoreStr = String(p2 ? p2.score ?? "" : "");

        const p1Class =
            p1ScoreStr.includes("X") ? "miss" :
            p1ScoreStr.includes("↓") ? "reset" : "";

        const p2Class =
            p2ScoreStr.includes("X") ? "miss" :
            p2ScoreStr.includes("↓") ? "reset" : "";

        rows.push(`
<tr>
  <td>${i + 1}</td>
  <td>
    ${p1
        ? `<span class="throw-raw ${p1Class}"><sub>${p1ScoreStr}</sub></span>/<span class="throw-total">${p1.total}</span>`
        : ""}
  </td>
  <td>
    ${p2
        ? `<span class="throw-raw ${p2Class}"><sub>${p2ScoreStr}</sub></span>/<span class="throw-total">${p2.total}</span>`
        : ""}
  </td>
</tr>
`);
    }

    return `
<table class="throws-table">
  <thead>
    <tr>
      <th>#</th>
      <th>${p1Name}</th>
      <th>${p2Name}</th>
    </tr>
  </thead>
  <tbody>${rows.join("")}</tbody>
</table>
`;
}

// =======================================================
// 22. LIVE THROWS UPDATE (HEADER + EXPANDED SET VIEW)
// =======================================================

async function updateLiveThrowsForSet(setNumber) {

  if (!window.currentMatchId) return;

  const ctx = window.matchDetailContext || {};
  const p1 = ctx.p1Id;
  const p2 = ctx.p2Id;

  if (!p1 || !p2) {
    console.warn("[updateLiveThrowsForSet] missing player ids", { p1, p2, ctx });
    return;
  }

  const { data: throws, error } = await window.supabaseClient
    .from("throws")
    .select("id, match_id, set_number, throw_number, player_id, score, is_fault")
    .eq("match_id", window.currentMatchId)
    .eq("set_number", setNumber)
    .order("throw_number", { ascending: true });

  if (error) {
    console.error("[updateLiveThrowsForSet] throws load error", error);
    return;
  }

  const model = buildThrowsModel(throws || [], p1, p2);

  // Header throwstrip
  const headerP1 = document.getElementById("header-throws-p1");
  const headerP2 = document.getElementById("header-throws-p2");

  if (headerP1 && headerP2) {
    const lastP1 = model.filter(m => m.isP1).slice(-6);
    const lastP2 = model.filter(m => !m.isP1).slice(-6);

    headerP1.innerHTML = lastP1.map(m => throwBoxHTML(m.displayScore)).join("");
    headerP2.innerHTML = lastP2.map(m => throwBoxHTML(m.displayScore)).join("");
  }

  // Expanded table only (never touches #tab-sets / sets wrapper)
  const expanded = document.querySelector(`.set-throws-expanded[data-set="${setNumber}"]`);
  if (expanded && expanded.style.display === "block") {
    expanded.innerHTML = buildThrowsTableHTML(
      model,
      ctx.p1Name || "Player 1",
      ctx.p2Name || "Player 2"
    );
  }
}

window.updateLiveThrowsForSet = updateLiveThrowsForSet;

// =======================================================
// 23. REALTIME SUBSCRIPTIONS (SETS + THROWS)
// =======================================================

function initRealtimeSubscriptions() {
  if (!window.supabaseClient) {
    console.warn("[realtime] supabaseClient not ready");
    return;
  }

  window.setsChannel = window.supabaseClient
    .channel("sets-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "sets" },
      payload => {
        if (!window.currentMatchId) return;
        if (payload.new?.match_id !== window.currentMatchId) return;
        smoothUpdateSetRow(payload.new);
      }
    )
    .subscribe();

  window.throwsChannel = window.supabaseClient
    .channel("throws-realtime")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "throws" },
      payload => {
        if (!payload.new) return;
        if (payload.new.match_id !== window.currentMatchId) return;
        updateLiveThrowsForSet(payload.new.set_number);
      }
    )
    .subscribe();
}

// =======================================================
// 24. SMOOTH SET ROW UPDATES (NO FULL RELOAD)
// =======================================================

async function smoothUpdateSetRow(updatedSet) {
    const setNumber = updatedSet.set_number;
    if (!setNumber) return;

    const onMatchDetailPage =
        document.querySelector(".top-card") !== null;

    const block = document.querySelector(
        `.set-block[data-set="${setNumber}"]`
    );

    if (!block) {
        if (onMatchDetailPage) {
            if (!window.lastSeenSet || setNumber > window.lastSeenSet) {
                window.lastSeenSet = setNumber;
                loadMatchDetail(
                    window.currentMatchId,
                    window.currentTournamentId
                );
            }
        }
        return;
    }

    const mainRow = block.querySelector(".set-main-row");
    if (!mainRow) return;

    const leftCell = mainRow.querySelector(".col.left");
    const rightCell = mainRow.querySelector(".col.right");

    if (leftCell) leftCell.textContent = updatedSet.score_player1 ?? "";
    if (rightCell) rightCell.textContent = updatedSet.score_player2 ?? "";

    if (updatedSet.winner_player_id && window.scoringMatch) {
        const p1Id = window.scoringMatch.p1Id;
        const p2Id = window.scoringMatch.p2Id;

        leftCell?.classList.remove("winner");
        rightCell?.classList.remove("winner");

        if (updatedSet.winner_player_id === p1Id)
            leftCell?.classList.add("winner");
        if (updatedSet.winner_player_id === p2Id)
            rightCell?.classList.add("winner");
    }

    // Update thrower label in scoring console
    if (typeof scoringCurrentThrower !== "undefined") {
        scoringCurrentThrower =
            updatedSet.current_thrower || "p1";

        if (window.scoringMatch) {
            const name =
                scoringCurrentThrower === "p1"
                    ? window.scoringMatch.p1Name
                    : window.scoringMatch.p2Name;

            const label = document.getElementById(
                "scoring-current-thrower-label"
            );
            if (label) label.textContent = `${name} to throw`;
        }
    }

    // Update live set score in header
    const headerSetScore = document.getElementById(
        "header-live-setscore"
    );
    if (headerSetScore) {
        const sp1 = updatedSet.score_player1 ?? 0;
        const sp2 = updatedSet.score_player2 ?? 0;
        headerSetScore.textContent = `${sp1} – ${sp2}`;
    }

    if (updatedSet.winner_player_id) {
        await updateOverallMatchScore();
    }
}

// =======================================================
// 25. OVERALL MATCH SCORE SYNC (HEADER + MATCH LIST)
// =======================================================

async function updateOverallMatchScore() {
    if (!window.currentMatchId) return;

    const { data: match, error } = await window.supabaseClient
        .from("matches")
        .select("final_sets_player1, final_sets_player2")
        .eq("id", window.currentMatchId)
        .maybeSingle();

    if (error || !match) return;

    const headerScore =
        document.querySelector(".top-card .top-score");

    if (headerScore) {
        headerScore.textContent =
            `${match.final_sets_player1 ?? 0} – ${match.final_sets_player2 ?? 0}`;
    }
}

async function updateMatchListFinalScore(matchId, card) {
    const { data: match, error } = await window.supabaseClient
        .from("matches")
        .select("final_sets_player1, final_sets_player2")
        .eq("id", matchId)
        .maybeSingle();

    if (error || !match) return;

    const setCells = card.querySelectorAll(".mc-setscore");
    if (setCells.length === 2) {
        setCells[0].textContent = match.final_sets_player1 ?? 0;
        setCells[1].textContent = match.final_sets_player2 ?? 0;
    }
}

// =======================================================
// LIVE SET INITIAL HYDRATION (match list)
// =======================================================

function applyLiveSetScoresToCards() {
  if (!window.latestLiveSets) return;

  Object.entries(window.latestLiveSets).forEach(([matchId, scores]) => {
    const cards = document.querySelectorAll(`.card[data-mid="${matchId}"]`);
    if (!cards.length) return;

    cards.forEach(card => {
      const liveBoxes = card.querySelectorAll(".mc-livebox");
      if (liveBoxes.length !== 2) return;

      liveBoxes[0].textContent = scores.p1;
      liveBoxes[1].textContent = scores.p2;

      const isLive = scores.p1 !== "" || scores.p2 !== "";
      liveBoxes[0].classList.toggle("is-live", isLive);
      liveBoxes[1].classList.toggle("is-live", isLive);
    });
  });
}

async function loadInitialLiveSetScores(matchIds) {
  if (!Array.isArray(matchIds) || matchIds.length === 0) return;

  const { data, error } = await window.supabaseClient
    .from("sets")
    .select("match_id, score_player1, score_player2, winner_player_id")
    .in("match_id", matchIds)
    .is("winner_player_id", null); // only live sets

  if (error || !data) return;

  window.latestLiveSets = {};

  data.forEach(s => {
    window.latestLiveSets[s.match_id] = {
      p1: s.score_player1 ?? "",
      p2: s.score_player2 ?? ""
    };
  });

  applyLiveSetScoresToCards();
}


// =======================================================
// 26. MATCH LIST LIVE SET UPDATES (REALTIME)
// =======================================================

const setsChannelMatchList = window.supabaseClient
  .channel("sets-realtime-matchlist")
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "sets",
    },
    (payload) => {
		window.latestLiveSets ??= {};
      const updated = payload.new;
      if (!updated) return;

      const matchId = updated.match_id;
      const p1 = updated.score_player1 ?? "";
      const p2 = updated.score_player2 ?? "";
	  window.latestLiveSets[matchId] = { p1, p2 };

      // Find ALL cards for this match (across tabs)
      const cards = document.querySelectorAll(
        `.card[data-mid="${matchId}"]`
      );

      if (!cards.length) return;

      cards.forEach((card) => {
        const liveBoxes = card.querySelectorAll(".mc-livebox");
        if (liveBoxes.length !== 2) return;

        liveBoxes[0].textContent = p1;
        liveBoxes[1].textContent = p2;

        if (p1 !== "" || p2 !== "") {
          liveBoxes[0].classList.add("is-live");
          liveBoxes[1].classList.add("is-live");
        } else {
          liveBoxes[0].classList.remove("is-live");
          liveBoxes[1].classList.remove("is-live");
        }

        if (updated.winner_player_id) {
          updateMatchListFinalScore(matchId, card);
        }
      });
	  applyLiveSetScoresToCards();
    }
  )
.subscribe();
	
// =======================================================
// 26a. PLAYERS PROFILE
// =======================================================

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

    // 1) Load player record
    const { data: player, error: pErr } = await window.supabaseClient
        .from("players")
        .select("id, name, country, is_guest")
        .eq("id", playerId)
        .maybeSingle();

    if (pErr || !player) {
        showError("Player not found.");
        return;
    }

    // 2) Load all matches involving this player
    const { data: matches, error: mErr } = await window.supabaseClient
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

	// Restore saved tab (per player)
	const savedTab = localStorage.getItem(`playerTab_${player.id}`);

	// Store context
    window.playerContext = {
        player,
        matches: allMatches,
        activeTab: tabFromRoute
    };

    // 3) Render page scaffold
    setContent(`
        <div class="card" id="player-page">

            <div class="tournament-header">
                <div class="tournament-name">${flagPNG(player.country)} ${player.name}</div>
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
	
	// Wire up tab clicks
	document.querySelectorAll("#player-page .tab").forEach(tabEl => {
		tabEl.addEventListener("click", (ev) => {
			ev.preventDefault();
			ev.stopPropagation();

			const tab = tabEl.dataset.tab;

			// Extract clean player ID
			const h = window.location.hash;
			const pid = h.split("/")[2].split("?")[0];

			// Update URL → router reloads → correct tab loads
			window.location.hash = `#/player/${pid}?tab=${tab}`;
		});
	});

    window.playerContext.activeTab = tabFromRoute;
	renderPlayerTabs(playerId, tabFromRoute);
}

function renderPlayerTabs() {
    const ctx = window.playerContext;
    if (!ctx) return;

    // Update tab buttons
    document.querySelectorAll("#player-tabs .tab").forEach(t => {
        t.classList.toggle("active", t.dataset.tab === ctx.activeTab);
    });

    // Hide all panels
    document.querySelectorAll("#player-overview, #player-fixtures, #player-results, #player-teams")
        .forEach(el => el.style.display = "none");

    // Show selected
    const panel = document.getElementById(`player-${ctx.activeTab}`);
    if (panel) panel.style.display = "block";

    // Render tab content
    if (ctx.activeTab === "overview") renderPlayerOverviewPanel(ctx);
    if (ctx.activeTab === "fixtures") renderPlayerFixturesPanel(ctx);
    if (ctx.activeTab === "results") renderPlayerResultsPanel(ctx);
    if (ctx.activeTab === "teams") renderPlayerTeamsPanel(ctx);
}

// TAB CONTENT =========================================================

function renderPlayerOverviewPanel(ctx) {
    const p = ctx.player;

    document.getElementById("player-overview").innerHTML = `
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

function renderPlayerResultsPanel(ctx) {
    const finished = ctx.matches.filter(m => m.status === "finished");
    const el = document.getElementById("player-results");

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

        // Pill
        let pillClass = "pill-blue";
        let pillText = "D";
        if (scoreFor > scoreAgainst) { pillClass = "pill-green"; pillText = "W"; }
        else if (scoreFor < scoreAgainst) { pillClass = "pill-red"; pillText = "L"; }

        return `
        <div class="card clickable player-match-card" data-mid="${m.id}" data-tid="${m.tournament.id}">
            
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

    el.querySelectorAll("[data-mid]").forEach(card => {
        card.addEventListener("click", () => {
            window.location.hash = `#/match/${card.dataset.mid}/${card.dataset.tid}`;
        });
    });
}

function renderPlayerFixturesPanel(ctx) {
    const upcoming = ctx.matches.filter(m => m.status === "scheduled");
    const el = document.getElementById("player-fixtures");

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
        <div class="card clickable player-match-card" data-mid="${m.id}" data-tid="${m.tournament.id}">

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

    // Make cards clickable
    el.querySelectorAll("[data-mid]").forEach(card => {
        card.addEventListener("click", () => {
            const mid = card.dataset.mid;
            const tid = card.dataset.tid;
            window.location.hash = `#/match/${mid}/${tid}`;
        });
    });
}

function renderPlayerTeamsPanel(ctx) {
    // Teams system not implemented yet — placeholder
    document.getElementById("player-teams").innerHTML =
        `<div class="empty-message">Teams will be added later.</div>`;
}

// =======================================================
// 27. SIMPLE HASH ROUTER
// =======================================================

function handleRoute() {
    const raw = window.location.hash || "#/tournaments";
    const withoutHash = raw.slice(1);
    const [pathPart, queryString] = withoutHash.split("?");
    const parts = pathPart.split("/");
    const params = new URLSearchParams(queryString || "");
	
	// default: no subview
	window.tournamentContext.manageSubview = null;

    // #/tournaments
    if (parts[1] === "tournaments") {
        loadTournaments();
        return;
    }

    // #/leagues
    if (parts[1] === "leagues") {
        loadTournamentsMenu();
        return;
    }

    // #/friendlies
    if (parts[1] === "friendlies" && !parts[2]) {
        window.tournamentContext.activeOverviewTab = "daily";
        loadTournamentOverview(FRIENDLIES_TOURNAMENT_ID);
        return;
    }

    // #/friendlies/new
    if (parts[1] === "friendlies" && parts[2] === "new") {
        loadFriendlyCreate();
        return;
    }

    // #/tournament/<tid>/manage-matches
    if (
        parts[1] === "tournament" &&
        parts[2] &&
        parts[3] === "manage-matches"
    ) {
        loadTournamentMatchesManage(parts[2]);
        return;
    }

    // #/tournament/<tid>/match/<mid>/sets
    if (
        parts[1] === "tournament" &&
        parts[2] &&
        parts[3] === "match" &&
        parts[4] &&
        parts[5] === "sets"
    ) {
        loadTournamentMatchSets(parts[4], parts[2]);
        return;
    }
	
	// #/tournament/<tid>/structure/advancement/<stageId>
	if (
	  parts[1] === "tournament" &&
	  parts[2] &&
	  parts[3] === "structure" &&
	  parts[4] === "advancement" &&
	  parts[5]
	) {
	  const tournamentId = parts[2];

	  //  REHYDRATE CONTEXT
	  window.currentTournamentId = tournamentId;
	  window.tournamentContext = window.tournamentContext || {};

	  loadStageAdvancementRules(tournamentId, parts[5]);
	  return;
	}
	
	// #/tournament/<tid>/structure
	if (
	  parts[1] === "tournament" &&
	  parts[2] &&
	  parts[3] === "structure"
	) {
	  const tournamentId = parts[2];

	  // REHYDRATE CONTEXT
	  window.currentTournamentId = tournamentId;
	  window.tournamentContext = window.tournamentContext || {};

	  loadTournamentStructure(tournamentId);
	  return;
	}
		
	// #/tournament/<tid>/initialisation
	if (
	  parts[1] === "tournament" &&
	  parts[2] &&
	  parts[3] === "initialisation"
	) {
	  const tournamentId = parts[2];

	  window.tournamentContext.manageSubview = "initialisation";
	  window.tournamentContext.activeOverviewTab = "manage";

	  loadTournamentOverview(tournamentId);
	  return;
	}

    // #/tournament/<tid>/overview?tab=...
    if (parts[1] === "tournament" && parts[2]) {
        const tid = parts[2];
        const tab = params.get("tab");

       if (tab) {
    // Explicit tab in URL always wins
    window.tournamentContext.activeOverviewTab = tab;
		} else {
			const fromDaily = sessionStorage.getItem("fromDailyView") === "1";

			window.tournamentContext.activeOverviewTab =
				fromDaily ? "daily" : "standings";

			// One-shot: clear after use
			sessionStorage.removeItem("fromDailyView");
		}
        loadTournamentOverview(tid);
        return;
    }

    // #/match/<mid>/<tid>
    if (parts[1] === "match" && parts[2] && parts[3]) {
        loadMatchDetail(parts[2], parts[3]);
        return;
    }

    // #/player/<pid>?tab=...
    if (parts[1] === "player" && parts[2]) {
        const pid = parts[2];
        const tab = params.get("tab") || "overview";
        loadPlayerPage(pid, tab);
        return;
    }

    // Fallback
    loadTournaments();
	setTimeout(updateBottomBar, 0);
}

function clampDatesAroundToday(dates, radius = 5) {
    if (!dates || dates.length === 0) return [];

    const sorted = [...dates].sort();
    const todayStr = new Date().toISOString().split("T")[0];

    let centerIndex = sorted.findIndex((d) => d >= todayStr);
    if (centerIndex === -1) {
        // everything is in the past → use the last date
        centerIndex = sorted.length - 1;
    }

    const start = Math.max(0, centerIndex - radius);
    const end = Math.min(sorted.length - 1, centerIndex + radius);
    return sorted.slice(start, end + 1);
}

function renderDateBar(rawDates, onSelect) {
    const bar = document.getElementById("date-bar");
    if (!bar) return;

    const today = new Date().toISOString().split("T")[0];

    // Unique list of passed-in dates
    const unique = Array.from(new Set((rawDates || []).filter(Boolean)));

    // Ensure "today" is present even if there are no matches that day
    if (!unique.includes(today)) {
        unique.push(today);
    }

    // Keep at most ±5 dates around today
    const displayDates = clampDatesAroundToday(unique, 5);
	
	const params = new URLSearchParams(window.location.search);
	const urlDate = params.get("date");
	
	let activeDateFilter = null;
	window.tournamentContext.selectedDate = null;

    // Choose a valid active date if not set or no longer present
    if (urlDate && displayDates.includes(urlDate)) {
	  activeDateFilter = urlDate;
	} else if (!activeDateFilter || !displayDates.includes(activeDateFilter)) {
	  activeDateFilter = displayDates.includes(today)
		? today
		: displayDates[0] || null;
	}


    // Render pills
    bar.innerHTML = displayDates
        .map((d) => {
            const label = new Date(d).toLocaleDateString("en-GB", {
                weekday: "short",
                day: "2-digit",
                month: "short",
            });
            const isActive = d === activeDateFilter;
            return `
        <div class="date-pill ${isActive ? "active" : ""}" data-date="${d}">
          <div>${label}</div>
          ${isToday(d) ? '<div class="date-sub">(Today)</div>' : ""}
        </div>
      `;
        })
        .join("");

    // Wire up click behaviour: always keep *some* date selected.
    bar.querySelectorAll(".date-pill").forEach((pill) => {
        pill.addEventListener("click", () => {
		  const d = pill.dataset.date;
		  if (!d) return;

		  activeDateFilter = d;

		  bar.querySelectorAll(".date-pill").forEach((p) => {
			p.classList.toggle("active", p === pill);
		  });

		  const url = new URL(window.location.href);
		  url.searchParams.set("date", d);
		  history.replaceState(null, "", url.toString());

		  if (typeof onSelect === "function") {
			onSelect(d);
		  }
		});
    });

    // Initial callback so the view is filtered immediately
    if (typeof onSelect === "function" && activeDateFilter) {
        onSelect(activeDateFilter);
    }
}

function setupHomeDateBar(allDates, dateToTournamentIds) {
    const filteredDates = (allDates || []).filter(Boolean);

    renderDateBar(filteredDates, (selectedDate) => {
        const allowedSet = dateToTournamentIds[selectedDate] || new Set();

        document.querySelectorAll("[data-tid]").forEach((card) => {
            const tid = card.getAttribute("data-tid");
            if (!tid) return;
            card.style.display = allowedSet.has(tid) ? "" : "none";
        });
    });
}


function setupTournamentDateBar(matches) {
    const dateBar = document.getElementById("date-bar");
    if (!dateBar) return;

    // ONLY include playable matches
    const playableMatches = (matches || []).filter(m =>
        m.match_date &&
        m.player1?.id &&
        m.player2?.id &&
        m.status !== "structure"
    );

    // Extract yyyy-mm-dd dates from playable matches only
    const dates = Array.from(
        new Set(
            playableMatches.map(m => isoDateOnly(m.match_date))
        )
    );

    renderDateBar(dates, (selectedDate) => {
        window.tournamentContext.selectedDate = selectedDate;
        updateDailyTabLabel(selectedDate);
        renderTournamentDailyTab(matches, selectedDate);
    });
}

function renderLoginScreen() {
  setContent(`
    <div class="card" style="min-width:480px; max-width:600px;margin:40px auto;">
      <div class="tournament-header">
        <div class="tournament-name">Login</div>
        <div class="subtitle">Authorised users only</div>
      </div>

      <label>
        Email
        <input type="email" id="login-email" />
      </label>
      <label>
        Password
        <input type="password" id="login-password" />
      </label>
      <button class="header-btn" id="login-btn">
        Log in
      </button>

      <div class="error" id="login-error" style="display:none;margin-top:8px;"></div>
    </div>
  `);

  document.getElementById("login-btn").onclick = async () => {
    const email = document.getElementById("login-email").value;
    const password = document.getElementById("login-password").value;
    const err = document.getElementById("login-error");

    err.style.display = "none";

    const { error } = await window.supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      err.textContent = error.message;
      err.style.display = "block";
      return;
    }

    // success → reload app state
    await initAuth();
    handleRoute();
  };
}

window.renderLoginScreen = renderLoginScreen;


// =======================================================
// 28. INITIAL ROUTE BINDING (AUTH-AWARE)
// =======================================================

// Initial navigation
handleRoute();

// React to browser navigation
window.addEventListener("hashchange", handleRoute);

// =======================================================
// 30. GLOBAL CLICK DELEGATES (PLAYER LINKS / TABS)
// =======================================================

document.addEventListener("click", (ev) => {
    const el = ev.target.closest(".match-header-player");
    if (!el) return;

    ev.preventDefault();
    ev.stopPropagation();

    const pid = el.dataset.playerId;
    if (!pid) return;

    window.location.hash = `#/player/${pid}`;
});
 
document.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".tab-btn");
    if (!btn) return;

    const page = btn.closest("#player-page");
    if (!page) return;

    const tab = btn.dataset.tab;
    const h = window.location.hash;
    const pid = h.split("/")[2].split("?")[0];

    window.location.hash = `#/player/${pid}?tab=${tab}`;
});

document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".delete-match");
  if (!btn) return;

  e.preventDefault();
  e.stopPropagation();

  const mid = btn.dataset.mid;
  if (!mid) return;

  if (!confirm("Delete this match?")) return;

  const { error } = await window.supabaseClient
    .from("matches")
    .delete()
    .eq("id", mid);

  if (error) {
    console.error(error);
    alert("Failed to delete match.");
    return;
  }

  loadTournamentMatchesManage(window.currentTournamentId);
});

