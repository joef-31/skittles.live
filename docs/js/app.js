// =======================================================
// 1. GLOBAL CONSTANTS / FRIENDLIES / TOP-LEVEL UI
// =======================================================

const FRIENDLIES_TOURNAMENT_ID = "11111111-1111-1111-1111-111111111111";

// Track current route context
window.currentMatchId = null;
window.currentTournamentId = null;
window.lastSeenSet = null;

// Tournament context (future-proofing)
window.tournamentContext = {
    tournamentId: null,
    editionId: null,
    stageId: null,
    groupId: null,
    activeOverviewTab: "overview",
};

// =======================================================
// 2. LOW-LEVEL PURE HELPERS
// =======================================================

function isoDateOnly(iso) {
    if (!iso) return null;
    return iso.split("T")[0];
}

function isToday(dateStr) {
    return dateStr === new Date().toISOString().split("T")[0];
}

// =======================================================
// 3. GENERIC UI HELPERS
// =======================================================

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
    setContent(`<div class="card"><div class="error">${message}</div></div>`);
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

function getCountryFlagPath(countryCode) {
    if (!countryCode) return "/assets/flags/WORLD.png";
    return `/assets/flags/${countryCode}.png`;
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

function updateScoreButtonVisibility(show) {
    if (!scoreBtn) return;
    if (show && (typeof SUPERADMIN === "undefined" || SUPERADMIN)) {
        scoreBtn.style.display = "inline-flex";
    } else {
        scoreBtn.style.display = "none";
    }
}

// Show / hide Add Friendly button depending on current view
function setAddFriendlyVisible(visible) {
    if (!addFriendlyBtn) return;
    addFriendlyBtn.style.display = visible ? "inline-flex" : "none";
}

// Ensure Friendlies tournament exists in DB
async function ensureFriendliesTournamentExists() {
    const { error } = await supabase.from("tournaments").upsert(
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
// 4. AUTH / PERMISSIONS
// =======================================================

function canManageTournament(tournament) {
    if (typeof SUPERADMIN !== "undefined" && SUPERADMIN) return true;

    if (window.USER_COUNTRIES?.includes(tournament.country)) return true;

    if (window.USER_TOURNAMENTS?.includes(tournament.id)) return true;

    return false;
}

// =======================================================
// 5. DATA BUILDERS / CACHES
// =======================================================

function buildTournamentPlayers(matches) {
  console.log("[buildTournamentPlayers] called", matches);

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

  console.log("[buildTournamentPlayers] players:", window.tournamentPlayers);
}


// =======================================================
// 6. OVERLAYS
// =======================================================

async function openManageMatchesOverlay() {
  ensureManageMatchesOverlay();

  document
    .getElementById("manage-matches-overlay")
    .classList.remove("hidden");

  await loadTournamentMatchesForOverlay();
}

function closeManageMatchesOverlay() {
    document.getElementById("manage-matches-overlay")?.classList.add("hidden");
}

function ensureManageMatchesOverlay() {
    if (document.getElementById("manage-matches-overlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "manage-matches-overlay";
    overlay.className = "overlay hidden";

    overlay.innerHTML = `
    <div class="overlay-card large">
      <div class="overlay-header">
        <div class="overlay-title">Manage matches</div>
        <button class="icon-btn" id="close-manage-matches">✕</button>
      </div>

      <div id="manage-matches-content"></div>
    </div>
  `;

    document.body.appendChild(overlay);

    document.getElementById(
        "close-manage-matches"
    ).onclick = closeManageMatchesOverlay;
}

function renderManageMatches(matches) {
  const el = document.getElementById("manage-matches-content");
  if (!el) return;

  el.innerHTML = `
    <div class="manage-matches-grid">

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
        </label>

        <button class="header-btn" id="mm-add-btn" style="margin-top:10px;">
          Add match
        </button>

        <div class="error" id="mm-error" style="display:none;"></div>
      </div>

      <div class="card">
        <div class="section-title">Existing matches</div>
        <div class="matches-scroll">
          ${
            matches.length
              ? matches
                  .map(
                    (m) => `
              <div class="match-row">
                <span>${m.player1?.name || "TBC"} v ${m.player2?.name || "TBC"}</span>
                <span class="muted">${m.match_date ? formatDate(m.match_date) : "No date"}</span>
              </div>
            `
                  )
                  .join("")
              : `<div class="empty-message">No matches yet.</div>`
          }
        </div>
      </div>

    </div>
  `;

  wireManageMatchAdd();
}

function openOverlay(html) {
  const existing = document.getElementById("global-overlay");
  if (existing) existing.remove();

  const backdrop = document.createElement("div");
  backdrop.id = "global-overlay";
  backdrop.className = "overlay-backdrop";

  backdrop.innerHTML = `
    <div class="overlay-card">
      <button class="overlay-close" id="overlay-close">×</button>
      ${html}
    </div>
  `;

  document.body.appendChild(backdrop);

  document.getElementById("overlay-close").onclick = () => {
    backdrop.remove();
  };

  backdrop.addEventListener("click", e => {
    if (e.target === backdrop) backdrop.remove();
  });

  return backdrop;
}



// =======================================================
// 7. VIEW RENDERERS
// =======================================================

function renderTournamentOverviewTab(tournament, matches) {
    const el = document.getElementById("tab-overview");
    if (!el) return;

    const total = matches.length;
    const finished = matches.filter((m) => m.status === "finished").length;
    const upcoming = matches.filter((m) => m.status === "scheduled").length;

    const dates = matches
        .map((m) => m.match_date)
        .filter(Boolean)
        .sort();

    const start = dates.length ? formatDate(dates[0]) : "–";
    const end = dates.length ? formatDate(dates[dates.length - 1]) : "–";

    el.innerHTML = `
    <div class="overview-grid">
      <div class="overview-item">
        <div class="label">Type</div>
        <div class="value">${tournament.type || "Formal"}</div>
      </div>

      <div class="overview-item">
        <div class="label">Matches</div>
        <div class="value">${total}</div>
      </div>

      <div class="overview-item">
        <div class="label">Completed</div>
        <div class="value">${finished}</div>
      </div>

      <div class="overview-item">
        <div class="label">Upcoming</div>
        <div class="value">${upcoming}</div>
      </div>

      <div class="overview-item">
        <div class="label">Start</div>
        <div class="value">${start}</div>
      </div>

      <div class="overview-item">
        <div class="label">End</div>
        <div class="value">${end}</div>
      </div>
    </div>
  `;
}

function renderTournamentFixturesTab(matches) {
    const fixtures = matches.filter((m) => m.status === "scheduled");

    renderMatchCards(
        fixtures,
        window.currentTournamentId,
        {},
        null,
        "tab-fixtures"
    );
}

function renderTournamentResultsTab(matches) {
    const results = matches.filter((m) => m.status === "finished");

    renderMatchCards(
        results,
        window.currentTournamentId,
        {},
        null,
        "tab-results"
    );
}

async function renderTournamentStandingsTab(tournamentId, matches) {
    const el = document.getElementById("tab-standings");
    if (!el) return;

    const matchIds = matches.map((m) => m.id).filter(Boolean);

    if (!matchIds.length) {
        el.innerHTML = `<div class="empty-message">No matches.</div>`;
        return;
    }

    const { data: sets, error } = await supabase
        .from("sets")
        .select("match_id, score_player1, score_player2, winner_player_id")
        .in("match_id", matchIds);

    if (error) {
        console.error(error);
        el.innerHTML = `<div class="error">Failed to load standings.</div>`;
        return;
    }

    renderStandingsTable(matches, sets || [], el);
}

function renderTournamentManageTab(tournament, editions, allStages) {
  const el = document.getElementById("tab-manage");
  if (!el) return;

  el.innerHTML = `
    <div class="manage-grid">

      <div class="card manage-card">
        <div class="manage-title">Editions & stages</div>
        <div class="manage-desc">
          Create and organise editions and competition stages.
        </div>

        <div class="manage-actions">
          <button class="header-btn small" id="add-edition-btn">
            + Add edition
          </button>

          <button class="header-btn small" id="add-stage-btn">
            + Add stage
          </button>
        </div>

        <div id="manage-editions-stages-content">
          ${renderEditionsStagesList(editions, allStages)}
        </div>
      </div>

      <div class="card manage-card clickable" id="manage-matches-card">
        <div class="manage-title">Matches</div>
        <div class="manage-desc">
          Add and manage matches for this edition & stage.
        </div>
        <div class="manage-actions">
          <button class="header-btn small">
            Open match manager
          </button>
        </div>
      </div>

    </div>
  `;

  // Wire stage reorder buttons
  el.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      reorderStage(btn.dataset.stage, btn.dataset.action);
    });
  });
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

function renderTournamentSelectors(editions, stages) {
    return `
    <div class="tournament-selectors">
      <label>
        Edition
        <select id="edition-select">
          ${editions
              .map(
                  (e) => `
            <option value="${e.id}" ${
                      e.id === window.tournamentContext.editionId
                          ? "selected"
                          : ""
                  }>
              ${e.name}
            </option>`
              )
              .join("")}
        </select>
      </label>

      <label>
        Stage
        <select id="stage-select">
          ${stages
              .map(
                  (s) => `
            <option value="${s.id}" ${
                      s.id === window.tournamentContext.stageId
                          ? "selected"
                          : ""
                  }>
              ${s.name}
            </option>`
              )
              .join("")}
        </select>
      </label>
    </div>
  `;
}

// =======================================================
// 8. VIEW WIRES
// =======================================================

function bindOverviewTabs() {
    document.querySelectorAll(".tab-row .tab").forEach((tab) => {
        tab.addEventListener("click", () => {
            const target = tab.dataset.tab;

            // store active tab
            window.tournamentContext.activeOverviewTab = target;

            document
                .querySelectorAll(".tab-row .tab")
                .forEach((t) => t.classList.remove("active"));
            tab.classList.add("active");

            ["overview", "standings", "fixtures", "results", "manage"].forEach(
                (id) => {
                    const panel = document.getElementById(`tab-${id}`);
                    if (panel) {
                        panel.style.display = id === target ? "block" : "none";
                    }
                }
            );
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

            await supabase.from("editions").insert({
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
        addStageBtn.onclick = async () => {
            const editionId = window.tournamentContext.editionId;
            if (!editionId) {
                alert("Select an edition first.");
                return;
            }

            const name = prompt("Stage name:");
            if (!name) return;

            const type = prompt("Stage type (group / knockout):", "group");
            if (!type) return;

            // find next order_index
            const { data: existing } = await supabase
                .from("stages")
                .select("order_index")
                .eq("edition_id", editionId)
                .order("order_index", { ascending: false })
                .limit(1);

            const nextOrder = existing?.[0]?.order_index ?? 0;

            await supabase.from("stages").insert({
                edition_id: editionId,
                name,
                stage_type: type,
                order_index: nextOrder + 1,
            });

            window.tournamentContext.stageId = null;
            loadTournamentOverview(window.currentTournamentId);
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
                const { error } = await supabase.from("matches").insert({
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
// 9. VIEW LOADERS
// =======================================================

	// =======================================================
	// 9.1 MANAGE MATCHES
	// =======================================================
	
async function loadTournamentMatchesManage(tournamentId) {
  window.currentMatchId = null;
  window.currentTournamentId = tournamentId;
  window.tournamentContext.tournamentId = tournamentId;
  window.lastSeenSet = null;

  showBackButton(() => {
    window.location.hash = `#/tournament/${tournamentId}/overview`;
  });
  updateScoreButtonVisibility(false);
  setAddFriendlyVisible(false);

  showLoading("Loading matches…");

  // ---- Load editions ----
  const { data: editions } = await supabase
    .from("editions")
    .select("id, name")
    .eq("tournament_id", tournamentId)
    .order("name");

  if (!editions?.length) {
    showError("No editions found.");
    return;
  }

  if (
    !window.tournamentContext.editionId ||
    !editions.some(e => e.id === window.tournamentContext.editionId)
  ) {
    window.tournamentContext.editionId = editions[0].id;
  }

  // ---- Load stages ----
  const { data: stages } = await supabase
    .from("stages")
    .select("id, name")
    .eq("edition_id", window.tournamentContext.editionId)
    .order("order_index");

  if (!stages?.length) {
    showError("No stages found.");
    return;
  }

  if (
    !window.tournamentContext.stageId ||
    !stages.some(s => s.id === window.tournamentContext.stageId)
  ) {
    window.tournamentContext.stageId = stages[0].id;
  }

  const currentEdition = editions.find(
    e => e.id === window.tournamentContext.editionId
  );
  const currentStage = stages.find(
    s => s.id === window.tournamentContext.stageId
  );

  // ---- Load matches ----
  const { data: matchesRaw } = await supabase
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
    .eq("edition_id", window.tournamentContext.editionId)
    .eq("stage_id", window.tournamentContext.stageId)
    .order("match_date");

  const matches = matchesRaw || [];

  buildTournamentPlayers(matches);
  const tournamentPlayers = window.tournamentPlayers || [];

  const contextLabel = `${currentEdition.name} – ${currentStage.name}`;

  // ---- Render ----
  setContent(`
    <div class="card">
      <div class="tournament-header">
        <div class="tournament-name">Add tournament match</div>
        <div class="subtitle">${contextLabel}</div>
      </div>

      <div class="section-title">New match</div>

      <div class="friendly-form">
		<input id="tm-p1" placeholder="Player A" autocomplete="off" />
		<div id="tm-p1-suggestions" class="friendly-suggestions"></div>

		<input id="tm-p2" placeholder="Player B" autocomplete="off" />
		<div id="tm-p2-suggestions" class="friendly-suggestions"></div>

        <input id="tm-date" type="datetime-local" />

        <div class="form-row-inline">
          <input id="tm-s1" type="number" placeholder="Sets A" />
          <input id="tm-s2" type="number" placeholder="Sets B" />
        </div>

        <select id="tm-status">
          <option value="scheduled">Scheduled</option>
          <option value="live">Live</option>
          <option value="finished">Finished</option>
        </select>

        <div class="form-row-inline">
          <button id="tm-create">Create match only</button>
          <button id="tm-create-sets" class="secondary">
            Create & add set scores
          </button>
        </div>

        <div id="tm-error" class="error"></div>
      </div>

      <div class="section-title">Existing matches</div>
      ${matches.map(m => `
        <div class="manage-match-row">
          ${formatDate(m.match_date)} –
          ${m.player1?.name} <strong>${m.final_sets_player1 ?? 0}–${m.final_sets_player2 ?? 0}</strong>
          ${m.player2?.name}
          <span class="pill ${m.status}">${m.status}</span>
          <button class="mm-delete" data-id="${m.id}">🗑</button>
        </div>
      `).join("")}
    </div>
  `);
  
	  attachPlayerAutocomplete(
	  document.getElementById("tm-p1"),
	  document.getElementById("tm-p1-suggestions"),
	  () => window.tournamentPlayers
	);

	attachPlayerAutocomplete(
	  document.getElementById("tm-p2"),
	  document.getElementById("tm-p2-suggestions"),
	  () => window.tournamentPlayers
	);


  // ---- Create buttons ----
  document.getElementById("tm-create").onclick = async () => {
    try {
      await createTournamentMatch({ goToSets: false });
      loadTournamentMatchesManage(tournamentId);
    } catch (e) {
      document.getElementById("tm-error").textContent = e.message;
    }
  };

  document.getElementById("tm-create-sets").onclick = async () => {
    try {
      const id = await createTournamentMatch({ goToSets: true });
      window.location.hash = `#/tournament/${tournamentId}/match/${id}/sets`;
    } catch (e) {
      document.getElementById("tm-error").textContent = e.message;
    }
  };

  // ---- Delete handlers ----
  document.querySelectorAll(".mm-delete").forEach(btn => {
    btn.onclick = async () => {
      await supabase.from("matches").delete().eq("id", btn.dataset.id);
      loadTournamentMatchesManage(tournamentId);
    };
  });
}

	// =======================================================
	// 9.2 CREATE MATCH
	// =======================================================

async function createTournamentMatch({ goToSets }) {
  const p1 = document.getElementById("tm-p1").value.trim();
  const p2 = document.getElementById("tm-p2").value.trim();

  if (!p1 || !p2) throw new Error("Both players required.");

  const p1Id = await resolveOrCreatePlayerByName(p1, { allowGuest: false });
  const p2Id = await resolveOrCreatePlayerByName(p2, { allowGuest: false });

  const allowed = (window.tournamentPlayers || []).map(p => p.id);
  if (allowed.length && (!allowed.includes(p1Id) || !allowed.includes(p2Id))) {
    throw new Error("Players must be registered in this tournament.");
  }

  const { data } = await supabase
    .from("matches")
    .insert({
      tournament_id: window.currentTournamentId,
      edition_id: window.tournamentContext.editionId,
      stage_id: window.tournamentContext.stageId,
      player1_id: p1Id,
      player2_id: p2Id,
      match_date: new Date(document.getElementById("tm-date").value).toISOString(),
      status: document.getElementById("tm-status").value,
      final_sets_player1: Number(document.getElementById("tm-s1").value || 0),
      final_sets_player2: Number(document.getElementById("tm-s2").value || 0)
    })
    .select("id")
    .maybeSingle();

  return data.id;
}

	// =======================================================
	// 9.3 ADD SETS TO CREATED MATCH
	// =======================================================

async function loadTournamentMatchSets(matchId, tournamentId) {
  console.log("[loadTournamentMatchSets]", { matchId, tournamentId });

  window.currentMatchId = matchId;
  window.currentTournamentId = tournamentId;
  window.lastSeenSet = null;

  showBackButton(() => {
    window.location.hash = `#/tournament/${tournamentId}/matches`;
  });
  updateScoreButtonVisibility(false);
  setAddFriendlyVisible(false);

  showLoading("Loading set scores…");

  const { data: match, error } = await supabase
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
      <tr>
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
    // await supabase.from("sets").delete().eq("match_id", matchId);

    const { error: insertError } = await supabase
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
	// 9.4 ADD THROWS TO CREATED MATCH
	// =======================================================

async function loadTournamentMatchThrows(matchId, tournamentId) {
  window.currentMatchId = matchId;
  window.currentTournamentId = tournamentId;

  showBackButton(() => {
    window.location.hash = `#/match/${matchId}/${tournamentId}`;
  });

  updateScoreButtonVisibility(false);
  setAddFriendlyVisible(false);

  showLoading("Loading match…");

  // Load match & players
  const { data: match, error } = await supabase
    .from("matches")
    .select(`
      id,
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

  setContent(`
    <div class="card">
      <div class="tournament-header">
        <div class="tournament-name">Upload throws</div>
        <div class="subtitle">
          ${match.player1.name} vs ${match.player2.name}
        </div>
      </div>

      <p class="match-small">
        CSV format:<br/>
        <code>Set,Player,Throw 1,Throw 2,Throw 3...</code>
      </p>

      <input type="file" id="throws-file" accept=".csv" />

      <div id="throws-preview" style="margin-top:15px;"></div>

      <button
        id="import-throws-btn"
        class="header-btn"
        style="margin-top:15px;"
        disabled
      >
        Import throws
      </button>
    </div>
  `);

  const fileInput = document.getElementById("throws-file");
  const previewDiv = document.getElementById("throws-preview");
  const importBtn = document.getElementById("import-throws-btn");

  let parsedThrows = [];

  // Parse CSV
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;

    const text = await file.text();
    const lines = text.trim().split(/\r?\n/);
    const headers = lines[0].split(",").map(h => h.trim());

    const setIdx = headers.indexOf("Set");
    const playerIdx = headers.indexOf("Player");

    if (setIdx === -1 || playerIdx === -1) {
      previewDiv.innerHTML =
        "<div class='error'>CSV must include Set and Player columns.</div>";
      return;
    }

    parsedThrows = [];

    lines.slice(1).forEach(line => {
      const cells = line.split(",").map(c => c.trim());
      const setNumber = Number(cells[setIdx]);
      const playerNo = Number(cells[playerIdx]);

      const playerId =
        playerNo === 1
          ? match.player1.id
          : playerNo === 2
          ? match.player2.id
          : null;

      if (!playerId) return;

      headers.forEach((h, i) => {
        if (!h.toLowerCase().startsWith("throw")) return;
        const score = Number(cells[i]);
        if (isNaN(score)) return;

        const throwNo = Number(h.replace(/[^0-9]/g, ""));

        parsedThrows.push({
          match_id: matchId,
          set_number: setNumber,
          player_id: playerId,
          throw_number: throwNo,
          score
        });
      });
    });

    previewDiv.innerHTML = `
      <div class="match-small">
        Parsed ${parsedThrows.length} throws.
      </div>
    `;
    importBtn.disabled = parsedThrows.length === 0;
  });

  // Import
  importBtn.addEventListener("click", async () => {
    if (!parsedThrows.length) return;

    // Clear existing throws
    await supabase
      .from("throws")
      .delete()
      .eq("match_id", matchId);

    const { error: insertError } = await supabase
      .from("throws")
      .insert(parsedThrows);

    if (insertError) {
      console.error(insertError);
      alert("Failed to import throws.");
      return;
    }

    window.location.hash = `#/match/${matchId}/${tournamentId}`;
  });
}

async function loadTournamentMatchesForOverlay() {
  const { tournamentId, editionId, stageId } = window.tournamentContext;

  const container = document.getElementById("manage-matches-content");
  if (!container) return;

  if (!tournamentId || !editionId || !stageId) {
    container.innerHTML =
      `<div class="empty-message">Select edition and stage first.</div>`;
    return;
  }

  const { data: matches, error } = await supabase
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
    .eq("edition_id", editionId)
    .eq("stage_id", stageId)
    .order("match_date", { ascending: true });

  if (error) {
    console.error(error);
    container.innerHTML =
      `<div class="error">Failed to load matches.</div>`;
    return;
  }

  renderTournamentMatchesTable(matches || []);
}

async function loadTournamentOverview(tournamentId) {
  window.currentMatchId = null;
  window.currentTournamentId = tournamentId;
  window.tournamentContext.tournamentId = tournamentId;

  showBackButton(() => {
    window.location.hash = "#/tournaments";
  });
  updateScoreButtonVisibility(false);
  setAddFriendlyVisible(false);

  showLoading("Loading tournament overview…");

  // 1) Load base tournament data
  const { data: tournament, error: tError } = await supabase
    .from("tournaments")
    .select("id, name, country, type")
    .eq("id", tournamentId)
    .maybeSingle();

  if (tError || !tournament) {
    console.error(tError);
    showError("Failed to load tournament.");
    return;
  }

  const tournamentName = tournament.name || "Tournament";

  // 2) Load editions for this tournament
  const { data: editions, error: editionsError } = await supabase
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
  const { data: stages, error: stagesError } = await supabase
    .from("stages")
    .select("id, name")
    .eq("edition_id", window.tournamentContext.editionId)
    .order("order_index", { ascending: true });

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
  if (
    !window.tournamentContext.stageId ||
    !stages.some(s => s.id === window.tournamentContext.stageId)
  ) {
    window.tournamentContext.stageId = stages[0].id;
  }

  // 3b) Load ALL stages for manage tab (for all editions)
  const { data: allStages, error: allStagesError } = await supabase
    .from("stages")
    .select("id, name, edition_id, stage_type, order_index")
    .in(
      "edition_id",
      editions.map(e => e.id)
    );

  if (allStagesError) {
    console.error(allStagesError);
  }

  // 4) Load matches filtered by edition + stage
  const { data: matchesRaw, error: matchError } = await supabase
    .from("matches")
    .select(`
      id,
      match_date,
      status,
      final_sets_player1,
      final_sets_player2,
      player1:player1_id ( id, name ),
      player2:player2_id ( id, name ),
      tournament:tournament_id ( id, name, country, type ),
      edition_id,
      stage_id
    `)
    .eq("tournament_id", tournamentId)
    .eq("edition_id", window.tournamentContext.editionId)
    .eq("stage_id", window.tournamentContext.stageId)
    .order("match_date", { ascending: true });

  if (matchError) {
    console.error(matchError);
    showError("Failed to load matches for this edition/stage.");
    return;
  }

  const matches = matchesRaw || [];

  // Populate the global player cache for this tournament
  buildTournamentPlayers(matches);

  const showManage = canManageTournament(tournament);

  // 5) Base layout with selectors + tabs
  setContent(`
    <div class="card">
      <div class="tournament-header">
        <div class="tournament-name">${tournamentName}</div>
        <div class="subtitle">Tournament overview</div>
      </div>

      ${renderTournamentSelectors(editions, stages)}

      <div class="tab-row">
        <div class="tab active" data-tab="overview">Overview</div>
        <div class="tab" data-tab="standings">Standings</div>
        <div class="tab" data-tab="fixtures">Fixtures</div>
        <div class="tab" data-tab="results">Results</div>
        ${showManage ? `<div class="tab" data-tab="manage">Manage</div>` : ""}
      </div>

      <div id="tab-overview"></div>
      <div id="tab-standings" style="display:none;"></div>
      <div id="tab-fixtures" style="display:none;"></div>
      <div id="tab-results" style="display:none;"></div>
      ${showManage ? `<div id="tab-manage" style="display:none;"></div>` : ""}
    </div>
  `);

  // 6) Wire selectors to reload with new context
  document.getElementById("edition-select")?.addEventListener("change", e => {
    window.tournamentContext.editionId = e.target.value;
    window.tournamentContext.stageId = null; // reset stage
    loadTournamentOverview(tournamentId);
  });

  document.getElementById("stage-select")?.addEventListener("change", e => {
    window.tournamentContext.stageId = e.target.value;
    loadTournamentOverview(tournamentId);
  });

  // 7) Render tabs
  renderTournamentOverviewTab(tournament, matches);
  renderTournamentFixturesTab(matches);
  renderTournamentResultsTab(matches);
  await renderTournamentStandingsTab(tournamentId, matches);
  bindOverviewTabs();

  // Restore previously active tab
  const activeTab = window.tournamentContext.activeOverviewTab || "overview";
  const tabEl = document.querySelector(`.tab[data-tab="${activeTab}"]`);
  if (tabEl) tabEl.click();

  // 8) Manage tab
  if (showManage) {
    renderTournamentManageTab(tournament, editions, allStages || []);
    wireManageEditionsStages();

  const matchesCard = document.getElementById("manage-matches-card");
  if (matchesCard) {
    matchesCard.onclick = () => {
      window.location.hash = `#/tournament/${tournamentId}/manage-matches`;
      };
    }
  }
}


async function loadTournamentView(tournamentId) {
        window.currentMatchId = null;
        window.currentTournamentId = tournamentId;
        window.lastSeenSet = null;

        const isFriendlies = tournamentId === FRIENDLIES_TOURNAMENT_ID;

        showBackButton(() => {
            window.location.hash = "#/tournaments";
        });
        updateScoreButtonVisibility(false);
        setAddFriendlyVisible(isFriendlies);

        if (isFriendlies && addFriendlyBtn) {
            addFriendlyBtn.onclick = () => {
                window.location.hash = "#/friendlies/new";
            };
        }

        showLoading("Loading tournament…");

        if (isFriendlies) {
            await ensureFriendliesTournamentExists();
        }

        const { data: matches, error: matchError } = await supabase
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
            .eq("tournament_id", tournamentId)
            .order("match_date", { ascending: true });

        if (matchError) {
            console.error(matchError);
            showError("Failed to load matches");
            return;
        }

        if (!matches || matches.length === 0) {
            setContent(
                '<div class="card"><div class="empty-message">No matches found for this tournament.</div></div>'
            );
            return;
        }

        const tournamentName = matches[0].tournament?.name || "Tournament";
        const matchIds = matches.map((m) => m.id);

        // Load sets for all matches in the tournament
        let sets = [];
        if (matchIds.length > 0) {
            const { data: setsData, error: setsError } = await supabase
                .from("sets")
                .select(
                    "id, match_id, set_number, score_player1, score_player2, winner_player_id"
                )
                .in("match_id", matchIds);

            if (setsError) {
                console.error(setsError);
                showError("Failed to load sets");
                return;
            }
            sets = setsData || [];
        }

        // Determine which set (if any) is live per match
        const liveSetByMatch = {};
        sets.forEach((s) => {
            if (!s.match_id) return;
            const isLiveSet =
                !s.winner_player_id &&
                s.score_player1 < 50 &&
                s.score_player2 < 50;
            if (!isLiveSet) return;
            const existing = liveSetByMatch[s.match_id];
            if (!existing || s.set_number > existing.set_number) {
                liveSetByMatch[s.match_id] = {
                    set_number: s.set_number,
                    p1: s.score_player1,
                    p2: s.score_player2,
                };
            }
        });

        // Build main tournament card + tabs (same structure as before)
        let html = `
    <div class="card">
      <div class="tournament-header">
        <div class="tournament-name">${tournamentName}</div>
      </div>

      <div class="tab-row">
        <div class="tab active" data-tab="matches">Matches</div>
        <div class="tab" data-tab="standings">Standings</div>
      </div>

      <div id="tab-matches"></div>
      <div id="tab-standings" style="display:none;"></div>
    </div>
  `;
        setContent(html);

        // Friendlies: hide standings tab completely
        if (isFriendlies) {
            const standingsTab = document.querySelector(
                '.tab[data-tab="standings"]'
            );
            const standingsPanel = document.getElementById("tab-standings");
            if (standingsTab) standingsTab.style.display = "none";
            if (standingsPanel) standingsPanel.style.display = "none";
        }

        // --- Date bar + default filter = today ---
        const today = new Date().toISOString().split("T")[0];
        const matchDates = matches
            .map((m) => isoDateOnly(m.match_date))
            .filter(Boolean);

        // Default to today only if there are matches today in this tournament
        activeDateFilter = matchDates.includes(today) ? today : null;

        renderDateBar(matchDates, (selectedDate) => {
            // If user clears selection, fall back to today again (or no filter if no matches today)
            activeDateFilter =
                selectedDate || (matchDates.includes(today) ? today : null);
            renderMatchCards(
                matches,
                tournamentId,
                liveSetByMatch,
                activeDateFilter
            );
        });

        // Initial render (today if present, otherwise "no matches on this date")
        renderMatchCards(
            matches,
            tournamentId,
            liveSetByMatch,
            activeDateFilter
        );

        // --- Standings (unchanged from your working version) ---
        if (!isFriendlies) {
            const standingsContainer = document.getElementById("tab-standings");
            const matchesById = {};
            matches.forEach((m) => (matchesById[m.id] = m));

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

            matches.forEach((m) => {
                if (!m.player1?.id || !m.player2?.id) return;
                if (m.status === "scheduled") return;
                ensurePlayer(m.player1.id, m.player1.name);
                ensurePlayer(m.player2.id, m.player2.name);
                playerStats[m.player1.id].played += 1;
                playerStats[m.player2.id].played += 1;
            });

            sets.forEach((s) => {
                if (!s.match_id || !s.winner_player_id) return;
                const m = matchesById[s.match_id];
                if (!m || !m.player1 || !m.player2) return;

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

            const standingsArr = Object.values(playerStats);
            standingsArr.sort((a, b) => {
                if (b.setsWon !== a.setsWon) return b.setsWon - a.setsWon;
                if (b.smallPoints !== a.smallPoints)
                    return b.smallPoints - a.smallPoints;
                return a.name.localeCompare(b.name);
            });

            let standingsHtml = "";
            standingsHtml += `<div class="standings-group-title">Group A</div>`;

            if (standingsArr.length === 0) {
                standingsHtml +=
                    '<div class="empty-message">No results yet for standings.</div>';
            } else {
                standingsHtml += `
    <table class="standings-table">
      <thead>
        <tr>
          <th class="pos" style="text-align:center;">Pos</th>
          <th style="text-align:left;">Player</th>
          <th style="text-align:center;">P</th>
          <th style="text-align:center;">SW</th>
          <th style="text-align:center;">SL</th>
          <th style="text-align:center;">SP</th>
        </tr>
      </thead>
      <tbody>
        ${standingsArr
            .map(
                (p, index) => `
          <tr data-pos="${index + 1}">
            <td class="pos" width=2.0em style="text-align:center;">${
                index + 1
            }</td>
            <td style="text-align:left;">${p.name}</td>
            <td style="text-align:center;">${p.played}</td>
            <td style="text-align:center;">${p.setsWon}</td>
            <td style="text-align:center;">${p.setsLost}</td>
            <td style="text-align:center;">${p.smallPoints}</td>
          </tr>
        `
            )
            .join("")}
      </tbody>
    </table>
  `;
            }

            standingsContainer.innerHTML = standingsHtml;

            document.querySelectorAll(".tab-row .tab").forEach((tab) => {
                tab.addEventListener("click", () => {
                    const tabId = tab.getAttribute("data-tab");
                    document
                        .querySelectorAll(".tab-row .tab")
                        .forEach((t) => t.classList.remove("active"));
                    tab.classList.add("active");
                    document.getElementById("tab-matches").style.display =
                        tabId === "matches" ? "block" : "none";
                    document.getElementById("tab-standings").style.display =
                        tabId === "standings" ? "block" : "none";
                });
            });
        }
    }

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

  const { data: players, error } = await supabase
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

        const { data: inserted, error: matchErr } = await supabase
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

    const { error } = await supabase.from("matches").insert(payload);

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


    async function loadMatchDetail(matchId, tournamentId) {
        window.currentMatchId = matchId;
        window.currentTournamentId = tournamentId;
        window.lastSeenSet = null;

        showBackButton(() => {
            window.location.hash = `#/tournament/${tournamentId}`;
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
      <div class="subtitle">${tournamentName}</div>

      <div class="top-score-row">
        <div class="top-player" style="text-align:right;">${p1Name}</div>
        <div class="top-score">${overallSets}</div>
        <div class="top-player" style="text-align:left;">${p2Name}</div>
      </div>

      <div class="live-throwstrip-row">
        <div class="live-throwstrip p1" id="header-throws-p1"></div>
        <div class="live-setscore" id="header-live-setscore">${liveSP1} – ${liveSP2}</div>
        <div class="live-throwstrip p2" id="header-throws-p2"></div>
      </div>

      <div class="match-small">
        ${formatDate(match.match_date)}
      </div>
      <div class="match-small">
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
          await supabase.from("throws").insert({
            match_id: matchId,
            set_number: Number(setNum),
            throw_number: Number(throwNum),
            score: Number(p1)
          });
        }

        if (p2 !== "") {
          await supabase.from("throws").insert({
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
            supabase
                .from("tournaments")
                .select("id, name")
                .order("name", { ascending: true }),
            supabase.from("matches").select("id, tournament_id, match_date"),
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

        // Build date → set of tournament IDs (excluding Friendlies),
        // and collect ALL dates where *any* match exists (including friendlies)
        const dateToTournamentIds = {};
        const allDatesSet = new Set();

        matches.forEach((m) => {
            if (!m.match_date) return;
            const d = isoDateOnly(m.match_date);
            if (!d) return;

            // All match dates (for bar)
            allDatesSet.add(d);

            // Only "real" tournaments drive which cards are shown
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
                window.location.hash = `#/tournament/${tid}`;
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
    }

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

        const { data, error } = await supabase
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
    // 10. SIMPLE HASH ROUTER — keeps view in sync with URL
    // =======================================================

  function handleRoute() {
  const hash = window.location.hash || "#/tournaments";
  const parts = hash.replace("#", "").split("/");

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

  // #/friendlies → just the Friendlies tournament
  if (parts[1] === "friendlies" && !parts[2]) {
    loadTournamentView(FRIENDLIES_TOURNAMENT_ID);
    return;
  }

  // #/friendlies/new
  if (parts[1] === "friendlies" && parts[2] === "new") {
    loadFriendlyCreate();
    return;
  }

  // #/tournament/<tid>/overview
  if (parts[1] === "tournament" && parts[2] && parts[3] === "overview") {
    loadTournamentOverview(parts[2]);
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

  // #/tournament/<tid>/manage-matches
  if (parts[1] === "tournament" && parts[2] && parts[3] === "manage-matches") {
    loadTournamentMatchesManage(parts[2]);
    return;
  }

  // #/tournament/<tid>
  if (parts[1] === "tournament" && parts[2]) {
    loadTournamentView(parts[2]);
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
  
  // #/match/<mid>/sets/setup
if (parts[1] === "match" && parts[2] && parts[3] === "sets" && parts[4] === "setup") {
  loadMatchSetSetup(parts[2]);
  return;
}

// #/match/<mid>/throws/upload
if (parts[1] === "match" && parts[2] && parts[3] === "throws" && parts[4] === "upload") {
  loadMatchThrowsUpload(parts[2]);
  return;
}

  // #/match/<mid>/<tid>
  if (parts[1] === "match" && parts[2] && parts[3]) {
    loadMatchDetail(parts[2], parts[3]);
    return;
  }


  // fallback
  loadTournaments();
}

window.addEventListener("hashchange", handleRoute);


// =======================================================
// INITIAL LOAD
// =======================================================

    // Listen for browser back/forward
    window.addEventListener("hashchange", handleRoute);

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
                window.location.hash = `#/tournament/${id}/overview`;
            });
        });
    }

    // =======================================================
    // LOAD TOURNAMENT OVERVIEW
    // =======================================================

    function renderStandingsTable(matches, sets, container) {
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

        const standings = Object.values(playerStats).sort((a, b) => {
            if (b.setsWon !== a.setsWon) return b.setsWon - a.setsWon;
            if (b.smallPoints !== a.smallPoints)
                return b.smallPoints - a.smallPoints;
            return a.name.localeCompare(b.name);
        });

        if (!standings.length) {
            container.innerHTML = `<div class="empty-message">No results yet.</div>`;
            return;
        }

        container.innerHTML = `
    <table class="standings-table">
      <thead>
        <tr>
          <th class="pos" width="2.0em" style="text-align:center;">Pos</th>
          <th style="text-align:left;">Player</th>
          <th style="text-align:center;">P</th>
          <th style="text-align:center;">SW</th>
          <th style="text-align:center;">SL</th>
          <th style="text-align:center;">SP</th>
        </tr>
      </thead>
      <tbody>
        ${standings
            .map(
                (p, index) => `
          <tr data-pos="${index + 1}">
            <td class="pos" width="2.0em" style="text-align:center;">${
                index + 1
            }</td>
            <td style="text-align:left;">${p.name}</td>
            <td style="text-align:center;">${p.played}</td>
            <td style="text-align:center;">${p.setsWon}</td>
            <td style="text-align:center;">${p.setsLost}</td>
            <td style="text-align:center;">${p.smallPoints}</td>
          </tr>
        `
            )
            .join("")}
      </tbody>
    </table>
  `;
    }

    // -------------------------------------------------------
    // TOURNAMENTS MENU (MUST BE FUNCTION-DECLARED)
    // -------------------------------------------------------

    function openTournamentsMenu() {
        const overlay = document.getElementById("tournaments-menu-overlay");
        if (overlay) overlay.classList.remove("hidden");
        loadTournamentsMenu();
    }

    function closeTournamentsMenu() {
        const overlay = document.getElementById("tournaments-menu-overlay");
        if (overlay) overlay.classList.add("hidden");
    }

    // -------------------------------------------------------
    // ADD MATCH OVERLAY
    // -------------------------------------------------------
	
	

    // -------------------------------------------------------
    // HEADER BUTTONS
    // -------------------------------------------------------

    let addFriendlyBtn = null;
    let leaguesBtn = null;

    document.addEventListener("DOMContentLoaded", () => {
        if (typeof headerTools === "undefined" || !headerTools) return;

        // ---- Add Friendly button ----
        addFriendlyBtn = document.createElement("button");
        addFriendlyBtn.id = "addFriendlyBtn";
        addFriendlyBtn.className = "header-btn";
        addFriendlyBtn.style.display = "none";
        addFriendlyBtn.title = "Create a new friendly match";
        addFriendlyBtn.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="4" y="4" width="16" height="16" rx="3" ry="3"
        fill="none" stroke="currentColor" stroke-width="1.6" />
      <path d="M12 8 v8 M8 12 h8"
        fill="none" stroke="currentColor" stroke-width="1.6" />
    </svg>
    <span class="header-btn-label">Add friendly</span>
  `;
        headerTools.appendChild(addFriendlyBtn);

        // ---- Leagues button ----
        leaguesBtn = document.createElement("button");
        leaguesBtn.className = "header-btn";
        leaguesBtn.textContent = "All Tournaments";
        leaguesBtn.onclick = () => {
            window.location.hash = "#/leagues";
        };
        headerTools.appendChild(leaguesBtn);
    });

    // =======================================================
    // TOURNAMENT CONTEXT (edition / stage aware)
    // =======================================================

    window.tournamentContext = {
        tournamentId: null,
        editionId: null,
        stageId: null,
        groupId: null, // reserved for later
    };

    // =======================================================
    // PLAYER RESOLUTION (shared by Friendlies & Tournaments)
    // =======================================================

    async function resolveOrCreatePlayerByName(
        name,
        { allowGuest = true } = {}
    ) {
        const clean = (name || "").trim();
        if (!clean) throw new Error("Player name required.");

        // Try exact match first
        const { data: existing } = await supabase
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

        const { data, error } = await supabase
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
    // THROWS MODEL (miss, fault, bust logic)
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
                    // Fault miss causing reset
                    displayScore = "X↓";
                    if (isP1) cumP1 = 25;
                    else cumP2 = 25;
                } else {
                    displayScore = "X"; // normal miss / non-resetting fault
                }
            } else {
                let tentative = before + raw;
                const bust = tentative > 50;
                if (bust) {
                    displayScore = raw + "↓"; // bust → reset to 25
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
    // REALTIME: SETS → update match detail + match list
    // =======================================================

    const setsChannel = supabase
        .channel("sets-realtime")
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "sets",
            },
            async (payload) => {
                if (!window.currentMatchId || !window.currentTournamentId)
                    return;

                const updated = payload.new;
                if (!updated) return;
                if (updated.match_id !== window.currentMatchId) return;

                smoothUpdateSetRow(updated);
            }
        )
        .subscribe();

    const setsChannelMatchList = supabase
        .channel("sets-realtime-matchlist")
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "sets",
            },
            (payload) => {
                const updated = payload.new;
                if (!updated) return;

                const matchId = updated.match_id;
                const p1 = updated.score_player1 ?? "";
                const p2 = updated.score_player2 ?? "";

                const matchesTab = document.getElementById("tab-matches");
                if (!matchesTab || matchesTab.offsetParent === null) return;

                const card = document.querySelector(
                    `.card[data-mid="${matchId}"]`
                );
                if (!card) return;

                const liveBoxes = card.querySelectorAll(".mc-livebox");
                if (liveBoxes.length === 2) {
                    liveBoxes[0].textContent = p1;
                    liveBoxes[1].textContent = p2;

                    if (p1 !== "" || p2 !== "") {
                        liveBoxes[0].classList.add("is-live");
                        liveBoxes[1].classList.add("is-live");
                    } else {
                        liveBoxes[0].classList.remove("is-live");
                        liveBoxes[1].classList.remove("is-live");
                    }
                }

                if (updated.winner_player_id) {
                    updateMatchListFinalScore(matchId, card);
                }
            }
        )
        .subscribe();

    // Smoothly update a single set row + header, without full reload
    async function smoothUpdateSetRow(updatedSet) {
        const setNumber = updatedSet.set_number;
        if (!setNumber) return;

        const onMatchDetailPage = document.querySelector(".top-card") !== null;
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
            scoringCurrentThrower = updatedSet.current_thrower || "p1";
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
        const headerSetScore = document.getElementById("header-live-setscore");
        if (headerSetScore) {
            const sp1 = updatedSet.score_player1 ?? 0;
            const sp2 = updatedSet.score_player2 ?? 0;
            headerSetScore.textContent = `${sp1} – ${sp2}`;
        }

        if (updatedSet.winner_player_id) {
            await updateOverallMatchScore();
        }
    }

    async function updateOverallMatchScore() {
        if (!window.currentMatchId) return;

        const { data: match, error } = await supabase
            .from("matches")
            .select("final_sets_player1, final_sets_player2")
            .eq("id", window.currentMatchId)
            .maybeSingle();

        if (error || !match) return;

        const headerScore = document.querySelector(".top-card .top-score");
        if (headerScore) {
            headerScore.textContent =
                (match.final_sets_player1 ?? 0) +
                " – " +
                (match.final_sets_player2 ?? 0);
        }
    }

    async function updateMatchListFinalScore(matchId, card) {
        const { data: match, error } = await supabase
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
    // LIVE THROWS: header throwstrip + expanded table
    // =======================================================

    async function updateLiveThrowsForSet(setNumber) {
        if (!window.currentMatchId) return;

        const { data: throws, error } = await supabase
            .from("throws")
            .select(
                "id, match_id, set_number, throw_number, player_id, score, is_fault"
            )
            .eq("match_id", window.currentMatchId)
            .eq("set_number", setNumber)
            .order("throw_number", { ascending: true });

        if (error || !throws) return;

        const p1 = window.scoringMatch?.p1Id;
        const p2 = window.scoringMatch?.p2Id;
        const model = buildThrowsModel(throws, p1, p2);

        // Header throwstrip
        const headerP1 = document.getElementById("header-throws-p1");
        const headerP2 = document.getElementById("header-throws-p2");

        if (headerP1 && headerP2) {
            const lastP1 = model.filter((m) => m.isP1).slice(-6);
            const lastP2 = model.filter((m) => !m.isP1).slice(-6);

            headerP1.innerHTML = lastP1
                .map((m) => throwBoxHTML(m.displayScore))
                .join("");
            headerP2.innerHTML = lastP2
                .map((m) => throwBoxHTML(m.displayScore))
                .join("");
        }

        // Expanded table (if open)
        const expanded = document.querySelector(
            `.set-throws-expanded[data-set="${setNumber}"]`
        );
        if (expanded && expanded.style.display === "block") {
            expanded.innerHTML = buildThrowsTableHTML(
                model,
                window.scoringMatch?.p1Name || "Player 1",
                window.scoringMatch?.p2Name || "Player 2"
            );
        }
    }

    window.updateLiveThrowsForSet = updateLiveThrowsForSet;

    // Realtime channel for throws
    const throwsChannel = supabase
        .channel("throws-realtime")
        .on(
            "postgres_changes",
            {
                event: "INSERT",
                schema: "public",
                table: "throws",
            },
            async (payload) => {
                const t = payload.new;
                if (!t) return;
                if (t.match_id !== window.currentMatchId) return;
                updateLiveThrowsForSet(t.set_number);
            }
        )
        .subscribe();

    // =======================================================
    // BUILD THROWS TABLE HTML
    // =======================================================

    function buildThrowsTableHTML(model, p1Name, p2Name) {
        if (!model || model.length === 0) {
            return '<div class="empty-message">No throw history for this set.</div>';
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

            const p1Class = p1
                ? p1ScoreStr.includes("X")
                    ? "miss"
                    : p1ScoreStr.includes("↓")
                    ? "reset"
                    : ""
                : "";
            const p2Class = p2
                ? p2ScoreStr.includes("X")
                    ? "miss"
                    : p2ScoreStr.includes("↓")
                    ? "reset"
                    : ""
                : "";

            const p1Cell = p1
                ? `<span class="throw-raw ${p1Class}"><sub>${p1ScoreStr}</sub></span>/<span class="throw-total">${p1.total}</span>`
                : "";
            const p2Cell = p2
                ? `<span class="throw-raw ${p2Class}"><sub>${p2ScoreStr}</sub></span>/<span class="throw-total">${p2.total}</span>`
                : "";

            rows.push(`
      <tr>
        <td>${i + 1}</td>
        <td>${p1Cell}</td>
        <td>${p2Cell}</td>
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
    // LOAD TOURNAMENTS LIST (includes Friendlies card last)
    // =======================================================

    // =======================================================
    // ADD FRIENDLY PAGE (#/friendlies/new)
    // =======================================================

    // =======================================================
    // CREATE TOURNAMENT MATCH
    // =======================================================

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
        edition_id: window.tournamentContext.editionId,
        stage_id: window.tournamentContext.stageId,
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

      // Refresh the matches list in the overlay
      await loadManageMatches();
    } catch (e) {
      console.error(e);
      showErr("Failed to create match.");
    }
  };
}

    // =======================================================
    // LOAD TOURNAMENTS MENU
    // =======================================================

    // -------------------------------------------------------
    // TOURNAMENT PLAYERS CACHE
    // -------------------------------------------------------

    async function reorderStage(stageId, direction) {
        // Load current stage
        const { data: current, error } = await supabase
            .from("stages")
            .select("id, edition_id, order_index")
            .eq("id", stageId)
            .maybeSingle();

        if (error || !current) return;

        // Find neighbour
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

        // Reload overview
        loadTournamentOverview(window.currentTournamentId);
    }

    // 6) Wire selectors to reload with new context
    document
        .getElementById("edition-select")
        ?.addEventListener("change", (e) => {
            window.tournamentContext.editionId = e.target.value;
            window.tournamentContext.stageId = null; // reset stage
            loadTournamentOverview(tournamentId);
        });

    document.getElementById("stage-select")?.addEventListener("change", (e) => {
        window.tournamentContext.stageId = e.target.value;
        loadTournamentOverview(tournamentId);
    });

// =======================================================
// LOAD TOURNAMENT VIEW (normal tournaments + Friendlies)
// =======================================================

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

    matchesContainer.querySelectorAll("[data-mid]").forEach((el) => {
        el.addEventListener("click", () => {
            const mid = el.dataset.mid;
            const tid = el.dataset.tid;
            window.location.hash = `#/match/${mid}/${tid}`;
        });
    });
}

// =======================================================
// DATE BAR STATE / HELPERS (home + tournament views)
// =======================================================

// Currently-selected date (yyyy-mm-dd). We always keep *some* date active.
let activeDateFilter = null;

// Clamp a sorted list of dates to ±radius around today
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

/**
 * Render the horizontal date bar into #date-bar.
 * - rawDates: list of yyyy-mm-dd strings (can be unsorted, duplicates).
 * - onSelect(dateStr): called whenever a date is (re)selected.
 *
 * Behaviour:
 * - Always includes "today" in the bar, even if there are no matches that day.
 * - Shows up to ±5 dates around today.
 * - Always keeps *one* date selected (no "All" / null state).
 */
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

    // Choose a valid active date if not set or no longer present
    if (!activeDateFilter || !displayDates.includes(activeDateFilter)) {
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

            // Update active classes
            bar.querySelectorAll(".date-pill").forEach((p) => {
                p.classList.toggle("active", p === pill);
            });

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

/**
 * Home-screen helper:
 *  - rawDates: list of ALL dates with any matches (including Friendlies).
 *  - dateToTournamentIds: { yyyy-mm-dd → Set of tournament_ids (excluding Friendlies) }
 *
 * Effect:
 *  - On a given date, only tournaments with matches on that date are shown.
 *  - Friendlies card is always visible (it has no data-tid).
 *  - If there are no tournaments on a date, only the Friendlies card remains.
 */
function setupHomeDateBar(allDates, dateToTournamentIds) {
    renderDateBar(allDates, (selectedDate) => {
        const date = selectedDate;
        const allowedSet = dateToTournamentIds[date] || new Set();

        document.querySelectorAll("[data-tid]").forEach((card) => {
            const tid = card.getAttribute("data-tid");
            if (!tid) return;
            card.style.display = allowedSet.has(tid) ? "" : "none";
        });
    });
}

// =======================================================
// LOAD MATCH DETAIL (shared for tournaments + friendlies)
// =======================================================

// =======================================================
// INITIAL LOAD
// =======================================================

handleRoute();
window.addEventListener("hashchange", handleRoute);
