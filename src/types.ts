export interface Subject {
  id: string;
  name: string;
  description?: string | null;
  created_at?: string;
}

export interface EnrollmentLink {
  id: string;
  token: string;
  status: 'active' | 'inactive';
  subject_id?: string | null;
  subject_name?: string | null;
  created_at?: string;
}

export type RequestStatus = 'pending' | 'accepted' | 'rejected';

export interface EnrollmentRequest {
  id: string;
  student_name: string;
  roll_number: number;
  enrollment_token?: string | null;
  status: RequestStatus;
  assigned_subject_id?: string | null;
  assigned_subject_name?: string | null;
  created_at?: string;
  accepted_at?: string | null;
}

export interface EnrolledStudent {
  id: string;
  request_id?: string | null;
  name: string;
  roll_number: number;
  subject_id?: string | null;
  subject_name?: string | null;
  enrolled_at?: string;
}
