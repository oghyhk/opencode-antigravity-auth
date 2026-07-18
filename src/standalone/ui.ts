/**
 * Embedded Web UI for the Antigravity Proxy Server.
 * Single-page dashboard with account management.
 */

export function getWebUI(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Antigravity Proxy</title>
  <style>
    :root {
      --bg: #0a0a0a;
      --card-bg: #141414;
      --card-border: #222;
      --text: #e5e5e5;
      --text-dim: #888;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --success: #22c55e;
      --warning: #eab308;
      --danger: #ef4444;
      --danger-hover: #dc2626;
      --mono: "SF Mono", "Cascadia Code", "Fira Code", Consolas, monospace;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 2rem;
    }
    .container { max-width: 800px; margin: 0 auto; }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--card-border);
    }
    header h1 { font-size: 1.25rem; font-weight: 600; letter-spacing: -0.02em; }
    header .status {
      display: flex; align-items: center; gap: 0.5rem;
      font-size: 0.85rem; color: var(--text-dim);
    }
    header .status .dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--success); display: inline-block;
    }

    .config-section {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin-bottom: 1.5rem;
    }
    .config-section h3 {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-dim);
      margin-bottom: 0.75rem;
    }
    .config-block {
      background: #0d0d0d;
      border-radius: 4px;
      padding: 0.75rem 1rem;
      font-family: var(--mono);
      font-size: 0.8rem;
      color: var(--text-dim);
      line-height: 1.6;
      overflow-x: auto;
      margin-bottom: 0.5rem;
    }
    .config-block:last-child { margin-bottom: 0; }
    .config-label {
      font-size: 0.75rem;
      color: var(--text-dim);
      margin-bottom: 0.25rem;
      font-weight: 500;
    }
    .config-block .key { color: var(--accent); }
    .config-block .val { color: var(--success); }

    .actions {
      display: flex; gap: 0.75rem;
      margin-bottom: 1.5rem;
    }
    button {
      font-family: inherit;
      border: none;
      border-radius: 6px;
      padding: 0.6rem 1.25rem;
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, opacity 0.15s;
    }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary { background: var(--accent); color: #fff; }
    .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
    .btn-secondary { background: var(--card-bg); color: var(--text); border: 1px solid var(--card-border); }
    .btn-secondary:hover:not(:disabled) { background: #1a1a1a; }
    .btn-danger { background: transparent; color: var(--danger); border: 1px solid var(--danger); padding: 0.35rem 0.75rem; font-size: 0.75rem; }
    .btn-danger:hover:not(:disabled) { background: var(--danger); color: #fff; }
    .btn-small { padding: 0.35rem 0.75rem; font-size: 0.75rem; }

    .accounts-list { display: flex; flex-direction: column; gap: 0.5rem; }
    .account-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 1rem 1.25rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .account-info { flex: 1; }
    .account-email { font-weight: 500; font-size: 0.9rem; }
    .account-meta { font-size: 0.75rem; color: var(--text-dim); margin-top: 0.25rem; }
    .account-actions { display: flex; gap: 0.5rem; align-items: center; }

    .badge {
      display: inline-block;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .badge-ok { background: rgba(34,197,94,0.15); color: var(--success); }
    .badge-limited { background: rgba(239,68,68,0.15); color: var(--danger); }
    .badge-disabled { background: rgba(136,136,136,0.15); color: var(--text-dim); }

    .empty-state {
      text-align: center;
      padding: 3rem 1rem;
      color: var(--text-dim);
    }
    .empty-state p { margin-bottom: 1rem; }

    .toast {
      position: fixed;
      bottom: 1.5rem;
      right: 1.5rem;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 0.75rem 1.25rem;
      font-size: 0.85rem;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      transform: translateY(100px);
      opacity: 0;
      transition: transform 0.3s, opacity 0.3s;
      z-index: 100;
    }
    .toast.visible { transform: translateY(0); opacity: 1; }
    .toast.success { border-left: 3px solid var(--success); }
    .toast.error { border-left: 3px solid var(--danger); }

    h2 {
      font-size: 0.95rem;
      font-weight: 600;
      margin-bottom: 1rem;
      color: var(--text-dim);
    }

    footer {
      margin-top: 3rem;
      padding-top: 1rem;
      border-top: 1px solid var(--card-border);
      font-size: 0.75rem;
      color: #555;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Antigravity Proxy</h1>
      <div class="status">
        <span class="dot"></span>
        <span id="uptime">Running</span>
      </div>
    </header>

    <div class="config-section">
      <h3>Claude Code Configuration</h3>
      <div class="config-label">PowerShell</div>
      <div class="config-block">
        <span class="key">$env:ANTHROPIC_BASE_URL</span> = <span class="val">"http://localhost:${port}"</span><br>
        <span class="key">$env:ANTHROPIC_API_KEY</span> = <span class="val">"local"</span><br>
        claude
      </div>
    </div>

    <div class="config-section">
      <h3>Codex CLI Configuration <span style="color:var(--warning);font-size:0.7rem">(Coming Soon)</span></h3>
      <div class="config-label">~/.codex/config.toml</div>
      <div class="config-block">
        <span class="key">model</span> = <span class="val">"gemini-3.5-flash"</span><br>
        <span class="key">model_provider</span> = <span class="val">"antigravity"</span><br><br>
        [<span class="key">model_providers.antigravity</span>]<br>
        &nbsp;&nbsp;<span class="key">base_url</span> = <span class="val">"http://localhost:${port}/v1"</span><br>
        &nbsp;&nbsp;<span class="key">env_key</span> = <span class="val">"ANTIGRAVITY_KEY"</span><br>
        &nbsp;&nbsp;<span class="key">wire_api</span> = <span class="val">"responses"</span>
      </div>
    </div>

    <div class="actions">
      <button class="btn-primary" id="btn-add" onclick="addAccount()">Add Google Account</button>
      <button class="btn-secondary" id="btn-refresh" onclick="refreshAccounts()">Refresh</button>
    </div>

    <h2>Accounts</h2>
    <div id="accounts-container" class="accounts-list">
      <div class="empty-state" id="empty-state">
        <p>No accounts configured yet.</p>
        <p>Click "Add Google Account" to get started.</p>
      </div>
    </div>

    <footer>
      Antigravity Proxy &middot; localhost:${port}
    </footer>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    const API = "";

    function showToast(message, type = "success") {
      const toast = document.getElementById("toast");
      toast.textContent = message;
      toast.className = "toast " + type + " visible";
      setTimeout(() => { toast.className = "toast"; }, 3000);
    }

    function formatTime(ts) {
      if (!ts) return "Never";
      const d = new Date(ts);
      return d.toLocaleString();
    }

    function formatUptime(seconds) {
      if (seconds < 60) return seconds + "s";
      if (seconds < 3600) return Math.floor(seconds / 60) + "m " + (seconds % 60) + "s";
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      return h + "h " + m + "m";
    }

    async function refreshAccounts() {
      try {
        const res = await fetch(API + "/api/status");
        const data = await res.json();

        document.getElementById("uptime").textContent = "Running \u00b7 " + formatUptime(data.uptime);

        const container = document.getElementById("accounts-container");
        const empty = document.getElementById("empty-state");

        if (!data.accounts || data.accounts.length === 0) {
          container.innerHTML = "";
          container.appendChild(createEmptyState());
          return;
        }

        container.innerHTML = data.accounts.map((acc, i) => {
          const statusBadge = !acc.enabled
            ? '<span class="badge badge-disabled">Disabled</span>'
            : acc.isRateLimited
              ? '<span class="badge badge-limited">Rate Limited</span>'
              : '<span class="badge badge-ok">Active</span>';

          const toggleBtn = acc.enabled
            ? '<button class="btn-small btn-secondary" onclick="toggleAccount(' + i + ', false)">Disable</button>'
            : '<button class="btn-small btn-primary" onclick="toggleAccount(' + i + ', true)">Enable</button>';

          return '<div class="account-card">' +
            '<div class="account-info">' +
              '<div class="account-email">' + (acc.email || "Account #" + i) + " " + statusBadge + '</div>' +
              '<div class="account-meta">' +
                'Project: ' + (acc.projectId || "auto") +
                ' \u00b7 Last used: ' + formatTime(acc.lastUsed) +
                ' \u00b7 Added: ' + formatTime(acc.addedAt) +
              '</div>' +
            '</div>' +
            '<div class="account-actions">' +
              toggleBtn +
              '<button class="btn-danger" onclick="removeAccount(' + i + ')">Remove</button>' +
            '</div>' +
          '</div>';
        }).join("");

      } catch (error) {
        showToast("Failed to load accounts: " + error.message, "error");
      }
    }

    function createEmptyState() {
      const div = document.createElement("div");
      div.className = "empty-state";
      div.innerHTML = "<p>No accounts configured yet.</p><p>Click \\"Add Google Account\\" to get started.</p>";
      return div;
    }

    async function addAccount() {
      const btn = document.getElementById("btn-add");
      btn.disabled = true;
      btn.textContent = "Opening browser...";

      try {
        const res = await fetch(API + "/api/accounts/login", { method: "POST" });
        const data = await res.json();

        if (data.url) {
          window.open(data.url, "_blank", "width=500,height=700");
          showToast("Complete sign-in in the browser window");

          // Poll for new account
          let attempts = 0;
          const pollInterval = setInterval(async () => {
            attempts++;
            if (attempts > 60) {
              clearInterval(pollInterval);
              btn.disabled = false;
              btn.textContent = "Add Google Account";
              return;
            }
            await refreshAccounts();
          }, 3000);

          // Auto-stop polling after success (detect account count change)
          const beforeRes = await fetch(API + "/api/accounts");
          const before = await beforeRes.json();
          const beforeCount = before.accounts?.length || 0;

          const checkInterval = setInterval(async () => {
            const afterRes = await fetch(API + "/api/accounts");
            const after = await afterRes.json();
            if ((after.accounts?.length || 0) > beforeCount) {
              clearInterval(pollInterval);
              clearInterval(checkInterval);
              btn.disabled = false;
              btn.textContent = "Add Google Account";
              showToast("Account added successfully!");
              await refreshAccounts();
            }
          }, 2000);

          setTimeout(() => {
            clearInterval(pollInterval);
            clearInterval(checkInterval);
            btn.disabled = false;
            btn.textContent = "Add Google Account";
          }, 120000);
        }
      } catch (error) {
        showToast("Failed to start login: " + error.message, "error");
        btn.disabled = false;
        btn.textContent = "Add Google Account";
      }
    }

    async function toggleAccount(index, enable) {
      try {
        const action = enable ? "enable" : "disable";
        await fetch(API + "/api/accounts/" + index + "/" + action, { method: "POST" });
        showToast("Account " + (enable ? "enabled" : "disabled"));
        await refreshAccounts();
      } catch (error) {
        showToast("Failed: " + error.message, "error");
      }
    }

    async function removeAccount(index) {
      if (!confirm("Remove this account?")) return;
      try {
        await fetch(API + "/api/accounts/" + index, { method: "DELETE" });
        showToast("Account removed");
        await refreshAccounts();
      } catch (error) {
        showToast("Failed: " + error.message, "error");
      }
    }

    // Initial load
    refreshAccounts();

    // Auto-refresh every 30s
    setInterval(refreshAccounts, 30000);
  </script>
</body>
</html>`;
}
