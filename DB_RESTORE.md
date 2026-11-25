# MongoDB restore and card-image verification

> **The mongodump is not in this GitHub repository.** The gzip dump (~152 MiB, including split `card_images` parts) is kept on the owner's side in the original Emergent export zip. Place that dump on a machine that can reach the Railway MongoDB instance, then follow the steps below. Do not commit `*.bson`, `*.gz`, or a `dump/` folder to this repo.

The export is a `mongodump --gzip` of database **`app`**, produced with MongoDB **7.0.45** / database-tools **100.20.1**. After you unpack the Emergent zip, the dump directory is `migration/data/dump/` (or `godroll-migration/original/migration/data/dump/` if you are working from the local prep tree).

Card images are **not** loose files and are **not** in GridFS. They are WebP binaries in the `card_images` collection (`data` BinData, plus `id`, `batch_id`, `size` on card docs, `kind: "level_crop"` on crops). The app serves them at `GET /api/cards/{id}`.

`card_images.bson.gz` was split into 90 MiB parts for GitHub’s file limit. **Concatenate the parts first**, then restore. Do not gunzip the parts individually — they are one gzip stream split in half.

## 1. Join the split collection

```bash
cd /path/to/emergent-export/migration/data/dump/app
# Only create the joined file if it is not already present
if [ ! -f card_images.bson.gz ]; then
  cat card_images.bson.gz.part00 card_images.bson.gz.part01 > card_images.bson.gz
fi
ls -l card_images.bson.gz   # expect 157,848,549 bytes
```

Keep the `.part00`/`.part01` files as backups until restore is verified.

## 2. Restore

Target a MongoDB 6+ (7.x preferred) instance. Set `MONGO_URL` and `DB_NAME` (example: `tacklebox_card_injector`).

```bash
# From migration/data/ (the parent of dump/)
cd /path/to/emergent-export/migration/data
mongorestore --uri="$MONGO_URL" --nsFrom="app.*" --nsTo="${DB_NAME}.*" --gzip --dir=dump/
```

Notes:

- `--nsFrom/--nsTo` remaps the export database name `app` to `$DB_NAME`.
- Do not pass `--drop` on a first restore unless you intend to wipe that database.
- Railway: run this from a machine that can reach the plugin (public URL + allowlist, or `railway connect` / a one-off shell). This phase did not run it.
- Startup will also call `ensure_indexes()` in `backend/lib/db.py`. The dump already includes collection indexes.

Temporary collections were **not** exported and are recreated at runtime: `upload_sessions`, `upload_chunks`, `stat_diffs`, `status_checks`.

## 3. Verification counts

Measured from this zip (2026-11-25). Use these, not the slightly different totals in the export README.

```javascript
// mongosh "$MONGO_URL/$DB_NAME"
const expected = {
  catalog_items: 1216,
  card_images: 2398,
  matches: 1199,
  site_codes: 1669,
  audit: 101,
  batches: 1,
  settings: 1,
  users: 1,
  catalog_archive: 0,
  site_itemkey_map: 0,
};
for (const [name, n] of Object.entries(expected)) {
  const got = db.getCollection(name).countDocuments();
  print(`${name}: ${got} (expected ${n}) ${got === n ? "OK" : "MISMATCH"}`);
}

print("catalog card_state", db.catalog_items.aggregate([
  { $group: { _id: "$card_state", n: { $sum: 1 } } }
]).toArray());
// expect: card 1199, pending_placeholder 17

print("card_images kinds", db.card_images.aggregate([
  { $group: { _id: { $ifNull: ["$kind", "<card/no kind>"] }, n: { $sum: 1 } } }
]).toArray());
// expect: <card/no kind> 1199, level_crop 1199

print("card binary bytes", db.card_images.aggregate([
  { $group: { _id: null, bytes: { $sum: { $binarySize: "$data" } } } }
]).toArray());
// expect about 159,465,456 bytes (~152.1 MiB)

// Every catalog row with a card should resolve to an image
print("catalog cards missing image doc", db.catalog_items.aggregate([
  { $match: { card_state: "card", card_image_id: { $exists: true, $ne: null } } },
  { $lookup: { from: "card_images", localField: "card_image_id", foreignField: "id", as: "img" } },
  { $match: { img: { $size: 0 } } },
  { $count: "missing" }
]).toArray());
// expect []
```

Integrity extras after the API is up:

- `GET /api/cards/{id}` for a known `card_image_id` returns `image/webp` (this route is public).
- Catalog count via signed-in `GET /api/catalog` / `GET /api/stats` matches 1,216 / 1,199 cards.

## 4. Known discrepancies and caveats

- Export docs said **2,373** images “1,199 cards + 1,199 level crops; 25 cards are shared.” The dump actually contains **2,398 documents** (1,199 + 1,199). Trust the measured count.
- `settings.worklist_share`: the export README says the share-link token was removed and the link disabled. Recreate the token in the admin UI after go-live; do not copy an old URL.
- `users` (1 document, includes an email field): Clerk user ids from the Emergent-managed instance **will not match** a new Clerk app. Treat this row as informational. Users are re-created on first sign-in; `ADMIN_EMAIL` promotes the owner.
- `site_codes.image_url`: 1,493 of 1,669 rows point at host `tacklebox-god-roll-inventory.eric-monceaux.chatgpt.site`. Those are website-item images, not the Mongo card library. If that host is retired, site-link thumbnails may break; card images in `card_images` are independent.
- Excluded from the dump (per `migration/data/README.md`): test login accounts, temporary uploads and caches.
