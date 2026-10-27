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
    // Allow the mirror page to be embedded (live preview in the Mirror Control app).
    // Helmet v7+ renamed `frameguard` → `xFrameOptions`; we set BOTH so the
    // X-Frame-Options header is dropped regardless of the installed helmet major
    // (v8 ignores `frameguard` and would otherwise apply its default SAMEORIGIN,
    // which blocks the cross-origin iframe). CSP is already off in MM defaults.
    httpHeaders: { contentSecurityPolicy: false, crossOriginOpenerPolicy: false, crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: false, originAgentCluster: false, frameguard: false, xFrameOptions: false },
    useHttps: false,
    httpsPrivateKey: "",
    httpsCertificate: "",
    language: "cs",
    locale: "cs-CZ",
    logLevel: ["INFO", "LOG", "WARN", "ERROR"],
    timeFormat: 24,
    units: "metric",

    // Module instances live in the DATABASE, not here.
    //
    // `backend/var/smartmirror.db` is the single source of truth; the scenes
    // feature generates `config/modules.js` from it and the core loads that
    // (see js/utils.js → loadModulesFile). This array is IGNORED.
    //
    // To add a module: install it in the app (Moduly), then add it to a scene
    // under the profile it belongs to — that is what creates an instance.
    modules: []
};

/*************** DO NOT EDIT THE LINE BELOW ***************/
if (typeof module !== "undefined") { module.exports = config; }
