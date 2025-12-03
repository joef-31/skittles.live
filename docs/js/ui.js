// ---------------------------
// DOM ELEMENTS
// ---------------------------

const contentEl = document.getElementById("content");
const backBtn = document.getElementById("backBtn");
const scoreBtn = document.getElementById("scoreBtn");

// back handler callback
let backHandler = null;

// ---------------------------
// BASIC UI HELPERS
// ---------------------------

function setContent(html) {
  contentEl.innerHTML = html;
}

function showBackButton(handler) {
  backHandler = handler;
  backBtn.style.display = handler ? "inline-flex" : "none";
}

backBtn.addEventListener("click", () => {
  if (typeof backHandler === "function") backHandler();
});

function showError(msg) {
  setContent('<div class="card"><div class="error">' + msg + "</div></div>");
}

function showLoading(msg) {
  setContent(
    '<div class="card"><div class="subtitle">' +
      (msg || "Loading…") +
      "</div></div>"
  );
}

// ---------------------------
// SCORE BUTTON VISIBILITY
// ---------------------------

function updateScoreButtonVisibility(onMatchDetail) {
  if (SUPERADMIN && onMatchDetail) {
    scoreBtn.style.display = "inline-flex";
  } else {
    scoreBtn.style.display = "none";
    if (typeof closeScoringConsole === "function") {
      closeScoringConsole();
    }
  }
}

// ---------------------------
// DATE FORMATTING
// ---------------------------

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const day = d.getDate();
  const month = d.toLocaleString("en-GB", { month: "short" });
  const year = String(d.getFullYear()).slice(2);
  return `${day} ${month} ${year}`;
}
