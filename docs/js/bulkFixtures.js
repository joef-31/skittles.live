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
      window.supabaseClient.from("players").select("id,name"),
      window.supabaseClient
		  .from("stages")
		  .select("id, stage_type, edition_id")
		  .eq("id", stageId)
		  .eq("edition_id", editionId)
		  .maybeSingle(),
      window.supabaseClient.from("groups").select("id,name").eq("stage_id", stageId),
      window.supabaseClient
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
	  roundLabel,
	  bracketMeta
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
	  const label = roundLabel.trim();
	  const group = groupByName.get(label);

	  if (!group) {
		result.errors.push({
		  row: rowNumber,
		  field: "round",
		  message: `Unknown group: "${label}"`
		});
		continue;
	  }

	  groupId = group.id;
	  roundName = group.name;
	} else {
	  roundName = roundLabel.trim();
	}
	
	const dup = (existingMatches || []).some(m => {
	  return (
		(m.player1_id === p1.id && m.player2_id === p2.id) ||
		(m.player1_id === p2.id && m.player2_id === p1.id)
	  );
	});

	if (dup) {
	  duplicateDetected = true;

	  result.warnings.push({
		row: rowNumber,
		field: "duplicate",
		message: `Duplicate fixture: ${player1Name} vs ${player2Name}`
	  });
	}
	
	let parsedBracketMeta = null;

	if (bracketMeta) {
	  if (stage.stage_type !== "knockout") {
		result.errors.push({
		  row: rowNumber,
		  field: "bracket_meta",
		  message: "bracket_meta is only allowed for knockout stages"
		});
		continue;
	  }

	  try {
		parsedBracketMeta = JSON.parse(bracketMeta);

		if (!parsedBracketMeta.bracket_id) {
		  throw new Error("Missing bracket_id");
		}

		if (!Number.isInteger(parsedBracketMeta.round_index)) {
		  throw new Error("round_index must be an integer");
		}

		if (!Number.isInteger(parsedBracketMeta.slot_index)) {
		  throw new Error("slot_index must be an integer");
		}
	  } catch (e) {
		result.errors.push({
		  row: rowNumber,
		  field: "bracket_meta",
		  message: `Invalid bracket_meta JSON: ${e.message}`
		});
		continue;
	  }
	}

	result.matches.push({
	  tournament_id: tournamentId,
	  edition_id: editionId,
	  stage_id: stageId,
	  group_id: groupId,
	  group_name: roundName,
	  round_label: roundName,
	  player1_id: p1.id,
	  player2_id: p2.id,
	  player1_name: player1Name,
	  player2_name: player2Name,
	  match_date_utc: utcDate,
	  status: "scheduled",
	  bracket_meta: parsedBracketMeta // ← NEW
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

async function validateBulkBracketFixtures({
  csvText,
  tournamentId,
  editionId,
  bracketId
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
  const [
    { data: players },
    { data: stages }
  ] = await Promise.all([
    window.supabaseClient.from("players").select("id,name"),
    window.supabaseClient
      .from("stages")
      .select("id,name,order_index,bracket_id,stage_type")
      .eq("edition_id", editionId)
      .eq("stage_type", "knockout")
      .eq("bracket_id", bracketId)
  ]);

  if (!stages?.length) {
    result.errors.push({
      row: null,
      field: "bracket",
      message: "No knockout stages found for this bracket"
    });
    return result;
  }

  const playerByName = new Map(players.map(p => [p.name, p]));
  const stageByName  = new Map(stages.map(s => [s.name, s]));

  // -------------------------
  // Validate rows
  // -------------------------
  for (const row of rows) {
    const {
      rowNumber,
      dateStr,
      timeStr,
      round,
      slot,
      player1,
      player2
    } = row;

    if (!dateStr || !timeStr || !round || slot === undefined || !player1 || !player2) {
      result.errors.push({
        row: rowNumber,
        field: "row",
        message: "date, time, round, slot, player1, player2 are required"
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

    const stage = stageByName.get(round.trim());
    if (!stage) {
      result.errors.push({
        row: rowNumber,
        field: "round",
        message: `Unknown round: "${round}"`
      });
      continue;
    }

    const p1 = playerByName.get(player1);
    const p2 = playerByName.get(player2);

    if (!p1 || !p2) {
      result.errors.push({
        row: rowNumber,
        field: "players",
        message: "Unknown player name"
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

    const matchDate = buildUtcTimestamp(dateStr, timeStr);
    if (!matchDate) {
      result.errors.push({
        row: rowNumber,
        field: "time",
        message: "Invalid date/time combination"
      });
      continue;
    }

    result.matches.push({
      tournament_id: tournamentId,
      edition_id: editionId,
      stage_id: stage.id,
      player1_id: p1.id,
      player2_id: p2.id,
      match_date: matchDate,
      status: "scheduled",

      bracket_meta: {
        bracket_id: bracketId,
        round_index: stage.order_index,
        slot_index: Number(slot),
        path: null,
        source_match_id: null
      }
    });
  }

  if (result.errors.length === 0) {
    result.valid = true;
  } else {
    result.matches = [];
  }

  return result;
}

async function persistBulkBracketFixtures(matches) {
  if (!matches?.length) return;

  const { error } = await window.supabaseClient
    .from("matches")
    .insert(matches);

  if (error) {
    console.error("Failed to insert bracket fixtures", error);
    throw error;
  }
}




// -----------------------------------------------------------
// Expose
// -----------------------------------------------------------

window.validateBulkFixtures = validateBulkFixtures;
