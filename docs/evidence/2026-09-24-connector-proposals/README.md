# Connector proposals: where the computer work costs the most

The bots' run logs already say which websites cost the most computer work. This report ranks them,
so that people can decide which connector to build next. The platform only proposes; a person
checks whether a connector is possible and worth it, and builds it as a built-in, with its read or
write classes fixed in code and every write at the approval gate (the decision of 2026-09-24 in
the private backlog, section 4). Nothing the bot writes is ever run.

## Reproduce

From the repository root, with the project's Node and nothing else:

```sh
node docs/evidence/2026-09-24-connector-proposals/propose.mjs                    # data/bots, websites with 3 runs or more
node docs/evidence/2026-09-24-connector-proposals/propose.mjs data/bots --min-runs 10
```

It reads the run logs only (`runs/*/events.jsonl` of every bot) and changes nothing.

## How it counts

- Each model call that asked for a computer action counts toward the website the run opened last
  with `open_url`. Its model cost is that call's recorded cost.
- Websites are ranked by cost per run: a connector saves money on every run that would have used
  the site, so a site that is expensive each time comes first, even if it is used less often.

**Limits:**

- A click that leads to another site without `open_url` still counts toward the site before it.
- A call that asked for a computer action and a platform tool at once counts in full.
- 47 older runs ($19.14) wrote their cost events before the log named each call's tools. Their
  computer steps are counted, their cost is not, so sites used mostly in those days (Calendly, the
  first job-board runs) are under-counted.
- Sandbox time is not counted.

## The ranking on 24 September 2026

189 runs, $84.11 of model cost; $35.92 (43%) in calls that asked for a computer action.

| Website | Runs | Computer steps | Model cost of its computer steps | Per run | A person's reading |
| --- | ---: | ---: | ---: | ---: | --- |
| jobs.cz | 4 | 219 | $4.39 | $1.10 | Filling an application form. The work is a write that ends at "send", which stays with the human; a connector is unlikely. |
| sreality.cz | 6 | 650 | $5.76 | $0.96 | Searching and opening property listings. **Candidate:** check whether a documented API exists and what its terms allow. |
| idos.cz | 4 | 184 | $3.58 | $0.89 | Public-transport times for the house search. **Candidate:** check for an official journey-planning API and its price. |
| mapy.cz | 6 | 289 | $4.76 | $0.79 | Road distance. **Built** (`mapy`); the town research after it ran with no computer step at $0.39. |
| bezrealitky.cz | 6 | 249 | $3.46 | $0.58 | Property listings. **Candidate**, same check as sreality.cz. |
| startupjobs.cz | 18 | 663 | $5.83 | $0.32 | Job search. Check for an API or a feed. |
| mail.example.test | 73 | 1,275 | $5.71 | $0.08 | Webmail. **Built** (`bot-mailbox`); it also removes the sign-in by takeover. |
| cal.com | 11 | 251 | $0.67 | $0.06 | Booking. **Built** (`calcom-public`); the live check found no model saving, as this row predicts. |
| calendly.com | 6 | 104 | $0.00 | $0.00 | Older runs; cost not split (see the limits). |

The rows of `mapy.cz` and `cal.com` check the method: the map connector paid off at
once and the booking connector did not, which is the order this table gives them.

**Next connector, on these numbers:** the property search (sreality.cz, then bezrealitky.cz) or
IDOS, whichever has a documented API that its terms allow. Each needs a person's check before any
code, because the table shows spend, not whether a connector is possible.
