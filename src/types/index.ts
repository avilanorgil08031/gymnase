// Types alignes sur le schema MySQL et les reponses API

export type UserRole = "VISITOR" | "MEMBER" | "COACH" | "ADMIN" | "SUPER_ADMIN";
export type UserStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "EXPIRED" | "DELETED";

export interface User {
  id: number;
  full_name: string;
  email: string | null;
  phone: string;
  role: UserRole;
  status: UserStatus;
  member_code: string;
  qr_code_token?: string;
  referral_code?: string;
  branch_id?: number | null;
  sport_goal?: string;
  created_at: string;
  updated_at?: string;
}

export interface MembershipPlan {
  id: number;
  name: string;
  description?: string;
  price: number;
  duration_days: number;
  is_active: boolean;
  created_at: string;
}

export type SubscriptionStatus = "PENDING" | "ACTIVE" | "EXPIRED" | "CANCELLED";

export interface Subscription {
  id: number;
  user_id: number;
  plan_id: number;
  plan_name?: string;
  plan_price?: number;
  start_date: string;
  end_date: string;
  status: SubscriptionStatus;
  duration_days?: number;
  created_at: string;
}

export interface Session {
  id: number;
  name: string;
  description?: string;
  capacity: number;
  duration_minutes: number;
  branch_id?: number | null;
  is_active: boolean;
  created_at: string;
}

export interface TimeSlot {
  id: number;
  session_id: number;
  day_of_week: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";
  start_time: string;
  end_time: string;
  max_capacity: number;
  is_active: boolean;
}

export type ReservationStatus = "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";

export interface Reservation {
  id: number;
  user_id: number;
  session_id: number;
  coach_id?: number | null;
  time_slot_id?: number | null;
  branch_id?: number | null;
  reservation_date: string;
  start_time: string;
  end_time: string;
  status: ReservationStatus;
  created_at: string;
  // Joined fields
  session_name?: string;
  user_name?: string;
}

export type PaymentMethod = "CASH" | "WAVE" | "ORANGE_MONEY" | "MTN_MONEY" | "CARD" | "BANK_TRANSFER";
export type PaymentStatus = "PENDING" | "PAID" | "FAILED" | "CANCELLED" | "REFUNDED";

export interface Payment {
  id: number;
  user_id: number;
  subscription_id?: number | null;
  amount: number;
  payment_method: PaymentMethod;
  status: PaymentStatus;
  transaction_reference?: string;
  paid_at?: string | null;
  created_at: string;
  // Joined fields
  user_name?: string;
}

export interface Notification {
  id: number;
  user_id?: number | null;
  title: string;
  message: string;
  type: "INFO" | "PAYMENT" | "RESERVATION" | "SUBSCRIPTION" | "SYSTEM";
  is_read: boolean;
  created_at: string;
}

export interface AttendanceLog {
  id: number;
  user_id: number;
  check_in_time: string;
  check_out_time?: string | null;
  method: "QR_CODE" | "MANUAL" | "ADMIN";
  status: "VALID" | "DENIED";
  reason?: string;
  created_at: string;
}

export interface Invoice {
  id: number;
  user_id: number;
  payment_id?: number | null;
  invoice_number: string;
  label: string;
  amount: number;
  status: "DRAFT" | "SENT" | "PAID" | "CANCELLED";
  due_date?: string;
  paid_at?: string | null;
  created_at: string;
}

export interface MemberProgress {
  id: number;
  user_id: number;
  weight?: number;
  height?: number;
  body_fat?: number;
  muscle_mass?: number;
  goal?: string;
  notes?: string;
  recorded_at: string;
  created_at: string;
}

export interface WorkoutPlan {
  id: number;
  user_id: number;
  coach_id?: number | null;
  title: string;
  description?: string;
  start_date?: string;
  end_date?: string;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  exercises?: WorkoutExercise[];
  created_at: string;
}

export interface WorkoutExercise {
  id: number;
  plan_id: number;
  day_number: number;
  exercise_name: string;
  sets_count?: number;
  reps_count?: number;
  weight_kg?: number;
  duration_minutes?: number;
  rest_seconds?: number;
  notes?: string;
  sort_order: number;
}

export interface PromoCode {
  id: number;
  code: string;
  discount_type: "PERCENTAGE" | "FIXED";
  discount_value: number;
  min_amount: number;
  start_date?: string;
  end_date?: string;
  max_uses?: number;
  used_count: number;
  is_active: boolean;
  created_at: string;
}

export interface Referral {
  id: number;
  referrer_id: number;
  referred_user_id: number;
  referral_code: string;
  reward_type: "DISCOUNT" | "FREE_SESSION" | "FREE_MONTH" | "BONUS";
  reward_value: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  created_at: string;
}

export interface MemberRiskScore {
  id: number;
  user_id: number;
  score: number;
  risk_level: "LOW" | "MEDIUM" | "HIGH";
  factors?: Record<string, unknown>;
  calculated_at: string;
}

export interface Message {
  id: number;
  sender_id: number;
  receiver_id?: number | null;
  title?: string;
  content: string;
  type: "PRIVATE" | "GROUP" | "BROADCAST";
  target_group?: "ALL" | "MEMBERS" | "EXPIRED" | "INACTIVE" | "COACHES" | null;
  is_read: boolean;
  created_at: string;
  sender_name?: string;
}

export interface Branch {
  id: number;
  name: string;
  address?: string;
  phone?: string;
  city?: string;
  email?: string;
  is_active: boolean;
  created_at: string;
}

export interface Product {
  id: number;
  name: string;
  description?: string;
  price: number;
  category: string;
  stock_quantity: number;
  image_url?: string;
  is_active: boolean;
  created_at: string;
}

export interface Badge {
  id: number;
  name: string;
  description?: string;
  icon: string;
  criteria_type: "SESSIONS_COUNT" | "ATTENDANCE_STREAK" | "MONTHS_ACTIVE" | "GOAL_REACHED" | "MANUAL";
  criteria_value: number;
  created_at: string;
}

export interface UserBadge {
  id: number;
  user_id: number;
  badge_id: number;
  earned_at: string;
  badge_name?: string;
  badge_icon?: string;
}

export interface ActivityLog {
  id: number;
  admin_id: number;
  admin_name: string;
  action: string;
  target_type: string;
  target_id?: number;
  description: string;
  metadata?: Record<string, unknown>;
  ip_address?: string;
  created_at: string;
}

export interface Setting {
  setting_key: string;
  setting_value: string;
  setting_type: "STRING" | "NUMBER" | "BOOLEAN" | "JSON";
  description?: string;
  updated_at: string;
}

// API response wrappers
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
