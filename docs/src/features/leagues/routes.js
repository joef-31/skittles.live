// =============================================
// Leagues routes
// =============================================

window.App = window.App || {};
App.Features = App.Features || {};
App.Features.Leagues = App.Features.Leagues || {};

(function registerLeaguesRoutes() {
  const Router = App.Core.Router;
  if (!Router) return;

	Router.registerRoute(
	  /^\/leagues$/,
	  () => {
		// CLEAR TOURNAMENT CONTEXT
		window.currentTournamentId = null;
		window.currentTournament = null;

		App.Features.Leagues.loadLeaguesMenu();
		updateBottomBar();
	  }
	);
})();
