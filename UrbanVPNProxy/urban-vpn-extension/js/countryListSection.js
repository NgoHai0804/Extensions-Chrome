function getFlagUrl(iso2) {
  if (!iso2 || iso2.length !== 2) return null;
  return `https://flagcdn.com/w320/${iso2.toLowerCase()}.png`;
}

function renderCountryList(container, countries, onSelectCountry) {
  container.innerHTML = "";

  if (!countries || countries.length === 0) {
    container.textContent = "Chưa có dữ liệu quốc gia.";
    return;
  }

  const sorted = [...countries].sort((a, b) => {
    const nameA = (a.title || a.iso2 || "").toUpperCase();
    const nameB = (b.title || b.iso2 || "").toUpperCase();
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return 0;
  });

  sorted.forEach((c) => {
    const row = document.createElement("div");
    row.className = "country-row";

    const flagWrapper = document.createElement("div");
    flagWrapper.className = "country-flag-wrapper";

    const flagUrl = getFlagUrl(c.iso2);
    if (flagUrl) {
      const img = document.createElement("img");
      img.className = "country-flag-img";
      img.src = flagUrl;
      img.alt = c.iso2 || "";
      flagWrapper.appendChild(img);
    }

    const info = document.createElement("div");
    info.className = "country-info";

    const titleRow = document.createElement("div");
    titleRow.className = "country-title-row";

    const nameSpan = document.createElement("span");
    nameSpan.className = "country-name";
    nameSpan.textContent = `${c.title || "Unknown"} (${c.iso2})`;

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = c.accessType || "UNKNOWN";

    titleRow.appendChild(nameSpan);
    titleRow.appendChild(badge);

    const serversRow = document.createElement("div");
    serversRow.className = "country-servers";
    const topup = c.servers || [];
    const count = topup.length > 0 ? topup.length : (c.serversCount ?? 0);
    serversRow.textContent = `Servers: ${count}`;

    info.appendChild(titleRow);
    info.appendChild(serversRow);

    row.appendChild(flagWrapper);
    row.appendChild(info);

    row.addEventListener("click", () => onSelectCountry(c));

    container.appendChild(row);
  });
}

export function initCountryListSection(onSelectCountry, fetchCountries) {
  const header = document.getElementById("countryDropdownHeader");
  const nameEl = document.getElementById("countryDropdownName");
  const flagImg = document.getElementById("countryDropdownFlag");
  const container = document.getElementById("countriesContainer");
  const statusEl = document.getElementById("countriesStatus");
  const panel = document.getElementById("countriesPanel");
  const searchInput = document.getElementById("countriesSearch");

  if (!header || !container || !panel) return;

  let cachedCountries = null;
  let currentFiltered = null;

  function applySearchAndRender() {
    if (!cachedCountries) return;
    const q = (searchInput && searchInput.value.trim().toLowerCase()) || "";
    let list = cachedCountries;
    if (q) {
      list = cachedCountries.filter((c) => {
        const name = (c.title || "").toLowerCase();
        const iso2 = (c.iso2 || "").toLowerCase();
        const iso3 = (c.iso3 || "").toLowerCase();
        return (
          name.includes(q) || iso2.includes(q) || iso3.includes(q)
        );
      });
    }
    currentFiltered = list;
    renderCountryList(container, list, handleSelect);
    if (statusEl) {
      const total = cachedCountries.length;
      const shown = list.length;
      statusEl.textContent =
        q && shown !== total
          ? `Có ${shown}/${total} quốc gia.`
          : `Có ${total} quốc gia.`;
    }
  }

  function handleSelect(country) {
    const flagUrl = getFlagUrl(country.iso2);
    if (nameEl) {
      nameEl.textContent = country.title || country.iso2;
    }
    if (flagImg) {
      if (flagUrl) {
        flagImg.src = flagUrl;
        flagImg.style.visibility = "visible";
      } else {
        flagImg.src = "";
        flagImg.style.visibility = "hidden";
      }
    }
    panel.classList.add("collapsed");
    header.classList.remove("open");
    onSelectCountry(country);
  }

  header.addEventListener("click", () => {
    const wasCollapsed = panel.classList.contains("collapsed");

    if (!wasCollapsed) {
      // đang mở -> thu lại, không fetch
      panel.classList.add("collapsed");
      header.classList.remove("open");
      return;
    }

    // đang đóng -> mở ra và fetch
    panel.classList.remove("collapsed");
    header.classList.add("open");

    if (cachedCountries) {
      applySearchAndRender();
      return;
    }

    if (statusEl) statusEl.textContent = "Đang lấy danh sách quốc gia...";
    container.textContent = "";

    fetchCountries()
      .then((countries) => {
        cachedCountries = countries;
        applySearchAndRender();
      })
      .catch((err) => {
        if (statusEl)
          statusEl.textContent = "Lỗi lấy danh sách nước: " + err.message;
      });
  });

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      applySearchAndRender();
    });
  }
}

