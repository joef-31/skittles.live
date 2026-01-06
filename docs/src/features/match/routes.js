// =============================================
// Match routes
// =============================================

// file:// safe
// No imports
// No exports

window.App = window.App || {};
App.Features = App.Features || {};
App.Features.Match = App.Features.Match || {};

(function registerMatchRoutes() {
  const Router = App.Core.Router;
  if (!Router) {
    console.error("[match-routes] router not available");
    return;
  }

  Router.registerRoute(
    /^\/match\/(?<mid>[^/]+)\/(?<tid>[^/]+)$/,
    async ({ params }) => {
      const { mid, tid } = params;

      // ---- Context ----
      window.currentMatchId = mid;
      window.currentTournamentId = tid;

      // Defensive: clear tournament-only state
      window.currentTournament = null;

      // ---- Render stub ----
      App.Features.Match.renderMatchDetail(mid, tid);
    }
  );
})();

async function loadFriendlyCreate() {
  window.currentMatchId = null;
  window.matchDetailContext = null;
  window.currentTournamentId = FRIENDLIES_TOURNAMENT_ID;
  window.lastSeenSet = null;
  
	if (!auth.can("friendly.create")) {
	  setContent(`
		<div class="card">
		  <div class="error">
			You do not have permission to create a friendly match.
		  </div>
		</div>
	  `);
	  return;
	}

  showBackButton(() => {
    window.location.hash = "#/friendlies";
  });
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