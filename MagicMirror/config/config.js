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
    // Helmet v8 throws if both `frameguard` and `xFrameOptions` are set at once
    // ("X-Frame-Options option was specified twice") — only `xFrameOptions` is
    // the current option name, so set that alone to drop the header (which
    // otherwise defaults to SAMEORIGIN and blocks the cross-origin iframe).
    // CSP is already off in MM defaults.
    httpHeaders: { contentSecurityPolicy: false, crossOriginOpenerPolicy: false, crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: false, originAgentCluster: false, xFrameOptions: false },
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
