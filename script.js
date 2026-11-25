const API_HOST = "https://api-hub-50046202742.development.catalystappsail.in";
const API_URL = API_HOST + "/api/pokeapi/v2";

const PANELS = ["pokemon", "species", "encounters", "evolution"];
const WAITING = {
  pokemon: "⏳ Loading…",
  species: "Waiting for Level 1…",
  encounters: "Waiting for Level 1…",
  evolution: "Waiting for Level 2…",
};

let choiceCount = 0;
let selected = null;
let controller = null;
let staleCount = 0;
let abortCount = 0;

async function getJson(path, choice) {
  choice.pending++;
  refreshSync();

  try {
    const response = await fetch(API_URL + path, { signal: choice.signal });
    if (!response.ok) {
      throw new Error("the server answered " + response.status);
    }
    return await response.json();
  } catch (error) {
    if (error.name === "AbortError") abortCount++;
    throw error;
  } finally {
    choice.pending--;
    refreshSync();
  }
}

function isFixed() {
  return document.querySelector('input[name="version"]:checked').value === "fixed";
}

function showVersion() {
  if (isFixed()) {
    document.body.className = "fixed";
    setText("version-note", "Fixed: a new pick aborts every request still running for the old one (AbortController).");
  } else {
    document.body.className = "broken";
    setText("version-note", "Broken: every answer is shown when it arrives, even one for a Pokémon you already left.");
  }
  staleCount = 0;
  abortCount = 0;
  refreshSync();
}

async function choosePokemon(query) {
  choiceCount++;
  const choice = { id: choiceCount, label: query.trim().toLowerCase(), pending: 0 };
  selected = choice;

  if (isFixed()) {
    if (controller) controller.abort();
    controller = new AbortController();
    choice.signal = controller.signal;
  }

  setText("selected", choice.label);
  resetPanels();

  try {
    const pokemon = await getJson("/pokemon/" + encodeURIComponent(choice.label), choice);
    choice.label = pokemon.name;
    if (choice === selected) setText("selected", pokemon.name);
    fill("pokemon", choice, pokemonHtml(pokemon));

    await Promise.all([
      speciesBranch(pokemon, choice),
      encountersBranch(pokemon, choice),
    ]);
  } catch (error) {
    if (error.name === "AbortError") return;
    fill("pokemon", choice, hint("⚠️ Could not load “" + esc(choice.label) + "”: " + esc(error.message)));
    for (const id of PANELS.slice(1)) fill(id, choice, hint("—"));
  }
}

async function speciesBranch(pokemon, choice) {
  try {
    const species = await getJson("/pokemon-species/" + pokemon.species.name, choice);
    fill("species", choice, speciesHtml(species));

    if (!species.evolution_chain) {
      fill("evolution", choice, hint("This Pokémon has no evolution chain."));
      return;
    }

    const chainId = lastSegment(species.evolution_chain.url);
    const evolution = await getJson("/evolution-chain/" + chainId, choice);
    fill("evolution", choice, evolutionHtml(evolution.chain, pokemon.species.name));
  } catch (error) {
    if (error.name === "AbortError") return;
    for (const id of ["species", "evolution"]) {
      if (document.getElementById(id).dataset.choice !== String(choice.id)) {
        fill(id, choice, hint("⚠️ Could not load: " + esc(error.message)));
      }
    }
  }
}

async function encountersBranch(pokemon, choice) {
  try {
    const encounters = await getJson("/pokemon/" + pokemon.id + "/encounters", choice);
    if (encounters.length === 0) {
      fill("encounters", choice, hint("Not found in the wild — you get this one another way (a starter, a gift, an evolution…)."));
    } else {
      fill("encounters", choice, encountersHtml(encounters));
    }
  } catch (error) {
    if (error.name === "AbortError") return;
    fill("encounters", choice, hint("⚠️ Could not load: " + esc(error.message)));
  }
}

function fill(panelId, choice, html) {
  const panel = document.getElementById(panelId);
  panel.innerHTML = html;
  panel.dataset.choice = choice.id;
  panel.dataset.label = choice.label;

  const stale = choice.id !== selected.id;
  if (stale) staleCount++;
  refreshSync();
}

function resetPanels() {
  for (const id of PANELS) {
    const panel = document.getElementById(id);
    panel.innerHTML = hint(WAITING[id]);
    delete panel.dataset.choice;
    delete panel.dataset.label;
  }
  refreshSync();
}

function refreshSync() {
  setText("stale-count", staleCount);
  setText("abort-count", abortCount);
  if (!selected) return;

  let wrong = 0;
  for (const id of PANELS) {
    const panel = document.getElementById(id);
    const owner = document.getElementById(id + "-owner");
    const filled = panel.dataset.choice !== undefined;
    const isWrong = filled && panel.dataset.choice !== String(selected.id);

    if (isWrong) wrong++;
    panel.classList.toggle("stale", isWrong);
    if (owner) {
      owner.textContent = filled ? "for " + panel.dataset.label : "";
      owner.className = "owner " + (isWrong ? "bad" : "ok");
    }
  }

  setText("shown", document.getElementById("pokemon").dataset.label || "—");

  if (wrong > 0) {
    setBadge("out", "❌ Out of sync: " + wrong + " panel" + (wrong === 1 ? " shows" : "s show") + " another Pokémon");
  } else if (selected.pending > 0) {
    setBadge("", "⏳ Loading…");
  } else {
    setBadge("sync", "✅ In sync");
  }
}

function pokemonHtml(p) {
  const types = p.types.map((t) => `<li>${t.type.name}</li>`).join("");
  const abilities = p.abilities.map((a) => `<li>${pretty(a.ability.name)}${a.is_hidden ? " (hidden)" : ""}</li>`).join("");
  const stats = p.stats.map((s) => `
    <span>${pretty(s.stat.name)}</span><b>${s.base_stat}</b>
    <div class="bar"><span style="width:${Math.min(100, (s.base_stat / 200) * 100)}%"></span></div>`).join("");

  return `
    <div class="card">
      <img src="${API_HOST}/api/pokeapi/sprite/${p.id}.png" alt="${p.name}">
      <div class="info">
        <h3>${p.name} <small>#${p.id}</small></h3>
        <ul class="chips">${types}</ul>
        <p class="hint">Height ${p.height / 10} m · Weight ${p.weight / 10} kg</p>
        <ul class="chips">${abilities}</ul>
        <div class="stats">${stats}</div>
      </div>
    </div>`;
}

function speciesHtml(s) {
  const genus = english(s.genera, "genus") || "";
  const text = (english(s.flavor_text_entries, "flavor_text") || "No Pokédex entry.").replace(/[\n\f\r]/g, " ");
  return `
    <p><b class="cap">${pretty(s.name)}</b> — ${genus}</p>
    <p>${text}</p>
    <ul class="chips">
      <li>${pretty(s.generation.name)}</li>
      <li>Habitat: ${s.habitat ? pretty(s.habitat.name) : "unknown"}</li>
      <li>Colour: ${s.color.name}</li>
      <li>Capture rate: ${s.capture_rate}</li>
    </ul>`;
}

function encountersHtml(list) {
  const areas = list.slice(0, 6).map((e) => {
    const versions = e.version_details.map((v) => v.version.name).slice(0, 3).join(", ");
    return `<li>${pretty(e.location_area.name)} <small class="hint">(${versions})</small></li>`;
  }).join("");
  return `
    <p>Found in <b>${list.length}</b> area${list.length === 1 ? "" : "s"}.</p>
    <ul class="chips">${areas}</ul>`;
}

function evolutionHtml(chain, current) {
  const stages = flattenChain(chain).map((s) => `
    <div>
      <img src="${API_HOST}/api/pokeapi/sprite/${s.id}.png" alt="">
      ${s.name === current ? `<b>${s.name}</b>` : s.name}
      <small>${s.how}</small>
    </div>`).join("");
  return `<div class="evo">${stages}</div>`;
}

function flattenChain(node, list = []) {
  const detail = (node.evolution_details || [])[0];
  let how = "first stage";
  if (detail) {
    if (detail.item) how = "use " + pretty(detail.item.name);
    else if (detail.min_level) how = "level " + detail.min_level;
    else how = pretty(detail.trigger.name);
  }
  list.push({ name: node.species.name, id: lastSegment(node.species.url), how });
  for (const next of node.evolves_to) flattenChain(next, list);
  return list;
}

function lastSegment(url) {
  return url.split("/").filter(Boolean).pop();
}

function english(entries, key) {
  const entry = (entries || []).find((e) => e.language.name === "en");
  return entry ? entry[key] : null;
}

function pretty(name) {
  return name.replace(/-/g, " ");
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
}

function hint(text) {
  return "<p class='hint'>" + text + "</p>";
}

function setText(id, text) {
  document.getElementById(id).textContent = text;
}

function setBadge(type, text) {
  const badge = document.getElementById("badge");
  badge.className = "badge " + type;
  badge.textContent = text;
}

document.getElementById("search-form").addEventListener("submit", function (event) {
  event.preventDefault();
  const text = document.getElementById("search-input").value.trim();
  if (text) choosePokemon(text);
});

for (const button of document.querySelectorAll(".pick")) {
  button.addEventListener("click", function () {
    choosePokemon(button.dataset.name);
  });
}

document.getElementById("race").addEventListener("click", function () {
  choosePokemon("pikachu");
  setTimeout(() => choosePokemon("fuecoco"), 700);
});

for (const radio of document.querySelectorAll('input[name="version"]')) {
  radio.addEventListener("change", showVersion);
}

showVersion();
