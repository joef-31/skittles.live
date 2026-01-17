// =============================================
// DOM helpers (content only)
// =============================================

// No imports
// No exports
// file:// safe

window.App = window.App || {};
App.Utils = App.Utils || {};
App.Utils.DOM = App.Utils.DOM || {};

App.Utils.DOM.setContent = function (html) {
  const container = document.getElementById("content");
  if (!container) {
    console.error("[DOM] .content container missing");
    return;
  }
  container.innerHTML = html;
};

App.Utils.DOM.showLoading = function (message) {
  App.Utils.DOM.setContent(
    `<div class="card"><div class="empty-message">${message}</div></div>`
  );
};

App.Utils.DOM.showError = function (message) {
  App.Utils.DOM.setContent(
    `<div class="card"><div class="error">${message}</div></div>`
  );
};
