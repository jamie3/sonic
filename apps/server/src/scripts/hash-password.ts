/** Generate a bcrypt hash for AUTH_PASSWORD_HASH. Usage: pnpm hash-password "mypw" */
import bcrypt from "bcryptjs";

const pw = process.argv[2];
if (!pw) {
  console.error('Usage: pnpm --filter @sonic/server hash-password "yourpassword"');
  process.exit(1);
}
console.log(bcrypt.hashSync(pw, 10));
