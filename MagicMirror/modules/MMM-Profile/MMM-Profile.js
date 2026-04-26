/* MMM-Profile
 *
 * Presence-driven profile + page scheduler. Receives events from the Pi
 * (via node_helper's HTTP route), maintains the (presence, user) state
 * machine, renders the Face ID-style indicator at top_center and remaps
 * every other module on the mirror to the active page's layout.
 *
 * This file is the SKELETON (Task 4). State machine logic lands in
 * Task 5; cron-driven page resolution and DOM remap in Task 6.
 */

Module.register("MMM-Profile", {
    defaults: {
        defaultUser: "default",
        unknownLabel: "Unknown",
        scanningLabel: "scanning",
        userDisplayNames: {},        // username -> displayed name override
        dimTimeoutMs: 60 * 1000,     // matches LD2450 ABSENCE_TIMEOUT_SEC
        pages: null                  // set by config: typically require("./pages.js")
    },

    start: function () {
        // State machine — filled in for real in Task 5.
        this.state = "asleep";       // asleep | scanning | user | dimming
        this.currentUser = null;     // string or null
        this.dimTimer = null;
        this.activePageKey = null;   // "Domes_morning" etc., for diffing

        this.sendSocketNotification("MMP_INIT", {});
    },

    getStyles: function () {
        return ["MMM-Profile.css"];
    },

    socketNotificationReceived: function (notification, payload) {
        if (notification !== "MMP_EVENT") return;
        // Real handling lands in Task 5.
        Log.info("[MMM-Profile] event received:", payload);
        this.updateDom(200);
    },

    getDom: function () {
        const wrapper = document.createElement("div");
        wrapper.className = "mmp";
        wrapper.dataset.state = this.state;
        // Placeholder — Task 5 renders scanning / badge based on state.
        return wrapper;
    }
});
