const fs = require('fs');
const os = require('os');
const path = require('path');
const { Telegraf } = require('telegraf');
const search = require('./search');
require('dotenv').config();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error('Please set TELEGRAM_BOT_TOKEN environment variable');
  process.exit(1);
}

const bot = new Telegraf(TOKEN);
const DB_FOLDER = process.argv[2] || path.join(__dirname, 'db');
const DATA_FOLDER = path.join(__dirname, 'data');
const EVENTS_FILE = path.join(DATA_FOLDER, 'events.ndjson');
const USERS_FILE = path.join(DATA_FOLDER, 'users.json');
const STATUS_FILE = path.join(DATA_FOLDER, 'bot-status.json');
const DB_STATS_FILE = path.join(DATA_FOLDER, 'db-stats.json');
const SEARCH_RESULT_LIMIT = 50;
let staffMode = process.env.STAFF_MODE === 'true';
const staffMembers = new Set(
  (process.env.STAFF_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
);

let database = { profiles: [], sources: [] };

function ensureDataFolder() {
  if (!fs.existsSync(DATA_FOLDER)) {
    fs.mkdirSync(DATA_FOLDER, { recursive: true });
  }
}

function appendEvent(event) {
  ensureDataFolder();
  const line = JSON.stringify({ ...event, timestamp: new Date().toISOString() });
  fs.appendFileSync(EVENTS_FILE, `${line}\n`, 'utf8');
}

function loadUsers() {
  ensureDataFolder();
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')) || {};
  } catch (err) {
    return {};
  }
}

function saveUsers(users) {
  ensureDataFolder();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function registerUser(ctx) {
  ensureDataFolder();
  const chatId = String(ctx.chat.id);
  const users = loadUsers();
  users[chatId] = {
    chatId,
    username: ctx.from?.username || 'unknown',
    firstName: ctx.from?.first_name || '',
    lastName: ctx.from?.last_name || '',
    lastSeen: new Date().toISOString(),
    isStaff: isStaff(chatId)
  };
  saveUsers(users);
}

function recordEvent(type, payload = {}) {
  appendEvent({ type, ...payload });
}

function updateBotStatus(status) {
  ensureDataFolder();
  const payload = {
    status,
    timestamp: new Date().toISOString(),
    pid: process.pid,
    node: process.version
  };
  fs.writeFileSync(STATUS_FILE, JSON.stringify(payload, null, 2), 'utf8');
  appendEvent({ type: 'bot-status', status });
}

function writeDBStats(stats) {
  ensureDataFolder();
  fs.writeFileSync(DB_STATS_FILE, JSON.stringify(stats, null, 2), 'utf8');
}

function sanitizeName(name) {
  return String(name)
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_\-\.]/g, '_')
    .slice(0, 80);
}

function isStaff(chatId) {
  return staffMembers.has(String(chatId));
}

function isAllowed(chatId) {
  return !staffMode || isStaff(chatId);
}

function requireAllowed(ctx) {
  registerUser(ctx);
  const chatId = String(ctx.chat.id);
  if (!isAllowed(chatId)) {
    ctx.reply('le bot est actuellement en mode dev tu ne peux pas search désolé');
    recordEvent('access-denied', { chatId, username: ctx.from?.username, command: ctx.message?.text || '' });
    return false;
  }
  return true;
}

function requireStaff(ctx) {
  const chatId = String(ctx.chat.id);
  if (!isStaff(chatId)) {
    ctx.reply('tu et pas autorisé a faire ça il ya que les dev qui peuvent ! ');
    return false;
  }
  return true;
}

async function reloadDatabase() {
  console.log('[DB] Rechargement de la base de donnees...');
  let stats = { fileCount: 0, loadedCount: 0, timestamp: new Date().toISOString(), files: [] };
  try {
    database = await search.loadDatabases(DB_FOLDER);
    const fileList = (database.sources || []).map((source) => ({
      path: source.path,
      type: source.type,
      loaded: Boolean(source.loaded),
      size: source.size,
      mtimeMs: source.mtimeMs
    }));
    const loadedCount = Array.isArray(database) ? database.length : database.profiles.length;
    stats = {
      ...stats,
      fileCount: fileList.length,
      loadedCount,
      files: fileList
    };
  } catch (err) {
    console.error('[DB] Erreur durant le chargement de la base :', err && err.message ? err.message : err);
    database = { profiles: [], sources: [] };
  }
  writeDBStats(stats);
  const loadedCount = Array.isArray(database) ? database.length : database.profiles.length;
  console.log('[DB] Base reloaded, profils totaux chargees :', loadedCount);
  recordEvent('db-reload', { loadedCount, fileCount: stats.fileCount });
}

function watchDBFolder(folder) {
  if (!fs.existsSync(folder)) return;
  try {
    let reloadTimer = null;
    const watcher = fs.watch(folder, (eventType, filename) => {
      if (!filename) return;
      if (filename === '.cache' || filename.startsWith('.cache' + path.sep)) return;
      const ext = path.extname(filename).toLowerCase();
      const watchedExts = new Set(['.json', '.csv', '.ndjson', '.txt']);
      if (!watchedExts.has(ext) && ext !== '') return;
      console.log('[DB WATCH] Changement detecte :', filename, eventType);
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(async () => {
        await reloadDatabase();
      }, 1500);
    });
    watcher.on('error', (err) => {
      console.error('[DB WATCH ERROR]', err && err.message);
    });
  } catch (err) {
    console.error('[DB WATCH] Impossible de demarrer la surveillance :', err && err.message);
  }
}

function makeExportFiles(results, chatId) {
  const groups = new Map();
  for (const p of results) {
    const source = path.basename(p.sourceDB);
    if (!groups.has(source)) groups.set(source, []);
    groups.get(source).push(p);
  }

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), `kv_export_${chatId}_`));
  const indexLines = [];
  let index = 1;
  const files = [];

  for (const [source, items] of groups) {
    const filename = `index${index}_${sanitizeName(source)}.txt`;
    const filepath = path.join(outputDir, filename);
    const out = fs.createWriteStream(filepath, { encoding: 'utf8' });
    out.write(`SOURCE: ${source}\n`);
    out.write(`TOTAL: ${items.length}\n`);
    out.write('====================================\n');
    for (const p of items) {
      out.write(`Nom : ${p.nom}\n`);
      out.write(`Prenom : ${p.prenom}\n`);
      out.write(`Age : ${p.age}\n`);
      out.write(`Username : ${p.username}\n`);
      out.write(`Email : ${p.email}\n`);
      out.write(`Telephone : ${p.telephone}\n`);
      out.write(`Ville : ${p.ville}\n`);
      out.write(`Adresse : ${p.adresse}\n`);
      out.write(`Source : ${p.sourceDB}\n`);
      out.write('------------------------------------\n');
    }
    out.end();
    indexLines.push(`${filename} -> ${source} (${items.length})`);
    files.push(filepath);
    index += 1;
  }

  const indexFile = path.join(outputDir, 'index.txt');
  fs.writeFileSync(indexFile, indexLines.join('\n'), 'utf8');
  return [indexFile, ...files];
}

async function sendExportFiles(ctx, results) {
  const chatId = String(ctx.chat.id);
  const files = makeExportFiles(results, chatId);
  for (const file of files) {
    await ctx.replyWithDocument({ source: fs.createReadStream(file) });
  }
  const folder = path.dirname(files[0]);
  for (const file of files) {
    try { fs.unlinkSync(file); } catch (e) {}
  }
  try { fs.rmdirSync(folder); } catch (e) {}
}

async function main() {
  console.log('Chargement de la base de donnees depuis :', DB_FOLDER);
  await reloadDatabase();
  watchDBFolder(DB_FOLDER);
  const lastResults = new Map();

  bot.start((ctx) => {
    if (!requireAllowed(ctx)) return;
    ctx.reply('Bienvenue sur akatsuki-search. Envoie une recherche (ex: prenom, nom, email, ville)');
    recordEvent('command', { chatId: String(ctx.chat.id), command: 'start' });
  });

  bot.help((ctx) => {
    ctx.reply('/stats - voir le nombre total de profils\n/search <requete> - rechercher un profil\n/sources - lister les fichiers charges\n/info - afficher le statut du bot\n/export - exporter les derniers resultats\n/reload - recharger la base depuis db\n/staffmode on|off - activer/desactiver le mode staff\n/allow <id> - autoriser un utilisateur\n/deny <id> - retirer un utilisateur\n/liststaff - afficher les IDs autorises');
  });

  // /search command: usage: /search votre_requete
  bot.command('search', async (ctx) => {
    if (!requireAllowed(ctx)) return;
    const chatId = String(ctx.chat.id);
    const text = (ctx.message.text || '').trim();
    const parts = text.split(' ');
    parts.shift(); // remove the command itself
    const q = parts.join(' ').trim();

    if (!q) {
      return ctx.reply('Usage: /search <requete> — ex: /search paris');
    }

    const results = await search.searchProfils(database, q, { limit: SEARCH_RESULT_LIMIT });
    lastResults.set(chatId, results);
    recordEvent('search', { chatId, query: q, resultCount: results.length, sourceCount: Array.isArray(database) ? 0 : database.sources.length });

    if (results.length === 0) return ctx.reply('[AUCUN RESULTAT]');

    const max = 5;
    const toShow = results.slice(0, max);
    const partsOut = toShow.map((p, i) => {
      return `${i+1}. ${p.prenom} ${p.nom} — ${p.ville || 'n/a'}\nEmail: ${p.email}`;
    });

    let reply = `RESULTATS: ${results.length}\n\n` + partsOut.join('\n\n');
    if (results.length > max) reply += `\n\n... et ${results.length - max} autres. Utilise /export pour obtenir tous les resultats.`;

    ctx.reply(reply);
  });

  bot.command('stats', (ctx) => {
    if (!requireAllowed(ctx)) return;
    const loaded = Array.isArray(database) ? database.length : database.profiles.length;
    const sources = Array.isArray(database) ? 0 : database.sources.length;
    ctx.reply(`Profils charges: ${loaded}\nFichiers sources: ${sources}`);
  });

  bot.command('export', async (ctx) => {
    if (!requireAllowed(ctx)) return;
    const chatId = String(ctx.chat.id);
    const results = lastResults.get(chatId);
    if (!results || results.length === 0) {
      return ctx.reply('Aucun resultats a exporter pour cette session.');
    }

    try {
      await sendExportFiles(ctx, results);
    } catch (e) {
      console.error('Export error', e);
      ctx.reply('Erreur lors de l envoi des fichiers d export.');
    }
  });

  bot.command('sources', (ctx) => {
    if (!requireAllowed(ctx)) return;
    const sources = Array.isArray(database)
      ? Array.from(new Set(database.map((p) => path.basename(p.sourceDB))))
      : Array.from(new Set((database.sources || []).map((s) => path.basename(s.path))));
    if (sources.length === 0) return ctx.reply('Aucune source chargee.');
    ctx.reply(`Fichiers charges:\n${sources.join('\n')}`);
  });

  bot.command('info', (ctx) => {
    if (!requireAllowed(ctx)) return;
    const loaded = Array.isArray(database) ? database.length : database.profiles.length;
    const sources = Array.isArray(database) ? 0 : database.sources.length;
    ctx.reply(`Status:\nMode staff: ${staffMode ? 'ON' : 'OFF'}\nProfils charges: ${loaded}\nFichiers sources: ${sources}\nStaff autorise: ${Array.from(staffMembers).join(', ') || 'aucun'}`);
  });

  bot.command('reload', async (ctx) => {
    if (!requireAllowed(ctx)) return;
    if (!requireStaff(ctx)) return;
    await reloadDatabase();
    const loaded = Array.isArray(database) ? database.length : database.profiles.length;
    ctx.reply(`Base rechargée. Profils charges: ${loaded}`);
  });

  bot.command('staffmode', (ctx) => {
    if (!requireStaff(ctx)) return;
    const text = (ctx.message.text || '').trim();
    const parts = text.split(' ').map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) return ctx.reply('Usage: /staffmode on|off');
    const arg = parts[1].toLowerCase();
    if (arg === 'on') {
      process.env.STAFF_MODE = 'true';
      ctx.reply('Mode staff active.');
    } else if (arg === 'off') {
      staffMode = false;
      process.env.STAFF_MODE = 'false';
      ctx.reply('Mode staff désactivé.');
    } else {
      ctx.reply('Usage: /staffmode on|off');
    }
  });

  bot.command('allow', (ctx) => {
    if (!requireStaff(ctx)) return;
    const text = (ctx.message.text || '').trim();
    const parts = text.split(' ').map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) return ctx.reply('Usage: /allow <chatId>');
    const targetId = parts[1];
    staffMembers.add(targetId);
    ctx.reply(`ID autorisé: ${targetId}`);
  });

  bot.command('deny', (ctx) => {
    if (!requireStaff(ctx)) return;
    const text = (ctx.message.text || '').trim();
    const parts = text.split(' ').map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) return ctx.reply('Usage: /deny <chatId>');
    const targetId = parts[1];
    staffMembers.delete(targetId);
    ctx.reply(`ID retiré: ${targetId}`);
  });

  bot.command('liststaff', (ctx) => {
    if (!requireStaff(ctx)) return;
    const list = Array.from(staffMembers);
    ctx.reply(`Staff autorisé:\n${list.join('\n') || 'aucun'}`);
  });

  bot.on('text', async (ctx) => {
    if (!requireAllowed(ctx)) return;
    const chatId = String(ctx.chat.id);
    const q = ctx.message.text.trim();
    if (!q) return ctx.reply('Question vide.');

    const results = await search.searchProfils(database, q, { limit: SEARCH_RESULT_LIMIT });
    lastResults.set(chatId, results);
    recordEvent('search', { chatId, query: q, resultCount: results.length, sourceCount: Array.isArray(database) ? 0 : database.sources.length });

    if (results.length === 0) return ctx.reply('Zéro Resultat trouvé.');

    const max = 5;
    const toShow = results.slice(0, max);
    const parts = toShow.map((p, i) => {
      return `${i+1}. ${p.prenom} ${p.nom} — ${p.ville || 'n/a'}\nEmail: ${p.email}`;
    });

    let reply = `RESULTATS: ${results.length}\n\n` + parts.join('\n\n');
    if (results.length > max) reply += `\n\n... et ${results.length - max} autres. Utilise /export pour obtenir tous les resultats.`;

    ctx.reply(reply);
  });

  bot.launch().then(() => {
    console.log('Bot demarre.');
    updateBotStatus('online');
    recordEvent('bot-status', { status: 'online' });
  }).catch(console.error);

  // graceful shutdown
  process.once('SIGINT', () => {
    updateBotStatus('offline');
    bot.stop('SIGINT');
  });
  process.once('SIGTERM', () => {
    updateBotStatus('offline');
    bot.stop('SIGTERM');
  });
}

main().catch(err => {
  console.error('Erreur au demarrage du bot:', err);
  process.exit(1);
});
