// =========================
// SMARTMART DEMO LOGIN
// =========================

document.addEventListener("DOMContentLoaded", function () {
    const form = document.getElementById("loginForm");
    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");
    const message = document.getElementById("loginMessage");

    if (!form || !usernameInput || !passwordInput || !message) {
        return;
    }

    form.addEventListener("submit", function (event) {
        event.preventDefault();

        message.textContent = "";
        message.classList.remove("success-message");

        const username = usernameInput.value.trim();
        const password = passwordInput.value;

        if (!username || !password.trim()) {
            message.textContent =
                "Please enter both a username and password.";

            return;
        }

        try {
            // Demonstration only. This is not secure authentication.
            sessionStorage.setItem("smartmart_demo_logged_in", "true");

            message.classList.add("success-message");
            message.textContent = "Demo login successful. Opening dashboard...";

            window.location.href = "index.html";
        } catch (error) {
            console.error("Unable to start demo session:", error);

            message.textContent =
                "Unable to start the demo session in this browser.";
        }
    });
});