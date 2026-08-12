// ─── Job Payloads ────────────────────────────────────────────────────────────
export interface EnrollSessionsPayload {
	email      : string;
	periodId   : string;
	ticketId   : string;
	sessionIds : string[];
}


export interface UnenrollSessionsPayload {
	email      : string;
	periodId   : string;
	ticketId   : string;
	sessionIds : string[];
}



export type JobType = "ENROLL_SECTIONS" | "UNENROLL_SECTIONS";

// ─── Redis State ──────────────────────────────────────────────────────────────
export type EnrollmentStateStatus = "PENDING" | "SUCCESS" | "FAILED" | "PARTIAL";


export interface EnrollmentState {
	studentId         : string;
	periodId          : string;
	status            : EnrollmentStateStatus;
	timestamp         : string;
	enrolledSessions  : string[];
	failedSessions    : string[];
	errorMessage      : string | null;
}

// ─── Redis Quota ──────────────────────────────────────────────────────────────
export interface SessionQuota {
	registered      : number;
	chairsAvailable : number;
	capacity        : number;
}

// ─── Quota Result Map ─────────────────────────────────────────────────────────
export type QuotaResult = "ok" | "no-quota" | "not-found";


export type QuotaResultMap = Map<string, QuotaResult>;
