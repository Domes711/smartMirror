/* MMM-Brno-Transit — node_helper
 *
 * Combines two sources:
 *   1. GTFS static (data.brno.cz) — scheduled departures per line+direction
 *   2. WebSocket vehicle stream (gis.brno.cz ArcGIS StreamServer) — live
 *      delay in minutes per vehicle
 *
 * For every scheduled departure we try to match a live vehicle running
 * that exact trip (same route, same final stop, hasn't passed our stop
 * yet). If matched, the vehicle's delay is added so "X min" reflects
 * what the bus/tram will actually do, not what the timetable claims.
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
const DEFAULT_REALTIME_URL =
    "wss://gis.brno.cz/ags4/rest/services/ODAE_public_transit_stream/StreamServer/subscribe";
const DEFAULT_VEHICLE_TTL_SEC = 60;
const WS_RECONNECT_BASE_MS = 2000;
const WS_RECONNECT_MAX_MS = 60000;

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

        // Real-time state
        this.ws = null;
        this.wsReconnectMs = WS_RECONNECT_BASE_MS;
        this.wsReconnectTimer = null;
        this.vehicleCache = new Map();      // vehicleId -> { attrs, seenAt }
        this.vehicleCleanupTimer = null;
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
        this._startRealtime();
        this._scheduleVehicleCleanup();
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

    // --- GTFS indexing ------------------------------------------------------

    _buildIndexes: function () {
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
                finalStopId: null,          // filled in below
                ourStopSeq: null,           // filled in below
                seqByStop: {}               // stopId -> sequence, for matching vehicle.laststopid
            };
        }

        // 4. Stop times for those trips — keep every stop (not just ours) so
        //    we can map vehicle.laststopid back to a sequence number.
        const stopTimesRaw = read(FILES.stopTimes);
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
            tripsById[tripId].finalStopId = tripMaxSeqStop[tripId] || null;
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

    // --- real-time WebSocket ------------------------------------------------

    _startRealtime: function () {
        const url = this.config.realtimeUrl || DEFAULT_REALTIME_URL;
        if (!url) return;
        // Lazy require so module also works if ws isn't installed.
        let WebSocket;
        try { WebSocket = require("ws"); }
        catch (e) {
            Log.warn("[MMM-Brno-Transit] 'ws' not installed — real-time disabled");
            return;
        }

        try {
            const ws = new WebSocket(url);
            this.ws = ws;

            ws.on("open", () => {
                Log.info("[MMM-Brno-Transit] real-time stream connected");
                this.wsReconnectMs = WS_RECONNECT_BASE_MS;
            });

            ws.on("message", (data) => this._onRealtimeMessage(data));

            ws.on("close", () => {
                Log.warn("[MMM-Brno-Transit] real-time stream closed, reconnecting in "
                    + Math.round(this.wsReconnectMs / 1000) + " s");
                this._scheduleReconnect();
            });

            ws.on("error", (err) => {
                Log.warn("[MMM-Brno-Transit] real-time error:", err.message);
                try { ws.close(); } catch (_) { /* ignore */ }
            });
        } catch (err) {
            Log.error("[MMM-Brno-Transit] real-time connect failed:", err);
            this._scheduleReconnect();
        }
    },

    _scheduleReconnect: function () {
        if (this.wsReconnectTimer) return;
        this.wsReconnectTimer = setTimeout(() => {
            this.wsReconnectTimer = null;
            this.wsReconnectMs = Math.min(this.wsReconnectMs * 2, WS_RECONNECT_MAX_MS);
            this._startRealtime();
        }, this.wsReconnectMs);
    },

    _onRealtimeMessage: function (data) {
        let obj;
        try { obj = JSON.parse(data.toString()); }
        catch (_) { return; }
        // Esri StreamServer sends { attributes: {...}, geometry: {...} }
        const a = obj.attributes || obj;
        if (!a) return;
        if (a.isinactive) return;

        const id = a.id != null ? String(a.id) : null;
        if (!id) return;

        this.vehicleCache.set(id, {
            attrs: a,
            seenAt: Date.now()
        });
    },

    _scheduleVehicleCleanup: function () {
        if (this.vehicleCleanupTimer) clearInterval(this.vehicleCleanupTimer);
        const ttlMs = (this.config.vehicleTtlSec || DEFAULT_VEHICLE_TTL_SEC) * 1000;
        this.vehicleCleanupTimer = setInterval(() => {
            const cutoff = Date.now() - ttlMs;
            for (const [id, v] of this.vehicleCache) {
                if (v.seenAt < cutoff) this.vehicleCache.delete(id);
            }
        }, Math.max(5000, ttlMs / 2));
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
        return matches.slice(0, perLine).map((m) => {
            const vehicle = this._matchVehicle(m.tripId, line);
            const scheduledSecs = m.absSec;
            const delayMin = vehicle ? Number(vehicle.attrs.delay) || 0 : null;
            const actualSecs = scheduledSecs + (delayMin || 0) * 60;
            return {
                secsFromNow: actualSecs - nowSecToday,
                displayHm: secsToHm(actualSecs),
                realtime: vehicle !== null,
                delayMin,
                scheduledHm: delayMin ? secsToHm(scheduledSecs) : null
            };
        });
    },

    _matchVehicle: function (tripId, line) {
        const trip = this.indexes.tripsById[tripId];
        if (!trip || trip.finalStopId == null || trip.ourStopSeq == null) return null;

        let best = null;
        for (const v of this.vehicleCache.values()) {
            const a = v.attrs;
            if (String(a.linename) !== String(line)) continue;
            if (String(a.finalstopid) !== String(trip.finalStopId)) continue;
            const lastSeq = trip.seqByStop[String(a.laststopid)];
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
