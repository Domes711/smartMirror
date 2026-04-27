/* MagicMirror config.js
 *
 * Each module that should be controlled by MMM-Profile (positioned and
 * shown/hidden per the active page) MUST carry a custom `id` field.
 * Modules without `id` (alert, updatenotification, MMM-Profile itself)
 * are unmanaged: their `position` from this file stands and they're
 * always visible.
 */

const pages = require("./pages.js");

let config = {
    address: "localhost",
    port: 8080,
    basePath: "/",
    ipWhitelist: ["127.0.0.1", "::ffff:127.0.0.1", "::1"],
    useHttps: false,
    httpsPrivateKey: "",
    httpsCertificate: "",
    language: "en",
    locale: "en-US",
    logLevel: ["INFO", "LOG", "WARN", "ERROR"],
    timeFormat: 24,
    units: "metric",

    modules: [
        // ── unmanaged: stay where config.js puts them, always visible ──
        { module: "alert" },
        { module: "updatenotification", position: "top_bar" },

        // ── MMM-Profile: the controller. Lives at top_center forever. ──
        {
            module: "MMM-Profile",
            position: "top_center",
            config: {
                defaultUser: "default",
                pages: pages
            }
        },

        // ── managed: id required, position decided by pages.js ──
        { id: "clock", module: "clock" },

        {
            id: "weather_current",
            module: "weather",
            config: {
                weatherProvider: "openmeteo",
                type: "current",
                lat: 49.1928408,
                lon: 16.6166969
            }
        },
        {
            id: "weather_forecast",
            module: "weather",
            header: "Weather Forecast",
            config: {
                weatherProvider: "openmeteo",
                type: "forecast",
                lat: 49.1928408,
                lon: 16.6166969
            }
        },

        {
            id: "transit",
            module: "MMM-Brno-Transit",
            config: {
                stopName: "Vlhká",
                // Get the current direct .zip URL from
                // https://data.brno.cz/datasets/379d2e9a7907460c8ca7fda1f3e84328
                gtfsUrl: "FILL_IN_FROM_DATA_BRNO_CZ",
                lines: [
                    { line: "9",  directionId: 0 },
                    { line: "67", directionId: 1 }
                ]
            }
        },

        {
            id: "news",
            module: "newsfeed",
            config: {
                feeds: [
                    {
                        title: "News toto je test",
                        url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"
                    }
                ],
                showSourceTitle: true,
                showPublishDate: true,
                broadcastNewsFeeds: true,
                broadcastNewsUpdates: true
            }
        },

        {
            id: "calendar_domes",
            module: "MMM-GoogleCalendar",
            header: "Moro systems",
            config: {
                calendars: [
                    {
                        symbol: "calendar-week",
                        // Real calendar ID lives only on the Pi; replace this
                        // placeholder when restoring from this backup.
                        calendarID: "REPLACE_WITH_GOOGLE_CALENDAR_ID"
                    }
                ]
            }
        },

        {
            id: "reminders_domes",
            module: "MMM-HA-Reminders",
            header: "Reminders",
            config: {
                haUrl: "http://homeassistant.local:8123",
                // Real HA long-lived token lives only on the Pi.
                haToken: "HA_TOKEN_PLACEHOLDER",
                todoEntities: ["todo.iphone_reminders"],
                maxItems: 6,
                showDueDate: true,
                showCompleted: false,
                refreshSec: 60,
                language: "cs"
            }
        },

        {
            id: "spending_domes",
            module: "MMM-Spending",
            header: "Útrata dnes",
            config: {
                // Real BudgetBakers Wallet API token lives only on the Pi
                // (loaded from ~/.secrets/budgetbakers_token there). See
                // modules/MMM-Spending/README.md.
                apiToken: "BB_TOKEN_PLACEHOLDER",
                apiBase: "https://rest.budgetbakers.com/wallet/v1/api",
                includeAccountIds: [
                    "ae939246-f1d5-4f14-bce1-c04357e0e77d",  // Běžný účet
                    "c989cb70-8e88-4fd5-a103-b3f45278dc41"   // Hotovost
                ],
                excludeEnvelopeIds: [20001],   // Převod (inter-account transfer)
                currency: "CZK",
                timezone: "Europe/Prague",
                recentCount: 3,
                refreshSec: 300,
                language: "cs"
            }
        }
    ]
};

/*************** DO NOT EDIT THE LINE BELOW ***************/
if (typeof module !== "undefined") { module.exports = config; }
