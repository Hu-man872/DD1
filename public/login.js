const loginForm = document.getElementById("loginForm");
const loginMessage = document.getElementById("loginMessage");

if (localStorage.getItem("doctor_dashboard_token")) {
  window.location.href = "/dashboard.html";
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.textContent = "Logging in...";

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {
    const response = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Login failed.");
    }

    localStorage.setItem("doctor_dashboard_token", data.token);
    window.location.href = "/dashboard.html";
  } catch (error) {
    loginMessage.textContent = error.message;
  }
});
