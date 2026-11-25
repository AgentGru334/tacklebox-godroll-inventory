import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Send, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, PageHeader, PendingCard, SerialPill, Stat } from "@/components/injector/ui";
import { QuarantineButton, StaleBadges } from "@/components/injector/flags";
import { BATCH_KEYS, qk, useMe } from "@/hooks/useInjector";
import { apiGet, apiPatch, apiPost, errorMessage } from "@/lib/api";
import type { CatalogEditIn, CatalogItem, QueuePublishResult } from "@/lib/types";

export default function AdminQueue() {
  const qc = useQueryClient();
  const { data: me, isLoading: meLoading } = useMe();
  const isAdmin = me?.role === "admin";
  const { data: items = [], isLoading, isError } = useQuery({
    queryKey: qk.queue,
    queryFn: () => apiGet<CatalogItem[]>("/admin/queue"),
    enabled: isAdmin,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [form, setForm] = useState<Required<CatalogEditIn>>({ name: "", item_type: "", manufacturer: "", rarity: "" });
  const edit = useMutation({
    mutationFn: ({ id, body }: { id: string; body: CatalogEditIn }) => apiPatch<CatalogItem>(`/catalog/${id}`, body),
    onSuccess: (i) => { BATCH_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k })); setEditing(null); toast.success(`Saved ${i.name}. Serial and itemKey are unchanged.`); },
    onError: (e) => toast.error(errorMessage(e, "Could not save")),
  });
  const openEdit = (i: CatalogItem) => { setForm({ name: i.name, item_type: i.item_type, manufacturer: i.manufacturer, rarity: i.rarity }); setEditing(i); };
  const missing = items.filter((i) => i.card_state === "missing");
  const live = items.filter((i) => i.card_state === "pending_placeholder");

  const publish = useMutation({
    mutationFn: (ids: string[]) => apiPost<QueuePublishResult>("/admin/queue/publish", { item_ids: ids }),
    onSuccess: (r) => {
      BATCH_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      setSelected(new Set());
      toast.success(`Published ${r.published} “Card pending” placeholder(s).`);
    },
    onError: (e) => toast.error(errorMessage(e, "Publish failed")),
  });

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  if (!meLoading && !isAdmin)
    return (
      <div>
        <PageHeader kicker="Restricted" title="Admin queue" />
        <EmptyState testId="admin-queue-forbidden" title="Admins only" body="Ask an admin to publish Card pending placeholders or to change your role." />
      </div>
    );

  return (
    <div>
      <PageHeader kicker="Restricted · Admin" title="Admin queue">
        <Button variant="outline" disabled={selected.size === 0 || publish.isPending} data-testid="publish-selected-button" onClick={() => publish.mutate([...selected])}>
          Publish selected ({selected.size})
        </Button>
        <Button disabled={missing.length === 0 || publish.isPending} data-testid="publish-all-button" className="font-bold uppercase" onClick={() => publish.mutate(missing.map((i) => i.id))}>
          {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Publish all ({missing.length})
        </Button>
      </PageHeader>

      <p className="-mt-3 mb-5 max-w-2xl text-sm text-zinc-400">
        Validated God Roll items with no card image. Publishing gives each one a <span className="text-gold">Card pending</span> placeholder in the library until a level 70 NCS Lookup card is matched to its serial.
      </p>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="In queue" value={items.length} testId="queue-total" />
        <Stat label="Awaiting publish" value={missing.length} tone="red" testId="queue-missing" />
        <Stat label="Placeholder live" value={live.length} tone="gold" testId="queue-live" />
      </div>

      {isError && <p className="mt-4 text-sm text-red-300" data-testid="queue-load-error">Could not load the queue.</p>}
      {isLoading && <p className="mt-4 font-mono text-xs text-zinc-400">Loading queue…</p>}
      {!isLoading && !isError && items.length === 0 && (
        <div className="mt-6">
          <EmptyState testId="queue-empty" title="Queue is clear" body="Every catalog item has a card." />
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="queue-grid">
        {items.map((item) => {
          const isLive = item.card_state === "pending_placeholder";
          return (
            <div key={item.id} data-testid={`queue-item-${item.serial}`}
              className={`group rounded-sm border bg-panel p-2 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 ${selected.has(item.id) ? "border-teal" : "border-steel"}`}>
              <PendingCard name={item.name} serial={item.serial} rarity={item.rarity} kind={item.item_type} published={isLive} />
              <div className="mt-2 flex items-center justify-between gap-2">
                {isLive ? (
                  <span className="font-mono text-[10px] font-bold uppercase text-gold" data-testid="queue-item-live">Live</span>
                ) : (
                  <label className="flex items-center gap-2 text-xs text-zinc-300">
                    <Checkbox checked={selected.has(item.id)} onCheckedChange={() => toggle(item.id)} data-testid={`queue-select-${item.id}`} />
                    Select
                  </label>
                )}
                <span className="truncate font-mono text-[10px] text-zinc-500">{item.manufacturer}</span>
              </div>
              <SerialPill serial={item.serial} className="mt-1.5 w-full" />
              <div className="mt-1 flex flex-wrap gap-1" data-testid={`queue-flags-${item.id}`}><StaleBadges item={item} /></div>
              <Button size="xs" variant="ghost" className="mt-1 w-full" data-testid={`queue-edit-${item.id}`} onClick={() => openEdit(item)}>
                <Pencil className="h-3 w-3" /> Name &amp; category
              </Button>
              <QuarantineButton item={item} />
            </div>
          );
        })}
      </div>
      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent data-testid="edit-record-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading uppercase">Name this record</DialogTitle>
            <DialogDescription>Serial and itemKey stay authoritative and can't be edited. Every change goes in the audit log.</DialogDescription>
          </DialogHeader>
          {editing && <SerialPill serial={editing.serial} />}
          <div className="grid gap-3 sm:grid-cols-2">
            {(["name", "item_type", "manufacturer", "rarity"] as const).map((k) => (
              <div key={k} className="space-y-1.5">
                <Label htmlFor={`edit-${k}`}>{k === "item_type" ? "Category / type" : k[0].toUpperCase() + k.slice(1)}</Label>
                <Input id={`edit-${k}`} data-testid={`edit-${k}-input`} value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} data-testid="edit-cancel">Cancel</Button>
            <Button disabled={!form.name.trim() || edit.isPending} data-testid="edit-save" onClick={() => editing && edit.mutate({ id: editing.id, body: form })}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
