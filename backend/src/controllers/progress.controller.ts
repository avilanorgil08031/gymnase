import { Request, Response } from "express";
import { z } from "zod";
import { query } from "../config/database.js";
import { success, error, ErrorCode } from "../utils/response.js";
import { canAccessUserResource } from "../utils/access.js";

const progressSchema = z.object({
  weight: z.number().positive().optional().nullable(),
  height: z.number().positive().optional().nullable(),
  body_fat: z.number().min(0).max(100).optional().nullable(),
  muscle_mass: z.number().positive().optional().nullable(),
  goal: z.string().max(150).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  recorded_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// GET /api/progress/user/:userId
export async function getUserProgress(req: Request, res: Response) {
  try {
    const { userId } = req.params;
    if (!canAccessUserResource(req, res, userId)) return;

    const entries = await query<any[]>(
      "SELECT * FROM member_progress WHERE user_id = ? ORDER BY recorded_at DESC",
      [userId]
    );
    success(res, entries);
  } catch (err) {
    console.error("[PROGRESS] getUserProgress error:", err);
    error(res, "Erreur serveur", 500, ErrorCode.INTERNAL_ERROR);
  }
}

// POST /api/progress
export async function addProgress(req: Request, res: Response) {
  try {
    const parsed = progressSchema.safeParse(req.body);
    if (!parsed.success) {
      error(res, parsed.error.errors.map((e) => e.message).join(", "), 400, ErrorCode.VALIDATION_ERROR);
      return;
    }

    const userId = req.user!.userId;
    const d = parsed.data;

    const result = await query<any>(
      `INSERT INTO member_progress (user_id, weight, height, body_fat, muscle_mass, goal, notes, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, d.weight || null, d.height || null, d.body_fat || null, d.muscle_mass || null, d.goal || null, d.notes || null, d.recorded_at]
    );

    success(res, { id: result.insertId }, 201, "Progression enregistree");
  } catch (err) {
    console.error("[PROGRESS] addProgress error:", err);
    error(res, "Erreur serveur", 500, ErrorCode.INTERNAL_ERROR);
  }
}

// DELETE /api/progress/:id
export async function deleteProgress(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;
    await query<any>("DELETE FROM member_progress WHERE id = ? AND user_id = ?", [id, userId]);
    success(res, null, 200, "Entree supprimee");
  } catch (err) {
    console.error("[PROGRESS] deleteProgress error:", err);
    error(res, "Erreur serveur", 500, ErrorCode.INTERNAL_ERROR);
  }
}
