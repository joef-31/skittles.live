/* // ===========================================================
// AUTH / PROFILE SYSTEM (placeholder for real auth later)
// ===========================================================

// DOM reference
const profileSelect = document.getElementById("profile-select");

// Load profiles from Supabase + add static roles
async function loadProfileList() {
  if (!profileSelect) return;

  // Clear current items
  profileSelect.innerHTML = "";

  // Static roles
  const staticProfiles = [
    { id: "admin", name: "Joe (Admin)" },
    { id: "ref", name: "Referee" }
  ];

  // Fetch players from DB
  const { data: players, error } = await supabase
    .from("players")
    .select("id, name")
    .order("name");

  if (error) {
    console.error("Failed to load players:", error);
  }

  // Build full list
  const allProfiles = [
    ...staticProfiles,
    ...(players || []),
    { id: "guest", name: "Guest (View Only)" }
  ];

  // Populate <select>
  allProfiles.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    profileSelect.appendChild(opt);
  });

  // Default
  profileSelect.value = "guest";
}

// Utility: get active profile ID
function getCurrentProfileId() {
  if (window.SUPERADMIN === true) return "superadmin";
  return "guest";
}

// Utility: get active profile full name
function getCurrentProfileName() {
  if (window.SUPERADMIN === true) return "Admin";
  return "Guest (View Only)";
}


// Make available to everything
window.loadProfileList = loadProfileList;
window.getCurrentProfileId = getCurrentProfileId;
window.getCurrentProfileName = getCurrentProfileName;

// Load immediately when DOM is ready
document.addEventListener("DOMContentLoaded", loadProfileList); */

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// NEW AUTHENTICATION SYSTEM, REPLACING ABOVE !!!!!!!!!!!!!!!!
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

// ===========================================================
// AUTH INITIALISATION (REAL SUPABASE AUTH)
// ===========================================================

async function initAuth() {
  const {
    data: { user },
    error
  } = await window.supabaseClient.auth.getUser();

  if (error) {
    console.error("[auth] getUser failed", error);
  }

  window.currentUser = user || null;

  // 🔒 TEMP: single hard-coded superadmin
  const SUPERADMIN_EMAIL = "gbmolkky@gmail.com";

  window.SUPERADMIN =
    !!user && user.email === SUPERADMIN_EMAIL;

  console.log("[auth] user:", user?.email || "none");
  console.log("[auth] SUPERADMIN:", window.SUPERADMIN);
}

// expose globally
window.initAuth = initAuth;

function openLoginModal() {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";

  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">Admin login</div>
        <button class="icon-btn modal-close">✕</button>
      </div>

      <div class="modal-body">
        <label>
          Email
          <input type="email" id="login-email" />
        </label>

        <label>
          Password
          <input type="password" id="login-password" />
        </label>

        <div class="error" id="login-error"></div>
      </div>

      <div class="modal-actions">
        <button class="header-btn" id="login-submit">Log in</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector(".modal-close").onclick = () => modal.remove();

  modal.querySelector("#login-submit").onclick = async () => {
    const email = modal.querySelector("#login-email").value;
    const password = modal.querySelector("#login-password").value;
    const errEl = modal.querySelector("#login-error");

    errEl.textContent = "";

    const { error } = await window.supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      errEl.textContent = error.message;
      return;
    }

    await initAuth();          // refresh user + SUPERADMIN
    renderAuthControls();      // update UI
    modal.remove();
  };
}

window.openLoginModal = openLoginModal;

function openLogoutConfirmModal() {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";

  modal.innerHTML = `
    <div class="modal-card" style="max-width:420px;">
      <div class="modal-header">
        <div class="modal-title">Confirm logout</div>
        <button class="icon-btn modal-close">✕</button>
      </div>

      <div class="modal-body">
        <p class="muted">
          You will lose access to admin controls until you log in again.
        </p>
      </div>

      <div class="modal-actions">
        <button class="header-btn secondary" id="logout-cancel">
          Cancel
        </button>
        <button class="header-btn danger" id="logout-confirm">
          Log out
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const close = () => modal.remove();

  modal.querySelector(".modal-close").onclick = close;
  modal.querySelector("#logout-cancel").onclick = close;

  modal.querySelector("#logout-confirm").onclick = async () => {
    await performLogout();
    close();
  };
}

window.openLogoutConfirmModal = openLogoutConfirmModal;

async function performLogout() {
  const { error } = await window.supabaseClient.auth.signOut();

  if (error) {
    console.error("[auth] logout failed", error);
    alert("Failed to log out");
    return;
  }

  window.currentUser = null;
  window.SUPERADMIN = false;

  renderAuthControls();
  renderBottomBar();

  console.log("[auth] logged out");
}

window.performLogout = performLogout;


