window.App = window.App || {};
App.Teams = App.Teams || {};

window.teamImportState = {
  open: false,
  csvText: "",
  parsed: null,     // result of parsing
  errors: []        // global errors
};

/**
 * Returns true if teams exist for the current tournament
 */
App.Teams.isTeamTournament = function () {
  return Array.isArray(window.currentTeams) &&
         window.currentTeams.length > 0;
};

/**
 * Get all members for a given team
 */
App.Teams.getMembersForTeam = function (teamId) {
  if (!Array.isArray(window.currentTeamMembers)) return [];
  return window.currentTeamMembers.filter(
    m => m.team_id === teamId
  );
};

/**
 * Get the team a player belongs to (if any) in this tournament
 */
App.Teams.getTeamForPlayer = function (playerId) {
  if (!Array.isArray(window.currentTeamMembers)) return null;

  const membership = window.currentTeamMembers.find(
    m => m.player_id === playerId
  );

  if (!membership) return null;

  return (window.currentTeams || []).find(
    t => t.id === membership.team_id
  ) || null;
};

function loadTournamentTeams(tournamentId) {
  // Ensure tournament context is loaded
  if (!window.currentTournament || window.currentTournament.id !== tournamentId) {
    loadTournamentOverview(tournamentId);
    return;
  }

  setContent(`
    <div class="card">
      <div class="tournament-header">
        <div class="tournament-name">
          Teams
        </div>
        <div class="subtitle">
          ${window.currentTournament.name}
        </div>
      </div>

      <div id="teams-page-content"></div>
    </div>
  `);

  const container = document.getElementById("teams-page-content");
  if (!container) return;

  App.Teams.renderManageTeamsSection(container);
}

App.Teams.formatPlayerNameShort = function (player) {
  if (!player || !player.name) return "Unknown";

  const parts = player.name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];

  const firstInitial = parts[0][0].toUpperCase();
  const surname = parts[parts.length - 1];

  return `${firstInitial}. ${surname}`;
};

App.Teams.renderImportPanel = function (container) {
  window.teamImportState.panelContainer = container;
  
  if (!window.teamImportState.open) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="card import-panel">
      <div class="import-header">
        <strong>Bulk import teams</strong>
        <div class="import-subtitle">
          Paste CSV with columns: team_name, p1_name, p2_name, …
        </div>
      </div>

      <textarea
        id="teams-import-textarea"
        placeholder="team_name,p1_name,p2_name"
        rows="8"
        style="width:100%;"
      >${window.teamImportState.csvText || ""}</textarea>
	  
	  ${App.Teams.renderImportParseSummary()}

		<div class="import-actions">
		  <button class="header-btn" id="teams-import-parse">
			Parse & preview
		  </button>

		  ${
			App.Teams.canCommitImport()
			  ? `<button class="header-btn" id="teams-import-commit">Import teams</button>`
			  : ``
		  }

		  <button class="header-btn secondary" id="teams-import-cancel">
			Close
		  </button>
		</div>

	  <div id="team-import-warnings"></div>
	  <div id="team-import-preview">
		  ${App.Teams.hasUnresolvedWarnings() || App.Teams.findCrossTeamDuplicates().length
			? ""
			: App.Teams.renderImportParseSummary()
		  }
	  </div>
    </div>
  `;
  
	const warningEl = document.getElementById("team-import-warnings");
	const previewEl = document.getElementById("team-import-preview");
	
	const commitBtn = container.querySelector("#teams-import-commit");
	if (commitBtn) {
	  commitBtn.addEventListener("click", App.Teams.commitImport);
	}

	if (warningEl) {
	  App.Teams.renderImportWarnings(warningEl);
	}

	if (previewEl) {
	  App.Teams.renderImportParseSummary(previewEl);
	}
  
	const parseBtn = container.querySelector("#teams-import-parse");

	if (parseBtn) {
	  parseBtn.addEventListener("click", () => {
		App.Teams.parseImportCsv();
		App.Teams.renderImportPanel(container);
	  });
	}

  const textarea = container.querySelector("#teams-import-textarea");
  const cancelBtn = container.querySelector("#teams-import-cancel");

  if (textarea) {
    textarea.addEventListener("input", e => {
      window.teamImportState.csvText = e.target.value;
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      window.teamImportState.open = false;
      App.Teams.renderImportPanel(container);
    });
  }
};

App.Teams.parseImportCsv = function () {
  const text = window.teamImportState.csvText;
  window.teamImportState.errors = [];
  window.teamImportState.parsed = null;

  if (!text || !text.trim()) {
    window.teamImportState.errors.push("No CSV data provided.");
    return;
  }

  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    window.teamImportState.errors.push("CSV must include a header and at least one row.");
    return;
  }

  const header = lines[0].split(",").map(h => h.trim());

  if (header[0] !== "team_name") {
    window.teamImportState.errors.push("First column must be 'team_name'.");
    return;
  }

  const playerColumns = header.slice(1);
  if (!playerColumns.length) {
    window.teamImportState.errors.push("At least one player column is required.");
    return;
  }

  const seenTeams = new Set();
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map(c => c.trim());
    const teamName = cells[0];

	const row = {
	  rowIndex: i + 1,
	  teamName,
	  playerNames: [],
	  errors: [],
	  warnings: []
	};

	if (!teamName) {
	  row.errors.push("Missing team name.");
	} else if (seenTeams.has(teamName.toLowerCase())) {
	  row.errors.push("Duplicate team name in import.");
	} else {
	  seenTeams.add(teamName.toLowerCase());
	}

	// Populate players FIRST
	for (let c = 1; c < cells.length; c++) {
	  const name = cells[c];
	  if (name) row.playerNames.push(name);
	}

	if (!row.playerNames.length) {
	  row.errors.push("Team must include at least one player.");
	}

	// Enforce minimum team size AFTER population
	const minSize = App.Teams.getMinTeamSize();
	if (minSize && row.playerNames.length < minSize) {
	  row.errors.push(
		`Team must have at least ${minSize} players (has ${row.playerNames.length}).`
	  );
	}

	// Duplicate player names within same team
	const seenPlayers = new Set();
	for (const name of row.playerNames) {
	  const key = name.toLowerCase();
	  if (seenPlayers.has(key)) {
		row.errors.push(`Duplicate player name '${name}' in team.`);
	  }
	  seenPlayers.add(key);
	}

    rows.push(row);
  }

  window.teamImportState.parsed = {
    header,
    playerColumns,
    rows
  };
	
	App.Teams.resolveImportPlayers();
};

App.Teams.renderImportParseSummary = function () {
  const state = window.teamImportState;
  if (!state.parsed) return "";

  const rows = state.parsed.rows;
  const errorRows = rows.filter(r => r.errors.length);
  const validRows = rows.length - errorRows.length;

	return `
	  <div class="import-summary">
		Parsed ${rows.length} teams. <strong>${validRows} valid</strong>.
		${errorRows.length
		  ? `<strong>${errorRows.length} have errors.</strong>`
		  : `<strong>All teams valid.</strong>`
		}
	  </div>
	  ${App.Teams.renderImportRowErrors()}
	  ${App.Teams.renderCrossTeamErrors()}
	`;
};

App.Teams.renderImportRowErrors = function () {
  const parsed = window.teamImportState.parsed;
  if (!parsed) return "";

  const rowsWithErrors = parsed.rows.filter(r => r.errors.length);
  if (!rowsWithErrors.length) return "";

  return `
    <div class="import-errors">
      ${rowsWithErrors.map(r => `
        <div class="error">
          Row ${r.rowIndex}: ${r.errors.join(" ")}
        </div>
      `).join("")}
    </div>
  `;
};

App.Teams.getMinTeamSize = function () {
  // Friendlies: no minimum enforced
  if (window.currentTournament?.type === "friendly") return null;

  const editionId = window.tournamentContext?.editionId;
  if (!editionId) return null;

  const ed = (window.currentEditions || []).find(e => e.id === editionId);
  const min = ed?.min_team_size;

  return Number.isFinite(min) && min > 0 ? min : null;
};

App.Teams.normaliseName = function (name) {
  return name
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
};

App.Teams.findPlayerMatches = function (inputName, players) {
  const normInput = App.Teams.normaliseName(inputName);

  const exact = [];
  const close = [];

  for (const p of players) {
    const normPlayer = App.Teams.normaliseName(p.name);

    if (normPlayer === normInput) {
      exact.push(p);
      continue;
    }

    const inputParts = normInput.split(" ");
    const playerParts = normPlayer.split(" ");

    // Initial-based match: "j parker" vs "joe parker"
    if (
      inputParts.length === 2 &&
      playerParts.length >= 2 &&
      inputParts[1] === playerParts[playerParts.length - 1] &&
      inputParts[0].length === 1 &&
      playerParts[0].startsWith(inputParts[0])
    ) {
      close.push(p);
      continue;
    }

    // Prefix-based close match (Josh ↔ Joshua)
    if (
      inputParts.length >= 2 &&
      playerParts.length >= 2 &&
      inputParts[inputParts.length - 1] === playerParts[playerParts.length - 1] && // same surname
      (
        playerParts[0].startsWith(inputParts[0]) ||
        inputParts[0].startsWith(playerParts[0])
      )
    ) {
      close.push(p);
    }
  }

  return { exact, close };
};

App.Teams.resolvePlayerName = function (name) {
  const players = window.allPlayers || [];
  const { exact, close } = App.Teams.findPlayerMatches(name, players);

  if (exact.length === 1) {
    return {
      input: name,
      status: "exact",
      resolvedPlayerId: exact[0].id,
      candidates: []
    };
  }

  if (exact.length > 1) {
    return {
      input: name,
      status: "warning",
      resolvedPlayerId: null,
      candidates: exact
    };
  }

  if (close.length) {
    return {
      input: name,
      status: "warning",
      resolvedPlayerId: null,
      candidates: close
    };
  }

  return {
    input: name,
    status: "new",
    resolvedPlayerId: null,
    candidates: []
  };
};

App.Teams.resolveImportPlayers = function () {
  const parsed = window.teamImportState.parsed;
  if (!parsed) return;

  parsed.rows.forEach(row => {
    row.resolutions = row.playerNames.map(name =>
      App.Teams.resolvePlayerName(name)
    );
  });
};

App.Teams.hasUnresolvedWarnings = function () {
  const parsed = window.teamImportState.parsed;
  if (!parsed) return false;

  return parsed.rows.some(row =>
    row.resolutions?.some(r => r.status === "warning")
  );
};

App.Teams.renderImportWarnings = function (container) {
  const parsed = window.teamImportState.parsed;
  if (!parsed) {
    container.innerHTML = "";
    return;
  }

  const nameWarnings = App.Teams.hasUnresolvedWarnings();
  const crossTeam = App.Teams.findCrossTeamDuplicates();

  if (!nameWarnings && !crossTeam.length) {
    container.innerHTML = "";
    return;
  }

  let html = `
    <div class="card warning-card">
      <strong>Review required</strong>
      <ul>
  `;

  if (nameWarnings) {
    html += `<li>Some player names need review before teams can be imported.</li>`;
  }

  crossTeam.forEach(d => {
    html += `
      <li>
        Player "<strong>${d.playerName}</strong>" appears in
        <strong>${d.teamA}</strong> and <strong>${d.teamB}</strong>.
      </li>
    `;
  });

  html += `</ul>`;

  // 🔽 Inline resolution UI
  for (const row of parsed.rows) {
    const unresolved = row.resolutions.filter(r => r.status === "warning");
    if (!unresolved.length) continue;

    html += `
      <div class="review-team-block">
        <div class="review-team-title">${row.teamName}</div>
        <ul class="review-player-list">
    `;

    for (const r of unresolved) {
      const options = r.candidates
        .map(p => `<option value="${p.id}">${p.name}</option>`)
        .join("");

      html += `
        <li>
          <span class="player-name">${r.input}</span>
          <select
            class="resolve-select"
            data-team="${row.teamName}"
            data-input="${r.input}"
          >
            <option value="">Select existing player…</option>
            ${options}
            <option value="__new__">➕ Create new player</option>
          </select>
        </li>
      `;
    }

    html += `</ul></div>`;
  }

  html += `</div>`;
  container.innerHTML = html;

  // Bind handlers
  container.querySelectorAll(".resolve-select").forEach(sel => {
    sel.addEventListener("change", e => {
      const value = e.target.value;
      const teamName = e.target.dataset.team;
      const input = e.target.dataset.input;

      if (!value) return;

      if (value === "__new__") {
        const fullName = prompt(
          `Enter full name for new player (was "${input}")`,
          input
        );
        if (!fullName) {
          e.target.value = "";
          return;
        }
        App.Teams.forceNewPlayer(teamName, input, fullName);
      } else {
        App.Teams.applyResolutionChoice(teamName, input, value);
      }

      // Re-render whole panel
      App.Teams.renderImportPanel(window.teamImportState.panelContainer);
    });
  });
};

App.Teams.applyResolutionChoice = function (teamName, input, playerId) {
  const parsed = window.teamImportState.parsed;
  if (!parsed) return;

  const row = parsed.rows.find(r => r.teamName === teamName);
  if (!row) return;

  const res = row.resolutions.find(r => r.input === input);
  if (!res) return;

  res.resolvedPlayerId = playerId;
  res.status = "resolved";
};

App.Teams.canCommitImport = function () {
  const parsed = window.teamImportState.parsed;
  if (!parsed) return false;

  // Row-level errors
  if (parsed.rows.some(r => r.errors.length)) return false;

  // Unresolved name warnings
  if (App.Teams.hasUnresolvedWarnings()) return false;

  // Cross-team duplicate players
  if (App.Teams.findCrossTeamDuplicates().length) return false;

  return true;
};


App.Teams.commitImport = async function () {
  if (!App.Teams.canCommitImport()) {
    alert("Import is not ready to commit.");
    return;
  }

  const parsed = window.teamImportState.parsed;
  const tournamentId = window.currentTournamentId;

  try {
    // ----------------------------------
    // 1) Create missing players
    // ----------------------------------
    const newNames = new Set();

    parsed.rows.forEach(row => {
      row.resolutions.forEach(r => {
        if (r.status === "new") {
          newNames.add(r.input);
        }
      });
    });

    let createdPlayers = [];
    if (newNames.size) {
      const inserts = [...newNames].map(name => ({
        name,
        is_guest: false
      }));

      const { data, error } = await window.supabaseClient
        .from("players")
        .insert(inserts)
        .select("id, name");

      if (error) throw error;
      createdPlayers = data || [];
    }

    const createdMap = Object.fromEntries(
      createdPlayers.map(p => [p.name.toLowerCase(), p.id])
    );

    // Patch resolvedPlayerId
    parsed.rows.forEach(row => {
      row.resolutions.forEach(r => {
        if (r.status === "new") {
          r.resolvedPlayerId = createdMap[r.input.toLowerCase()];
        }
      });
    });

    // ----------------------------------
    // 2) Upsert teams (Option A)
    // ----------------------------------
    const teamNames = parsed.rows.map(r => r.teamName);

    const { data: existingTeams } = await window.supabaseClient
      .from("teams")
      .select("id, name")
      .eq("tournament_id", tournamentId)
      .in("name", teamNames);

    const existingMap = Object.fromEntries(
      (existingTeams || []).map(t => [t.name.toLowerCase(), t.id])
    );

    const toInsert = parsed.rows
      .filter(r => !existingMap[r.teamName.toLowerCase()])
      .map(r => ({
        tournament_id: tournamentId,
        name: r.teamName
      }));

    let insertedTeams = [];
    if (toInsert.length) {
      const { data, error } = await window.supabaseClient
        .from("teams")
        .insert(toInsert)
        .select("id, name");

      if (error) throw error;
      insertedTeams = data || [];
    }

    const teamIdMap = {
      ...existingMap,
      ...Object.fromEntries(
        insertedTeams.map(t => [t.name.toLowerCase(), t.id])
      )
    };

    // ----------------------------------
    // 3) Replace memberships (atomic per team)
    // ----------------------------------
    for (const row of parsed.rows) {
      const teamId = teamIdMap[row.teamName.toLowerCase()];

      await window.supabaseClient
        .from("team_members")
        .delete()
        .eq("team_id", teamId);

      const members = row.resolutions.map((r, idx) => ({
        team_id: teamId,
        player_id: r.resolvedPlayerId,
      }));

      const { error } = await window.supabaseClient
        .from("team_members")
        .insert(members);

      if (error) throw error;
    }

    // ----------------------------------
    // 4) Success cleanup
    // ----------------------------------
    window.teamImportState = {
      open: false,
      csvText: "",
      parsed: null,
      errors: []
    };

    alert("Teams imported successfully.");
    loadTournamentTeams(tournamentId);

  } catch (err) {
    console.error(err);
    alert("Import failed. No partial data was left in an inconsistent state.");
  }
};

App.Teams.findCrossTeamDuplicates = function () {
  const parsed = window.teamImportState.parsed;
  if (!parsed) return [];

  const conflicts = [];

  // Teams that WILL be replaced by this import
  const csvTeamNames = new Set(
    parsed.rows.map(r => r.teamName.toLowerCase())
  );

  // Map of playerId -> teamName (CSV first)
  const seen = new Map();

  // ----------------------------------
  // 1) Check duplicates WITHIN CSV
  // ----------------------------------
  for (const row of parsed.rows) {
    for (const r of row.resolutions || []) {
      const pid = r.resolvedPlayerId;
      if (!pid) continue;

      if (seen.has(pid)) {
        conflicts.push({
          playerId: pid,
          playerName: r.input,
          teamA: seen.get(pid),
          teamB: row.teamName
        });
      } else {
        seen.set(pid, row.teamName);
      }
    }
  }

  // ----------------------------------
  // 2) Check against EXISTING teams
  //    (excluding teams in CSV)
  // ----------------------------------
  if (Array.isArray(window.currentTeamMembers)) {
    for (const m of window.currentTeamMembers) {
      // Ignore memberships for teams being replaced
      const team = (window.currentTeams || []).find(
        t => t.id === m.team_id
      );
      if (!team) continue;

      if (csvTeamNames.has(team.name.toLowerCase())) {
        continue;
      }

      // Does this player appear in CSV?
      if (seen.has(m.player_id)) {
        conflicts.push({
          playerId: m.player_id,
          playerName:
            (window.allPlayers || []).find(p => p.id === m.player_id)?.name
              || "Unknown player",
          teamA: team.name,
          teamB: seen.get(m.player_id)
        });
      }
    }
  }

  return conflicts;
};


App.Teams.renderCrossTeamErrors = function () {
  const dupes = App.Teams.findCrossTeamDuplicates();
  if (!dupes.length) return "";

  return `
    <div class="import-errors">
      ${dupes.map(d => `
        <div class="error">
          Player "${d.playerName}" appears in both
          <strong>${d.teamA}</strong> and <strong>${d.teamB}</strong>.
        </div>
      `).join("")}
    </div>
  `;
};

App.Teams.getCrossTeamWarnings = function () {
  const dupes = App.Teams.findCrossTeamDuplicates();
  if (!dupes.length) return [];

  return dupes.map(d =>
    `Player "${d.playerName}" appears in both ${d.teamA} and ${d.teamB}.`
  );
};

App.Teams.forceNewPlayer = function (teamName, oldInput, newName) {
  const parsed = window.teamImportState.parsed;
  if (!parsed) return;

  for (const row of parsed.rows) {
    if (row.teamName !== teamName) continue;

    for (const r of row.resolutions) {
      if (r.input === oldInput) {
        r.input = newName;
        r.status = "new";
        r.resolvedPlayerId = null;
        r.candidates = [];
      }
    }
  }
};

function isActivePlayer(sideKey, index) {
  if (scoringCurrentThrower !== sideKey) return false;
  return scoringMatch.sideModel[sideKey].currentIndex === index;
}