import type { AccountQuotaResult, QuotaGroup, QuotaGroupSummary } from "./quota";
import type { AccountMetadataV3, AccountStorageV4 } from "./storage";

type Status = "healthy" | "warning" | "critical" | "unknown";

function maskEmail(email?: string): string {
  if (!email || !email.includes("@")) {
    return email || "unknown";
  }

  const [local, domain] = email.split("@");
  return `${local?.slice(0, 1) || "*"}***@${domain}`;
}

function clampFraction(value?: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Math.min(1, value));
}

function formatPercent(value?: number): string {
  const fraction = clampFraction(value);
  return fraction === undefined ? "???" : `${Math.round(fraction * 100)}%`;
}

function formatBar(value?: number, width = 20): string {
  const fraction = clampFraction(value);
  if (fraction === undefined) {
    return `${"░".repeat(width)} ???`;
  }

  const filled = Math.round(fraction * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)} ${formatPercent(fraction)}`;
}

function formatDate(timestamp: number | string | undefined): string {
  const value = typeof timestamp === "string" ? Date.parse(timestamp) : timestamp;
  if (!value || !Number.isFinite(value)) {
    return "";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];

  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (!days && minutes) parts.push(`${minutes}m`);

  return parts.join(" ") || `${totalMinutes}m`;
}

function formatReset(resetTime: string | undefined, now: number): string {
  if (!resetTime) {
    return "";
  }

  const timestamp = Date.parse(resetTime);
  if (!Number.isFinite(timestamp)) {
    return "";
  }

  const remaining = timestamp - now;
  const duration = remaining > 0 ? ` (${formatDuration(remaining)})` : "";
  return ` reset: ${formatDate(timestamp)}${duration}`;
}

function getStatus(value?: number): Status {
  const fraction = clampFraction(value);
  if (fraction === undefined) {
    return "unknown";
  }
  if (fraction <= 0.1) {
    return "critical";
  }
  if (fraction <= 0.3) {
    return "warning";
  }
  return "healthy";
}

function getStatusMarker(status: Status): string {
  if (status === "healthy") return "🟢";
  if (status === "warning") return "🟡";
  if (status === "critical") return "🔴";
  return "⚪";
}

function formatQuotaLine(label: string, quota: QuotaGroupSummary, now: number): string[] {
  return [
    `  ${getStatusMarker(getStatus(quota.remainingFraction))} ${label.padEnd(15)}: ${formatBar(quota.remainingFraction)} (${quota.modelCount} models)`,
    quota.resetTime ? `      Reset: ${formatDate(quota.resetTime)}` : "",
  ].filter(Boolean);
}

function formatPrimaryQuota(account: AccountMetadataV3, result: AccountQuotaResult | undefined, now: number): string[] {
  const lines = ["🎯 Primary Pool (Antigravity - Used by default):"];
  
  const quotaGroups = result?.quota?.groups && Object.keys(result.quota.groups).length > 0 
    ? result.quota.groups 
    : account.cachedQuota;

  if (!quotaGroups || Object.keys(quotaGroups).length === 0) {
    if (result?.status === "error" || result?.quota?.error) {
      return [...lines, `    error: ${result?.quota?.error || result?.error || "unavailable"}`];
    }
    return [...lines, "  unavailable"];
  }

  const activeLimits = getActiveRateLimits(account, now);

  const processQuota = (group: QuotaGroup, cached: QuotaGroupSummary) => {
    const quota = { ...cached };
    let maxResetTime = 0;
    let hasLimit = false;

    for (const [key, resetTime] of activeLimits) {
      const lowerKey = key.toLowerCase();
      if (group === "claude" && lowerKey.includes("claude")) {
        hasLimit = true;
        maxResetTime = Math.max(maxResetTime, resetTime);
      } else if (group === "gemini-flash" && (lowerKey.includes("flash") || lowerKey.includes("flash-lite"))) {
        hasLimit = true;
        maxResetTime = Math.max(maxResetTime, resetTime);
      } else if (group === "gemini-pro" && lowerKey.includes("pro")) {
        hasLimit = true;
        maxResetTime = Math.max(maxResetTime, resetTime);
      }
    }

    if (hasLimit) {
      quota.remainingFraction = 0;
      quota.resetTime = new Date(maxResetTime).toISOString();
    }
    return quota;
  };

  const processedPro = quotaGroups["gemini-pro"] ? processQuota("gemini-pro", quotaGroups["gemini-pro"]) : null;
  const processedFlash = quotaGroups["gemini-flash"] ? processQuota("gemini-flash", quotaGroups["gemini-flash"]) : null;
  const processedClaude = quotaGroups["claude"] ? processQuota("claude", quotaGroups["claude"]) : null;

  // Conditionally merge gemini-pro and gemini-flash if they share the exact same quota state
  if (processedPro && processedFlash && 
      processedPro.remainingFraction === processedFlash.remainingFraction && 
      processedPro.resetTime === processedFlash.resetTime) {
    const mergedQuota = {
      remainingFraction: processedPro.remainingFraction,
      resetTime: processedPro.resetTime,
      modelCount: processedPro.modelCount + processedFlash.modelCount
    };
    lines.push(...formatQuotaLine("gemini", mergedQuota, now));
  } else {
    if (processedPro) lines.push(...formatQuotaLine("gemini-pro", processedPro, now));
    if (processedFlash) lines.push(...formatQuotaLine("gemini-flash", processedFlash, now));
  }
  
  if (processedClaude) lines.push(...formatQuotaLine("claude", processedClaude, now));

  return lines;
}

function formatRateLimitName(key: string): string {
  const separator = key.indexOf(":");
  if (separator === -1) {
    return key;
  }

  return `${key.slice(0, separator)}/${key.slice(separator + 1)}`;
}

function getActiveRateLimits(account: AccountMetadataV3, now: number): Array<[string, number]> {
  const active: Array<[string, number]> = [];
  for (const [key, resetTime] of Object.entries(account.rateLimitResetTimes ?? {})) {
    if (typeof resetTime === "number" && resetTime > now) {
      active.push([key, resetTime]);
    }
  }

  return active.sort(([, left], [, right]) => left - right);
}

function formatActiveRateLimits(account: AccountMetadataV3, now: number): string[] {
  const active = getActiveRateLimits(account, now);
  const lines = ["⚡ Active Rate Limits (Antigravity):"];
  if (active.length === 0) {
    return [...lines, "  none active"];
  }

  const names = active.map(([key]) => formatRateLimitName(key));
  const width = Math.max(...names.map((name) => name.length), 1);
  for (const [[, resetTime], name] of active.map((rate, index) => [rate, names[index]!] as const)) {
    lines.push(
      `  🟡 ${name.padEnd(width)} : ${formatDuration(resetTime - now)}, reset: ${formatDate(resetTime)}`,
    );
  }

  return lines;
}

function formatGeminiCliQuota(result: AccountQuotaResult | undefined, now: number): string[] {
  const quota = result?.geminiCliQuota;
  const lines = ["", "📊 Fallback Pool (Gemini CLI - Used on rate limit or cli_first=true):"];
  if (result?.status === "error") {
    return [...lines, `    error: ${result.error}`];
  }
  if (!quota || quota.models.length === 0) {
    return [...lines, `    ${quota?.error || "unavailable"}`];
  }

  const groups = new Map<string, { remainingFraction: number; resetTime?: string; models: string[] }>();
  
  for (const model of quota.models) {
    const key = `${model.remainingFraction}-${model.resetTime ?? ""}`;
    if (!groups.has(key)) {
      groups.set(key, {
        remainingFraction: model.remainingFraction,
        resetTime: model.resetTime,
        models: [],
      });
    }
    groups.get(key)!.models.push(model.modelId);
  }

  for (const group of groups.values()) {
    let label = "gemini";
    if (groups.size > 1) {
      if (group.models.every(m => m.includes("pro"))) label = "gemini-pro";
      else if (group.models.every(m => m.includes("flash"))) label = "gemini-flash";
      else if (group.models.length === 1) label = group.models[0]!;
      else label = `gemini (${group.models.length} models)`;
    }

    lines.push(
      `  ${getStatusMarker(getStatus(group.remainingFraction))} ${label.padEnd(15)}: ${formatBar(group.remainingFraction)} (${group.models.length} models)`
    );
    if (group.resetTime) {
      lines.push(`      Reset: ${formatDate(group.resetTime)}`);
    }
  }

  return lines;
}

function getOverallStatus(account: AccountMetadataV3, result: AccountQuotaResult | undefined, now: number): Status {
  if (getActiveRateLimits(account, now).length > 0) {
    return "warning";
  }

  const quotaGroups = result?.quota?.groups && Object.keys(result.quota.groups).length > 0 
    ? result.quota.groups 
    : account.cachedQuota;

  const quotas = Object.values(quotaGroups ?? {});
  if (quotas.length === 0) {
    return "unknown";
  }

  if (quotas.some((quota) => getStatus(quota.remainingFraction) === "critical")) {
    return "critical";
  }
  if (quotas.some((quota) => getStatus(quota.remainingFraction) === "warning")) {
    return "warning";
  }

  return "healthy";
}

export function renderQuotaReport(
  storage: AccountStorageV4,
  results: AccountQuotaResult[],
  now = Date.now(),
): string {
  const lines = [
    `Unified Quota Status (${formatDate(now)} MSK)`,
    "=".repeat(60),
  ];

  for (const [index, account] of storage.accounts.entries()) {
    const result = results.find((item) => item.index === index);
    const overallStatus = getOverallStatus(account, result, now);

    lines.push("");
    lines.push(`Account ${index + 1}: ${maskEmail(account.email)}${account.enabled === false ? " (disabled)" : ""}`);
    lines.push(...formatPrimaryQuota(account, result, now));
    lines.push(...formatActiveRateLimits(account, now));
    lines.push(...formatGeminiCliQuota(result, now));
    lines.push("");
    lines.push(`${getStatusMarker(overallStatus)} Overall Status: ${overallStatus.toUpperCase()}`);
  }

  lines.push("");
  lines.push("💡 Routing & Fallback Rules:");
  lines.push("• Antigravity (🎯) is the primary pool. Claude models always use this pool.");
  lines.push("• Gemini CLI (📊) is the fallback pool for Gemini models when Antigravity is rate-limited.");
  lines.push("• Use 'cli_first: true' in config to force Gemini CLI pool usage first.");

  return lines.join("\n");
}
