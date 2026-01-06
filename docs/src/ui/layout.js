const contentEl = document.getElementById("content");
const backBtn = document.getElementById("back-btn");
const scoreBtn = document.getElementById("score-btn");
const addFriendlyBtn = document.getElementById("add-friendly-btn");

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

function canScoreCurrentMatch() {
  if (!window.matchDetailContext) return false;
  if (!window.App?.Auth?.canScoreMatch) return false;

  return App.Auth.canScoreMatch({
    id: window.matchDetailContext.matchId,
    player1_id: window.matchDetailContext.p1Id,
    player2_id: window.matchDetailContext.p2Id
  });
}


function setAddFriendlyVisible(visible) {
    if (!addFriendlyBtn) return;
    addFriendlyBtn.style.display = visible ? "inline-flex" : "none";
}

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

function renderAuthControls() {
  const container = document.getElementById("auth-controls");
  if (!container) return;

  container.replaceChildren();

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
  if (!window.auth) return;
  
  const existing = document.getElementById("bottom-bar");
  if (existing) existing.remove();

	const canScore = canScoreCurrentMatch();
	
	const canManage =
	  !!window.currentTournament &&
	  window.auth?.can("manage_tournament", {
		type: "tournament",
		id: window.currentTournament.id,
		country: window.currentTournament.country
	  });

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
	  
	const isFriendlies =
	window.currentTournamentId === FRIENDLIES_TOURNAMENT_ID;

	const canAddFriendly =
	  isFriendlies &&
	  !window.currentMatchId &&
	  auth.can("friendly.create");

	if (canManage) {
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
	
	const canAddTournament =
		isSuperAdmin() &&
		window.location.hash.startsWith("#/leagues");
	
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
	  canAddTournament
		? `
		  <button class="bb-item" data-action="add-tournament">
			<img src="assets/icon-add.svg" alt="" />
			<span>Add tournament</span>
		  </button>
		`
		: ""
	}

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
	  btn.addEventListener("click", (e) => {
		const action = btn.dataset.action;

		switch (action) {
		  case "today": {
			const url = new URL(window.location.href);
			url.searchParams.delete("date");
			history.replaceState(null, "", url.toString());
			window.location.hash = "#/tournaments";
			return;
		  }

		  case "tournaments":
			window.location.hash = "#/leagues";
			return;

		  case "add-friendly":
			if (canAddFriendly) {
			  window.location.hash =
				`#/tournament/${FRIENDLIES_TOURNAMENT_ID}/manage-matches`;
			}
			return;

		  case "score":
			if (canScore) openScoringConsole();
			return;

		  case "manage":
			if (canManage) {
			  window.location.hash =
				`#/tournament/${window.currentTournamentId}/overview?tab=manage`;
			}
			return;

		  case "add-tournament":
			if (canAddTournament) openCreateTournamentModal();
			return;
		}
	  });
	});
}

function updateBottomBar() {
  renderBottomBar();
}

function activateTab(tabName) {
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

  window.tournamentContext.activeOverviewTab = tabName;

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
