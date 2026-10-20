import { sb, esc, $, badge, toast, loadStats, renderStats, uploadPdf, levelBadge, levelSlots } from "./common.js?v=3";

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
  const fT = $("#f-teacher").value.trim();
  const okTeachers = fT ? new Set(teachers.filter((t) => teacherMatches(t, fT)).map((t) => t.id)) : null;
  const fS = $("#f-session").value;
  const fSt = $("#f-status").value;
  const tName = Object.fromEntries(teachers.map((t) => [t.id, t.full_name]));
  const sName = Object.fromEntries(sessions.map((s) => [s.id, s.label]));

  const rows = theses.filter((t) => {
    if (fL && t.degree_level !== fL) return false;
    if (okTeachers && !okTeachers.has(t.teacher_id)) return false;
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

// ---------- docente con completamento automatico ----------
let comboItems = [];
let comboActive = -1;

const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Ogni parola scritta deve essere l'inizio di una parola del nome ("sans" trova "Prof. Andrea Sansone").
function teacherMatches(t, query) {
  const words = norm(t.full_name).split(/[^a-z0-9]+/).filter(Boolean);
  const tokens = norm(query).split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.every((tok) => words.some((w) => w.startsWith(tok)));
}

function setTeacherValidity() {
  $("#teacher-input").setCustomValidity($("#teacher").value ? "" : "Seleziona un docente dall'elenco dei suggerimenti.");
}

function openList(on) {
  $("#teacher-list").classList.toggle("hidden", !on);
  $("#teacher-input").setAttribute("aria-expanded", String(on));
}

function highlight() {
  document.querySelectorAll("#teacher-list li[role=option]").forEach((li) => li.setAttribute("aria-selected", String(Number(li.dataset.i) === comboActive)));
  const input = $("#teacher-input");
  if (comboActive >= 0) {
    input.setAttribute("aria-activedescendant", `teacher-opt-${comboActive}`);
    $(`#teacher-opt-${comboActive}`)?.scrollIntoView({ block: "nearest" });
  } else {
    input.removeAttribute("aria-activedescendant");
  }
}

function renderTeacherList() {
  const level = $("#level").value;
  comboItems = statsTeachers
    .filter((t) => teacherMatches(t, $("#teacher-input").value))
    .map((t) => ({ t, full: level ? levelSlots(t, level).full : false }));
  $("#teacher-list").innerHTML = comboItems.length
    ? comboItems
        .map((it, i) => `<li role="option" id="teacher-opt-${i}" data-i="${i}" class="${it.full ? "disabled" : ""}" aria-disabled="${it.full}">${esc(it.t.full_name)}${it.full ? ` <span class="meta">(posti esauriti per la tesi ${esc(level)})</span>` : ""}</li>`)
        .join("")
    : `<li class="empty">Nessun docente trovato</li>`;
  comboActive = comboItems.findIndex((it) => !it.full);
  highlight();
}

function selectTeacher(i) {
  const it = comboItems[i];
  if (!it || it.full) return;
  $("#teacher").value = it.t.id;
  $("#teacher-input").value = it.t.full_name;
  setTeacherValidity();
  openList(false);
}

function moveActive(step) {
  if (!comboItems.some((it) => !it.full)) return;
  let i = comboActive;
  do { i = (i + step + comboItems.length) % comboItems.length; } while (comboItems[i].full);
  comboActive = i;
  highlight();
}

function setupTeacherCombo() {
  const input = $("#teacher-input");
  setTeacherValidity();
  input.addEventListener("focus", () => { renderTeacherList(); openList(true); });
  input.addEventListener("input", () => {
    $("#teacher").value = "";   // la scelta vale solo se fatta dai suggerimenti
    setTeacherValidity();
    renderTeacherList();
    openList(true);
  });
  input.addEventListener("blur", () => openList(false));
  input.addEventListener("keydown", (e) => {
    const open = !$("#teacher-list").classList.contains("hidden");
    if (e.key === "ArrowDown") { e.preventDefault(); if (!open) { renderTeacherList(); openList(true); } else moveActive(1); }
    else if (e.key === "ArrowUp" && open) { e.preventDefault(); moveActive(-1); }
    else if (e.key === "Enter" && open) { e.preventDefault(); selectTeacher(comboActive); }
    else if (e.key === "Escape" && open) { e.preventDefault(); openList(false); }
  });
  // mousedown anziché click: avviene prima che il campo perda il focus
  $("#teacher-list").addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-i]");
    e.preventDefault();
    if (li) selectTeacher(Number(li.dataset.i));
  });
}

// Filtro docente nell'archivio: stesso completamento automatico, ma senza obbligo di scelta.
function setupFilterCombo() {
  const input = $("#f-teacher"), list = $("#f-teacher-list");
  let items = [], active = -1;
  const open = (on) => { list.classList.toggle("hidden", !on); input.setAttribute("aria-expanded", String(on)); };
  const mark = () => {
    list.querySelectorAll("li[role=option]").forEach((li) => li.setAttribute("aria-selected", String(Number(li.dataset.i) === active)));
    if (active >= 0) { input.setAttribute("aria-activedescendant", `f-opt-${active}`); $(`#f-opt-${active}`)?.scrollIntoView({ block: "nearest" }); }
    else input.removeAttribute("aria-activedescendant");
  };
  const render = () => {
    items = teachers.filter((t) => teacherMatches(t, input.value));
    list.innerHTML = items.length
      ? items.map((t, i) => `<li role="option" id="f-opt-${i}" data-i="${i}">${esc(t.full_name)}</li>`).join("")
      : `<li class="empty">Nessun docente trovato</li>`;
    active = -1;
    mark();
  };
  const pick = (i) => {
    if (!items[i]) return;
    input.value = items[i].full_name;
    open(false);
    renderList();
  };
  input.addEventListener("focus", () => { render(); open(true); });
  input.addEventListener("input", () => { render(); open(true); });
  input.addEventListener("blur", () => open(false));
  input.addEventListener("keydown", (e) => {
    const isOpen = !list.classList.contains("hidden");
    if (e.key === "ArrowDown") { e.preventDefault(); if (!isOpen) { render(); open(true); } else if (items.length) { active = (active + 1) % items.length; mark(); } }
    else if (e.key === "ArrowUp" && isOpen && items.length) { e.preventDefault(); active = (active - 1 + items.length) % items.length; mark(); }
    else if (e.key === "Enter" && isOpen && active >= 0) { e.preventDefault(); pick(active); }
    else if (e.key === "Escape" && isOpen) { e.preventDefault(); open(false); }
  });
  list.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const li = e.target.closest("li[data-i]");
    if (li) pick(Number(li.dataset.i));
  });
}

// Se cambia il tipo di tesi o il numero di posti, una scelta già fatta può non essere più valida.
function syncTeacherSelection() {
  const id = $("#teacher").value;
  if (id) {
    const t = statsTeachers.find((x) => x.id === id);
    const level = $("#level").value;
    if (!t || (level && levelSlots(t, level).full)) {
      $("#teacher").value = "";
      $("#teacher-input").value = "";
      toast("Il docente scelto non ha posti disponibili per questo tipo di tesi: scegline un altro.", "error");
    }
  }
  setTeacherValidity();
  renderTeacherList();
}

async function refreshStats() {
  const stats = await loadStats();
  statsTeachers = stats.teachers;
  renderStats($("#stats"), stats);
  syncTeacherSelection();
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

  const { error } = await sb.rpc("submit_thesis", payload);
  const errMsg = error ? error.message : null;
  btn.disabled = false;

  if (errMsg) {
    toast(errMsg, "error");
    return;
  }
  form.reset();
  $("#teacher").value = "";
  setTeacherValidity();
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
  $("#footer").innerHTML = 'I dati di contatto degli studenti sono conservati in un\'area riservata e consultabili solo dai docenti interessati e dagli amministratori. <a href="privacy.html">Informativa privacy</a>';
  try {
    await loadAll();
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
  $("#level").addEventListener("change", syncTeacherSelection);
  setupTeacherCombo();
  setupFilterCombo();
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
