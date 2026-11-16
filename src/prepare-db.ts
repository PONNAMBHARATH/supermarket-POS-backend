import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// Upgrade existing installs before db push. All additions are nullable, so
// historical sales retain their data and need no fabricated checkout keys.
async function main() {
  const tables = await db.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Sale'
  `;
  if (!Number(tables[0].count)) return; // db push creates fresh installations.

  const columns = await db.$queryRaw<{ name: string }[]>`
    SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Sale'
  `;
  for (const name of ["checkoutKey", "requestHash"]) {
    if (!columns.some(column => column.name === name)) {
      // Names are from the fixed list above, never from request input.
      await db.$executeRawUnsafe(`ALTER TABLE \`Sale\` ADD COLUMN \`${name}\` VARCHAR(191) NULL`);
    }
  }
  const indexes = await db.$queryRaw<{ name: string }[]>`
    SELECT INDEX_NAME AS name FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Sale'
      AND COLUMN_NAME = 'checkoutKey' AND NON_UNIQUE = 0
  `;
  if (!indexes.length) {
    // MySQL allows multiple NULLs. Duplicate non-NULL keys fail safely rather
    // than deleting or rewriting any sales.
    await db.$executeRawUnsafe("CREATE UNIQUE INDEX `Sale_checkoutKey_key` ON `Sale` (`checkoutKey`)");
  }
}

main()
  .catch(error => {
    console.error("Billing schema upgrade failed:", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
