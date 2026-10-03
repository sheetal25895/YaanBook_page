# YaanBook

A search-and-book marketplace for private jets and helicopters in India. One search prices every
DGCA-licensed charter aircraft, **including the empty positioning flights**, so customers see the
aircraft parked closest to them first and the true total fare.

Live site: https://sheetal25895.github.io/YaanBook_page/

## How it works

- `data/operators.json` is the DGCA list of Non-Scheduled Operators (refresh it with
  `python3 tools/import_dgca_nsop.py`). Each aircraft is assumed to be based at its operator's registered city.
- `public/js/data.js` holds airports and helipads, aircraft performance, typical hourly rates and
  pricing rules (GST, landing fees, night halts, minimum billing). Edit numbers there.
- `public/js/engine.js` prices a trip for every aircraft: base → pickup (empty), your flight(s),
  return to base (empty), minimum daily billing, fees, halts and GST. For round trips it compares keeping
  the aircraft with you against flying it home in between, and picks the cheaper option.
- `public/data/partners.json` is where onboarded operators' real data goes:

```json
{
  "operators": ["Air Charters Services Pvt. Ltd."],
  "aircraft": [{ "reg": "VT-BVV", "base": "DEL", "at": "BOM", "rate": 420000, "seats": 10 }],
  "emptyLegs": [{ "id": "EL7", "from": "BOM", "to": "DEL", "date": "2026-11-02", "time": "14:00",
                  "model": "Dassault Falcon 2000", "cat": "smid", "seats": 10, "price": 300000, "was": 900000,
                  "operator": "Air Charters Services" }]
}
```

  `base` = home airport code, `at` = where it is parked now (optional), `rate` = ₹ per flight hour before GST,
  `available: false` hides an aircraft. Operators send these details from the "List your aircraft" page (`join.html`).

## Booking requests

On GitHub Pages there is no server, so requests are sent to the WhatsApp number and email in `CONFIG`
(`public/js/data.js`). To also receive them as form submissions, create a free form at formspree.io and
put its URL in `CONFIG.formEndpoint`.

Running `npm start` (Node server, needs `.env`) adds request storage, the status check, email/WhatsApp
notifications and the operator console at `/operator.html`.

## Publishing

Every push to `main` deploys `public/` through `.github/workflows/pages.yml`.
In the repository go to **Settings → Pages → Source: GitHub Actions** once.

Fares are estimates; operators confirm the final quote.
