// =======================================================
// CORE ROUTER (non-module)
// =======================================================
// Responsible for:
// - Reading window.location.hash
// - Dispatching to feature-level route handlers
// - NOTHING ELSE
// =======================================================

// file:// safe
// No imports
// No exports

window.App = window.App || {};
App.Core = App.Core || {};
App.Core.Router = App.Core.Router || {};

function getHashQuery() {
  const hash = window.location.hash || "";
  const qIndex = hash.indexOf("?");
  if (qIndex === -1) return {};
  return Object.fromEntries(
    new URLSearchParams(hash.slice(qIndex + 1))
  );
}

// Expose globally for routes
window.getHashQuery = getHashQuery;

// -------------------------------------------------------
// Internal route registry
// -------------------------------------------------------

App.Core.Router._routes = [];

/**
 * Register a route
 * @param {RegExp} pattern
 * @param {(ctx: Object) => Promise<void>|void} handler
 */
App.Core.Router.registerRoute = function (pattern, handler) {
  App.Core.Router._routes.push({ pattern, handler });
};

/**
 * Parse hash into path + query
 */
App.Core.Router._parseHash = function () {
  const raw = window.location.hash || "#/";
  const [path, queryString] = raw.slice(1).split("?");

  const query = {};
  if (queryString) {
    queryString.split("&").forEach((pair) => {
      const [k, v] = pair.split("=");
      query[k] = decodeURIComponent(v || "");
    });
  }

  return { path, query };
};

/**
 * Main router dispatcher
 */
App.Core.Router.handleRoute = async function () {
  const { path, query } = App.Core.Router._parseHash();

  for (const { pattern, handler } of App.Core.Router._routes) {
    const match = path.match(pattern);
    if (match) {
      try {
        await handler({
          path,
          query,
          params: match.groups || {},
          match,
        });

        // ✅ UPDATE BOTTOM BAR AFTER ROUTE HANDLER
        if (typeof renderBottomBar === "function") {
          renderBottomBar();
        }

      } catch (err) {
        console.error("[router] handler failed", err);
      }
      return;
    }
  }

  console.warn("[router] No route matched:", path);
};


/**
 * Initialise router
 */
App.Core.Router.init = function () {
  window.addEventListener("hashchange", App.Core.Router.handleRoute);
  App.Core.Router.handleRoute();
};

App.Core.Router.init();