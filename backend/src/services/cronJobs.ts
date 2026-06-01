import { query } from "../config/database.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const cronTimers: NodeJS.Timeout[] = [];

// ── Expiration des abonnements ─────────────────────────────────

export async function expireSubscriptions() {
  try {
    const expired = await query<any[]>(
      `SELECT s.id, s.user_id, u.full_name, mp.name as plan_name
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       JOIN membership_plans mp ON mp.id = s.plan_id
       WHERE s.status = 'ACTIVE' AND s.end_date < CURDATE()`
    );

    if (expired.length === 0) return { expired_count: 0 };

    await query<any>("UPDATE subscriptions SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND end_date < CURDATE()");

    await query<any>(
      `UPDATE users SET status = 'EXPIRED'
       WHERE role = 'MEMBER' AND status = 'ACTIVE'
         AND id NOT IN (SELECT user_id FROM subscriptions WHERE status = 'ACTIVE' AND end_date >= CURDATE())
         AND id IN (SELECT user_id FROM subscriptions WHERE status = 'EXPIRED')`
    );

    for (const sub of expired) {
      await query<any>(
        `INSERT INTO notifications (user_id, title, message, type) VALUES (?, 'Abonnement expire', ?, 'SUBSCRIPTION')`,
        [sub.user_id, `Votre abonnement "${sub.plan_name}" a expire. Renouvelez-le pour continuer.`]
      );
    }

    const admins = await query<any[]>("SELECT id FROM users WHERE role IN ('ADMIN', 'SUPER_ADMIN') AND status = 'ACTIVE'");
    for (const admin of admins) {
      await query<any>(
        `INSERT INTO notifications (user_id, title, message, type) VALUES (?, 'Abonnements expires', ?, 'SYSTEM')`,
        [admin.id, `${expired.length} abonnement(s) expire(s) : ${expired.map((e) => e.full_name).join(", ")}`]
      );
    }

    console.log(`[CRON] ${expired.length} abonnement(s) expire(s)`);
    return { expired_count: expired.length };
  } catch (err) {
    console.error("[CRON] expireSubscriptions error:", err);
    return { expired_count: 0 };
  }
}

async function runDailyTasks() {
  await expireSubscriptions();
  await remindExpiringSubscriptions();
  await remindPendingPayments();
  await alertInactiveMembers();
  await autoGenerateInvoices();
}

// ── Rappel abonnement expire dans 3 jours ──────────────────────

async function remindExpiringSubscriptions() {
  try {
    const expiringSoon = await query<any[]>(
      `SELECT s.id, s.user_id, s.end_date, u.full_name, mp.name as plan_name
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       JOIN membership_plans mp ON mp.id = s.plan_id
       WHERE s.status = 'ACTIVE' AND s.end_date = DATE_ADD(CURDATE(), INTERVAL 3 DAY)`
    );

    for (const sub of expiringSoon) {
      // Eviter les doublons de notification
      const [existing] = await query<any[]>(
        `SELECT id FROM notifications WHERE user_id = ? AND title = 'Abonnement bientot expire' AND DATE(created_at) = CURDATE()`,
        [sub.user_id]
      );
      if (existing) continue;

      await query<any>(
        `INSERT INTO notifications (user_id, title, message, type) VALUES (?, 'Abonnement bientot expire', ?, 'SUBSCRIPTION')`,
        [sub.user_id, `Votre abonnement "${sub.plan_name}" expire dans 3 jours (${new Date(sub.end_date).toLocaleDateString("fr-FR")}). Pensez a le renouveler.`]
      );
    }

    if (expiringSoon.length > 0) console.log(`[CRON] ${expiringSoon.length} rappel(s) d'expiration envoye(s)`);
  } catch (err) {
    console.error("[CRON] remindExpiringSubscriptions error:", err);
  }
}

// ── Rappel paiements en attente > 48h ──────────────────────────

async function remindPendingPayments() {
  try {
    const pending = await query<any[]>(
      `SELECT p.id, p.user_id, p.amount, u.full_name
       FROM payments p
       JOIN users u ON u.id = p.user_id
       WHERE p.status = 'PENDING' AND p.created_at < DATE_SUB(NOW(), INTERVAL 48 HOUR)`
    );

    // Notifier l'admin une fois par jour
    if (pending.length === 0) return;

    const admins = await query<any[]>("SELECT id FROM users WHERE role IN ('ADMIN', 'SUPER_ADMIN') AND status = 'ACTIVE'");

    for (const admin of admins) {
      const [existing] = await query<any[]>(
        `SELECT id FROM notifications WHERE user_id = ? AND title = 'Paiements en retard' AND DATE(created_at) = CURDATE()`,
        [admin.id]
      );
      if (existing) continue;

      const totalAmount = pending.reduce((s, p) => s + Number(p.amount), 0);
      await query<any>(
        `INSERT INTO notifications (user_id, title, message, type) VALUES (?, 'Paiements en retard', ?, 'PAYMENT')`,
        [admin.id, `${pending.length} paiement(s) en attente depuis plus de 48h (total: ${totalAmount.toLocaleString()} FCFA). Membres: ${pending.map((p) => p.full_name).join(", ")}`]
      );
    }

    console.log(`[CRON] ${pending.length} paiement(s) en retard signale(s)`);
  } catch (err) {
    console.error("[CRON] remindPendingPayments error:", err);
  }
}

// ── Alerte membres inactifs (pas venus depuis 30 jours) ────────

async function alertInactiveMembers() {
  try {
    const inactive = await query<any[]>(
      `SELECT u.id, u.full_name, u.member_code,
              MAX(a.check_in_time) as last_visit
       FROM users u
       LEFT JOIN attendance_logs a ON a.user_id = u.id AND a.status = 'VALID'
       WHERE u.role = 'MEMBER' AND u.status = 'ACTIVE'
       GROUP BY u.id, u.full_name, u.member_code
       HAVING last_visit IS NULL OR last_visit < DATE_SUB(NOW(), INTERVAL 30 DAY)`
    );

    if (inactive.length === 0) return;

    // Alerte admin hebdomadaire (le lundi)
    const today = new Date();
    if (today.getDay() !== 1) return; // Seulement le lundi

    const admins = await query<any[]>("SELECT id FROM users WHERE role IN ('ADMIN', 'SUPER_ADMIN') AND status = 'ACTIVE'");
    for (const admin of admins) {
      await query<any>(
        `INSERT INTO notifications (user_id, title, message, type) VALUES (?, 'Membres inactifs', ?, 'SYSTEM')`,
        [admin.id, `${inactive.length} membre(s) ne sont pas venus depuis plus de 30 jours : ${inactive.slice(0, 5).map((m) => m.full_name).join(", ")}${inactive.length > 5 ? "..." : ""}`]
      );
    }

    console.log(`[CRON] ${inactive.length} membre(s) inactif(s) detecte(s)`);
  } catch (err) {
    console.error("[CRON] alertInactiveMembers error:", err);
  }
}

// ── Auto-generation de factures pour paiements valides ────────

async function autoGenerateInvoices() {
  try {
    // Trouver les paiements PAID sans facture
    const payments = await query<any[]>(
      `SELECT p.id, p.user_id, p.amount, u.full_name, mp.name as plan_name
       FROM payments p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN subscriptions s ON s.id = p.subscription_id
       LEFT JOIN membership_plans mp ON mp.id = s.plan_id
       LEFT JOIN invoices i ON i.payment_id = p.id
       WHERE p.status = 'PAID' AND i.id IS NULL`
    );

    for (const p of payments) {
      const y = new Date().getFullYear();
      const m = String(new Date().getMonth() + 1).padStart(2, "0");
      const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
      const invoiceNumber = `INV-${y}${m}-${rand}`;
      const label = p.plan_name ? `Abonnement ${p.plan_name}` : "Paiement";

      await query<any>(
        `INSERT INTO invoices (user_id, payment_id, invoice_number, label, amount, status, paid_at)
         VALUES (?, ?, ?, ?, ?, 'PAID', NOW())`,
        [p.user_id, p.id, invoiceNumber, label, p.amount]
      );
    }

    if (payments.length > 0) console.log(`[CRON] ${payments.length} facture(s) auto-generee(s)`);
  } catch (err) {
    console.error("[CRON] autoGenerateInvoices error:", err);
  }
}

// ── Demarrage ──────────────────────────────────────────────────

export function startCronJobs() {
  console.log("[CRON] Lancement des taches automatiques...");

  if (cronTimers.length > 0) {
    console.log("[CRON] Taches automatiques deja demarrees");
    return;
  }

  runDailyTasks().catch((err) => console.error("[CRON] daily tasks error:", err));

  cronTimers.push(setInterval(() => {
    runDailyTasks().catch((err) => console.error("[CRON] daily tasks error:", err));
  }, DAY_MS));

  console.log("[CRON] Taches automatiques demarrees (5 jobs, intervalle: 24h)");
}

export function stopCronJobs() {
  while (cronTimers.length > 0) {
    const timer = cronTimers.pop();
    if (timer) clearInterval(timer);
  }
  console.log("[CRON] Taches automatiques arretees");
}
