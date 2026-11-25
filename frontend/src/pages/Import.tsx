import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileJson, FileArchive, Loader2, CheckCircle2, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PageHeader, Panel } from "@/components/injector/ui";
import { AnalysisProgress, ProgressBar } from "@/components/injector/progress";
import { apiPost, authHeaders, errorMessage } from "@/lib/api";
import { resumableUpload } from "@/lib/upload";
import type { UploadProgress } from "@/lib/upload";
import { BATCH_KEYS, useLatestBatch, useMe, useStats } from "@/hooks/useInjector";
import type { CatalogImportResult, CatalogItemIn, ItemKeyMapResult, ItemKeyMapRow, SiteImportResult } from "@/lib/types";

function Dropzone({ accept, label, hint, icon: Icon, file, onFile, testId }: {
  accept: string; label: string; hint: string; icon: typeof FileJson; file: File | null; onFile: (f: File) => void; testId: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`${testId}-dropzone`}
      onClick={() => ref.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      className={`hud-grid flex cursor-pointer flex-col items-center justify-center gap-2 rounded-sm border-2 border-dashed px-4 py-7 text-center transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal ${over ? "border-teal bg-teal/5" : "border-steel hover:border-teal/50"}`}
    >
      <Icon className="h-8 w-8 text-teal" />
      <div className="max-w-full truncate font-heading font-black uppercase text-white">{file ? file.name : label}</div>
      <div className="text-xs text-zinc-400">{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB · click to change` : hint}</div>
      <input ref={ref} type="file" accept={accept} className="hidden" data-testid={`${testId}-input`}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </div>
  );
}

async function readJson(file: File): Promise<unknown> {
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new Error("This file is not valid JSON.");
  }
}

/** CSV with an itemKey column and a website item column (ID or URL); header names are flexible. */
function parseItemKeyMap(text: string): ItemKeyMapRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const split = (l: string) => l.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ""));
  const head = split(lines[0] ?? "").map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const ki = head.findIndex((h) => h === "itemkey");
  const si = head.findIndex((h) => ["siteitemid", "websiteitemid", "itemid", "siteitem", "url", "websiteurl", "websiteitem"].includes(h));
  if (ki < 0 || si < 0) throw new Error("The CSV needs an itemKey column and a website item ID (or URL) column.");
  const rows = lines.slice(1).map(split).map((c) => ({ item_key: c[ki] ?? "", site_item: c[si] ?? "" })).filter((r) => r.item_key && r.site_item);
  if (!rows.length) throw new Error("No rows with both an itemKey and a website item.");
  return rows;
}

const msg = (e: unknown, fallback: string) => (e instanceof Error && !("status" in e) ? e.message : errorMessage(e, fallback));

export default function ImportPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: stats } = useStats();
  const { data: me } = useMe();
  const { batch } = useLatestBatch();
  const isAdmin = me?.role === "admin";
  const [catalogFile, setCatalogFile] = useState<File | null>(null);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [siteFile, setSiteFile] = useState<File | null>(null);
  const [mapFile, setMapFile] = useState<File | null>(null);
  const [catalogResult, setCatalogResult] = useState<CatalogImportResult | null>(null);
  const [replaceCatalog, setReplaceCatalog] = useState(false);
  const [addToCatalog, setAddToCatalog] = useState(true);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [note, setNote] = useState("");

  const invalidate = () => BATCH_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k }));

  const catalogMut = useMutation({
    mutationFn: async (file: File) => {
      const parsed = await readJson(file);
      const items = Array.isArray(parsed) ? parsed : (parsed as { items?: unknown }).items;
      if (!Array.isArray(items)) throw new Error("Expected a JSON array of catalog items.");
      return apiPost<CatalogImportResult>(`/catalog/import?mode=${replaceCatalog ? "replace" : "merge"}`, items as CatalogItemIn[]);
    },
    onSuccess: (r) => { setCatalogResult(r); invalidate(); toast.success(`Catalog updated: ${r.imported} records (${r.image_missing} image-missing).`); },
    onError: (e) => toast.error(msg(e, "Catalog import failed")),
  });

  const zipMut = useMutation({
    mutationFn: (file: File) => resumableUpload(file, addToCatalog, note, authHeaders, setProgress),
    onSuccess: (b) => {
      setProgress(null);
      setNote("");
      invalidate();
      toast.success(`Dry run ready: ${b.total} cards parsed. Nothing in the library has changed yet; OCR verification is running.`);
      navigate("/review");
    },
    onError: (e) => toast.error(`${msg(e, "Upload failed")} — pick the same file again to resume.`),
  });

  const siteMut = useMutation({
    mutationFn: async (file: File) => apiPost<SiteImportResult>("/site/import", await readJson(file)),
    onSuccess: (r) => { invalidate(); toast.success(`${r.codes} website codes (${r.items} items) loaded · ${r.auto_linked} linked by exact serial · ${r.with_item_key} carry an itemKey.`); },
    onError: (e) => toast.error(msg(e, "Website code import failed")),
  });

  const mapMut = useMutation({
    mutationFn: async (file: File) => apiPost<ItemKeyMapResult>("/site/itemkey-map", { rows: parseItemKeyMap(await file.text()) }),
    onSuccess: (r) => {
      invalidate();
      toast.success(`itemKey map saved: ${r.saved} rows (${r.invalid} unreadable, ${r.unknown_site_items} website items not in the codes list). ${r.high_confidence_now} high-confidence links ready to bulk-accept.`);
    },
    onError: (e) => toast.error(msg(e, "itemKey map upload failed")),
  });

  const hasCatalog = (stats?.catalog_total ?? 0) > 0 || Boolean(catalogResult);

  return (
    <div>
      <PageHeader kicker="Step 01" title="Import" />
      {batch && <div className="mb-5"><AnalysisProgress batch={batch} /></div>}

      <Panel className="p-5" data-testid="zip-import-panel">
        <h2 className="font-heading text-lg font-black uppercase text-white">A · Card export ZIP <span className="ml-1 font-mono text-[10px] text-teal">dry run first</span></h2>
        <p className="mt-1 text-sm text-zinc-400">
          A validated export with <code className="font-mono text-teal">manifest.json</code> (<code className="font-mono">present</code> / <code className="font-mono">missing</code>) and WebP cards. Identity comes only from the manifest serial and itemKey. Checksums are verified, filenames are split, and OCR checks each card's level. Nothing changes in the library until an admin applies the import.
        </p>
        <label className="mt-3 flex items-start gap-2 text-sm text-zinc-300">
          <Checkbox checked={addToCatalog} onCheckedChange={(c) => setAddToCatalog(Boolean(c))} data-testid="zip-add-to-catalog-toggle" />
          <span>Treat manifest serials that aren't in the catalog as new records, keyed by serial. Same-name items stay separate.</span>
        </label>
        <div className="mt-3">
          <Input value={note} maxLength={280} onChange={(e) => setNote(e.target.value)} data-testid="zip-note-input"
            placeholder="Import note (optional), e.g. why you're running it: “Level-70 regen pass for Jakobs shotguns”" />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_280px] lg:items-end">
          <Dropzone accept=".zip,application/zip" label="Drop card ZIP" hint="or click to choose a .zip file (max 1.5 GB) · uploads resume after a disconnect" icon={FileArchive} file={zipFile} onFile={setZipFile} testId="zip" />
          <Button className="w-full font-bold uppercase" data-testid="zip-import-button" disabled={!zipFile || (!hasCatalog && !addToCatalog) || zipMut.isPending} onClick={() => zipFile && zipMut.mutate(zipFile)}>
            {zipMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Upload &amp; preview
          </Button>
        </div>
        {progress && (
          <div className="mt-4 space-y-1" data-testid="upload-progress">
            <ProgressBar value={progress.sentBytes} max={progress.totalBytes}
              label={progress.stage === "assembling" ? "Parsing manifest, verifying checksums, matching serials…" : `Uploading ${(progress.sentBytes / 1048576).toFixed(1)} / ${(progress.totalBytes / 1048576).toFixed(1)} MB`}
              testId="upload-progress-bar" tone={progress.stage === "assembling" ? "gold" : "teal"} />
            {progress.resumed && <div className="font-mono text-[11px] text-gold" data-testid="upload-resumed">Resumed: picking up from the last chunk that arrived</div>}
          </div>
        )}
      </Panel>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel className="p-5" data-testid="catalog-import-panel">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-lg font-black uppercase text-white">B · Catalog records</h2>
            {hasCatalog && <CheckCircle2 className="h-5 w-5 text-emerald-400" data-testid="catalog-ready-icon" />}
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            JSON array: <code className="font-mono text-teal">serial</code>, <code className="font-mono text-teal">name</code>, item_key, rarity, manufacturer, item_type, <code className="font-mono text-teal">has_image</code>. Records are added or updated by exact serial.
          </p>
          <label className="mt-3 flex items-center gap-2 text-sm text-zinc-300">
            <Checkbox checked={replaceCatalog} onCheckedChange={(c) => setReplaceCatalog(Boolean(c))} data-testid="catalog-replace-toggle" />
            Replace the whole catalog (removes records not in this file)
          </label>
          <div className="mt-4"><Dropzone accept=".json,application/json" label="Drop catalog JSON" hint="or click to choose a .json file" icon={FileJson} file={catalogFile} onFile={setCatalogFile} testId="catalog" /></div>
          <Button className="mt-4 w-full font-bold uppercase" variant="outline" data-testid="catalog-import-button" disabled={!catalogFile || catalogMut.isPending} onClick={() => catalogFile && catalogMut.mutate(catalogFile)}>
            {catalogMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Import catalog
          </Button>
          <div className="mt-3 font-mono text-xs text-zinc-400" data-testid="catalog-summary">
            {catalogResult ? `${catalogResult.imported} records · ${catalogResult.with_card} with card · ${catalogResult.image_missing} image-missing` : stats ? `Current catalog: ${stats.catalog_total} records` : ""}
          </div>
        </Panel>

        <Panel className="p-5" data-testid="site-import-panel">
          <h2 className="font-heading text-lg font-black uppercase text-white">C · Website codes</h2>
          <p className="mt-1 text-sm text-zinc-400">
            The God Roll website export (<code className="font-mono text-teal">TB_All_Codes_*.json</code>). Records whose serial exactly equals a website code are linked automatically. Everything else goes to the Unlinked queue with suggestions only. Admins only.
          </p>
          <div className="mt-4"><Dropzone accept=".json,application/json" label="Drop website codes JSON" hint="or click to choose a .json file" icon={Globe} file={siteFile} onFile={setSiteFile} testId="site" /></div>
          <Button className="mt-4 w-full font-bold uppercase" variant="outline" data-testid="site-import-button" disabled={!isAdmin || !siteFile || siteMut.isPending} onClick={() => siteFile && siteMut.mutate(siteFile)}>
            {siteMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Load website codes
          </Button>
          {stats && <div className="mt-3 font-mono text-xs text-zinc-400" data-testid="site-unlinked-count">{stats.unlinked} records not linked to a website item</div>}
          <div className="mt-5 border-t border-steel pt-4" data-testid="itemkey-map-panel">
            <h3 className="font-heading text-sm font-black uppercase text-white">itemKey map <span className="font-mono text-[10px] text-teal">optional</span></h3>
            <p className="mt-1 text-xs text-zinc-400">
              A CSV with <code className="font-mono text-teal">itemKey</code> and <code className="font-mono text-teal">site_item_id</code> (or a website URL) columns. An <code className="font-mono">itemKey</code> column in the codes file works too. Exact itemKey matches become high-confidence suggestions in the Unlinked queue. Nothing is linked until you accept them. A new upload replaces the previous map.
            </p>
            <div className="mt-3"><Dropzone accept=".csv,text/csv" label="Drop itemKey map CSV" hint="itemKey, site_item_id" icon={FileJson} file={mapFile} onFile={setMapFile} testId="itemkey-map" /></div>
            <Button className="mt-3 w-full font-bold uppercase" variant="outline" data-testid="itemkey-map-button" disabled={!isAdmin || !mapFile || mapMut.isPending} onClick={() => mapFile && mapMut.mutate(mapFile)}>
              {mapMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Upload itemKey map
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
