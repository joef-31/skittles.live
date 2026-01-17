
const FRIENDLIES_TOURNAMENT_ID = "11111111-1111-1111-1111-111111111111";

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

App.Core.Router.init();

window.App = window.App || {};
App.Teams = App.Teams || {};

/**
 * Returns true if this tournament should be treated as team-based.
 * Teams are optional; presence activates team logic.
 */
App.Teams.isTeamTournament = function () {
  return Array.isArray(window.currentTeams) &&
         window.currentTeams.length > 0;
};