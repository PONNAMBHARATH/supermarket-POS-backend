import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "./config";
export function auth(req: Request, res: Response, next: NextFunction) {
  const t = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!t) return res.status(401).json({ error: "Authentication required" });
  try {
    (req as any).user = jwt.verify(t, config.secret);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
export function owner(req: Request, res: Response, next: NextFunction) {
  if ((req as any).user?.role !== "OWNER")
    return res.status(403).json({ error: "Owner access required" });
  next();
}
