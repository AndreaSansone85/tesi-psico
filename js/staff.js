import { sb, esc, $, badge, STATUS_LABEL, toast, loadStats, renderStats, uploadPdf, levelBadge } from "./common.js?v=3";

let me = null;          // profilo del docente collegato
let rows = [];          // richieste visibili all'utente (con dati riservati)
let sessions = [];      // tutte le sessioni
let teachers = [];      // elenco docenti (id, full_name)
let profiles = [];      // solo admin: profili completi
let editing = null;

const isAdmin = () => me?.role === "admin";
const show = (id, on) => $(id).classList.toggle("hidden", !on);

// ---------- autenticazione ----------
async function init() {
  sb.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      show("#view-login", false); show("#view-app", false); show("#view-recovery", true);
    }
  });

  const { data } = await sb.auth.getSession();
  if (location.hash.includes("type=recovery")) return; // gestito dall'evento sopra
  if (data.session) await enterApp(); else showLogin();

  $("#login-form").addEventListener("submit", login);
  $("#forgot").addEventListener("click", forgot);
  $("#recovery-form").addEventListener("submit", setNewPassword);
  $("#logout").addEventListener("click", logout);
}

function showLogin() {
  show("#view-login", true); show("#view-app", false); show("#view-recovery", false); show("#logout", false);
}

async function login(e) {
  e.preventDefault();
  const { error } = await sb.auth.signInWithPassword({ email: $("#l-email").value.trim(), password: $("#l-pass").value });
  if (error) return toast("Credenziali non valide.", "error");
  $("#l-pass").value = "";
  await enterApp();
}

async function forgot() {
  const email = $("#l-email").value.trim();
  if (!email) return toast("Inserisci prima la tua email.", "error");
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split("#")[0] });
  if (error) return toast("Invio non riuscito.", "error");
  toast("Se l'indirizzo è registrato, riceverai un link per reimpostare la password.", "ok");
}

async function setNewPassword(e) {
  e.preventDefault();
  const { error } = await sb.auth.updateUser({ password: $("#r-pass").value });
  if (error) return toast(error.message, "error");
  toast("Password aggiornata.", "ok");
  history.replaceState(null, "", location.pathname);
  show("#view-recovery", false);
  await enterApp();
}

async function logout() {
  await sb.auth.signOut();
  me = null;
  showLogin();
}

async function enterApp() {
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return showLogin();
  const { data: p } = await sb.from("profiles").select("*").eq("id", u.user.id).maybeSingle();
  if (!p || !p.active) {
    await sb.auth.signOut();
    showLogin();
    return toast("Questo account non è abilitato come docente.", "error");
  }
  me = p;
  show("#view-login", false); show("#view-recovery", false); show("#view-app", true); show("#logout", true);
  $("#whoami").textContent = `${me.full_name} (${isAdmin() ? "amministratore" : "docente"})`;
  buildTabs();
  await reload();
  setTab("richieste");
}

// ---------- dati ----------
async function reload() {
  const [th, se, te] = await Promise.all([
    sb.from("theses")
      .select("*, thesis_private(matricola, email, phone, teacher_notes, attachment_path)")
      .order("created_at", { ascending: false }),
    sb.from("sessions").select("*").order("sort_order"),
    sb.from("public_teachers").select("*").order("full_name"),
  ]);
  for (const r of [th, se, te]) if (r.error) return toast(r.error.message, "error");
  rows = th.data.map((t) => ({ ...t, priv: t.thesis_private ?? {} }));
  sessions = se.data;
  teachers = te.data;
  if (isAdmin()) {
    const pr = await sb.from("profiles").select("*").order("full_name");
    profiles = pr.data ?? [];
  }
  fillFilters();
  renderTable();
  renderMyLimit();
}

function fillOpts(sel, items, v, l, keepFirst = true) {
  const first = keepFirst ? sel.options[0] : null;
  sel.innerHTML = "";
  if (first) sel.appendChild(first);
  for (const it of items) {
    const o = document.createElement("option");
    o.value = it[v]; o.textContent = it[l];
    sel.appendChild(o);
  }
}

function levelUsage(level) {
  const mine = rows.filter((r) => r.teacher_id === me.id && r.degree_level === level && ["pending", "approved"].includes(r.status));
  const appr = mine.filter((r) => r.status === "approved").length;
  return { used: mine.length, appr, pend: mine.length - appr };
}

function renderMyLimit() {
  $("#my-lim-tri").value = me.max_triennale ?? "";
  $("#my-lim-mag").value = me.max_magistrale ?? "";
  const part = (label, level, lim) => {
    const u = levelUsage(level);
    const state = lim === null || lim === undefined ? "nessun limite" : lim - u.used > 0 ? `${lim - u.used} posti liberi` : "posti esauriti";
    return `${label}: ${u.used} occupati (${u.appr} approvate, ${u.pend} in attesa), ${state}.`;
  };
  $("#my-limit-info").textContent = `${part("Triennale", "triennale", me.max_triennale)} ${part("Magistrale", "magistrale", me.max_magistrale)}`;
}

function parseLimit(raw) {
  const t = raw.trim();
  if (t === "") return { ok: true, value: null };
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? { ok: true, value: n } : { ok: false };
}

$("#my-limit-save").addEventListener("click", async () => {
  const tri = parseLimit($("#my-lim-tri").value), mag = parseLimit($("#my-lim-mag").value);
  if (!tri.ok || !mag.ok) return toast("Inserisci numeri interi non negativi.", "error");
  const { error } = await sb.from("profiles").update({ max_triennale: tri.value, max_magistrale: mag.value }).eq("id", me.id);
  if (error) return toast(error.message, "error");
  me.max_triennale = tri.value; me.max_magistrale = mag.value;
  renderMyLimit();
  toast("Limiti aggiornati.", "ok");
});

function fillFilters() {
  fillOpts($("#s-session"), sessions, "id", "label");
  fillOpts($("#s-teacher"), teachers, "id", "full_name");
  show("#s-teacher", isAdmin());
}

// ---------- tab ----------
function buildTabs() {
  const tabs = [["richieste", "Richieste"], ["stats", "Statistiche"]];
  if (isAdmin()) tabs.push(["docenti", "Docenti"], ["sessioni", "Sessioni"]);
  $("#tabs").innerHTML = tabs.map(([k, l]) => `<button type="button" data-tab="${k}">${l}</button>`).join("");
  $("#tabs").onclick = (e) => { const k = e.target.dataset?.tab; if (k) setTab(k); };
}

async function setTab(k) {
  for (const t of ["richieste", "stats", "docenti", "sessioni"]) show(`#tab-${t}`, t === k);
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === k));
  if (k === "stats") renderStats($("#tab-stats"), await loadStats());
  if (k === "docenti") renderTeachers();
  if (k === "sessioni") renderSessions();
}

// ---------- richieste ----------
const tName = (id) => teachers.find((t) => t.id === id)?.full_name ?? "n.d.";
const sName = (id) => sessions.find((s) => s.id === id)?.label ?? "n.d.";

function filtered() {
  const q = $("#s-text").value.trim().toLowerCase();
  const st = $("#s-status").value, se = $("#s-session").value, te = $("#s-teacher").value, lv = $("#s-level").value;
  return rows.filter((r) => {
    if (st && r.status !== st) return false;
    if (lv && r.degree_level !== lv) return false;
    if (se && String(r.session_id) !== se) return false;
    if (te && r.teacher_id !== te) return false;
    if (q && !`${r.first_name} ${r.last_name} ${r.priv.matricola} ${r.title ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderTable() {
  const list = filtered();
  const head = `<thead><tr><th>Candidato</th><th>Contatti riservati</th><th>Titolo</th>${isAdmin() ? "<th>Docente</th>" : ""}<th>Sessione</th><th>Stato</th><th></th></tr></thead>`;
  const body = list.map((r) => `
    <tr>
      <td>${levelBadge(r.degree_level)}<br><strong>${esc(r.last_name)} ${esc(r.first_name)}</strong><br><span class="private">Matr. ${esc(r.priv.matricola)}</span></td>
      <td class="private">${esc(r.priv.email)}<br>${esc(r.priv.phone)}</td>
      <td>${r.title ? esc(r.title) : '<span class="meta">Titolo da definire</span>'}${r.priv.attachment_path ? ` <button class="btn small secondary" data-act="attach" data-id="${esc(r.id)}">PDF</button>` : ""}</td>
      ${isAdmin() ? `<td>${esc(tName(r.teacher_id))}</td>` : ""}
      <td>${esc(sName(r.session_id))}</td>
      <td>${badge(r.status)}</td>
      <td style="white-space:nowrap">
        ${r.status === "pending" ? `<button class="btn small" data-act="approved" data-id="${esc(r.id)}">Approva</button>
        <button class="btn small danger" data-act="rejected" data-id="${esc(r.id)}">Rifiuta</button>` : ""}
        <button class="btn small secondary" data-act="edit" data-id="${esc(r.id)}">Modifica</button>
      </td>
    </tr>`).join("");
  $("#req-table").innerHTML = head + `<tbody>${body || `<tr><td colspan="7" class="meta">Nessuna richiesta.</td></tr>`}</tbody>`;
}

for (const id of ["#s-text", "#s-status", "#s-level", "#s-session", "#s-teacher"]) {
  document.addEventListener("input", (e) => { if (e.target.matches(id)) renderTable(); });
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b || !b.dataset.id) return;
  const r = rows.find((x) => x.id === b.dataset.id);
  if (!r) return;
  if (b.dataset.act === "edit") return openEdit(r);
  if (b.dataset.act === "attach") return openAttachment(r.priv.attachment_path);
  await setStatus(r, b.dataset.act);
});

function activeDuplicate(r, newStatus) {
  if (!["pending", "approved"].includes(newStatus)) return false;
  return rows.some((x) => x.id !== r.id && x.priv.matricola === r.priv.matricola && ["pending", "approved"].includes(x.status));
}

async function setStatus(r, status) {
  if (status === "approved" && !r.title) {
    toast("Per approvare serve il titolo definitivo: inseriscilo e salva.", "error");
    openEdit(r);
    $("#e-status").value = "approved";
    $("#e-title").focus();
    return;
  }
  if (activeDuplicate(r, status)) return toast("Questa matricola ha già un'altra richiesta attiva.", "error");
  const { error } = await sb.from("theses").update({ status }).eq("id", r.id);
  if (error) return toast(error.message, "error");
  toast(`Richiesta: ${STATUS_LABEL[status].toLowerCase()}.`, "ok");
  await reload();
}

// ---------- modifica e inserimento ----------
async function openAttachment(path) {
  const { data, error } = await sb.storage.from("proposals").createSignedUrl(path, 120);
  if (error) return toast("Impossibile aprire l'allegato.", "error");
  window.open(data.signedUrl, "_blank", "noopener");
}

function prepareDialog(add) {
  fillOpts($("#e-session"), sessions.filter((x) => x.active || (editing && x.id === editing.session_id)), "id", "label", false);
  show("#e-teacher-wrap", isAdmin());
  show("#e-delete", isAdmin() && !add);
  show("#e-history", !add);
  if (isAdmin()) fillOpts($("#e-teacher"), teachers, "id", "full_name", false);
  for (const o of $("#e-status").options) o.disabled = add && !["pending", "approved"].includes(o.value);
  $("#e-file").value = "";
}

function openAdd() {
  editing = null;
  $("#dlg-title").textContent = "Nuova richiesta";
  for (const id of ["#e-first", "#e-last", "#e-mat", "#e-phone", "#e-email", "#e-title", "#e-abs", "#e-notes"]) $(id).value = "";
  prepareDialog(true);
  $("#e-status").value = "approved";
  $("#e-level").value = "triennale";
  if (isAdmin()) $("#e-teacher").value = me.id;
  $("#e-att").textContent = "Nessun allegato.";
  $("#dlg").showModal();
}

async function loadHistory(id) {
  const box = $("#e-hist");
  box.innerHTML = `<p class="meta">Caricamento…</p>`;
  const { data, error } = await sb.from("thesis_log").select("*").eq("thesis_id", id).order("at", { ascending: false });
  if (error) { box.innerHTML = `<p class="meta">Storico non disponibile.</p>`; return; }
  const fmt = (v, field) => (field === "stato" ? STATUS_LABEL[v] ?? v : field === "livello" ? (v === "magistrale" ? "magistrale" : "triennale") : v ?? "");
  box.innerHTML = `<table class="tbl"><tbody>${data.map((l) => `
    <tr><td>${esc(new Date(l.at).toLocaleString("it-IT"))}</td><td>${esc(l.actor_name)}</td>
    <td>${l.field === "creazione" ? `Richiesta creata (${esc(fmt(l.new_value, "stato"))})`
      : `${esc(l.field)}: ${esc(fmt(l.old_value, l.field))} \u2192 ${esc(fmt(l.new_value, l.field))}`}</td></tr>`).join("")}</tbody></table>`;
}

function openEdit(r) {
  editing = r;
  $("#dlg-title").textContent = `${r.last_name} ${r.first_name}`;
  prepareDialog(false);
  $("#e-first").value = r.first_name; $("#e-last").value = r.last_name;
  $("#e-mat").value = r.priv.matricola ?? ""; $("#e-phone").value = r.priv.phone ?? ""; $("#e-email").value = r.priv.email ?? "";
  $("#e-title").value = r.title ?? ""; $("#e-abs").value = r.abstract;
  $("#e-level").value = r.degree_level;
  $("#e-session").value = r.session_id;
  $("#e-status").value = r.status;
  $("#e-notes").value = r.priv.teacher_notes ?? "";
  if (isAdmin()) $("#e-teacher").value = r.teacher_id;
  $("#e-att").innerHTML = r.priv.attachment_path
    ? `<button class="btn small secondary" type="button" id="e-att-open">Apri allegato</button> Per sostituirlo carica un nuovo file.`
    : "Nessun allegato.";
  $("#e-att-open")?.addEventListener("click", () => openAttachment(r.priv.attachment_path));
  loadHistory(r.id);
  $("#dlg").showModal();
}

$("#add").addEventListener("click", openAdd);
$("#e-cancel").addEventListener("click", () => $("#dlg").close());

$("#edit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!$("#edit-form").reportValidity()) return;
  const status = $("#e-status").value;
  if (status === "approved" && !$("#e-title").value.trim()) return toast("Per approvare inserisci il titolo definitivo.", "error");
  const mat = $("#e-mat").value.trim().toUpperCase();
  if (activeDuplicate({ id: editing?.id, priv: { matricola: mat } }, status)) {
    return toast("Questa matricola ha già un'altra richiesta attiva.", "error");
  }
  const btn = $("#e-save");
  btn.disabled = true;
  try {
    const newPath = await uploadPdf($("#e-file").files[0]);

    if (!editing) {
      const { error } = await sb.rpc("staff_add_thesis", {
        p_first_name: $("#e-first").value, p_last_name: $("#e-last").value, p_matricola: mat,
        p_email: $("#e-email").value, p_phone: $("#e-phone").value,
        p_teacher_id: isAdmin() ? $("#e-teacher").value : me.id,
        p_session_id: Number($("#e-session").value),
        p_title: $("#e-title").value.trim() || null, p_abstract: $("#e-abs").value,
        p_degree_level: $("#e-level").value, p_status: status, p_attachment_path: newPath,
      });
      if (error) throw error;
      const notes = $("#e-notes").value.trim();
      if (notes) {
        // le note si aggiungono dopo la creazione, ricaricando l'elenco per trovare l'id
        await reload();
        const created = rows.find((x) => x.priv.matricola === mat && x.status === status);
        if (created) await sb.from("thesis_private").update({ teacher_notes: notes }).eq("thesis_id", created.id);
      }
    } else {
      const upd = {
        first_name: $("#e-first").value.trim(), last_name: $("#e-last").value.trim(),
        title: $("#e-title").value.trim() || null, abstract: $("#e-abs").value.trim(),
        degree_level: $("#e-level").value,
        session_id: Number($("#e-session").value), status,
      };
      if (isAdmin()) upd.teacher_id = $("#e-teacher").value;
      const r1 = await sb.from("theses").update(upd).eq("id", editing.id);
      if (r1.error) throw r1.error;
      const priv = {
        matricola: mat, email: $("#e-email").value.trim().toLowerCase(),
        phone: $("#e-phone").value.trim(), teacher_notes: $("#e-notes").value.trim() || null,
      };
      if (newPath) priv.attachment_path = newPath;
      const r2 = await sb.from("thesis_private").update(priv).eq("thesis_id", editing.id);
      if (r2.error) throw r2.error;
    }
    $("#dlg").close();
    toast("Modifiche salvate.", "ok");
    await reload();
  } catch (err) {
    toast(err.message || "Operazione non riuscita.", "error");
  } finally {
    btn.disabled = false;
  }
});

$("#e-delete").addEventListener("click", async () => {
  if (!confirm("Eliminare definitivamente la richiesta? L'operazione non è reversibile. Per mantenere lo storico è preferibile impostare lo stato su Ritirata.")) return;
  const path = editing.priv.attachment_path;
  const { error } = await sb.from("theses").delete().eq("id", editing.id);
  if (error) return toast(error.message, "error");
  if (path) await sb.storage.from("proposals").remove([path]);
  $("#dlg").close();
  await reload();
});

// ---------- export CSV ----------
function csvCell(v) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita l'esecuzione di formule in Excel
  return `"${s.replace(/"/g, '""')}"`;
}

$("#export").addEventListener("click", () => {
  const head = ["Tipo di tesi", "Cognome", "Nome", "Matricola", "Email", "Telefono", "Titolo", "Descrizione", "Docente", "Sessione", "Stato", "Inviata il", "Note"];
  const lines = [head.map(csvCell).join(";")];
  for (const r of filtered()) {
    lines.push([r.degree_level === "magistrale" ? "Magistrale" : "Triennale", r.last_name, r.first_name, r.priv.matricola, r.priv.email, r.priv.phone, r.title ?? "", r.abstract,
      tName(r.teacher_id), sName(r.session_id), STATUS_LABEL[r.status], r.created_at.slice(0, 10), r.priv.teacher_notes]
      .map(csvCell).join(";"));
  }
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `richieste-tesi-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- admin: docenti e sessioni ----------
function renderTeachers() {
  const lim = (p, f) => `<input type="number" min="0" style="width:90px" placeholder="nessuno" value="${p[f] ?? ""}" data-max-profile="${esc(p.id)}" data-field="${f}">`;
  $("#teach-table").innerHTML = `<thead><tr><th>Nome</th><th>Email</th><th>Ruolo</th><th>Limite triennale</th><th>Limite magistrale</th><th>Stato</th><th></th></tr></thead><tbody>${profiles
    .map((p) => `<tr><td>${esc(p.full_name)}</td><td>${esc(p.email)}</td><td>${p.role === "admin" ? "Amministratore" : "Docente"}</td>
      <td>${lim(p, "max_triennale")}</td><td>${lim(p, "max_magistrale")}</td>
      <td>${p.active ? "Attivo" : "Disattivato"}</td>
      <td>${p.id === me.id ? "" : `<button class="btn small secondary" data-toggle-profile="${esc(p.id)}">${p.active ? "Disattiva" : "Attiva"}</button>`}</td></tr>`)
    .join("")}</tbody>`;
}

document.addEventListener("change", async (e) => {
  const inp = e.target.closest("[data-max-profile]");
  if (!inp) return;
  const parsed = parseLimit(inp.value);
  if (!parsed.ok) return toast("Inserisci un numero intero non negativo.", "error");
  const field = inp.dataset.field;
  const { error } = await sb.from("profiles").update({ [field]: parsed.value }).eq("id", inp.dataset.maxProfile);
  if (error) return toast(error.message, "error");
  toast("Limite aggiornato.", "ok");
  const p = profiles.find((x) => x.id === inp.dataset.maxProfile);
  if (p) p[field] = parsed.value;
  if (p && p.id === me.id) { me[field] = parsed.value; renderMyLimit(); }
});

function renderSessions() {
  $("#sess-table").innerHTML = `<thead><tr><th>Sessione</th><th>Ordine</th><th>Stato</th><th></th></tr></thead><tbody>${sessions
    .map((s) => `<tr><td>${esc(s.label)}</td><td>${s.sort_order}</td><td>${s.active ? "Attiva" : "Non selezionabile"}</td>
      <td><button class="btn small secondary" data-toggle-session="${s.id}">${s.active ? "Disattiva" : "Attiva"}</button></td></tr>`)
    .join("")}</tbody>`;
}

document.addEventListener("click", async (e) => {
  const tp = e.target.closest("[data-toggle-profile]");
  if (tp) {
    const p = profiles.find((x) => x.id === tp.dataset.toggleProfile);
    const { error } = await sb.from("profiles").update({ active: !p.active }).eq("id", p.id);
    if (error) return toast(error.message, "error");
    await reload(); renderTeachers();
  }
  const ts = e.target.closest("[data-toggle-session]");
  if (ts) {
    const s = sessions.find((x) => String(x.id) === ts.dataset.toggleSession);
    const { error } = await sb.from("sessions").update({ active: !s.active }).eq("id", s.id);
    if (error) return toast(error.message, "error");
    await reload(); renderSessions();
  }
});

$("#sess-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await sb.from("sessions").insert({ label: $("#n-label").value.trim(), sort_order: Number($("#n-order").value) });
  if (error) return toast(error.message, "error");
  $("#n-label").value = "";
  await reload(); renderSessions();
});

init();
