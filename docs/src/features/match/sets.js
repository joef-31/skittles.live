// =======================================================
// MATCH SETS RENDERING + EXPANSION
// =======================================================

window.App = window.App || {};
App.Features = App.Features || {};
App.Features.Match = App.Features.Match || {};

App.Features.Match.renderMatchSets = function (
  sets,
  throwsBySet,
  p1Id,
  p2Id,
  p1Name,
  p2Name
) {
	
  const container = document.getElementById("tab-sets");

  if (!container) {
    console.error("[renderMatchSets] #tab-sets not found");
    return;
  }
  
    container.style.display = "block";

  if (!Array.isArray(sets) || sets.length === 0) {
    container.innerHTML =
      '<div class="empty-message">No sets recorded for this match yet.</div>';
    return;
  }

  let html = `<div class="sets-wrapper">`;

  let cumP1 = 0;
  let cumP2 = 0;

  sets.forEach((s) => {
    const setNum = s.set_number;
    const p1Score = s.score_player1 ?? "";
    const p2Score = s.score_player2 ?? "";

    const p1Win = s.winner_player_id === p1Id;
    const p2Win = s.winner_player_id === p2Id;

    if (p1Win) cumP1++;
    if (p2Win) cumP2++;

    html += `
      <div class="set-block" data-set="${setNum}">
        <div class="set-main-row" data-set="${setNum}">
          <div class="col left ${p1Win ? "winner" : ""}">${p1Score}</div>
          <div class="col mid">${cumP1}–${cumP2}</div>
          <div class="col right ${p2Win ? "winner" : ""}">${p2Score}</div>
        </div>
        <div class="set-throws-expanded" data-set="${setNum}" style="display:none;"></div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;

  // Expand handler
  container.querySelectorAll(".set-main-row").forEach((row) => {
    row.addEventListener("click", () => {
      const setNum = Number(row.dataset.set);
      const expanded = container.querySelector(
        `.set-throws-expanded[data-set="${setNum}"]`
      );
      if (!expanded) return;

      const isOpen = expanded.style.display === "block";

      container
        .querySelectorAll(".set-throws-expanded")
        .forEach((el) => (el.style.display = "none"));

      if (isOpen) return;

      const raw = throwsBySet[setNum] || [];
      const model = buildThrowsModel(raw, p1Id, p2Id);

      expanded.innerHTML = model.length
        ? App.Features.Match.buildThrowsTableHTML(model, p1Name, p2Name)
        : '<div class="empty-message">No throw history for this set.</div>';

      expanded.style.display = "block";
    });
  });
}

async function smoothUpdateSetRow(updatedSet) {
    const setNumber = updatedSet.set_number;
    if (!setNumber) return;

    const onMatchDetailPage =
        document.querySelector(".top-card") !== null;

    const block = document.querySelector(
        `.set-block[data-set="${setNumber}"]`
    );

	if (!block) {
	  if (onMatchDetailPage) {
		if (!window.lastSeenSet || setNumber > window.lastSeenSet) {
		  window.lastSeenSet = setNumber;

		  // Re-render match detail safely using current globals
		  if (App?.Features?.Match?.renderMatchDetail) {
			App.Features.Match.renderMatchDetail(
			  window.currentMatchId,
			  window.currentTournamentId
			);
		  }
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
        scoringCurrentThrower =
            updatedSet.current_thrower || "p1";

        if (window.scoringMatch) {
            const name =
                scoringCurrentThrower === "p1"
                    ? window.scoringMatch.p1Name
                    : window.scoringMatch.p2Name;

            const label = document.getElementById(
                "scoring-current-thrower-label"
            );
            if (label) label.textContent = `${name} to throw`;
        }
    }

    // Update live set score in header
    const headerSetScore = document.getElementById(
        "header-live-setscore"
    );
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

    const { data: match, error } = await window.supabaseClient
        .from("matches")
        .select("final_sets_player1, final_sets_player2")
        .eq("id", window.currentMatchId)
        .maybeSingle();

    if (error || !match) return;

    const headerScore =
        document.querySelector(".top-card .top-score");

    if (headerScore) {
        headerScore.textContent =
            `${match.final_sets_player1 ?? 0} – ${match.final_sets_player2 ?? 0}`;
    }
}

async function updateMatchListFinalScore(matchId, card) {
    const { data: match, error } = await window.supabaseClient
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

function applyLiveSetScoresToCards() {
  if (!window.latestLiveSets) return;

  Object.entries(window.latestLiveSets).forEach(([matchId, scores]) => {
    const cards = document.querySelectorAll(`.card[data-mid="${matchId}"]`);
    if (!cards.length) return;

    cards.forEach(card => {
      const liveBoxes = card.querySelectorAll(".mc-livebox");
      if (liveBoxes.length !== 2) return;

      liveBoxes[0].textContent = scores.p1;
      liveBoxes[1].textContent = scores.p2;

      const isLive = scores.p1 !== "" || scores.p2 !== "";
      liveBoxes[0].classList.toggle("is-live", isLive);
      liveBoxes[1].classList.toggle("is-live", isLive);
    });
  });
}

window.loadInitialLiveSetScores = async function (matchIds) {
  if (!Array.isArray(matchIds) || matchIds.length === 0) return;

  const { data, error } = await window.supabaseClient
    .from("sets")
    .select("match_id, score_player1, score_player2, winner_player_id")
    .in("match_id", matchIds)
    .is("winner_player_id", null); // only live sets

  if (error || !data) return;

  window.latestLiveSets = {};

  data.forEach(s => {
    window.latestLiveSets[s.match_id] = {
      p1: s.score_player1 ?? "",
      p2: s.score_player2 ?? ""
    };
  });

  applyLiveSetScoresToCards();
}

window.initSetsMatchListRealtime = function initSetsMatchListRealtime() {
  if (!window.supabaseClient) {
    console.warn("[sets] supabaseClient not ready; matchlist realtime not started");
    return;
  }

  // prevent double-subscribe
  if (window._setsChannelMatchListStarted) return;
  window._setsChannelMatchListStarted = true;

  window.supabaseClient
    .channel("sets-realtime-matchlist")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "sets" },
      (payload) => {
        window.latestLiveSets ??= {};
        const updated = payload.new;
        if (!updated) return;

        const matchId = updated.match_id;
        const p1 = updated.score_player1 ?? "";
        const p2 = updated.score_player2 ?? "";

        window.latestLiveSets[matchId] = { p1, p2 };

        // Update cards
        const cards = document.querySelectorAll(`.card[data-mid="${matchId}"]`);
        cards.forEach((card) => {
          const liveBoxes = card.querySelectorAll(".mc-livebox");
          if (liveBoxes.length !== 2) return;

          liveBoxes[0].textContent = p1;
          liveBoxes[1].textContent = p2;

          const isLive = p1 !== "" || p2 !== "";
          liveBoxes[0].classList.toggle("is-live", isLive);
          liveBoxes[1].classList.toggle("is-live", isLive);

          if (updated.winner_player_id) {
            updateMatchListFinalScore(matchId, card);
          }
        });

        applyLiveSetScoresToCards();
      }
    )
    .subscribe();
};
