/* MMM-Profile — node_helper
 *
 * Mounts a single HTTP POST route on MagicMirror's Express app and
 * forwards every event to the frontend via socket notification.
 *
 *   POST /mmm-profile/event
 *     Content-Type: application/json
 *     Body:
 *       { "event": "presence_on" }
 *       { "event": "presence_off" }
 *       { "event": "user_recognized", "user": "Domes" }
 *       { "event": "user_unknown" }
 *
 * Responses:
 *   204 No Content  on success
 *   400             on a missing/malformed body
 */

const NodeHelper = require("node_helper");
const Log = require("logger");
const express = require("express");

const ROUTE = "/mmm-profile/event";

module.exports = NodeHelper.create({

    start: function () {
        // express.json() applied per-route so we don't disturb other modules.
        this.expressApp.post(ROUTE, express.json({ limit: "8kb" }), (req, res) => {
            const body = req.body;
            if (!body || typeof body !== "object" || !body.event) {
                Log.warn("[MMM-Profile] bad event body:", body);
                return res.status(400).end();
            }
            Log.info("[MMM-Profile] event:", body);
            this.sendSocketNotification("MMP_EVENT", body);
            res.status(204).end();
        });
        Log.info("[MMM-Profile] HTTP route mounted: POST " + ROUTE);
    },

    socketNotificationReceived: function (notification, _payload) {
        // The frontend sends MMP_INIT on start; nothing to do here yet —
        // page resolution is fully frontend-side.
        if (notification === "MMP_INIT") {
            Log.info("[MMM-Profile] frontend initialized");
        }
    }
});
