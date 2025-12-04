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

// --------------------------------------------
// BUILD THROW MODELS
// --------------------------------------------

function buildThrowsModel(throws, player1Id, player2Id) {
  let cumP1 = 0;
  let cumP2 = 0;
  const model = [];

  (throws || []).forEach((t) => {
    const isP1 = t.player_id === player1Id;
    const raw = t.score ?? 0;
    const miss = raw === 0;
    let displayScore = "";
    let bust = false;

    if (miss) {
      displayScore = "X";
    } else {
      let tentativeP1 = cumP1;
      let tentativeP2 = cumP2;
      if (isP1) tentativeP1 += raw;
      else tentativeP2 += raw;
      bust =
        (isP1 && tentativeP1 > 50) || (!isP1 && tentativeP2 > 50);

      if (bust) {
        displayScore = raw + "↓";
        if (isP1) cumP1 = 25;
        else cumP2 = 25;
      } else {
        displayScore = raw;
        if (isP1) cumP1 = tentativeP1;
        else cumP2 = tentativeP2;
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

// ==================================================================
// REALTIME LISTENER — smooth updates (no full view refresh)
// ==================================================================

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

// ======================================================================
// REALTIME: UPDATE MATCH LIST VIEW (tab-matches) LIVE
// ======================================================================

const setsChannelMatchList = supabase
  .channel("sets-realtime-matchlist")
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "sets"
    },
    (payload) => {
      const updated = payload.new;
      if (!updated) return;

      const matchId = updated.match_id;
      const p1 = updated.score_player1 ?? "";
      const p2 = updated.score_player2 ?? "";
      const setNumber = updated.set_number;

      // ONLY update if user is currently on the tournament view page
      const matchesTab = document.getElementById("tab-matches");
      if (!matchesTab || matchesTab.style.display === "none") return;

      // Find the match-card for this match
      const card = document.querySelector(`.card[data-mid="${matchId}"]`);
      if (!card) return;

      // Find the live small-score boxes inside the match card
      const liveBoxes = card.querySelectorAll(".mc-livebox");

      if (liveBoxes.length === 2) {
        liveBoxes[0].textContent = p1;
        liveBoxes[1].textContent = p2;

        if (p1 !== "" || p2 !== "") {
          liveBoxes[0].classList.add("is-live");
          liveBoxes[1].classList.add("is-live");
        }
      }

      // Update overall set score if a set is won
      if (updated.winner_player_id) {
        const p1SetCell = card.querySelectorAll(".mc-setscore")[0];
        const p2SetCell = card.querySelectorAll(".mc-setscore")[1];

        const isP1Winner = updated.winner_player_id === card.dataset.player1Id;
        const isP2Winner = updated.winner_player_id === card.dataset.player2Id;

        // But better: fetch latest match summary
        updateMatchListFinalScore(matchId, card);
      }
    }
  )
  .subscribe();


// ==================================================================
// SMOOTH UPDATE FOR LIVE MATCH DETAILS (NO FORCED NAVIGATION)
// ==================================================================
async function smoothUpdateSetRow(updatedSet) {
  const setNumber = updatedSet.set_number;
  if (!setNumber) return;

  // Are we on the Match Detail page?
  const onMatchDetailPage = document.querySelector(".top-card") !== null;

  // Try to find the existing row for this set
  const block = document.querySelector(`.set-block[data-set="${setNumber}"]`);

  // ----------------------------------------------------------
  // CASE 1 — A NEW SET EXISTS IN DB BUT UI HASN’T DRAWN IT YET
  // ----------------------------------------------------------
  if (!block) {
    // Only reload the match detail if the user is actually viewing it
    if (onMatchDetailPage) {
      // Only reload ONCE per new set
      if (!window.lastSeenSet || setNumber > window.lastSeenSet) {
        window.lastSeenSet = setNumber;
        loadMatchDetail(window.currentMatchId, window.currentTournamentId);
      }
    }
    return;
  }

  // From here on, we KNOW the user is on match detail and the block exists.
  const mainRow = block.querySelector('.set-main-row');
  if (!mainRow) return;

  const leftCell = mainRow.querySelector('.col.left');
  const rightCell = mainRow.querySelector('.col.right');

  // Update small points
  if (leftCell) leftCell.textContent = updatedSet.score_player1 ?? "";
  if (rightCell) rightCell.textContent = updatedSet.score_player2 ?? "";

  // Winner highlight
  if (updatedSet.winner_player_id && window.scoringMatch) {
    const p1Id = window.scoringMatch.p1Id;
    const p2Id = window.scoringMatch.p2Id;

    leftCell?.classList.remove("winner");
    rightCell?.classList.remove("winner");

    if (updatedSet.winner_player_id === p1Id) leftCell?.classList.add("winner");
    if (updatedSet.winner_player_id === p2Id) rightCell?.classList.add("winner");
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

  // Update overall match score when set is won
  if (updatedSet.winner_player_id) {
    await updateOverallMatchScore();
  }
}

// ==================================================================
// UPDATE OVERALL MATCH SCORE WHEN A SET IS WON
// ==================================================================

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
      (match.final_sets_player1 ?? 0) + " – " + (match.final_sets_player2 ?? 0);
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


// --------------------------------------------
// BUILD THROWS TABLE HTML
// --------------------------------------------

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

    // 🔒 SAFETY: coerce to string before .includes
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

// --------------------------------------------
// LOAD TOURNAMENTS
// --------------------------------------------

async function loadTournaments() {
  window.currentMatchId = null;
  window.currentTournamentId = null;
  window.lastSeenSet = null;

  showBackButton(null);
  updateScoreButtonVisibility(false);
  showLoading("Loading tournaments…");

  const { data, error } = await supabase
    .from("tournaments")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) {
    console.error(error);
    showError("Failed to load tournaments");
    return;
  }

  if (!data || data.length === 0) {
    setContent(
      '<div class="card"><div class="empty-message">No tournaments found.</div></div>'
    );
    return;
  }

  let html = '<div class="section-title">Tournaments</div>';

  data.forEach((t) => {
    const name = t.name || "Tournament " + t.id.slice(0, 8);
    html += `
      <div class="card clickable" data-tid="${t.id}">
        <div class="title-row">
          <div class="title">${name}</div>
        </div>
      </div>
    `;
  });

  setContent(html);

  document.querySelectorAll("[data-tid]").forEach((el) => {
    el.addEventListener("click", () => {
      const tid = el.getAttribute("data-tid");
      // navigate via URL
      window.location.hash = `#/tournament/${tid}`;
    });
  });
}

// --------------------------------------------
// LOAD TOURNAMENT VIEW
// --------------------------------------------

async function loadTournamentView(tournamentId) {
  // Leaving match-detail: clear realtime match context
  window.currentMatchId = null;
  window.currentTournamentId = null;
  window.lastSeenSet = null;

  showBackButton(() => {
    window.location.hash = "#/tournaments";
  });
  updateScoreButtonVisibility(false);
  showLoading("Loading tournament…");

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

  const tournamentName = matches[0].tournament?.name || "Tournament";
  const matchIds = matches.map((m) => m.id);

  let sets = [];
  if (matchIds.length > 0) {
    const { data: setsData, error: setsError } = await supabase
      .from("sets")
      .select("id, match_id, set_number, score_player1, score_player2, winner_player_id")
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
          <div class="mc-livebox ${liveSet ? "is-live" : ""}">${liveP1 !== "" ? liveP1 : ""}</div>
          <div class="mc-setscore">${setsScore1}</div>

          <div class="mc-meta">
            <span class="pill ${statusClass}">${statusLabel}</span>
          </div>

          <div class="mc-player">${p2Name}</div>
          <div class="mc-livebox ${liveSet ? "is-live" : ""}">${liveP2 !== "" ? liveP2 : ""}</div>
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
      // navigate via URL
      window.location.hash = `#/match/${mid}/${tid}`;
    });
  });

  // --------------------------------------------
  // BUILD STANDINGS
  // --------------------------------------------

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

  // tabs
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

// --------------------------------------------
// LOAD MATCH DETAIL
// --------------------------------------------

async function loadMatchDetail(matchId, tournamentId) {
  window.currentMatchId = matchId;
  window.currentTournamentId = tournamentId;
  showBackButton(() => {
    window.location.hash = `#/tournament/${tournamentId}`;
  });
  updateScoreButtonVisibility(true);
  showLoading("Loading match…");

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

  const throwsBySet = {};
  (throws || []).forEach((t) => {
    if (!throwsBySet[t.set_number]) throwsBySet[t.set_number] = [];
    throwsBySet[t.set_number].push(t);
  });

  const p1Name = match.player1?.name || "Player 1";
  const p2Name = match.player2?.name || "Player 2";
  const tournamentName = match.tournament?.name || "Tournament";

  const status = match.status || "scheduled";
  let pillClass = "scheduled";
  let pillLabel = "Scheduled";

  if (status === "live") {
    pillClass = "live";
    pillLabel = "Live";
  } else if (status === "finished") {
    pillClass = "finished";
    pillLabel = "Finished";
  }

  const overallSets =
    (match.final_sets_player1 ?? 0) +
    " – " +
    (match.final_sets_player2 ?? 0);

  let html = `
    <div class="card top-card">
      <div class="subtitle">${tournamentName}</div>
      <div class="top-score-row">
        <div class="top-player" style="text-align:right;">${p1Name}</div>
        <div class="top-score">${overallSets}</div>
        <div class="top-player" style="text-align:left;">${p2Name}</div>
      </div>
      <div class="match-small">
        ${formatDate(match.match_date)}
      </div>
      <div class="match-small">
        <span class="pill ${pillClass}">${pillLabel}</span>
      </div>
    </div>

    <div class="card">
      <div class="tab-row">
        <div class="tab active" data-tab="sets">Sets</div>
      </div>
      <div id="tab-sets"></div>
    </div>
  `;

  setContent(html);

  if (SUPERADMIN) {
    resetScoringStateForMatch(match, sets || []);
  }

  const setsContainer = document.getElementById("tab-sets");

  if (!sets || sets.length === 0) {
    setsContainer.innerHTML =
      '<div class="empty-message">No sets recorded for this match yet.</div>';
    return;
  }

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

    const cumDisplay = cumSetP1 + "–" + cumSetP2;

    const setThrowsRaw = throwsBySet[setNum] || [];
    const model = buildThrowsModel(
      setThrowsRaw,
      match.player1?.id,
      match.player2?.id
    );
    const hasThrows = model.length > 0;

    const p1Throws = model
      .filter((m) => m.isP1)
      .map((m) => m.displayScore);
    const p2Throws = model
      .filter((m) => !m.isP1)
      .map((m) => m.displayScore);

    const maxPreview = 6;
    const p1Preview = p1Throws.slice(-maxPreview);
    const p2Preview = p2Throws.slice(-maxPreview);

    // 🔒 SAFETY: coerce preview values to string before .includes
    const previewRow = hasThrows
      ? `
        <div class="set-preview-row" data-set="${setNum}">
          <div class="col left">
            <div class="throws-mini p1">
              ${p1Preview
                .map((v) => {
                  const vStr = String(v ?? "");
                  let cls = "throw-box";
                  if (vStr.includes("X")) cls += " miss";
                  else if (vStr.includes("↓")) cls += " reset";
                  return `<div class="${cls}">${vStr}</div>`;
                })
                .join("")}
            </div>
          </div>
          <div class="col mid"></div>
          <div class="col right">
            <div class="throws-mini p2">
              ${p2Preview
                .map((v) => {
                  const vStr = String(v ?? "");
                  let cls = "throw-box";
                  if (vStr.includes("X")) cls += " miss";
                  else if (vStr.includes("↓")) cls += " reset";
                  return `<div class="${cls}">${vStr}</div>`;
                })
                .join("")}
            </div>
          </div>
        </div>
      `
      : "";

    const expandedHtml = hasThrows
      ? `
        <div class="set-throws-expanded" data-set="${setNum}">
          ${buildThrowsTableHTML(model, p1Name, p2Name)}
        </div>
      `
      : "";

    setsHtml += `
      <div class="set-block" data-set="${setNum}">
        <div class="set-main-row" data-set="${setNum}">
          <div class="col left ${p1Win ? "winner" : ""}">${p1Score}</div>
          <div class="col mid">${cumDisplay}</div>
          <div class="col right ${p2Win ? "winner" : ""}">${p2Score}</div>
        </div>
        ${previewRow}
        ${expandedHtml}
      </div>
    `;
  });

  setsHtml += `</div>`;
  setsContainer.innerHTML = setsHtml;

  scoreBtn.addEventListener("click", openScoringConsole);

  document.querySelectorAll(".set-main-row").forEach((row) => {
    row.addEventListener("click", () => {
      const setNum = row.getAttribute("data-set");
      const expanded = document.querySelector(
        '.set-throws-expanded[data-set="' + setNum + '"]'
      );
      const preview = document.querySelector(
        '.set-preview-row[data-set="' + setNum + '"]'
      );
      if (!expanded) return;
      const isOpen = expanded.style.display === "block";
      if (isOpen) {
        expanded.style.display = "none";
        if (preview) preview.style.display = "grid";
      } else {
        expanded.style.display = "block";
        if (preview) preview.style.display = "none";
      }
    });
  });

// periodically refresh lock status for this match
if (window.lockRefreshTimer) clearInterval(window.lockRefreshTimer);

window.lockRefreshTimer = setInterval(() => {
  refreshScoreButtonLock(matchId);
}, 3000);
}

// --------------------------------------------
// INITIAL LOAD
// --------------------------------------------

handleRoute();
