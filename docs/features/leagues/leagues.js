// =============================================
// Leagues / countries menu
// =============================================

window.App = window.App || {};
App.Features = App.Features || {};
App.Features.Leagues = App.Features.Leagues || {};

App.Features.Leagues.loadLeaguesMenu = async function () {
  console.log("[leagues] loading leagues menu");

  // Clear global context
  window.currentMatchId = null;
  window.currentTournamentId = null;
  window.matchDetailContext = null;

  App.Utils.DOM.showLoading("Loading tournaments…");

  const { data, error } = await window.supabaseClient
    .from("tournaments")
    .select("id, name, country, type")
    .neq("id", FRIENDLIES_TOURNAMENT_ID)
    .order("name", { ascending: true });

  if (error || !data) {
    console.error(error);
    App.Utils.DOM.showError("Failed to load tournaments");
    return;
  }

  // Group by country
  const countries = {};
  data.forEach((t) => {
    const country = t.country || "World";
    if (!countries[country]) countries[country] = [];
    countries[country].push(t);
  });

  App.Features.Leagues.renderCountriesView(countries);
};

App.Features.Leagues.renderCountriesView = function (countries) {
  const html = `
    <div class="section-title">Tournaments</div>

    <div id="countries-view">
      ${Object.keys(countries)
        .sort()
        .map(
          (country) => `
            <div class="card clickable country-card"
                 data-country="${country}">
              ${country}
            </div>
          `
        )
        .join("")}
    </div>

    <div id="country-tournaments-view" class="hidden"></div>
  `;

  App.Utils.DOM.setContent(html);

  document.querySelectorAll(".country-card").forEach((card) => {
    card.addEventListener("click", () => {
      const country = card.dataset.country;
      App.Features.Leagues.renderCountryTournaments(
        country,
        countries[country],
        countries
      );
    });
  });
};

App.Features.Leagues.renderCountryTournaments = function (
  country,
  tournaments
) {
  const container = document.getElementById("country-tournaments-view");
  const countriesView = document.getElementById("countries-view");

  if (!container || !countriesView) return;

  const formal = tournaments
    .filter((t) => t.type === "formal")
    .sort((a, b) => a.name.localeCompare(b.name));

  const casual = tournaments
    .filter((t) => t.type === "casual")
    .sort((a, b) => a.name.localeCompare(b.name));

  countriesView.classList.add("hidden");
  container.classList.remove("hidden");

  container.innerHTML = `
    <div class="menu-back">
      <button class="text-btn" id="back-to-countries">← All countries</button>
    </div>

    <div class="section-title">${country}</div>

    ${formal.map(App.Features.Leagues.tournamentCardHTML).join("")}
    ${casual.map(App.Features.Leagues.tournamentCardHTML).join("")}
  `;

  document.getElementById("back-to-countries").onclick = () => {
    container.classList.add("hidden");
    countriesView.classList.remove("hidden");
  };

  App.Features.Leagues.bindTournamentLinks();
};

App.Features.Leagues.tournamentCardHTML = function (t) {
  return `
    <div class="card clickable tournament-card" data-tid="${t.id}">
      ${t.name}
    </div>
  `;
};

App.Features.Leagues.bindTournamentLinks = function () {
  document.querySelectorAll(".tournament-card").forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.dataset.tid;
      if (!id) return;

      window.location.hash =
        `#/tournament/${id}?tab=standings`;
    });
  });
};
