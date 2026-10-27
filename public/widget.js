(function () {
  "use strict";
  var script = document.currentScript;
  if (!script) return;
  var config = script.dataset;
  var endpoint = new URL(config.endpoint || "api/telegram-id", script.src || document.baseURI).href;
  var selector = config.usernameSelector || 'input[name="telegram_username"]';
  var idName = config.idName || "telegram_id";
  var idSelector = config.idSelector;
  var submitSelector = config.submitSelector || 'button[type="submit"],input[type="submit"],button:not([type]),[data-tgid-submit]';
  var required = config.required !== "false";
  var attached = new WeakSet();

  function normalize(value) {
    var text = value.trim();
    var link = text.match(/^(?:https?:\/\/)?(?:www\.)?t\.me\/([a-z0-9_]+)\/?$/i);
    text = link ? link[1] : text.replace(/^@/, "");
    return /^[a-z][a-z0-9_]{0,31}$/i.test(text) ? text.toLowerCase() : "";
  }

  function attach(input) {
    var form = input.form || input.closest("form");
    if (!form || attached.has(input)) return;
    var hidden = idSelector ? form.querySelector(idSelector) : Array.from(form.elements).find(function (el) {
      return el.name === idName && el.type === "hidden";
    });
    // A configured CRM field must exist: an arbitrary hidden field is not a substitute.
    if (idSelector && !hidden) return;
    attached.add(input);
    if (!hidden) {
      hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.name = idName;
      form.appendChild(hidden);
    }
    var status = document.createElement("span");
    status.className = "tgid-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.style.display = "block";
    // Keep the button still when blur starts lookup between mouse down and up.
    status.style.minHeight = "1.5em";
    status.style.lineHeight = "1.5";
    input.insertAdjacentElement("afterend", status);
    var revision = 0;
    var verified = "";
    var active = null;
    var pending = null;
    var pendingName = "";
    var resuming = false;

    function setId(value) {
      hidden.value = value;
      hidden.dispatchEvent(new Event("input", { bubbles: true }));
      hidden.dispatchEvent(new Event("change", { bubbles: true }));
    }
    function emit(state, extra) {
      input.dataset.tgidState = state;
      input.dispatchEvent(new CustomEvent("tgid:change", {
        bubbles: true,
        detail: Object.assign({ state: state, telegram_id: hidden.value }, extra),
      }));
    }
    function invalidate() {
      revision++;
      verified = "";
      if (active) active.abort();
      active = null;
      pending = null;
      pendingName = "";
      input.removeAttribute("aria-busy");
      setId("");
      status.textContent = "";
      emit("idle");
    }
    invalidate();

    async function resolve() {
      var name = normalize(input.value);
      if (name && verified === name && hidden.value) return true;
      if (pending && name === pendingName) return pending;
      if (!name) {
        invalidate();
        status.textContent = "Введите @username или ссылку t.me/username.";
        emit("invalid");
        return false;
      }
      if (active) active.abort();
      var ticket = ++revision;
      var controller = new AbortController();
      active = controller;
      pendingName = name;
      verified = "";
      setId("");
      status.textContent = "Ищем Telegram…";
      input.setAttribute("aria-busy", "true");
      emit("loading");
      var timer = setTimeout(function () { controller.abort(); }, 35000);

      pending = (async function () {
        try {
          var response = await fetch(endpoint, {
            method: "POST",
            mode: "cors",
            credentials: "omit",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: name }),
            signal: controller.signal,
          });
          var data = await response.json();
          if (ticket !== revision || normalize(input.value) !== name) return false;
          if (!response.ok) throw new Error(data.error || "Не удалось найти аккаунт.");
          if (!/^\d+$/.test(data.telegram_id) || data.username !== name) {
            throw new Error("Сервис вернул некорректный ответ.");
          }
          verified = name;
          setId(data.telegram_id);
          status.textContent = "Аккаунт найден.";
          emit("success", { username: name });
          return true;
        } catch (error) {
          if (ticket !== revision) return false;
          setId("");
          status.textContent = error.name === "AbortError"
            ? "Поиск занял слишком много времени. Повторите попытку."
            : (error instanceof TypeError ? "Сервис поиска недоступен. Повторите позже." : error.message);
          emit("error");
          return false;
        } finally {
          clearTimeout(timer);
          if (ticket === revision) {
            input.removeAttribute("aria-busy");
            pending = null;
            pendingName = "";
            active = null;
          }
        }
      })();
      return pending;
    }

    input.addEventListener("input", invalidate);
    input.addEventListener("change", function () {
      var name = normalize(input.value);
      // Some builders fire change after blur/click. Keep an identical lookup alive.
      if (verified !== name && pendingName !== name) invalidate();
      if (input.value.trim()) void resolve();
    });
    input.addEventListener("blur", function () {
      if (input.value.trim()) void resolve();
    });
    // Lookup on leaving the field avoids sending a request for every keystroke.
    async function guard(event, replay) {
      if (resuming) return;
      if (verified && verified !== normalize(input.value)) invalidate();
      if (verified && hidden.value) return;
      if (!required) {
        // Optional mode may submit an empty ID; never submits a known stale ID.
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (form.dataset.tgidSubmitting === "true") return;
      form.dataset.tgidSubmitting = "true";
      try {
        if (await resolve()) {
          // Resume in a new task: native click activation may still be in progress.
          await new Promise(function (done) { setTimeout(done, 0); });
          if (verified !== normalize(input.value) || !hidden.value) return;
          resuming = true;
          try { replay(); } finally { resuming = false; }
        } else { input.focus(); }
      } finally { delete form.dataset.tgidSubmitting; }
    }
    // Builders may send AJAX directly from click handlers, before a submit event.
    form.addEventListener("click", function (event) {
      var button = event.target.closest(submitSelector);
      if (!button || !form.contains(button)) return;
      void guard(event, function () {
        if (button.isConnected && !button.disabled) button.click();
      });
    }, true);
    form.addEventListener("submit", function (event) {
      var submitter = event.submitter;
      void guard(event, function () {
        if (submitter && submitter.form === form && !submitter.disabled) {
          form.requestSubmit(submitter);
        } else { form.requestSubmit(); }
      });
    }, true);
    form.addEventListener("reset", function () { invalidate(); });
  }

  function scan() {
    if (!window.document) return;
    try { document.querySelectorAll(selector).forEach(attach); }
    catch (_) { console.error("Telegram ID: неверный data-username-selector."); }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scan, { once: true });
  } else { scan(); }
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
})();
