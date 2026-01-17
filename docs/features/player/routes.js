// =============================================
// Player routes
// =============================================

// file:// safe
// No imports
// No exports

window.App = window.App || {};
App.Features = App.Features || {};
App.Features.Player = App.Features.Player || {};

(function registerPlayerRoutes() {
  const Router = App.Core.Router;
  if (!Router) return;

  Router.registerRoute(
    /^\/player\/(?<pid>[^/]+)$/,
    ({ params, query }) => {
      const pid = params.pid;
      const tab = query.tab || "overview";

      App.Features.Player.renderPlayerPage(pid, tab);
    }
  );
})();
