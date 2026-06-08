/* MagicMirror MINIMAL TEST config.js
 *
 * Simplified config for testing MMM-Profile + MQTT integration.
 * Only clock and MMM-Profile modules, single default page.
 */

let config = {
    address: "0.0.0.0",          // bind all interfaces (reachable on the LAN)
    port: 8080,
    basePath: "/",
    ipWhitelist: [],             // [] = allow any client (private LAN); restrict if needed
    useHttps: false,
    httpsPrivateKey: "",
    httpsCertificate: "",
    language: "cs",
    locale: "cs-CZ",
    logLevel: ["INFO", "LOG", "WARN", "ERROR"],
    timeFormat: 24,
    units: "metric",

    modules: [
        // MIRROR-CONSOLE:START (auto-managed — module instances from the layout editor; do not edit)
        // MIRROR-CONSOLE:END

        // ── unmanaged: always visible ──
        { module: "alert" },

        // ── managed: positioned by the core profile system via config/pages.js ──
        {
            id: "clock",
            module: "clock",
            config: {
                displaySeconds: false
            }
        },
        {
            id: "google-calendar",
            module: "MMM-GoogleCalendar",
            config: {
                calendars: [
                    {
                        symbol: "calendar-week",
                        calendarID: "TVOJE_CALENDAR_ID@group.calendar.google.com"
                    }
                ]
            }
        }
    ]
};

/*************** DO NOT EDIT THE LINE BELOW ***************/
if (typeof module !== "undefined") { module.exports = config; }
