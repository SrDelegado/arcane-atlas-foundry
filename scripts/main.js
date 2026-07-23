/**
 * Arcane Atlas Sync — Lore Vault
 * -------------------------------
 * Syncs the DM's Arcane Atlas Document Vault (letters, scrolls, books) into
 * Foundry VTT Journal Entries under a folder called "Arcane Atlas - Biblioteca".
 *
 * Maps live in a separate Arcane Atlas module — this one does NOT handle maps.
 *
 * Requires an Arcane Atlas API key (Patreon premium). Grab it at
 * https://arcaneatlas.org/profile → Foundry.
 */

const MOD_ID = "arcane-atlas-sync";
const API_BASE = "https://arcaneatlas.org";
const FOLDER_NAME = "Arcane Atlas - Biblioteca";

Hooks.once("init", () => {
  console.log("Arcane Atlas Sync | init");

  game.settings.register(MOD_ID, "apiKey", {
    name: "Arcane Atlas API key",
    hint: "Paste the key from arcaneatlas.org → Profile → Foundry. Required to sync your Document Vault (premium / Patreon).",
    scope: "world",
    config: true,
    type: String,
    default: "",
  });
});

Hooks.once("ready", () => {
  console.log("Arcane Atlas Sync | ready");
  game.arcaneAtlas = { syncDocuments };
  if (game.user?.isGM) {
    ui.notifications?.info(
      'Arcane Atlas Sync ready. Use the "Sync Library" button in the Journal controls, or run game.arcaneAtlas.syncDocuments().',
    );
  }
});

/**
 * Injects a "Sync Arcane Atlas Library" button into the scene-controls sidebar.
 * Compatible with Foundry v11/v12 (array shape) and v13 (record shape).
 */
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user?.isGM) return;
  const tool = {
    name: "arcane-atlas-sync-library",
    title: "Sync Arcane Atlas Library",
    icon: "fas fa-book-sparkles",
    button: true,
    visible: true,
    onClick: () => syncDocuments(),
    onChange: () => syncDocuments(),
  };

  // v13: controls is a record keyed by control name.
  if (controls && typeof controls === "object" && !Array.isArray(controls)) {
    const notes = controls.notes ?? controls.journal;
    if (notes) {
      if (Array.isArray(notes.tools)) notes.tools.push(tool);
      else if (notes.tools && typeof notes.tools === "object") notes.tools[tool.name] = tool;
    }
    return;
  }

  // v11/v12: controls is an array.
  if (Array.isArray(controls)) {
    const notes = controls.find((c) => c.name === "notes" || c.name === "journal");
    if (notes && Array.isArray(notes.tools)) notes.tools.push(tool);
  }
});

/**
 * Pulls synced documents from Arcane Atlas and materializes them as
 * JournalEntries inside the "Arcane Atlas - Biblioteca" folder.
 */
async function syncDocuments() {
  if (!game.user?.isGM) {
    ui.notifications?.warn("Only the GM can sync the Arcane Atlas Library.");
    return;
  }
  const key = String(game.settings.get(MOD_ID, "apiKey") || "").trim();
  if (!key) {
    ui.notifications?.warn(
      "Arcane Atlas: no API key configured. Add it in Module Settings (arcaneatlas.org → Profile → Foundry).",
    );
    return;
  }

  ui.notifications?.info("Arcane Atlas: syncing your Library…");

  let payload;
  try {
    const res = await fetch(`${API_BASE}/api/public/foundry/documents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: key }),
    });
    if (res.status === 401) {
      ui.notifications?.error("Arcane Atlas: invalid or revoked API key. Regenerate it in your profile.");
      return;
    }
    if (res.status === 402) {
      ui.notifications?.error(
        "Arcane Atlas: this feature requires a Patreon premium subscription.",
      );
      return;
    }
    if (!res.ok) {
      const txt = await res.text();
      ui.notifications?.error(`Arcane Atlas: ${res.status} ${txt.slice(0, 120)}`);
      return;
    }
    payload = await res.json();
  } catch (err) {
    console.error("Arcane Atlas Sync", err);
    ui.notifications?.error("Arcane Atlas: network error during sync.");
    return;
  }

  const docs = Array.isArray(payload?.documents) ? payload.documents : [];
  if (docs.length === 0) {
    ui.notifications?.info(
      'Arcane Atlas: no synced documents. Toggle "Sync to Foundry" on each entry in the web Document Vault.',
    );
    return;
  }

  // Ensure the target folder exists.
  let folder = game.folders.find((f) => f.type === "JournalEntry" && f.name === FOLDER_NAME);
  if (!folder) {
    folder = await Folder.create({ name: FOLDER_NAME, type: "JournalEntry", color: "#8b6a2b" });
  }

  const OWNERSHIP =
    CONST?.DOCUMENT_OWNERSHIP_LEVELS ?? { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };

  let created = 0;
  let updated = 0;

  for (const doc of docs) {
    try {
      const pages = buildPages(doc, OWNERSHIP);
      const existing = game.journal.find(
        (j) =>
          j.folder?.id === folder.id &&
          j.getFlag?.(MOD_ID, "docId") === doc.id,
      );

      if (existing) {
        // Replace pages: delete old, insert fresh.
        const oldPageIds = existing.pages?.map((p) => p.id) ?? [];
        if (oldPageIds.length) {
          await existing.deleteEmbeddedDocuments("JournalEntryPage", oldPageIds);
        }
        await existing.update({ name: doc.title || "Untitled document" });
        await existing.createEmbeddedDocuments("JournalEntryPage", pages);
        updated++;
      } else {
        await JournalEntry.create({
          name: doc.title || "Untitled document",
          folder: folder.id,
          flags: {
            [MOD_ID]: {
              docId: doc.id,
              type: doc.type,
              updatedAt: doc.updated_at,
            },
          },
          pages,
        });
        created++;
      }
    } catch (err) {
      console.error("Arcane Atlas Sync | failed to sync doc", doc?.id, err);
    }
  }

  ui.notifications?.info(
    `Arcane Atlas: synced ${docs.length} document(s) into "${FOLDER_NAME}" (${created} new, ${updated} updated).`,
  );
}

function buildPages(doc, OWNERSHIP) {
  const pages = [];
  const typeLabel = doc.type === "book" ? "Book" : doc.type === "scroll" ? "Scroll" : "Letter";

  pages.push({
    name: `${typeLabel} — ${doc.title || "Untitled"}`,
    type: "text",
    text: {
      format: 1, // 1 = HTML
      content: String(doc.body ?? "") || "<p><em>(empty)</em></p>",
    },
  });

  const notes = String(doc.dm_notes ?? "").trim();
  if (notes) {
    pages.push({
      name: "GM Notes",
      type: "text",
      text: { format: 1, content: notes },
      ownership: {
        default: OWNERSHIP.NONE ?? 0,
      },
    });
  }

  return pages;
}
