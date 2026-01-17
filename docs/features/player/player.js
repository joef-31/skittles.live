async function loadPlayerPage(playerId, tabFromRoute = "overview") {
    window.currentMatchId = null;
    window.currentTournamentId = null;
	window.matchDetailContext = null;
    window.lastSeenSet = null;

    showBackButton(() => {
        window.location.hash = "#/tournaments";
    });

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
	
	window.App = window.App || {};
	App.Features = App.Features || {};
	App.Features.Player = App.Features.Player || {};

	App.Features.Player.renderPlayerPage = loadPlayerPage;
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

window.App = window.App || {};
App.Features = App.Features || {};
App.Features.Player = App.Features.Player || {};

App.Features.Player.renderPlayerPage = loadPlayerPage;
