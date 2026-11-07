/**
 * New-entry window of the chart plotter extension: the same fields as
 * the webapp's entry editor, submitting through the resources API on the
 * user's own session — a shortcut for writing a line from apps like
 * Freeboard-SK, not a replacement for the Logbook webapp. Entries dated
 * to "now" get their telemetry (position, speeds, wind, engine hours)
 * filled by the provider's enrichment, exactly like quick entries from
 * the webapp. Night mode follows the host over the extension bus; the
 * form also works standalone in a plain browser tab.
 *
 * @file plotterext/newentry.js
 */

import { connectExtension } from "./vendor/plotterext-bus.js";
import {
  AGO_CHOICES,
  buildEntryPayload,
  FIX_TYPES,
  SEA_STATES,
  VISIBILITY,
} from "./view.js";

const ENTRIES_URL = "/signalk/v2/api/resources/logentries";

/** Element references cached once, updated in place. */
const els = {
  text: document.getElementById("text"),
  when: document.getElementById("when"),
  datetimeField: document.getElementById("datetime-field"),
  datetime: document.getElementById("datetime"),
  category: document.getElementById("category"),
  vhfField: document.getElementById("vhf-field"),
  vhf: document.getElementById("vhf"),
  observationsGroup: document.getElementById("observations-group"),
  seaState: document.getElementById("sea-state"),
  cloudCoverage: document.getElementById("cloud-coverage"),
  cloudReadout: document.getElementById("cloud-readout"),
  visibility: document.getElementById("visibility"),
  positionGroup: document.getElementById("position-group"),
  latitude: document.getElementById("latitude"),
  longitude: document.getElementById("longitude"),
  fixType: document.getElementById("fix-type"),
  save: document.getElementById("save"),
  message: document.getElementById("message"),
};

/** The draft, in the same shapes the webapp editor uses. */
const form = {
  text: "",
  when: "0",
  datetime: "",
  category: "navigation",
  vhf: "",
  seaState: -1,
  cloudCoverage: -1,
  visibility: -1,
  latitude: "",
  longitude: "",
  fixType: "",
};

let saving = false;

/**
 * Local wall-clock now as a datetime-local value, so the specific-time
 * field opens at the current minute. On a plotter the device clock is
 * ship time, matching how the value is parsed back.
 */
function datetimeLocalNow() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** @param {string} text @param {"ok"|"error"|""} [kind] */
function showMessage(text, kind = "") {
  els.message.textContent = text;
  els.message.className = kind ? `message ${kind}` : "message";
}

/** @param {Response} res */
function failureText(res) {
  return res.status === 401 || res.status === 403
    ? "Writing log entries needs a logged-in user with write access."
    : `Saving failed (HTTP ${res.status}).`;
}

/** Builds one radiogroup of choice buttons. */
function buildChoices(container, choices, current, onPick) {
  const buttons = choices.map(([value, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "radio");
    button.textContent = label;
    button.addEventListener("click", () => onPick(value));
    container.append(button);
    return { value, button };
  });
  const render = () => {
    for (const { value, button } of buttons) {
      button.setAttribute("aria-checked", String(value === current()));
    }
  };
  container.dataset.columns = String(choices.length);
  render();
  return render;
}

/**
 * Fills a select with a "no observation" option (value -1) followed by
 * the coded vocabulary, mirroring the webapp editor's model.
 */
function buildObservationSelect(select, entries, current, onPick) {
  const none = document.createElement("option");
  none.value = "-1";
  none.textContent = "No observation";
  select.append(none);
  entries.forEach((label, code) => {
    const option = document.createElement("option");
    option.value = String(code);
    option.textContent = label;
    select.append(option);
  });
  select.value = String(current());
  select.addEventListener("change", () => {
    onPick(Number.parseInt(select.value, 10));
  });
}

/** Fills the fix-type select, empty value = no manual fix recorded. */
function buildFixTypeSelect(select, onPick) {
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "No fix";
  select.append(none);
  FIX_TYPES.forEach((fix) => {
    const option = document.createElement("option");
    option.value = fix;
    option.textContent = fix;
    select.append(option);
  });
  select.addEventListener("change", () => {
    onPick(select.value);
  });
}

/** The position and observations groups only apply to navigation. */
function renderCategory() {
  const isNavigation = form.category === "navigation";
  const isRadio = form.category === "radio";
  els.observationsGroup.hidden = !isNavigation;
  els.positionGroup.hidden = !isNavigation;
  els.vhfField.hidden = !isRadio;
}

const renderWhen = buildChoices(
  els.when,
  [
    ...AGO_CHOICES.map((ago) => [String(ago), ago === 0 ? "Now" : `${ago}m`]),
    ["specific", "Time"],
  ],
  () => form.when,
  (value) => {
    form.when = value;
    els.datetimeField.hidden = value !== "specific";
    if (value === "specific" && !els.datetime.value) {
      els.datetime.value = datetimeLocalNow();
    }
    renderWhen();
  },
);

const renderCategoryChoices = buildChoices(
  els.category,
  [
    ["navigation", "Nav"],
    ["engine", "Engine"],
    ["radio", "Radio"],
    ["maintenance", "Maint"],
  ],
  () => form.category,
  (value) => {
    form.category = value;
    renderCategory();
    renderCategoryChoices();
  },
);

els.text.addEventListener("input", () => {
  form.text = els.text.value;
});
els.datetime.addEventListener("input", () => {
  form.datetime = els.datetime.value;
});
els.vhf.addEventListener("input", () => {
  form.vhf = els.vhf.value;
});
els.latitude.addEventListener("input", () => {
  form.latitude = els.latitude.value;
});
els.longitude.addEventListener("input", () => {
  form.longitude = els.longitude.value;
});

buildObservationSelect(
  els.seaState,
  SEA_STATES,
  () => form.seaState,
  (code) => {
    form.seaState = code;
  },
);
buildObservationSelect(
  els.visibility,
  VISIBILITY,
  () => form.visibility,
  (code) => {
    form.visibility = code;
  },
);
els.cloudCoverage.addEventListener("input", () => {
  form.cloudCoverage = Number.parseInt(els.cloudCoverage.value, 10);
  els.cloudReadout.textContent =
    form.cloudCoverage >= 0 ? `${form.cloudCoverage}/8` : "n/a";
});

buildFixTypeSelect(els.fixType, (fix) => {
  form.fixType = fix;
});

async function save() {
  if (saving) return;
  saving = true;
  els.save.disabled = true;
  els.save.textContent = "Saving…";
  showMessage("");
  try {
    const payload = buildEntryPayload(form, new Date());
    const res = await fetch(ENTRIES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      showMessage(failureText(res), "error");
      return;
    }
    showMessage("Entry stored", "ok");
    // Fresh remarks for the next line; the rest of the draft (when the
    // entry was, category, observations) likely repeats entry to entry.
    form.text = "";
    els.text.value = "";
  } catch (err) {
    showMessage(`Saving failed: ${err.message}`, "error");
  } finally {
    saving = false;
    els.save.disabled = false;
    els.save.textContent = "Save entry";
  }
}
els.save.addEventListener("click", save);

// Night mode follows the host when one is present (the page is embedded
// in a plotter); standalone the day palette applies.
let host = null;
try {
  host = await connectExtension();
} catch {
  host = null;
}
if (host && host.hasCapability("nightMode")) {
  const applyNight = ({ enabled }) => {
    document.documentElement.dataset.mode = enabled ? "night" : "day";
  };
  await host.subscribe(["nightMode.changed"], (_name, params) => applyNight(params));
  applyNight(await host.call("nightMode.get"));
}
