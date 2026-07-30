# AGENTS.md

- This project is a mobile PWA for food recommendations near Changwon National University.
- Do not develop directly on `main`; use feature branches for feature work.
- Do not commit, push, merge into `main`, or deploy to Vercel production without an explicit request.
- Do not arbitrarily delete existing restaurant, menu, or review data.
- If location access is denied, the app must still work normally using Changwon National University main gate as the default.
- Preserve the existing favorites, eaten history, reviews, search, world cup, roulette, and map features.
- Prioritize mobile screens and consider widths from 360px to 430px.
- Weather is an optional helper condition for recommendations; do not exclude or penalize menus because of weather.
- User-selected category, budget, and situation take priority over weather.
- Do not use external images with unclear copyright status.
- After changes, run available tests and syntax checks, then report the results.
- When changing the Service Worker, verify the cache version.
- Do not expose developer-only internal state such as Supabase status in the user interface.
