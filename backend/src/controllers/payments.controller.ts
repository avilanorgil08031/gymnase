import { Request, Response } from "express";
import { z } from "zod";
import { query } from "../config/database.js";
import { success, error, paginated, ErrorCode } from "../utils/response.js";
import { logActivity } from "../services/activityLog.js";
import { canAccessUserResource } from "../utils/access.js";

// ── Schemas ────────────────────────────────────────────────────

const createPaymentSchema = z.object({
  user_id: z.number().int().positive(),
  subscription_id: z.number().int().positive().optional().nullable(),
  amount: z.number().positive("Le montant doit etre positif"),
  payment_method: z.enum(["CASH", "WAVE", "ORANGE_MONEY", "MTN_MONEY", "CARD", "BANK_TRANSFER"]),
  transaction_reference: z.string().max(150).optional().nullable(),
});

// ── GET /api/payments — Liste paginee (admin) ──────────────────

export async function getPayments(req: Request, res: Response) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status as string || "";
    const method = req.query.method as string || "";
    const userId = req.query.user_id as string || "";
    const dateFrom = req.query.date_from as string || "";
    const dateTo = req.query.date_to as string || "";

    let where = "WHERE 1=1";
    const params: any[] = [];

    if (status) { where += " AND p.status = ?"; params.push(status); }
    if (method) { where += " AND p.payment_method = ?"; params.push(method); }
    if (userId) { where += " AND p.user_id = ?"; params.push(userId); }
    if (dateFrom) { where += " AND DATE(p.created_at) >= ?"; params.push(dateFrom); }
    if (dateTo) { where += " AND DATE(p.created_at) <= ?"; params.push(dateTo); }

    const [countResult] = await query<any[]>(
      `SELECT COUNT(*) as total FROM payments p ${where}`, params
    );

    const payments = await query<any[]>(
      `SELECT p.*, u.full_name as user_name, u.member_code, u.phone as user_phone,
              mp.name as plan_name
       FROM payments p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN subscriptions s ON s.id = p.subscription_id
       LEFT JOIN membership_plans mp ON mp.id = s.plan_id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      params
    );

    paginated(res, payments, countResult.total, page, limit);
  } catch (err) {
    console.error("[PAYMENTS] getPayments error:", err);
    error(res, "Erreur serveur", 500);
  }
}

// ── GET /api/payments/user/:userId — Paiements d'un membre ─────

export async function getUserPayments(req: Request, res: Response) {
  try {
    const { userId } = req.params;
    if (!canAccessUserResource(req, res, userId)) return;

    const payments = await query<any[]>(
      `SELECT p.*, mp.name as plan_name
       FROM payments p
       LEFT JOIN subscriptions s ON s.id = p.subscription_id
       LEFT JOIN membership_plans mp ON mp.id = s.plan_id
       WHERE p.user_id = ?
       ORDER BY p.created_at DESC`,
      [userId]
    );

    const totalPaid = payments.filter((p) => p.status === "PAID").reduce((sum, p) => sum + Number(p.amount), 0);
    const totalPending = payments.filter((p) => p.status === "PENDING").reduce((sum, p) => sum + Number(p.amount), 0);

    success(res, {
      payments,
      summary: { total_paid: totalPaid, total_pending: totalPending },
    });
  } catch (err) {
    console.error("[PAYMENTS] getUserPayments error:", err);
    error(res, "Erreur serveur", 500);
  }
}

// ── POST /api/payments — Creer un paiement (admin) ─────────────

export async function createPayment(req: Request, res: Response) {
  try {
    const parsed = createPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      error(res, parsed.error.errors.map((e) => e.message).join(", "));
      return;
    }

    const { user_id, subscription_id, amount, payment_method, transaction_reference } = parsed.data;

    // Verifier utilisateur
    const [user] = await query<any[]>("SELECT id, full_name FROM users WHERE id = ? AND status != 'DELETED'", [user_id]);
    if (!user) {
      error(res, "Utilisateur introuvable", 404);
      return;
    }

    const result = await query<any>(
      `INSERT INTO payments (user_id, subscription_id, amount, payment_method, status, transaction_reference)
       VALUES (?, ?, ?, ?, 'PENDING', ?)`,
      [user_id, subscription_id || null, amount, payment_method, transaction_reference || null]
    );

    success(res, {
      id: result.insertId,
      user_id,
      user_name: user.full_name,
      amount,
      payment_method,
      status: "PENDING",
      transaction_reference,
    }, 201);
  } catch (err) {
    console.error("[PAYMENTS] createPayment error:", err);
    error(res, "Erreur serveur", 500);
  }
}

// ── PUT /api/payments/:id/validate — Valider paiement ──────────

export async function validatePayment(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const transaction_reference = req.body.transaction_reference as string || null;

    const [payment] = await query<any[]>(
      `SELECT p.*, u.full_name FROM payments p JOIN users u ON u.id = p.user_id WHERE p.id = ?`,
      [id]
    );

    if (!payment) {
      error(res, "Paiement introuvable", 404);
      return;
    }

    if (payment.status === "PAID") {
      error(res, "Ce paiement est deja valide");
      return;
    }

    if (payment.status === "CANCELLED" || payment.status === "REFUNDED") {
      error(res, `Impossible de valider : statut actuel = ${payment.status}`);
      return;
    }

    // Marquer comme paye
    const updateFields = transaction_reference
      ? "status = 'PAID', paid_at = NOW(), transaction_reference = ?"
      : "status = 'PAID', paid_at = NOW()";
    const updateParams = transaction_reference ? [transaction_reference, id] : [id];

    await query<any>(`UPDATE payments SET ${updateFields} WHERE id = ?`, updateParams);

    // Si lie a un abonnement, activer l'abonnement
    if (payment.subscription_id) {
      await query<any>(
        "UPDATE subscriptions SET status = 'ACTIVE' WHERE id = ? AND status = 'PENDING'",
        [payment.subscription_id]
      );
      // Activer le membre
      await query<any>(
        "UPDATE users SET status = 'ACTIVE', role = 'MEMBER' WHERE id = ? AND status IN ('PENDING', 'EXPIRED')",
        [payment.user_id]
      );
    }

    // Notification au membre
    await query<any>(
      `INSERT INTO notifications (user_id, title, message, type)
       VALUES (?, 'Paiement confirme', ?, 'PAYMENT')`,
      [payment.user_id, `Votre paiement de ${Number(payment.amount).toLocaleString()} FCFA a ete confirme.`]
    );

    await logActivity(req, { action: "PAY", targetType: "PAYMENT", targetId: Number(id), description: `Paiement #${id} valide : ${payment.amount} FCFA pour ${payment.full_name}`, metadata: { amount: payment.amount, user_id: payment.user_id } });

    success(res, {
      message: `Paiement de ${payment.full_name} valide (${payment.amount} FCFA)`,
      payment_id: payment.id,
      subscription_activated: !!payment.subscription_id,
    });
  } catch (err) {
    console.error("[PAYMENTS] validatePayment error:", err);
    error(res, "Erreur serveur", 500, ErrorCode.INTERNAL_ERROR);
  }
}

// ── PUT /api/payments/:id/cancel — Annuler paiement ────────────

export async function cancelPayment(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const [payment] = await query<any[]>(
      "SELECT p.*, u.full_name FROM payments p JOIN users u ON u.id = p.user_id WHERE p.id = ?",
      [id]
    );

    if (!payment) {
      error(res, "Paiement introuvable", 404);
      return;
    }

    if (payment.status === "CANCELLED") {
      error(res, "Ce paiement est deja annule");
      return;
    }

    await query<any>("UPDATE payments SET status = 'CANCELLED' WHERE id = ?", [id]);

    await query<any>(
      `INSERT INTO notifications (user_id, title, message, type)
       VALUES (?, 'Paiement annule', 'Un de vos paiements a ete annule.', 'PAYMENT')`,
      [payment.user_id]
    );

    await logActivity(req, { action: "CANCEL", targetType: "PAYMENT", targetId: Number(id), description: `Paiement #${id} annule pour ${payment.full_name}` });

    success(res, { message: `Paiement annule` });
  } catch (err) {
    console.error("[PAYMENTS] cancelPayment error:", err);
    error(res, "Erreur serveur", 500, ErrorCode.INTERNAL_ERROR);
  }
}

// ── PUT /api/payments/:id/refund — Rembourser ──────────────────

export async function refundPayment(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const [payment] = await query<any[]>(
      "SELECT p.*, u.full_name FROM payments p JOIN users u ON u.id = p.user_id WHERE p.id = ?",
      [id]
    );

    if (!payment) {
      error(res, "Paiement introuvable", 404);
      return;
    }

    if (payment.status !== "PAID") {
      error(res, "Seul un paiement valide peut etre rembourse");
      return;
    }

    await query<any>("UPDATE payments SET status = 'REFUNDED' WHERE id = ?", [id]);

    await query<any>(
      `INSERT INTO notifications (user_id, title, message, type)
       VALUES (?, 'Remboursement', ?, 'PAYMENT')`,
      [payment.user_id, `Votre paiement de ${Number(payment.amount).toLocaleString()} FCFA a ete rembourse.`]
    );

    await logActivity(req, { action: "REFUND", targetType: "PAYMENT", targetId: Number(id), description: `Paiement #${id} rembourse : ${payment.amount} FCFA pour ${payment.full_name}` });

    success(res, { message: `Paiement rembourse` });
  } catch (err) {
    console.error("[PAYMENTS] refundPayment error:", err);
    error(res, "Erreur serveur", 500, ErrorCode.INTERNAL_ERROR);
  }
}

// ── GET /api/payments/stats/daily — Revenus du jour ────────────

export async function getDailyStats(req: Request, res: Response) {
  try {
    const date = (req.query.date as string) || new Date().toISOString().split("T")[0];

    const [paid] = await query<any[]>(
      "SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM payments WHERE DATE(paid_at) = ? AND status = 'PAID'",
      [date]
    );
    const [pending] = await query<any[]>(
      "SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM payments WHERE DATE(created_at) = ? AND status = 'PENDING'",
      [date]
    );
    const [cancelled] = await query<any[]>(
      "SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM payments WHERE DATE(created_at) = ? AND status = 'CANCELLED'",
      [date]
    );

    // Detail par methode de paiement
    const byMethod = await query<any[]>(
      `SELECT payment_method, COALESCE(SUM(amount), 0) as total, COUNT(*) as count
       FROM payments WHERE DATE(paid_at) = ? AND status = 'PAID'
       GROUP BY payment_method`,
      [date]
    );

    success(res, {
      date,
      paid: { total: Number(paid.total), count: paid.count },
      pending: { total: Number(pending.total), count: pending.count },
      cancelled: { total: Number(cancelled.total), count: cancelled.count },
      by_method: byMethod,
    });
  } catch (err) {
    console.error("[PAYMENTS] getDailyStats error:", err);
    error(res, "Erreur serveur", 500);
  }
}

// ── GET /api/payments/stats/monthly — Revenus du mois ──────────

export async function getMonthlyStats(req: Request, res: Response) {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const month = Number(req.query.month) || new Date().getMonth() + 1;

    const [paid] = await query<any[]>(
      `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
       FROM payments WHERE YEAR(paid_at) = ? AND MONTH(paid_at) = ? AND status = 'PAID'`,
      [year, month]
    );
    const [pending] = await query<any[]>(
      `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
       FROM payments WHERE YEAR(created_at) = ? AND MONTH(created_at) = ? AND status = 'PENDING'`,
      [year, month]
    );

    // Revenus par jour du mois
    const dailyRevenue = await query<any[]>(
      `SELECT DATE(paid_at) as day, COALESCE(SUM(amount), 0) as total, COUNT(*) as count
       FROM payments
       WHERE YEAR(paid_at) = ? AND MONTH(paid_at) = ? AND status = 'PAID'
       GROUP BY DATE(paid_at)
       ORDER BY day ASC`,
      [year, month]
    );

    // Par methode
    const byMethod = await query<any[]>(
      `SELECT payment_method, COALESCE(SUM(amount), 0) as total, COUNT(*) as count
       FROM payments
       WHERE YEAR(paid_at) = ? AND MONTH(paid_at) = ? AND status = 'PAID'
       GROUP BY payment_method`,
      [year, month]
    );

    success(res, {
      year,
      month,
      paid: { total: Number(paid.total), count: paid.count },
      pending: { total: Number(pending.total), count: pending.count },
      daily_revenue: dailyRevenue,
      by_method: byMethod,
    });
  } catch (err) {
    console.error("[PAYMENTS] getMonthlyStats error:", err);
    error(res, "Erreur serveur", 500);
  }
}
