window.currentUser = null;
window.SUPERADMIN = false;
window.viewAsRole = null;

let authListenerRegistered = false;
let authRefreshQueued = false;

function scheduleAuthRefresh() {
  if (authRefreshQueued) return;
  authRefreshQueued = true;

  // Use macrotask to avoid re-entrancy with current render/router work
  setTimeout(async () => {
    authRefreshQueued = false;

    try {
      if (window.App?.Auth?.loadPermissions) {
        await App.Auth.loadPermissions(window.currentUser?.id ?? null);
      }

      // Derive SUPERADMIN from permissions (never force true)
      window.SUPERADMIN =
        !!window.auth?.permissions?.some(p => p.role === "super_admin");
    } catch (e) {
      console.error("[auth] scheduleAuthRefresh failed", e);
    }

    // Pure UI refresh only
    try {
      renderAuthControls?.();
      renderViewAsControls?.();
      updateBottomBar?.();
    } catch (e) {
      console.error("[auth] UI refresh failed", e);
    }
  }, 0);
}

function registerAuthListener() {
  if (authListenerRegistered) return;
  authListenerRegistered = true;

  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    console.log("[auth]", event);

    // Ignore INITIAL_SESSION to avoid double render
    if (event === "INITIAL_SESSION") return;

    window.currentUser = session?.user ?? null;

    if (window.App?.Auth?.loadPermissions) {
      await App.Auth.loadPermissions(window.currentUser?.id ?? null);
    }

    // SINGLE, CLEAN refresh
    renderAuthControls();
    renderViewAsControls?.();
    updateBottomBar();
  });
}

async function initAuth() {
  const { data } = await supabaseClient.auth.getSession();

  window.currentUser = data?.session?.user ?? null;

  if (window.App?.Auth?.loadPermissions) {
    await App.Auth.loadPermissions(window.currentUser?.id ?? null);
  }

  renderAuthControls();
  renderViewAsControls?.();
  updateBottomBar();

  registerAuthListener();
}

window.openLogoutConfirmModal = async function () {
  if (!confirm("Log out?")) return;

  // 1️⃣ Always clear local session (never blocks)
  const localRes = await window.supabaseClient.auth.signOut({ scope: "local" });
  if (localRes?.error) {
    console.error("[auth] local signOut failed", localRes.error);
    alert("Logout failed.");
    return;
  }

  // 2️⃣ Best-effort global revoke (do NOT block UI)
  try {
    await Promise.race([
      window.supabaseClient.auth.signOut({ scope: "global" }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("global signOut timeout")), 1500)
      )
    ]);
  } catch (e) {
    console.warn("[auth] global signOut skipped:", e.message);
  }

  // 3️⃣ Reset app state explicitly
  window.currentUser = null;
  window.SUPERADMIN = false;

  if (window.App?.Auth?.loadPermissions) {
    await window.App.Auth.loadPermissions(null);
  }

  renderAuthControls?.();
  renderViewAsControls?.();
  updateBottomBar?.();

  // Optional but recommended for sanity while stabilising auth
  // location.reload();
};


window.initAuth = initAuth;
