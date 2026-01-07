// =======================================================
// 7. THROWS / SCORING MODEL HELPERS
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
                displayScore = "X↓";
                if (isP1) cumP1 = 25;
                else cumP2 = 25;
            } else {
                displayScore = "X";
            }
        } else {
            let tentative = before + raw;
            const bust = tentative > 50;
            if (bust) {
                displayScore = raw + "↓";
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

function buildThrowsTableHTML(model, p1Name, p2Name) {
    if (!model || model.length === 0) {
        return `<div class="empty-message">No throw history for this set.</div>`;
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

        const p1Class =
            p1ScoreStr.includes("X") ? "miss" :
            p1ScoreStr.includes("↓") ? "reset" : "";

        const p2Class =
            p2ScoreStr.includes("X") ? "miss" :
            p2ScoreStr.includes("↓") ? "reset" : "";

        rows.push(`
<tr>
  <td>${i + 1}</td>
  <td>
    ${p1
        ? `<span class="throw-raw ${p1Class}"><sub>${p1ScoreStr}</sub></span>/<span class="throw-total">${p1.total}</span>`
        : ""}
  </td>
  <td>
    ${p2
        ? `<span class="throw-raw ${p2Class}"><sub>${p2ScoreStr}</sub></span>/<span class="throw-total">${p2.total}</span>`
        : ""}
  </td>
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

async function updateLiveThrowsForSet(setNumber) {

  if (!window.currentMatchId) return;

  const ctx = window.matchDetailContext || {};
  const p1 = ctx.p1Id;
  const p2 = ctx.p2Id;

  if (!p1 || !p2) {
    console.warn("[updateLiveThrowsForSet] missing player ids", { p1, p2, ctx });
    return;
  }

  const { data: throws, error } = await window.supabaseClient
    .from("throws")
    .select("id, match_id, set_number, throw_number, player_id, score, is_fault")
    .eq("match_id", window.currentMatchId)
    .eq("set_number", setNumber)
    .order("throw_number", { ascending: true });

  if (error) {
    console.error("[updateLiveThrowsForSet] throws load error", error);
    return;
  }

  const model = buildThrowsModel(throws || [], p1, p2);

  // Header throwstrip
  const headerP1 = document.getElementById("header-throws-p1");
  const headerP2 = document.getElementById("header-throws-p2");

  if (headerP1 && headerP2) {
    const lastP1 = model.filter(m => m.isP1).slice(-6);
    const lastP2 = model.filter(m => !m.isP1).slice(-6);

    headerP1.innerHTML = lastP1.map(m => throwBoxHTML(m.displayScore)).join("");
    headerP2.innerHTML = lastP2.map(m => throwBoxHTML(m.displayScore)).join("");
  }

  // Expanded table only (never touches #tab-sets / sets wrapper)
  const expanded = document.querySelector(`.set-throws-expanded[data-set="${setNumber}"]`);
  if (expanded && expanded.style.display === "block") {
    expanded.innerHTML = buildThrowsTableHTML(
      model,
      ctx.p1Name || "Player 1",
      ctx.p2Name || "Player 2"
    );
  }
}

window.updateLiveThrowsForSet = updateLiveThrowsForSet;

// Legacy compatibility for match renderer
window.App = window.App || {};
App.Features = App.Features || {};
App.Features.Match = App.Features.Match || {};

App.Features.Match.buildThrowsTableHTML = buildThrowsTableHTML;
App.Features.Match.buildThrowsModel = buildThrowsModel;