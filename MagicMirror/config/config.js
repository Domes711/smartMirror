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
        { module: "alert" },
        { module: "updatenotification", position: "top_bar" },
        { module: "clock", position: "top_left" },
        { module: "MMM-FaceRecoIndicator", position: "top_center" },
        {
            module: "MMM-Face-Reco-DNN",
            config: {
                usernameTimeout: 120000,
                interval: 2,
                users: ["Domes"],
                welcomeMessage: ""
            }
        },
        {
            module: "weather",
            position: "top_right",
            config: {
                weatherProvider: "openmeteo",
                type: "current",
                lat: 49.1928408,
                lon: 16.6166969
            }
        },
        {
            module: "weather",
            position: "top_right",
            header: "Weather Forecast",
            config: {
                weatherProvider: "openmeteo",
                type: "forecast",
                lat: 49.1928408,
                lon: 16.6166969
            }
        },
        {
            module: "MMM-Brno-Transit",
            position: "top_right",
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
            module: "newsfeed",
            position: "bottom_bar",
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
            module: "MMM-GoogleCalendar",
            header: "Moro systems",
            position: "top_left",
            classes: "Domes",
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
        }
    ]
};

/*************** DO NOT EDIT THE LINE BELOW ***************/
if (typeof module !== "undefined") { module.exports = config; }
