/* MagicMirror MINIMAL TEST pages.js
 *
 * Simplified page layout for testing MMM-Profile + MQTT integration.
 * Single default user, single page (always active).
 */

module.exports = {

    globalLayout: [
        { id: "clock", position: "top_left" }
    ],

    default: {
        all_day: {
            from: "0 0 * * *",   // Midnight every day
            to:   "59 23 * * *", // 23:59 every day (always active)
            layout: [
                { id: "clock", position: "top_left" }
            ]
        }
    }
};
