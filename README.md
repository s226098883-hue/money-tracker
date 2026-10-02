# MoneyTrack

A simple savings and debts tracker that runs in your browser and can be added to your iPhone Home Screen like an app.

- **Today** – your savings goals with progress bars, what you saved this week, and who you need to pay or who owes you. The **+** button adds a saving.
- **Savings goals** – have as many as you like. Pick one with **New savings go here** and every saving you add counts toward it automatically (you can choose a different goal, or none, when you add a saving).
- **This week's target** – the second panel on Today: how much to save this week, how much is still needed, per day and days left. It follows your main goal (money still needed ÷ weeks left, worked out every Monday) or a fixed amount you choose.
- **Savings** – every amount you put aside, grouped by day, with search
- **Debts** – loans and people you owe, and people who owe you, with payments and due dates
- **Insights** – savings for the last 7 or 30 days, plus week-by-week and month-by-month savings for the last 6 months
- **Settings** – GitHub sync, currency, light/dark mode, goals, backups, spreadsheet export

## Your data

Your data is saved in your browser. Turn on **Settings → GitHub sync** to also save it to a private repository in your own GitHub account (`money-tracker-data`). Then:

- nothing is lost if the browser forgets its data, you delete the Home Screen icon, or the app is updated
- your iPhone, Mac and any other browser you connect all show the same data
- GitHub keeps every earlier version, so you can always go back

Your money data is never stored in this (public) app repository.

## Live app

https://s226098883-hue.github.io/money-tracker/

## Add it to your iPhone

Open the link in **Safari** → tap **Share** → **Add to Home Screen** → **Add**.

## Updating the app later

Change or re-upload files in this repository. The app picks up the new version the next time you open it while online. Your data is not affected: the app only ever adds to the data format, and keeps a copy of older data before upgrading it.

## Files

| File | What it does |
|---|---|
| `index.html` | The page and the bottom tab bar |
| `styles.css` | Look and feel (light and dark mode) |
| `app.js` | Screens, forms, buttons and savings goals |
| `store.js` | Saving data, upgrades, merging changes, dates, debt maths, sample data |
| `sync.js` | GitHub sync |
| `charts.js` | The charts |
| `sw.js` | Lets the app open without internet |
| `manifest.webmanifest` and the `.png` files | App name and icons for the Home Screen |
