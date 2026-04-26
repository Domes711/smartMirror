/* MagicMirror page layout config — driven by MMM-Profile.
 *
 * Schema:
 *   globalLayout            always-on modules; merged into every active page
 *   <userKey>.<windowName>  per-user time windows
 *
 * Each window:
 *   from / to   5-field cron expressions (`min hour dom month dow`,
 *               0=Sunday..6=Saturday). Active window = the one whose `from`
 *               fired most recently AND more recently than its `to`.
 *               Latest `from` wins on ties.
 *   layout      list of { id, position } pairs. `id` matches the custom
 *               `id` field set on a module in config.js.
 *
 * `default` is the user used for "wake-up before face-reco completes" and
 * for `user_unknown` results. Must exist.
 */

module.exports = {

    globalLayout: [
        { id: "clock", position: "top_left" }
    ],

    Domes: {
        morning: {
            from: "0 6 * * 1-5",
            to:   "0 12 * * 1-5",
            layout: [
                { id: "weather_current",  position: "top_right" },
                { id: "weather_forecast", position: "top_right" },
                { id: "transit",          position: "top_right" },
                { id: "calendar_domes",   position: "top_left"  },
                { id: "reminders_domes",  position: "top_left"  }
            ]
        },
        work: {
            from: "0 12 * * 1-5",
            to:   "0 18 * * 1-5",
            layout: [
                { id: "weather_current",  position: "top_right" },
                { id: "calendar_domes",   position: "top_left"  },
                { id: "reminders_domes",  position: "top_left"  }
            ]
        },
        evening: {
            from: "0 18 * * 1-5",
            to:   "0 23 * * 1-5",
            layout: [
                { id: "weather_forecast", position: "top_right" },
                { id: "transit",          position: "top_right" },
                { id: "reminders_domes",  position: "top_left"  },
                { id: "news",             position: "bottom_bar"}
            ]
        },
        weekend: {
            from: "0 8 * * 6,0",
            to:   "0 22 * * 6,0",
            layout: [
                { id: "weather_current",  position: "top_right" },
                { id: "weather_forecast", position: "top_right" },
                { id: "calendar_domes",   position: "top_left"  },
                { id: "reminders_domes",  position: "top_left"  },
                { id: "news",             position: "bottom_bar"}
            ]
        },
        night: {
            from: "0 23 * * *",
            to:   "0 6 * * *",
            layout: []
        }
    },

    default: {
        day: {
            from: "0 6 * * *",
            to:   "0 23 * * *",
            layout: [
                { id: "weather_current",  position: "top_right" }
            ]
        },
        night: {
            from: "0 23 * * *",
            to:   "0 6 * * *",
            layout: []
        }
    }
};
