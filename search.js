const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { chain } = require('stream-chain');
const { parser } = require('stream-json');
const { streamArray } = require('stream-json/streamers/StreamArray');
const { parse: csvParse } = require('csv-parse');

function toLower(s) {
  return s ? s.toLowerCase() : '';
}

function containsInsensitive(text, query) {
  if (!query) return true;
  return toLower(text).includes(toLower(query));
}

function isDataFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ['.json', '.csv', '.ndjson', '.txt'].includes(ext);
}

function sanitizeCacheFilename(filename) {
  return filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function getCacheFilePath(folder, filename) {
  const cacheDir = path.join(folder, '.cache');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  return path.join(cacheDir, `${sanitizeCacheFilename(filename)}.json`);
}

function cleanCacheFiles(folder, dataFiles) {
  const cacheDir = path.join(folder, '.cache');
  if (!fs.existsSync(cacheDir)) return;
  const entries = fs.readdirSync(cacheDir);
  for (const entry of entries) {
    const full = path.join(cacheDir, entry);
    const originalName = entry.replace(/\.json$/, '');
    const possibleFile = dataFiles.find((f) => sanitizeCacheFilename(f) === originalName);
    if (!possibleFile) {
      try {
        fs.unlinkSync(full);
      } catch (err) {
        console.error('[CACHE CLEAN] impossible de supprimer', full, err && err.message);
      }
    }
  }
}

function loadCacheData(cacheFile) {
  if (!fs.existsSync(cacheFile)) return null;
  try {
    const raw = fs.readFileSync(cacheFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.meta) {
      return parsed;
    }
  } catch (err) {
    console.error('[CACHE ERROR] impossible de lire le cache', cacheFile, err && err.message);
  }
  return null;
}

function writeCacheData(cacheFile, meta, profiles) {
  try {
    const payload = { meta };
    if (profiles !== undefined) payload.profiles = profiles;
    fs.writeFileSync(cacheFile, JSON.stringify(payload), 'utf8');
  } catch (err) {
    console.error('[CACHE ERROR] impossible d ecrire le cache', cacheFile, err && err.message);
  }
}

function detectFileType(head, stats) {
  const m = head.match(/[^	\n\r ]/);
  const firstChar = m ? m[0] : null;
  const isCsv = firstChar !== '{' && firstChar !== '[' && head.includes(',');
  const isNdjson = firstChar === '{' && /}\s*\r?\n\s*\{/.test(head);
  if (isCsv) return 'csv';
  if (isNdjson) return 'ndjson';
  if (firstChar === '[') return 'json-array';
  if (firstChar === '{') return 'json-object';
  return 'csv';
}

function profileMatches(p, query) {
  if (!query) return true;
  return (
    containsInsensitive(p.nom, query) ||
    containsInsensitive(p.prenom, query) ||
    containsInsensitive(p.email, query) ||
    containsInsensitive(p.telephone, query) ||
    containsInsensitive(p.adresse, query) ||
    containsInsensitive(p.ville, query) ||
    containsInsensitive(p.username, query) ||
    containsInsensitive(String(p.age), query)
  );
}

async function searchCsvFile(full, query, results, limit) {
  await new Promise((resolve) => {
    const parser = csvParse({ columns: true, relax_quotes: true, skip_empty_lines: true, trim: true });
    const input = fs.createReadStream(full, { encoding: 'utf8' });
    input.pipe(parser);

    parser.on('readable', () => {
      let record;
      while ((record = parser.read()) !== null) {
        const p = mapItemToProfil(record, full);
        if (profileMatches(p, query)) {
          results.push(p);
          if (results.length >= limit) {
            parser.destroy();
            input.destroy();
            return;
          }
        }
      }
    });

    parser.on('error', (err) => {
      console.error('[ERREUR CSV SEARCH]', full, err && err.message);
      resolve();
    });

    parser.on('end', () => resolve());
  });
}

async function searchNdjsonFile(full, query, results, limit) {
  const rl = readline.createInterface({ input: fs.createReadStream(full, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (results.length >= limit) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const item = JSON.parse(trimmed);
      const p = mapItemToProfil(item, full);
      if (profileMatches(p, query)) results.push(p);
    } catch (err) {
      console.error('[ERREUR JSONL SEARCH]', full, err && err.message);
    }
  }
}

async function searchJsonArrayFile(full, query, results, limit) {
  await new Promise((resolve) => {
    const pipeline = chain([fs.createReadStream(full), parser(), streamArray()]);
    pipeline.on('data', ({ value }) => {
      if (results.length >= limit) return;
      const item = value || {};
      const p = mapItemToProfil(item, full);
      if (profileMatches(p, query)) results.push(p);
    });
    pipeline.on('end', () => resolve());
    pipeline.on('error', (err) => {
      console.error('[ERREUR JSON ARRAY SEARCH]', full, err && err.message);
      resolve();
    });
  });
}

async function searchJsonObjectFile(full, query, results, limit) {
  try {
    let raw = fs.readFileSync(full, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    const data = JSON.parse(raw);
    let arr = null;
    if (Array.isArray(data)) arr = data;
    else if (data && typeof data === 'object') {
      for (const k of Object.keys(data)) {
        if (Array.isArray(data[k])) {
          arr = data[k];
          break;
        }
      }
    }
    if (!arr) return;
    for (const item of arr) {
      if (results.length >= limit) break;
      const p = mapItemToProfil(item, full);
      if (profileMatches(p, query)) results.push(p);
    }
  } catch (err) {
    console.error('[ERREUR JSON OBJECT SEARCH]', full, err && err.message);
  }
}

async function searchFileSource(source, query, results, limit) {
  if (results.length >= limit) return;
  if (source.type === 'csv') {
    await searchCsvFile(source.path, query, results, limit);
  } else if (source.type === 'ndjson') {
    await searchNdjsonFile(source.path, query, results, limit);
  } else if (source.type === 'json-array') {
    await searchJsonArrayFile(source.path, query, results, limit);
  } else {
    await searchJsonObjectFile(source.path, query, results, limit);
  }
}

async function loadDatabases(folder = path.join(__dirname, 'db')) {
  const database = { profiles: [], sources: [] };

  if (!fs.existsSync(folder)) {
    console.error('[ERREUR] Dossier db introuvable:', folder);
    return database;
  }

  const files = fs.readdirSync(folder);
  cleanCacheFiles(folder, files.filter((f) => isDataFile(f)));

  for (const f of files) {
    if (!isDataFile(f)) continue;
    const full = path.join(folder, f);
    try {
      console.log('[LOAD] Analyse du fichier :', f);
      const stats = fs.statSync(full);
      const cacheFile = getCacheFilePath(folder, f);
      const cached = loadCacheData(cacheFile);

      if (
        cached &&
        cached.meta &&
        cached.meta.size === stats.size &&
        cached.meta.mtimeMs === stats.mtimeMs
      ) {
        console.log('[LOAD] Cache valide, fichier inchangé :', f);
        if (cached.profiles && Array.isArray(cached.profiles) && cached.profiles.length > 0) {
          const chunkSize = 10000;
          for (let i = 0; i < cached.profiles.length; i += chunkSize) {
            database.profiles.push(...cached.profiles.slice(i, i + chunkSize));
          }
          console.log(`[LOAD] Profils restaures depuis cache: ${cached.profiles.length}`);
          database.sources.push({ path: full, type: cached.meta.type || 'csv', size: stats.size, mtimeMs: stats.mtimeMs, loaded: true });
        } else {
          database.sources.push({ path: full, type: cached.meta.type || 'csv', size: stats.size, mtimeMs: stats.mtimeMs, loaded: false });
        }
        continue;
      }

      console.log('[LOAD] Analyse nouvelle ou modifiee :', f);
      const fileProfiles = [];
      const fd = fs.openSync(full, 'r');
      const headSize = Math.min(4096, stats.size);
      const buf = Buffer.alloc(headSize);
      fs.readSync(fd, buf, 0, headSize, 0);
      fs.closeSync(fd);
      let head = buf.toString('utf8');
      if (head.charCodeAt(0) === 0xFEFF) head = head.slice(1);
      const type = detectFileType(head, stats);

      if (type === 'csv') {
        console.log(`[LOAD] Format detecte: CSV -> ${f}`);
        await parseCsvFile(full, fileProfiles);
      } else if (type === 'ndjson') {
        console.log(`[LOAD] Format detecte: NDJSON -> ${f}`);
        await parseNdjsonFile(full, fileProfiles);
      } else if (type === 'json-array') {
        console.log(`[LOAD] Format detecte: JSON array stream -> ${f}`);
        await new Promise((resolve) => {
          const pipeline = chain([fs.createReadStream(full), parser(), streamArray()]);
          pipeline.on('data', ({ value }) => {
            const item = value || {};
            fileProfiles.push(mapItemToProfil(item, full));
          });
          pipeline.on('end', () => resolve());
          pipeline.on('error', (err) => {
            console.error('[ERREUR JSON stream]', f, err && err.message);
            resolve();
          });
        });
      } else {
        console.log(`[LOAD] Format fallback (JSON/CSV) -> ${f}`);
        let raw = fs.readFileSync(full, 'utf8');
        if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);

        if (head.trim().startsWith('{') || head.trim().startsWith('[')) {
          let j = null;
          try {
            j = JSON.parse(raw);
          } catch (err) {
            console.error('[ERREUR JSON]', f, err && err.message);
            continue;
          }
          let arr = null;
          if (Array.isArray(j)) arr = j;
          else if (j && typeof j === 'object') {
            for (const k of Object.keys(j)) {
              if (Array.isArray(j[k])) {
                arr = j[k];
                break;
              }
            }
          }

          if (!arr) continue;
          for (const item of arr) {
            fileProfiles.push(mapItemToProfil(item, full));
          }
        } else {
          await parseCsvText(raw, full, fileProfiles);
        }
      }

      if (fileProfiles.length > 0) {
        const chunkSize = 10000;
        for (let i = 0; i < fileProfiles.length; i += chunkSize) {
          database.profiles.push(...fileProfiles.slice(i, i + chunkSize));
        }
      }
      database.sources.push({ path: full, type, size: stats.size, mtimeMs: stats.mtimeMs, loaded: true });
      writeCacheData(cacheFile, { size: stats.size, mtimeMs: stats.mtimeMs, type }, fileProfiles);
      console.log(`[LOAD] Fichier termine: ${f} (${fileProfiles.length} profils)`);
    } catch (e) {
      console.error('[ERREUR FICHIER]', f, e && e.message);
    }
  }

  return database;
}

async function searchProfils(database, query, options = {}) {
  const limit = options.limit || Infinity;
  const results = [];

  if (Array.isArray(database)) {
    for (const p of database) {
      if (results.length >= limit) break;
      if (profileMatches(p, query)) results.push(p);
    }
    return results;
  }

  for (const p of database.profiles || []) {
    if (results.length >= limit) break;
    if (profileMatches(p, query)) results.push(p);
  }

  for (const source of database.sources || []) {
    if (results.length >= limit) break;
    if (source.loaded) continue;
    await searchFileSource(source, query, results, limit);
  }

  return results;
}

async function parseCsvFile(full, database) {
  await new Promise((resolve) => {
    const parser = csvParse({ columns: true, relax_quotes: true, skip_empty_lines: true, trim: true });
    const input = fs.createReadStream(full, { encoding: 'utf8' });
    input.pipe(parser);

    parser.on('readable', () => {
      let record;
      while ((record = parser.read()) !== null) {
        database.push(mapItemToProfil(record, full));
      }
    });

    parser.on('error', (err) => {
      console.error('[ERREUR CSV]', full, err && err.message);
      resolve();
    });

    parser.on('end', () => resolve());
  });
}

async function parseCsvText(raw, full, database) {
  await new Promise((resolve) => {
    const parser = csvParse({ columns: true, relax_quotes: true, skip_empty_lines: true, trim: true });
    parser.write(raw);
    parser.end();

    parser.on('readable', () => {
      let record;
      while ((record = parser.read()) !== null) {
        database.push(mapItemToProfil(record, full));
      }
    });

    parser.on('error', (err) => {
      console.error('[ERREUR CSV]', full, err && err.message);
      resolve();
    });

    parser.on('end', () => resolve());
  });
}

async function parseNdjsonFile(full, database) {
  const rl = readline.createInterface({ input: fs.createReadStream(full, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const item = JSON.parse(trimmed);
      database.push(mapItemToProfil(item, full));
    } catch (err) {
      console.error('[ERREUR JSONL]', full, err && err.message);
      continue;
    }
  }
}

module.exports = { loadDatabases, searchProfils };

// Helper: map various possible field names to expected profil fields
function mapItemToProfil(item, sourcePath) {
  const get = (obj, candidates, fallback) => {
    for (const k of candidates) {
      if (obj[k] !== undefined && obj[k] !== null) return obj[k];
    }
    return fallback;
  };

  let nom = get(item, ['nom', 'lastName', 'lastname', 'surname', 'familyName', 'Nom_1', 'Nom complet', 'nom_complet', 'Name'], 'INCONNU');
  let prenom = get(item, ['prenom', 'firstName', 'firstname', 'givenName', 'Prénom_1'], 'INCONNU');
  const fullName = get(item, ['Nom complet', 'nom_complet', 'fullName', 'FullName'], null);
  if ((nom === 'INCONNU' || prenom === 'INCONNU') && fullName) {
    const tokens = String(fullName).trim().split(/\s+/);
    if (tokens.length >= 2) {
      nom = nom === 'INCONNU' ? tokens[0] : nom;
      prenom = prenom === 'INCONNU' ? tokens.slice(1).join(' ') : prenom;
    } else if (tokens.length === 1) {
      nom = nom === 'INCONNU' ? tokens[0] : nom;
    }
  }

  let age = Number(get(item, ['age', ' Age', 'age_years', 'years', 'Année de naissance', 'annee_naissance', 'birthYear'], 0)) || 0;
  if (age === 0) {
    const dateValue = get(item, ['Né(e) le', 'datenaissance', 'date_naissance', 'dateOfBirth'], null);
    if (dateValue) {
      const match = String(dateValue).match(/(\d{4})$/);
      if (match) age = Number(match[1]) || 0;
      else {
        const dateMatch = String(dateValue).match(/\b(\d{2})[\/\-](\d{2})[\/\-](\d{4})\b/);
        if (dateMatch) age = Number(dateMatch[3]) || 0;
      }
    }
  }
  const email = get(item, ['email', 'mail', 'emailAddress', 'Email principal', 'Email officiel', 'Email'], 'AUCUN');
  const telephone = get(item, ['telephone', 'phone', 'tel', 'Téléphone domicile', 'Téléphone travail', 'Mobile personnel', 'Mobile travail', 'Phone1', 'Phone2'], 'AUCUN');
  const adresse = get(item, ['adresse', 'address', 'street', 'Adresse', 'Voie-rue', 'adresse_complete'], 'AUCUNE');
  const ville = get(item, ['ville', 'city', 'town', 'commune', 'Bureau distributeur', 'Structure'], 'AUCUNE');
  const username = get(item, ['username', 'user', 'login'], 'AUCUN');

  return {
    nom: String(nom),
    prenom: String(prenom),
    age: age,
    email: String(email),
    telephone: String(telephone),
    adresse: String(adresse),
    ville: String(ville),
    username: String(username),
    sourceDB: sourcePath
  };
}
