import { mountToday } from "./today.js";
import { mountHistory } from "./history.js";
import { mountChat } from "./chat.js";

const tabs = document.querySelectorAll("nav#tabs .tab");
const views = {
  today: document.getElementById("view-today"),
  history: document.getElementById("view-history"),
};

function show(name) {
  for (const v of Object.values(views)) { v.classList.remove("active"); v.hidden = true; }
  views[name].classList.add("active"); views[name].hidden = false;
  for (const t of tabs) t.classList.toggle("active", t.dataset.view === name);
}

for (const t of tabs) t.addEventListener("click", () => show(t.dataset.view));

mountToday(views.today);
mountHistory(views.history);
mountChat();

show("today");
