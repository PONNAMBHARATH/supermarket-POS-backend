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
        counterId: z.number().int().positive(),
        customer: z
          .object({ name: z.string().min(1), phone: z.string().min(8) })
          .optional(),
        customerId: z.number().int().optional(),
        paymentMode: z.enum(["CASH", "UPI"]),
        discount: z.number().nonnegative().default(0),
        notes: z.string().optional(),
        items: z
          .array(
            z.object({
              productId: z.number().int(),
              quantity: z.number().positive(),
            }),
          )
          .min(1),
      })
      .parse(q.body);
    if (b.discount > 0 && q.user.role !== "OWNER")
      return r
        .status(403)
        .json({ error: "Owner approval required for discount" });
    const ps = await db.product.findMany({
      where: { id: { in: b.items.map((i) => i.productId) }, active: true },
    });
    if (ps.length !== new Set(b.items.map((i) => i.productId)).size)
      return r.status(400).json({ error: "Invalid or inactive product" });
    let subtotal = 0,
      tax = 0;
    const lines = b.items.map((i) => {
      const p = ps.find((x) => x.id === i.productId)!;
      const line = Number(p.sellingPrice) * i.quantity;
      const t = (line * Number(p.taxRate)) / 100;
      subtotal += line;
      tax += t;
      return {
        productId: p.id,
        productName: p.name,
        quantity: i.quantity,
        unitPrice: p.sellingPrice,
        purchaseCost: p.purchaseCost,
        taxRate: p.taxRate,
        lineTotal: line + t,
      };
    });
    if (b.discount > subtotal + tax)
      return r.status(400).json({ error: "Discount exceeds bill total" });
    const c = b.customer
      ? await db.customer.upsert({
          where: { phone: b.customer.phone },
          update: { name: b.customer.name },
          create: b.customer,
        })
      : b.customerId
        ? await db.customer.findUnique({ where: { id: b.customerId } })
        : null;
    const sale = await db.sale.create({
      data: {
        invoiceNo: "INV-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
        customerId: c?.id,
        userId: q.user.id,
        counterId: b.counterId,
        subtotal,
        discount: b.discount,
        taxTotal: tax,
        grandTotal: subtotal + tax - b.discount,
        paymentMode: b.paymentMode,
        notes: b.notes,
        items: { create: lines },
      },
      include: { items: true, customer: true, counter: true },
    });
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
        include: { items: true, customer: true, counter: true },
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
      grossProfitEstimate: gross,
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
