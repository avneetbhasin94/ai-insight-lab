# NBA MVP research and decisions

Official product and API pages checked **16 November 2026**. Current scope is NBA only. Earlier cricket/MMA ideas are deferred; no subscription, vendor contact or account was created.

## Competitor patterns worth adapting

| Reference | Observed product pattern | AI Insight Lab decision |
| --- | --- | --- |
| [The Stat Desk](https://www.thestatdeskhq.app/nba/) | Game board, team rankings, matchup context, injury-aware explanations, AI questions, and a visible prediction record. It says picks are frozen before games and changed injury runs are marked. | Make evidence-backed questions central, expose assumptions, and reserve a genuine chronological model record for a later validated predictor. Do not scrape its ESPN-backed data or copy ratings, text, model or branding. |
| [Sofascore](https://www.sofascore.com/basketball) | Fixtures, sport/league navigation, favourites and team comparisons. | Compact matchup cards, local saved state and quick team search. No fake live indicator. |
| [DunksAndThrees games](https://dunksandthrees.com/games) and [EPM methodology](https://dunksandthrees.com/about/epm) | Separates forecasts from actual outcomes and explains player impact/minutes dependencies and model methodology. | Keep scenario assumptions distinct from actual availability. Show the formula and model status; do not borrow proprietary EPM ratings. |

The design uses an original ink/cream/lime visual system, original court geometry and original code. No league logos, player photos or competitor assets are included.

## API shortlist

| Plan | Verified published offering | Rights/freshness caveats | Decision |
| --- | --- | --- | --- |
| [BALLDONTLIE NBA Free](https://nba.balldontlie.io/) | Teams, players, games; 5 requests/minute. | API key/account needed. Not a full stats/injury feed. | Useful integration smoke test after setup. |
| [BALLDONTLIE ALL-STAR](https://nba.balldontlie.io/) | **US$9.99/month**, player-game statistics, active players and player injuries; 60 requests/minute. | Injury example has status, description and return date but no explicit updated-at timestamp. Track fetch time separately; test actual completeness. | Recommended first paid NBA feed if the user chooses to proceed. |
| [BALLDONTLIE GOAT](https://nba.balldontlie.io/) | **US$39.99/month**, advanced statistics, actual/projected lineups, live box scores and additional endpoints; 600 requests/minute. | Its win-probability endpoint is completed-game history, typically hours to a day after completion; not a live/pregame forecast. Some history has gaps. | Upgrade only if measured product needs justify it. |
| [API-SPORTS NBA](https://api-sports.io/sports/nba) | Free 100 requests/day; PRO 7,500/day. | Official pricing is inconsistent between its sports page and official guide (13.00 vs US$15/month); no reliable injury endpoint or express AI rights verified. [Terms](https://api-sports.io/terms). | Less clear than BALLDONTLIE for this project. |

[BALLDONTLIE's current terms](https://www.balldontlie.io/terms.html) expressly cover public app display, caching/storage, derived analysis, model training/evaluation/backtesting and third-party AI processing. They do not grant every possible third-party right or permit operating a substitute raw data API. Licence review is distinct from empirical quality testing.

[The NBA's official injury reports](https://official.nba.com/nba-injury-report-2026-27-season/) are a useful reference link. They are not a verified licensed automated-ingestion API for this project. Competitor use of ESPN does not establish permission to scrape ESPN.

## Refresh and cost design

A proposed initial fetch policy—not a provider latency guarantee—is schedules every six hours, injuries every 5–15 minutes near a game, and final stats after completion and again the next day. Poll live scores only when that feature is enabled and covered; otherwise do not promise live updates.

The lowest sensible production data bill is **US$9.99/month** for NBA ALL-STAR. Hosting is a separate account entitlement; verify current Sites usage limits rather than promising unlimited free scale. An illustrative US$5–10 monthly AI allowance brings data+AI to **US$14.99–19.99 before tax and any hosting/domain costs**. This is a budget target, not a quote or measured usage. The present static prototype makes no paid calls and incurs **US$0 in sports-data/model API usage**.

Keep costs predictable:

1. Cache provider responses on a server by endpoint, game, date and data version. Never expose the provider key to the browser.
2. Generate one bounded explanation per matchup/evidence version and share it across readers, rather than call a model on every page load.
3. Use deterministic numerical calculations and retrieval before considering model generation. A small model is a candidate only after quality/cost evaluation on the same held-out questions.
4. Give free text a maximum size, rate-limit callers, limit retrieved context/output tokens, reserve a request budget before external calls and stop when exhausted. Provider account caps are also needed; per-request guards alone do not cap the monthly bill.
5. Keep actual injury reports, hypothetical effect sizes and outcome predictions in different records. Unknown is a valid status, not a data error to fill with AI.
6. Track evidence age, provider call count, cache hits, error rates, model/token cost and latency without retaining unnecessary personal questions.

## Why NBA first

A single sport gives us a coherent schema, understandable metrics and a manageable evaluation set. It reduces licensing, polling and modeling complexity. The engine/module boundaries allow more sports later, but the current site, corpus, tests and docs focus on NBA.
