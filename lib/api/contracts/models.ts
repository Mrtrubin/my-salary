import type { AmountInCents, RateInBps } from "./common";

export type ProfileStatus = "active" | "disabled";
export type SystemRole = "admin" | "user";
export type PerformanceStatus = "draft" | "pending" | "approved" | "rejected";
export type SalarySchemeStatus = "active" | "archived";
export type SalaryRecordStatus = "draft" | "confirmed" | "published" | "voided";
export type TeamStatus = "active" | "disabled";

export interface TeamMember { profileId: string; name: string }
export interface Team { id: string; name: string; hostProfileId: string; hostName: string; status: TeamStatus; members: TeamMember[] }

export interface Position { id: number; code: string; name: string; defaultPermissions: string[]; memberCount: number }
export interface Profile { id: string; authUserId: string | null; name: string; phone: string; hireDate: string; status: ProfileStatus; systemRole: SystemRole; positions: Position[] }
export interface PerformanceRecord { id: string; profileId: string; anchorName: string; hostProfileId: string | null; hostName: string | null; month: string; revenueInCents: AmountInCents; status: PerformanceStatus; rejectReason: string | null; submittedAt: string | null }
export interface SalaryScheme { id: string; profileId: string; positionId: number; name: string; version: number; assignedTo: string; baseSalaryInCents: AmountInCents; guaranteedSalaryInCents: AmountInCents; thresholdMultiplierBps: RateInBps; commissionRateBps: RateInBps; effectiveFrom: string; status: SalarySchemeStatus }
export interface SalaryRecord { id: string; profileId: string; positionId: number; month: string; userName: string; position: string; schemeName: string; schemeVersion: number; revenueInCents: AmountInCents; tenureMonth: number; baseSalaryInCents: AmountInCents; guaranteedSalaryInCents: AmountInCents; thresholdMultiplierBps: RateInBps; commissionRateBps: RateInBps; thresholdInCents: AmountInCents; isQualified: boolean; isGracePeriod: boolean; guaranteedComponentInCents: AmountInCents; performanceComponentInCents: AmountInCents; grossInCents: AmountInCents; serviceFeeRateBps: RateInBps; serviceFeeInCents: AmountInCents; netInCents: AmountInCents; status: SalaryRecordStatus }
export interface DashboardSummary { activeEmployees: number; totalEmployees: number; pendingReview: number; rejected: number; monthRevenueInCents: number; monthNetInCents: number; salaryRecordCount: number; salaryDraftCount: number }
