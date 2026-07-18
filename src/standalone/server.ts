/**
 * Standalone Antigravity Proxy Server
 * 
 * Provides:
 * - Web UI for OAuth account management
 * - Anthropic Messages API (/v1/messages) for Claude Code
 * - OpenAI Responses API (/v1/responses) for Codex CLI (future)
 * - Account management REST API (/api/*)
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { authorizeAntigravity, exchangeAntigravity } from "../antigravity/oauth";
import { startOAuthListener } from "../plugin/server";
import { loadAccounts, saveAccounts, saveAccountsReplace, type AccountStorageV4, type AccountMetadataV3 } from "../plugin/storage";
import { generateFingerprint } from "../plugin/fingerprint";
import { refreshAccessToken, isTokenExpired, TokenRefreshError } from "./token";
import { createStandaloneLogger } from "./logger";
import { getWebUI } from "./ui";
import { translateRequest, type AnthropicRequestPayload } from "./translators/anthropic";
import { GeminiToAnthropicStream } from "./translators/anthropic-stream";
import type { ProxyAccount, ProxyStatus } from "./types";

const log = createStandaloneLogger("server");

const PROXY_PORT = parseInt(process.env.ANTIGRAVITY_PROXY_PORT || "5900", 10);
const startTime = Date.now();

// In-memory token cache: refreshToken -> { access, expires }
const tokenCache = new Map<string, { access: string; expires: number }>();

// OAuth flow state
let pendingOAuthFlow = false;

/**
 * Add an account from a successful OAuth exchange result.
 */
async function addAccountFromOAuth(result: {
  type: "success";
  refresh: string;
  access: string;
  expires: number;
  email?: string;
  projectId: string;
}): Promise<void> {
  const storage = (await loadAccounts()) ?? {
    version: 4 as const,
    accounts: [],
    activeIndex: 0,
  };

  // Extract raw refresh token (before the | delimiter)
  const rawRefreshToken = result.refresh.split("|")[0]!;

  // Check for duplicate by email
  const existingIndex = storage.accounts.findIndex(
    (acc) => acc.email && acc.email === result.email,
  );

  const newAccount: AccountMetadataV3 = {
    email: result.email,
    refreshToken: rawRefreshToken,
    projectId: result.projectId || undefined,
    addedAt: Date.now(),
    lastUsed: 0,
    enabled: true,
    fingerprint: generateFingerprint(),
  };

  if (existingIndex >= 0) {
    storage.accounts[existingIndex] = {
      ...storage.accounts[existingIndex]!,
      ...newAccount,
      addedAt: storage.accounts[existingIndex]!.addedAt,
    };
    log.info(`Updated existing account: ${result.email}`);
  } else {
    storage.accounts.push(newAccount);
    log.info(`Added new account: ${result.email}`);
  }

  await saveAccounts(storage);

  // Cache the access token
  tokenCache.set(rawRefreshToken, {
    access: result.access,
    expires: result.expires,
  });
}

/**
 * Read the full request body as a string.
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/**
 * Send a JSON response.
 */
function sendJSON(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, anthropic-version",
  });
  res.end(body);
}

/**
 * Send an HTML response.
 */
function sendHTML(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

/**
 * Get a valid access token for a given account, refreshing if needed.
 */
async function getAccessToken(account: AccountMetadataV3): Promise<string> {
  const cached = tokenCache.get(account.refreshToken);
  if (cached && !isTokenExpired(cached.expires)) {
    return cached.access;
  }

  const result = await refreshAccessToken(account.refreshToken);
  tokenCache.set(account.refreshToken, { access: result.access, expires: result.expires });
  return result.access;
}

/**
 * Convert storage accounts to proxy account format for the API.
 */
function toProxyAccounts(storage: AccountStorageV4 | null): ProxyAccount[] {
  if (!storage) return [];
  return storage.accounts.map((acc, index) => ({
    index,
    email: acc.email,
    projectId: acc.projectId,
    enabled: acc.enabled !== false,
    isRateLimited: Object.values(acc.rateLimitResetTimes ?? {}).some(
      (t) => typeof t === "number" && Date.now() < t,
    ),
    rateLimitResetTimes: acc.rateLimitResetTimes ?? {},
    lastUsed: acc.lastUsed,
    addedAt: acc.addedAt,
    cachedQuota: acc.cachedQuota,
  }));
}

/**
 * Handle API routes (/api/*)
 */
async function handleAPI(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  // GET /api/status
  if (path === "/api/status" && req.method === "GET") {
    const storage = await loadAccounts();
    const status: ProxyStatus = {
      running: true,
      port: PROXY_PORT,
      accounts: toProxyAccounts(storage),
      uptime: Math.floor((Date.now() - startTime) / 1000),
    };
    sendJSON(res, 200, status);
    return;
  }

  // GET /api/accounts
  if (path === "/api/accounts" && req.method === "GET") {
    const storage = await loadAccounts();
    sendJSON(res, 200, { accounts: toProxyAccounts(storage) });
    return;
  }

  // POST /api/accounts/login — trigger OAuth flow
  // Starts an OAuth listener on :51121, returns the Google auth URL,
  // and waits for the callback in the background. When the callback
  // arrives the token is exchanged and the account is persisted.
  if (path === "/api/accounts/login" && req.method === "POST") {
    try {
      // Prevent concurrent OAuth flows
      if (pendingOAuthFlow) {
        sendJSON(res, 409, { error: "An OAuth flow is already in progress. Complete or cancel it first." });
        return;
      }

      const auth = await authorizeAntigravity();

      // Start the local listener that Google will redirect to
      const listener = await startOAuthListener({ timeoutMs: 5 * 60 * 1000 });
      pendingOAuthFlow = true;

      // Return the URL immediately so the UI can open it
      sendJSON(res, 200, { url: auth.url });

      // Wait for the callback asynchronously
      listener.waitForCallback()
        .then(async (callbackUrl) => {
          const code = callbackUrl.searchParams.get("code");
          const state = callbackUrl.searchParams.get("state");
          if (!code || !state) {
            log.error("OAuth callback missing code or state");
            return;
          }

          const result = await exchangeAntigravity(code, state);
          if (result.type === "failed") {
            log.error("OAuth token exchange failed", { error: result.error });
            return;
          }

          await addAccountFromOAuth(result);
          log.info(`OAuth flow completed for ${result.email || "unknown"}`);
        })
        .catch((error) => {
          log.error("OAuth listener error", { error: String(error) });
        })
        .finally(() => {
          pendingOAuthFlow = false;
          listener.close().catch(() => {});
        });
    } catch (error) {
      pendingOAuthFlow = false;
      log.error("Failed to start OAuth flow", { error: String(error) });
      sendJSON(res, 500, { error: "Failed to start OAuth flow: " + String(error) });
    }
    return;
  }

  // GET /api/accounts/login/status — check if OAuth flow is in progress
  if (path === "/api/accounts/login/status" && req.method === "GET") {
    sendJSON(res, 200, { pending: pendingOAuthFlow });
    return;
  }

  // DELETE /api/accounts/:index
  const deleteMatch = path.match(/^\/api\/accounts\/(\d+)$/);
  if (deleteMatch && req.method === "DELETE") {
    const index = parseInt(deleteMatch[1]!, 10);
    const storage = await loadAccounts();
    if (!storage || index < 0 || index >= storage.accounts.length) {
      sendJSON(res, 404, { error: "Account not found" });
      return;
    }

    const removed = storage.accounts[index]!;
    storage.accounts.splice(index, 1);
    if (storage.activeIndex >= storage.accounts.length) {
      storage.activeIndex = Math.max(0, storage.accounts.length - 1);
    }
    await saveAccountsReplace(storage);
    tokenCache.delete(removed.refreshToken);
    log.info(`Removed account: ${removed.email || `#${index}`}`);
    sendJSON(res, 200, { success: true });
    return;
  }

  // POST /api/accounts/:index/enable or /disable
  const toggleMatch = path.match(/^\/api\/accounts\/(\d+)\/(enable|disable)$/);
  if (toggleMatch && req.method === "POST") {
    const index = parseInt(toggleMatch[1]!, 10);
    const enable = toggleMatch[2] === "enable";
    const storage = await loadAccounts();
    if (!storage || index < 0 || index >= storage.accounts.length) {
      sendJSON(res, 404, { error: "Account not found" });
      return;
    }

    storage.accounts[index]!.enabled = enable;
    await saveAccounts(storage);
    log.info(`Account #${index} ${enable ? "enabled" : "disabled"}`);
    sendJSON(res, 200, { success: true, enabled: enable });
    return;
  }

  sendJSON(res, 404, { error: "Not found" });
}

/**
 * Main request handler.
 */
async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `http://localhost:${PROXY_PORT}`);
  const path = url.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, anthropic-version",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  try {
    // Web UI
    if (path === "/" && req.method === "GET") {
      sendHTML(res, 200, getWebUI(PROXY_PORT));
      return;
    }

    // API routes
    if (path.startsWith("/api/")) {
      await handleAPI(req, res, path);
      return;
    }

    // Anthropic Messages API (Phase 2 - streaming translator proxy)
    if (path === "/v1/messages" && req.method === "POST") {
      const storage = await loadAccounts();
      if (!storage || storage.accounts.length === 0) {
        sendJSON(res, 401, {
          error: {
            type: "authentication_error",
            message: "No Google accounts configured in Antigravity Proxy. Open http://localhost:" + PROXY_PORT + "/ in your browser to sign in.",
          }
        });
        return;
      }

      // Pick first enabled account
      let account = storage.accounts.find((a) => a.enabled !== false);
      if (!account) {
        account = storage.accounts[0]; // Fallback to first if all disabled
      }

      if (!account) {
        sendJSON(res, 401, {
          error: {
            type: "authentication_error",
            message: "No enabled Google accounts found. Check http://localhost:" + PROXY_PORT + "/",
          }
        });
        return;
      }

      const bodyStr = await readBody(req);
      let payload: AnthropicRequestPayload;
      try {
        payload = JSON.parse(bodyStr);
      } catch (err) {
        sendJSON(res, 400, { error: { type: "invalid_request_error", message: "Invalid JSON request body" } });
        return;
      }

      try {
        // Resolve OAuth token
        const accessToken = await getAccessToken(account);
        const projectId = account.projectId || "rising-fact-p41fc"; // Default daily sandbox project

        // Translate Anthropic payload to wrapped Antigravity payload
        const translated = translateRequest(
          payload,
          accessToken,
          projectId,
          "antigravity", // headerStyle
        );

        const initHeaders = new Headers(translated.init.headers);
        
        // Ensure proper content type
        initHeaders.set("Content-Type", "application/json");

        const targetUrl = typeof translated.request === "string" ? translated.request : (translated.request as any).url;

        log.info(`Forwarding translated Claude Code request to Google API: ${targetUrl}`, {
          model: payload.model,
          effectiveModel: translated.effectiveModel,
          stream: translated.streaming,
        });

        const response = await fetch(targetUrl, {
          method: translated.init.method || "POST",
          headers: initHeaders,
          body: translated.init.body,
        });

        if (!response.ok) {
          const errText = await response.text();
          log.error("Google API rejected request", { status: response.status, body: errText });
          sendJSON(res, response.status, {
            error: {
              type: "api_error",
              message: `Google API rejected request (${response.status}): ${errText}`,
            }
          });
          return;
        }

        // Handle streaming response
        if (translated.streaming) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
          });

          if (!response.body) {
            res.end();
            return;
          }

          const streamTranscoder = new GeminiToAnthropicStream(translated.effectiveModel);
          const reader = response.body.getReader();

          // Helper to recursively read stream chunks and push to transcoder
          const pump = async () => {
            const { done, value } = await reader.read();
            if (done) {
              streamTranscoder.end();
              return;
            }
            streamTranscoder.write(value);
            await pump();
          };

          streamTranscoder.pipe(res);
          pump().catch((streamErr) => {
            log.error("Streaming read failure", { error: String(streamErr) });
            res.end();
          });
        } else {
          // Non-streaming response handling
          const data = await response.json();
          // Extract candidates and content
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
          
          sendJSON(res, 200, {
            id: `msg_${crypto.randomUUID().replace(/-/g, "")}`,
            type: "message",
            role: "assistant",
            model: translated.effectiveModel,
            content: [{ type: "text", text }],
            stop_reason: "end_turn",
            usage: {
              input_tokens: data.usageMetadata?.promptTokenCount || 0,
              output_tokens: data.usageMetadata?.candidatesTokenCount || 0,
            }
          });
        }
      } catch (error) {
        log.error("Failed proxying request", { error: String(error) });
        sendJSON(res, 500, {
          error: {
            type: "api_error",
            message: `Proxy failed to connect to Google Antigravity: ${String(error)}`,
          }
        });
      }
      return;
    }

    // OpenAI Responses API (Phase 3 - placeholder)
    if (path === "/v1/responses" && req.method === "POST") {
      sendJSON(res, 501, { error: "OpenAI Responses API not yet implemented. Coming in Phase 3." });
      return;
    }

    // Model discovery
    if (path === "/v1/models" && req.method === "GET") {
      sendJSON(res, 200, {
        object: "list",
        data: [
          { id: "claude-sonnet-4-6", object: "model", owned_by: "antigravity" },
          { id: "claude-opus-4-6", object: "model", owned_by: "antigravity" },
          { id: "gemini-3.5-flash", object: "model", owned_by: "antigravity" },
          { id: "gemini-3.5-pro", object: "model", owned_by: "antigravity" },
          { id: "gemini-3.1-pro-preview", object: "model", owned_by: "antigravity" },
        ],
      });
      return;
    }

    sendJSON(res, 404, { error: "Not found" });
  } catch (error) {
    log.error("Request handler error", { error: String(error), path });
    sendJSON(res, 500, { error: "Internal server error" });
  }
}

/**
 * Start the proxy server.
 */
export function startProxyServer(port = PROXY_PORT): void {
  const server = createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      log.error("Unhandled error", { error: String(error) });
      if (!res.headersSent) {
        sendJSON(res, 500, { error: "Internal server error" });
      }
    });
  });

  server.listen(port, "127.0.0.1", () => {
    log.info(`Antigravity proxy server running at http://localhost:${port}`);
    log.info(`Web UI:            http://localhost:${port}/`);
    log.info(`Anthropic API:     http://localhost:${port}/v1/messages`);
    log.info(`OpenAI API:        http://localhost:${port}/v1/responses`);
    log.info(`Account management: http://localhost:${port}/api/accounts`);
  });

  server.on("error", (error) => {
    log.error("Server error", { error: String(error) });
  });
}

// Direct execution
if (process.argv[1]?.includes("server")) {
  startProxyServer();
}
