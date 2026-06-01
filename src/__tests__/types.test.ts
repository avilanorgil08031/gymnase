import { describe, it, expect } from "vitest";
import type {
  User,
  MembershipPlan,
  Subscription,
  Reservation,
  Payment,
  PaymentMethod,
  Notification,
  Badge,
  Branch,
  Product,
  ApiResponse,
  PaginatedResponse,
} from "../types";

describe("Type definitions", () => {
  it("User type matches MySQL schema", () => {
    const user: User = {
      id: 1,
      full_name: "Moussa Diallo",
      email: "moussa@test.com",
      phone: "+221770000000",
      role: "MEMBER",
      status: "ACTIVE",
      member_code: "EG-001",
      created_at: "2024-01-01T00:00:00Z",
    };
    expect(user.id).toBe(1);
    expect(user.role).toBe("MEMBER");
    expect(user.status).toBe("ACTIVE");
  });

  it("MembershipPlan type matches MySQL schema", () => {
    const plan: MembershipPlan = {
      id: 1,
      name: "Premium",
      description: "Acces complet",
      price: 25000,
      duration_days: 30,
      is_active: true,
      created_at: "2024-01-01T00:00:00Z",
    };
    expect(plan.price).toBe(25000);
    expect(plan.duration_days).toBe(30);
  });

  it("Payment type supports all African payment methods", () => {
    const methods: PaymentMethod[] = ["CASH", "WAVE", "ORANGE_MONEY", "MTN_MONEY", "CARD", "BANK_TRANSFER"];
    const payment: Payment = {
      id: 1,
      user_id: 1,
      amount: 10000,
      payment_method: "WAVE",
      status: "PAID",
      created_at: "2024-01-01T00:00:00Z",
    };
    expect(methods).toContain(payment.payment_method);
    expect(methods).toHaveLength(6);
  });

  it("Subscription status transitions are valid", () => {
    const sub: Subscription = {
      id: 1,
      user_id: 1,
      plan_id: 1,
      start_date: "2024-01-01",
      end_date: "2024-01-31",
      status: "ACTIVE",
      created_at: "2024-01-01T00:00:00Z",
    };
    const validStatuses: Subscription["status"][] = ["PENDING", "ACTIVE", "EXPIRED", "CANCELLED"];
    expect(validStatuses).toContain(sub.status);
  });

  it("Reservation type includes all status values", () => {
    const reservation: Reservation = {
      id: 1,
      user_id: 1,
      session_id: 1,
      reservation_date: "2024-01-15",
      start_time: "09:00",
      end_time: "10:00",
      status: "CONFIRMED",
      created_at: "2024-01-01T00:00:00Z",
    };
    const validStatuses: Reservation["status"][] = ["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"];
    expect(validStatuses).toContain(reservation.status);
  });

  it("ApiResponse wraps data correctly", () => {
    const response: ApiResponse<User> = {
      success: true,
      data: {
        id: 1,
        full_name: "Test",
        email: null,
        phone: "771234567",
        role: "MEMBER",
        status: "ACTIVE",
        member_code: "EG-001",
        created_at: "2024-01-01T00:00:00Z",
      },
    };
    expect(response.success).toBe(true);
    expect(response.data.role).toBe("MEMBER");
  });

  it("PaginatedResponse includes pagination metadata", () => {
    const response: PaginatedResponse<User> = {
      success: true,
      data: [],
      pagination: { page: 1, limit: 20, total: 100, totalPages: 5 },
    };
    expect(response.pagination.totalPages).toBe(5);
    expect(response.data).toHaveLength(0);
  });

  it("Badge criteria types cover all gamification rules", () => {
    const badge: Badge = {
      id: 1,
      name: "Premier pas",
      icon: "footprints",
      criteria_type: "SESSIONS_COUNT",
      criteria_value: 1,
      created_at: "2024-01-01T00:00:00Z",
    };
    const validCriteria: Badge["criteria_type"][] = [
      "SESSIONS_COUNT", "ATTENDANCE_STREAK", "MONTHS_ACTIVE", "GOAL_REACHED", "MANUAL",
    ];
    expect(validCriteria).toContain(badge.criteria_type);
  });

  it("Branch type supports multi-gym setup", () => {
    const branch: Branch = {
      id: 1,
      name: "Elite Gym - Dakar",
      address: "Dakar, Senegal",
      city: "Dakar",
      is_active: true,
      created_at: "2024-01-01T00:00:00Z",
    };
    expect(branch.city).toBe("Dakar");
  });

  it("Product type supports shop inventory", () => {
    const product: Product = {
      id: 1,
      name: "Gourde Elite Gym",
      price: 5000,
      category: "Accessoire",
      stock_quantity: 50,
      is_active: true,
      created_at: "2024-01-01T00:00:00Z",
    };
    expect(product.stock_quantity).toBe(50);
  });
});
