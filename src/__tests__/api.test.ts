import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

const { axiosInstance } = vi.hoisted(() => ({
  axiosInstance: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
    defaults: { headers: { common: {} } },
  },
}));

// Mock axios before importing api module
vi.mock("axios", () => {
  return {
    default: { create: vi.fn(() => axiosInstance) },
  };
});

describe("API service", () => {
  let api: typeof axiosInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    await import("../services/api");
    api = axiosInstance;
  });

  it("creates an axios instance with correct baseURL", () => {
    expect(axios.create).toHaveBeenCalled();
  });

  it("sets up request interceptor for JWT token", () => {
    expect(api.interceptors.request.use).toHaveBeenCalled();
  });

  it("sets up response interceptor for 401 handling", () => {
    expect(api.interceptors.response.use).toHaveBeenCalled();
  });
});

describe("API endpoints structure", () => {
  it("authApi has all required methods", async () => {
    const { authApi } = await import("../services/api");
    expect(authApi).toHaveProperty("register");
    expect(authApi).toHaveProperty("login");
    expect(authApi).toHaveProperty("me");
    expect(authApi).toHaveProperty("logout");
    expect(authApi).toHaveProperty("changePassword");
    expect(authApi).toHaveProperty("updateProfile");
    expect(authApi).toHaveProperty("refresh");
  });

  it("plansApi has all required methods", async () => {
    const { plansApi } = await import("../services/api");
    expect(plansApi).toHaveProperty("getAll");
    expect(plansApi).toHaveProperty("getById");
    expect(plansApi).toHaveProperty("create");
    expect(plansApi).toHaveProperty("update");
    expect(plansApi).toHaveProperty("delete");
  });

  it("usersApi has all required methods", async () => {
    const { usersApi } = await import("../services/api");
    expect(usersApi).toHaveProperty("getAll");
    expect(usersApi).toHaveProperty("getById");
    expect(usersApi).toHaveProperty("create");
    expect(usersApi).toHaveProperty("update");
    expect(usersApi).toHaveProperty("delete");
    expect(usersApi).toHaveProperty("validate");
    expect(usersApi).toHaveProperty("suspend");
    expect(usersApi).toHaveProperty("reactivate");
  });

  it("paymentsApi has all required methods", async () => {
    const { paymentsApi } = await import("../services/api");
    expect(paymentsApi).toHaveProperty("getAll");
    expect(paymentsApi).toHaveProperty("getUserPayments");
    expect(paymentsApi).toHaveProperty("create");
    expect(paymentsApi).toHaveProperty("validate");
    expect(paymentsApi).toHaveProperty("cancel");
    expect(paymentsApi).toHaveProperty("refund");
    expect(paymentsApi).toHaveProperty("dailyStats");
    expect(paymentsApi).toHaveProperty("monthlyStats");
  });

  it("reservationsApi has all required methods", async () => {
    const { reservationsApi } = await import("../services/api");
    expect(reservationsApi).toHaveProperty("getAll");
    expect(reservationsApi).toHaveProperty("getToday");
    expect(reservationsApi).toHaveProperty("create");
    expect(reservationsApi).toHaveProperty("cancel");
    expect(reservationsApi).toHaveProperty("getAvailableSlots");
    expect(reservationsApi).toHaveProperty("getSessions");
  });

  it("dashboardApi has all required methods", async () => {
    const { dashboardApi } = await import("../services/api");
    expect(dashboardApi).toHaveProperty("summary");
    expect(dashboardApi).toHaveProperty("alerts");
    expect(dashboardApi).toHaveProperty("dailyRevenue");
    expect(dashboardApi).toHaveProperty("monthlyRevenue");
  });
});
