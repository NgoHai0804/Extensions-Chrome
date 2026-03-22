import { initAccountSection } from "./accountSection.js";
import { initCountryListSection } from "./countryListSection.js";
import { initCountryDetailSection } from "./countryDetailSection.js";
import { getCountries } from "./api.js";

document.addEventListener("DOMContentLoaded", () => {
  initAccountSection();

  const detail = initCountryDetailSection();

  initCountryListSection(
    (country) => {
      if (detail) {
        detail.showCountry(country);
      }
    },
    () =>
      getCountries().then((resp) => {
        return resp.countries || [];
      })
  );
});

