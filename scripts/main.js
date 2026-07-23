/**
 * Arcane Atlas Sync — Foundry VTT module
 * ---------------------------------------
 * Free tier   : opens public maps of any DM (?dm=<username>) in a Foundry window.
 * Premium tier: with an API key from arcaneatlas.org/profile, mints a short-lived
 *               viewer JWT and opens private maps, GM-only markers and zones.
 */

const MOD_ID = "arcane-atlas-sync";
const API_BASE = "https://arcaneatlas.org";

Hooks.once("init", () => {
  console.log("Arcane Atlas Sync | init");

  game.settings.register(MOD_ID, "apiKey", {
    name: "Arcane Atlas API key (premium)",
    hint: "Paste the key from arcaneatlas.org → Profile → Foundry. Leave empty to use the free tier (public maps only).",
    scope: "world",
    config: true,
    type: String,
    default: "",
  });

  game.settings.register(MOD_ID, "lastMapId", {
    scope: "world",
    config: false,
    type: String,
    default: "",
  });
});

Hooks.once("ready", () => {
  console.log("Arcane Atlas Sync | ready");
  game.arcaneAtlas = {
    openMap: openMap,
    openPublic: openPublicMap,
    prompt: promptForMap,
  };
  ui.notifications?.info("Arcane Atlas Sync ready. Run game.arcaneAtlas.prompt() or drop a scene macro.");
});

/**
 * Premium flow: exchanges the stored API key for a viewer JWT and opens the
 * signed embed URL.
 */
async function openMap(mapId, opts = {}) {
  if (!mapId) return promptForMap();
  const key = game.settings.get(MOD_ID, "apiKey");
  if (!key) {
    ui.notifications?.warn("No API key configured. Falling back to public map view.");
    return openPublicMap(mapId, opts);
  }
  try {
    const res = await fetch(`${API_BASE}/api/public/foundry/mint`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: key,
        map_id: mapId,
        role_hint: game.user?.isGM ? "gm" : "player",
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      ui.notifications?.error(`Arcane Atlas: ${res.status} ${txt.slice(0, 120)}`);
      return;
    }
    const data = await res.json();
    if (!data.embed_url) {
      ui.notifications?.error("Arcane Atlas: mint returned no embed_url");
      return;
    }
    await game.settings.set(MOD_ID, "lastMapId", mapId);
    openViewer(data.embed_url, opts.title ?? "Arcane Atlas");
  } catch (err) {
    console.error("Arcane Atlas Sync", err);
    ui.notifications?.error("Arcane Atlas: network error");
  }
}

/**
 * Free flow: opens the public embed page directly. Only works for maps the DM
 * has marked as public on arcaneatlas.org.
 */
function openPublicMap(mapId, opts = {}) {
  if (!mapId) return promptForMap();
  const url = `${API_BASE}/embed/map/${encodeURIComponent(mapId)}`;
  openViewer(url, opts.title ?? "Arcane Atlas — Public");
}

function openViewer(url, title) {
  const AppCls = foundry?.applications?.api?.ApplicationV2 ?? Application;
  const isV2 = !!foundry?.applications?.api?.ApplicationV2;

  if (isV2) {
    class AtlasViewer extends foundry.applications.api.HandlebarsApplicationMixin(AppCls) {
      static DEFAULT_OPTIONS = {
        id: "arcane-atlas-viewer",
        classes: ["arcane-atlas-viewer"],
        window: { title, resizable: true },
        position: { width: 1100, height: 720 },
      };
      static PARTS = { body: { template: null } };
      async _renderHTML() { return ""; }
      _replaceHTML(_r, content) {
        content.innerHTML = `<iframe src="${url}" style="width:100%;height:100%;border:0;background:#0f0a08" allow="fullscreen"></iframe>`;
      }
    }
    new AtlasViewer().render(true);
    return;
  }

  const w = new Application({
    id: "arcane-atlas-viewer",
    title,
    template: null,
    width: 1100,
    height: 720,
    resizable: true,
  });
  w._renderInner = async () => $(`<iframe src="${url}" style="width:100%;height:100%;border:0;background:#0f0a08" allow="fullscreen"></iframe>`);
  w.render(true);
}

async function promptForMap() {
  const last = game.settings.get(MOD_ID, "lastMapId") ?? "";
  const html = `
    <form>
      <div class="form-group">
        <label>Map ID (from arcaneatlas.org URL)</label>
        <input type="text" name="mid" value="${last}" placeholder="e.g. 5f3e2c1b-…" />
      </div>
      <p style="opacity:.7;font-size:.85em">Premium key configured: <b>${game.settings.get(MOD_ID, "apiKey") ? "yes" : "no (public maps only)"}</b></p>
    </form>`;
  return new Promise((resolve) => {
    new Dialog({
      title: "Open Arcane Atlas map",
      content: html,
      buttons: {
        ok: {
          label: "Open",
          callback: (root) => {
            const mid = root.find('input[name="mid"]').val()?.trim();
            if (mid) openMap(mid);
            resolve(mid);
          },
        },
        cancel: { label: "Cancel", callback: () => resolve(null) },
      },
      default: "ok",
    }).render(true);
  });
}
