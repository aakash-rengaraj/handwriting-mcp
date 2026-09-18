// Bottom toast with a progress bar + cancel for long bulk runs.
const el = document.createElement("div");
el.className = "progress-toast";
el.hidden = true;
el.setAttribute("role", "status");
el.innerHTML = `
  <div class="pt-top"><span class="pt-label"></span><span class="pt-count"></span></div>
  <div class="pt-bar"><div class="pt-fill"></div></div>
  <div class="pt-actions"><span class="pt-error"></span><button type="button" class="btn small pt-cancel">Cancel</button></div>`;

let active = null;

function ensureMounted() {
  if (!el.isConnected) document.body.appendChild(el);
}

export const progress = {
  get busy() {
    return !!active;
  },
  start(label, total) {
    ensureMounted();
    const task = {
      cancelled: false,
      step(n) {
        el.querySelector(".pt-count").textContent = `${n} / ${total}`;
        el.querySelector(".pt-fill").style.width = `${total ? (n / total) * 100 : 100}%`;
      },
      fail(err) {
        console.error(err);
        el.querySelector(".pt-error").textContent = err?.message || String(err);
        task.failed = true;
      },
      done() {
        if (active !== task) return;
        active = null;
        document.body.classList.remove("is-busy");
        if (task.failed) {
          el.querySelector(".pt-cancel").textContent = "Close";
          return;
        }
        setTimeout(() => (el.hidden = true), task.cancelled ? 0 : 900);
      },
    };
    active = task;
    document.body.classList.add("is-busy");
    el.querySelector(".pt-label").textContent = label;
    el.querySelector(".pt-error").textContent = "";
    el.querySelector(".pt-cancel").textContent = "Cancel";
    task.step(0);
    el.hidden = false;
    return task;
  },
};

el.querySelector(".pt-cancel").addEventListener("click", () => {
  if (active) active.cancelled = true;
  el.hidden = true;
});
