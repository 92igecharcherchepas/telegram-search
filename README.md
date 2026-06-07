# KV Searcher Ultra — Améliorations

Build (g++ / clang++ with C++17):

```bash
# Example (Linux / MSYS / WSL)
g++ -std=c++17 -O2 -o kv_searcher main.cpp
```

Run:

```bash
# Default uses ./db folder
./kv_searcher

# Or provide a folder path containing JSON files
./kv_searcher path/to/db
```

Notes:
- Place JSON files containing arrays of profiles in the `db` folder (or pass a folder path).
- Program uses `nlohmann::json` single-header; include it as `json.hpp` in the project.
- Improvements: accepts folder path as first argument, safer JSON parsing, avoids `using namespace std`, small performance and style cleanups.

Telegram bot (Node.js)

 - Files: `bot.js`, `search.js`, `package.json`.
 - Set your bot token in the environment variable `TELEGRAM_BOT_TOKEN`.
 - Install dependencies and run:

```powershell
npm install
npm start
```

 - By default the bot reads JSON files from the `db` folder beside the code. You can pass a different folder as the first argument to `bot.js`.

Commands supported:
- Send any text to search the database.
- `/stats` — shows total profiles loaded.
- `/export` — exports the last results for your chat as a text file.

Desktop administration app

- Added an Electron dashboard for Windows.
- View bot status, loaded DB files, user activity, recent searches, top queries and raw events.
- Open the local `data/` folder and the `db/` folder from the UI.

Run the desktop app:

```powershell
npm install
npm run desktop
```

Build a Windows installer (`.exe`):

```powershell
npm run dist
```

Notes:
- The desktop app reads the bot event and data logs from `data/`.
- Use the bot as normal and refresh the dashboard to see the latest activity.
- For a real packaged `.exe`, install dependencies first and run `npm run dist`.

Notes:
- The bot runs in polling mode (suitable for development). For production consider running behind a process manager and enabling webhooks.
