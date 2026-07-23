/**
 * Arcane Atlas Sync — Lore Vault
 * -------------------------------
 * Syncs the DM's Arcane Atlas Document Vault (letters, scrolls, books) into
 * Foundry VTT Journal Entries under a folder called "Arcane Atlas - Biblioteca",
 * with themed styling, animations, and a cinematic web viewer.
 *
 * Player access is governed by native Foundry Journal Entry ownership:
 * every entry is created GM-only by default. Share manually via
 * right-click → Configure Ownership.
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
  game.arcaneAtlas = { syncDocuments, openCinematic };
  if (game.user?.isGM) {
    ui.notifications?.info(
      'Arcane Atlas Sync ready. Use the "Sync Library" button in the Journal controls, or run game.arcaneAtlas.syncDocuments().',
    );
  }
});

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
  if (controls && typeof controls === "object" && !Array.isArray(controls)) {
    const notes = controls.notes ?? controls.journal;
    if (notes) {
      if (Array.isArray(notes.tools)) notes.tools.push(tool);
      else if (notes.tools && typeof notes.tools === "object") notes.tools[tool.name] = tool;
    }
    return;
  }
  if (Array.isArray(controls)) {
    const notes = controls.find((c) => c.name === "notes" || c.name === "journal");
    if (notes && Array.isArray(notes.tools)) notes.tools.push(tool);
  }
});

/* --------------------------------------------------------------------------
 * Cinematic viewer — opens the arcaneatlas.org embed in a Foundry Dialog.
 * Wired to any .aa-cinematic-btn injected into a themed journal page.
 * ------------------------------------------------------------------------ */

function openCinematic(shareToken, title) {
  if (!shareToken) {
    ui.notifications?.warn("Arcane Atlas: this document has no share token yet. Re-sync your library.");
    return;
  }
  const url = `${API_BASE}/embed/document/${encodeURIComponent(shareToken)}`;
  const content = `<iframe src="${url}" allowfullscreen></iframe>`;
  const dlg = new Dialog(
    {
      title: title || "Arcane Atlas — Cinematic Viewer",
      content,
      buttons: {
        close: { label: "Close", callback: () => {} },
      },
      default: "close",
    },
    {
      classes: ["aa-cinematic-dialog"],
      width: 900,
      height: 800,
      resizable: true,
    },
  );
  dlg.render(true);
}

Hooks.on("renderJournalPageSheet", (_app, html) => {
  const root = html?.[0] ?? html;
  if (!root || !root.querySelectorAll) return;
  const buttons = root.querySelectorAll(".aa-cinematic-btn");
  buttons.forEach((btn) => {
    if (btn.dataset.aaBound === "1") return;
    btn.dataset.aaBound = "1";
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      const token = btn.getAttribute("data-share-token");
      const title = btn.getAttribute("data-title") || "";
      openCinematic(token, title);
    });
  });
});

/* --------------------------------------------------------------------------
 * Sync
 * ------------------------------------------------------------------------ */

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
    if (res.status === 401) { ui.notifications?.error("Arcane Atlas: invalid or revoked API key."); return; }
    if (res.status === 402) { ui.notifications?.error("Arcane Atlas: this feature requires a Patreon premium subscription."); return; }
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
    ui.notifications?.info('Arcane Atlas: no synced documents. Toggle "Sync to Foundry" on each entry in the web Document Vault.');
    return;
  }

  let folder = game.folders.find((f) => f.type === "JournalEntry" && f.name === FOLDER_NAME);
  if (!folder) {
    folder = await Folder.create({ name: FOLDER_NAME, type: "JournalEntry", color: "#8b6a2b" });
  }

  const OWNERSHIP = CONST?.DOCUMENT_OWNERSHIP_LEVELS ?? { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };

  let created = 0;
  let updated = 0;

  for (const doc of docs) {
    try {
      const pages = buildPages(doc, OWNERSHIP);
      const existing = game.journal.find(
        (j) => j.folder?.id === folder.id && j.getFlag?.(MOD_ID, "docId") === doc.id,
      );

      if (existing) {
        const oldPageIds = existing.pages?.map((p) => p.id) ?? [];
        if (oldPageIds.length) {
          await existing.deleteEmbeddedDocuments("JournalEntryPage", oldPageIds);
        }
        await existing.update({
          name: doc.title || "Untitled document",
          flags: { [MOD_ID]: { docId: doc.id, type: doc.type, shareToken: doc.share_token, updatedAt: doc.updated_at } },
        });
        await existing.createEmbeddedDocuments("JournalEntryPage", pages);
        updated++;
      } else {
        await JournalEntry.create({
          name: doc.title || "Untitled document",
          folder: folder.id,
          ownership: { default: OWNERSHIP.NONE ?? 0 },
          flags: {
            [MOD_ID]: {
              docId: doc.id,
              type: doc.type,
              shareToken: doc.share_token,
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

/* --------------------------------------------------------------------------
 * Theming
 * ------------------------------------------------------------------------ */

function stripPreviousWrapper(html) {
  const s = String(html ?? "").trim();
  if (!s) return "";
  const m = s.match(/<div class="aa-doc[^"]*"[^>]*>([\s\S]*)<\/div>\s*$/i);
  return m ? m[1] : s;
}

function injectDropCap(html) {
  return html.replace(
    /<p([^>]*)>\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ¡¿"«"'(])/,
    '<p$1><span class="aa-dropcap">$2</span>',
  );
}

function themeCss(kind) {
  const common = `
    .aa-doc{max-width:760px;margin:1rem auto;padding:2.25rem 2.5rem;line-height:1.65;font-size:1.02rem;position:relative;}
    .aa-doc h1,.aa-doc h2,.aa-doc h3{font-family:Cinzel,"Trajan Pro",Georgia,serif;letter-spacing:.04em;margin-top:1.2em;}
    .aa-doc p{margin:0 0 1em;}
    .aa-doc .aa-title{text-align:center;margin:0 0 .3em;font-size:1.7rem;}
    .aa-doc .aa-divider{border:0;height:14px;margin:.4em auto 1.4em;max-width:60%;
      background:radial-gradient(circle,currentColor 1px,transparent 1.5px) center/12px 100% repeat-x;opacity:.5;}
  `;
  switch (kind) {
    case "book":
      return common + `
        .aa-doc--book{background:#f2e3c6;color:#2b1d0c;
          border:6px solid #5c3a21;outline:2px solid #3a2110;outline-offset:-10px;border-radius:8px;
          box-shadow:0 6px 18px rgba(0,0,0,.35),inset 0 0 60px rgba(92,58,33,.18);
          font-family:Cinzel,Georgia,"Times New Roman",serif;padding:2.75rem 3rem;}
        .aa-doc--book .aa-dropcap{float:left;font-family:"UnifrakturCook",Cinzel,Georgia,serif;
          font-size:3.6rem;line-height:.9;padding:.25rem .55rem 0 0;color:#5c3a21;font-weight:700;}
      `;
    case "scroll":
      return common + `
        .aa-doc--scroll{background:#f9f3d9;color:#3a2a10;
          border-left:14px solid #8b5a2b;border-right:14px solid #8b5a2b;
          box-shadow:inset 10px 0 0 #d4a24a,inset -10px 0 0 #d4a24a,0 4px 14px rgba(0,0,0,.25);
          background-image:repeating-linear-gradient(180deg,rgba(139,90,43,.05) 0 2px,transparent 2px 6px);
          font-family:"Cormorant Garamond","EB Garamond",Georgia,serif;font-style:italic;padding:2.5rem 3.25rem;}
        .aa-doc--scroll .aa-title{font-style:normal;}
      `;
    case "letter":
      return common + `
        .aa-doc--letter{background:#fffef0;color:#2a2416;border:1px solid #d9cfa8;
          box-shadow:0 3px 10px rgba(0,0,0,.15);
          font-family:"EB Garamond",Georgia,"Times New Roman",serif;padding:2.25rem 2.75rem;}
        .aa-doc--letter .aa-title{border-bottom:1px solid #c8a24a;padding-bottom:.5em;}
        .aa-doc--letter .aa-seal{margin:2em auto 0;width:64px;height:64px;border-radius:50%;
          background:radial-gradient(circle at 35% 30%,#c93131,#8b1a1a 55%,#4a0d0d 100%);
          display:flex;align-items:center;justify-content:center;color:#f2c46b;
          font-size:2rem;transform:rotate(-8deg);font-family:serif;}
      `;
    case "gm":
      return common + `
        .aa-doc--gm{background:#1a1921;color:#d4ceb8;border:2px solid #6b46c1;border-radius:6px;
          font-family:"EB Garamond",Georgia,serif;font-style:italic;padding:2rem 2.5rem;}
        .aa-doc--gm .aa-ribbon{display:inline-block;background:#6b46c1;color:#fff;
          padding:.25em .75em;border-radius:3px;font-style:normal;font-size:.85rem;
          letter-spacing:.08em;text-transform:uppercase;margin-bottom:1em;}
        .aa-doc--gm .aa-title{color:#e6dfc7;}
      `;
    default:
      return common;
  }
}

function cinematicButton(shareToken, title) {
  if (!shareToken) return "";
  const safeTitle = String(title || "").replace(/"/g, "&quot;");
  return `<div class="aa-cinematic-wrap"><button type="button" class="aa-cinematic-btn" data-share-token="${shareToken}" data-title="${safeTitle}">✨ Cinematic View</button></div>`;
}

function wrapThemed(kind, title, innerHtml, shareToken) {
  const body = stripPreviousWrapper(innerHtml) || "<p><em>(empty)</em></p>";
  const safeTitle = String(title || "").replace(/[<>]/g, "");
  const heading = safeTitle ? `<h1 class="aa-title">${safeTitle}</h1><hr class="aa-divider"/>` : "";
  const btn = kind === "gm" ? "" : cinematicButton(shareToken, safeTitle);

  let content;
  if (kind === "book") {
    content = `${heading}${injectDropCap(body)}${btn}`;
  } else if (kind === "letter") {
    content = `${heading}${body}<div class="aa-seal" aria-hidden="true">✶</div>${btn}`;
  } else if (kind === "gm") {
    content = `<span class="aa-ribbon">🔒 Notas Secretas del Máster</span>${heading}${body}`;
  } else {
    content = `${heading}${body}${btn}`;
  }

  return `<style>${themeCss(kind)}</style><div class="aa-doc aa-doc--${kind}">${content}</div>`;
}

function buildPages(doc, OWNERSHIP) {
  const pages = [];
  const rawType = String(doc.type || "").toLowerCase();
  const kind = rawType === "book" || rawType === "scroll" || rawType === "letter" ? rawType : "letter";
  const typeLabel = kind === "book" ? "Book" : kind === "scroll" ? "Scroll" : "Letter";

  pages.push({
    name: `${typeLabel} — ${doc.title || "Untitled"}`,
    type: "text",
    text: { format: 1, content: wrapThemed(kind, doc.title, doc.body, doc.share_token) },
  });

  const notes = String(doc.dm_notes ?? "").trim();
  if (notes) {
    pages.push({
      name: "Notas del Máster",
      type: "text",
      text: { format: 1, content: wrapThemed("gm", "Notas del Máster", notes, null) },
      ownership: { default: OWNERSHIP.NONE ?? 0 },
    });
  }

  return pages;
}
