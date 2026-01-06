window.App = window.App || {};
App.Auth = App.Auth || {};

// Ensure auth object always exists
/* window.auth = window.auth || {
  user: null,
  permissions: [],
  can: () => false
};
 */
App.Auth.loadPermissions = async function (userId) {
  if (!userId) {
    window.auth = { user: null, permissions: [], can: () => false };
    return;
  }

  const { data, error } = await window.supabaseClient
    .from("user_permissions")
    .select("*")
    .eq("user_id", userId);

  if (error) {
    console.error("[auth] failed to load permissions", error);
  }

  const permissions = data || [];

	window.auth = {
	  user: { id: userId },
	  permissions,
	  viewAs: null,
	  getEffectivePermissions() {
		if (this.viewAs) {
		  return [this.viewAs];
		}
		return this.permissions;
	  },
	  can(action, scope) {
		return canWithPermissions(
		  this.getEffectivePermissions(),
		  action,
		  scope
		);
	  }
	};
	
	// -----------------------------
	// Load linked player profiles
	// -----------------------------
	let playerLinks = [];

	if (userId) {
	const { data, error } = await window.supabaseClient
	.from("user_players")
	.select("player_id")
	.eq("user_id", userId);

	if (error) {
	console.error("[auth] failed to load player links", error);
	} else {
	playerLinks = data || [];
	}
	}

	window.auth.players = playerLinks.map(p => p.player_id);
	
	if (!Array.isArray(window.auth.players)) {
	  window.auth.players = [];
	}
	
	  updateBottomBar();
};

function canWithPermissions(perms, action, scope = {}) {

  // Super admin override
  if (perms.some(p => p.role === "super_admin")) {
    return true;
  }

  const result = perms.some(p => {

    // Action must be allowed
    if (!roleAllowsAction(p.role, action)) {
      return false;
    }

    // Global permission
    if (p.scope_type === "global") {
      return true;
    }

	// Country-scoped permission
	if (p.scope_type === "country") {
	  console.group("[COUNTRY CHECK]");
	  console.log("permission scope_value:", JSON.stringify(p.scope_value));
	  console.log("tournament scope.country:", JSON.stringify(scope.country));
	  console.log("raw equality:", p.scope_value === scope.country);
	  console.log(
		"normalized equality:",
		String(p.scope_value).trim().toLowerCase() ===
		String(scope.country).trim().toLowerCase()
	  );
	  console.groupEnd();

	  if (!scope.country) return false;

	  return (
		String(p.scope_value).trim().toLowerCase() ===
		String(scope.country).trim().toLowerCase()
	  );
	}

	// -----------------------------
	// Tournament-scoped permission
	// -----------------------------
	if (p.scope_type === "tournament") {
	  if (scope.type !== "tournament") {
		return false;
	  }

	  if (!p.scope_id) {
		return true;
	  }

	  return p.scope_id === scope.id;
	}

	// -----------------------------
	// Unknown / unsupported scope
	// -----------------------------
	return false;
  });

  return result;
}

function buildCanFunction(permissions) {
  return function can(action, scope = {}) {

    // Super admin override
    if (permissions.some(p => p.role === "super_admin")) {
      return true;
    }

    return permissions.some(p => {
      if (!roleAllowsAction(p.role, action)) return false;

      // Global
      if (p.scope_type === "global") return true;

      // Country-scoped
      if (p.scope_type === "country") {
        if (!scope.country) return false;
        return p.scope_value === scope.country;
      }

      // Typed scope (tournament, match, etc)
      if (p.scope_type !== scope.type) return false;

      if (!p.scope_id) return true;
      return p.scope_id === scope.id;
    });
  };
}


function roleAllowsAction(role, action) {
  const actions = App.Auth.Roles[role];
  if (!actions) return false;
  if (actions.includes("*")) return true;
  return actions.includes(action);
}

// src/features/auth/viewAs.js

window.App = window.App || {};
App.Auth = App.Auth || {};

App.Auth.__realAuth = null;

App.Auth.viewAs = function ({
  role,
  scopeType = "global",
  scopeId = null,
  scopeValue = null
}) {
  if (!window.auth) return;

  // Only super admins can do this
	const realAuth = App.Auth.__realAuth || window.auth;

	if (!realAuth.permissions?.some(p => p.role === "super_admin")) {
	  console.warn("[viewAs] denied (not super admin)");
	  return;
	}
	
	  if (role === "country_admin" && !scopeValue) {
		console.warn("[viewAs] country_admin requires scopeValue");
		return;
	  }

  // Store real auth once
  if (!App.Auth.__realAuth) {
    App.Auth.__realAuth = window.auth;
  }

	const effectivePermissions = [{
		role,
		scope_type: scopeType,
		scope_id: scopeId,
		scope_value: scopeValue
	}];

	window.auth = {
	  ...window.auth,

	  permissions: effectivePermissions,

	  players:
		role === "player" && scopeType === "player" && scopeId
		  ? [scopeId]
		  : [],

	  can: buildCanFunction(effectivePermissions)
	};

  console.log(`[viewAs] now viewing as ${role}`, scopeType, scopeValue);

	updateBottomBar?.();

	if (window.location.hash.startsWith("#/tournament/")) {
	  // Force permission re-evaluation of tournament UI
	  window.tournamentContext.manageSubview = null;

	  // IMPORTANT: invalidate active tab so it is re-checked
	  window.tournamentContext.activeOverviewTab = null;

	  loadTournamentOverview(window.currentTournamentId);
	}
};

App.Auth.clearViewAs = function () {
  if (!App.Auth.__realAuth) return;

  window.auth = App.Auth.__realAuth;
  App.Auth.__realAuth = null;

  console.log("[viewAs] restored real permissions");

  updateBottomBar?.();
};

window.viewAs = App.Auth.viewAs;
window.clearViewAs = App.Auth.clearViewAs;

async function renderViewAsControls() {
  const adminSlot = document.getElementById("header-admin-tools");
  if (!adminSlot) return;

  // Clear any previous render
  adminSlot.replaceChildren();

  if (!window.auth) return;

  const isSuperAdmin = window.auth.permissions
    ?.some(p => p.role === "super_admin");

  if (!isSuperAdmin) return;

  // --- Build UI ---
  const wrap = document.createElement("div");
  wrap.id = "view-as-controls";
  wrap.style.display = "flex";
  wrap.style.alignItems = "center";
  wrap.style.gap = "6px";

  const select = document.createElement("select");
  select.id = "view-as-role";

  select.innerHTML = `
    <option value="">View as…</option>
    <option value="guest">Guest</option>
    <option value="player">Player</option>
    <option value="referee">Referee</option>
    <option value="tournament_admin">Tournament admin</option>
    <option value="country_admin">Country admin</option>
  `;
  
	const playerSelect = document.createElement("select");
	playerSelect.id = "view-as-player";
	playerSelect.style.display = "none";

	playerSelect.innerHTML = `<option value="">Select player…</option>`;

	const players =
	  window.currentPlayers ||
	  window.tournamentContext?.players ||
	  window.allPlayers ||
	  [];

	players.forEach(p => {
	  const opt = document.createElement("option");
	  opt.value = p.id;
	  opt.textContent = p.name;
	  playerSelect.appendChild(opt);
	});
	
		  // --- Country selector (TEMP / dummy data) ---
	  const countrySelect = document.createElement("select");
	  countrySelect.id = "view-as-country";
	  countrySelect.style.display = "none";

	  countrySelect.innerHTML = `
		<option value="">Select country…</option>
		<!-- TEMP: dummy countries – REMOVE when country list is dynamic -->
		<option value="Great Britain">Great Britain</option>
		<option value="Finland">Finland</option>
		<option value="France">France</option>
	  `;
	  
	    // -----------------------------------------
	  // TEMP: load all tournaments for View As
	  // Remove once tournaments are globally cached
	  // -----------------------------------------
	  if (!Array.isArray(window.allTournaments)) {
		const { data, error } = await window.supabaseClient
		  .from("tournaments")
		  .select("id, name, country, type")
		  .order("name");

		if (error) {
		  console.error("[viewAs] failed to load tournaments", error);
		  window.allTournaments = [];
		} else {
		  window.allTournaments = data || [];
		}
	  }

	  // --- Tournament selector ---
	  const tournamentSelect = document.createElement("select");
	  tournamentSelect.id = "view-as-tournament";
	  tournamentSelect.style.display = "none";

	  tournamentSelect.innerHTML = `<option value="">Select tournament…</option>`;

		const tournaments = Array.isArray(window.allTournaments)
		  ? window.allTournaments
		  : [];

	  tournaments.forEach(t => {
		if (!t?.id) return;
		const opt = document.createElement("option");
		opt.value = t.id;
		opt.textContent = t.name;
		tournamentSelect.appendChild(opt);
	  });

  const clearBtn = document.createElement("button");
  clearBtn.className = "header-btn small danger";
  clearBtn.textContent = "Clear";

  // --- Wiring ---
	  select.onchange = e => {
		const role = e.target.value;

		// Reset all secondary selectors
		playerSelect.style.display = "none";
		playerSelect.value = "";

		countrySelect.style.display = "none";
		countrySelect.value = "";

		tournamentSelect.style.display = "none";
		tournamentSelect.value = "";

		if (!role) return;

		// Player needs a secondary selection
		if (role === "player") {
		  playerSelect.style.display = "inline-block";
		  return;
		}

		// Country admin needs country selection
		if (role === "country_admin") {
		  countrySelect.style.display = "inline-block";
		  return;
		}

		// Tournament admin needs tournament selection
		if (role === "tournament_admin") {
		  tournamentSelect.style.display = "inline-block";
		  return;
		}

		// Other roles apply immediately
		App.Auth.viewAs({ role });

		refreshScoringConsoleIfOpen();
		renderAuthControls();
		updateBottomBar();
	  };

	playerSelect.onchange = e => {
	  const playerId = e.target.value;
	  if (!playerId) return;

	  App.Auth.viewAs({
		role: "player",
		scopeType: "player",
		scopeId: playerId
	  });

	  refreshScoringConsoleIfOpen();
	  renderAuthControls();
	  updateBottomBar();
	};
	
	  countrySelect.onchange = e => {
		const country = e.target.value;
		if (!country) return;

		App.Auth.viewAs({
		  role: "country_admin",
		  scopeType: "country",
		  scopeValue: country
		});

		refreshScoringConsoleIfOpen();
		renderAuthControls();
		updateBottomBar();
	  };
	  
	    tournamentSelect.onchange = e => {
		const tournamentId = e.target.value;
		if (!tournamentId) return;

		App.Auth.viewAs({
		  role: "tournament_admin",
		  scopeType: "tournament",
		  scopeId: tournamentId
		});

		refreshScoringConsoleIfOpen();
		renderAuthControls();
		updateBottomBar();
	  };

  clearBtn.onclick = () => {
    App.Auth.clearViewAs();
    select.value = "";

    refreshScoringConsoleIfOpen();
	renderAuthControls();
    updateBottomBar();
  };

  wrap.appendChild(select);
  wrap.appendChild(playerSelect);
  wrap.appendChild(countrySelect);
  wrap.appendChild(tournamentSelect);
  wrap.appendChild(clearBtn);
  adminSlot.appendChild(wrap);
}

window.renderViewAsControls = renderViewAsControls;

