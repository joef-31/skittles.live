window.currentMatchId = null;
window.currentTournamentId = null;
window.lastSeenSet = null;
window.App = window.App || {};
App.Auth = App.Auth || {};

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

// ---------------------------------------------
// Global player cache (for admin tools, view-as)
// ---------------------------------------------

window.allPlayers = null;

window.loadAllPlayers = async function () {
  if (window.allPlayers) return window.allPlayers;

  if (!window.supabaseClient) {
    console.warn("[players] supabaseClient not ready");
    return [];
  }

  const { data, error } = await window.supabaseClient
    .from("players")
    .select("id, name")
    .order("name");

  if (error) {
    console.error("[players] failed to load players", error);
    window.allPlayers = [];
    return [];
  }

  window.allPlayers = data || [];
  return window.allPlayers;
};


window.tournamentContext.selectedBracketId ??= null;
window.tournamentContext.bracketRoundIndex ??= 0;

function isSuperAdmin() {
  return !!window.auth?.permissions?.some(p => p.role === "super_admin");
}

function canManageTournament(tournament) {
  if (!tournament) return false;

  // Super admin
  if (isSuperAdmin()) return true;

  const perms = window.auth?.permissions || [];

  return perms.some(p => {
    // Tournament admin (scoped)
    if (
      p.role === "tournament_admin" &&
      p.scope_type === "tournament" &&
      String(p.scope_id) === String(tournament.id)
    ) {
      return true;
    }

    // Country admin (scoped by country name)
    if (
      p.role === "country_admin" &&
      p.scope_type === "country" &&
      p.scope_value === tournament.country
    ) {
      return true;
    }

    return false;
  });
}

function userOwnsMatch(match) {
  if (!match) return false;
  if (!Array.isArray(window.auth?.players)) return false;

  return (
    window.auth.players.includes(match.player1_id) ||
    window.auth.players.includes(match.player2_id)
  );
}

App.Auth.canScoreMatch = function (match) {
  if (!match || !window.auth) return false;

  // ---------------------------------------------
  // 1. Explicit permission (admin / referee / etc)
  // ---------------------------------------------
  if (
    window.auth.can("score_match", {
      type: "match",
      id: match.id
    })
  ) {
    return true;
  }

  // ---------------------------------------------
  // 2. Player-based permission (own match)
  // ---------------------------------------------
  return userOwnsMatch(match);
};


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