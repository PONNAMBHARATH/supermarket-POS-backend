import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
const p = new PrismaClient();
async function main() {
  const passwordHash = await bcrypt.hash("ChangeMe123!", 12);
  await p.user.upsert({
    where: { username: "owner" },
    update: {},
    create: {
      name: "Store Owner",
      username: "owner",
      passwordHash,
      role: Role.OWNER,
    },
  });
  for (const name of ["Counter 1", "Counter 2"])
    await p.counter.upsert({ where: { name }, update: {}, create: { name } });
  for (const [key, value] of Object.entries({
    store_name: "My Supermarket",
    tax_enabled: "false",
    default_tax_rate: "0",
    currency: "INR",
  }))
    await p.appSetting.upsert({
      where: { key },
      update: {},
      create: { key, value },
    });
}
main().finally(() => p.$disconnect());
