import { Request, Response } from "express";
import { z } from "zod";
import { query } from "../config/database.js";
import { success, error, paginated, ErrorCode } from "../utils/response.js";
import { logActivity } from "../services/activityLog.js";
import { getSettingNumber } from "../services/settings.js";
import { canAccessUserResource } from "../utils/access.js";

// ── Schemas ────────────────────────────────────────────────────

const createReservationSchema = z.object({
  session_id: z.number().int().positive(),
  reservation_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format date: YYYY-MM-DD"),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Format heure: HH:MM"),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Format heure: HH:MM"),
  time_slot_id: z.number().int().positive().optional().nullable(),
});

// ── GET /api/reservations — Liste paginee (admin) ──────────────

export async function getReservations(req: Request, res: Response) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status as string || "";
    const date = req.query.date as string || "";
    const userId = req.query.user_id as string || "";
    const sessionId = req.query.session_id as string || "";

    let where = "WHERE 1=1";
    const params: any[] = [];

    if (status) { where += " AND r.status = ?"; params.push(status); }
    if (date) { where += " AND r.reservation_date = ?"; params.push(date); }
    if (userId) { where += " AND r.user_id = ?"; params.push(userId); }
    if (sessionId) { where += " AND r.session_id = ?"; params.push(sessionId); }

    const [countResult] = await query<any[]>(
      `SELECT COUNT(*) as total FROM reservations r ${where}`, params
    );

    const reservations = await query<any[]>(
      `SELECT r.*, s.name as session_name, s.duration_minutes,
              u.full_name as user_name, u.member_code, u.phone as user_phone
       FROM reservations r
       JOIN sessions s ON s.id = r.session_id
       JOIN users u ON u.id = r.user_id
       ${where}
       ORDER BY r.reservation_date DESC, r.start_time DESC
       LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      params
    );

    paginated(res, reservations, countResult.total, page, limit);
  } catch (err) {
    console.error("[RESERVATIONS] getReservations error:", err);
    error(res, "Erreur serveur", 500);
  }
}

// ── GET /api/reservations/today — Reservations du jour ─────────

export async function getTodayReservations(req: Request, res: Response) {
  try {
    const reservations = await query<any[]>(
      `SELECT r.*, s.name as session_name, s.duration_minutes,
              u.full_name as user_name, u.member_code, u.phone as user_phone
       FROM reservations r
       JOIN sessions s ON s.id = r.session_id
       JOIN users u ON u.id = r.user_id
       WHERE r.reservation_date = CURDATE()
       ORDER BY r.start_time ASC`
    );

    const stats = {
      total: reservations.length,
      confirmed: reservations.filter((r) => r.status === "CONFIRMED").length,
      pending: reservations.filter((r) => r.status === "PENDING").length,
      completed: reservations.filter((r) => r.status === "COMPLETED").length,
      cancelled: reservations.filter((r) => r.status === "CANCELLED").length,
    };

    success(res, { reservations, stats });
  } catch (err) {
    console.error("[RESERVATIONS] getTodayReservations error:", err);
    error(res, "Erreur serveur", 500);
  }
}

// ── GET /api/reservations/user/:userId — Reservations d'un user

export async function getUserReservations(req: Request, res: Response) {
  try {
    const { userId } = req.params;
    if (!canAccessUserResource(req, res, userId)) return;

    const status = req.query.status as string || "";
    const upcoming = req.query.upcoming === "true";

    let where = "WHERE r.user_id = ?";
    const params: any[] = [userId];

    if (status) { where += " AND r.status = ?"; params.push(status); }
    if (upcoming) { where += " AND r.reservation_date >= CURDATE() AND r.status NOT IN ('CANCELLED', 'COMPLETED', 'NO_SHOW')"; }

    const reservations = await query<any[]>(
      `SELECT r.*, s.name as session_name, s.duration_minutes
       FROM reservations r
       JOIN sessions s ON s.id = r.session_id
       ${where}
       ORDER BY r.reservation_date DESC, r.start_time DESC`,
      params
    );

    success(res, reservations);
  } catch (err) {
    console.error("[RESERVATIONS] getUserReservations error:", err);
    error(res, "Erreur serveur", 500);
  }
}

// ── POST /api/reservations — Creer une reservation ─────────────

export async function createReservation(req: Request, res: Response) {
  try {
    const parsed = createReservationSchema.safeParse(req.body);
    if (!parsed.success) {
      error(res, parsed.error.errors.map((e) => e.message).join(", "));
      return;
    }

    const { session_id, reservation_date, start_time, end_time, time_slot_id } = parsed.data;
    const userId = req.user!.userId;

    // 1. Verifier que le membre est actif
    const [user] = await query<any[]>("SELECT id, status, role FROM users WHERE id = ?", [userId]);
    if (!user || user.status !== "ACTIVE") {
      error(res, "Votre compte doit etre actif pour reserver", 403, ErrorCode.FORBIDDEN);
      return;
    }

    // 2. Verifier que le membre a un abonnement valide (sauf admin)
    if (user.role === "MEMBER") {
      const [activeSub] = await query<any[]>(
        "SELECT id FROM subscriptions WHERE user_id = ? AND status = 'ACTIVE' AND end_date >= CURDATE()",
        [userId]
      );
      if (!activeSub) {
        error(res, "Vous n'avez pas d'abonnement actif. Veuillez souscrire a un abonnement.", 403, ErrorCode.NO_ACTIVE_SUBSCRIPTION);
        return;
      }
    }

    // 3. Verifier que la seance existe et est active
    const [session] = await query<any[]>(
      "SELECT id, name, capacity FROM sessions WHERE id = ? AND is_active = TRUE",
      [session_id]
    );
    if (!session) {
      error(res, "Seance introuvable ou inactive", 404);
      return;
    }

    // 4. Verifier la date (pas dans le passe)
    const resDate = new Date(`${reservation_date}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (resDate < today) {
      error(res, "Impossible de reserver une date passee", 400, ErrorCode.PAST_DATE);
      return;
    }

    // 5. Determiner la capacite max (time_slot > session)
    let maxCapacity = session.capacity;
    if (time_slot_id) {
      const [slot] = await query<any[]>("SELECT max_capacity FROM time_slots WHERE id = ? AND is_active = TRUE", [time_slot_id]);
      if (slot && slot.max_capacity) maxCapacity = slot.max_capacity;
    }

    // 6. Compter les reservations confirmees pour ce creneau
    const [slotCount] = await query<any[]>(
      `SELECT COUNT(*) as booked FROM reservations
       WHERE session_id = ? AND reservation_date = ? AND start_time = ?
         AND status NOT IN ('CANCELLED', 'NO_SHOW')`,
      [session_id, reservation_date, start_time]
    );

    const placesRestantes = maxCapacity - slotCount.booked;

    if (placesRestantes <= 0) {
      error(res, `Ce creneau est complet (${maxCapacity}/${maxCapacity}). Veuillez choisir un autre horaire.`, 400, ErrorCode.SLOT_FULL);
      return;
    }

    // 7. Verifier que le membre n'a pas deja reserve ce creneau
    const [duplicate] = await query<any[]>(
      `SELECT id FROM reservations
       WHERE user_id = ? AND reservation_date = ? AND start_time = ?
         AND status NOT IN ('CANCELLED', 'NO_SHOW')`,
      [userId, reservation_date, start_time]
    );

    if (duplicate) {
      error(res, "Vous avez deja une reservation a cet horaire.", 400, ErrorCode.DUPLICATE_RESERVATION);
      return;
    }

    // 7. Creer la reservation
    const result = await query<any>(
      `INSERT INTO reservations (user_id, session_id, time_slot_id, reservation_date, start_time, end_time, status)
       VALUES (?, ?, ?, ?, ?, ?, 'CONFIRMED')`,
      [userId, session_id, time_slot_id || null, reservation_date, start_time, end_time]
    );

    // 8. Notification admin
    const admins = await query<any[]>("SELECT id FROM users WHERE role IN ('ADMIN', 'SUPER_ADMIN') AND status = 'ACTIVE'");
    const [memberInfo] = await query<any[]>("SELECT full_name FROM users WHERE id = ?", [userId]);
    for (const admin of admins) {
      await query<any>(
        `INSERT INTO notifications (user_id, title, message, type)
         VALUES (?, 'Nouvelle reservation', ?, 'RESERVATION')`,
        [admin.id, `${memberInfo.full_name} a reserve ${session.name} le ${reservation_date} a ${start_time}`]
      );
    }

    success(res, {
      id: result.insertId,
      user_id: userId,
      session_id,
      session_name: session.name,
      reservation_date,
      start_time,
      end_time,
      status: "CONFIRMED",
    }, 201);
  } catch (err) {
    console.error("[RESERVATIONS] createReservation error:", err);
    error(res, "Erreur serveur", 500);
  }
}

// ── PUT /api/reservations/:id/cancel — Annuler ─────────────────

export async function cancelReservation(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;
    const userRole = req.user!.role;

    const [reservation] = await query<any[]>(
      `SELECT r.*, u.full_name FROM reservations r JOIN users u ON u.id = r.user_id WHERE r.id = ?`,
      [id]
    );

    if (!reservation) {
      error(res, "Reservation introuvable", 404);
      return;
    }

    // Un membre ne peut annuler que ses propres reservations
    if (userRole === "MEMBER" && reservation.user_id !== userId) {
      error(res, "Vous ne pouvez annuler que vos propres reservations", 403);
      return;
    }

    if (reservation.status === "CANCELLED") {
      error(res, "Cette reservation est deja annulee");
      return;
    }

    if (reservation.status === "COMPLETED") {
      error(res, "Impossible d'annuler une seance deja terminee");
      return;
    }

    // Verifier delai d'annulation (configurable via settings)
    if (userRole === "MEMBER") {
      const cancellationHours = await getSettingNumber("cancellation_hours", 2);
      const resDateTime = new Date(`${reservation.reservation_date.toISOString().split("T")[0]}T${reservation.start_time}`);
      const now = new Date();
      const hoursBeforeSession = (resDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

      if (hoursBeforeSession < cancellationHours) {
        error(res, `Annulation impossible moins de ${cancellationHours} heures avant la seance`, 400, ErrorCode.CANCELLATION_TOO_LATE);
        return;
      }
    }

    await query<any>("UPDATE reservations SET status = 'CANCELLED' WHERE id = ?", [id]);

    // Notification au membre si annulee par admin
    if (userRole !== "MEMBER" && reservation.user_id !== userId) {
      await query<any>(
        `INSERT INTO notifications (user_id, title, message, type)
         VALUES (?, 'Reservation annulee', 'Votre reservation a ete annulee par l administration.', 'RESERVATION')`,
        [reservation.user_id]
      );
    }

    success(res, { message: "Reservation annulee" });
  } catch (err) {
    console.error("[RESERVATIONS] cancelReservation error:", err);
    error(res, "Erreur serveur", 500);
  }
}

// ── PUT /api/reservations/:id/complete — Marquer terminee ──────

export async function completeReservation(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const [reservation] = await query<any[]>("SELECT id, status FROM reservations WHERE id = ?", [id]);
    if (!reservation) {
      error(res, "Reservation introuvable", 404);
      return;
    }

    if (!["PENDING", "CONFIRMED"].includes(reservation.status)) {
      error(res, `Impossible de terminer : statut actuel = ${reservation.status}`);
      return;
    }

    await query<any>("UPDATE reservations SET status = 'COMPLETED' WHERE id = ?", [id]);
    success(res, { message: "Seance marquee comme terminee" });
  } catch (err) {
    console.error("[RESERVATIONS] completeReservation error:", err);
    error(res, "Erreur serveur", 500);
  }
}

// ── PUT /api/reservations/:id/no-show — Marquer absent ─────────

export async function noShowReservation(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const [reservation] = await query<any[]>("SELECT id, status, user_id FROM reservations WHERE id = ?", [id]);
    if (!reservation) {
      error(res, "Reservation introuvable", 404);
      return;
    }

    await query<any>("UPDATE reservations SET status = 'NO_SHOW' WHERE id = ?", [id]);

    await query<any>(
      `INSERT INTO notifications (user_id, title, message, type)
       VALUES (?, 'Absence notee', 'Vous avez ete marque absent pour une seance reservee.', 'RESERVATION')`,
      [reservation.user_id]
    );

    success(res, { message: "Membre marque comme absent" });
  } catch (err) {
    console.error("[RESERVATIONS] noShowReservation error:", err);
    error(res, "Erreur serveur", 500);
  }
}

// ── GET /api/reservations/available-slots — Creneaux dispo ─────

export async function getAvailableSlots(req: Request, res: Response) {
  try {
    const date = req.query.date as string;
    const sessionId = req.query.session_id as string;

    if (!date || !sessionId) {
      error(res, "Parametres date et session_id requis");
      return;
    }

    // Trouver le jour de la semaine
    const dayOfWeek = new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { weekday: "long" }).toUpperCase();

    // Creneaux configures pour cette seance et ce jour
    const slots = await query<any[]>(
      `SELECT ts.*, s.name as session_name, s.capacity as session_capacity
       FROM time_slots ts
       JOIN sessions s ON s.id = ts.session_id
       WHERE ts.session_id = ? AND ts.day_of_week = ? AND ts.is_active = TRUE`,
      [sessionId, dayOfWeek]
    );

    // Compter les reservations existantes pour chaque creneau
    const slotsWithAvailability = await Promise.all(
      slots.map(async (slot) => {
        const [count] = await query<any[]>(
          `SELECT COUNT(*) as booked FROM reservations
           WHERE session_id = ? AND reservation_date = ? AND start_time = ?
             AND status NOT IN ('CANCELLED', 'NO_SHOW')`,
          [sessionId, date, slot.start_time]
        );

        const maxCapacity = slot.max_capacity || slot.session_capacity || 1;
        const booked = count.booked;

        return {
          ...slot,
          booked,
          max_capacity: maxCapacity,
          available: maxCapacity - booked,
          is_full: booked >= maxCapacity,
        };
      })
    );

    success(res, {
      date,
      day_of_week: dayOfWeek,
      session_id: Number(sessionId),
      slots: slotsWithAvailability,
    });
  } catch (err) {
    console.error("[RESERVATIONS] getAvailableSlots error:", err);
    error(res, "Erreur serveur", 500);
  }
}

// ── GET /api/sessions — Types de seances disponibles ───────────

export async function getSessions(req: Request, res: Response) {
  try {
    const activeOnly = req.query.active !== "false";
    const where = activeOnly ? "WHERE is_active = TRUE" : "";

    const sessions = await query<any[]>(
      `SELECT * FROM sessions ${where} ORDER BY name ASC`
    );

    success(res, sessions);
  } catch (err) {
    console.error("[RESERVATIONS] getSessions error:", err);
    error(res, "Erreur serveur", 500);
  }
}
