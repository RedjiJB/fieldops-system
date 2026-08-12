// Interactive account creation, run by the human themselves
// (`npm run create-user`) — there is no public register endpoint, so this
// is the only way a dashboard account gets created.
import "dotenv/config";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { pool } from "./pool.js";
import { hashPassword } from "../lib/password.js";

const ENTER_CODES = new Set([10, 13]); // \n, \r
const CTRL_C_CODE = 3;
const BACKSPACE_CODES = new Set([8, 127]); // \b, DEL

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    stdout.write(prompt);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const onData = (char: string) => {
      const code = char.charCodeAt(0);
      if (ENTER_CODES.has(code)) {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        stdout.write("\n");
        resolve(value);
        return;
      }
      if (code === CTRL_C_CODE) process.exit(1);
      if (BACKSPACE_CODES.has(code)) {
        value = value.slice(0, -1);
        return;
      }
      value += char;
    };
    stdin.on("data", onData);
  });
}

async function run() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const name = await rl.question("Name: ");
  const email = await rl.question("Email: ");
  rl.close();
  const password = await askHidden("Password: ");
  const confirm = await askHidden("Confirm password: ");
  if (password !== confirm) {
    console.error("Passwords don't match.");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  try {
    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email",
      [name, email, passwordHash],
    );
    console.log(`Created user ${result.rows[0].email} (${result.rows[0].id})`);
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
