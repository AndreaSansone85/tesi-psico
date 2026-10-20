// Tema chiaro/scuro. Senza scelta salvata si segue il sistema; con il pulsante la scelta resta nel browser.
(function () {
  var root = document.documentElement;
  function stored() { try { return localStorage.getItem("theme"); } catch (e) { return null; } }
  function save(v) { try { localStorage.setItem("theme", v); } catch (e) { /* ignorato */ } }
  var s = stored();
  if (s === "light" || s === "dark") root.setAttribute("data-theme", s);

  function current() {
    var t = root.getAttribute("data-theme");
    if (t) return t;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function label(btn) {
    var dark = current() === "dark";
    btn.textContent = dark ? "Tema chiaro" : "Tema scuro";
    btn.setAttribute("aria-label", dark ? "Passa al tema chiaro" : "Passa al tema scuro");
  }
  document.addEventListener("DOMContentLoaded", function () {
    var nav = document.querySelector("header.top nav");
    if (!nav) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-toggle";
    label(btn);
    btn.addEventListener("click", function () {
      var next = current() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      save(next);
      label(btn);
    });
    nav.appendChild(btn);
  });
})();
