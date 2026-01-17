// src/features/scoring/console.js

let scoringConsoleRoot = null;

window.mountScoringConsole = function mountScoringConsole({ mode }) {
  const root = document.getElementById("scoring-console");
  if (!root) return;

  scoringConsoleRoot = root;
  root.innerHTML = "";

  if (mode === "forbidden") {
    root.innerHTML = `
      <div class="card scoring-console-card">
        <div class="title-row">
          <div class="title">SCORING CONSOLE</div>
          <button id="scoring-close-btn" class="header-btn small">Close ✕</button>
        </div>
        <div class="empty-message">
          You do not have permission to score this match.
        </div>
      </div>
    `;

    document.getElementById("scoring-close-btn").onclick = closeScoringConsole;
    return;
  }

  // ===== ALLOWED MODE =====
  root.innerHTML = `
    <div class="card scoring-console-card">
      <div class="title-row">
        <div class="title">SCORING CONSOLE</div>
        <button id="scoring-close-btn" class="header-btn small">Close ✕</button>
      </div>

      <div class="scoring-mode">
        <div class="scoring-subtle">Current throw:</div>
        <div id="scoring-current-thrower-label">–</div>
      </div>

      <div id="start-set-overlay" class="start-set-panel" style="display:none">
        <h3 id="start-set-title"></h3>
		<div id="set-lineup-slots"></div>
        <div id="start-set-sub">Who throws first?</div>
        <div class="start-buttons">
          <button id="start-set-with-p1" class="header-btn"></button>
          <button id="start-set-with-p2" class="header-btn"></button>
          <button id="end-match-btn" class="header-btn danger">End match</button>
        </div>
      </div>

      <div class="scoring-players">
        <div class="scoring-player">
          <strong id="scoring-p1-name">–</strong>
          <div>Sets: <span id="scoring-p1-sets">0</span></div>
          <div>Match SP: <span id="scoring-p1-sp">0</span></div>
          <div>Points: <span id="scoring-p1-setsp">0</span></div>
        </div>

        <div class="scoring-player">
          <strong id="scoring-p2-name">–</strong>
          <div>Sets: <span id="scoring-p2-sets">0</span></div>
          <div>Match SP: <span id="scoring-p2-sp">0</span></div>
          <div>Points: <span id="scoring-p2-setsp">0</span></div>
        </div>
      </div>

      <div id="scoring-buttons"></div>
    </div>
  `;

  document.getElementById("scoring-close-btn").onclick = closeScoringConsole;

  // NOW (and only now) wire scoring UI
  if (typeof initScoringButtons === "function") {
    initScoringButtons();
  }
};
