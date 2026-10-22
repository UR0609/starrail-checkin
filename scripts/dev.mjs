import { spawn } from "node:child_process";

const children = [
  spawn("npm", ["run", "dev", "-w", "server"], { stdio: "inherit" }),
  spawn("npm", ["run", "dev", "-w", "client"], { stdio: "inherit" }),
];

function stop() {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
}

process.on("SIGINT", () => {
  stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});

console.log("页面打开 http://127.0.0.1:5173");
console.log("签到服务 http://127.0.0.1:8787");
