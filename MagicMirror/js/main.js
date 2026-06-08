/* global Loader, addAnimateCSS, removeAnimateCSS, AnimateCSSIn, AnimateCSSOut, modulePositions, io */

const MM = (function () {
	let modules = [];

	/* Private Methods */

	/**
	 * Project a layout onto the mirror: move each module to its assigned region
	 * container and show it; hide all modules not in the layout.
	 * Called by the PROFILE_STATE / PROFILE_PREVIEW socket events.
	 * @param {Array} layout Array of {id, position} entries from profile.js.
	 */
	const projectLayout = function (layout) {
		const wantedById = new Map();
		for (const entry of layout) {
			if (!entry || !entry.id || !entry.position) continue;
			wantedById.set(entry.id, entry.position);
		}
		for (const mod of modules) {
			if (!mod.data || !mod.data.id) continue;
			const pos = wantedById.get(mod.data.id);
			const elNode = document.getElementById(mod.identifier);
			if (!elNode) continue;
			if (pos) {
				const region = document.querySelector(".region." + pos.replace(/_/g, "."));
				const target = (region && region.querySelector(":scope > .container")) || region;
				if (target && elNode.parentElement !== target) target.appendChild(elNode);
				mod.show(0, () => {}, { lockString: "mm-profile" });
			} else {
				mod.hide(0, () => {}, { lockString: "mm-profile" });
			}
		}
	};

	/**
	 * Build the Face ID indicator inner HTML (same visual as MMM-Profile._buildProfile).
	 * @param {string} profileClass  "success" | "error" | ""
	 * @param {string} displayName   User display name (empty string for unknown/asleep)
	 * @param {string} state         Current profile state
	 * @returns {string} HTML string
	 */
	const buildProfileHTML = function (profileClass, displayName, state) {
		const intro = (state === "scanning") ? " intro" : "";
		return `<div class="profile${profileClass ? " " + profileClass : ""}">
  <div class="scanner${intro}">
    <div class="ring">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle class="ring-circle" cx="50" cy="50" r="49" pathLength="60" stroke-dasharray="1 1"/>
      </svg>
    </div>
    <div class="dots"></div>
    <div class="scan-line"></div>
    <svg class="face" viewBox="0 0 100 100" aria-hidden="true">
      <circle class="outline" cx="50" cy="50" r="34"/>
      <path class="eye-l" d="M38 42 v6"/>
      <path class="eye-r" d="M62 42 v6"/>
      <path class="mouth" d="M38 62 Q50 70 62 62"/>
      <path class="x-stroke x1" d="M30 30 L70 70"/>
      <path class="x-stroke x2" d="M70 30 L30 70"/>
    </svg>
    <div class="avatar" aria-hidden="true">
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="38" r="18"/>
        <path d="M14 96 C14 70 30 60 50 60 C70 60 86 70 86 96 Z"/>
      </svg>
    </div>
  </div>
  <div class="profile-info"><div class="name">${displayName}</div></div>
</div>`;
	};

	/**
	 * Create or update the Face ID indicator in top_center.
	 * @param {string} state        Profile state: asleep|scanning|user|dimming
	 * @param {string|null} currentUser  Currently recognized user key
	 */
	const renderProfileIndicator = function (state, currentUser) {
		let el = document.getElementById("mm-profile");
		if (!el) {
			const wrapper = selectWrapper("top_center");
			if (!wrapper) return;
			el = document.createElement("div");
			el.id = "mm-profile";
			wrapper.prepend(el);
		}

		// "module" class is required so updateWrapperStates() counts this element
		// when deciding whether the top_center container should be visible.
		el.className = "module mmp";
		el.dataset.state = state;

		if (state === "asleep") {
			el.innerHTML = "";
			el.style.position = "fixed"; // excluded from updateWrapperStates visibility check
			updateWrapperStates();
			return;
		}

		el.style.position = ""; // default — updateWrapperStates treats this as visible

		const cfg = (typeof config !== "undefined" && config.profile) || {};
		const defaultUser = cfg.defaultUser || "default";
		const names = cfg.userDisplayNames || {};
		const isKnown = currentUser && currentUser !== defaultUser;
		const displayName = isKnown ? (names[currentUser] || currentUser) : "";
		const profileClass = (state === "user" || state === "dimming")
			? (isKnown ? "success" : "error") : "";

		el.innerHTML = buildProfileHTML(profileClass, displayName, state);
		updateWrapperStates();
	};

	/**
	 * Create dom objects for all modules that are configured for a specific position.
	 */
	const createDomObjects = function () {
		const domCreationPromises = [];

		modules.forEach(function (module) {
			// Decide where this module's DOM node is created. A fixed position
			// goes straight into that region. A managed module (carries an `id`)
			// without a position is placed and shown later by the profile system
			// (projectLayout), so park its DOM in the hidden staging area now —
			// otherwise it would have no DOM node and could never be shown in any
			// time-window layout. Truly position-less, unmanaged modules are
			// skipped as before.
			let wrapper;
			if (typeof module.data.position === "string") {
				wrapper = selectWrapper(module.data.position);
			} else if (module.data.id) {
				wrapper = document.getElementById("mm-hot-staging") || document.body;
			} else {
				return;
			}

			let haveAnimateIn = null;
			// check if have valid animateIn in module definition (module.data.animateIn)
			if (module.data.animateIn && AnimateCSSIn.indexOf(module.data.animateIn) !== -1) haveAnimateIn = module.data.animateIn;

			const dom = document.createElement("div");
			dom.id = module.identifier;
			dom.className = module.name;

			if (typeof module.data.classes === "string") {
				dom.className = `module ${dom.className} ${module.data.classes}`;
			}

			dom.style.order = (typeof module.data.order === "number" && Number.isInteger(module.data.order)) ? module.data.order : 0;

			dom.opacity = 0;
			wrapper.appendChild(dom);

			const moduleHeader = document.createElement("header");
			moduleHeader.innerHTML = module.getHeader();
			moduleHeader.className = "module-header";
			dom.appendChild(moduleHeader);

			if (typeof module.getHeader() === "undefined" || module.getHeader() !== "") {
				moduleHeader.style.display = "none;";
			} else {
				moduleHeader.style.display = "block;";
			}

			const moduleContent = document.createElement("div");
			moduleContent.className = "module-content";
			dom.appendChild(moduleContent);

			// create the domCreationPromise with AnimateCSS (with animateIn of module definition)
			// or just display it
			var domCreationPromise;
			if (haveAnimateIn) domCreationPromise = updateDom(module, { options: { speed: 1000, animate: { in: haveAnimateIn } } }, true);
			else domCreationPromise = updateDom(module, 0);

			domCreationPromises.push(domCreationPromise);
			domCreationPromise
				.then(function () {
					sendNotification("MODULE_DOM_CREATED", null, null, module);
				})
				.catch(Log.error);
		});

		updateWrapperStates();

		Promise.all(domCreationPromises).then(function () {
			sendNotification("DOM_OBJECTS_CREATED");
		});
	};

	/**
	 * Select the wrapper dom object for a specific position.
	 * @param {string} position The name of the position.
	 * @returns {HTMLElement | void} the wrapper element
	 */
	const selectWrapper = function (position) {
		const classes = position.replace("_", " ");
		const parentWrapper = document.getElementsByClassName(classes);
		if (parentWrapper.length > 0) {
			const wrapper = parentWrapper[0].getElementsByClassName("container");
			if (wrapper.length > 0) {
				return wrapper[0];
			}
		}
	};

	/**
	 * Send a notification to all modules.
	 * @param {string} notification The identifier of the notification.
	 * @param {object} payload The payload of the notification.
	 * @param {Module} sender The module that sent the notification.
	 * @param {Module} [sendTo] The (optional) module to send the notification to.
	 */
	const sendNotification = function (notification, payload, sender, sendTo) {
		for (const m in modules) {
			const module = modules[m];
			if (module !== sender && (!sendTo || module === sendTo)) {
				module.notificationReceived(notification, payload, sender);
			}
		}
	};

	/**
	 * Update the dom for a specific module.
	 * @param {Module} module The module that needs an update.
	 * @param {object|number} [updateOptions] The (optional) number of microseconds for the animation or object with updateOptions (speed/animates)
	 * @param {boolean} [createAnimatedDom] for displaying only animateIn (used on first start of MagicMirror)
	 * @returns {Promise} Resolved when the dom is fully updated.
	 */
	const updateDom = function (module, updateOptions, createAnimatedDom = false) {
		return new Promise(function (resolve) {
			let speed = updateOptions;
			let animateOut = null;
			let animateIn = null;
			if (typeof updateOptions === "object") {
				if (typeof updateOptions.options === "object" && updateOptions.options.speed !== undefined) {
					speed = updateOptions.options.speed;
					Log.debug(`updateDom: ${module.identifier} Has speed in object: ${speed}`);
					if (typeof updateOptions.options.animate === "object") {
						animateOut = updateOptions.options.animate.out;
						animateIn = updateOptions.options.animate.in;
						Log.debug(`updateDom: ${module.identifier} Has animate in object: out->${animateOut}, in->${animateIn}`);
					}
				} else {
					Log.debug(`updateDom: ${module.identifier} Has no speed in object`);
					speed = 0;
				}
			}

			const newHeader = module.getHeader();
			let newContentPromise = module.getDom();

			if (!(newContentPromise instanceof Promise)) {
				// convert to a promise if not already one to avoid if/else's everywhere
				newContentPromise = Promise.resolve(newContentPromise);
			}

			newContentPromise
				.then(function (newContent) {
					const updatePromise = updateDomWithContent(module, speed, newHeader, newContent, animateOut, animateIn, createAnimatedDom);

					updatePromise.then(resolve).catch(Log.error);
				})
				.catch(Log.error);
		});
	};

	/**
	 * Update the dom with the specified content
	 * @param {Module} module The module that needs an update.
	 * @param {number} [speed] The (optional) number of microseconds for the animation.
	 * @param {string} newHeader The new header that is generated.
	 * @param {HTMLElement} newContent The new content that is generated.
	 * @param {string} [animateOut] AnimateCss animation name before hidden
	 * @param {string} [animateIn] AnimateCss animation name on show
	 * @param {boolean} [createAnimatedDom] for displaying only animateIn (used on first start)
	 * @returns {Promise} Resolved when the module dom has been updated.
	 */
	const updateDomWithContent = function (module, speed, newHeader, newContent, animateOut, animateIn, createAnimatedDom = false) {
		return new Promise(function (resolve) {
			if (module.hidden || !speed) {
				updateModuleContent(module, newHeader, newContent);
				resolve();
				return;
			}

			if (!moduleNeedsUpdate(module, newHeader, newContent)) {
				resolve();
				return;
			}

			if (!speed) {
				updateModuleContent(module, newHeader, newContent);
				resolve();
				return;
			}

			if (createAnimatedDom && animateIn !== null) {
				Log.debug(`${module.identifier} createAnimatedDom (${animateIn})`);
				updateModuleContent(module, newHeader, newContent);
				if (!module.hidden) {
					showModule(module, speed, null, { animate: animateIn });
				}
				resolve();
				return;
			}

			hideModule(
				module,
				speed / 2,
				function () {
					updateModuleContent(module, newHeader, newContent);
					if (!module.hidden) {
						showModule(module, speed / 2, null, { animate: animateIn });
					}
					resolve();
				},
				{ animate: animateOut }
			);
		});
	};

	/**
	 * Check if the content has changed.
	 * @param {Module} module The module to check.
	 * @param {string} newHeader The new header that is generated.
	 * @param {HTMLElement} newContent The new content that is generated.
	 * @returns {boolean} True if the module need an update, false otherwise
	 */
	const moduleNeedsUpdate = function (module, newHeader, newContent) {
		const moduleWrapper = document.getElementById(module.identifier);
		if (moduleWrapper === null) {
			return false;
		}

		const contentWrapper = moduleWrapper.getElementsByClassName("module-content");
		const headerWrapper = moduleWrapper.getElementsByClassName("module-header");

		let headerNeedsUpdate = false;
		let contentNeedsUpdate;

		if (headerWrapper.length > 0) {
			headerNeedsUpdate = newHeader !== headerWrapper[0].innerHTML;
		}

		const tempContentWrapper = document.createElement("div");
		tempContentWrapper.appendChild(newContent);
		contentNeedsUpdate = tempContentWrapper.innerHTML !== contentWrapper[0].innerHTML;

		return headerNeedsUpdate || contentNeedsUpdate;
	};

	/**
	 * Update the content of a module on screen.
	 * @param {Module} module The module to check.
	 * @param {string} newHeader The new header that is generated.
	 * @param {HTMLElement} newContent The new content that is generated.
	 */
	const updateModuleContent = function (module, newHeader, newContent) {
		const moduleWrapper = document.getElementById(module.identifier);
		if (moduleWrapper === null) {
			return;
		}
		const headerWrapper = moduleWrapper.getElementsByClassName("module-header");
		const contentWrapper = moduleWrapper.getElementsByClassName("module-content");

		contentWrapper[0].innerHTML = "";
		contentWrapper[0].appendChild(newContent);

		headerWrapper[0].innerHTML = newHeader;
		if (headerWrapper.length > 0 && newHeader) {
			headerWrapper[0].style.display = "block";
		} else {
			headerWrapper[0].style.display = "none";
		}
	};

	/**
	 * Hide the module.
	 * @param {Module} module The module to hide.
	 * @param {number} speed The speed of the hide animation.
	 * @param {Promise} callback Called when the animation is done.
	 * @param {object} [options] Optional settings for the hide method.
	 */
	const hideModule = function (module, speed, callback, options = {}) {
		// set lockString if set in options.
		if (options.lockString) {
			if (module.lockStrings.indexOf(options.lockString) === -1) {
				module.lockStrings.push(options.lockString);
			}
		}

		const moduleWrapper = document.getElementById(module.identifier);
		if (moduleWrapper !== null) {
			clearTimeout(module.showHideTimer);
			// reset all animations if needed
			if (module.hasAnimateOut) {
				removeAnimateCSS(module.identifier, module.hasAnimateOut);
				Log.debug(`${module.identifier} Force remove animateOut (in hide): ${module.hasAnimateOut}`);
				module.hasAnimateOut = false;
			}
			if (module.hasAnimateIn) {
				removeAnimateCSS(module.identifier, module.hasAnimateIn);
				Log.debug(`${module.identifier} Force remove animateIn (in hide): ${module.hasAnimateIn}`);
				module.hasAnimateIn = false;
			}
			// haveAnimateName for verify if we are using AnimateCSS library
			// we check AnimateCSSOut Array for validate it
			// and finally return the animate name or `null` (for default MM² animation)
			let haveAnimateName = null;
			// check if have valid animateOut in module definition (module.data.animateOut)
			if (module.data.animateOut && AnimateCSSOut.indexOf(module.data.animateOut) !== -1) haveAnimateName = module.data.animateOut;
			// can't be override with options.animate
			else if (options.animate && AnimateCSSOut.indexOf(options.animate) !== -1) haveAnimateName = options.animate;

			if (haveAnimateName) {
				// with AnimateCSS
				Log.debug(`${module.identifier} Has animateOut: ${haveAnimateName}`);
				module.hasAnimateOut = haveAnimateName;
				addAnimateCSS(module.identifier, haveAnimateName, speed / 1000);
				module.showHideTimer = setTimeout(function () {
					removeAnimateCSS(module.identifier, haveAnimateName);
					Log.debug(`${module.identifier} Remove animateOut: ${module.hasAnimateOut}`);
					// AnimateCSS is now done
					moduleWrapper.style.opacity = 0;
					moduleWrapper.classList.add("hidden");
					moduleWrapper.style.position = "fixed";
					module.hasAnimateOut = false;

					updateWrapperStates();
					if (typeof callback === "function") {
						callback();
					}
				}, speed);
			} else {
				// default MM² Animate
				moduleWrapper.style.transition = `opacity ${speed / 1000}s`;
				moduleWrapper.style.opacity = 0;
				moduleWrapper.classList.add("hidden");
				module.showHideTimer = setTimeout(function () {
					// To not take up any space, we just make the position absolute.
					// since it's fade out anyway, we can see it lay above or
					// below other modules. This works way better than adjusting
					// the .display property.
					moduleWrapper.style.position = "fixed";

					updateWrapperStates();

					if (typeof callback === "function") {
						callback();
					}
				}, speed);
			}
		} else {
			// invoke callback even if no content, issue 1308
			if (typeof callback === "function") {
				callback();
			}
		}
	};

	/**
	 * Show the module.
	 * @param {Module} module The module to show.
	 * @param {number} speed The speed of the show animation.
	 * @param {Promise} callback Called when the animation is done.
	 * @param {object} [options] Optional settings for the show method.
	 */
	const showModule = function (module, speed, callback, options = {}) {
		// remove lockString if set in options.
		if (options.lockString) {
			const index = module.lockStrings.indexOf(options.lockString);
			if (index !== -1) {
				module.lockStrings.splice(index, 1);
			}
		}

		// Check if there are no more lockStrings set, or the force option is set.
		// Otherwise cancel show action.
		if (module.lockStrings.length !== 0 && options.force !== true) {
			Log.log(`Will not show ${module.name}. LockStrings active: ${module.lockStrings.join(",")}`);
			if (typeof options.onError === "function") {
				options.onError(new Error("LOCK_STRING_ACTIVE"));
			}
			return;
		}
		// reset all animations if needed
		if (module.hasAnimateOut) {
			removeAnimateCSS(module.identifier, module.hasAnimateOut);
			Log.debug(`${module.identifier} Force remove animateOut (in show): ${module.hasAnimateOut}`);
			module.hasAnimateOut = false;
		}
		if (module.hasAnimateIn) {
			removeAnimateCSS(module.identifier, module.hasAnimateIn);
			Log.debug(`${module.identifier} Force remove animateIn (in show): ${module.hasAnimateIn}`);
			module.hasAnimateIn = false;
		}

		module.hidden = false;

		// If forced show, clean current lockStrings.
		if (module.lockStrings.length !== 0 && options.force === true) {
			Log.log(`Force show of module: ${module.name}`);
			module.lockStrings = [];
		}

		const moduleWrapper = document.getElementById(module.identifier);
		if (moduleWrapper !== null) {
			clearTimeout(module.showHideTimer);

			// haveAnimateName for verify if we are using AnimateCSS library
			// we check AnimateCSSIn Array for validate it
			// and finally return the animate name or `null` (for default MM² animation)
			let haveAnimateName = null;
			// check if have valid animateOut in module definition (module.data.animateIn)
			if (module.data.animateIn && AnimateCSSIn.indexOf(module.data.animateIn) !== -1) haveAnimateName = module.data.animateIn;
			// can't be override with options.animate
			else if (options.animate && AnimateCSSIn.indexOf(options.animate) !== -1) haveAnimateName = options.animate;

			if (!haveAnimateName) moduleWrapper.style.transition = `opacity ${speed / 1000}s`;
			// Restore the position. See hideModule() for more info.
			moduleWrapper.style.position = "static";
			moduleWrapper.classList.remove("hidden");

			updateWrapperStates();

			// Waiting for DOM-changes done in updateWrapperStates before we can start the animation.
			void moduleWrapper.parentElement.parentElement.offsetHeight;
			moduleWrapper.style.opacity = 1;

			if (haveAnimateName) {
				// with AnimateCSS
				Log.debug(`${module.identifier} Has animateIn: ${haveAnimateName}`);
				module.hasAnimateIn = haveAnimateName;
				addAnimateCSS(module.identifier, haveAnimateName, speed / 1000);
				module.showHideTimer = setTimeout(function () {
					removeAnimateCSS(module.identifier, haveAnimateName);
					Log.debug(`${module.identifier} Remove animateIn: ${haveAnimateName}`);
					module.hasAnimateIn = false;
					if (typeof callback === "function") {
						callback();
					}
				}, speed);
			} else {
				// default MM² Animate
				module.showHideTimer = setTimeout(function () {
					if (typeof callback === "function") {
						callback();
					}
				}, speed);
			}
		} else {
			// invoke callback
			if (typeof callback === "function") {
				callback();
			}
		}
	};

	/**
	 * Checks for all positions if it has visible content.
	 * If not, if will hide the position to prevent unwanted margins.
	 * This method should be called by the show and hide methods.
	 *
	 * Example:
	 * If the top_bar only contains the update notification. And no update is available,
	 * the update notification is hidden. The top bar still occupies space making for
	 * an ugly top margin. By using this function, the top bar will be hidden if the
	 * update notification is not visible.
	 */

	const updateWrapperStates = function () {
		modulePositions.forEach(function (position) {
			const wrapper = selectWrapper(position);
			const moduleWrappers = wrapper.getElementsByClassName("module");

			let showWrapper = false;
			Array.prototype.forEach.call(moduleWrappers, function (moduleWrapper) {
				if (moduleWrapper.style.position === "" || moduleWrapper.style.position === "static") {
					showWrapper = true;
				}
			});

			// move container definitions to main CSS
			wrapper.className = showWrapper ? "container" : "container hidden";
		});
	};

	/**
	 * Loads the core config from the server (already combined with the system defaults).
	 */
	const loadConfig = async function () {
		try {
			const res = await fetch(new URL("config/", `${location.origin}${config.basePath}`));

			// The server tags functions as { __mmFunction: "<source>" } because
			// JSON.stringify can't serialise live functions. This reviver turns
			// those tagged objects back into callable functions.
			config = JSON.parse(await res.text(), (key, value) => {
				if (value && typeof value === "object" && typeof value.__mmFunction === "string") {
					try {
						return new Function(`return (${value.__mmFunction})`)();
					} catch {
						Log.warn(`Failed to revive function for config key "${key}".`);
					}
				}
				return value;
			});
		} catch (error) {
			Log.error("Unable to retrieve config", error);
		}
	};

	/**
	 * Adds special selectors on a collection of modules.
	 * @param {Module[]} modules Array of modules.
	 */
	const setSelectionMethodsForModules = function (modules) {

		/**
		 * Filter modules with the specified classes.
		 * @param {string|string[]} className one or multiple classnames (array or space divided).
		 * @returns {Module[]} Filtered collection of modules.
		 */
		const withClass = function (className) {
			return modulesByClass(className, true);
		};

		/**
		 * Filter modules without the specified classes.
		 * @param {string|string[]} className one or multiple classnames (array or space divided).
		 * @returns {Module[]} Filtered collection of modules.
		 */
		const exceptWithClass = function (className) {
			return modulesByClass(className, false);
		};

		/**
		 * Filters a collection of modules based on classname(s).
		 * @param {string|string[]} className one or multiple classnames (array or space divided).
		 * @param {boolean} include if the filter should include or exclude the modules with the specific classes.
		 * @returns {Module[]} Filtered collection of modules.
		 */
		const modulesByClass = function (className, include) {
			let searchClasses = className;
			if (typeof className === "string") {
				searchClasses = className.split(" ");
			}

			const newModules = modules.filter(function (module) {
				const classes = module.data.classes.toLowerCase().split(" ");

				for (const searchClass of searchClasses) {
					if (classes.indexOf(searchClass.toLowerCase()) !== -1) {
						return include;
					}
				}

				return !include;
			});

			setSelectionMethodsForModules(newModules);
			return newModules;
		};

		/**
		 * Removes a module instance from the collection.
		 * @param {object} module The module instance to remove from the collection.
		 * @returns {Module[]} Filtered collection of modules.
		 */
		const exceptModule = function (module) {
			const newModules = modules.filter(function (mod) {
				return mod.identifier !== module.identifier;
			});

			setSelectionMethodsForModules(newModules);
			return newModules;
		};

		/**
		 * Walks thru a collection of modules and executes the callback with the module as an argument.
		 * @param {module} callback The function to execute with the module as an argument.
		 */
		const enumerate = function (callback) {
			modules.map(function (module) {
				callback(module);
			});
		};

		if (typeof modules.withClass === "undefined") {
			Object.defineProperty(modules, "withClass", { value: withClass, enumerable: false });
		}
		if (typeof modules.exceptWithClass === "undefined") {
			Object.defineProperty(modules, "exceptWithClass", { value: exceptWithClass, enumerable: false });
		}
		if (typeof modules.exceptModule === "undefined") {
			Object.defineProperty(modules, "exceptModule", { value: exceptModule, enumerable: false });
		}
		if (typeof modules.enumerate === "undefined") {
			Object.defineProperty(modules, "enumerate", { value: enumerate, enumerable: false });
		}
	};

	return {

		/* Public Methods */

		/**
		 * Main init method.
		 */
		async init () {
			Log.info("Initializing MagicMirror².");
			await loadConfig();

			Log.setLogLevel(config.logLevel);

			await Translator.loadCoreTranslations(config.language);
			await Loader.loadModules();
		},

		/**
		 * Gets called when all modules are started.
		 * @param {Module[]} moduleObjects All module instances.
		 */
		modulesStarted (moduleObjects) {
			modules = [];
			let startUp = "";

			moduleObjects.forEach((module) => modules.push(module));

			Log.info("All modules started!");
			sendNotification("ALL_MODULES_STARTED");

			// Hidden staging area: managed modules without a fixed position — their
			// placement comes from the core profile system at runtime — and
			// hot-loaded modules live here until projectLayout moves them into the
			// right region container. Created BEFORE createDomObjects() so that
			// startup managed modules can be parked here too (otherwise they would
			// get no DOM node and could never be shown in a time-window layout).
			if (!document.getElementById("mm-hot-staging")) {
				const staging = document.createElement("div");
				staging.id = "mm-hot-staging";
				staging.style.display = "none";
				document.body.appendChild(staging);
			}

			createDomObjects();

			// Setup global socket listener for RELOAD event (watch mode)
			if (typeof io !== "undefined") {
				const socket = io("/", {
					path: `${config.basePath || "/"}socket.io`
				});

				socket.on("RELOAD", () => {
					Log.warn("Reload notification received from server");
					window.location.reload(true);
				});

				// Core profile system: presence/face-reco → layout projection + Face ID UI
				socket.on("PROFILE_STATE", ({ state, currentUser, layout }) => {
					renderProfileIndicator(state, currentUser);
					projectLayout(layout || []);
				});

				socket.on("PROFILE_PREVIEW", ({ layout }) => {
					projectLayout(layout || []);
				});

				// Hot-load a brand-new module without a page reload.
				// Triggered by mirror-console after it registers the module in config.js.
				socket.on("MODULE_HOT_LOAD", async ({ moduleName, moduleId, moduleConfig }) => {
					Log.info(`[MM] Hot-loading module: ${moduleName} (id: ${moduleId})`);

					// Skip if we already have an instance of this module
					if (modules.some((m) => m.name === moduleName && (m.data.id === moduleId || !moduleId))) {
						Log.info(`[MM] ${moduleName} already in modules — skipping hot-load`);
						return;
					}

					let envVars;
					try {
						envVars = await fetch(`${config.basePath || "/"}env`).then((r) => r.json());
					} catch {
						envVars = { modulesDir: "modules", defaultModulesDir: "defaultmodules" };
					}

					const isDefault = (typeof defaultModules !== "undefined") && defaultModules.indexOf(moduleName) !== -1;
					const folder = isDefault
						? `${envVars.defaultModulesDir}/${moduleName}/`
						: `${envVars.modulesDir}/${moduleName}/`;

					const idx = modules.length;
					const moduleData = {
						index: idx,
						identifier: `module_hot_${idx}_${moduleName}`,
						id: moduleId || null,
						name: moduleName,
						path: folder,
						file: `${moduleName}.js`,
						position: undefined,
						classes: moduleName,
						configDeepMerge: false,
						config: moduleConfig || {},
						animateIn: null,
						animateOut: null,
						hiddenOnStartup: false,
						header: undefined,
						order: 0
					};

					try {
						const mObj = await Loader.hotLoadModule(moduleData);
						if (mObj) await MM.addModule(mObj);
					} catch (e) {
						Log.error(`[MM] Hot-load failed for ${moduleName}:`, e);
					}
				});
			}

			if (config.reloadAfterServerRestart) {
				setInterval(async () => {
					// if server startup time has changed (which means server was restarted)
					// the client reloads the mm page
					try {
						const res = await fetch(`${location.protocol}//${location.host}${config.basePath}startup`);
						const curr = await res.text();
						if (startUp === "") startUp = curr;
						if (startUp !== curr) {
							startUp = "";
							window.location.reload(true);
							Log.warn("Refreshing Website because server was restarted");
						}
					} catch (err) {
						Log.error(`MagicMirror not reachable: ${err}`);
					}
				}, config.checkServerInterval);
			}
		},

		/**
		 * Send a notification to all modules.
		 * @param {string} notification The identifier of the notification.
		 * @param {object} payload The payload of the notification.
		 * @param {Module} sender The module that sent the notification.
		 */
		sendNotification (notification, payload, sender) {
			if (arguments.length < 3) {
				Log.error("sendNotification: Missing arguments.");
				return;
			}

			if (typeof notification !== "string") {
				Log.error("sendNotification: Notification should be a string.");
				return;
			}

			if (!(sender instanceof Module)) {
				Log.error("sendNotification: Sender should be a module.");
				return;
			}

			// Further implementation is done in the private method.
			sendNotification(notification, payload, sender);
		},

		/**
		 * Update the dom for a specific module.
		 * @param {Module} module The module that needs an update.
		 * @param {object|number} [updateOptions] The (optional) number of microseconds for the animation or object with updateOptions (speed/animates)
		 */
		updateDom (module, updateOptions) {
			if (!(module instanceof Module)) {
				Log.error("updateDom: Sender should be a module.");
				return;
			}

			if (!module.data.position) {
				Log.warn("module tries to update the DOM without being displayed.");
				return;
			}

			// Further implementation is done in the private method.
			updateDom(module, updateOptions).then(function () {
				// Once the update is complete and rendered, send a notification to the module that the DOM has been updated
				sendNotification("MODULE_DOM_UPDATED", null, null, module);
			});
		},

		/**
		 * Returns a collection of all modules currently active.
		 * @returns {Module[]} A collection of all modules currently active.
		 */
		getModules () {
			setSelectionMethodsForModules(modules);
			return modules;
		},

		/**
		 * Hot-add a single module at runtime (no page reload).
		 * Creates its DOM in the staging area; the core profile system moves it
		 * on the next PROFILE_STATE / PROFILE_PREVIEW event.
		 * @param {Module} mObj Bootstrapped module instance from Loader.hotLoadModule().
		 * @returns {Promise<void>}
		 */
		async addModule (mObj) {
			modules.push(mObj);

			const dom = document.createElement("div");
			dom.id = mObj.identifier;
			dom.className = `module ${mObj.name}`;
			if (typeof mObj.data.classes === "string") {
				dom.className = `module ${mObj.name} ${mObj.data.classes}`;
			}
			dom.style.order = 0;

			const header = document.createElement("header");
			header.className = "module-header";
			header.style.display = "none";
			dom.appendChild(header);

			const content = document.createElement("div");
			content.className = "module-content";
			dom.appendChild(content);

			const staging = document.getElementById("mm-hot-staging") || document.body;
			staging.appendChild(dom);

			await updateDom(mObj, 0);
			await mObj.start();

			updateWrapperStates();
			sendNotification("MODULE_DOM_CREATED", null, null, mObj);
		},

		/**
		 * Hide the module.
		 * @param {Module} module The module to hide.
		 * @param {number} speed The speed of the hide animation.
		 * @param {Promise} callback Called when the animation is done.
		 * @param {object} [options] Optional settings for the hide method.
		 */
		hideModule (module, speed, callback, options) {
			module.hidden = true;
			hideModule(module, speed, callback, options);
		},

		/**
		 * Show the module.
		 * @param {Module} module The module to show.
		 * @param {number} speed The speed of the show animation.
		 * @param {Promise} callback Called when the animation is done.
		 * @param {object} [options] Optional settings for the show method.
		 */
		showModule (module, speed, callback, options) {
			// do not change module.hidden yet, only if we really show it later
			showModule(module, speed, callback, options);
		},

		// Return all available module positions.
		getAvailableModulePositions: modulePositions
	};
}());

// Add polyfill for Object.assign.
if (typeof Object.assign !== "function") {
	(function () {
		Object.assign = function (target) {
			"use strict";
			if (target === undefined || target === null) {
				throw new TypeError("Cannot convert undefined or null to object");
			}
			const output = Object(target);
			for (let index = 1; index < arguments.length; index++) {
				const source = arguments[index];
				if (source !== undefined && source !== null) {
					for (const nextKey in source) {
						if (source.hasOwnProperty(nextKey)) {
							output[nextKey] = source[nextKey];
						}
					}
				}
			}
			return output;
		};
	}());
}

MM.init();
