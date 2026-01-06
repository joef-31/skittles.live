// Auth modal stubs (temporary)

window.openLoginModal = function () {
  const modal = document.getElementById("login-modal");
  if (!modal) return;

  modal.style.display = "flex";

  const emailInput = document.getElementById("login-email");
  const passInput  = document.getElementById("login-password");
  const errorBox   = document.getElementById("login-error");

  emailInput.value = "";
  passInput.value  = "";
  errorBox.style.display = "none";

  document.getElementById("login-submit").onclick = async () => {
    const email = emailInput.value.trim();
    const password = passInput.value;

    if (!email || !password) return;

    const { error } = await window.supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      errorBox.textContent = error.message;
      errorBox.style.display = "block";
      return;
    }

    modal.style.display = "none";
    await initAuth();
    renderAuthControls();
  };

  document.getElementById("login-cancel").onclick = () => {
    modal.style.display = "none";
  };
};


window.openLogoutConfirmModal = function () {
  if (confirm("Log out?")) {
    if (window.supabaseClient) {
      window.supabaseClient.auth.signOut();
    }
    location.reload();
  }
};
