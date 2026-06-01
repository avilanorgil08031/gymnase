import { Request, Response } from "express";
import { error, ErrorCode } from "./response.js";

export function isAdminRole(role?: string) {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

export function canAccessUserResource(req: Request, res: Response, userIdParam: string) {
  if (!req.user) {
    error(res, "Non authentifie", 401, ErrorCode.TOKEN_MISSING);
    return false;
  }

  const userId = Number(userIdParam);
  if (!Number.isInteger(userId) || userId <= 0) {
    error(res, "Identifiant utilisateur invalide", 400, ErrorCode.VALIDATION_ERROR);
    return false;
  }

  if (!isAdminRole(req.user.role) && req.user.userId !== userId) {
    error(res, "Acces refuse", 403, ErrorCode.FORBIDDEN);
    return false;
  }

  return true;
}
