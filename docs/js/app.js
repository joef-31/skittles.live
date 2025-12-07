// =======================================================
// GLOBAL CONSTANTS / FRIENDLIES
// =======================================================

const FRIENDLIES_TOURNAMENT_ID = "11111111-1111-1111-1111-111111111111";

// "Add friendly" button in global headerTools (defined in ui.js)
let addFriendlyBtn = null;
if (typeof headerTools !== "undefined" && headerTools) {
  addFriendlyBtn = document.createElement("button");
  addFriendlyBtn.id = "addFriendlyBtn";
  addFriendlyBtn.className = "header-btn";
  addFriendlyBtn.style.display = "none";
  addFriendlyBtn.title = "Create a new friendly match";
  addFriendlyBtn.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="4" y="4" width="16" height="16" rx="3" ry="3" fill="none"
        stroke="currentColor" stroke-width="1.6" />
      <path d="M12 8 v8 M8 12 h8" fill="none"
        stroke="currentColor" stroke-width="1.6" />
    </svg>
    <span class="header-btn-label">Add friendly</span>
  `;
  headerTools.appendChild(addFriendlyBtn);
}

// Track current route context
window.currentMatchId = null;
window.currentTournamentId = null;
window.lastSeenSet = null;

// =======================================================
// GENERIC UI HELPERS
// =======================================================

function setContent(html) {
  if (!contentEl) return;
  contentEl.innerHTML = html;
}

function showLoading(message) {
  setContent(
    `<div class="card"><div class="empty-message">${message}</div></div>`
  );
}

function showError(message) {
  setContent(
    `<div class="card"><div class="error">${message}</div></div>`
  );
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function showBackButton(handlerOrNull) {
  if (!backBtn) return;
  if (!handlerOrNull) {
    backBtn.style.display = "none";
    backBtn.onclick = null;
    return;
  }
  backBtn.style.display = "inline-block";
  backBtn.onclick = handlerOrNull;
}

function updateScoreButtonVisibility(show) {
  if (!scoreBtn) return;
  if (show && (typeof SUPERADMIN === "undefined" || SUPERADMIN)) {
    scoreBtn.style.display = "inline-flex";
  } else {
    scoreBtn.style.display = "none";
  }
}

// Show / hide Add Friendly button depending on current view
function setAddFriendlyVisible(visible) {
  if (!addFriendlyBtn) return;
  addFriendlyBtn.style.display = visible ? "inline-flex" : "none";
}

// Ensure Friendlies tournament exists in DB
async function ensureFriendliesTournamentExists() {
  const { error } = await supabase
    .from("tournaments")
    .upsert(
      {
        id: FRIENDLIES_TOURNAMENT_ID,
        name: "Friendlies",
      },
      { onConflict: "id" }
    );

  if (error) {
    console.error("Failed to ensure Friendlies tournament:", error);
  }
}

// =======================================================
// SIMPLE HASH ROUTER — keeps view in sync with URL
// =======================================================

function handleRoute() {
  const hash = window.location.hash || "#/tournaments";
  const parts = hash.replace("#", "").split("/");

  // #/tournaments
  if (parts[1] === "tournaments") {
    loadTournaments();
    return;
  }

  // #/friendlies → just the Friendlies tournament
  if (parts[1] === "friendlies" && !parts[2]) {
    loadTournamentView(FRIENDLIES_TOURNAMENT_ID);
    return;
  }

  // #/friendlies/new
  if (parts[1] === "friendlies" && parts[2] === "new") {
    loadFriendlyCreate();
    return;
  }

  // #/tournament/<tid>
  if (parts[1] === "tournament" && parts[2]) {
    loadTournamentView(parts[2]);
    return;
  }

  // #/match/<mid>/<tid>
  if (parts[1] === "match" && parts[2] && parts[3]) {
    loadMatchDetail(parts[2], parts[3]);
    return;
  }

  // fallback
  loadTournaments();
}

// Listen for browser back/forward
window.addEventListener("hashchange", handleRoute);

// =======================================================
// THROWS MODEL (miss, fault, bust logic)
// =======================================================

function buildThrowsModel(throws, player1Id, player2Id) {
  let cumP1 = 0;
  let cumP2 = 0;
  const model = [];

  (throws || []).forEach((t) => {
    const isP1 = t.player_id === player1Id;
    const raw = t.score ?? 0;
    const miss = raw === 0;
    const fault = t.is_fault === true;

    let before = isP1 ? cumP1 : cumP2;
    let displayScore = "";

    if (miss) {
      if (fault && before >= 37) {
        // Fault miss causing reset
        displayScore = "X↓";
        if (isP1) cumP1 = 25;
        else cumP2 = 25;
      } else {
        displayScore = "X"; // normal miss / non-resetting fault
      }
    } else {
      let tentative = before + raw;
      const bust = tentative > 50;
      if (bust) {
        displayScore = raw + "↓"; // bust → reset to 25
        if (isP1) cumP1 = 25;
        else cumP2 = 25;
      } else {
        displayScore = String(raw);
        if (isP1) cumP1 = tentative;
        else cumP2 = tentative;
      }
    }

    model.push({
      throw_number: t.throw_number,
      isP1,
      rawScore: raw,
      displayScore,
      cumP1,
      cumP2,
    });
  });

  return model;
}

function throwBoxHTML(raw) {
  const v = String(raw);
  let cls = "throw-box";
  if (v.includes("X")) cls += " miss";
  else if (v.includes("↓")) cls += " reset";
  return `<div class="${cls}">${v}</div>`;
}

// =======================================================
// REALTIME: SETS → update match detail + match list
// =======================================================

const setsChannel = supabase
  .channel("sets-realtime")
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "sets",
    },
    async (payload) => {
      if (!window.currentMatchId || !window.currentTournamentId) return;

      const updated = payload.new;
      if (!updated) return;
      if (updated.match_id !== window.currentMatchId) return;

      smoothUpdateSetRow(updated);
    }
  )
  .subscribe();

const setsChannelMatchList = supabase
  .channel("sets-realtime-matchlist")
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "sets",
    },
    (payload) => {
      const updated = payload.new;
      if (!updated) return;

      const matchId = updated.match_id;
      const p1 = updated.score_player1 ?? "";
      const p2 = updated.score_player2 ?? "";

      const matchesTab = document.getElementById("tab-matches");
      if (!matchesTab || matchesTab.offsetParent === null) return;

      const card = document.querySelector(`.card[data-mid="${matchId}"]`);
      if (!card) return;

      const liveBoxes = card.querySelectorAll(".mc-livebox");
      if (liveBoxes.length === 2) {
        liveBoxes[0].textContent = p1;
        liveBoxes[1].textContent = p2;

        if (p1 !== "" || p2 !== "") {
          liveBoxes[0].classList.add("is-live");
          liveBoxes[1].classList.add("is-live");
        } else {
          liveBoxes[0].classList.remove("is-live");
          liveBoxes[1].classList.remove("is-live");
        }
      }

      if (updated.winner_player_id) {
        updateMatchListFinalScore(matchId, card);
      }
    }
  )
  .subscribe();

// Smoothly update a single set row + header, without full reload
async function smoothUpdateSetRow(updatedSet) {
  const setNumber = updatedSet.set_number;
  if (!setNumber) return;

  const onMatchDetailPage = document.querySelector(".top-card") !== null;
  const block = document.querySelector(`.set-block[data-set="${setNumber}"]`);

  if (!block) {
    if (onMatchDetailPage) {
      if (!window.lastSeenSet || setNumber > window.lastSeenSet) {
        window.lastSeenSet = setNumber;
        loadMatchDetail(window.currentMatchId, window.currentTournamentId);
      }
    }
    return;
  }

  const mainRow = block.querySelector(".set-main-row");
  if (!mainRow) return;

  const leftCell = mainRow.querySelector(".col.left");
  const rightCell = mainRow.querySelector(".col.right");

  if (leftCell) leftCell.textContent = updatedSet.score_player1 ?? "";
  if (rightCell) rightCell.textContent = updatedSet.score_player2 ?? "";

  if (updatedSet.winner_player_id && window.scoringMatch) {
    const p1Id = window.scoringMatch.p1Id;
    const p2Id = window.scoringMatch.p2Id;

    leftCell?.classList.remove("winner");
    rightCell?.classList.remove("winner");

    if (updatedSet.winner_player_id === p1Id)
      leftCell?.classList.add("winner");
    if (updatedSet.winner_player_id === p2Id)
      rightCell?.classList.add("winner");
  }

  // Update thrower label in scoring console
  if (typeof scoringCurrentThrower !== "undefined") {
    scoringCurrentThrower = updatedSet.current_thrower || "p1";
    if (window.scoringMatch) {
      const name =
        scoringCurrentThrower === "p1"
          ? window.scoringMatch.p1Name
          : window.scoringMatch.p2Name;
      const label = document.getElementById("scoring-current-thrower-label");
      if (label) label.textContent = `${name} to throw`;
    }
  }

  // Update live set score in header
  const headerSetScore = document.getElementById("header-live-setscore");
  if (headerSetScore) {
    const sp1 = updatedSet.score_player1 ?? 0;
    const sp2 = updatedSet.score_player2 ?? 0;
    headerSetScore.textContent = `${sp1} – ${sp2}`;
  }

  if (updatedSet.winner_player_id) {
    await updateOverallMatchScore();
  }
}

async function updateOverallMatchScore() {
  if (!window.currentMatchId) return;

  const { data: match, error } = await supabase
    .from("matches")
    .select("final_sets_player1, final_sets_player2")
    .eq("id", window.currentMatchId)
    .maybeSingle();

  if (error || !match) return;

  const headerScore = document.querySelector(".top-card .top-score");
  if (headerScore) {
    headerScore.textContent =
      (match.final_sets_player1 ?? 0) +
      " – " +
      (match.final_sets_player2 ?? 0);
  }
}

async function updateMatchListFinalScore(matchId, card) {
  const { data: match, error } = await supabase
    .from("matches")
    .select("final_sets_player1, final_sets_player2")
    .eq("id", matchId)
    .maybeSingle();

  if (error || !match) return;

  const setCells = card.querySelectorAll(".mc-setscore");
  if (setCells.length === 2) {
    setCells[0].textContent = match.final_sets_player1 ?? 0;
    setCells[1].textContent = match.final_sets_player2 ?? 0;
  }
}

// =======================================================
// LIVE THROWS: header throwstrip + expanded table
// =======================================================

async function updateLiveThrowsForSet(setNumber) {
  if (!window.currentMatchId) return;

const { data: throws, error } = await supabase
  .from("throws")
  .select("id, match_id, set_number, throw_number, player_id, score, is_fault")
  .eq("match_id", window.currentMatchId)
  .eq("set_number", setNumber)
  .order("throw_number", { ascending: true });

  if (error || !throws) return;

  const p1 = window.scoringMatch?.p1Id;
  const p2 = window.scoringMatch?.p2Id;
  const model = buildThrowsModel(throws, p1, p2);

  // Header throwstrip
  const headerP1 = document.getElementById("header-throws-p1");
  const headerP2 = document.getElementById("header-throws-p2");

  if (headerP1 && headerP2) {
    const lastP1 = model.filter((m) => m.isP1).slice(-6);
    const lastP2 = model.filter((m) => !m.isP1).slice(-6);

    headerP1.innerHTML = lastP1.map((m) => throwBoxHTML(m.displayScore)).join("");
    headerP2.innerHTML = lastP2.map((m) => throwBoxHTML(m.displayScore)).join("");
  }

  // Expanded table (if open)
  const expanded = document.querySelector(
    `.set-throws-expanded[data-set="${setNumber}"]`
  );
  if (expanded && expanded.style.display === "block") {
    expanded.innerHTML = buildThrowsTableHTML(
      model,
      window.scoringMatch?.p1Name || "Player 1",
      window.scoringMatch?.p2Name || "Player 2"
    );
  }
}

window.updateLiveThrowsForSet = updateLiveThrowsForSet;

// Realtime channel for throws
const throwsChannel = supabase
  .channel("throws-realtime")
  .on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "throws",
    },
    async (payload) => {
      const t = payload.new;
      if (!t) return;
      if (t.match_id !== window.currentMatchId) return;
      updateLiveThrowsForSet(t.set_number);
    }
  )
  .subscribe();

// =======================================================
// BUILD THROWS TABLE HTML
// =======================================================

function buildThrowsTableHTML(model, p1Name, p2Name) {
  if (!model || model.length === 0) {
    return '<div class="empty-message">No throw history for this set.</div>';
  }

  const p1Seq = [];
  const p2Seq = [];

  model.forEach((r) => {
    if (r.isP1) {
      p1Seq.push({ score: r.displayScore, total: r.cumP1 });
    } else {
      p2Seq.push({ score: r.displayScore, total: r.cumP2 });
    }
  });

  const rows = [];
  const maxRows = Math.max(p1Seq.length, p2Seq.length);

  for (let i = 0; i < maxRows; i++) {
    const p1 = p1Seq[i];
    const p2 = p2Seq[i];

    const p1ScoreStr = String(p1 ? p1.score ?? "" : "");
    const p2ScoreStr = String(p2 ? p2.score ?? "" : "");

    const p1Class = p1
      ? p1ScoreStr.includes("X")
        ? "miss"
        : p1ScoreStr.includes("↓")
        ? "reset"
        : ""
      : "";
    const p2Class = p2
      ? p2ScoreStr.includes("X")
        ? "miss"
        : p2ScoreStr.includes("↓")
        ? "reset"
        : ""
      : "";

    const p1Cell = p1
      ? `<span class="throw-raw ${p1Class}"><sub>${p1ScoreStr}</sub></span>/<span class="throw-total">${p1.total}</span>`
      : "";
    const p2Cell = p2
      ? `<span class="throw-raw ${p2Class}"><sub>${p2ScoreStr}</sub></span>/<span class="throw-total">${p2.total}</span>`
      : "";

    rows.push(`
      <tr>
        <td>${i + 1}</td>
        <td>${p1Cell}</td>
        <td>${p2Cell}</td>
      </tr>
    `);
  }

  return `
    <table class="throws-table">
      <thead>
        <tr>
          <th>#</th>
          <th>${p1Name}</th>
          <th>${p2Name}</th>
        </tr>
      </thead>
      <tbody>${rows.join("")}</tbody>
    </table>
  `;
}

// =======================================================
// LOAD TOURNAMENTS LIST (includes Friendlies card last)
// =======================================================

async function loadTournaments() {
  window.currentMatchId = null;
  window.currentTournamentId = null;
  window.lastSeenSet = null;

  showBackButton(null);
  updateScoreButtonVisibility(false);
  setAddFriendlyVisible(false);

  showLoading("Loading tournaments…");

  await ensureFriendliesTournamentExists();

  const { data, error } = await supabase
    .from("tournaments")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) {
    console.error(error);
    showError("Failed to load tournaments");
    return;
  }

  let tournaments = data || [];

  // Remove friendlies row from sorted list (so we can force it last)
  tournaments = tournaments.filter((t) => t.id !== FRIENDLIES_TOURNAMENT_ID);

  let html = '<div class="section-title">Tournaments</div>';

  tournaments.forEach((t) => {
    const name = t.name || "Tournament " + t.id.slice(0, 8);
    html += `
      <div class="card clickable" data-tid="${t.id}">
        <div class="title-row">
          <div class="title">${name}</div>
        </div>
      </div>
    `;
  });

  // Friendlies card always last, always present
  html += `
    <div class="card clickable" data-friendlies="true">
      <div class="title-row">
        <div class="title">Friendlies</div>
        <div class="subtitle">Pickup & casual matches</div>
      </div>
    </div>
  `;

  setContent(html);

  document.querySelectorAll("[data-tid]").forEach((el) => {
    el.addEventListener("click", () => {
      const tid = el.getAttribute("data-tid");
      window.location.hash = `#/tournament/${tid}`;
    });
  });

  const friendliesCard = document.querySelector('[data-friendlies="true"]');
  if (friendliesCard) {
    friendliesCard.addEventListener("click", () => {
      window.location.hash = "#/friendlies";
    });
  }
}

// =======================================================
// ADD FRIENDLY PAGE (#/friendlies/new)
// =======================================================

async function loadFriendlyCreate() {
  window.currentMatchId = null;
  window.currentTournamentId = FRIENDLIES_TOURNAMENT_ID;
  window.lastSeenSet = null;

  showBackButton(() => {
    window.location.hash = "#/friendlies";
  });
  updateScoreButtonVisibility(false);
  setAddFriendlyVisible(false);

  showLoading("Preparing friendly creator…");

  await ensureFriendliesTournamentExists();

  const { data: players, error } = await supabase
    .from("players")
    .select("id, name, is_guest")
    .order("name", { ascending: true });

  const allPlayers = players || [];
  if (error) {
    console.error(error);
  }

  const html = `
    <div class="card">
      <div class="tournament-header">
        <div class="tournament-name">Create friendly match</div>
        <div class="subtitle">Pickup game – results still count for real players</div>
      </div>

      <div class="section-title">Players</div>

      <div class="match-small">
        Tip: single name = guest (no profile). Full name = real player (with profile).
      </div>

      <div class="friendly-form">
        <label>
          Player A
          <input type="text" id="friendly-p1-input" placeholder="e.g. Joe or Joe Foxon" autocomplete="off" />
        </label>
        <div id="friendly-p1-suggestions" class="friendly-suggestions"></div>

        <label>
          Player B
          <input type="text" id="friendly-p2-input" placeholder="e.g. Haydn or Haydn Boehm" autocomplete="off" />
        </label>
        <div id="friendly-p2-suggestions" class="friendly-suggestions"></div>

        <button id="friendly-create-btn" class="header-btn" style="margin-top:10px;">
          Create & score this match
        </button>

        <div id="friendly-error" class="error" style="margin-top:6px; display:none;"></div>
      </div>
    </div>
  `;

  setContent(html);

  const p1Input = document.getElementById("friendly-p1-input");
  const p2Input = document.getElementById("friendly-p2-input");
  const p1Sug = document.getElementById("friendly-p1-suggestions");
  const p2Sug = document.getElementById("friendly-p2-suggestions");
  const createBtn = document.getElementById("friendly-create-btn");
  const errBox = document.getElementById("friendly-error");

  function showErrorMessage(msg) {
    if (!errBox) return;
    if (!msg) {
      errBox.style.display = "none";
      errBox.textContent = "";
    } else {
      errBox.style.display = "block";
      errBox.textContent = msg;
    }
  }

  function buildSuggestions(inputEl, sugEl) {
    if (!inputEl || !sugEl) return;
    const q = inputEl.value.trim().toLowerCase();
    sugEl.innerHTML = "";
    if (q.length < 1) return;

    const matches = allPlayers.filter((p) =>
      (p.name || "").toLowerCase().includes(q)
    );

    const topMatches = matches.slice(0, 5);
    topMatches.forEach((p) => {
      const div = document.createElement("div");
      div.className = "friendly-suggestion-item";
      const label = p.is_guest ? `${p.name} (Guest)` : p.name;
      div.textContent = label;
      div.dataset.playerId = p.id;
      div.addEventListener("click", () => {
        inputEl.value = p.name;
        inputEl.dataset.playerId = p.id;
        inputEl.dataset.isGuest = p.is_guest ? "true" : "false";
        sugEl.innerHTML = "";
      });
      sugEl.appendChild(div);
    });
  }

  p1Input?.addEventListener("input", () => buildSuggestions(p1Input, p1Sug));
  p2Input?.addEventListener("input", () => buildSuggestions(p2Input, p2Sug));

  async function resolvePlayer(inputEl) {
    if (!inputEl) throw new Error("Invalid input element");
    let name = (inputEl.value || "").trim();
    if (!name) throw new Error("Please enter both player names.");

    // If user picked from suggestions, use that directly
    const existingId = inputEl.dataset.playerId;
    if (existingId) {
      return existingId;
    }

    const spaceIndex = name.indexOf(" ");

    // Single word -> guest profile
    if (spaceIndex === -1) {
      const { data, error } = await supabase
        .from("players")
        .insert({ name, is_guest: true })
        .select("id")
        .maybeSingle();

      if (error || !data) throw new Error("Failed to create guest player.");
      allPlayers.push({ id: data.id, name, is_guest: true });
      return data.id;
    }

    // Multi-word -> “real” player
    const existingReal = allPlayers.find(
      (p) => !p.is_guest && (p.name || "").toLowerCase() === name.toLowerCase()
    );
    if (existingReal) {
      return existingReal.id;
    }

    const { data, error } = await supabase
      .from("players")
      .insert({ name, is_guest: false })
      .select("id")
      .maybeSingle();

    if (error || !data) throw new Error("Failed to create player.");
    allPlayers.push({ id: data.id, name, is_guest: false });
    return data.id;
  }

  if (createBtn) {
    createBtn.addEventListener("click", async () => {
      showErrorMessage("");

      try {
        const p1Id = await resolvePlayer(p1Input);
        const p2Id = await resolvePlayer(p2Input);

        if (p1Id === p2Id) {
          throw new Error("Players must be different.");
        }

        const now = new Date().toISOString();

        const { data: inserted, error: matchErr } = await supabase
          .from("matches")
          .insert({
            tournament_id: FRIENDLIES_TOURNAMENT_ID,
            player1_id: p1Id,
            player2_id: p2Id,
            status: "scheduled",
            match_date: now,
            final_sets_player1: 0,
            final_sets_player2: 0,
          })
          .select("id")
          .maybeSingle();

        if (matchErr || !inserted) {
          console.error(matchErr);
          throw new Error("Failed to create friendly match.");
        }

        const newMatchId = inserted.id;
        window.location.hash = `#/match/${newMatchId}/${FRIENDLIES_TOURNAMENT_ID}`;
      } catch (e) {
        console.error(e);
        showErrorMessage(e.message || "Failed to create friendly.");
      }
    });
  }
}

// =======================================================
// LOAD TOURNAMENT VIEW (normal tournaments + Friendlies)
// =======================================================

async function loadTournamentView(tournamentId) {
  window.currentMatchId = null;
  window.currentTournamentId = tournamentId;
  window.lastSeenSet = null;

  const isFriendlies = tournamentId === FRIENDLIES_TOURNAMENT_ID;

  showBackButton(() => {
    window.location.hash = "#/tournaments";
  });
  updateScoreButtonVisibility(false);
  setAddFriendlyVisible(isFriendlies);

  if (isFriendlies && addFriendlyBtn) {
    addFriendlyBtn.onclick = () => {
      window.location.hash = "#/friendlies/new";
    };
  }

  showLoading("Loading tournament…");

  if (isFriendlies) {
    await ensureFriendliesTournamentExists();
  }

  const { data: matches, error: matchError } = await supabase
    .from("matches")
    .select(`
      id,
      match_date,
      status,
      final_sets_player1,
      final_sets_player2,
      player1:player1_id ( id, name ),
      player2:player2_id ( id, name ),
      tournament:tournament_id ( id, name )
    `)
    .eq("tournament_id", tournamentId)
    .order("match_date", { ascending: true });

  if (matchError) {
    console.error(matchError);
    showError("Failed to load matches");
    return;
  }

  if (!matches || matches.length === 0) {
    setContent(
      '<div class="card"><div class="empty-message">No matches found for this tournament.</div></div>'
    );
    return;
  }

activeDateFilter = null;

const matchDates = matches
  .map((m) => isoDateOnly(m.match_date))
  .filter(Boolean);

renderDateBar(matchDates, (selectedDate) => {
  renderMatchesForTournament(matches, selectedDate);
});

function renderMatchesForTournament(matches, dateFilter = null) {
  const container = document.getElementById("tab-matches");
  if (!container) return;

  let filtered = matches;

  if (dateFilter) {
    filtered = matches.filter(
      (m) => isoDateOnly(m.match_date) === dateFilter
    );
  }

  if (filtered.length === 0) {
    container.innerHTML =
      '<div class="empty-message">No matches on this date.</div>';
    return;
  }

  let html = '<div class="section-title">Matches</div>';

  filtered.forEach(/* EXISTING match card code */);

  container.innerHTML = html;

  // rebind click handlers
}


  const tournamentName = matches[0].tournament?.name || "Tournament";
  const matchIds = matches.map((m) => m.id);

  let sets = [];
  if (matchIds.length > 0) {
    const { data: setsData, error: setsError } = await supabase
      .from("sets")
      .select(
        "id, match_id, set_number, score_player1, score_player2, winner_player_id"
      )
      .in("match_id", matchIds);

    if (setsError) {
      console.error(setsError);
      showError("Failed to load sets");
      return;
    }
    sets = setsData || [];
  }

  const liveSetByMatch = {};
  sets.forEach((s) => {
    if (!s.match_id) return;
    const isLiveSet =
      !s.winner_player_id && s.score_player1 < 50 && s.score_player2 < 50;
    if (!isLiveSet) return;
    const existing = liveSetByMatch[s.match_id];
    if (!existing || s.set_number > existing.set_number) {
      liveSetByMatch[s.match_id] = {
        set_number: s.set_number,
        p1: s.score_player1,
        p2: s.score_player2,
      };
    }
  });

  let html = `
    <div class="card">
      <div class="tournament-header">
        <div class="tournament-name">${tournamentName}</div>
      </div>

      <div class="tab-row">
        <div class="tab active" data-tab="matches">Matches</div>
        <div class="tab" data-tab="standings">Standings</div>
      </div>

      <div id="tab-matches"></div>
      <div id="tab-standings" style="display:none;"></div>
    </div>
  `;
  setContent(html);

  // Friendlies: hide standings tab completely
  if (isFriendlies) {
    const standingsTab = document.querySelector('.tab[data-tab="standings"]');
    const standingsPanel = document.getElementById("tab-standings");
    if (standingsTab) standingsTab.style.display = "none";
    if (standingsPanel) standingsPanel.style.display = "none";
  }

  const matchesContainer = document.getElementById("tab-matches");
  let matchesHtml = '<div class="section-title">Matches</div>';

  matches.forEach((m) => {
    const p1Name = m.player1?.name || "Player 1";
    const p2Name = m.player2?.name || "Player 2";
    const setsScore1 = m.final_sets_player1 ?? 0;
    const setsScore2 = m.final_sets_player2 ?? 0;

    const status = m.status || "scheduled";
    let statusClass = "scheduled";
    let statusLabel = "Scheduled";

    if (status === "live") {
      statusClass = "live";
      statusLabel = "Live";
    } else if (status === "finished") {
      statusClass = "finished";
      statusLabel = "Finished";
    }

    const dateLabel = formatDate(m.match_date);
    const liveSet = status === "live" ? liveSetByMatch[m.id] : null;
    const liveP1 = liveSet ? liveSet.p1 : "";
    const liveP2 = liveSet ? liveSet.p2 : "";

    matchesHtml += `
      <div class="card clickable" data-mid="${m.id}" data-tid="${tournamentId}">
        <div class="match-card-grid">
          <div class="mc-meta">${dateLabel}</div>
          <div class="mc-player">${p1Name}</div>
          <div class="mc-livebox ${liveSet ? "is-live" : ""}">${
            liveP1 !== "" ? liveP1 : ""
          }</div>
          <div class="mc-setscore">${setsScore1}</div>

          <div class="mc-meta">
            <span class="pill ${statusClass}">${statusLabel}</span>
          </div>

          <div class="mc-player">${p2Name}</div>
          <div class="mc-livebox ${liveSet ? "is-live" : ""}">${
            liveP2 !== "" ? liveP2 : ""
          }</div>
          <div class="mc-setscore">${setsScore2}</div>
        </div>
      </div>
    `;
  });

  matchesContainer.innerHTML = matchesHtml;

  document.querySelectorAll("[data-mid]").forEach((el) => {
    el.addEventListener("click", () => {
      const mid = el.getAttribute("data-mid");
      const tid = el.getAttribute("data-tid");
      window.location.hash = `#/match/${mid}/${tid}`;
    });
  });

  // Standings (not used for Friendlies, but built for normal tournaments)
  if (!isFriendlies) {
    const standingsContainer = document.getElementById("tab-standings");
    const matchesById = {};
    matches.forEach((m) => (matchesById[m.id] = m));

    const playerStats = {};
    function ensurePlayer(id, name) {
      if (!playerStats[id]) {
        playerStats[id] = {
          id,
          name,
          played: 0,
          setsWon: 0,
          setsLost: 0,
          smallPoints: 0,
        };
      }
    }

    matches.forEach((m) => {
      if (!m.player1?.id || !m.player2?.id) return;
      if (m.status === "scheduled") return;
      ensurePlayer(m.player1.id, m.player1.name);
      ensurePlayer(m.player2.id, m.player2.name);
      playerStats[m.player1.id].played += 1;
      playerStats[m.player2.id].played += 1;
    });

    sets.forEach((s) => {
      if (!s.match_id || !s.winner_player_id) return;
      const m = matchesById[s.match_id];
      if (!m || !m.player1 || !m.player2) return;

      const p1Id = m.player1.id;
      const p2Id = m.player2.id;
      ensurePlayer(p1Id, m.player1.name);
      ensurePlayer(p2Id, m.player2.name);

      const winner = s.winner_player_id;
      const loser = winner === p1Id ? p2Id : p1Id;

      const winnerScore =
        winner === p1Id ? s.score_player1 : s.score_player2;
      const loserScore =
        winner === p1Id ? s.score_player2 : s.score_player1;

      playerStats[winner].setsWon += 1;
      playerStats[loser].setsLost += 1;
      playerStats[winner].smallPoints += winnerScore ?? 0;
      playerStats[loser].smallPoints += loserScore ?? 0;
    });

    const standingsArr = Object.values(playerStats);
    standingsArr.sort((a, b) => {
      if (b.setsWon !== a.setsWon) return b.setsWon - a.setsWon;
      if (b.smallPoints !== a.smallPoints)
        return b.smallPoints - a.smallPoints;
      return a.name.localeCompare(b.name);
    });

    let standingsHtml = "";
    standingsHtml += `<div class="standings-group-title">Group A</div>`;
    if (standingsArr.length === 0) {
      standingsHtml +=
        '<div class="empty-message">No results yet for standings.</div>';
    } else {
      standingsHtml += `
        <table class="standings-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>P</th>
              <th>SW</th>
              <th>SL</th>
              <th>SP</th>
            </tr>
          </thead>
          <tbody>
      `;
      standingsArr.forEach((p) => {
        standingsHtml += `
          <tr>
            <td>${p.name}</td>
            <td>${p.played}</td>
            <td>${p.setsWon}</td>
            <td>${p.setsLost}</td>
            <td>${p.smallPoints}</td>
          </tr>
        `;
      });
      standingsHtml += "</tbody></table>";
    }

    standingsContainer.innerHTML = standingsHtml;

    document.querySelectorAll(".tab-row .tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const tabId = tab.getAttribute("data-tab");
        document
          .querySelectorAll(".tab-row .tab")
          .forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        document.getElementById("tab-matches").style.display =
          tabId === "matches" ? "block" : "none";
        document.getElementById("tab-standings").style.display =
          tabId === "standings" ? "block" : "none";
      });
    });
  }
}

// =======================================================
// DATE BAR STATE
// =======================================================

let activeDateFilter = null; // yyyy-mm-dd or null

function isoDateOnly(iso) {
  if (!iso) return null;
  return iso.split("T")[0];
}

function isToday(dateStr) {
  const today = new Date().toISOString().split("T")[0];
  return dateStr === today;
}

function renderDateBar(matchDates, onSelect) {
  const bar = document.getElementById("date-bar");
  if (!bar) return;

  const today = new Date().toISOString().split("T")[0];
  const unique = Array.from(new Set(matchDates.filter(Boolean)));

  if (!unique.includes(today)) {
    unique.push(today);
  }

  unique.sort(); // chronological

  bar.innerHTML = unique
    .map((d) => {
      const label = new Date(d).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "2-digit",
        month: "short",
      });

      return `
        <div class="date-pill ${d === activeDateFilter ? "active" : ""}"
             data-date="${d}">
          <div>${label}</div>
          ${
            isToday(d)
              ? `<div class="date-sub">(Today)</div>`
              : ""
          }
        </div>
      `;
    })
    .join("");

  bar.querySelectorAll(".date-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      const d = pill.dataset.date;
      activeDateFilter = d === activeDateFilter ? null : d;
      onSelect(activeDateFilter);
    });
  });
}



// =======================================================
// LOAD MATCH DETAIL (shared for tournaments + friendlies)
// =======================================================

async function loadMatchDetail(matchId, tournamentId) {
  window.currentMatchId = matchId;
  window.currentTournamentId = tournamentId;
  window.lastSeenSet = null;

showBackButton(() => {
  window.location.hash = `#/tournament/${tournamentId}`;
});

  updateScoreButtonVisibility(true);
  setAddFriendlyVisible(false);

  showLoading("Loading match…");

  // --- Load match record ---
  const { data: match, error: matchError } = await supabase
    .from("matches")
    .select(`
      id,
      match_date,
      status,
      final_sets_player1,
      final_sets_player2,
      player1:player1_id ( id, name ),
      player2:player2_id ( id, name ),
      tournament:tournament_id ( id, name )
    `)
    .eq("id", matchId)
    .maybeSingle();

  if (matchError || !match) {
    console.error(matchError);
    showError("Failed to load match");
    return;
  }

  // --- Load sets ---
  const { data: sets, error: setsError } = await supabase
    .from("sets")
    .select("*")
    .eq("match_id", matchId)
    .order("set_number", { ascending: true });

  if (setsError) {
    console.error(setsError);
    showError("Failed to load sets");
    return;
  }

  // --- Load throws ---
  const { data: throws, error: throwsError } = await supabase
    .from("throws")
    .select("*")
    .eq("match_id", matchId)
    .order("set_number", { ascending: true })
    .order("throw_number", { ascending: true });

  if (throwsError) {
    console.error(throwsError);
    showError("Failed to load throws");
    return;
  }

  // Group throws by set_number for easy lookup later
  const throwsBySet = {};
  (throws || []).forEach((t) => {
    if (!throwsBySet[t.set_number]) throwsBySet[t.set_number] = [];
    throwsBySet[t.set_number].push(t);
  });

  const p1Name = match.player1?.name || "Player 1";
  const p2Name = match.player2?.name || "Player 2";
  const tournamentName = match.tournament?.name || "Tournament";

  // Status pill
  let pillClass = "scheduled";
  let pillLabel = "Scheduled";
  if (match.status === "live") {
    pillClass = "live";
    pillLabel = "Live";
  } else if (match.status === "finished") {
    pillClass = "finished";
    pillLabel = "Finished";
  }

  const overallSets = `${match.final_sets_player1 ?? 0} – ${
    match.final_sets_player2 ?? 0
  }`;

  // Determine live set (for header + throwstrip only)
  let currentSet = null;
  if (sets && sets.length > 0) {
    currentSet = sets.find(
      (s) =>
        !s.winner_player_id &&
        (s.score_player1 ?? 0) < 50 &&
        (s.score_player2 ?? 0) < 50
    );
  }

  const liveSP1 = currentSet ? currentSet.score_player1 ?? 0 : 0;
  const liveSP2 = currentSet ? currentSet.score_player2 ?? 0 : 0;

  // --- Render header + skeleton for sets ---
  const html = `
    <div class="card top-card">
      <div class="subtitle">${tournamentName}</div>

      <div class="top-score-row">
        <div class="top-player" style="text-align:right;">${p1Name}</div>
        <div class="top-score">${overallSets}</div>
        <div class="top-player" style="text-align:left;">${p2Name}</div>
      </div>

      <div class="live-throwstrip-row">
        <div class="live-throwstrip p1" id="header-throws-p1"></div>
        <div class="live-setscore" id="header-live-setscore">${liveSP1} – ${liveSP2}</div>
        <div class="live-throwstrip p2" id="header-throws-p2"></div>
      </div>

      <div class="match-small">
        ${formatDate(match.match_date)}
      </div>
      <div class="match-small">
        <span class="pill ${pillClass}">${pillLabel}</span>
      </div>
    </div>

    <div class="card" id="match-detail">
      <div class="tab-row">
        <div class="tab active" data-tab="sets">Sets</div>
      </div>
      <div id="tab-sets"></div>
    </div>
  `;

  setContent(html);

  // Keep scoring console in sync
  if (SUPERADMIN) {
    resetScoringStateForMatch(match, sets || []);
  }

  const setsContainer = document.getElementById("tab-sets");
  if (!sets || sets.length === 0) {
    setsContainer.innerHTML =
      '<div class="empty-message">No sets recorded for this match yet.</div>';
    return;
  }

  // --- Build the sets list with EMPTY expanded panels ---
  let setsHtml = `<div class="sets-wrapper">`;
  let cumSetP1 = 0;
  let cumSetP2 = 0;

  sets.forEach((s) => {
    const setNum = s.set_number;
    const p1Score = s.score_player1;
    const p2Score = s.score_player2;

    const p1Win = p1Score === 50 && p2Score < 50;
    const p2Win = p2Score === 50 && p1Score < 50;

    if (p1Win) cumSetP1++;
    if (p2Win) cumSetP2++;

    const cumDisplay = `${cumSetP1}–${cumSetP2}`;

    setsHtml += `
      <div class="set-block" data-set="${setNum}">
        <div class="set-main-row" data-set="${setNum}">
          <div class="col left ${p1Win ? "winner" : ""}">${p1Score}</div>
          <div class="col mid">${cumDisplay}</div>
          <div class="col right ${p2Win ? "winner" : ""}">${p2Score}</div>
        </div>
        <div class="set-throws-expanded" data-set="${setNum}" style="display:none;"></div>
      </div>
    `;
  });

  setsHtml += `</div>`;
  setsContainer.innerHTML = setsHtml;

  // --- Click handler: lazily build the throws table on expand ---
  document.querySelectorAll(".set-main-row").forEach((row) => {
    row.addEventListener("click", () => {
      const setNum = Number(row.getAttribute("data-set"));
      const expanded = document.querySelector(
        `.set-throws-expanded[data-set="${setNum}"]`
      );
      if (!expanded) return;

      const isOpen = expanded.style.display === "block";

      // Close all others
      document.querySelectorAll(".set-throws-expanded").forEach((el) => {
        el.style.display = "none";
      });

      if (isOpen) {
        // Already open → now closed
        expanded.style.display = "none";
        return;
      }

      // Build model from raw throws for THIS set
      const raw = throwsBySet[setNum] || [];
      const model = buildThrowsModel(
        raw,
        match.player1?.id,
        match.player2?.id
      );

      expanded.innerHTML = model.length
        ? buildThrowsTableHTML(model, p1Name, p2Name)
        : '<div class="empty-message">No throw history for this set.</div>';

      expanded.style.display = "block";
    });
  });

  // Score button opens scoring console
  if (scoreBtn) {
    scoreBtn.onclick = openScoringConsole;
  }

  // Ensure header live set score stays in sync
  const headerSetScoreEl = document.getElementById("header-live-setscore");
  if (headerSetScoreEl) {
    headerSetScoreEl.textContent = `${liveSP1} – ${liveSP2}`;
  }

  // Only the live set drives the header throwstrip
  if (currentSet) {
    updateLiveThrowsForSet(currentSet.set_number);
  }
}


// =======================================================
// INITIAL LOAD
// =======================================================

handleRoute();