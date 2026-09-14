import { createHmac, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, adminsTable } from "@workspace/db";

const scrypt = promisify(nodeScrypt);
const SESSION_COOKIE = "usalb_admin_session";
const sessionSecret = process.env.SESSION_SECRET ?? "development-session-secret";

export async function hashAdminPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyAdminPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return expected.length === derivedKey.length && timingSafeEqual(expected, derivedKey);
}

export function setAdminSession(res: Response, email: string): void {
  const issuedAt = Date.now().toString();
  const payload = `${email}:${issuedAt}`;
  const signature = createHmac("sha256", sessionSecret).update(payload).digest("hex");
  res.cookie(SESSION_COOKIE, `${payload}:${signature}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000,
    signed: false,
  });
}

export function clearAdminSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
}

export async function getAdminFromRequest(req: Request) {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (typeof raw !== "string") return null;
  const parts = raw.split(":");
  if (parts.length < 3) return null;
  const issuedAt = Number(parts[parts.length - 2]);
  const signature = parts[parts.length - 1];
  const email = parts.slice(0, -2).join(":");
  if (!email || !Number.isFinite(issuedAt) || Date.now() - issuedAt > 8 * 60 * 60 * 1000) return null;
  const payload = `${email}:${issuedAt}`;
  const expected = createHmac("sha256", sessionSecret).update(payload).digest("hex");
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const [admin] = await db.select().from(adminsTable).where(eq(adminsTable.email, email)).limit(1);
  return admin ?? null;
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const admin = await getAdminFromRequest(req);
  if (!admin) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  res.locals.admin = admin;
  next();
}

export async function ensureAdminSeed(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  if (!email || !passwordHash) return;
  const existing = await db.select({ id: adminsTable.id }).from(adminsTable).where(eq(adminsTable.email, email)).limit(1);
  if (existing.length === 0) {
    await db.insert(adminsTable).values({ email, passwordHash });
  }
}