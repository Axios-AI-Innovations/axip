/**
 * AXIP Relay — Structured JSON Logger
 *
 * Outputs newline-delimited JSON logs to stdout (debug/info/warn) and stderr (error).
 * Format: {"ts":"...","level":"info","module":"server","msg":"...","data":{...}}
 *
 * No external dependencies.
 */

function _log(level, module, msg, data) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    module,
    msg
  };
  if (data !== undefined && data !== null) {
    entry.data = data;
  }
  const line = JSON.stringify(entry);
  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export const debug = (module, msg, data) => _log('debug', module, msg, data);
export const info  = (module, msg, data) => _log('info',  module, msg, data);
export const warn  = (module, msg, data) => _log('warn',  module, msg, data);
export const error = (module, msg, data) => _log('error', module, msg, data);
