// ===========================================================
// Bulk Fixture Upload – Validation & Resolution (Phase A)
// No UI, no inserts, read-only Supabase usage only
// ===========================================================

/*
Expected CSV header (exact):
date,time,player1,player2,round
*/

// -----------------------------------------------------------
// Utilities
// -----------------------------------------------------------

function parseCsv(csvText) {
  const lines = csvText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { error: "CSV is empty", rows: [] };
  }

  const header = lines[0];
  const expectedHeader = "date,time,player1,player2,round";

  if (header !== expectedHeader) {
    return {
      error: `Invalid header. Expected: ${expectedHeader}`,
      rows: []
    };
  }

  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");

    if (parts.length !== 5) {
      return {
        error: `Invalid column count on row ${i + 1}`,
        rows: []
      };
    }

    const [dateStr, timeStr, p1, p2, round] = parts.map(p => p.trim());

    rows.push({
      rowNumber: i + 1,
      dateStr,
      timeStr,
      player1Name: p1,
      player2Name: p2,
      roundLabel: round
    });
  }

  return { error: null, rows };
}

function isValidDate(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

function isValidTime(timeStr) {
  return /^\d{2}:\d{2}$/.test(timeStr);
}

function buildUtcTimestamp(dateStr, timeStr) {
  // Treat input as tournament-local time, convert to UTC
  const local = new Date(`${dateStr}T${timeStr}:00`);
  if (Number.isNaN(local.getTime())) return null;
  return local.toISOString();
}

// -----------------------------------------------------------
// Main validation entry point
// -----------------------------------------------------------

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

  // -------------------------
  // Parse CSV
  // -------------------------
  const parsed = parseCsv(csvText);
  if (parsed.error) {
    result.errors.push({
      row: null,
      field: "csv",
      message: parsed.error
    });
    return result;
  }

  const rows = parsed.rows;

  // -------------------------
  // Load reference data
  // -------------------------
  const [{ data: players }, { data: stage }, { data: groups }, { data: existingMatches }] =
    await Promise.all([
      supabase.from("players").select("id,name"),
      supabase
		  .from("stages")
		  .select("id, stage_type, edition_id")
		  .eq("id", stageId)
		  .eq("edition_id", editionId)
		  .maybeSingle(),
      supabase.from("groups").select("id,name").eq("stage_id", stageId),
      supabase
        .from("matches")
        .select("player1_id,player2_id,match_date")
        .eq("tournament_id", tournamentId)
        .eq("edition_id", editionId)
        .eq("stage_id", stageId)
    ]);
	
	console.log("Stage query result", stage);

  if (!stage) {
    result.errors.push({
      row: null,
      field: "stage",
      message: "Stage not found"
    });
    return result;
  }

  const playerByName = new Map(players.map(p => [p.name, p]));
  const groupByName = new Map((groups || []).map(g => [g.name, g]));
  const groupsToCreate = new Map(); // groupName -> stageId

  let duplicateDetected = false;

  // -------------------------
  // Row-by-row validation
  // -------------------------
  for (const row of rows) {
    const {
      rowNumber,
      dateStr,
      timeStr,
      player1Name,
      player2Name,
      roundLabel
    } = row;

    // Basic shape checks
    if (!dateStr || !timeStr || !player1Name || !player2Name || !roundLabel) {
      result.errors.push({
        row: rowNumber,
        field: "row",
        message: "All fields are required"
      });
      continue;
    }

    if (!isValidDate(dateStr)) {
      result.errors.push({
        row: rowNumber,
        field: "date",
        message: "Invalid date format (YYYY-MM-DD)"
      });
      continue;
    }

    if (!isValidTime(timeStr)) {
      result.errors.push({
        row: rowNumber,
        field: "time",
        message: "Invalid time format (HH:MM)"
      });
      continue;
    }

    const p1 = playerByName.get(player1Name);
    const p2 = playerByName.get(player2Name);

    if (!p1) {
      result.errors.push({
        row: rowNumber,
        field: "player1",
        message: `Unknown player: ${player1Name}`
      });
      continue;
    }

    if (!p2) {
      result.errors.push({
        row: rowNumber,
        field: "player2",
        message: `Unknown player: ${player2Name}`
      });
      continue;
    }

    if (p1.id === p2.id) {
      result.errors.push({
        row: rowNumber,
        field: "players",
        message: "Player cannot play themselves"
      });
      continue;
    }

    const utcDate = buildUtcTimestamp(dateStr, timeStr);
    if (!utcDate) {
      result.errors.push({
        row: rowNumber,
        field: "time",
        message: "Invalid date/time combination"
      });
      continue;
    }

    let groupId = null;
    let roundName = null;

	if (stage.stage_type === "group") {
	  let group = groupByName.get(roundLabel);

	  if (!group) {
		// Mark group for creation (once per name)
		if (!groupsToCreate.has(roundLabel)) {
		  groupsToCreate.set(roundLabel, stageId);
		}

		// Temporary placeholder, resolved after creation
		groupId = `__NEW__:${roundLabel}`;
	  } else {
		groupId = group.id;
	  }
	} else {
	  roundName = roundLabel;
	}

    // Duplicate detection (warning only)
    if (!duplicateDetected) {
      const dup = (existingMatches || []).some(m =>
        m.player1_id === p1.id &&
        m.player2_id === p2.id &&
        m.match_date === utcDate
      );

      if (dup) duplicateDetected = true;
    }

    result.matches.push({
		tournament_id: tournamentId,
		edition_id: editionId,
		stage_id: stageId,
		group_id: groupId,
		round_label: roundName,
		player1_id: p1.id,
		player2_id: p2.id,
		player1_name: player1Name,
		player2_name: player2Name,
		match_date_utc: utcDate,
		status: "scheduled"
    });
  }

  if (duplicateDetected) {
    result.warnings.push({
      code: "DUPLICATE_MATCH",
      message: "One or more fixtures already exist and may be duplicated"
    });
  }

  if (result.errors.length === 0) {
    result.valid = true;
  } else {
    result.matches = [];
  }
  
  result.groupsToCreate = Array.from(groupsToCreate.entries()).map(
  ([name, stage_id]) => ({ name, stage_id })
	);


  return result;
}

// -----------------------------------------------------------
// Expose
// -----------------------------------------------------------

window.validateBulkFixtures = validateBulkFixtures;
