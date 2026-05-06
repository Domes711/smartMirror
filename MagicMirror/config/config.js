/* MagicMirror MINIMAL TEST config.js
 *
 * Simplified config for testing MMM-Profile + MQTT integration.
 * Only clock and MMM-Profile modules, single default page.
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
        // ── unmanaged: always visible ──
        { module: "alert" },

        // ── MMM-Profile: the controller ──
        {
            module: "MMM-Profile",
            position: "top_center",
            config: {
                defaultUser: "default",
                pages: pages,
                scanningStatus: "Skenování obličeje…",
                recognizedStatus: "Obličej rozpoznán",
                unknownStatus: "Obličej nerozpoznán",
                dimTimeoutMs: 60000,
                mqttBroker: "mqtt://127.0.0.1:1883"
            }
        },

        // ── managed: position controlled by pages.js ──
        {
            id: "clock",
            module: "clock",
            config: {
                displaySeconds: false
            }
        }
    ]
};

/*************** DO NOT EDIT THE LINE BELOW ***************/
if (typeof module !== "undefined") { module.exports = config; }
