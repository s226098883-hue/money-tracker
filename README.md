# MoneyTrack

A simple money tracker that runs in your browser and can be added to your iPhone Home Screen like an app.

- **Today** – what you spent and saved today and this month, plus alerts for payments that are due
- **Activity** – every entry, grouped by day, with search
- **Debts** – loans and people you owe, and people who owe you, with payments and due dates
- **Insights** – charts of spending vs saving and where your money went
- **Settings** – currency, light/dark mode, backups, spreadsheet export

Your money data is saved **only on your device, in your browser**. It is never uploaded — not even to this GitHub repository. Use *Settings → Save a backup file* now and then.

## Put it online with GitHub Pages

1. On github.com, click **+ → New repository**. Name it `money-tracker`, choose **Public**, then **Create repository**.
2. Click **uploading an existing file**. Drag in every file from this folder, then click **Commit changes**.
3. Go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
4. After a minute or two the page shows your link: `https://YOUR-USERNAME.github.io/money-tracker/`

## Add it to your iPhone

Open your link in **Safari** → tap **Share** → **Add to Home Screen** → **Add**.

## Updating the app later

Change or re-upload files in this repository. The app picks up the new version the next time you open it while online. Your saved entries are not affected.

## Files

| File | What it does |
|---|---|
| `index.html` | The page and the bottom tab bar |
| `styles.css` | Look and feel (light and dark mode) |
| `app.js` | Screens, forms and buttons |
| `store.js` | Saving data, dates, debt maths, sample data |
| `charts.js` | The charts |
| `sw.js` | Lets the app open without internet |
| `manifest.webmanifest` and the `.png` files | App name and icons for the Home Screen |
