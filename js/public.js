import { sb, esc, $, badge, toast, loadStats, renderStats, uploadPdf, levelBadge, levelSlots } from "./common.js";
import { TURNSTILE_SITE_KEY } from "./config.js";

let teachers = [];
let sessions = [];
let theses = [];

// ---------- routing ----------
function route() {
  const nuova = location.hash === "#/nuova";
  $("#view-archivio").classList.toggle("hidden", nuova);
  $("#view-nuova").classList.toggle("hidden", !nuova);
  $("#nav-archivio").classList.toggle("active", !nuova);
  $("#nav-nuova").classList.toggle("active", nuova);
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

// ---------- dati ----------
async function loadAll() {
  const [t, s, th] = await Promise.all([
    sb.from("public_teachers").select("*").order("full_name"),
    sb.from("sessions").select("*").eq("active", true).order("sort_order"),
    sb.from("theses")
      .select("id, first_name, last_name, title, abstract, degree_level, teacher_id, session_id, status, created_at")
      .order("created_at", { ascending: false }),
  ]);
  for (const r of [t, s, th]) if (r.error) throw r.error;
  teachers = t.data;
  sessions = s.data;
  theses = th.data;
}

function fillSelect(sel, items, valueKey, labelKey) {
  const first = sel.options[0];
  sel.innerHTML = "";
  sel.appendChild(first);
  for (const it of items) {
    const o = document.createElement("option");
    o.value = it[valueKey];
    o.textContent = it[labelKey];
    sel.appendChild(o);
  }
}

// ---------- archivio ----------
function renderList() {
  const q = $("#f-text").value.trim().toLowerCase();
  const fL = $("#f-level").value;
  const fT = $("#f-teacher").value;
  const fS = $("#f-session").value;
  const fSt = $("#f-status").value;
  const tName = Object.fromEntries(teachers.map((t) => [t.id, t.full_name]));
  const sName = Object.fromEntries(sessions.map((s) => [s.id, s.label]));

  const rows = theses.filter((t) => {
    if (fL && t.degree_level !== fL) return false;
    if (fT && t.teacher_id !== fT) return false;
    if (fS && String(t.session_id) !== fS) return false;
    if (fSt && t.status !== fSt) return false;
    if (q) {
      const hay = `${t.title ?? ""} ${t.abstract} ${t.first_name} ${t.last_name}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  $("#list").innerHTML = rows.length
    ? rows
        .map(
          (t) => `
      <article class="card thesis">
        <div class="head">${levelBadge(t.degree_level)}<h4>${t.title ? esc(t.title) : '<span class="meta">Titolo da definire</span>'}</h4></div>
        <div class="meta">${esc(t.last_name)} ${esc(t.first_name)} · Relatore: ${esc(tName[t.teacher_id] ?? "n.d.")} ·
          Sessione ${esc(sName[t.session_id] ?? "n.d.")} · ${badge(t.status)}</div>
        <details><summary class="meta">Descrizione della richiesta</summary><p class="abstract">${esc(t.abstract)}</p></details>
      </article>`,
        )
        .join("")
    : `<p class="meta">Nessuna richiesta corrisponde ai filtri.</p>`;
}

let statsTeachers = [];

// Il docente non è selezionabile se i posti del livello scelto sono esauriti.
function renderTeacherOptions() {
  const level = $("#level").value;
  const current = $("#teacher").value;
  const first = $("#teacher").options[0];
  $("#teacher").innerHTML = "";
  $("#teacher").appendChild(first);
  for (const t of statsTeachers) {
    const o = document.createElement("option");
    o.value = t.id;
    const full = level ? levelSlots(t, level).full : false;
    o.textContent = full ? `${t.full_name} (posti esauriti per la tesi ${level})` : t.full_name;
    o.disabled = full;
    $("#teacher").appendChild(o);
  }
  $("#teacher").value = [...$("#teacher").options].some((o) => o.value === current && !o.disabled) ? current : "";
}

async function refreshStats() {
  const stats = await loadStats();
  statsTeachers = stats.teachers;
  renderStats($("#stats"), stats);
  renderTeacherOptions();
}

// ---------- Turnstile (facoltativo) ----------
let turnstileWidget = null;
function setupTurnstile() {
  if (!TURNSTILE_SITE_KEY) return;
  const s = document.createElement("script");
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  s.async = true;
  s.onload = () => { turnstileWidget = window.turnstile.render("#turnstile", { sitekey: TURNSTILE_SITE_KEY }); };
  document.head.appendChild(s);
}

async function errorMessage(error) {
  try {
    const body = await error.context.json();
    if (body?.error) return body.error;
  } catch { /* nessun corpo leggibile */ }
  return error.message || "Invio non riuscito.";
}

// ---------- form ----------
let simTimer;
function checkSimilar() {
  clearTimeout(simTimer);
  simTimer = setTimeout(async () => {
    const title = $("#title").value.trim();
    const box = $("#similar");
    if (title.length < 8) { box.innerHTML = ""; return; }
    const { data } = await sb.rpc("similar_titles", { p_title: title });
    box.innerHTML = data?.length
      ? `<div class="notice"><strong>Esistono già titoli simili in archivio:</strong><ul>${data
          .map((d) => `<li>${esc(d.title)} (${esc(d.last_name)} ${esc(d.first_name)}, ${esc(d.teacher_name)})</li>`)
          .join("")}</ul>Verifica di non proporre un progetto doppione.</div>`
      : "";
  }, 500);
}

async function submitForm(e) {
  e.preventDefault();
  if ($("#website").value) return; // honeypot
  const form = $("#form");
  if (!form.reportValidity()) return;

  const btn = $("#submit");
  btn.disabled = true;

  let attachmentPath = null;
  try {
    attachmentPath = await uploadPdf($("#attachment").files[0]);
  } catch (err) {
    btn.disabled = false;
    return toast(err.message, "error");
  }

  const payload = {
    p_first_name: $("#first_name").value,
    p_last_name: $("#last_name").value,
    p_matricola: $("#matricola").value,
    p_email: $("#email").value,
    p_phone: $("#phone").value,
    p_teacher_id: $("#teacher").value,
    p_session_id: Number($("#session").value),
    p_title: $("#title").value.trim() || null,
    p_abstract: $("#abstract").value,
    p_degree_level: $("#level").value,
    p_attachment_path: attachmentPath,
  };

  let errMsg = null;
  if (TURNSTILE_SITE_KEY) {
    const token = window.turnstile?.getResponse(turnstileWidget);
    if (!token) { btn.disabled = false; return toast("Completa la verifica antispam.", "error"); }
    const { error } = await sb.functions.invoke("submit-thesis", { body: { ...payload, turnstileToken: token } });
    if (error) errMsg = await errorMessage(error);
    window.turnstile?.reset(turnstileWidget);
  } else {
    const { error } = await sb.rpc("submit_thesis", payload);
    if (error) errMsg = error.message;
  }
  btn.disabled = false;

  if (errMsg) {
    toast(errMsg, "error");
    return;
  }
  form.reset();
  $("#abs-count").textContent = "0";
  $("#similar").innerHTML = "";
  form.classList.add("hidden");
  const done = $("#done");
  done.classList.remove("hidden");
  done.innerHTML = `<strong>Richiesta registrata.</strong> Il docente la valuterà e riceverai una email con l'esito.
    Per modificare o ritirare la richiesta, ad esempio per cambiare sessione, contatta direttamente il docente.
    <div class="actions"><a class="btn secondary" href="#/archivio">Vai all'archivio</a></div>`;
  await loadAll();
  renderList();
  refreshStats();
}

// ---------- init ----------
async function init() {
  route();
  setupTurnstile();
  $("#footer").textContent = "I dati di contatto degli studenti sono conservati in un'area riservata e consultabili solo dai docenti interessati e dagli amministratori.";
  try {
    await loadAll();
    fillSelect($("#f-teacher"), teachers, "id", "full_name");
    fillSelect($("#f-session"), sessions, "id", "label");
    fillSelect($("#session"), sessions, "id", "label");
    renderList();
    await refreshStats();
  } catch (e) {
    console.error(e);
    $("#list").innerHTML = `<div class="notice">Impossibile caricare i dati. Controlla la configurazione in js/config.js.</div>`;
  }

  for (const id of ["#f-text", "#f-level", "#f-teacher", "#f-session", "#f-status"]) {
    $(id).addEventListener("input", renderList);
  }
  $("#title").addEventListener("input", checkSimilar);
  $("#level").addEventListener("change", renderTeacherOptions);
  $("#abstract").addEventListener("input", () => ($("#abs-count").textContent = $("#abstract").value.length));
  $("#form").addEventListener("submit", submitForm);
  window.addEventListener("hashchange", () => {
    if (location.hash === "#/nuova") {
      $("#done").classList.add("hidden");
      $("#form").classList.remove("hidden");
    }
  });
}
init();
