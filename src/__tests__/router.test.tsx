import { describe, it, expect } from "vitest";
import { router } from "../router";

describe("Router configuration", () => {
  it("has public routes", () => {
    const publicRoutes = router.routes[0];
    expect(publicRoutes.children).toBeDefined();

    const paths = publicRoutes.children!.map((r) => r.path);
    expect(paths).toContain("/");
    expect(paths).toContain("/plans");
    expect(paths).toContain("/login");
    expect(paths).toContain("/register");
  });

  it("has member routes", () => {
    const memberRoutes = router.routes[1];
    expect(memberRoutes.children).toBeDefined();

    const paths = memberRoutes.children!.map((r) => r.path);
    expect(paths).toContain("/membre");
    expect(paths).toContain("/membre/reservations");
    expect(paths).toContain("/membre/paiements");
    expect(paths).toContain("/membre/profil");
    expect(paths).toContain("/membre/qrcode");
    expect(paths).toContain("/membre/progression");
    expect(paths).toContain("/membre/programmes");
    expect(paths).toContain("/membre/badges");
    expect(paths).toContain("/membre/parrainage");
    expect(paths).toContain("/membre/messages");
  });

  it("has admin routes", () => {
    const adminRoutes = router.routes[2];
    expect(adminRoutes.children).toBeDefined();

    const paths = adminRoutes.children!.map((r) => r.path);
    expect(paths).toContain("/admin");
    expect(paths).toContain("/admin/membres");
    expect(paths).toContain("/admin/reservations");
    expect(paths).toContain("/admin/paiements");
    expect(paths).toContain("/admin/plans");
    expect(paths).toContain("/admin/presences");
    expect(paths).toContain("/admin/analytics");
    expect(paths).toContain("/admin/settings");
  });

  it("has kiosk route with lazy loading", () => {
    const kioskRoute = router.routes.find((r) => r.path === "/kiosk");
    expect(kioskRoute).toBeDefined();
    expect(kioskRoute!.lazy).toBeDefined();
  });

  it("has checkin route with lazy loading", () => {
    const checkinRoute = router.routes.find((r) => r.path === "/checkin");
    expect(checkinRoute).toBeDefined();
    expect(checkinRoute!.lazy).toBeDefined();
  });

  it("has fallback route redirecting to /", () => {
    const fallback = router.routes.find((r) => r.path === "*");
    expect(fallback).toBeDefined();
  });
});
