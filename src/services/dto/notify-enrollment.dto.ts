export enum EnrollmentActionType {
	ENROLL   = 'ENROLL',
	UNENROLL = 'UNENROLL',
}


export enum EnrollmentNotifyStatus {
	SUCCESS = 'SUCCESS',
	FAILED  = 'FAILED',
	PARTIAL = 'PARTIAL',
}


export interface NotifyEnrollmentDto {
	ticketId   : string;
	studentId  : string;
	sessionId  : string;
	actionType : EnrollmentActionType;
	status     : EnrollmentNotifyStatus;
	ssec      : string;
}
