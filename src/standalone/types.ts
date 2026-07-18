/**
 * Standalone types for the proxy server.
 * These mirror the plugin types but without @opencode-ai/plugin dependency.
 */

export interface OAuthAuthDetails {
  type: "oauth";
  refresh: string;
  access?: string;
  expires?: number;
}

export interface RefreshParts {
  refreshToken: string;
  projectId?: string;
  managedProjectId?: string;
}

export interface ProxyAccount {
  index: number;
  email?: string;
  projectId?: string;
  enabled: boolean;
  isRateLimited: boolean;
  rateLimitResetTimes: Record<string, number | undefined>;
  lastUsed: number;
  addedAt: number;
  cachedQuota?: Record<string, { remainingFraction?: number; resetTime?: string; modelCount: number }>;
}

export interface ProxyStatus {
  running: boolean;
  port: number;
  accounts: ProxyAccount[];
  uptime: number;
}
