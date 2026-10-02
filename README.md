# MoneyTrack

A simple savings and debts tracker that runs in your browser and can be added to your iPhone Home Screen like an app.

- **Today** – your savings goal with a progress bar, what you saved today and this week, and who you need to pay or who owes you
- **Savings** – every amount you put aside, grouped by day, with search
- **Debts** – loans and people you owe, and people who owe you, with payments and due dates
- **Insights** – savings for the last 7 or 30 days, plus week-by-week and month-by-month savings for the last 6 months
- **Settings** – currency, light/dark mode, savings goal, backups, spreadsheet export

Your money data is saved **only on your device, in your browser**. It is never uploaded — not even to this GitHub repository. Use *Settings → Save a backup file* now and then.

## Live app

https://s226098883-hue.github.io/money-tracker/

## Add it to your iPhone

Open the link in **Safari** → tap **Share** → **Add to Home Screen** → **Add**.

## Updating the app later

Change or re-upload files in this repository. The app picks up the new version the next time you open it while online. Your saved entries are not affected.

## Files

| File | What it does |
|---|---|
| `index.html` | The page and the bottom tab bar |
| `styles.css` | Look and feel (light and dark mode) |
| `app.js` | Screens, forms, buttons and the savings goal |
| `store.js` | Saving data, dates, debt maths, sample data |
| `charts.js` | The charts |
| `sw.js` | Lets the app open without internet |
| `manifest.webmanifest` and the `.png` files | App name and icons for the Home Screen |
