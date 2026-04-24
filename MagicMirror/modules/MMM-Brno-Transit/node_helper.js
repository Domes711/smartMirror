/* MMM-Brno-Transit — node_helper
 *
 * Downloads the IDS JMK GTFS zip from data.brno.cz, indexes the parts we
 * care about, and answers "next N departures of line L in direction D
 * from stop S" queries on a refresh tick.
 *
 * Cache: zip + extracted txt files live under <module>/cache/. The zip is
 * re-downloaded after gtfsRefreshHours.
 */

const NodeHelper = require("node_helper");
const Log = require("logger");
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

const CACHE_DIR_NAME = "cache";
const ZIP_NAME = "gtfs.zip";
const FILES = {
    stops: "stops.txt",
    routes: "routes.txt",
    trips: "trips.txt",
    stopTimes: "stop_times.txt",
    calendar: "calendar.txt",
    calendarDates: "calendar_dates.txt"
};

// GTFS route_type → human label
const ROUTE_TYPE = {
    0: "tram",
    1: "subway",
    2: "rail",
    3: "bus",
    4: "ferry",
    11: "trolleybus"
};

module.exports = NodeHelper.create({

    start: function () {
        this.cacheDir = path.join(this.path, CACHE_DIR_NAME);
        this.indexes = null;
        this.config = null;
        this.refreshTimer = null;
        this.gtfsTimer = null;
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
        await this._ensureGtfs();
        this._buildIndexes();
        this._scheduleRefresh();
        this._scheduleGtfsRefresh();
        this._tick();
    },

    _ensureGtfs: async function () {
        const zipPath = path.join(this.cacheDir, ZIP_NAME);
        const ttlMs = (this.config.gtfsRefreshHours || 168) * 3600 * 1000;
        const fresh = fs.existsSync(zipPath)
            && (Date.now() - fs.statSync(zipPath).mtimeMs) < ttlMs;
        if (!fresh) {
            Log.info("[MMM-Brno-Transit] downloading GTFS:", this.config.gtfsUrl);
            const res = await fetch(this.config.gtfsUrl);
            if (!res.ok) throw new Error(`GTFS download HTTP ${res.status}`);
            const buf = Buffer.from(await res.arrayBuffer());
            fs.writeFileSync(zipPath, buf);
            // Extract only the files we need
            const zip = new AdmZip(zipPath);
            for (const name of Object.values(FILES)) {
                const entry = zip.getEntry(name);
                if (!entry) throw new Error("GTFS missing " + name);
                fs.writeFileSync(path.join(this.cacheDir, name), entry.getData());
            }
            Log.info("[MMM-Brno-Transit] GTFS extracted");
        } else {
            Log.info("[MMM-Brno-Transit] using cached GTFS (age "
                + Math.round((Date.now() - fs.statSync(zipPath).mtimeMs) / 3600000)
                + " h)");
        }
    },

    _scheduleGtfsRefresh: function () {
        if (this.gtfsTimer) clearInterval(this.gtfsTimer);
        const ttlMs = (this.config.gtfsRefreshHours || 168) * 3600 * 1000;
        this.gtfsTimer = setInterval(async () => {
            try {
                await this._ensureGtfs();
                this._buildIndexes();
                this._tick();
            } catch (err) {
                Log.error("[MMM-Brno-Transit] GTFS refresh failed:", err);
            }
        }, ttlMs);
    },

    _scheduleRefresh: function () {
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        const ms = (this.config.refreshSec || 60) * 1000;
        this.refreshTimer = setInterval(() => this._tick(), ms);
    },

    // --- indexing -----------------------------------------------------------

    _buildIndexes: function () {
        const read = (name) => fs.readFileSync(
            path.join(this.cacheDir, name), "utf-8");

        const stops = parseCsv(read(FILES.stops));
        const routes = parseCsv(read(FILES.routes));
        const calendar = parseCsv(read(FILES.calendar));
        const calendarDates = parseCsv(read(FILES.calendarDates));

        // 1. Stops matching the configured name (case-insensitive). Brno
        //    IDS stops have one stop_id per platform/direction, all sharing
        //    the same stop_name.
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

        // 2. Routes by short_name → for the lines we want.
        const wantedLines = new Map();        // line -> { dirId? }
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

        // 3. Trips for those routes (load fully — much smaller than stop_times).
        const trips = parseCsv(read(FILES.trips));
        const tripsById = {};
        for (const t of trips) {
            if (!wantedRouteIds.has(t.route_id)) continue;
            tripsById[t.trip_id] = {
                routeId: t.route_id,
                serviceId: t.service_id,
                directionId: Number(t.direction_id),
                headsign: t.trip_headsign || ""
            };
        }

        // 4. Stop times for those trips at our stops, streamed from the file.
        //    Pre-built: trip_id -> [{stopId, secs}], one entry per relevant stop.
        const stopTimesByTrip = {};
        const stopTimesRaw = read(FILES.stopTimes);
        const lines = stopTimesRaw.split(/\r?\n/);
        const header = parseCsvLine(lines[0]);
        const idxTrip = header.indexOf("trip_id");
        const idxStop = header.indexOf("stop_id");
        const idxDep = header.indexOf("departure_time");
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;
            const cells = parseCsvLine(line);
            const tripId = cells[idxTrip];
            if (!tripsById[tripId]) continue;
            const stopId = cells[idxStop];
            if (!stopIdSet.has(stopId)) continue;
            const secs = parseGtfsTime(cells[idxDep]);
            (stopTimesByTrip[tripId] = stopTimesByTrip[tripId] || []).push({
                stopId, secs
            });
        }

        // 5. Service calendar.
        const serviceDays = {};
        for (const c of calendar) {
            serviceDays[c.service_id] = {
                start: c.start_date,                  // YYYYMMDD
                end: c.end_date,
                days: [
                    Number(c.sunday), Number(c.monday), Number(c.tuesday),
                    Number(c.wednesday), Number(c.thursday), Number(c.friday),
                    Number(c.saturday)
                ],
                exceptions: {}                         // YYYYMMDD -> 1|2
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
            + `${Object.keys(stopTimesByTrip).length} stop_times`
        );
        this._logDiscoveredDirections();
    },

    _logDiscoveredDirections: function () {
        // Helps the user pick directionId.
        const seen = {}; // line -> { dirId -> headsign sample }
        for (const tripId of Object.keys(this.indexes.tripsById)) {
            const tr = this.indexes.tripsById[tripId];
            if (!this.indexes.stopTimesByTrip[tripId]) continue;
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
        const horizonSec = 12 * 3600; // look 12 h ahead
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
                // Today branch: trip's service active today, departure ahead.
                if (this._serviceActive(trip.serviceId, todayStr)
                    && st.secs >= nowSecToday
                    && st.secs - nowSecToday <= horizonSec) {
                    matches.push({
                        epochSec: nowSecToday + (st.secs - nowSecToday),
                        absSec: st.secs,
                        date: todayStr
                    });
                }
                // Yesterday-after-midnight branch: GTFS times >24:00 belong to
                // services that started "yesterday" but depart today.
                if (this._serviceActive(trip.serviceId, yestStr)
                    && st.secs >= 24 * 3600
                    && (st.secs - 24 * 3600) >= nowSecToday
                    && (st.secs - 24 * 3600) - nowSecToday <= horizonSec) {
                    matches.push({
                        epochSec: nowSecToday + ((st.secs - 24*3600) - nowSecToday),
                        absSec: st.secs - 24 * 3600,
                        date: todayStr
                    });
                }
            }
        }

        matches.sort((a, b) => a.absSec - b.absSec);
        return matches.slice(0, perLine).map((m) => ({
            secsFromNow: m.absSec - nowSecToday,
            displayHm: secsToHm(m.absSec)
        }));
    },

    _serviceActive: function (serviceId, dateStr) {
        const sd = this.indexes.serviceDays[serviceId];
        if (!sd) return false;
        const ex = sd.exceptions[dateStr];
        if (ex === 1) return true;
        if (ex === 2) return false;
        if (!sd.start || dateStr < sd.start || dateStr > sd.end) return false;
        const dow = dayOfWeek(dateStr);   // 0..6, sunday=0 to match GTFS array
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
    // HH:MM:SS where HH may be > 23. Returns seconds from midnight (may exceed 86400).
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
    return new Date(y, m, d).getDay(); // 0 = Sunday
}
