// ===========================================================
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
  return profileSelect ? profileSelect.value : "guest";
}

// Utility: get active profile full name
function getCurrentProfileName() {
  const id = getCurrentProfileId();
  const option = profileSelect?.querySelector(`option[value="${id}"]`);
  return option ? option.textContent : "Guest (View Only)";
}

// Make available to everything
window.loadProfileList = loadProfileList;
window.getCurrentProfileId = getCurrentProfileId;
window.getCurrentProfileName = getCurrentProfileName;

// Load immediately when DOM is ready
document.addEventListener("DOMContentLoaded", loadProfileList);
