// =============================================
// Tournament routes
// =============================================

// file:// safe
// No imports
// No exports

window.App = window.App || {};
App.Features = App.Features || {};

(function registerTournamentRoutes() {
  const Router = App.Core.Router;

  if (!Router) {
    console.error("[routes] router not available");
    return;
  }
  
  // Default route: redirect "/" → "/tournaments"
	Router.registerRoute(
	  /^\/$/,
	  () => {
		App.Features.Tournament.loadTournaments();
	  }
	);

	Router.registerRoute(
	  /^\/tournaments$/,
	  () => {
		// CLEAR TOURNAMENT CONTEXT
		window.currentTournamentId = null;
		window.currentTournament = null;

		App.Features.Tournament.loadTournaments();
		updateBottomBar();
	  }
	);

  // Friendlies
  Router.registerRoute(
    /^\/friendlies$/,
    () => {
      loadTournamentOverview(FRIENDLIES_TOURNAMENT_ID);
    }
  );

	Router.registerRoute(
	  /^\/tournament\/(?<tid>[^/]+)$/,
	  ({ params }) => {
		const tid = params.tid;
		const query = getHashQuery();

		window.currentTournamentId = tid;
		window.tournamentContext = window.tournamentContext || {};

		window.tournamentContext.activeOverviewTab =
		  query.tab || "standings";

		loadTournamentOverview(tid);
	  }
	);
  
Router.registerRoute(
  /^\/tournament\/(?<tid>[^/]+)\/overview$/,
  ({ params, query }) => {
    const tid = params.tid;

    window.currentTournamentId = tid;
    window.tournamentContext = window.tournamentContext || {};

	if (query.tab) {
	  // Explicit tab always wins
	  window.tournamentContext.activeOverviewTab = query.tab;
	} else if (window.tournamentContext.activeTab) {
	  // Date-bar driven navigation (Daily view)
	  window.tournamentContext.activeOverviewTab =
		window.tournamentContext.activeTab;
	} else {
	  const fromDaily =
		sessionStorage.getItem("fromDailyView") === "1";

	  window.tournamentContext.activeOverviewTab =
		fromDaily ? "daily" : "standings";

	  sessionStorage.removeItem("fromDailyView");
	}

    loadTournamentOverview(tid);
	
	window.tournamentContext.activeTab =
	window.tournamentContext.activeOverviewTab;
  }
);
})();

// ================================
// TOURNAMENT MANAGEMENT ROUTES
// ================================

(function registerTournamentManagementRoutes() {
  const Router = App.Core.Router;
  if (!Router) return;

  // /tournament/:tid/manage
  Router.registerRoute(
    /^\/tournament\/(?<tid>[^/]+)\/manage$/,
    ({ params }) => {
      const tid = params.tid;
      window.currentTournamentId = tid;

      window.tournamentContext = window.tournamentContext || {};
      window.tournamentContext.activeOverviewTab = "manage";

      loadTournamentOverview(tid);
    }
  );

  // /tournament/:tid/manage-matches
  Router.registerRoute(
    /^\/tournament\/(?<tid>[^/]+)\/manage-matches$/,
    ({ params }) => {
      const tid = params.tid;
      window.currentTournamentId = tid;

      loadTournamentMatchesManage(tid);
    }
  );

  // /tournament/:tid/structure
  Router.registerRoute(
    /^\/tournament\/(?<tid>[^/]+)\/structure$/,
    ({ params }) => {
      const tid = params.tid;
      window.currentTournamentId = tid;

      loadTournamentStructure(tid);
    }
  );

  // /tournament/:tid/structure/advancement/:stageId?
  Router.registerRoute(
    /^\/tournament\/(?<tid>[^/]+)\/structure\/advancement\/?(?<stageId>[^/]*)$/,
    ({ params }) => {
      const { tid, stageId } = params;
      window.currentTournamentId = tid;

      loadStageAdvancementRules(tid, stageId || null);
    }
  );

  // /tournament/:tid/initialisation
  Router.registerRoute(
    /^\/tournament\/(?<tid>[^/]+)\/initialisation$/,
    ({ params }) => {
      const tid = params.tid;
      window.currentTournamentId = tid;

      window.tournamentContext = window.tournamentContext || {};
      window.tournamentContext.manageSubview = "initialisation";
      window.tournamentContext.activeOverviewTab = "manage";

      loadTournamentOverview(tid);
    }
  );
  
	// /tournament/:tid/teams
	Router.registerRoute(
	  /^\/tournament\/(?<tid>[^/]+)\/teams$/,
	  ({ params }) => {
		const tid = params.tid;
		window.currentTournamentId = tid;

		// Ensure tournament context exists
		window.tournamentContext = window.tournamentContext || {};
		window.tournamentContext.activeOverviewTab = "manage";

		loadTournamentTeams(tid);
	  }
	);
})();
