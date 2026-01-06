console.log("[bulkFixtures] file executing");

function isValidDate(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

function isValidTime(timeStr) {
  return /^\d{2}:\d{2}$/.test(timeStr);
}

function buildUtcTimestamp(dateStr, timeStr) {
  const d = new Date(`${dateStr}T${timeStr}:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

async function validateBulkFixtures({
  csvText,
  tournamentId,
  editionId,
  stageId
}) {
  const result = {
    valid: false,
    errors: [],
    warnings: [],
    matches: []
  };

  const lines = csvText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  if (!lines.length) {
    result.errors.push({ field: "csv", message: "CSV is empty" });
    return result;
  }

  const header = lines[0];
  const rows = lines.slice(1);

  const [
    { data: stage },
    { data: players },
    { data: groups }
  ] = await Promise.all([
    window.supabaseClient
      .from("stages")
      .select("id,stage_type")
      .eq("id", stageId)
      .eq("edition_id", editionId)
      .maybeSingle(),
    window.supabaseClient.from("players").select("id,name"),
    window.supabaseClient
      .from("groups")
      .select("id,name")
      .eq("stage_id", stageId)
  ]);

  if (!stage) {
    result.errors.push({ field: "stage", message: "Stage not found" });
    return result;
  }

  const isGroupStage = stage.stage_type === "group";
  const expectedHeader = isGroupStage
    ? "date,time,player1,player2,round"
    : "date,time,player1,player2";

  if (header !== expectedHeader) {
    result.errors.push({
      field: "csv",
      message: `Expected header: ${expectedHeader}`
    });
    return result;
  }

  const playerByName = new Map(players.map(p => [p.name, p]));
  const groupByName  = new Map((groups || []).map(g => [g.name, g]));

  rows.forEach((line, idx) => {
    const rowNumber = idx + 2;
    const parts = line.split(",").map(p => p.trim());

    if (
      (isGroupStage && parts.length !== 5) ||
      (!isGroupStage && parts.length !== 4)
    ) {
      result.errors.push({
        row: rowNumber,
        message: "Incorrect column count"
      });
      return;
    }

    const [dateStr, timeStr, p1Name, p2Name, roundLabel] = parts;

    if (!isValidDate(dateStr)) {
      result.errors.push({ row: rowNumber, field: "date", message: "Invalid date" });
      return;
    }

    if (!isValidTime(timeStr)) {
      result.errors.push({ row: rowNumber, field: "time", message: "Invalid time" });
      return;
    }

    const p1 = playerByName.get(p1Name);
    const p2 = playerByName.get(p2Name);

    if (!p1 || !p2) {
      result.errors.push({
        row: rowNumber,
        field: "players",
        message: "Unknown player"
      });
      return;
    }

    if (p1.id === p2.id) {
      result.errors.push({
        row: rowNumber,
        field: "players",
        message: "Player cannot play themselves"
      });
      return;
    }

    const utcDate = buildUtcTimestamp(dateStr, timeStr);
    if (!utcDate) {
      result.errors.push({
        row: rowNumber,
        field: "datetime",
        message: "Invalid date/time"
      });
      return;
    }

	let groupId = null;
	if (isGroupStage) {
	  const group = groupByName.get(roundLabel);
	  if (!group) {
		result.errors.push({
		  row: rowNumber,
		  field: "round",
		  message: `Unknown group: ${roundLabel}`
		});
		return;
	  }
	  groupId = group.id;
	}

		result.matches.push({
			tournament_id: tournamentId,
			edition_id: editionId,
			stage_id: stageId,
			group_id: groupId,

			player1_id: p1.id,
			player2_id: p2.id,
			player1_name: p1.name,
			player2_name: p2.name,

			match_date: utcDate,
			status: "scheduled"
		});
	});

  if (!result.errors.length) {
    result.valid = true;
  } else {
    result.matches = [];
  }

  return result;
}

async function persistBulkFixtures(matches) {
  if (!matches?.length) return;

  const { error } = await window.supabaseClient
    .from("matches")
    .insert(matches);

  if (error) {
    console.error(error);
    throw error;
  }
}

window.validateBulkFixtures = validateBulkFixtures;
window.persistBulkFixtures = persistBulkFixtures;
