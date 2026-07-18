/**
 * Standalone token refresh module.
 * Decoupled from PluginClient — uses direct HTTP requests and storage.
 */

import { ANTIGRAVITY_CLIENT_ID, ANTIGRAVITY_CLIENT_SECRET } from "../constants";
import { calculateTokenExpiry } from "../plugin/auth";
import { createStandaloneLogger } from "./logger";

const log = createStandaloneLogger("token");

export class TokenRefreshError extends Error {
  code?: string;
  status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "TokenRefreshError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Refresh an OAuth access token using the stored refresh token.
 * Returns updated auth details, or throws TokenRefreshError on failure.
 */
export async function refreshAccessToken(
  refreshToken: string,
  projectId?: string,
  managedProjectId?: string,
): Promise<{ access: string; expires: number; refreshToken: string }> {
  const startTime = Date.now();

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: ANTIGRAVITY_CLIENT_ID,
      client_secret: ANTIGRAVITY_CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    let errorText: string | undefined;
    try {
      errorText = await response.text();
    } catch {
      errorText = undefined;
    }

    let code: string | undefined;
    try {
      const payload = JSON.parse(errorText || "{}");
      code = typeof payload.error === "string" ? payload.error : payload.error?.status;
    } catch {}

    if (code === "invalid_grant") {
      log.warn("Refresh token revoked — account needs re-authentication");
    }

    throw new TokenRefreshError(
      `Token refresh failed (${response.status}): ${errorText || response.statusText}`,
      response.status,
      code,
    );
  }

  const payload = (await response.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };

  return {
    access: payload.access_token,
    expires: calculateTokenExpiry(startTime, payload.expires_in),
    refreshToken: payload.refresh_token ?? refreshToken,
  };
}

/**
 * Check if an access token is expired or about to expire (60s buffer).
 */
export function isTokenExpired(expires?: number): boolean {
  if (typeof expires !== "number") return true;
  return expires <= Date.now() + 60_000;
}
