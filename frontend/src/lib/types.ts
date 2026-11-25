// Hand-written mirrors of backend/models/injector.py — keep in sync.
export type CardState = "card" | "missing" | "pending_placeholder";
export type MatchStatus = "clean" | "exception";
export type Decision = "auto_approved" | "approved" | "rejected" | "pending";
export type BatchStatus = "review" | "ready" | "package_generated" | "published";
export type LevelStatus = "pending" | "confirmed_70" | "outdated" | "possible_misread" | "unreadable";
export type LevelDecision = "approve_70" | "ocr_misread" | "require_regeneration";
export type Change = "new" | "replacement" | "fill" | "unmatched";
export type RegenStatus = "pending" | "in_progress" | "regenerated" | "verified" | "published";

export interface Me {
  user_id: string;
  role: string;
  email: string;
  name: string;
}

export interface UserRow {
  user_id: string;
  email: string;
  name: string;
  role: string;
}

export interface UserList {
  roles: string[];
  users: UserRow[];
}

export interface CatalogItemIn {
  serial: string;
  name: string;
  rarity?: string;
  manufacturer?: string;
  item_type?: string;
  level?: number;
  item_key?: string;
  has_image?: boolean | null;
  image_url?: string | null;
}

export interface CatalogItem {
  id: string;
  serial: string;
  name: string;
  rarity: string;
  manufacturer: string;
  item_type: string;
  level: number;
  item_key: string;
  card_state: CardState;
  card_image_id: string | null;
  card_updated_at: string | null;
  placeholder_published_at: string | null;
  level_status: LevelStatus | null;
  needs_level70_refresh: boolean;
  site_item_id: string | null;
  site_item_name: string;
  site_link_method: string | null;
  regen_status: RegenStatus | null;
  regen_status_by: string | null;
  regen_status_at: string | null;
  quarantined: boolean;
  quarantine_reason: string;
  stale_reasons: string[];
}

export interface WorklistStatusIn {
  status: "pending" | "in_progress" | "regenerated";
}

export interface QuarantineIn {
  quarantined: boolean;
  reason: string;
}

export interface CatalogEditIn {
  name?: string;
  item_type?: string;
  manufacturer?: string;
  rarity?: string;
}

export interface CatalogImportResult {
  imported: number;
  with_card: number;
  image_missing: number;
}

export interface Batch {
  id: string;
  filename: string;
  created_at: string;
  created_by: string;
  status: BatchStatus;
  total: number;
  clean: number;
  exceptions: number;
  pending: number;
  approved: number;
  rejected: number;
  zip_files: number;
  add_to_catalog: boolean;
  analysis_status: "pending" | "running" | "done";
  analysis_total: number;
  analysis_done: number;
  new_records: number;
  replacements: number;
  fills: number;
  unmatched: number;
  duplicate_files: number;
  ocr_conflicts: number;
  level_held: number;
  missing_records: number;
  package_generated_at: string | null;
  published_at: string | null;
  published_by: string | null;
  rolled_back_at: string | null;
  rolled_back_by: string | null;
  note: string;
}

export interface BatchNoteIn {
  note: string;
}

export interface ValidationRow {
  match_id: string;
  serial: string;
  item_key: string;
  name: string;
  change: string;
  blockers: string[];
  warnings: string[];
}

export interface ValidationReport {
  batch_id: string;
  would_publish: number;
  publishable: number;
  blocked: number;
  warnings: number;
  rows: ValidationRow[];
}

export interface RollbackResult {
  batch_id: string;
  dry_run: boolean;
  cards_reverted: number;
  records_archived: number;
  placeholders_reverted: number;
  regen_flags_cleared: number;
  links_removed: number;
  conflicts: string[];
  reversible_changes: number;
}

export interface Match {
  id: string;
  batch_id: string;
  index: number;
  serial: string;
  file: string;
  file_prefix: string;
  file_item_name: string;
  file_ext: string;
  file_slug: string;
  image_code: string;
  item_key: string;
  sha256: string;
  manifest_name: string;
  level: number | null;
  source: string;
  catalog_item_id: string | null;
  catalog_name: string;
  rarity: string;
  manufacturer: string;
  item_type: string;
  image_id: string | null;
  previous_card_state: CardState | null;
  change: Change;
  status: MatchStatus;
  reasons: string[];
  flags: string[];
  decision: Decision;
  note: string;
  decided_by: string | null;
  decided_at: string | null;
  ocr_status: "pending" | "done" | "error";
  ocr_level: number | null;
  ocr_level_text: string;
  ocr_level_conf: number | null;
  ocr_name_text: string;
  ocr_name_score: number | null;
  level_status: LevelStatus;
  level_crop_id: string | null;
  level_decision: LevelDecision | null;
  level_decided_by: string | null;
  level_decided_at: string | null;
  compare_image_id: string | null;
}

export interface LevelDecisionIn {
  decision: LevelDecision;
  note: string;
}

export interface DecisionIn {
  decision: "approved" | "rejected" | "pending";
  note: string;
}

export interface DirectUploadIn {
  confirmation: string;
  acknowledged: boolean;
}

export interface DirectUploadResult {
  batch_id: string;
  replaced: number;
  added: number;
  created: number;
  placeholders: number;
  held_for_regeneration: number;
  blocked: number;
  simulated: boolean;
}

export interface QueuePublishResult {
  published: number;
}

export interface Stats {
  catalog_total: number;
  catalog_with_card: number;
  catalog_missing: number;
  catalog_pending_placeholder: number;
  needs_refresh: number;
  unlinked: number;
  latest_batch: Batch | null;
}

export interface UploadSession {
  id: string;
  filename: string;
  size: number;
  chunk_size: number;
  total_chunks: number;
  received: number[];
  status: "uploading" | "complete";
  batch_id: string | null;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  batch_id: string | null;
  catalog_item_id: string | null;
  serial: string;
  item_key: string;
  item_name: string;
  site_item_id: string | null;
  previous_image_id: string | null;
  new_image_id: string | null;
  details: Record<string, unknown>;
  restored_at: string | null;
}

export interface ImportHistoryEntry {
  batch: Batch;
  changes: Record<string, number>;
  events: AuditEntry[];
  can_download: boolean;
}

export interface SiteItem {
  item_id: string;
  item_name: string;
  manufacturer: string;
  category: string;
  code_count: number;
}

export interface SiteImportResult {
  codes: number;
  items: number;
  auto_linked: number;
  with_item_key: number;
}

export interface ItemKeyMapRow {
  item_key: string;
  site_item: string;
}

export interface ItemKeyMapResult {
  saved: number;
  invalid: number;
  unknown_site_items: number;
  high_confidence_now: number;
}

export interface PublicStatusIn {
  serial: string;
  status: "in_progress";
  name: string;
}

export interface UnlinkedItem {
  item: CatalogItem;
  suggestion: SiteItem | null;
  suggestion_reason: string;
  suggestion_basis: "item_key" | "image_code" | "name" | "none";
  confidence: "high" | "medium" | "low" | null;
  conflicts: string[];
}

export interface BulkAcceptIn {
  mode: "selected" | "all_high";
  catalog_item_ids: string[];
}

export interface BulkAcceptResult {
  linked: number;
  skipped: number;
  skipped_reasons: string[];
}

export interface ShareStatus {
  enabled: boolean;
  token: string | null;
  created_by: string | null;
  created_at: string | null;
}

export interface ShareIn {
  enabled: boolean;
  regenerate: boolean;
}

export interface PublicWorklistRow {
  name: string;
  serial: string;
  item_key: string;
  item_type: string;
  status: RegenStatus;
  by: string | null;
}

export interface PublicWorklist {
  generated_at: string;
  rows: PublicWorklistRow[];
}

export interface StatDiffRow {
  label: string;
  old: string;
  new: string;
  changed: boolean;
  box_old: number[] | null;
  box_new: number[] | null;
}

export interface StatDiff {
  match_id: string;
  old_image_id: string;
  new_image_id: string;
  changed: number;
  rows: StatDiffRow[];
}

export const REGEN_LABELS: Record<RegenStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  regenerated: "Regenerated",
  verified: "Verified",
  published: "Published",
};

export const STALE_LABELS: Record<string, string> = {
  below_70: "Below / unverified LV70",
  needs_link: "Needs website link",
};

export interface LinkResult {
  linked: number;
  site_item: SiteItem;
}

export const FLAG_LABELS: Record<string, string> = {
  ocr_name_conflict: "OCR name differs",
  filename_name_mismatch: "Filename name differs",
  level_unreadable: "Level unreadable",
};

export const LEVEL_LABELS: Record<LevelStatus, string> = {
  pending: "OCR pending",
  confirmed_70: "Confirmed level 70",
  outdated: "Likely outdated card",
  possible_misread: "Possible OCR misread",
  unreadable: "Level unreadable",
};

export const LEVEL_DECISION_LABELS: Record<LevelDecision, string> = {
  approve_70: "Approved as level 70",
  ocr_misread: "Marked OCR misread",
  require_regeneration: "Requires level-70 regeneration",
};

export const REASON_LABELS: Record<string, string> = {
  serial_missing: "No serial in manifest",
  serial_not_in_catalog: "Serial not in catalog",
  duplicate_serial: "Duplicate serial",
  file_missing: "Card file missing",
  invalid_image: "Not a WebP image",
  level_mismatch: "Level is not 70",
  source_mismatch: "Source is not NCS Lookup",
  name_mismatch: "Name differs from catalog",
  checksum_mismatch: "Checksum mismatch",
  duplicate_image: "Duplicate image file",
  item_key_mismatch: "itemKey differs",
  item_key_only: "itemKey matches, serial differs",
  filename_key_mismatch: "Filename code ≠ itemKey",
  level_conflict: "Level conflict (OCR)",
};

// Exceptions with these reasons have no catalog item or image, so they can only be rejected.
export const BLOCKING_REASONS = ["serial_missing", "serial_not_in_catalog", "file_missing", "invalid_image", "checksum_mismatch", "duplicate_image", "level_conflict"];

export const CONFIRM_PHRASE = "INJECT-CONFIRM";
