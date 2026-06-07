const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const DATA_FOLDER = path.join(ROOT, 'data');
const EVENTS_FILE = path.join(DATA_FOLDER, 'events.ndjson');
const USERS_FILE = path.join(DATA_FOLDER, 'users.json');
const STATUS_FILE = path.join(DATA_FOLDER, 'bot-status.json');
const DB_STATS_FILE = path.join(DATA_FOLDER, 'db-stats.json');
const DB_FOLDER = path.join(ROOT, 'db');
const ENV_FILE = path.join(ROOT, '.env');

function readJsonFile(filename) {
  try {
    const text = fs.readFileSync(filename, 'utf8');
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

function readEvents() {
  try {
    const text = fs.readFileSync(EVENTS_FILE, 'utf8');
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    return lines.map((line) => {
      try { return JSON.parse(line); } catch (err) { return { type: 'invalid', raw: line }; }
    });
  } catch (err) {
    return [];
  }
}

function maskToken(value) {
  if (!value) return null;
  const length = value.length;
  if (length <= 8) return '********';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function readEnv() {
  try {
    const text = fs.readFileSync(ENV_FILE, 'utf8');
    const lines = text.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#'));
    const env = {};
    for (const line of lines) {
      const [key, ...value] = line.split('=');
      env[key.trim()] = value.join('=').trim();
    }
    return {
      TELEGRAM_BOT_TOKEN: maskToken(env.TELEGRAM_BOT_TOKEN || ''),
      STAFF_MODE: env.STAFF_MODE || 'false',
      STAFF_IDS: env.STAFF_IDS || ''
    };
  } catch (err) {
    return {};
  }
}

function buildDashboard() {
  const status = readJsonFile(STATUS_FILE) || { status: 'offline', timestamp: null };
  const users = readJsonFile(USERS_FILE) || {};
  const events = readEvents();
  const dbStats = readJsonFile(DB_STATS_FILE) || { fileCount: 0, loadedCount: 0, files: [] };
  const userList = Object.values(users).sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));

  const searches = events.filter((event) => event.type === 'search');
  const commands = events.filter((event) => event.type === 'command' || event.type === 'bot-status');

  const topQueries = searches.reduce((acc, entry) => {
    const query = (entry.query || '').toLowerCase().trim();
    if (!query) return acc;
    acc[query] = (acc[query] || 0) + 1;
    return acc;
  }, {});

  const topList = Object.entries(topQueries)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([query, count]) => ({ query, count }));

  const commandCounts = commands.reduce((acc, entry) => {
    const key = entry.command || entry.type || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    status,
    users: userList,
    events: events.slice(-200).reverse(),
    dbStats,
    env: readEnv(),
    topQueries: topList,
    commandCounts,
    fileInfo: dbStats.files,
    totals: {
      users: userList.length,
      searches: searches.length,
      events: events.length
    }
  };
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 700,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(ROOT, 'index.html'));
  mainWindow.removeMenu();
}

ipcMain.handle('getDashboard', () => {
  return buildDashboard();
});

ipcMain.handle('openDataFolder', async () => {
  await shell.openPath(DATA_FOLDER);
});

ipcMain.handle('openDbFolder', async () => {
  await shell.openPath(DB_FOLDER);
});

app.whenReady().then(() => {
  ensureDataFolder();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function ensureDataFolder() {
  if (!fs.existsSync(DATA_FOLDER)) {
    fs.mkdirSync(DATA_FOLDER, { recursive: true });
  }
}
