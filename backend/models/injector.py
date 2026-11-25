"""Pydantic models — mirrored by hand in frontend/src/lib/types.ts."""

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

CardState = Literal["card", "missing", "pending_placeholder"]
MatchStatus = Literal["clean", "exception"]
Decision = Literal["auto_approved", "approved", "rejected", "pending"]
BatchStatus = Literal["review", "ready", "package_generated", "published"]
LevelStatus = Literal["pending", "confirmed_70", "outdated", "possible_misread", "unreadable"]
LevelDecision = Literal["approve_70", "ocr_misread", "require_regeneration"]
Change = Literal["new", "replacement", "fill", "unmatched"]
RegenStatus = Literal["pending", "in_progress", "regenerated", "verified", "published"]


class Me(BaseModel):
    user_id: str
    role: str
    email: str = ""
    name: str = ""


class UserRow(BaseModel):
    user_id: str
    email: str = ""
    name: str = ""
    role: str


class UserList(BaseModel):
    roles: list[str]
    users: list[UserRow]


class RoleIn(BaseModel):
    role: str


class CatalogItemIn(BaseModel):
    serial: str = Field(min_length=1)
    name: str = Field(min_length=1)
    rarity: str = ""
    manufacturer: str = ""
    item_type: str = ""
    level: int = 70
    item_key: str = ""
    has_image: Optional[bool] = None
    image_url: Optional[str] = None


class CatalogItem(BaseModel):
    id: str
    serial: str
    name: str
    rarity: str = ""
    manufacturer: str = ""
    item_type: str = ""
    level: int = 70
    item_key: str = ""
    card_state: CardState
    card_image_id: Optional[str] = None
    card_updated_at: Optional[datetime] = None
    placeholder_published_at: Optional[datetime] = None
    level_status: Optional[LevelStatus] = None
    needs_level70_refresh: bool = False
    site_item_id: Optional[str] = None
    site_item_name: str = ""
    site_link_method: Optional[str] = None
    regen_status: Optional[RegenStatus] = None
    regen_status_by: Optional[str] = None
    regen_status_at: Optional[datetime] = None
    quarantined: bool = False
    quarantine_reason: str = ""
    stale_reasons: list[str] = []  # computed: "below_70", "needs_link"


class WorklistStatusIn(BaseModel):
    status: Literal["pending", "in_progress", "regenerated"]  # verified/published are set by imports


class QuarantineIn(BaseModel):
    quarantined: bool
    reason: str = Field(default="", max_length=280)


class CatalogEditIn(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1)
    item_type: Optional[str] = None
    manufacturer: Optional[str] = None
    rarity: Optional[str] = None


class CatalogImportResult(BaseModel):
    imported: int
    with_card: int
    image_missing: int


class Batch(BaseModel):
    id: str
    filename: str
    created_at: datetime
    created_by: str
    status: BatchStatus
    total: int
    clean: int
    exceptions: int
    pending: int
    approved: int
    rejected: int
    zip_files: int
    add_to_catalog: bool = False
    analysis_status: Literal["pending", "running", "done"] = "done"
    analysis_total: int = 0
    analysis_done: int = 0
    new_records: int = 0
    replacements: int = 0
    fills: int = 0
    unmatched: int = 0
    duplicate_files: int = 0
    ocr_conflicts: int = 0
    level_held: int = 0
    missing_records: int = 0
    package_generated_at: Optional[datetime] = None
    published_at: Optional[datetime] = None
    published_by: Optional[str] = None
    rolled_back_at: Optional[datetime] = None
    rolled_back_by: Optional[str] = None
    note: str = ""


class BatchNoteIn(BaseModel):
    note: str = Field(default="", max_length=280)


class ValidationRow(BaseModel):
    match_id: str
    serial: str
    item_key: str = ""
    name: str = ""
    change: str = ""
    blockers: list[str] = []
    warnings: list[str] = []


class ValidationReport(BaseModel):
    batch_id: str
    would_publish: int
    publishable: int
    blocked: int
    warnings: int
    rows: list[ValidationRow] = []


class RollbackIn(BaseModel):
    confirmation: str = ""
    dry_run: bool = True


class RollbackResult(BaseModel):
    batch_id: str
    dry_run: bool
    cards_reverted: int = 0
    records_archived: int = 0
    placeholders_reverted: int = 0
    regen_flags_cleared: int = 0
    links_removed: int = 0
    conflicts: list[str] = []
    reversible_changes: int = 0


class Match(BaseModel):
    id: str
    batch_id: str
    index: int
    serial: str
    file: str
    file_prefix: str = ""
    file_item_name: str = ""
    file_ext: str = ""
    file_slug: str = ""
    image_code: str = ""
    item_key: str = ""
    sha256: str = ""
    manifest_name: str = ""
    level: Optional[int] = None
    source: str = ""
    catalog_item_id: Optional[str] = None
    catalog_name: str = ""
    rarity: str = ""
    manufacturer: str = ""
    item_type: str = ""
    image_id: Optional[str] = None
    previous_card_state: Optional[CardState] = None
    change: Change = "fill"
    status: MatchStatus
    reasons: list[str]
    flags: list[str] = []
    decision: Decision
    note: str = ""
    decided_by: Optional[str] = None
    decided_at: Optional[datetime] = None
    ocr_status: Literal["pending", "done", "error"] = "pending"
    ocr_level: Optional[int] = None
    ocr_level_text: str = ""
    ocr_level_conf: Optional[float] = None
    ocr_name_text: str = ""
    ocr_name_score: Optional[float] = None
    level_status: LevelStatus = "pending"
    level_crop_id: Optional[str] = None
    level_decision: Optional[LevelDecision] = None
    level_decided_by: Optional[str] = None
    level_decided_at: Optional[datetime] = None
    # card the library shows today (before apply) or showed before this import replaced it (after apply)
    compare_image_id: Optional[str] = None


class DecisionIn(BaseModel):
    decision: Literal["approved", "rejected", "pending"]
    note: str = ""


class LevelDecisionIn(BaseModel):
    decision: LevelDecision
    note: str = ""


class DirectUploadIn(BaseModel):
    confirmation: str
    acknowledged: bool


class DirectUploadResult(BaseModel):
    batch_id: str
    replaced: int
    added: int = 0
    created: int = 0
    placeholders: int = 0
    held_for_regeneration: int = 0
    blocked: int = 0
    simulated: bool = True


class QueuePublishIn(BaseModel):
    item_ids: list[str] = Field(min_length=1)


class QueuePublishResult(BaseModel):
    published: int


class Stats(BaseModel):
    catalog_total: int
    catalog_with_card: int
    catalog_missing: int
    catalog_pending_placeholder: int
    needs_refresh: int = 0
    unlinked: int = 0
    latest_batch: Optional[Batch] = None


class UploadInit(BaseModel):
    filename: str = Field(min_length=1)
    size: int = Field(gt=0)
    chunk_size: int = Field(gt=0, le=16 * 1024 * 1024)
    add_to_catalog: bool = True
    note: str = Field(default="", max_length=280)


class UploadSession(BaseModel):
    id: str
    filename: str
    size: int
    chunk_size: int
    total_chunks: int
    received: list[int]
    status: Literal["uploading", "complete"]
    batch_id: Optional[str] = None


class AuditEntry(BaseModel):
    id: str
    at: datetime
    actor: str
    action: str
    batch_id: Optional[str] = None
    catalog_item_id: Optional[str] = None
    serial: str = ""
    item_key: str = ""
    item_name: str = ""
    site_item_id: Optional[str] = None
    previous_image_id: Optional[str] = None
    new_image_id: Optional[str] = None
    details: dict = {}
    restored_at: Optional[datetime] = None


class ImportHistoryEntry(BaseModel):
    batch: Batch
    changes: dict[str, int] = {}
    events: list[AuditEntry] = []
    can_download: bool = False


class SiteItem(BaseModel):
    item_id: str
    item_name: str
    manufacturer: str = ""
    category: str = ""
    code_count: int = 0


class SiteImportResult(BaseModel):
    codes: int
    items: int
    auto_linked: int
    with_item_key: int = 0


class ItemKeyMapRow(BaseModel):
    item_key: str
    site_item: str  # website item ID or URL


class ItemKeyMapIn(BaseModel):
    rows: list[ItemKeyMapRow] = Field(min_length=1)


class ItemKeyMapResult(BaseModel):
    saved: int
    invalid: int
    unknown_site_items: int
    high_confidence_now: int


class PublicStatusIn(BaseModel):
    serial: str = Field(min_length=1)
    status: Literal["in_progress"]
    name: str = Field(min_length=2, max_length=60)


class UnlinkedItem(BaseModel):
    item: CatalogItem
    suggestion: Optional[SiteItem] = None
    suggestion_reason: str = ""
    suggestion_basis: Literal["item_key", "image_code", "name", "none"] = "none"
    confidence: Optional[Literal["high", "medium", "low"]] = None
    conflicts: list[str] = []


class BulkAcceptIn(BaseModel):
    mode: Literal["selected", "all_high"] = "selected"
    catalog_item_ids: list[str] = []


class BulkAcceptResult(BaseModel):
    linked: int
    skipped: int
    skipped_reasons: list[str] = []


class ShareStatus(BaseModel):
    enabled: bool
    token: Optional[str] = None
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None


class ShareIn(BaseModel):
    enabled: bool
    regenerate: bool = False


class PublicWorklistRow(BaseModel):
    name: str
    serial: str
    item_key: str = ""
    item_type: str = ""
    status: RegenStatus
    by: Optional[str] = None


class PublicWorklist(BaseModel):
    generated_at: datetime
    rows: list[PublicWorklistRow]


class StatDiffRow(BaseModel):
    label: str
    old: str
    new: str
    changed: bool
    box_old: Optional[list[float]] = None
    box_new: Optional[list[float]] = None


class StatDiff(BaseModel):
    match_id: str
    old_image_id: str
    new_image_id: str
    changed: int
    rows: list[StatDiffRow]


class LinkIn(BaseModel):
    catalog_item_ids: list[str] = Field(min_length=1)
    site_item: str = Field(min_length=1)


class LinkResult(BaseModel):
    linked: int
    site_item: SiteItem
