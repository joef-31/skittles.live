window.currentUser = null;
window.SUPERADMIN = false;
window.viewAsRole = null;

async function initAuth() {
  if (!window.supabaseClient) {
    console.error("[auth] supabaseClient missing");
    return;
  }

  const { data, error } = await window.supabaseClient.auth.getSession();

	if (error || !data?.session) {
	  window.currentUser = null;
	  window.SUPERADMIN = false;

	  if (window.App?.Auth?.loadPermissions) {
		await App.Auth.loadPermissions(null);
	  }
	} else {
	  window.currentUser = data.session.user;
	  window.SUPERADMIN = true; // legacy

	  if (window.App?.Auth?.loadPermissions) {
		await App.Auth.loadPermissions(window.currentUser.id);
	  }
	}

	// Load global players ONCE for admin tooling
	await window.loadAllPlayers?.();

	renderAuthControls();
	renderViewAsControls();
	updateBottomBar();

	if (window.currentMatchId || window.currentTournamentId) {
	  updateBottomBar();
	}
}

// -----------------------------
// Simple login / logout helpers
// -----------------------------

window.openLogoutConfirmModal = async function () {
  if (!confirm("Log out?")) return;

  await window.supabaseClient.auth.signOut();

  window.currentUser = null;
  window.SUPERADMIN = false;

  renderAuthControls();
};

// Expose init explicitly
window.initAuth = initAuth;
