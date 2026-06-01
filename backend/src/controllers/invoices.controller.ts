import { Request, Response } from "express";
import { query } from "../config/database.js";
import { success, error, paginated, ErrorCode } from "../utils/response.js";
import { logActivity } from "../services/activityLog.js";
import { getAllSettings } from "../services/settings.js";
import { canAccessUserResource, isAdminRole } from "../utils/access.js";

function generateInvoiceNumber(): string {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `INV-${y}${m}-${rand}`;
}

// ── POST /api/invoices/generate — Generer une facture depuis un paiement

export async function generateInvoice(req: Request, res: Response) {
  try {
    const { payment_id } = req.body;
    if (!payment_id) {
      error(res, "payment_id requis", 400, ErrorCode.VALIDATION_ERROR);
      return;
    }

    const [payment] = await query<any[]>(
      `SELECT p.*, u.full_name, u.email, u.phone, u.member_code,
              mp.name as plan_name
       FROM payments p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN subscriptions s ON s.id = p.subscription_id
       LEFT JOIN membership_plans mp ON mp.id = s.plan_id
       WHERE p.id = ?`,
      [payment_id]
    );

    if (!payment) {
      error(res, "Paiement introuvable", 404, ErrorCode.NOT_FOUND);
      return;
    }

    // Verifier si facture deja generee
    const [existing] = await query<any[]>("SELECT id, invoice_number FROM invoices WHERE payment_id = ?", [payment_id]);
    if (existing) {
      success(res, { invoice_number: existing.invoice_number, already_exists: true }, 200, "Facture deja generee");
      return;
    }

    const invoiceNumber = generateInvoiceNumber();
    const label = payment.plan_name ? `Abonnement ${payment.plan_name}` : "Paiement";
    const invoiceStatus = payment.status === "PAID" ? "PAID" : "DRAFT";

    const result = await query<any>(
      `INSERT INTO invoices (user_id, payment_id, invoice_number, label, amount, status, due_date, paid_at)
       VALUES (?, ?, ?, ?, ?, ?, CURDATE(), ?)`,
      [payment.user_id, payment_id, invoiceNumber, label, payment.amount, invoiceStatus, payment.paid_at || null]
    );

    await logActivity(req, { action: "CREATE", targetType: "PAYMENT", targetId: payment_id, description: `Facture ${invoiceNumber} generee pour ${payment.full_name}` });

    success(res, {
      id: result.insertId,
      invoice_number: invoiceNumber,
      label,
      amount: payment.amount,
      status: invoiceStatus,
      member: { full_name: payment.full_name, email: payment.email, phone: payment.phone, member_code: payment.member_code },
    }, 201, "Facture generee");
  } catch (err) {
    console.error("[INVOICES] generateInvoice error:", err);
    error(res, "Erreur serveur", 500, ErrorCode.INTERNAL_ERROR);
  }
}

// ── GET /api/invoices/:id/pdf — Generer le contenu PDF (JSON pour le frontend)

export async function getInvoicePdf(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const [invoice] = await query<any[]>(
      `SELECT i.*, u.full_name, u.email, u.phone, u.member_code,
              p.payment_method, p.transaction_reference
       FROM invoices i
       JOIN users u ON u.id = i.user_id
       LEFT JOIN payments p ON p.id = i.payment_id
       WHERE i.id = ?`,
      [id]
    );

    if (!invoice) {
      error(res, "Facture introuvable", 404, ErrorCode.NOT_FOUND);
      return;
    }

    if (!isAdminRole(req.user?.role) && req.user?.userId !== Number(invoice.user_id)) {
      error(res, "Acces refuse", 403, ErrorCode.FORBIDDEN);
      return;
    }

    // Recuperer les infos de la salle
    const settings = await getAllSettings();

    success(res, {
      invoice: {
        number: invoice.invoice_number,
        label: invoice.label,
        amount: Number(invoice.amount),
        status: invoice.status,
        date: invoice.created_at,
        due_date: invoice.due_date,
        paid_at: invoice.paid_at,
        payment_method: invoice.payment_method,
        transaction_reference: invoice.transaction_reference,
      },
      member: {
        full_name: invoice.full_name,
        email: invoice.email,
        phone: invoice.phone,
        member_code: invoice.member_code,
      },
      gym: {
        name: settings.gym_name?.value || "Elite Gym",
        phone: settings.gym_phone?.value || "",
        address: settings.gym_address?.value || "",
        email: settings.gym_email?.value || "",
        currency: settings.gym_currency?.value || "FCFA",
      },
    });
  } catch (err) {
    console.error("[INVOICES] getInvoicePdf error:", err);
    error(res, "Erreur serveur", 500, ErrorCode.INTERNAL_ERROR);
  }
}

// ── GET /api/invoices — Liste paginee (admin) ──────────────────

export async function getInvoices(req: Request, res: Response) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const userId = req.query.user_id as string || "";
    const status = req.query.status as string || "";

    let where = "WHERE 1=1";
    const params: any[] = [];

    if (userId) { where += " AND i.user_id = ?"; params.push(userId); }
    if (status) { where += " AND i.status = ?"; params.push(status); }

    const [countResult] = await query<any[]>(`SELECT COUNT(*) as total FROM invoices i ${where}`, params);

    const invoices = await query<any[]>(
      `SELECT i.*, u.full_name, u.member_code
       FROM invoices i
       JOIN users u ON u.id = i.user_id
       ${where}
       ORDER BY i.created_at DESC
       LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      params
    );

    paginated(res, invoices, countResult.total, page, limit);
  } catch (err) {
    console.error("[INVOICES] getInvoices error:", err);
    error(res, "Erreur serveur", 500, ErrorCode.INTERNAL_ERROR);
  }
}

// ── GET /api/invoices/user/:userId — Factures d'un membre ──────

export async function getUserInvoices(req: Request, res: Response) {
  try {
    const { userId } = req.params;
    if (!canAccessUserResource(req, res, userId)) return;

    const invoices = await query<any[]>(
      `SELECT i.*, p.payment_method FROM invoices i
       LEFT JOIN payments p ON p.id = i.payment_id
       WHERE i.user_id = ? ORDER BY i.created_at DESC`,
      [userId]
    );

    success(res, invoices);
  } catch (err) {
    console.error("[INVOICES] getUserInvoices error:", err);
    error(res, "Erreur serveur", 500, ErrorCode.INTERNAL_ERROR);
  }
}
