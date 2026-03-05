const { execSync } = require("child_process");

const ports = process.argv.slice(2)
  .map((p) => Number(p))
  .filter((p) => Number.isFinite(p) && p > 0);

if (!ports.length) {
  console.log("[kill-ports] No ports specified.");
  process.exit(0);
}

const run = (cmd) => execSync(cmd, { stdio: "pipe" }).toString("utf8");

const findPidsForPort = (port) => {
  try {
    const output = run("netstat -ano -p tcp");
    const lines = output.split(/\r?\n/);
    const pids = new Set();
    const matcher = new RegExp(`[:.]${port}\\s`, "i");
    for (const line of lines) {
      if (!matcher.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && pid !== "0" && /^\d+$/.test(pid)) {
        pids.add(pid);
      }
    }
    return Array.from(pids);
  } catch (err) {
    console.warn(`[kill-ports] Failed to scan for port ${port}: ${err.message}`);
    return [];
  }
};

const killPid = (pid) => {
  try {
    run(`taskkill /F /PID ${pid}`);
    console.log(`[kill-ports] Killed PID ${pid}`);
    return true;
  } catch (err) {
    console.warn(`[kill-ports] Failed to kill PID ${pid}: ${err.message}`);
    return false;
  }
};

for (const port of ports) {
  const pids = findPidsForPort(port);
  if (!pids.length) {
    console.log(`[kill-ports] Port ${port} is free.`);
    continue;
  }
  console.log(`[kill-ports] Port ${port} in use by PID(s): ${pids.join(", ")}`);
  for (const pid of pids) {
    killPid(pid);
  }
}
