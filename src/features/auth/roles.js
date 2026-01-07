// src/features/auth/roles.js

window.App = window.App || {};
App.Auth = App.Auth || {};
App.Auth.Roles = App.Auth.Roles || {};

// Canonical role → allowed actions map
App.Auth.Roles = {
  super_admin: ["*", "impersonate_user"],

  country_admin: [
    "manage_country",
    "manage_tournament",
    "assign_tournament_admin",
    "assign_referee",
	"friendly.create",
    "view"
  ],

  tournament_admin: [
    "manage_tournament",
    "assign_referee",
    "score_match",
	"friendly.create",
    "view"
  ],

  referee: [
    "score_match",
	"friendly.create",
    "view"
  ],

  player: [
    "score_own_match",
	"friendly.create",
    "view"
  ],

  guest: [
    "view"
  ]
};
