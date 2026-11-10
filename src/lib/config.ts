/** Ported 1:1 from the arrays defined in inc/config.php */
export const staffPermissions: Record<string, string[]> = {
  Accounts: ['advance_salary', 'payments'],
  Dispatches: ['dispatches'],
  Gate: ['receiving_notes'],
  HR: ['jobs', 'tours', 'leaves', 'gate_passes', 'contractual_labor', 'holidays'],
  Maintenance: ['complaint_tickets'],
  Management: ['production_reports', 'store_reports', 'hr_reports', 'daily_summary', 'dispatch_reports'],
  Production: ['production_instances', 'production_logs'],
  Quality: ['quality_tickets'],
  Store: ['material_requisition', 'heavy_equipment'],
};

export const pageToTable: Record<string, string> = {
  customers: 'users', staff: 'users', admins: 'users', admin_profiles: 'permissions',
};
export const pageToPermission: Record<string, string> = {
  staff_roles: 'admin_profiles', register_data: 'registers', job_interviews: 'jobs', products: 'production',
  production_lots: 'production_instances', production_logs: 'production', maintenance_tasks: 'production',
  heavy_equipment_requests: 'heavy_equipment', resins: 'production', leave_applications: 'leaves',
};
export const staffPageToPermission: Record<string, string> = {
  job_interviews: 'jobs', products: 'production', production_lots: 'production_instances',
  maintenance_tasks: 'production', heavy_equipment_requests: 'heavy_equipment', resins: 'production',
  leave_applications: 'leaves',
};

export const dispatchStatusLegend: Record<number, string> = { 0: 'Cancelled', 1: 'In progress', 2: 'Complete' };

export const dispatchTimeline: Record<string, { name: string; department: number; additional_info?: string }> = {
  gate_reporting: { name: 'Vehicle at Gate/Document Collected', department: 8, additional_info: 'vehicle_number' },
  gate_check: { name: 'Vehicle Clean/Checked', department: 8 },
  gate_in: { name: 'Vehicle In', department: 8 },
  loading_start: { name: 'Loading Start', department: 3 },
  loading_end: { name: 'Loading Done', department: 3, additional_info: 'items' },
  quality_in: { name: 'Quality In', department: 4 },
  quality_out: { name: 'Quality Out', department: 4, additional_info: 'signature' },
  accounts_in: { name: 'Invoice Start', department: 3 },
  accounts_out: { name: 'Invoice End', department: 3 },
  dispatched: { name: 'Vehicle Dispatched', department: 8 },
};

export const registerFieldTypes: Record<string, string> = {
  text: 'Text', textarea: 'Multi Line Text', number: 'Number', checkbox: 'Checkbox', select: 'Picker',
  file: 'Image Upload', datepicker: 'Date Picker', timepicker: 'Time Picker',
};
export const dispatchCategories: Record<number, string> = { 1: 'Client', 2: 'Warehouse' };
export const standardStatusLegend: Record<number, string> = { 0: 'Deleted', 1: 'Inactive', 2: 'Active' };
export const statusToColor: Record<number, string> = { 0: 'error', 1: 'warning', 2: 'success' };
export const jobInterviewStatusLegend: Record<number, string> = {
  0: 'Rejected', 1: 'Interview Pending', 2: 'Shortlisted', 3: 'Selected', 4: 'Hired', 5: 'Joined', 6: 'Fired',
};
export const leaveStatusLegend: Record<number, string> = { 0: 'Denied', 1: 'Requested', 2: 'Approved' };
export const productionStatusLegend: Record<number, string> = {
  0: '<span class="material-icons">cancel</span> Cancelled',
  1: '<span class="material-icons">pan_tool</span> On Hold',
  2: 'New',
  3: '<span class="material-icons">thumb_up</span> Accepted',
  4: '<span class="material-icons">build</span> Preparing',
  5: '<span class="material-icons">clock_loader_60</span> Started',
  6: '<span class="material-icons">check_circle</span> Complete',
};
export const productionInstanceStatusLegend: Record<number, string> = {
  0: 'Pending Approval', 1: 'New', 2: 'Accepted', 3: 'Resin Load', 4: 'Mold Change', 5: 'Machine Running',
  6: 'Loading Stopped', 7: 'Machine Stopped', 8: 'Complete',
};
export const materialRequestStatusLegend: Record<number, string> = {
  0: '<span class="material-icons">cancel</span> Cancelled', 1: 'Requested',
  2: '<span class="material-icons">check_circle</span> Processed',
};
export const materialItemStatus: Record<number, string> = { 0: 'Unavailable', 1: 'Ordered', 2: 'Issued' };
export const complaintStatusLegend: Record<number, string> = { 0: 'Rejected', 1: 'Pending', 2: 'Resolved' };
export const packingMaterials: Record<string, string> = {
  'Corrugated Boxes': 'pcs', 'Ld 40*43': 'kg', 'Tape 3 inch': 'pcs', 'Strapping roll': 'per/roll',
  'Cable Tie': 'per/pkt', 'Colour Turqouish Green': 'kg', 'Colour Emerald Green': 'kg', 'AA schewenzer': 'kg',
  'Green Sticker': 'pcs', 'White Sticker': 'pcs', 'Carbon Roll': 'per/roll',
};
export const machineParams = [
  'Resin residence time', 'Resin level', 'Dryer process air temperature', 'Dew point of the drying air',
  'Extruder temperature Zone 1', 'Extruder temperature Zone 2', 'Extruder temperature Zone 3',
  'Extruder temperature Zone 4', 'Extruder temperature Zone 5', 'Extruder temperature Zone 6',
  'Crystallinity and or un-melts issue', 'All other temperatures of the extruder', 'Shooting pot',
  'M/c distributor', 'Mold hot runner', 'Screw back pressure', 'Screw speed', 'Injecting/filling time (Sec)',
  'Injecting/filling speed (mm/sec)', 'Hold pressure (bar)', 'Transfer cushion (mm)', 'Screw transfer time (sec)',
  'Injection Cushion (mm)',
];
export const productParameters = [
  'Resin Intrinsic Viscosity', 'Weight', 'Gate Point', 'Preform Colour', 'Preform Height', 'Wall thickness',
  'Perpendicularity', 'Supplier identification on Preform', 'Neck Inner Diameter', 'Neck Outer Diameter Without Thread',
  'Neck Outer Diameter With Thread', 'Collar outer diameter', 'Neck ring height form top', 'Collar height from top',
  'Collar Thickness – Inner', 'Collar Thickness – Outer', 'Acetaldehyde Contents',
  'Overall, Colour Migration & Specific Migration', 'Resin COA', 'Resin Material Food Grade compliance report', 'Allergen',
];
export const heavyEquipmentStatus: Record<number, string> = { 0: 'Rejected', 1: 'Requested', 2: 'Approved', 3: 'In progress', 4: 'Complete' };
export const qualityTicketStatus: Record<number, string> = { 0: 'Closed', 1: 'Opened', 2: 'Fixed', 3: 'Complete' };
export const paymentStatusLegend: Record<number, string> = {
  0: 'Denied', 1: 'Requested', 2: 'Approved', 3: '<span class="material-icons">check_circle</span> Paid',
};
