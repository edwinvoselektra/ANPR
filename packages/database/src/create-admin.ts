import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const prisma = new PrismaClient();

async function hiddenPrompt(label: string): Promise<string> {
  if (!stdin.isTTY) throw new Error("Deze veilige admin-opdracht vereist een interactieve terminal (TTY).");
  stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", onData); stdout.write("\n"); };
    const onData = (key: string) => {
      if (key === "\u0003") { cleanup(); reject(new Error("Afgebroken.")); return; }
      if (key === "\r" || key === "\n") { cleanup(); resolve(value); return; }
      if (key === "\u007f") { value = value.slice(0, -1); return; }
      if (key >= " ") value += key;
    };
    stdin.on("data", onData);
  });
}

const rl = createInterface({ input: stdin, output: stdout });
try {
  console.log("Veilige eerste-administrator wizard (er bestaat geen standaardwachtwoord).\n");
  const email = (await rl.question("E-mailadres: ")).trim().toLowerCase();
  const username = (await rl.question("Gebruikersnaam: ")).trim().toLowerCase();
  const displayName = (await rl.question("Weergavenaam: ")).trim();
  rl.close();
  const password = await hiddenPrompt("Wachtwoord (wordt niet getoond): ");
  const confirmation = await hiddenPrompt("Herhaal wachtwoord: ");
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Ongeldig e-mailadres.");
  if (!/^[a-z0-9._-]{3,50}$/.test(username)) throw new Error("Gebruikersnaam moet 3–50 geldige tekens bevatten.");
  if (displayName.length < 2) throw new Error("Weergavenaam is te kort.");
  if (password !== confirmation) throw new Error("De wachtwoorden zijn niet gelijk.");
  if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) throw new Error("Gebruik minimaal 12 tekens, hoofdletters, kleine letters en cijfers.");
  const role = await prisma.role.findUnique({ where: { name: "Administrator" } });
  if (!role) throw new Error("Voer eerst de seed-opdracht uit zodat de rollen bestaan.");
  const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] } });
  if (existing) throw new Error("Er bestaat al een gebruiker met dit e-mailadres of deze gebruikersnaam.");
  const user = await prisma.user.create({ data: {
    email, username, displayName, passwordHash: await bcrypt.hash(password, 12), roles: { create: { roleId: role.id } }
  }});
  await prisma.auditLog.create({ data: { actorId: user.id, action: "FIRST_ADMIN_CREATED", objectType: "User", objectId: user.id } });
  console.log(`Administrator '${username}' is veilig aangemaakt.`);
} catch (error) {
  rl.close();
  console.error(error instanceof Error ? error.message : "Administrator aanmaken mislukt.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
