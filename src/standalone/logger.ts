/**
 * Standalone logger for the proxy server.
 * Replaces the plugin logger that depends on PluginClient TUI.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, extra?: Record<string, unknown>): void;
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
}

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};
const RESET = "\x1b[0m";

export function createStandaloneLogger(module: string): Logger {
  const prefix = `[antigravity.${module}]`;

  const log = (level: LogLevel, message: string, extra?: Record<string, unknown>): void => {
    const color = LEVEL_COLORS[level];
    const timestamp = new Date().toISOString().slice(11, 23);
    const extraStr = extra ? ` ${JSON.stringify(extra)}` : "";
    const output = `${color}${timestamp} ${level.toUpperCase().padEnd(5)} ${prefix} ${message}${extraStr}${RESET}`;

    if (level === "error") {
      console.error(output);
    } else if (level === "warn") {
      console.warn(output);
    } else {
      console.log(output);
    }
  };

  return {
    debug: (message, extra) => log("debug", message, extra),
    info: (message, extra) => log("info", message, extra),
    warn: (message, extra) => log("warn", message, extra),
    error: (message, extra) => log("error", message, extra),
  };
}
