/* MMM-Brno-Transit — node_helper
 *
 * Combines two sources:
 *   1. GTFS static (data.brno.cz) — scheduled departures per line+direction
 *   2. IDSJMK live vehicles (mapa.idsjmk.cz/api/vehicles) — current vehicles
 *      with explicit Delay per active trip; HTTP poll on a short interval.
 *
 * The vehicles API uses integer node IDs (e.g. 1746) while GTFS uses
 * 'U<node>Z<platform>' strings (e.g. 'U1746Z1'). The indexer derives a
 * finalNodeId and seqByNode for each trip so the matcher can compare
 * integer-to-integer.
 *
 * For every scheduled departure we try to match a live vehicle running
 * that exact route variant (same line, same final-stop node, hasn't
 * passed our stop yet). If matched, the vehicle's delay is added so
 * "X min" reflects what the bus/tram will actually do, not what the
 * timetable claims.
 */

const NodeHelper = require("node_helper");
const Log = require("logger");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const AdmZip = require("adm-zip");

const CACHE_DIR_NAME = "cache";
const ZIP_NAME = "gtfs.zip";
const COMPILED_NAME = "compiled.json";
const META_NAME = "meta.json";
const COMPILED_VERSION = 3;
const FILES = {
    stops: "stops.txt",
    routes: "routes.txt",
    trips: "trips.txt",
    stopTimes: "stop_times.txt",
    calendar: "calendar.txt",
    calendarDates: "calendar_dates.txt"
};
const DEFAULT_REALTIME_URL = "https://mapa.idsjmk.cz/api/vehicles";
const DEFAULT_TOKEN_PAGE_URL = "https://mapa.idsjmk.cz/";
const DEFAULT_REALTIME_REFRESH_SEC = 15;

const ROUTE_TYPE = {
    0: "tram", 1: "subway", 2: "rail", 3: "bus", 4: "ferry", 11: "trolleybus"
};

module.exports = NodeHelper.create({

    start: function () {
        this.cacheDir = path.join(this.path, CACHE_DIR_NAME);
        this.indexes = null;
        this.config = null;
        this.refreshTimer = null;
        this.gtfsTimer = null;

        // Real-time state — polling IDSJMK /api/vehicles
        this.accessToken = null;
        this.realtimePollTimer = null;
        this.vehicleCache = new Map();      // id -> { attrs }
        this._realtimeFirstPoll = false;
    },

    socketNotificationReceived: function (notification, payload) {
        if (notification === "MMBT_INIT") {
            this.config = payload;
            this._bootstrap().catch((err) => {
                Log.error("[MMM-Brno-Transit] bootstrap failed:", err);
                this.sendSocketNotification("MMBT_ERROR", String(err.message || err));
            });
        }
    },

    // --- bootstrap ----------------------------------------------------------

    _bootstrap: async function () {
        if (!this.config.gtfsUrl || this.config.gtfsUrl.includes("FILL_IN")) {
            throw new Error(
                "gtfsUrl is not configured. Open " +
                "https://data.brno.cz/datasets/379d2e9a7907460c8ca7fda1f3e84328 " +
                "and copy the direct .zip download link into config.gtfsUrl."
            );
        }
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
        await this._loadGtfsIndex();
        this._scheduleRefresh();
        this._scheduleGtfsRefresh();
        this._startRealtimePolling();
        this._tick();
    },

    /**
     * Load or rebuild the GTFS index.
     *
     *   1. If compiled.json exists + meta says it matches current config
     *      + is within TTL → load it directly (no download, no re-parse).
     *   2. Otherwise → download zip, extract the 6 GTFS txt files, parse
     *      them into the slim in-memory index, write compiled.json +
     *      meta.json, then delete the zip and the .txt files from disk.
     *
     * This keeps the cache dir at a few MB between refreshes instead of
     * ~250 MB of raw GTFS.
     */
    _loadGtfsIndex: async function () {
        const ttlMs = (this.config.gtfsRefreshHours || 168) * 3600 * 1000;
        const meta = this._readMeta();
        const compiledPath = path.join(this.cacheDir, COMPILED_NAME);
        const cfgHash = this._configHash();

        const reusable = meta
            && meta.version === COMPILED_VERSION
            && meta.configHash === cfgHash
            && (Date.now() - meta.compiledAt) < ttlMs
            && fs.existsSync(compiledPath);

        if (reusable) {
            try {
                this._loadCompiled(compiledPath);
                Log.info("[MMM-Brno-Transit] using cached compiled index (age "
                    + Math.round((Date.now() - meta.compiledAt) / 3600000) + " h)");
                return;
            } catch (err) {
                Log.warn("[MMM-Brno-Transit] compiled.json unusable, re-parsing:", err.message);
            }
        }

        await this._downloadAndExtract();
        this._parseAndBuildIndexes();
        this._saveCompiled(compiledPath, cfgHash);
        this._cleanRawGtfs();
    },

    _downloadAndExtract: async function () {
        Log.info("[MMM-Brno-Transit] downloading GTFS:", this.config.gtfsUrl);
        const res = await fetch(this.config.gtfsUrl);
        if (!res.ok) throw new Error(`GTFS download HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const zipPath = path.join(this.cacheDir, ZIP_NAME);
        fs.writeFileSync(zipPath, buf);
        const zip = new AdmZip(zipPath);
        for (const name of Object.values(FILES)) {
            const entry = zip.getEntry(name);
            if (!entry) throw new Error("GTFS missing " + name);
            fs.writeFileSync(path.join(this.cacheDir, name), entry.getData());
        }
        Log.info("[MMM-Brno-Transit] GTFS extracted");
    },

    _scheduleGtfsRefresh: function () {
        if (this.gtfsTimer) clearInterval(this.gtfsTimer);
        const ttlMs = (this.config.gtfsRefreshHours || 168) * 3600 * 1000;
        this.gtfsTimer = setInterval(async () => {
            try {
                await this._loadGtfsIndex();
                this._tick();
            } catch (err) {
                Log.error("[MMM-Brno-Transit] GTFS refresh failed:", err);
            }
        }, ttlMs);
    },

    // --- compiled cache helpers --------------------------------------------

    _configHash: function () {
        const relevant = {
            stopName: this.config.stopName,
            stopId: this.config.stopId || null,
            lines: this.config.lines || [],
            gtfsUrl: this.config.gtfsUrl
        };
        return crypto.createHash("sha256")
            .update(JSON.stringify(relevant))
            .digest("hex");
    },

    _readMeta: function () {
        const p = path.join(this.cacheDir, META_NAME);
        if (!fs.existsSync(p)) return null;
        try { return JSON.parse(fs.readFileSync(p, "utf-8")); }
        catch (_) { return null; }
    },

    _loadCompiled: function (compiledPath) {
        const raw = JSON.parse(fs.readFileSync(compiledPath, "utf-8"));
        this.indexes = {
            routesById: raw.routesById,
            tripsById: raw.tripsById,
            stopTimesByTrip: raw.stopTimesByTrip,
            serviceDays: raw.serviceDays,
            wantedLines: new Map(raw.wantedLinesEntries),
            stopIdSet: new Set(raw.stopIdArray)
        };
        this._logDiscoveredDirections();
    },

    _saveCompiled: function (compiledPath, cfgHash) {
        const toSerialize = {
            routesById: this.indexes.routesById,
            tripsById: this.indexes.tripsById,
            stopTimesByTrip: this.indexes.stopTimesByTrip,
            serviceDays: this.indexes.serviceDays,
            wantedLinesEntries: Array.from(this.indexes.wantedLines.entries()),
            stopIdArray: Array.from(this.indexes.stopIdSet)
        };
        fs.writeFileSync(compiledPath, JSON.stringify(toSerialize));
        fs.writeFileSync(path.join(this.cacheDir, META_NAME), JSON.stringify({
            version: COMPILED_VERSION,
            compiledAt: Date.now(),
            configHash: cfgHash
        }));
        const size = Math.round(fs.statSync(compiledPath).size / 1024);
        Log.info(`[MMM-Brno-Transit] compiled index saved (${size} KB)`);
    },

    _cleanRawGtfs: function () {
        const names = [ZIP_NAME, ...Object.values(FILES)];
        let freed = 0;
        for (const n of names) {
            const p = path.join(this.cacheDir, n);
            try {
                freed += fs.statSync(p).size;
                fs.unlinkSync(p);
            } catch (_) { /* missing is fine */ }
        }
        if (freed > 0) {
            Log.info(`[MMM-Brno-Transit] cleaned raw GTFS (freed ${Math.round(freed / 1024 / 1024)} MB)`);
        }
    },

    _scheduleRefresh: function () {
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        const ms = (this.config.refreshSec || 60) * 1000;
        this.refreshTimer = setInterval(() => this._tick(), ms);
    },

    // --- GTFS indexing ------------------------------------------------------

    _parseAndBuildIndexes: function () {
        const read = (name) => fs.readFileSync(path.join(this.cacheDir, name), "utf-8");

        const stops = parseCsv(read(FILES.stops));
        const routes = parseCsv(read(FILES.routes));
        const calendar = parseCsv(read(FILES.calendar));
        const calendarDates = parseCsv(read(FILES.calendarDates));

        // 1. Target stops
        const wantedName = this.config.stopName.toLowerCase().trim();
        const stopIdSet = new Set();
        for (const s of stops) {
            if (this.config.stopId && s.stop_id === this.config.stopId) {
                stopIdSet.add(s.stop_id);
            } else if (!this.config.stopId
                && (s.stop_name || "").toLowerCase().trim() === wantedName) {
                stopIdSet.add(s.stop_id);
            }
        }
        if (stopIdSet.size === 0) {
            throw new Error("No stops matched: " + this.config.stopName);
        }

        // 2. Target routes
        const wantedLines = new Map();
        for (const l of (this.config.lines || [])) {
            wantedLines.set(String(l.line), l);
        }
        const routesById = {};
        const wantedRouteIds = new Set();
        for (const r of routes) {
            routesById[r.route_id] = {
                routeType: Number(r.route_type),
                shortName: r.route_short_name
            };
            if (wantedLines.has(r.route_short_name)) {
                wantedRouteIds.add(r.route_id);
            }
        }

        // 3. Trips on those routes
        const trips = parseCsv(read(FILES.trips));
        const tripsById = {};
        for (const t of trips) {
            if (!wantedRouteIds.has(t.route_id)) continue;
            tripsById[t.trip_id] = {
                routeId: t.route_id,
                serviceId: t.service_id,
                directionId: Number(t.direction_id),
                headsign: t.trip_headsign || "",
                finalStopId: null,          // filled in below (string, e.g. 'U1086Z2')
                finalNodeId: null,          // numeric node form (e.g. 1086) for matcher
                ourStopSeq: null,           // filled in below
                seqByStop: {},              // tmp: stopId -> sequence (dropped after seqByNode build)
                seqByNode: {}               // node -> max sequence (used by IDSJMK matcher)
            };
        }

        // 4. Stop times for those trips — keep every stop (not just ours) so
        //    we can map vehicle.laststopid back to a sequence number.
        let stopTimesRaw = read(FILES.stopTimes);
        if (stopTimesRaw.charCodeAt(0) === 0xFEFF) stopTimesRaw = stopTimesRaw.slice(1);
        const lines = stopTimesRaw.split(/\r?\n/);
        const header = parseCsvLine(lines[0]);
        const idxTrip = header.indexOf("trip_id");
        const idxStop = header.indexOf("stop_id");
        const idxDep = header.indexOf("departure_time");
        const idxSeq = header.indexOf("stop_sequence");

        // per-trip metadata while scanning
        const tripMaxSeq = {};
        const tripMaxSeqStop = {};
        const stopTimesByTrip = {};         // tripId -> [{stopId, secs, seq}] (only for our target stops, used for queries)

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;
            const cells = parseCsvLine(line);
            const tripId = cells[idxTrip];
            if (!tripsById[tripId]) continue;

            const stopId = cells[idxStop];
            const seq = Number(cells[idxSeq]);
            const secs = parseGtfsTime(cells[idxDep]);

            tripsById[tripId].seqByStop[stopId] = seq;
            if (tripMaxSeq[tripId] === undefined || seq > tripMaxSeq[tripId]) {
                tripMaxSeq[tripId] = seq;
                tripMaxSeqStop[tripId] = stopId;
            }

            if (stopIdSet.has(stopId)) {
                (stopTimesByTrip[tripId] = stopTimesByTrip[tripId] || []).push({
                    stopId, secs, seq
                });
                tripsById[tripId].ourStopSeq = seq;
            }
        }
        for (const tripId of Object.keys(tripsById)) {
            const trip = tripsById[tripId];
            trip.finalStopId = tripMaxSeqStop[tripId] || null;
            trip.finalNodeId = nodeIdFromGtfsStopId(trip.finalStopId);
            for (const sid of Object.keys(trip.seqByStop)) {
                const nid = nodeIdFromGtfsStopId(sid);
                if (nid == null) continue;
                const seq = trip.seqByStop[sid];
                if (trip.seqByNode[nid] === undefined || seq > trip.seqByNode[nid]) {
                    trip.seqByNode[nid] = seq;
                }
            }
            delete trip.seqByStop;          // saved cache size; matcher uses seqByNode
        }

        // 5. Service calendar
        const serviceDays = {};
        for (const c of calendar) {
            serviceDays[c.service_id] = {
                start: c.start_date,
                end: c.end_date,
                days: [
                    Number(c.sunday), Number(c.monday), Number(c.tuesday),
                    Number(c.wednesday), Number(c.thursday), Number(c.friday),
                    Number(c.saturday)
                ],
                exceptions: {}
            };
        }
        for (const ex of calendarDates) {
            (serviceDays[ex.service_id] = serviceDays[ex.service_id]
                || { start: "", end: "", days: [0,0,0,0,0,0,0], exceptions: {} })
                .exceptions[ex.date] = Number(ex.exception_type);
        }

        this.indexes = {
            routesById,
            tripsById,
            stopTimesByTrip,
            serviceDays,
            wantedLines,
            stopIdSet
        };
        Log.info(
            `[MMM-Brno-Transit] indexed: ${stopIdSet.size} stop_ids, `
            + `${Object.keys(tripsById).length} trips, `
            + `${Object.keys(stopTimesByTrip).length} trips through our stop`
        );
        this._logDiscoveredDirections();
    },

    _logDiscoveredDirections: function () {
        const seen = {};
        for (const tripId of Object.keys(this.indexes.stopTimesByTrip)) {
            const tr = this.indexes.tripsById[tripId];
            if (!tr) continue;
            const route = this.indexes.routesById[tr.routeId];
            if (!route) continue;
            const line = route.shortName;
            seen[line] = seen[line] || {};
            if (!(tr.directionId in seen[line])) {
                seen[line][tr.directionId] = tr.headsign;
            }
        }
        Log.info("[MMM-Brno-Transit] directions found at " + this.config.stopName + ":");
        for (const line of Object.keys(seen)) {
            for (const dir of Object.keys(seen[line]).sort()) {
                Log.info(`  line ${line}, directionId ${dir} → "${seen[line][dir]}"`);
            }
        }
    },

    // --- real-time HTTP polling (IDSJMK) ------------------------------------

    _startRealtimePolling: function () {
        const refreshSec = this.config.realtimeRefreshSec || DEFAULT_REALTIME_REFRESH_SEC;
        const tick = () => this._pollRealtimeOnce().catch((err) => {
            Log.warn("[MMM-Brno-Transit] realtime poll failed:", err.message);
        });
        if (this.realtimePollTimer) clearInterval(this.realtimePollTimer);
        tick();
        this.realtimePollTimer = setInterval(tick, refreshSec * 1000);
    },

    _pollRealtimeOnce: async function () {
        const url = this.config.realtimeUrl || DEFAULT_REALTIME_URL;
        if (!this.accessToken) this.accessToken = await this._fetchAccessToken();

        const doFetch = () => fetch(url, {
            headers: {
                "X-Access-Token": this.accessToken,
                "User-Agent": "MMM-Brno-Transit"
            }
        });

        let res = await doFetch();
        if (res.status === 403) {
            // Token may have rotated since last poll — refetch and retry once.
            this.accessToken = await this._fetchAccessToken();
            res = await doFetch();
        }
        if (!res.ok) throw new Error("HTTP " + res.status);

        const obj = await res.json();
        const arr = (obj && obj.Vehicles) || [];
        const map = new Map();
        for (const v of arr) {
            if (v.IsInactive) continue;
            const id = v.ID != null ? String(v.ID) : null;
            if (!id) continue;
            // PascalCase API → lowercase fields the matcher reads.
            map.set(id, {
                attrs: {
                    id: v.ID,
                    linename: v.LineName,
                    finalstopid: v.FinalStopID,
                    laststopid: v.LastStopID,
                    delay: v.Delay,
                    isinactive: v.IsInactive
                }
            });
        }
        this.vehicleCache = map;

        if (!this._realtimeFirstPoll) {
            this._realtimeFirstPoll = true;
            Log.info(`[MMM-Brno-Transit] realtime polling active — ${map.size} vehicles`);
        }
    },

    _fetchAccessToken: async function () {
        const url = this.config.realtimeTokenUrl || DEFAULT_TOKEN_PAGE_URL;
        const res = await fetch(url);
        if (!res.ok) throw new Error("token-page HTTP " + res.status);
        const html = await res.text();
        const m = html.match(/initializeApplication\s*\(\s*['"]([^'"]+)['"]\s*\)/);
        if (!m) throw new Error("X-Access-Token not found in " + url);
        return m[1];
    },

    // --- query --------------------------------------------------------------

    _tick: function () {
        if (!this.indexes) return;
        const now = new Date();
        const departures = [];
        for (const [line, cfg] of this.indexes.wantedLines) {
            const route = Object.values(this.indexes.routesById)
                .find((r) => r.shortName === line);
            if (!route) {
                departures.push({ line, mode: null, items: [], note: "neznámá linka" });
                continue;
            }
            const items = this._nextDepartures(line, cfg.directionId, now);
            departures.push({
                line,
                mode: ROUTE_TYPE[route.routeType] || "bus",
                items
            });
        }
        this.sendSocketNotification("MMBT_DEPARTURES", {
            stopName: this.config.stopName,
            departures,
            generatedAt: now.toISOString()
        });
    },

    _nextDepartures: function (line, directionId, now) {
        const perLine = this.config.perLine || 2;
        const horizonSec = 12 * 3600;
        const nowSecToday = now.getHours() * 3600
            + now.getMinutes() * 60 + now.getSeconds();
        const todayStr = ymd(now);
        const yestStr = ymd(addDays(now, -1));

        const matches = [];
        for (const tripId of Object.keys(this.indexes.stopTimesByTrip)) {
            const trip = this.indexes.tripsById[tripId];
            if (!trip) continue;
            const route = this.indexes.routesById[trip.routeId];
            if (!route || route.shortName !== line) continue;
            if (directionId !== undefined && trip.directionId !== directionId) continue;

            for (const st of this.indexes.stopTimesByTrip[tripId]) {
                if (this._serviceActive(trip.serviceId, todayStr)
                    && st.secs >= nowSecToday
                    && st.secs - nowSecToday <= horizonSec) {
                    matches.push({ tripId, absSec: st.secs });
                }
                if (this._serviceActive(trip.serviceId, yestStr)
                    && st.secs >= 24 * 3600) {
                    const todayActual = st.secs - 24 * 3600;
                    if (todayActual >= nowSecToday
                        && todayActual - nowSecToday <= horizonSec) {
                        matches.push({ tripId, absSec: todayActual });
                    }
                }
            }
        }

        matches.sort((a, b) => a.absSec - b.absSec);
        const nowMs = now.getTime();
        // +2 buffer so the frontend can skip departures that have ticked down
        // to "0 min" between helper refreshes and still show `perLine` items.
        return matches.slice(0, perLine + 2).map((m) => {
            const vehicle = this._matchVehicle(m.tripId, line);
            const scheduledSecs = m.absSec;
            const delayMin = vehicle ? Number(vehicle.attrs.delay) || 0 : null;
            const actualSecs = scheduledSecs + (delayMin || 0) * 60;
            // Absolute arrival timestamp so the frontend can refresh the
            // "X min" countdown on each render, without waiting for the
            // next helper tick.
            const arrivalMs = nowMs + (actualSecs - nowSecToday) * 1000;
            return {
                arrivalMs,
                displayHm: secsToHm(actualSecs),
                realtime: vehicle !== null,
                delayMin,
                scheduledHm: delayMin ? secsToHm(scheduledSecs) : null
            };
        });
    },

    _matchVehicle: function (tripId, line) {
        const trip = this.indexes.tripsById[tripId];
        if (!trip || trip.finalNodeId == null || trip.ourStopSeq == null) return null;

        let best = null;
        for (const v of this.vehicleCache.values()) {
            const a = v.attrs;
            if (String(a.linename) !== String(line)) continue;
            if (Number(a.finalstopid) !== trip.finalNodeId) continue;
            const lastSeq = trip.seqByNode[String(a.laststopid)];
            if (lastSeq == null) continue;              // vehicle on a different route variant
            if (lastSeq >= trip.ourStopSeq) continue;   // vehicle has passed our stop already
            // Prefer the vehicle closest to our stop (highest sequence < ours).
            if (!best || lastSeq > best.lastSeq) best = { attrs: a, lastSeq };
        }
        return best ? { attrs: best.attrs } : null;
    },

    _serviceActive: function (serviceId, dateStr) {
        const sd = this.indexes.serviceDays[serviceId];
        if (!sd) return false;
        const ex = sd.exceptions[dateStr];
        if (ex === 1) return true;
        if (ex === 2) return false;
        if (!sd.start || dateStr < sd.start || dateStr > sd.end) return false;
        const dow = dayOfWeek(dateStr);
        return sd.days[dow] === 1;
    }
});


// --- helpers --------------------------------------------------------------

function parseCsv(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const lines = text.split(/\r?\n/);
    if (lines.length === 0) return [];
    const headers = parseCsvLine(lines[0]);
    const out = [];
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i]) continue;
        const cells = parseCsvLine(lines[i]);
        if (cells.length !== headers.length) continue;
        const obj = {};
        for (let j = 0; j < headers.length; j++) obj[headers[j]] = cells[j];
        out.push(obj);
    }
    return out;
}

function parseCsvLine(line) {
    const out = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQ) {
            if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
            else if (c === '"') { inQ = false; }
            else cur += c;
        } else {
            if (c === '"') inQ = true;
            else if (c === ',') { out.push(cur); cur = ""; }
            else cur += c;
        }
    }
    out.push(cur);
    return out;
}

function parseGtfsTime(hms) {
    if (!hms) return -1;
    const p = hms.split(":");
    return Number(p[0]) * 3600 + Number(p[1]) * 60 + Number(p[2] || 0);
}

function secsToHm(secs) {
    const wrapped = ((secs % 86400) + 86400) % 86400;
    const h = Math.floor(wrapped / 3600);
    const m = Math.floor((wrapped % 3600) / 60);
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

function ymd(d) {
    return d.getFullYear().toString()
        + String(d.getMonth() + 1).padStart(2, "0")
        + String(d.getDate()).padStart(2, "0");
}

function addDays(d, n) {
    const out = new Date(d);
    out.setDate(out.getDate() + n);
    return out;
}

function dayOfWeek(yyyymmdd) {
    const y = Number(yyyymmdd.slice(0, 4));
    const m = Number(yyyymmdd.slice(4, 6)) - 1;
    const d = Number(yyyymmdd.slice(6, 8));
    return new Date(y, m, d).getDay();
}

// Extract numeric node id from GTFS stop_id like 'U1746Z1' or 'U01746Z01' -> 1746.
function nodeIdFromGtfsStopId(s) {
    if (!s) return null;
    const m = String(s).match(/^U0*(\d+)/);
    return m ? Number(m[1]) : null;
}
