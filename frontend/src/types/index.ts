export interface User {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: 'owner' | 'property_manager' | 'tenant' | 'maintenance_staff';
  is_active: boolean;
  phone?: string;
  date_joined?: string;
  profile?: { role: string; phone: string; is_active: boolean };
}

export interface UserProfile extends User {
  properties_count?: number;
  units_count?: number;
}

export interface DashboardStats {
  total_units: number;
  available_units: number;
  occupied_units: number;
  maintenance_units: number;
  pending_lease_reviews: number;
  pending_work_orders: number;
  open_issues: number;
  total_properties?: number;
  active_leases?: number;
  monthly_revenue?: number;
}

export interface Property {
  id: number;
  external_property_id: string;
  name: string;
  location: string;
  ownership_entity?: { id: number; name: string };
  buildings?: { id: number; name: string; unit_count: number }[];
  total_units: number;
  occupied_units: number;
  available_units: number;
  created_at: string;
}

export interface Building {
  id: number;
  external_building_id: string;
  property: number;
  name: string;
  unit_count: number;
  floors?: number;
  units_count?: number;
  address?: string;
  property_name?: string;
  created_at?: string;
}

export interface Unit {
  id: number;
  external_unit_id: string;
  building: number;
  building_name?: string;
  property_name?: string;
  property_id?: string;
  label: string;
  unit_type: string;
  bedrooms?: number;
  bathrooms?: number;
  area_sqm: number;
  parking_bay?: string;
  floor_number?: number;
  occupancy_status: 'available' | 'occupied' | 'maintenance' | 'archived';
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Tenant {
  id: number;
  user: number;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  unit?: number;
  unit_number?: string;
  property_name?: string;
  move_in_date?: string;
  lease_start?: string;
  lease_end?: string;
  monthly_rent?: number;
  status: 'active' | 'unassigned' | 'inactive';
  created_at: string;
}

export interface Lease {
  id: number;
  unit: number | null;
  unit_label?: string;
  unit_external_id?: string;
  tenant_name?: string;
  landlord_name?: string;
  start_date?: string;
  end_date?: string;
  rent_amount?: number;
  currency?: string;
  rent_frequency?: string;
  deposit_amount?: number;
  annual_rent?: number;
  document: string;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  approval_status: 'pending_review' | 'approved' | 'rejected';
  processing_started_at?: string;
  processing_completed_at?: string;
  provider_used?: string;
  processing_error?: string;
  retry_count?: number;
  open_flags_count?: number;
  created_at: string;
  updated_at: string;
}

export interface WorkOrder {
  id: number;
  unit: number;
  unit_label?: string;
  unit_external_id?: string;
  inspection_id?: number | null;
  inspection_images?: Array<{ id: number; url: string; original_filename: string }>;
  finding?: number | null;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'in_progress' | 'completed';
  generated_by: string;
  approved_by?: string;
  approved_at?: string;
  rejection_reason?: string;
  assigned_to?: number | null;
  assigned_to_name?: string | null;
  assigned_to_email?: string | null;
  assigned_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface InspectionImage {
  id: number;
  image: string;
  original_filename: string;
  content_type: string;
  created_at: string;
}

export interface InspectionFinding {
  id: number;
  image?: number;
  category: string;
  equipment_name: string;
  condition: string;
  damage_description: string;
  confidence?: number;
  evidence: string;
  review_status: 'pending' | 'confirmed' | 'dismissed';
}

export interface Inspection {
  id: number;
  unit: number;
  unit_label?: string;
  unit_external_id?: string;
  reporter_type: 'tenant' | 'inspector' | 'owner';
  description?: string;
  status: 'pending' | 'analyzing' | 'completed' | 'failed';
  images: InspectionImage[];
  findings: InspectionFinding[];
  analyzed_at?: string | null;
  created_at: string;
}

export interface Notification {
  id: number;
  title: string;
  message: string;
  notification_type: 'info' | 'warning' | 'success' | 'error' | 'lease' | 'maintenance' | 'payment';
  is_read: boolean;
  created_at: string;
  link?: string;
}

export interface AuditEvent {
  id: number;
  entity_type: string;
  entity_id: number | string;
  action: string;
  actor: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface LeaseField {
  id: number;
  lease: number;
  field_name: string;
  field_value: string;
  field_type: 'text' | 'date' | 'number' | 'boolean';
  is_flagged?: boolean;
  flag_reason?: string;
}

export interface TenantInvitation {
  id: number;
  email: string;
  unit: number;
  unit_number?: string;
  first_name?: string;
  last_name?: string;
  move_in_date?: string | null;
  invited_by?: number;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  created_at: string;
  expires_at: string;
  accepted_at?: string | null;
}

export interface PaymentScheduleItem {
  id: number;
  lease: number;
  lease_tenant_name?: string | null;
  unit_label?: string | null;
  due_date: string;
  amount: string | number;
  currency: string;
  status: 'pending' | 'paid' | 'overdue';
  paid_at: string | null;
  paid_amount: string | number | null;
  payment_method: string | null;
  recorded_by?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface PaymentsSummary {
  total_due_this_month: number;
  collected_this_month: number;
  overdue_count: number;
  overdue_amount: number;
  collection_rate_pct: number;
}

export interface TenantPayment {
  id: number;
  lease: number;
  due_date: string;
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'overdue';
  paid_at: string | null;
}

export interface InspectionSchedule {
  id: number;
  unit: number;
  unit_label?: string;
  unit_external_id?: string;
  title: string;
  description: string;
  frequency_months: number;
  next_due_date: string;
  is_active: boolean;
  created_at: string;
}

export interface VerificationInspection {
  inspection_id: number;
  created_at?: string;
  findings: InspectionFinding[];
}

export interface WorkOrderVerification {
  before: VerificationInspection | null;
  after: VerificationInspection[];
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthResponse {
  access: string;
  refresh: string;
  user: User;
}
