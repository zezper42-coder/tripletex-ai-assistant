import { LogEntry, LogLevel } from "./types.ts";

export class Logger {
  private entries: LogEntry[] = [];
  private module: string;

  constructor(module: string) {
    this.module = module;
  }

  private log(level: LogLevel, message: string, data?: unknown) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module: this.module,
      message,
      data,
    };
    this.entries.push(entry);
    const prefix = `[${entry.timestamp}] [${level.toUpperCase()}] [${this.module}]`;
    if (level === "error") {
      console.error(prefix, message, data ?? "");
    } else if (level === "warn") {
      console.warn(prefix, message, data ?? "");
    } else {
      console.log(prefix, message, data ?? "");
    }
  }

  debug(msg: string, data?: unknown) { this.log("debug", msg, data); }
  info(msg: string, data?: unknown) { this.log("info", msg, data); }
  warn(msg: string, data?: unknown) { this.log("warn", msg, data); }
  error(msg: string, data?: unknown) { this.log("error", msg, data); }

  getEntries(): LogEntry[] { return [...this.entries]; }

  child(subModule: string): Logger {
    const child = new Logger(`${this.module}:${subModule}`);
    child.entries = this.entries; // share log buffer
    return child;
  }
}
