import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const STATUS_LABEL = {
  pending: "In attesa",
  approved: "Approvata",
  rejected: "Non approvata",
  withdrawn: "Ritirata",
};

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const $ = (sel, root = document) => root.querySelector(sel);

export const LEVEL_LABEL = { triennale: "Triennale", magistrale: "Magistrale" };

export function levelBadge(level) {
  return `<span class="level level-${esc(level)}">${esc(LEVEL_LABEL[level] ?? level)}</span>`;
}

// Posti per livello: richieste attive (in attesa + approvate) rispetto al limite del docente.
export function levelSlots(t, level) {
  const limit = level === "magistrale" ? t.max_magistrale : t.max_triennale;
  const used = level === "magistrale" ? t.magistrale : t.triennale;
  if (limit === null || limit === undefined) return { full: false, used, limit: null, text: `${used} (nessun limite)` };
  return { full: used >= limit, used, limit, text: `${used} su ${limit}` };
}

export function badge(status) {
  return `<span class="badge badge-${esc(status)}">${esc(STATUS_LABEL[status] ?? status)}</span>`;
}

export function toast(message, kind = "info") {
  let box = $("#toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "toasts";
    document.body.appendChild(box);
  }
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

// Le tabelle di statistiche sono usate sia dalla pagina pubblica sia dall'area docenti.
export async function loadStats() {
  const [sess, teach] = await Promise.all([
    sb.from("stats_by_session").select("*").eq("active", true).order("sort_order"),
    sb.from("stats_by_teacher").select("*").order("full_name"),
  ]);
  if (sess.error) throw sess.error;
  if (teach.error) throw teach.error;
  return { sessions: sess.data, teachers: teach.data };
}

export function renderStats(container, { sessions, teachers }) {
  const tot = sessions.reduce((a, s) => a + s.total, 0);
  const appr = sessions.reduce((a, s) => a + s.approved, 0);
  const tri = sessions.reduce((a, s) => a + s.triennale, 0);
  const mag = sessions.reduce((a, s) => a + s.magistrale, 0);
  container.innerHTML = `
    <div class="cards">
      <div class="card stat"><div class="num">${tot}</div><div class="lbl">richieste attive</div></div>
      <div class="card stat"><div class="num">${appr}</div><div class="lbl">tesi assegnate</div></div>
      <div class="card stat"><div class="num">${tot - appr}</div><div class="lbl">in attesa di valutazione</div></div>
      <div class="card stat"><div class="num">${tri} / ${mag}</div><div class="lbl">triennali / magistrali</div></div>
    </div>
    <div class="grid2">
      <div class="card table-scroll">
        <h3>Candidati per sessione</h3>
        <table class="tbl">
          <thead><tr><th>Sessione</th><th>Triennale</th><th>Magistrale</th><th>In attesa</th><th>Assegnate</th><th>Totale</th></tr></thead>
          <tbody>${sessions
            .map((s) => `<tr><td>${esc(s.label)}</td><td>${s.triennale}</td><td>${s.magistrale}</td><td>${s.pending}</td><td>${s.approved}</td><td><strong>${s.total}</strong></td></tr>`)
            .join("")}</tbody>
        </table>
      </div>
      <div class="card table-scroll">
        <h3>Tesi per docente</h3>
        <table class="tbl">
          <thead><tr><th>Docente</th><th>Triennale (occupati)</th><th>Magistrale (occupati)</th><th>In attesa</th><th>Assegnate</th></tr></thead>
          <tbody>${teachers
            .map((t) => {
              const tr = levelSlots(t, "triennale"), ma = levelSlots(t, "magistrale");
              const cell = (x) => `<td${x.full ? ' class="full"' : ""}>${esc(x.text)}${x.full ? " (esauriti)" : ""}</td>`;
              return `<tr><td>${esc(t.full_name)}</td>${cell(tr)}${cell(ma)}<td>${t.pending}</td><td>${t.approved}</td></tr>`;
            })
            .join("")}</tbody>
        </table>
      </div>
    </div>`;
}

export const MAX_PDF_BYTES = 5 * 1024 * 1024;

// Carica un PDF nel bucket privato e restituisce il percorso da salvare; null se nessun file.
export async function uploadPdf(file) {
  if (!file) return null;
  if (file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("L'allegato deve essere un file PDF.");
  }
  if (file.size > MAX_PDF_BYTES) throw new Error("L'allegato supera il limite di 5 MB.");
  const head = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
  if (head !== "%PDF-") throw new Error("Il file non sembra un PDF valido.");
  const path = `uploads/${crypto.randomUUID()}.pdf`;
  const { error } = await sb.storage.from("proposals").upload(path, file, { contentType: "application/pdf", upsert: false });
  if (error) throw new Error("Caricamento dell'allegato non riuscito.");
  return path;
}
