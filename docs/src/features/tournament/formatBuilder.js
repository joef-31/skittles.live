// =======================================================
// TOURNAMENT FORMAT BUILDER
// New admin layer for group advancement + bracket rounds
// Does not touch scoring, sets, throws, or live match logic
// =======================================================

window.App = window.App || {};
App.Features = App.Features || {};
App.Features.Tournament = App.Features.Tournament || {};
App.Features.Tournament.FormatBuilder =
  App.Features.Tournament.FormatBuilder || {};

App.Features.Tournament.FormatBuilder.render = function ({
  tournamentId,
  editionId,
  container
}) {
  if (!container || !editionId) return;

  container.innerHTML = `
    <div class="card">
      <div class="section-title">Tournament format builder</div>

      <div class="subtitle" style="margin-bottom:10px;">
        Define where group positions advance, then create knockout rounds from those entries.
      </div>

      <div class="format-builder-tabs">
        <button class="format-builder-tab active" data-fb-tab="groups">
          Group advancement
        </button>
        <button class="format-builder-tab" data-fb-tab="rounds">
          Knockout rounds
        </button>
        <button class="format-builder-tab" data-fb-tab="generate">
          Generate structure
        </button>
      </div>

      <div id="fb-panel-groups" class="format-builder-panel active"></div>
      <div id="fb-panel-rounds" class="format-builder-panel"></div>
      <div id="fb-panel-generate" class="format-builder-panel"></div>
    </div>
  `;

	App.Features.Tournament.FormatBuilder.wireTabs(container);
	App.Features.Tournament.FormatBuilder.renderGroupAdvancement({
		editionId,
		container: container.querySelector("#fb-panel-groups")
	});
	App.Features.Tournament.FormatBuilder.renderRounds({
		editionId,
		container: container.querySelector("#fb-panel-rounds")
	});
	App.Features.Tournament.FormatBuilder.renderGenerate({
		tournamentId,
		editionId,
		container: container.querySelector("#fb-panel-generate")
	});
};

App.Features.Tournament.FormatBuilder.wireTabs = function (container) {
  container.querySelectorAll(".format-builder-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.fbTab;

      container.querySelectorAll(".format-builder-tab").forEach(b => {
        b.classList.toggle("active", b === btn);
      });

      container.querySelectorAll(".format-builder-panel").forEach(panel => {
        panel.classList.toggle(
          "active",
          panel.id === `fb-panel-${tab}`
        );
      });
    });
  });
};

App.Features.Tournament.FormatBuilder.renderGroupAdvancement = async function ({
  editionId,
  container
}) {
  if (!container) return;

  let groupSize = 6;
  let stageIds = [];

  const { data: stages, error: stagesError } = await window.supabaseClient
    .from("stages")
    .select("id, stage_type")
    .eq("edition_id", editionId);

  if (stagesError) {
    console.error("[format builder] stages lookup failed", stagesError);
  }

  if (!stagesError && stages?.length) {
    stageIds = stages
      .filter(s => {
        const type = String(s.stage_type || "").toLowerCase();
        return type.includes("group");
      })
      .map(s => s.id);

    console.log("[format builder] group stage ids", stageIds);
  }

  if (stageIds.length) {
    const { data: structureMatches, error: matchesError } =
      await window.supabaseClient
        .from("matches")
        .select(`
          id,
          stage_id,
          group_id,
          player1_id,
          player2_id,
          team1_id,
          team2_id
        `)
        .in("stage_id", stageIds)
        .eq("status", "structure")
        .not("group_id", "is", null);

    if (matchesError) {
      console.error("[format builder] structure matches lookup failed", matchesError);
    } else {
      const competitorsByGroup = {};

      (structureMatches || []).forEach(match => {
        if (!match.group_id) return;

        competitorsByGroup[match.group_id] =
          competitorsByGroup[match.group_id] || new Set();

        if (match.player1_id) {
          competitorsByGroup[match.group_id].add(`player:${match.player1_id}`);
        }

        if (match.player2_id) {
          competitorsByGroup[match.group_id].add(`player:${match.player2_id}`);
        }

        if (match.team1_id) {
          competitorsByGroup[match.group_id].add(`team:${match.team1_id}`);
        }

        if (match.team2_id) {
          competitorsByGroup[match.group_id].add(`team:${match.team2_id}`);
        }
      });

      const groupSizes = Object.fromEntries(
        Object.entries(competitorsByGroup).map(([groupId, competitors]) => [
          groupId,
          competitors.size
        ])
      );

      const derived = Math.max(0, ...Object.values(groupSizes));

      console.log("[format builder] group sizes from structure matches", groupSizes);

      if (derived > 0) {
        groupSize = derived;
      }
    }
  }
  
  let advancementByPosition = {};

	if (stageIds.length) {
	  const { data: rules, error: rulesError } = await window.supabaseClient
		.from("advancement_rules")
		.select(`
		  id,
		  source_stage_id,
		  condition,
		  position,
		  target_stage_id,
		  target_group_id,
		  description,
		  layer
		`)
		.in("source_stage_id", stageIds)
		.order("layer", { ascending: true });

	  if (rulesError) {
		console.error("[format builder] advancement rules lookup failed", rulesError);
	  } else {
		const targetStageIds = [
		  ...new Set((rules || []).map(r => r.target_stage_id).filter(Boolean))
		];

		const targetGroupIds = [
		  ...new Set((rules || []).map(r => r.target_group_id).filter(Boolean))
		];

		const { data: targetStages } = targetStageIds.length
		  ? await window.supabaseClient
			  .from("stages")
			  .select("id,name,bracket_id")
			  .in("id", targetStageIds)
		  : { data: [] };

		const { data: targetGroups } = targetGroupIds.length
		  ? await window.supabaseClient
			  .from("groups")
			  .select("id,name")
			  .in("id", targetGroupIds)
		  : { data: [] };

		const stageById = Object.fromEntries(
		  (targetStages || []).map(s => [s.id, s])
		);

		const groupById = Object.fromEntries(
		  (targetGroups || []).map(g => [g.id, g])
		);

		(rules || []).forEach(rule => {
		  let pos = null;

		  if (rule.condition === "winner") pos = 1;
		  if (rule.condition === "runner_up") pos = 2;
		  if (rule.condition === "nth_place") pos = Number(rule.position);

		  if (!pos) return;

		const targetStage = stageById[rule.target_stage_id];
		const targetGroup = groupById[rule.target_group_id];

		advancementByPosition[pos] = {
		  bracketName: targetStage?.name || "",
		  roundName: targetGroup?.name || rule.description || ""
		};
		});

		console.log("[format builder] advancement by position", advancementByPosition);
	  }
	}

  const positions = Array.from(
    { length: groupSize },
    (_, i) => i + 1
  );

  container.innerHTML = `
    <div class="section-title">Group advancement</div>

    <div class="subtitle" style="margin-bottom:8px;">
      Based on ${groupSize} positions. Exceptional groups can be handled later with overrides.
    </div>

    <table class="standings-table" style="width:100%;">
      <thead>
        <tr>
          <th>Position</th>
          <th>Bracket</th>
          <th>Entry round</th>
        </tr>
      </thead>
      <tbody id="fb-group-advancement-rows">
        ${positions.map(pos => `
          <tr>
            <td>${pos}</td>
            <td>
				<input
				  class="form-input fb-adv-bracket"
				  data-position="${pos}"
				  value="${advancementByPosition[pos]?.bracketName || ""}"
				  placeholder="e.g. A Tournament"
				/>
            </td>
            <td>
				<input
				  class="form-input fb-adv-round"
				  data-position="${pos}"
				  value="${advancementByPosition[pos]?.roundName || ""}"
				  placeholder="e.g. Last 32"
				/>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>

    <div style="margin-top:10px;">
      <button class="header-btn" id="fb-save-group-advancement">
        Save group advancement
      </button>
    </div>

    <div class="subtitle" id="fb-group-advancement-result"></div>
  `;

  container
    .querySelector("#fb-save-group-advancement")
    ?.addEventListener("click", () => {
      App.Features.Tournament.FormatBuilder.saveGroupAdvancement({
        editionId,
        container
      });
    });
};

App.Features.Tournament.FormatBuilder.saveGroupAdvancement = async function ({
  editionId,
  container
}) {
  const resultEl = container.querySelector("#fb-group-advancement-result");

  const rows = [...container.querySelectorAll(".fb-adv-bracket")]
    .map(input => {
      const position = Number(input.dataset.position);
      const bracketName = input.value.trim();
      const roundName = container
        .querySelector(`.fb-adv-round[data-position="${position}"]`)
        ?.value
        ?.trim();

      if (!bracketName || !roundName) return null;

      return {
        edition_id: editionId,
        position,
        bracket_name: bracketName,
        entry_round_name: roundName
      };
    })
    .filter(Boolean);

  console.log("[format builder] group advancement rows", rows);

  // For now, no DB write until tables are added.
  if (resultEl) {
    resultEl.textContent =
      "Draft saved in console only. DB table wiring comes next.";
  }
};

App.Features.Tournament.FormatBuilder.renderRounds = function ({
  editionId,
  container
}) {
  if (!container) return;

  container.innerHTML = `
    <div class="section-title">Knockout rounds</div>

    <div class="empty-message">
      Round builder will go here next.
    </div>
  `;
};

App.Features.Tournament.FormatBuilder.renderGenerate = function ({
  tournamentId,
  editionId,
  container
}) {
  if (!container) return;

  container.innerHTML = `
    <div class="section-title">Generate structure</div>

    <div class="empty-message">
      Generation is disabled until the format builder is fully wired.
    </div>
  `;
};