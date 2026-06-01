import { Request, Response } from "express";
import { z } from "zod";
import { query } from "../config/database.js";
import { success, error, paginated } from "../utils/response.js";
import { canAccessUserResource } from "../utils/access.js";

// ── Schemas ────────────────────────────────────────────────────

const createSubscriptionSchema = z.object({
  user_id: z.number().int().positive(),
  plan_id: z.number().int().positive(),
  payment_method: z.enum(["CASH", "WAVE", "ORANGE_MONEY", "MTN_MONEY", "CARD", "BANK_TRANSFER"]).default("CASH"),
  auto_activate: z.boolean().default(false),
});

// ── GET /api/subscriptions — Liste paginee ─────────────────────

export async function getSubscriptions(req: Request, res: Response) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status as string || "";
    const userId = req.query.user_id as string || "";

    let where = "WHERE 1=1";
    const params: any[] = [];

    if (status) { where += " AND s.status = ?"; params.push(status); }
    if (userId) { where += " AND s.user_id = ?"; params.push(userId); }

    const [countResult] = await query<any[]>(
      `SELECT COUNT(*) as total FROM subscriptions s ${where}`, params
    );

    const subs = await query<any[]>(
      `SELECT s.*, mp.name as plan_name, mp.price as plan_price, mp.duration_days,
              u.full_name as user_name, u.member_code, u.email as user_email
       FROM subscriptions s
       JOIN membership_plans mp ON mp.id = s.plan_id
       JOIN users u ON u.id = s.user_id
       ${where}
       ORDER BY s.created_at DESC
       LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      params
    );

    paginated(res, subs, countResult.total, page, limit);
  } catch (err) {
    console.error("[SUBS] getSubscriptions error:", err);
    error(res, "Erreur serveur", 500);
  }
}

// ── GET /api/subscriptions/user/:userId — Abonnements d'un user ─

export async function getUserSubscriptions(req: Request, res: Response) {
  try {
    const { userId } = req.params;
    if (!canAccessUserResource(req, res, userId)) return;

    const subs = await query<any[]>(
      `SELECT s.*, mp.name as plan_name, mp.price as plan_price, mp.duration_days
       FROM subscriptions s
       JOIN membership_plans mp ON mp.id = s.plan_id
       WHERE s.user_id = ?
       ORDER BY s.created_at DESC`,
      [userId]
    );

    // Identifier l'abonnement actif
    const active = subs.find((s) => s.status === "ACTIVE" && new Date(s.end_date) >= new Date());

    success(res, { subscriptions: subs, active_subscription: active || null });
  } catch (err) {
    console.error("[SUBS] getUserSubscriptions error:", err);
    error(res, "Erreur serveur", 500);
  }
}

// ── POST /api/subscriptions — Creer une souscription ───────────

export async function createSubscription(req: Request, res: Response) {
  try {
    const parsed = createSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      error(res, parsed.error.errors.map((e) => e.message).join(", "));
      return;
    }

    const { user_id, plan_id, payment_method, auto_activate } = parsed.data;

    // Verifier utilisateur
    const users = await query<any[]>("SELECT id, status, full_name FROM users WHERE id = ? AND status != 'DELETED'", [user_id]);
    if (users.length === 0) {
      error(res, "Utilisateur introuvable", 404);
      return;
    }

    // Verifier plan
    const plans = await query<any[]>("SELECT * FROM membership_plans WHERE id = ? AND is_active = TRUE", [plan_id]);
    if (plans.length === 0) {
      error(res, "Plan introuvable ou inactif", 404);
      return;
    }

    const plan = plans[0];
    const startDate = new Date().toISOString().split("T")[0];
    const endDate = new Date(Date.now() + plan.duration_days * 86400000).toISOString().split("T")[0];
    const subStatus = auto_activate ? "ACTIVE" : "PENDING";

    // Creer souscription
    const subResult = await query<any>(
      `INSERT INTO subscriptions (user_id, plan_id, start_date, end_date, status)
       VALUES (?, ?, ?, ?, ?)`,
      [user_id, plan_id, startDate, endDate, subStatus]
    );

    // Creer paiement associe
    const payStatus = auto_activate ? "PAID" : "PENDING";
    const payResult = await query<any>(
      `INSERT INTO payments (user_id, subscription_id, amount, payment_method, status${auto_activate ? ", paid_at" : ""})
       VALUES (?, ?, ?, ?, ?${auto_activate ? ", NOW()" : ""})`,
      [user_id, subResult.insertId, plan.price, payment_method, payStatus]
    );

    // Si auto_activate, passer l'utilisateur en ACTIVE/MEMBER
    if (auto_activate) {
      await query<any>(
        "UPDATE users SET status = 'ACTIVE', role = 'MEMBER' WHERE id = ? AND role = 'VISITOR'",
        [user_id]
      );
    }

    success(res, {
      subscription: {
        id: subResult.insertId,
        user_id,
        plan_id,
        plan_name: plan.name,
        start_date: startDate,
        end_date: endDate,
        status: subStatus,
      },
      payment: {
        id: payResult.insertId,
        amount: plan.price,
        payment_method,
        status: payStatus,
      },
    }, 201);
  } catch (err) {
    console.error("[SUBS] createSubscription error:", err);
    error(res, "Erreur serveur", 500);
  }
}

// ── PUT /api/subscriptions/:id/activate — Activer ──────────────

export async function activateSubscription(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const subs = await query<any[]>(
      "SELECT s.*, u.full_name FROM subscriptions s JOIN users u ON u.id = s.user_id WHERE s.id = ?",
      [id]
    );

    if (subs.length === 0) {
      error(res, "Abonnement introuvable", 404);
      return;
    }

    const sub = subs[0];

    if (sub.status === "ACTIVE") {
      error(res, "Cet abonnement est deja actif");
      return;
    }

    if (sub.status === "CANCELLED") {
      error(res, "Impossible d'activer un abonnement annule");
      return;
    }

    // Activer l'abonnement
    await query<any>("UPDATE subscriptions SET status = 'ACTIVE' WHERE id = ?", [id]);

    // Passer l'utilisateur en ACTIVE/MEMBER si PENDING
    await query<any>(
      "UPDATE users SET status = 'ACTIVE', role = 'MEMBER' WHERE id = ? AND status IN ('PENDING', 'EXPIRED')",
      [sub.user_id]
    );

    // Notification
    await query<any>(
      `INSERT INTO notifications (user_id, title, message, type)
       VALUES (?, 'Abonnement active', 'Votre abonnement est maintenant actif. Bon entrainement !', 'SUBSCRIPTION')`,
      [sub.user_id]
    );

    success(res, { message: `Abonnement active pour ${sub.full_name}` });
  } catch (err) {
    console.error("[SUBS] activateSubscription error:", err);
    error(res, "Erreur serveur", 500);
  }
}

// ── PUT /api/subscriptions/:id/cancel — Annuler ────────────────

export async function cancelSubscription(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const subs = await query<any[]>(
      "SELECT s.*, u.full_name FROM subscriptions s JOIN users u ON u.id = s.user_id WHERE s.id = ?",
      [id]
    );

    if (subs.length === 0) {
      error(res, "Abonnement introuvable", 404);
      return;
    }

    const sub = subs[0];

    if (sub.status === "CANCELLED") {
      error(res, "Cet abonnement est deja annule");
      return;
    }

    await query<any>("UPDATE subscriptions SET status = 'CANCELLED' WHERE id = ?", [id]);

    // Annuler le paiement associe s'il est PENDING
    await query<any>(
      "UPDATE payments SET status = 'CANCELLED' WHERE subscription_id = ? AND status = 'PENDING'",
      [id]
    );

    // Notification
    await query<any>(
      `INSERT INTO notifications (user_id, title, message, type)
       VALUES (?, 'Abonnement annule', 'Votre abonnement a ete annule.', 'SUBSCRIPTION')`,
      [sub.user_id]
    );

    success(res, { message: `Abonnement annule pour ${sub.full_name}` });
  } catch (err) {
    console.error("[SUBS] cancelSubscription error:", err);
    error(res, "Erreur serveur", 500);
  }
}

// ── PUT /api/subscriptions/:id/renew — Renouveler ──────────────

export async function renewSubscription(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const paymentMethod = (req.body.payment_method as string) || "CASH";

    const subs = await query<any[]>(
      `SELECT s.*, mp.duration_days, mp.price, mp.name as plan_name, u.full_name
       FROM subscriptions s
       JOIN membership_plans mp ON mp.id = s.plan_id
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`,
      [id]
    );

    if (subs.length === 0) {
      error(res, "Abonnement introuvable", 404);
      return;
    }

    const sub = subs[0];

    // Calculer nouvelles dates (a partir d'aujourd'hui ou de la fin actuelle)
    const baseDate = new Date(sub.end_date) > new Date() ? new Date(sub.end_date) : new Date();
    const newStart = baseDate.toISOString().split("T")[0];
    const newEnd = new Date(baseDate.getTime() + sub.duration_days * 86400000).toISOString().split("T")[0];

    // Creer nouvelle souscription
    const newSubResult = await query<any>(
      `INSERT INTO subscriptions (user_id, plan_id, start_date, end_date, status)
       VALUES (?, ?, ?, ?, 'PENDING')`,
      [sub.user_id, sub.plan_id, newStart, newEnd]
    );

    // Creer paiement
    const payResult = await query<any>(
      `INSERT INTO payments (user_id, subscription_id, amount, payment_method, status)
       VALUES (?, ?, ?, ?, 'PENDING')`,
      [sub.user_id, newSubResult.insertId, sub.price, paymentMethod]
    );

    success(res, {
      message: `Renouvellement cree pour ${sub.full_name}`,
      subscription: {
        id: newSubResult.insertId,
        plan_name: sub.plan_name,
        start_date: newStart,
        end_date: newEnd,
        status: "PENDING",
      },
      payment: {
        id: payResult.insertId,
        amount: sub.price,
        status: "PENDING",
      },
    }, 201);
  } catch (err) {
    console.error("[SUBS] renewSubscription error:", err);
    error(res, "Erreur serveur", 500);
  }
}

// ── GET /api/subscriptions/expired — Abonnements expires ───────

export async function getExpiredSubscriptions(req: Request, res: Response) {
  try {
    const subs = await query<any[]>(
      `SELECT s.*, mp.name as plan_name, mp.price as plan_price,
              u.full_name, u.email, u.phone, u.member_code
       FROM subscriptions s
       JOIN membership_plans mp ON mp.id = s.plan_id
       JOIN users u ON u.id = s.user_id
       WHERE s.status = 'ACTIVE' AND s.end_date < CURDATE()
       ORDER BY s.end_date ASC`
    );

    // Marquer comme expires
    if (subs.length > 0) {
      await query<any>(
        "UPDATE subscriptions SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND end_date < CURDATE()"
      );
      // Marquer les utilisateurs concernes
      await query<any>(
        `UPDATE users SET status = 'EXPIRED'
         WHERE id IN (SELECT user_id FROM subscriptions WHERE status = 'EXPIRED')
           AND role = 'MEMBER'
           AND id NOT IN (SELECT user_id FROM subscriptions WHERE status = 'ACTIVE' AND end_date >= CURDATE())`
      );
    }

    success(res, { expired_count: subs.length, subscriptions: subs });
  } catch (err) {
    console.error("[SUBS] getExpiredSubscriptions error:", err);
    error(res, "Erreur serveur", 500);
  }
}
