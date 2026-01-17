// =============================================
// Date bar (home & tournament)
// =============================================

// file:// safe
// No imports
// No exports

let dateBarHasForcedInitial = false;

function clampDatesAroundToday(dates, radius = 5) {
  if (!dates || dates.length === 0) return [];

  const sorted = [...dates].sort();
  const todayStr = new Date().toISOString().split("T")[0];

  let centerIndex = sorted.findIndex(d => d >= todayStr);
  if (centerIndex === -1) {
    centerIndex = sorted.length - 1;
  }

  const start = Math.max(0, centerIndex - radius);
  const end   = Math.min(sorted.length - 1, centerIndex + radius);

  return sorted.slice(start, end + 1);
}

function renderDateBar(rawDates, onSelect) {
  const bar = document.getElementById("date-bar");
  if (!bar) return;

  const today = new Date().toISOString().split("T")[0];

  const unique = Array.from(new Set((rawDates || []).filter(Boolean)));
  if (!unique.includes(today)) unique.push(today);

  const displayDates = clampDatesAroundToday(unique, 5);

  // ✅ SINGLE SOURCE OF TRUTH: URL
  const params = new URLSearchParams(window.location.search);
  const urlDate = params.get("date");

  const activeDate =
    (urlDate && displayDates.includes(urlDate))
      ? urlDate
      : today;

  bar.innerHTML = displayDates.map(d => {
    const label = new Date(d).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    });

    return `
      <div class="date-pill ${d === activeDate ? "active" : ""}" data-date="${d}">
        <div>${label}</div>
        ${d === today ? '<div class="date-sub">(Today)</div>' : ""}
      </div>
    `;
  }).join("");

	bar.querySelectorAll(".date-pill").forEach(pill => {
	  pill.addEventListener("click", () => {
		const d = pill.dataset.date;
		if (!d) return;

		// Update URL (persistence only)
		const url = new URL(window.location.href);
		url.searchParams.set("date", d);
		history.replaceState(null, "", url.toString());

		// Update visual state immediately
		bar.querySelectorAll(".date-pill").forEach(p =>
		  p.classList.toggle("active", p === pill)
		);
		
		window.tournamentContext = window.tournamentContext || {};
		window.tournamentContext.selectedDate =
		new Date(d + "T00:00:00").toISOString();
		window.tournamentContext.activeTab =
		window.tournamentContext.activeTab || "daily";

		onSelect?.(d);
	  });
	});

  // Initial render
	window.tournamentContext = window.tournamentContext || {};
	window.tournamentContext.selectedDate =
		new Date(activeDate + "T00:00:00").toISOString();
	window.tournamentContext.activeTab =
		window.tournamentContext.activeTab || "daily";

	onSelect?.(activeDate);
}

function setupHomeDateBar(allDates, dateToTournamentIds) {
  const filteredDates = (allDates || []).filter(Boolean);

  renderDateBar(filteredDates, (selectedDate) => {
    const allowedSet = dateToTournamentIds[selectedDate] || new Set();

    document.querySelectorAll("[data-tid]").forEach(card => {
      const tid = card.getAttribute("data-tid");
      if (!tid) return;

      const isFriendlies =
        typeof window.FRIENDLIES_TOURNAMENT_ID !== "undefined" &&
        tid === window.FRIENDLIES_TOURNAMENT_ID;

      const isToday =
        selectedDate === new Date().toISOString().split("T")[0];

      if (isFriendlies && isToday) {
        card.style.display = "";
        return;
      }

      card.style.display = allowedSet.has(tid) ? "" : "none";
    });
  });
}

function setupTournamentDateBar(matches) {
  const bar = document.getElementById("date-bar");
  if (!bar) return;

  const isFriendlies =
    window.currentTournamentId === FRIENDLIES_TOURNAMENT_ID;

  const playableMatches = (matches || []).filter(
    m =>
      m.match_date &&
      m.player1?.id &&
      m.player2?.id &&
      m.status !== "structure"
  );

  const dates = Array.from(
    new Set(playableMatches.map(m => isoDateOnly(m.match_date)))
  );

  renderDateBar(dates, (selectedDate) => {
    updateDailyTabLabel(selectedDate);
	  });
}

// Expose globals explicitly (safety)
window.renderDateBar = renderDateBar;
window.setupHomeDateBar = setupHomeDateBar;
window.setupTournamentDateBar = setupTournamentDateBar;
