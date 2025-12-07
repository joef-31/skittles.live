
// ---------------------------
// DOM ELEMENTS
// ---------------------------

const contentEl = document.getElementById("content");
const backBtn = document.getElementById("backBtn");
const scoreBtn = document.getElementById("scoreBtn");
const headerTools = document.querySelector(".header-tools");

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

// =====================================================================
// REUSABLE PLAYER SEARCH WIDGET
// - Type 3+ chars -> Supabase search
// - Alphabetical results (handled in db.js)
// - Auto-add on click
// - Prevent duplicates in the provided 'selectedIds' set
// =====================================================================

/**
 * createPlayerSearchWidget
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.container      - Where to render the widget
 * @param {function} opts.getSelectedIds    - () => Set<string> of already-selected player IDs for this side
 * @param {function} opts.onPlayerAdded     - (player: {id, name}) => void
 * @param {string} [opts.placeholder]       - Placeholder text
 * @param {number} [opts.minChars]          - Minimum chars before searching (default 3)
 */
function createPlayerSearchWidget({
  container,
  getSelectedIds,
  onPlayerAdded,
  placeholder = "Start typing to search players…",
  minChars = 3,
}) {
  if (!container) return;

  container.classList.add("player-search");

  const input = document.createElement("input");
  input.type = "text";
  input.className = "player-search-input";
  input.placeholder = placeholder;

  const resultsBox = document.createElement("div");
  resultsBox.className = "player-search-results";
  resultsBox.style.display = "none";

  container.appendChild(input);
  container.appendChild(resultsBox);

  let lastQuery = "";
  let searchTimer = null;

  async function performSearch(q) {
    const trimmed = q.trim();
    if (trimmed.length < minChars) {
      resultsBox.innerHTML = "";
      resultsBox.style.display = "none";
      return;
    }

    lastQuery = trimmed;

    const { data, error } = await dbSearchPlayersByName(trimmed);
    if (error) {
      resultsBox.innerHTML = "";
      resultsBox.style.display = "none";
      return;
    }

    // If the input changed while we were waiting, discard these results.
    if (input.value.trim() !== lastQuery) {
      return;
    }

    const selectedIds = getSelectedIds ? getSelectedIds() : new Set();

    const filtered = data.filter((p) => !selectedIds.has(p.id));

    if (filtered.length === 0) {
      resultsBox.innerHTML = "<div class='player-search-noresults'>No players found.</div>";
      resultsBox.style.display = "block";
      return;
    }

    resultsBox.innerHTML = "";
    filtered.forEach((player) => {
      const item = document.createElement("div");
      item.className = "player-search-item";
      item.textContent = player.name;
      item.addEventListener("click", () => {
        if (onPlayerAdded) {
          onPlayerAdded(player);
        }
        // Clear input and hide results after selection
        input.value = "";
        resultsBox.innerHTML = "";
        resultsBox.style.display = "none";
      });
      resultsBox.appendChild(item);
    });

    resultsBox.style.display = "block";
  }

  input.addEventListener("input", () => {
    const q = input.value;

    if (searchTimer) clearTimeout(searchTimer);

    // small debounce so we don't hammer Supabase on each keystroke
    searchTimer = setTimeout(() => {
      performSearch(q);
    }, 200);
  });

  // Close on blur (small delay so click can register)
  input.addEventListener("blur", () => {
    setTimeout(() => {
      resultsBox.style.display = "none";
    }, 180);
  });

  return {
    input,
    destroy() {
      if (searchTimer) clearTimeout(searchTimer);
      container.innerHTML = "";
    },
  };
}

window.createPlayerSearchWidget = createPlayerSearchWidget;
