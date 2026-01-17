import { get, set } from "./state.js";

// --------------------------------------------------
// TEMPORARY GLOBAL STATE BRIDGE
// --------------------------------------------------
// This allows legacy code to continue using
// window.currentTournamentId etc.
// Remove this file once migration is complete.
// --------------------------------------------------

Object.defineProperties(window, {
  currentTournamentId: {
    get() {
      return get("currentTournamentId");
    },
    set(v) {
      set("currentTournamentId", v);
    }
  },

  currentEditionId: {
    get() {
      return get("currentEditionId");
    },
    set(v) {
      set("currentEditionId", v);
    }
  },

  currentStageId: {
    get() {
      return get("currentStageId");
    },
    set(v) {
      set("currentStageId", v);
    }
  },

  selectedBracketId: {
    get() {
      return get("selectedBracketId");
    },
    set(v) {
      set("selectedBracketId", v);
    }
  },

  currentMatchId: {
    get() {
      return get("currentMatchId");
    },
    set(v) {
      set("currentMatchId", v);
    }
  },

  bracketRoundIndex: {
    get() {
      return get("bracketRoundIndex");
    },
    set(v) {
      set("bracketRoundIndex", v);
    }
  },

  stageGraph: {
    get() {
      return get("stageGraph");
    },
    set(v) {
      set("stageGraph", v);
    }
  },

  liveSetByMatch: {
    get() {
      return get("liveSetByMatch");
    },
    set(v) {
      set("liveSetByMatch", v);
    }
  }
});
