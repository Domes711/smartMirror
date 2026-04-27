/* Magic Mirror
 * Module: MMM-GoogleCalendar
 *
 * adaptation of MM default calendar module for Google Calendar events
 * MIT Licensed.
 */
Module.register("MMM-GoogleCalendar", {
  // Define module defaults
  defaults: {
    maximumEntries: 10, // Total Maximum Entries
    maximumNumberOfDays: 365,
    pastDaysCount: 0,
    limitDays: 0, // Limit the number of days shown, 0 = no limit
    displaySymbol: true,
    defaultSymbol: "calendar", // Fontawesome Symbol see https://fontawesome.com/cheatsheet?from=io
    showLocation: false,
    displayRepeatingCountTitle: false,
    defaultRepeatingCountTitle: "",
    maxTitleLength: 25,
    maxLocationTitleLength: 25,
    wrapEvents: false, // wrap events to multiple lines breaking at maxTitleLength
    wrapLocationEvents: false,
    maxTitleLines: 3,
    maxEventTitleLines: 3,
    fetchInterval: 5 * 60 * 1000, // Update every 5 minutes.
    animationSpeed: 2000,
    fade: true,
    urgency: 7,
    timeFormat: "relative",
    dateFormat: "MMM Do",
    dateEndFormat: "LT",
    fullDayEventDateFormat: "MMM Do",
    showEnd: false,
    getRelative: 6,
    fadePoint: 0.25, // Start on 1/4th of the list.
    hidePrivate: false,
    hideOngoing: false,
    hideTime: false,
    hideDuplicates: false,
    colored: false,
    coloredSymbolOnly: false,
    customEvents: [], // Array of {keyword: "", symbol: "", color: ""} where Keyword is a regexp and symbol/color are to be applied for matched
    tableClass: "small",
    calendars: [
      {
        symbol: "calendar",
        url: "https://www.calendarlabs.com/templates/ical/US-Holidays.ics"
      }
    ],
    titleReplace: {
      "De verjaardag van ": "",
      "'s birthday": ""
    },
    locationTitleReplace: {
      "street ": ""
    },
    broadcastEvents: false,
    excludedEvents: [],
    sliceMultiDayEvents: false,
    nextDaysRelative: false,
	broadcastPastEvents: false,
    // Timeline-view options (read by the rewritten getDom()).
    hourHeight: 56,           // pixels per hour
    timeColWidth: 44,         // pixels for the gutter with hour labels
    viewportHeight: 460,      // pixels of visible timeline window
    pastBufferHours: 2,       // hours of past kept visible above the now-line
    timelineWidth: 280,       // total module width in pixels
    timelineRefreshSec: 60    // re-render cadence so --now & .past stay current
  },

  requiresVersion: "2.1.0",

  // Define required scripts.
  getStyles: function () {
    return ["calendar.css", "font-awesome.css"];
  },

  // Define required scripts.
  getScripts: function () {
    return ["moment.js"];
  },

  // Define required translations.
  getTranslations: function () {
    return {
      en: "translations/en.json",
      cs: "translations/cs.json"
    };
  },

  // Override start method.
  start: function () {
    Log.info("Starting module: " + this.name);

    // Set locale.
    moment.updateLocale(
      config.language,
      this.getLocaleSpecification(config.timeFormat)
    );

    // clear data holder before start
    this.calendarData = {};

    // indicate no data available yet
    this.loaded = false;

    // check if current URL is module's auth url
    if (location.search.includes(this.name)) {
      this.sendSocketNotification("MODULE_READY", {
        queryParams: location.search
      });
    } else {
      // check user token is authenticated.
      this.sendSocketNotification("MODULE_READY");
    }
  },

  // Override socket notification handler.
  socketNotificationReceived: function (notification, payload) {
    // Authentication done before any calendar is fetched
    if (notification === "AUTH_FAILED") {
      const errorMessage = this.translate(payload.error_type);
      this.error = this.translate("MODULE_CONFIG_ERROR", {
        MODULE_NAME: this.name,
        ERROR: errorMessage
      });
      this.loaded = true;
      this.updateDom(this.config.animationSpeed);
      return;
    }

    if (notification === "AUTH_NEEDED") {
      if (payload.credentialType === "web" && payload.url) {
        this.error = "AUTH_PROMPT_CLICK_HERE";
        this.errorUrl = payload.url;
      } else {
        this.error = "AUTH_ERROR_GENERIC";
      }
      this.updateDom(this.config.animationSpeed);
      return;
    } else {
      // reset error URL
      this.errorUrl = null;
    }

    if (notification === "SERVICE_READY") {
      // start fetching calendars
      this.fetchCalendars();
    }

    if (this.identifier !== payload.id) {
      return;
    }

    if (notification === "CALENDAR_EVENTS") {
      if (this.hasCalendarID(payload.calendarID)) {
        this.calendarData[payload.calendarID] = payload.events;
        this.error = null;
        this.loaded = true;

        if (this.config.broadcastEvents) {
          this.broadcastEvents();
        }
      }
    } else if (notification === "CALENDAR_ERROR") {
      const errorMessage = this.translate(payload.error_type);
      this.error = this.translate("MODULE_CONFIG_ERROR", {
        MODULE_NAME: this.name,
        ERROR: errorMessage
      });
      this.loaded = true;
    }

    this.updateDom(this.config.animationSpeed);
  },

  // Override dom generator.
  // Mapping for Google Calendar event colorIds (1-11).
  // https://developers.google.com/calendar/api/v3/reference/colors
  GOOGLE_EVENT_COLORS: {
    "1":  "#7986cb", // Lavender
    "2":  "#33b679", // Sage
    "3":  "#8e24aa", // Grape
    "4":  "#e67c73", // Flamingo
    "5":  "#f6c026", // Banana
    "6":  "#f5511d", // Tangerine
    "7":  "#039be5", // Peacock
    "8":  "#616161", // Graphite
    "9":  "#3f51b5", // Blueberry
    "10": "#0b8043", // Basil
    "11": "#d60000"  // Tomato
  },
  DEFAULT_EVENT_COLOR: "#5484ed",

  /**
   * Resolve the colour of an event. Prefers the per-event Google
   * colorId, then the per-calendar configured colour, then the
   * module default.
   * @param {object} event Google calendar event (with calendarID set)
   * @returns {string} a hex/rgb colour
   */
  eventColor: function (event) {
    if (event.colorId && this.GOOGLE_EVENT_COLORS[event.colorId]) {
      return this.GOOGLE_EVENT_COLORS[event.colorId];
    }
    const cal = this.colorForCalendar(event.calendarID);
    if (cal && cal !== "#fff") return cal;
    return this.DEFAULT_EVENT_COLOR;
  },

  /**
   * Naive 2-column overlap layout. Sets event.column = "left"|"right"
   * for timed events that share a slot with another. Good enough for
   * the typical case of two simultaneous meetings; 3+ overlaps fall
   * through to single-column.
   */
  assignColumns: function (events) {
    events.sort((a, b) => a._startMs - b._startMs);
    for (let i = 0; i < events.length; i++) {
      const a = events[i];
      for (let j = i + 1; j < events.length; j++) {
        const b = events[j];
        if (b._startMs >= a._endMs) break;
        if (b._endMs > a._startMs && b._startMs < a._endMs) {
          if (!a.column) a.column = "left";
          b.column = a.column === "left" ? "right" : "left";
        }
      }
    }
  },

  pinIcon: function () {
    return '<svg viewBox="0 0 24 24"><circle cx="12" cy="10" r="3"/>'
         + '<path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"/></svg>';
  },

  arrowIcon: function () {
    return '<svg viewBox="0 0 24 24"><path d="M5 12 H19 M13 6 L19 12 L13 18"/></svg>';
  },

  /**
   * Render a timed event card positioned absolutely on the timeline.
   */
  renderTimedEvent: function (event, todayStart, todayEnd, nowMs) {
    const div = document.createElement("div");
    div.className = "event";

    // Clip the event to today's window for positioning.
    const startClipped = Math.max(event._startMs, todayStart);
    const endClipped   = Math.min(event._endMs, todayEnd);
    const startHours = (startClipped - todayStart) / 3600000;
    const endHours   = (endClipped - todayStart) / 3600000;
    const duration   = Math.max(endHours - startHours, 0.4);  // min 24min

    div.style.top    = "calc(" + startHours.toFixed(4) + " * var(--hour-height))";
    div.style.height = "calc(" + duration.toFixed(4)  + " * var(--hour-height))";
    div.style.setProperty("--ev-color", this.eventColor(event));

    if (event._endMs <= nowMs) div.classList.add("past");
    if (event.status === "tentative") div.classList.add("tentative");
    if (event.column === "left")  div.classList.add("col-l");
    if (event.column === "right") div.classList.add("col-r");

    const continuesNext = event._endMs > todayEnd;
    const startedPrev   = event._startMs < todayStart;

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = event.title || event.summary || "";
    div.appendChild(title);

    if (event.location) {
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.innerHTML = this.pinIcon() + " "
        + this.escapeHtml(event.location);
      div.appendChild(meta);
    }

    if (continuesNext || startedPrev) {
      const cont = document.createElement("div");
      cont.className = "continues";
      const txt = continuesNext
        ? this.translate("CONTINUES_NEXT_DAY") || "pokračuje zítra"
        : this.translate("CONTINUED_FROM_PREV") || "pokračuje ze včerejška";
      cont.innerHTML = this.arrowIcon() + " "
        + this.escapeHtml(txt);
      div.appendChild(cont);
    }

    return div;
  },

  /**
   * Render an all-day or multi-day event as a row in the strip
   * above the timeline.
   */
  renderAllDayEvent: function (event, todayStart, todayEnd) {
    const div = document.createElement("div");
    div.className = "all-day-event";
    div.style.setProperty("--ev-color", this.eventColor(event));

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = event.title || event.summary || "";
    div.appendChild(title);

    // Multi-day: show "1/3" style hint indicating which day of the
    // span we're currently on.
    const oneDay = 24 * 3600000;
    const totalDays = Math.max(1, Math.ceil((event._endMs - event._startMs) / oneDay));
    if (totalDays > 1) {
      const dayNum = Math.floor((todayStart - event._startMs) / oneDay) + 1;
      const range = document.createElement("span");
      range.className = "day-range";
      range.textContent = dayNum + "/" + totalDays;
      div.appendChild(range);
    }

    return div;
  },

  escapeHtml: function (str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  },

  /**
   * Schedule a periodic re-render so --now slides forward and the
   * past/future state of each event stays correct as the day
   * progresses. Cancels any previously scheduled tick.
   */
  scheduleNowTick: function () {
    if (this._nowTimer) clearTimeout(this._nowTimer);
    const period = (this.config.timelineRefreshSec || 60) * 1000;
    this._nowTimer = setTimeout(() => {
      this._nowTimer = null;
      this.updateDom();
    }, period);
  },

  getDom: function () {
    const wrapper = document.createElement("div");
    wrapper.className = "mmm-gcal-timeline";
    wrapper.style.setProperty("--hour-height",     this.config.hourHeight + "px");
    wrapper.style.setProperty("--time-col-width",  this.config.timeColWidth + "px");
    wrapper.style.setProperty("--viewport-height", this.config.viewportHeight + "px");
    wrapper.style.setProperty("--past-buffer",     this.config.pastBufferHours);
    wrapper.style.width = this.config.timelineWidth + "px";

    // Auth / error placeholder
    if (this.error) {
      const ph = document.createElement("div");
      ph.className = "placeholder";
      if (this.error === "AUTH_PROMPT_CLICK_HERE" && this.errorUrl) {
        ph.innerHTML = this.translate("AUTH_PROMPT_CLICK_HERE")
          .replace("{authUrl}", this.errorUrl);
      } else if (this.error === "AUTH_ERROR_GENERIC") {
        ph.textContent = this.translate(this.error);
      } else {
        ph.textContent = this.error;
      }
      wrapper.appendChild(ph);
      return wrapper;
    }

    if (!this.loaded) {
      const ph = document.createElement("div");
      ph.className = "placeholder";
      ph.textContent = this.translate("LOADING");
      wrapper.appendChild(ph);
      this.scheduleNowTick();
      return wrapper;
    }

    // ----- Filter to today -----
    const nowDate = new Date();
    const nowMs = nowDate.getTime();
    const todayStart = moment().startOf("day").valueOf();
    const todayEnd   = todayStart + 24 * 3600000;

    const all = this.createEventList();
    const today = [];
    for (const ev of all) {
      const startMs = +ev.startDate;
      const endMs   = +ev.endDate;
      // Overlap with today
      if (endMs <= todayStart) continue;
      if (startMs >= todayEnd) continue;
      ev._startMs = startMs;
      ev._endMs   = endMs;
      today.push(ev);
    }

    // ----- Split all-day vs timed -----
    const allDay = [];
    const timed = [];
    for (const ev of today) {
      const isAllDay = ev.fullDayEvent
        || (ev._endMs - ev._startMs) >= 24 * 3600000;
      if (isAllDay) allDay.push(ev); else timed.push(ev);
    }

    // ----- All-day strip -----
    if (allDay.length > 0) {
      const bar = document.createElement("div");
      bar.className = "all-day-bar";
      for (const ev of allDay) {
        bar.appendChild(this.renderAllDayEvent(ev, todayStart, todayEnd));
      }
      wrapper.appendChild(bar);
    }

    // ----- Timeline -----
    const viewport = document.createElement("div");
    viewport.className = "timeline-viewport";

    const timeline = document.createElement("div");
    timeline.className = "timeline";

    for (let h = 0; h < 24; h++) {
      const row = document.createElement("div");
      row.className = "hour-row";
      const lbl = document.createElement("span");
      lbl.className = "hour-label";
      lbl.textContent = h + ":00";
      row.appendChild(lbl);
      timeline.appendChild(row);
    }

    const nowLine = document.createElement("div");
    nowLine.className = "now-line";
    timeline.appendChild(nowLine);

    this.assignColumns(timed);
    for (const ev of timed) {
      timeline.appendChild(
        this.renderTimedEvent(ev, todayStart, todayEnd, nowMs)
      );
    }

    viewport.appendChild(timeline);
    wrapper.appendChild(viewport);

    // Set the now anchor (hours since midnight)
    const nowHours = (nowMs - todayStart) / 3600000;
    wrapper.style.setProperty("--now", nowHours.toFixed(4));

    this.scheduleNowTick();
    return wrapper;
  },


  /**
	 * Filter out events according to the calendar config.
	 * This function is called from `createEventList` for each event.
	 * @param {object} event - The event object to check.
	 * @param {array} eventsList - The list of events already processed and not filtered out, used for duplicate checking.
	 * @returns {boolean} - True if the event should be filtered out (excluded), false otherwise.
	 */
  filterEvent: function(event, eventsList) {
    // Note: The order of checks can impact performance slightly, but the current order is logical.
    // For example, checking for excludedEvents or hidePrivate first might be marginally faster
    // if those are common, as it avoids the listContainsEvent check for duplicates.

    // Filter based on `excludedEvents` config
  if (this.config.excludedEvents?.length && this.config.excludedEvents.includes(event.summary)) {
    Log.debug(`Event ${event.id} ('${event.summary}') filtered due to excludedEvents settings.`);
    return true;
  }

  // Filter based on `hidePrivate` config
  if (this.config.hidePrivate && ['private', 'confidential'].includes(event.visibility?.toLowerCase())) {
    Log.debug(`Event ${event.id} ('${event.summary}') filtered due to hidePrivate settings.`);
    return true;
  }

  // Filter based on `hideDuplicates` config by checking against the eventsList
  if (this.config.hideDuplicates && this.listContainsEvent(eventsList, event)) {
    Log.debug(`Event ${event.id} ('${event.summary}') filtered due to hideDuplicates settings.`);
    return true;
  }

  const now = new Date();
  // Filter based on `hideOngoing` config
  if (this.config.hideOngoing && event.startDate < now && event.endDate > now) {
    Log.debug(`Event ${event.id} ('${event.summary}') filtered due to hideOngoing settings.`);
    return true;
  }

  return false; // Event should not be filtered out
  },

  fetchCalendars: function () {
    this.config.calendars.forEach((calendar) => {
      if (!calendar.calendarID) {
        Log.warn(`${this.name}: Unable to fetch, no calendar ID found!`); // Template literal
        return;
      }

      const calendarConfig = {
		maximumEntries: calendar.maximumEntries,
		maximumNumberOfDays: calendar.maximumNumberOfDays,
		broadcastPastEvents: calendar.broadcastPastEvents,
		excludedEvents: calendar.excludedEvents,
      };

      if (
        calendar.symbolClass === "undefined" ||
        calendar.symbolClass === null
      ) {
        calendarConfig.symbolClass = "";
      }
      if (calendar.titleClass === "undefined" || calendar.titleClass === null) {
        calendarConfig.titleClass = "";
      }
      if (calendar.timeClass === "undefined" || calendar.timeClass === null) {
        calendarConfig.timeClass = "";
      }

      // tell helper to start a fetcher for this calendar
      // fetcher till cycle
      this.addCalendar(calendar.calendarID, calendarConfig);
    });
  },

  /**
   * This function accepts a number (either 12 or 24) and returns a moment.js LocaleSpecification with the
   * corresponding timeformat to be used in the calendar display. If no number is given (or otherwise invalid input)
   * it will a localeSpecification object with the system locale time format.
   *
   * @param {number} timeFormat Specifies either 12 or 24 hour time format
   * @returns {moment.LocaleSpecification} formatted time
   */
  getLocaleSpecification: function (timeFormat) {
    switch (timeFormat) {
      case 12: {
        return { longDateFormat: { LT: "h:mm A" } };
      }
      case 24: {
        return { longDateFormat: { LT: "HH:mm" } };
      }
      default: {
        return {
          longDateFormat: { LT: moment.localeData().longDateFormat("LT") }
        };
      }
    }
  },

  /**
   * Checks if this config contains the calendar ID.
   *
   * @param {string} ID The calendar ID
   * @returns {boolean} True if the calendar config contains the ID, False otherwise
   */
  hasCalendarID: function (ID) {
    for (const calendar of this.config.calendars) {
      if (calendar.calendarID === ID) {
        return true;
      }
    }

    return false;
  },

  /**
   * Parse google date obj
   * @param {object} googleDate - The google date object. (type annotation)
   * @returns {number} timestamp (type annotation)
   */
  extractCalendarDate: function (googleDate) {
    // case is "all day event"
    if (Object.prototype.hasOwnProperty.call(googleDate, "date")) { // Fixed no-prototype-builtins
      // For "YYYY-MM-DD", append time and use moment to parse as local time.
      return moment(googleDate.date + "T00:00:00").valueOf();
    }
    // For dateTime, moment parses it correctly including timezone.
    return moment(googleDate.dateTime).valueOf();
  },

  /**
   * Creates the sorted list of all events.
   *
   * @returns {object[]} Array with events.
   */
  createEventList: function () {
    const now = new Date();
    const today = moment().startOf("day");
    const future = moment()
      .startOf("day")
      .add(this.config.maximumNumberOfDays, "days")
      .toDate();
    const events = []; // Changed from let to const as it's reassigned with .slice() later, but primarily mutated.

    const formatStr = undefined; // This seems unused, consider removing if truly not needed.

    for (const calendarID in this.calendarData) {
      const calendar = this.calendarData[calendarID];
      for (const e in calendar) { // Consider using for...of if calendar is an array or iterating its keys differently
        const event = JSON.parse(JSON.stringify(calendar[e])); // clone object

        // added props
        event.calendarID = calendarID;
        event.endDate = this.extractCalendarDate(event.end);
        event.startDate = this.extractCalendarDate(event.start);

        // Call filterEvent to determine if the event should be excluded based on various settings.
        // The 'events' array (eventsList in filterEvent) is the accumulating list of events
        // that have passed all filters so far, used for duplicate checking.
		if (this.filterEvent(event, events)) {
			continue; // Skip this event if filterEvent returns true
		}

        // The redundant duplicate check that was here has been removed.
        // filterEvent now solely handles the hideDuplicates logic.

        event.url = event.htmlLink;
        event.today =
          event.startDate >= today &&
          event.startDate < today + 24 * 60 * 60 * 1000;
        event.title = event.summary;

        /* if sliceMultiDayEvents is set to true, multiday events (events exceeding at least one midnight) are sliced into days,
         * otherwise, esp. in dateheaders mode it is not clear how long these events are.
         */
        const maxCount =
          Math.ceil(
            (event.endDate -
              1 -
              moment(event.startDate, formatStr) // formatStr is undefined here
                .endOf("day")
                .format(formatStr)) / // formatStr is undefined here
              (1000 * 60 * 60 * 24)
          ) + 1;
        if (this.config.sliceMultiDayEvents && maxCount > 1) {
          const splitEvents = [];
          let midnight = moment(event.startDate, formatStr) // formatStr is undefined here
            .clone()
            .startOf("day")
            .add(1, "day")
            .format(formatStr); // formatStr is undefined here
          let count = 1;
          while (event.endDate > midnight) {
            const thisEvent = JSON.parse(JSON.stringify(event)); // clone object
            thisEvent.today =
              thisEvent.startDate >= today &&
              thisEvent.startDate < today + 24 * 60 * 60 * 1000;
            thisEvent.endDate = midnight;
            thisEvent.title += ` (${count}/${maxCount})`; // Template literal
            splitEvents.push(thisEvent);

            event.startDate = midnight;
            count += 1;
            midnight = moment(midnight, formatStr) // formatStr is undefined here
              .add(1, "day")
              .format(formatStr); // formatStr is undefined here // next day
          }
          // Last day
          event.title += ` (${count}/${maxCount})`; // Template literal
          splitEvents.push(event);

          for (const splitEvent of splitEvents) { // Use for...of for arrays
            if (splitEvent.end > now && splitEvent.end <= future) {
              events.push(splitEvent);
            }
          }
        } else {
          events.push(event);
        }
      }
    }

    events.sort((a, b) => a.startDate - b.startDate); // Arrow function for sort

    // Limit the number of days displayed
    // If limitDays is set > 0, limit display to that number of days
    if (this.config.limitDays > 0) {
      const newEvents = []; // Changed from let to const
      let lastDate = today.clone().subtract(1, "days").format("YYYYMMDD");
      let days = 0;
      for (const ev of events) { // Use for...of for arrays
        const eventDate = moment(ev.startDate, formatStr).format("YYYYMMDD"); // formatStr is undefined here
        // if date of event is later than lastdate
        // check if we already are showing max unique days
        if (eventDate > lastDate) {
          // if the only entry in the first day is a full day event that day is not counted as unique
          if (
            newEvents.length === 1 &&
            days === 1 &&
            newEvents[0].fullDayEvent
          ) {
            days--;
          }
          days++;
          if (days > this.config.limitDays) {
            continue;
          } else {
            lastDate = eventDate;
          }
        }
        newEvents.push(ev);
      }
      return newEvents.slice(0, this.config.maximumEntries); // Return directly after reassignment
    }

    return events.slice(0, this.config.maximumEntries);
  },

  listContainsEvent: function (eventList, event) {
    for (const evt of eventList) { // Use for...of for arrays
      if (
        evt.summary === event.summary &&
        parseInt(evt.startDate, 10) === parseInt(event.startDate, 10) // Add radix for parseInt
      ) {
        return true;
      }
    }
    return false;
  },

  /**
   * Requests node helper to add calendar ID
   *
   * @param {string} calendarID string
   * @param {object} calendarConfig The config of the specific calendar
   */
  addCalendar: function (calendarID, calendarConfig) {
    this.sendSocketNotification("ADD_CALENDAR", {
      id: this.identifier,
      calendarID,
      excludedEvents:
        calendarConfig.excludedEvents || this.config.excludedEvents,
      maximumEntries:
        calendarConfig.maximumEntries || this.config.maximumEntries,
      maximumNumberOfDays:
        calendarConfig.maximumNumberOfDays || this.config.maximumNumberOfDays,
      pastDaysCount:
        calendarConfig.pastDaysCount || this.config.pastDaysCount,
      fetchInterval: this.config.fetchInterval,
      symbolClass: calendarConfig.symbolClass,
      titleClass: calendarConfig.titleClass,
      timeClass: calendarConfig.timeClass,
      broadcastPastEvents: calendarConfig.broadcastPastEvents || this.config.broadcastPastEvents
    });
  },

  /**
   * Retrieves the symbols for a specific event.
   *
   * @param {object} event Event to look for.
   * @returns {string[]} The symbols
   */
  symbolsForEvent: function (event) {
    let symbols = this.getCalendarPropertyAsArray(
      event.calendarID,
      "symbol",
      this.config.defaultSymbol
    );

    if (
      event.recurringEvent === true &&
      this.hasCalendarProperty(event.calendarID, "recurringSymbol")
    ) {
      symbols = this.mergeUnique(
        this.getCalendarPropertyAsArray(
          event.calendarID,
          "recurringSymbol",
          this.config.defaultSymbol
        ),
        symbols
      );
    }

    if (
      event.fullDayEvent === true &&
      this.hasCalendarProperty(event.calendarID, "fullDaySymbol")
    ) {
      symbols = this.mergeUnique(
        this.getCalendarPropertyAsArray(
          event.calendarID,
          "fullDaySymbol",
          this.config.defaultSymbol
        ),
        symbols
      );
    }

    return symbols;
  },

  mergeUnique: function (arr1, arr2) {
    return arr1.concat(
      arr2.filter((item) => arr1.indexOf(item) === -1) // Arrow function
    );
  },

  /**
   * Retrieves the symbolClass for a specific calendar ID.
   *
   * @param {string} calendarID The calendar ID
   * @returns {string} The class to be used for the symbols of the calendar
   */
  symbolClassForCalendar: function (calendarID) {
    return this.getCalendarProperty(calendarID, "symbolClass", "");
  },

  /**
   * Retrieves the titleClass for a specific calendar ID.
   *
   * @param {string} calendarID The calendar ID
   * @returns {string} The class to be used for the title of the calendar
   */
  titleClassForCalendar: function (calendarID) {
    return this.getCalendarProperty(calendarID, "titleClass", "");
  },

  /**
   * Retrieves the timeClass for a specific calendar ID.
   *
   * @param {string} calendarID The calendar ID
   * @returns {string} The class to be used for the time of the calendar
   */
  timeClassForCalendar: function (calendarID) {
    return this.getCalendarProperty(calendarID, "timeClass", "");
  },

  /**
   * Retrieves the calendar name for a specific calendar ID.
   *
   * @param {string} calendarID The calendar ID
   * @returns {string} The name of the calendar
   */
  calendarNameForCalendar: function (calendarID) {
    return this.getCalendarProperty(calendarID, "name", "");
  },

  /**
   * Retrieves the color for a specific calendar ID.
   *
   * @param {string} calendarID The calendar ID
   * @returns {string} The color
   */
  colorForCalendar: function (calendarID) {
    return this.getCalendarProperty(calendarID, "color", "#fff");
  },

  /**
   * Retrieves the count title for a specific calendar ID.
   *
   * @param {string} calendarID The calendar ID
   * @returns {string} The title
   */
  countTitleForCalendar: function (calendarID) {
    return this.getCalendarProperty(
      calendarID,
      "repeatingCountTitle",
      this.config.defaultRepeatingCountTitle
    );
  },

  /**
   * Helper method to retrieve the property for a specific calendar ID.
   *
   * @param {string} calendarID The calendar ID
   * @param {string} property The property to look for
   * @param {string} defaultValue The value if the property is not found
   * @returns {*} The property
   */
  getCalendarProperty: function (calendarID, property, defaultValue) {
    for (const calendar of this.config.calendars) { // Use for...of for arrays
      if (
        calendar.calendarID === calendarID &&
        calendar.hasOwnProperty(property)
      ) {
        return calendar[property];
      }
    }

    return defaultValue;
  },

  getCalendarPropertyAsArray: function (calendarID, property, defaultValue) {
    let p = this.getCalendarProperty(calendarID, property, defaultValue);
    if (!Array.isArray(p)) { // More standard check for array
      p = [p];
    }
    return p;
  },

  // Corrected hasCalendarProperty to avoid direct prototype call if possible,
  // but ESLint might still prefer Object.hasOwn or a more explicit check.
  // For now, this adheres to the common safe pattern.
  hasCalendarProperty: function (calendarID, property) {
    const calendar = this.config.calendars.find(c => c.calendarID === calendarID);
    // Ensure calendar is not null and then check for the property.
    return !!(calendar && Object.prototype.hasOwnProperty.call(calendar, property));
  },

  /**
   * Shortens a string if it's longer than maxLength and add a ellipsis to the end
   *
   * @param {string} string Text string to shorten
   * @param {number} maxLength The max length of the string
   * @param {boolean} wrapEvents Wrap the text after the line has reached maxLength
   * @param {number} maxTitleLines The max number of vertical lines before cutting event title
   * @returns {string} The shortened string
   */
  shorten: function (string, maxLength, wrapEvents, maxTitleLines) {
    if (typeof string !== "string") {
      return "";
    }

    if (wrapEvents === true) {
      const words = string.split(" ");
      let temp = "";
      let currentLine = "";
      let line = 0;

      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        if (
          currentLine.length + word.length <
          (typeof maxLength === "number" ? maxLength : 25) - 1
        ) {
          // max - 1 to account for a space
          currentLine += `${word} `; // Template literal
        } else {
          line++;
          if (line > maxTitleLines - 1) {
            if (i < words.length) {
              currentLine += "&hellip;";
            }
            break;
          }

          if (currentLine.length > 0) {
            temp += `${currentLine}<br>${word} `; // Template literal
          } else {
            temp += `${word}<br>`; // Template literal
          }
          currentLine = "";
        }
      }

      return (temp + currentLine).trim();
    } else {
      if (
        maxLength &&
        typeof maxLength === "number" &&
        string.length > maxLength
      ) {
        return `${string.trim().slice(0, maxLength)}&hellip;`; // Template literal
      } else {
        return string.trim();
      }
    }
  },

  /**
   * Capitalize the first letter of a string
   *
   * @param {string} string The string to capitalize
   * @returns {string} The capitalized string
   */
  capFirst: function (string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
  },

  /**
   * Transforms the title of an event for usage.
   * Replaces parts of the text as defined in config.titleReplace.
   * Shortens title based on config.maxTitleLength and config.wrapEvents
   *
   * @param {string} title The title to transform.
   * @param {object} titleReplace Pairs of strings to be replaced in the title
   * @param {boolean} wrapEvents Wrap the text after the line has reached maxLength
   * @param {number} maxTitleLength The max length of the string
   * @param {number} maxTitleLines The max number of vertical lines before cutting event title
   * @returns {string} The transformed title.
   */
  titleTransform: function (
    title,
    titleReplace,
    wrapEvents,
    maxTitleLength,
    maxTitleLines
  ) {
    let newTitle = title; // Work on a new variable
    for (const needle in titleReplace) { // Use const for keys in for...in
      if (Object.prototype.hasOwnProperty.call(titleReplace, needle)) { // Fixed no-prototype-builtins
        const replacement = titleReplace[needle];
        let searchPattern = needle; // Use a new variable for the pattern

        const regParts = needle.match(/^\/(.+)\/([gim]*)$/);
        if (regParts) {
          // the parsed pattern is a regexp.
          searchPattern = new RegExp(regParts[1], regParts[2]);
        }
        newTitle = newTitle.replace(searchPattern, replacement);
      }
    }

    newTitle = this.shorten(newTitle, maxTitleLength, wrapEvents, maxTitleLines);
    return newTitle;
  },

  /**
   * Broadcasts the events to all other modules for reuse.
   * The all events available in one array, sorted on startDate.
   */
  broadcastEvents: function () {
    const now = new Date();
    const eventList = [];
    for (const calendarID in this.calendarData) { // `calendarID` is a key, `const` is appropriate
      for (const ev of this.calendarData[calendarID]) { // Use for...of for arrays
        const event = { ...ev }; // Use spread syntax for shallow clone instead of Object.assign
        event.symbol = this.symbolsForEvent(event);
        event.calendarName = this.calendarNameForCalendar(calendarID);
        event.color = this.colorForCalendar(calendarID);
        delete event.calendarID;

        // Make a broadcasting event to be compatible with the default calendar module.
        event.title = event.summary;

        event.fullDayEvent = !!(event.start?.date && event.end?.date);

        if (event.fullDayEvent) {
          // For all-day events, we ensure startDate is local midnight of the start day
          event.startDate = event.start?.date ? moment(event.start.date + "T00:00:00").valueOf() : null;
          // Ensure endDate is local midnight of the day *after* the end day (exclusive end)
          event.endDate = event.end?.date ? moment(event.end.date + "T00:00:00").valueOf() : null;
        } else {
          // For timed events, moment parses ISO8601 strings correctly with timezone
          event.startDate = event.start?.dateTime ? moment(event.start.dateTime).valueOf() : null;
          event.endDate = event.end?.dateTime ? moment(event.end.dateTime).valueOf() : null;
        }

        if (this.config.broadcastEvents && !this.config.broadcastPastEvents && event.endDate < now) {
          continue;
        }

        eventList.push(event);
      }
    }

    eventList.sort((a, b) => a.startDate - b.startDate); // Arrow function

    this.sendNotification("CALENDAR_EVENTS", eventList);
  }
});
