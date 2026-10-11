---
name: house-search-prague
description: Find and report at most two houses near Prague to limit example costs; split Parts A-D across separate runs.
---
GOAL AND LIMITS (fixed, do not ask the user again unless they change them):
- House for sale (not flat), layout 5+1 or bigger; a 5+kk only counts if the listing clearly marks it as 5+kk or bigger.
- Not located in Prague itself.
- At most 50 km from Prague. Distance rule (no Google Maps, IDOS has no driving directions):
  1) Get the municipality's coordinates from its Wikipedia page and calculate the straight-line (great-circle) distance from Prague center.
  2) Under 38 km straight-line: keep the offer, no road check needed.
  3) Over 50 km straight-line: drop the offer.
  4) Between 38 and 50 km straight-line: this is the only case needing a road check — open Mapy.cz on the computer/browser, get the driving distance from Prague to the municipality, and drop the offer only if that road distance is over 50 km.
  5) In the report, always state which kind of distance is printed for each offer: "straight-line" or "by road (Mapy.cz)".
- No price limit.
- Cost constraint: shortlist at most TWO houses in different municipalities. Aim for one from each site. Stop searching once two qualifying houses are saved; never build a larger shortlist or research extra towns to choose winners.
- Report both shortlisted houses. If fewer than two can be verified, report the available house or the empty result and explain what is missing. Do not relax the criteria or invent a second result.

RUN SPLITTING (cost control — always split, never do the whole job in one run):
A run pays for everything it has read on every later step, so this job is always done as four separate runs/parts, and each part stops and tells the user it is done before the next part starts:
- Part A: shortlist only (Step 1 + Step 2 below). Save the shortlist to a file, then stop and report the list to the user.
- Part B: research the FIRST shortlisted municipality only (Step 3). Save the research to a file, then stop and tell the user part B is done. If the shortlist is empty, explain that there is nothing to research and stop.
- Part C: research the SECOND municipality if there is one, then Step 4 (write the report using the saved findings for at most two houses). Do not search for more houses. Stop after saving the report file — do NOT send it in this same run.
- Part D: sending only — a separate run whose entire job is to read back the already-saved report file and send it by email (with propose_action). Do nothing else in this run: no re-reading of research, no re-verification.
Only do more than one part in a single run if the user explicitly asks for that in their instruction for this run; otherwise stop at the end of the part you were asked for and wait for the user to say "go on."

STEP 1 — sreality.cz (do this with the computer, minimal clicks):
- Open this saved search URL directly (skip the filter UI entirely — opening the filter panel wastes a step/screen and is not needed):
  https://www.sreality.cz/hledani/prodej/domy/rodinne-domy,vily,vicegeneracni-domy/praha-vychod,praha-zapad,beroun,kladno,melnik,nymburk,kolin,benesov?velikost=5-a-vice
  (houses for sale, 5+ rooms, in the 8 districts ring around Prague: Praha-východ, Praha-západ, Beroun, Kladno, Mělník, Nymburk, Kolín, Benešov). Note: sreality has no 5+1-specific filter for houses, so the exact layout must be confirmed from each listing's own description text, not from the search filter. In words, if this URL ever breaks: search sreality.cz for houses for sale (not flats/plots/villas-only) with 5-or-more rooms, filtered to the 8 districts surrounding Prague.
- Trust the heading/count shown on the result list page as-is; do not re-verify it by opening the filter panel.
- Read the result list first (photos, price, size, place) and pick candidates from the list before opening anything.
- Open only the offers you actually intend to shortlist.
- On an opened offer, read ONLY the description text to confirm: (a) the exact layout (5+1/6+1/etc or a clearly-marked 5+kk+), (b) that the house is built/finished (not a plot or a project/future build), (c) that it is not marked reserved/sold.
- As soon as an offer passes these checks, save its link, price, house area, land area, and place into your running shortlist notes immediately — do not wait until the end of the sreality pass.
- LAND AREA CAUTION: the land area to record is always the plot/lot size — labelled "Plocha pozemku" in the listing's key-facts table, or the "pozemek ... m²" figure that appears in the listing's title/heading. A listing may ALSO show a separate "zahrada" (garden) figure right next to it — a garden is only part of the plot and is smaller than the full "Plocha pozemku"; never record the garden number as the land area. If only a garden figure is given and no "Plocha pozemku"/"pozemek" figure exists, say so explicitly rather than substituting the garden number silently.

STEP 2 — bezrealitky.cz:
- Open this saved search URL directly:
  https://www.bezrealitky.cz/vypis/nabidka-prodej/dum/stredocesky-kraj?disposition=DISP_5_1&disposition=DISP_6_KK&disposition=DISP_6_1&disposition=DISP_7_KK&disposition=DISP_7_1
  (houses for sale, Středočeský kraj / Central Bohemian region, dispositions 5+1, 6+kk, 6+1, 7+kk, 7+1 — this filter already narrows to 5+1-or-bigger, unlike sreality). In words, if this URL ever breaks: search bezrealitky.cz for houses for sale in the Central Bohemian region (Středočeský kraj), filtered to dispositions 5+1, 6+kk, 6+1, 7+kk, 7+1 or bigger.
- Read the list as plain text first (fetch_url works fine here) — do not drive the browser for browsing/scrolling the list.
- Use the computer/browser only to open the specific chosen offers (to confirm layout/built/not-reserved exactly as in Step 1) and to copy their permanent links.
- Same LAND AREA CAUTION as in Step 1 applies here: always use "Plocha pozemku" / the "pozemek" figure from the title, never a separate garden figure.

SHORTLIST DISCIPLINE:
- Stop once you have two qualifying houses in distinct municipalities, preferably one per site, passing the layout/built/not-reserved/distance checks. Do not collect backups. If a site blocks the search or suitable offers cannot be verified, save the partial result and explain the limit.
- For each, save immediately: place, exact layout, house area m², land area m² (the "Plocha pozemku"/"pozemek" figure — see LAND AREA CAUTION above, not a garden figure), price, distance from Prague (straight-line from Wikipedia coordinates; only fall back to a Mapy.cz road check when the straight-line figure is between 38 and 50 km), and the listing link. Do this incrementally — never defer saving to the end (a past run lost all 150 steps by saving nothing along the way).
- This is Part A of the job. When the shortlist file has two saved offers, stop the run and show the list to the user; do not start town research in the same run.

STEP 3 — town research (fetch_url only for everything except the occasional Mapy.cz road-distance check, which needs the computer):
For each of the at most two shortlisted municipalities, gather and record with its own source link, one line each, writing "not found" rather than guessing if a fact is missing:
- Inhabitants, with the year of the figure: Czech Wikipedia page of the municipality (cs.wikipedia.org/wiki/<name>). When the house actually stands in a named PART of a municipality (e.g. Zdiměřice is a part of Jesenice, Jažlovice is a part of Říčany), give the inhabitants of the whole municipality FIRST, and the inhabitants of that part SECOND (if findable), each with its own source. Research the school, the hospital and the sports club for the whole municipality, not separately for the part.
- Distance from Prague: take the municipality's coordinates from the same Wikipedia page, compute straight-line distance from Prague center. Label it "straight-line" in the report. Only when that figure falls between 38 and 50 km, additionally open Mapy.cz on the computer, get the driving distance, and label that figure "by road (Mapy.cz)" instead — use it to decide keep/drop per the limits above.
- Hospital: the nearest hospital/clinic, its rating and number of ratings, from its Firmy.cz page (www.firmy.cz). Prefer a general acute hospital; if the nearest is a specialised/day-surgery/rehab clinic, say so and also give the nearest general hospital.
- Elementary school: name it and state plainly whether it teaches all nine grades (1.–9. třída) or fewer — from the school's own website or Wikipedia. Many small-village schools only go up to 5th grade; say so explicitly.
- Public transport time to Prague: use an IDOS (idos.cz/pid) search from the municipality's own bus/train stop (not a nearby substitute stop) to Staroměstská, first connection on a Monday from 07:30. When the municipality's name alone is ambiguous (matches multiple stops/places in Czechia), do NOT start by using the on-screen IDOS form, because every search performed there stops for the user's approval as a computer action; instead try building the link with an exact, disambiguated stop name first:
  - For a railway station, try "<Municipality> (vlak)", e.g. https://idos.cz/pid/spojeni/vysledky/?f=Nedomice%20(vlak)&t=Staroměstská&date=<next Monday>&time=07:30
  - For a named part/stop within a municipality, try "<Municipality>,<stop>", e.g. "Nedomice,Škola" or "Říčany,Jažlovice".
  Only fall back to using the on-screen form/search box when these exact-name link attempts fail to resolve or return no stop. Record total minutes and confirm the departure stop is genuinely in that municipality. Note: IDOS has no driving-directions mode — use it only for public transport, never for road distance.
- Sports clubs: the municipality's own website (obec.cz-style) or Wikipedia — name actual clubs (football, tennis, Sokol, etc.) if present; otherwise "not found" or "no dedicated club, but X".
- Save each town's findings to your running notes as soon as you finish that town, before moving to the next — do this town by town, not all at once at the end.
- Split this step across two runs: Part B researches the first municipality and saves its notes; Part C researches the second municipality, if present, and then moves to Step 4. Part C reads Part B's saved notes rather than fetching its sources again.

STEP 4 — the report (inside Part C, after the second municipality is researched, if present):
- Structure (plain text, AT MOST 70 lines total, English, no tables):
  1. Summary: one line per offer — place, layout, house area, land area, price, distance from Prague (labelled "straight-line" or "by road (Mapy.cz)"), minutes to Staroměstská. Order by distance from Prague, closest first.
  2. If fewer than two houses are included, one line explaining why. Do not add or research an extra house just to exclude it.
  3. One line stating once that all municipality facts below describe the town/village as a whole, not the house itself (and, where relevant, that the house sits in a named part of that municipality).
  4. One block per offer (at most two): the listing link + one line describing the house's condition/notable features; then the municipality facts (population+year [+ part's population if applicable], distance+its label, hospital+rating+count, school+grades-verdict, transport+minutes, sports), each fact followed by its own source link.
  5. Closing section "What I could not verify": list any gaps, conflicting figures (e.g. population mismatch between Wikipedia and the town's own site), or approximations.
- BEFORE calling write_artifact, literally count the number of lines in the drafted report text (count newlines, including wrapped bullet/source lines — every physical line counts, not just paragraphs). If the count is over 70, cut it down (shorten the "could not verify" section first, then tighten wording/merge lines in the offer blocks) and re-count. Repeat until the count is 70 or fewer. Do not skip this count-and-cut step — a past report was sent at 88 lines because this was not actually done.
- Save the report to a file first (write_artifact). Do NOT send it in this run — sending is Part D, a separate run.

PART D — sending (its own run, done only when the user asks to send):
- Read back the already-saved report file with read_artifact (do not re-fetch or re-verify any sources).
- Use only the dedicated bot mailbox and report recipient the current user supplied. If the webmail URL, bot address or recipient is missing from memory, ask the user and remember the answer before opening webmail. Ask for takeover at sign-in; never request or type a password in chat. Never use an account or recipient from a historical report. Propose the send with propose_action and wait for approval before sending.
- Do nothing else in this run.

EFFICIENCY NOTES (what wasted steps before, avoid repeating):
- Do not open the sreality filter panel; the saved URL already encodes the filter.
- Do not browse bezrealitky's list in the browser; fetch_url its plain text instead, and only open the browser for the individual chosen listings.
- Do all town research via fetch_url where possible — no computer/browser steps needed for Wikipedia, Firmy.cz, IDOS (try exact-name links first) or school/municipality sites.
- Never use Google Maps and never ask IDOS for driving directions — it has none. Use straight-line distance from Wikipedia coordinates as the default distance figure; open Mapy.cz on the computer only for the narrow 38–50 km band, and only to check road distance there.
- Save shortlist entries and town research notes incrementally, town by town and offer by offer, never batched at the end.
- Never do more than one Part (A/B/C/D) in a single run unless the user explicitly asks for that; each run should read as little as possible and stop at its part's boundary.
