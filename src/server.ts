import { createHash, randomUUID } from "node:crypto";
import { lineAmounts } from "./billing";
import express, { type RequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import swaggerUi from "swagger-ui-express";
import { db } from "./db";
import { auth, owner } from "./auth";
import { config } from "./config";
import { imageExtension, imageTypes, uploadImage } from "./storage";
const app = express();
app.use(helmet());
app.use(cors({ origin: config.cors }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));
const wrap =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
app.get("/health", (_q, r) => r.json({ status: "ok" }));
app.post(
  "/api/v1/auth/login",
  wrap(async (q, r) => {
    const b = z
      .object({ username: z.string(), password: z.string() })
      .parse(q.body);
    const u = await db.user.findUnique({ where: { username: b.username } });
    if (!u || !u.active || !(await bcrypt.compare(b.password, u.passwordHash)))
      return r.status(401).json({ error: "Invalid credentials" });
    const token = jwt.sign(
      { id: u.id, username: u.username, role: u.role },
      config.secret,
      { expiresIn: config.expires as any },
    );
    r.json({
      token,
      user: { id: u.id, name: u.name, username: u.username, role: u.role },
    });
  }),
);
app.get(
  "/api/v1/auth/me",
  auth,
  wrap(async (q: any, r) =>
    r.json(
      await db.user.findUnique({
        where: { id: q.user.id },
        select: { id: true, name: true, username: true, role: true },
      }),
    ),
  ),
);
app.post(
  "/api/v1/auth/users",
  auth,
  owner,
  wrap(async (q, r) => {
    const b = z
      .object({
        name: z.string().min(1),
        username: z.string().min(3),
        password: z.string().min(10),
        role: z.enum(["OWNER", "CASHIER"]).default("CASHIER"),
      })
      .parse(q.body);
    const u = await db.user.create({
      data: {
        name: b.name,
        username: b.username,
        passwordHash: await bcrypt.hash(b.password, 12),
        role: b.role,
      },
    });
    r.status(201).json({
      id: u.id,
      name: u.name,
      username: u.username,
      role: u.role,
    });
  }),
);
app.post(
  "/api/v1/images",
  auth,
  owner,
  express.raw({ type: imageTypes, limit: "5mb", inflate: false }),
  wrap(async (q, r) => {
    const type =
      q.headers["content-type"]?.split(";")[0].trim().toLowerCase() ?? "";
    const extension = Buffer.isBuffer(q.body) && imageExtension(q.body, type);
    if (!extension) {
      return r.status(415).json({ error: "Upload a JPEG, PNG, or WebP image" });
    }
    const imageUrl = await uploadImage(q.body, type, extension);
    if (!imageUrl) {
      return r.status(503).json({ error: "Object storage is not configured" });
    }
    r.status(201).json({ imageUrl });
  }),
);
app.get(
  "/api/v1/products",
  auth,
  wrap(async (q, r) => {
    const s = String(q.query.q || "");
    const { page, limit } = z
      .object({
        page: z.coerce
          .number()
          .int()
          .min(1)
          .max(Number.MAX_SAFE_INTEGER / 100)
          .default(1),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(q.query);
    const where: Prisma.ProductWhereInput = {
      ...(q.query.active === "true" ? { active: true } : {}),
      ...(typeof q.query.barcode === "string"
        ? { barcode: q.query.barcode }
        : {}),
      ...(s
        ? {
            OR: [
              { name: { contains: s } },
              { barcode: { contains: s } },
              { sku: { contains: s } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      db.product.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: "asc" },
      }),
      db.product.count({ where }),
    ]);
    r.json({ items, total, page, limit });
  }),
);
app.get(
  "/api/v1/products/:id",
  auth,
  wrap(async (q, r) => {
    const p = await db.product.findUnique({
      where: { id: Number(q.params.id) },
    });
    if (!p) return r.status(404).json({ error: "Product not found" });
    r.json(p);
  }),
);
app.post(
  "/api/v1/products",
  auth,
  owner,
  wrap(async (q, r) => {
    const b = z
      .object({
        barcode: z.string().nullable().optional(),
        sku: z.string().nullable().optional(),
        name: z.string().min(1),
        description: z.string().optional(),
        category: z.string().optional(),
        unit: z.string().default("pcs"),
        sellingPrice: z.coerce.number().nonnegative(),
        purchaseCost: z.coerce.number().nonnegative().default(0),
        taxRate: z.coerce.number().min(0).max(100).default(0),
        imageUrl: z.string().url().optional(),
      })
      .parse(q.body);
    r.status(201).json(await db.product.create({ data: b }));
  }),
);
app.put(
  "/api/v1/products/:id",
  auth,
  owner,
  wrap(async (q, r) => {
    const b = z
      .object({
        barcode: z.string().nullable().optional(),
        sku: z.string().nullable().optional(),
        name: z.string().min(1).optional(),
        sellingPrice: z.coerce.number().nonnegative().optional(),
        purchaseCost: z.coerce.number().nonnegative().optional(),
        taxRate: z.coerce.number().min(0).max(100).optional(),
        category: z.string().optional(),
        unit: z.string().optional(),
        imageUrl: z.string().url().optional(),
        active: z.boolean().optional(),
      })
      .parse(q.body);
    r.json(
      await db.product.update({ where: { id: Number(q.params.id) }, data: b }),
    );
  }),
);
app.delete(
  "/api/v1/products/:id",
  auth,
  owner,
  wrap(async (q, r) => {
    await db.product.update({
      where: { id: Number(q.params.id) },
      data: { active: false },
    });
    r.status(204).end();
  }),
);
app.get(
  "/api/v1/customers",
  auth,
  wrap(async (q, r) => {
    const s = String(q.query.q || "");
    r.json(
      await db.customer.findMany({
        where: s
          ? { OR: [{ name: { contains: s } }, { phone: { contains: s } }] }
          : {},
        take: 100,
      }),
    );
  }),
);
app.post(
  "/api/v1/customers",
  auth,
  wrap(async (q, r) => {
    const b = z
      .object({ name: z.string().min(1), phone: z.string().min(8).max(20) })
      .parse(q.body);
    r.status(201).json(
      await db.customer.upsert({
        where: { phone: b.phone },
        update: { name: b.name },
        create: b,
      }),
    );
  }),
);
app.get(
  "/api/v1/counters",
  auth,
  wrap(async (_q, r) =>
    r.json(await db.counter.findMany({ where: { active: true } })),
  ),
);
app.post(
  "/api/v1/counters",
  auth,
  owner,
  wrap(async (q, r) => {
    const name = z.string().min(1).parse(q.body.name);
    r.status(201).json(await db.counter.create({ data: { name } }));
  }),
);
app.post(
  "/api/v1/sales/checkout",
  auth,
  wrap(async (q: any, r) => {
    const b = z
      .object({
        checkoutKey: z.string().uuid(),
        expectedTotal: z.number().finite().nonnegative(),
        counterId: z.number().int().positive(),
        customer: z
          .object({ name: z.string().trim().min(1).max(191), phone: z.string().trim().min(8).max(20) })
          .optional(),
        customerId: z.number().int().positive().optional(),
        paymentMode: z.enum(["CASH", "UPI"]),
        discount: z.number().finite().nonnegative().multipleOf(0.01).default(0),
        notes: z.string().optional(),
        items: z
          .array(
            z.object({
              productId: z.number().int().positive(),
              quantity: z.number().finite().positive().max(999999999).multipleOf(0.001),
            }),
          )
          .min(1).max(500),
      })
      .parse(q.body);
    const requestHash = createHash("sha256").update(JSON.stringify({ ...b, userId: q.user.id })).digest("hex");
    const existing = await db.sale.findUnique({ where: { checkoutKey: b.checkoutKey }, include: { items: true, customer: true, counter: true, user: { select: { name: true } } } });
    if (existing) {
      if (existing.requestHash !== requestHash) return r.status(409).json({ error: "Checkout key already used for a different bill" });
      return r.json(existing);
    }
    const cashier = await db.user.findUnique({ where: { id: q.user.id } });
    if (!cashier?.active) return r.status(401).json({ error: "Staff account is inactive" });
    if (b.discount > 0 && cashier.role !== "OWNER")
      return r.status(403).json({ error: "Owner approval required for discount" });
    if (new Set(b.items.map(i => i.productId)).size !== b.items.length)
      return r.status(400).json({ error: "Combine duplicate products into one bill line" });
    if (b.customer && b.customerId) return r.status(400).json({ error: "Choose one customer" });
    const counter = await db.counter.findFirst({ where: { id: b.counterId, active: true } });
    if (!counter) return r.status(400).json({ error: "Invalid or inactive counter" });
    if (b.customerId && !await db.customer.findUnique({ where: { id: b.customerId } }))
      return r.status(400).json({ error: "Customer not found" });
    const ps = await db.product.findMany({ where: { id: { in: b.items.map(i => i.productId) }, active: true } });
    if (ps.length !== b.items.length) return r.status(400).json({ error: "Invalid or inactive product" });
    const taxSetting = await db.appSetting.findUnique({ where: { key: "tax_enabled" } });
    const taxEnabled = taxSetting?.value === "true";
    let subtotalCents = 0, taxCents = 0;
    const lines = b.items.map(i => {
      const p = ps.find(x => x.id === i.productId)!;
      const taxRate = taxEnabled ? p.taxRate : 0;
      const amounts = lineAmounts(p.sellingPrice.toString(), i.quantity, taxRate.toString());
      subtotalCents += amounts.base;
      taxCents += amounts.tax;
      return { productId: p.id, productName: p.name, quantity: i.quantity, unitPrice: p.sellingPrice,
        purchaseCost: p.purchaseCost, taxRate, lineTotal: amounts.total / 100 };
    });
    const discountCents = Math.round(b.discount * 100);
    const totalCents = subtotalCents + taxCents - discountCents;
    if (totalCents < 0) return r.status(400).json({ error: "Discount exceeds bill total" });
    if (totalCents > 999999999999) return r.status(400).json({ error: "Bill exceeds supported amount" });
    if (Math.round(b.expectedTotal * 100) !== totalCents)
      return r.status(409).json({ error: "Prices or tax settings changed. Refresh the billing page and rebuild the bill before collecting payment." });
    let sale;
    try {
      sale = await db.$transaction(async tx => {
        const customer = b.customer ? await tx.customer.upsert({ where: { phone: b.customer.phone }, update: {}, create: b.customer }) : null;
        return tx.sale.create({ data: {
          checkoutKey: b.checkoutKey, requestHash, invoiceNo: "INV-" + randomUUID(),
          customerId: customer?.id ?? b.customerId, userId: q.user.id, counterId: b.counterId,
          subtotal: subtotalCents / 100, discount: b.discount, taxTotal: taxCents / 100,
          grandTotal: totalCents / 100, paymentMode: b.paymentMode, notes: b.notes,
          items: { create: lines },
        }, include: { items: true, customer: true, counter: true, user: { select: { name: true } } } });
      });
    } catch (error) {
      // A concurrent retry may have committed the same checkout first.
      const saved = await db.sale.findUnique({ where: { checkoutKey: b.checkoutKey }, include: { items: true, customer: true, counter: true, user: { select: { name: true } } } });
      if (!saved || saved.requestHash !== requestHash) throw error;
      sale = saved;
    }
    r.status(201).json(sale);
  }),
);
app.get(
  "/api/v1/sales",
  auth,
  wrap(async (q, r) => {
    const day = q.query.date ? new Date(`${q.query.date}T00:00:00`) : undefined;
    if (day && Number.isNaN(day.getTime()))
      return r.status(400).json({ error: "Invalid sales date" });
    const from = q.query.from
      ? new Date(String(q.query.from))
      : (day ?? new Date(new Date().setHours(0, 0, 0, 0)));
    const to = q.query.to
      ? new Date(String(q.query.to))
      : day
        ? new Date(new Date(day).setHours(23, 59, 59, 999))
        : new Date();
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from > to
    ) {
      return r.status(400).json({ error: "Invalid sales date range" });
    }
    r.json(
      await db.sale.findMany({
        where: { createdAt: { gte: from, lte: to } },
        include: { items: true, customer: true, counter: true, user: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    );
  }),
);
app.get(
  "/api/v1/sales/reports/daily",
  auth,
  owner,
  wrap(async (q, r) => {
    const d = q.query.date ? new Date(`${q.query.date}T00:00:00`) : new Date();
    if (Number.isNaN(d.getTime()))
      return r.status(400).json({ error: "Invalid report date" });
    const from = new Date(d);
    from.setHours(0, 0, 0, 0);
    const to = new Date(d);
    to.setHours(23, 59, 59, 999);
    const sales = await db.sale.findMany({
      where: { createdAt: { gte: from, lte: to } },
      include: { items: true, counter: true },
    });
    const revenue = sales.reduce((a, s) => a + Number(s.grandTotal), 0);
    const gross = sales.reduce(
      (a, s) =>
        a +
        s.items.reduce(
          (x, i) =>
            x +
            (Number(i.unitPrice) - Number(i.purchaseCost)) * Number(i.quantity),
          0,
        ),
      0,
    );
    const payments = {
      CASH: { count: 0, total: 0 },
      UPI: { count: 0, total: 0 },
    };
    const counters: Record<
      number,
      { id: number; name: string; count: number; total: number }
    > = {};
    for (const sale of sales) {
      const total = Number(sale.grandTotal);
      const payment = payments[sale.paymentMode];
      payment.count += 1;
      payment.total += total;
      const counter = (counters[sale.counterId] ??= {
        id: sale.counterId,
        name: sale.counter.name,
        count: 0,
        total: 0,
      });
      counter.count += 1;
      counter.total += total;
    }
    r.json({
      date: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-${String(from.getDate()).padStart(2, "0")}`,
      billCount: sales.length,
      revenue,
      grossProfitEstimate: gross - sales.reduce((sum, sale) => sum + Number(sale.discount), 0),
      payments,
      counters: Object.values(counters),
    });
  }),
);
app.get(
  "/api/v1/settings",
  auth,
  wrap(async (_q, r) => r.json(await db.appSetting.findMany())),
);
app.put(
  "/api/v1/settings",
  auth,
  owner,
  wrap(async (q, r) => {
    const b = z.record(z.string()).parse(q.body);
    const rows = await db.$transaction(
      Object.entries(b).map(([key, value]) =>
        db.appSetting.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        }),
      ),
    );
    r.json(rows);
  }),
);
app.get(
  "/api/v1/offers",
  auth,
  wrap(async (_q, r) =>
    r.json(await db.offer.findMany({ where: { active: true } })),
  ),
);
app.post(
  "/api/v1/offers",
  auth,
  owner,
  wrap(async (q, r) => {
    const b = z
      .object({
        title: z.string().min(1),
        message: z.string().min(1),
        discountPct: z.number().min(0).max(100).optional(),
        imageUrl: z.string().url().optional(),
      })
      .parse(q.body);
    r.status(201).json(await db.offer.create({ data: b }));
  }),
);
app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup({
    openapi: "3.0.0",
    info: { title: "Supermarket POS API", version: "1.0.0" },
    servers: [{ url: "http://localhost:8080" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
    paths: {
      "/health": {
        get: {
          summary: "Health check",
          responses: { "200": { description: "OK" } },
        },
      },
    },
  }),
);
app.use((err: any, _q: any, r: any, _n: any) => {
  if (err?.type === "entity.too.large") {
    return r.status(413).json({ error: "The upload exceeds the size limit" });
  }
  if (err?.type === "encoding.unsupported") {
    return r.status(415).json({ error: "Unsupported upload encoding" });
  }
  console.error(err);
  r.status(err?.name === "ZodError" ? 400 : 500).json({
    error:
      err?.name === "ZodError" ? "Validation failed" : "Internal server error",
    details: err?.issues,
  });
});
app.listen(config.port, () =>
  console.log("POS API listening on " + config.port),
);
