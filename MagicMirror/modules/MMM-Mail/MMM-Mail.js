Module.register("MMM-Mail",{
	defaults:{
		host: '',
		port: '',
		user: '',
		pass: '',
		mailbox: 'INBOX',	// legacy single-mailbox mode
		mailboxes: null,	// [{ name: 'Urgent2h', slaHours: 2 }, { name: 'INBOX' }]
		slaHours: null,		// legacy single-instance SLA (paired with `mailbox`)
		subjectlength: 50,
	},
	messagesByBox: {},		// { mailboxName: [messages] }
	slaTimer: null,

	start: function(){
		console.log("Email module started!");
        this.sendSocketNotification('LISTEN_EMAIL', this.config);
        this.loaded = false;

        // Re-render every minute so the SLA badge labels stay current.
        var self = this;
        if (this.anyMailboxHasSla()) {
            this.slaTimer = setInterval(function(){ self.updateDom(0); }, 60 * 1000);
        }
	},

	anyMailboxHasSla: function() {
		if (this.config.slaHours) return true;
		if (this.config.mailboxes) {
			return this.config.mailboxes.some(function(mb){ return mb.slaHours; });
		}
		return false;
	},

	socketNotificationReceived: function(notification, payload){
		if (payload.user != this.config.user) return;

		if (notification === 'EMAIL_FETCH'){
			this.messagesByBox[payload.mailbox] = payload.messages || [];
			this.updateDom(2000);
		}
		if (notification === 'EMAIL_NEWMAIL') {
			var sender = (payload.sender.name && payload.sender.name.length)
				? payload.sender.name : payload.sender.address;
			this.sendNotification("SHOW_ALERT",{
				type: "notification",
				title: "New Email on " + payload.user,
				message: "from " + sender
			});
		}
		if (notification === 'EMAIL_ERROR') {
			console.log("Email module restarted!");
			this.sendSocketNotification('LISTEN_EMAIL', this.config);
		}
    },

	getStyles: function() {
        return ["email.css", "font-awesome.css"];
    },

	// Returns { label, level } where level is 'ok' | 'warn' | 'crit' | 'over'.
	formatSla: function(receivedISO, hours) {
		var deadline = new Date(receivedISO).getTime() + hours * 3600 * 1000;
		var diff = deadline - Date.now();
		var over = diff < 0;
		var mins = Math.floor(Math.abs(diff) / 60000);
		var h = Math.floor(mins / 60);
		var m = mins % 60;
		var label = over ? ('OVERDUE ' + (h ? h + 'h ' : '') + m + 'min')
		                 : (h ? h + 'h ' + m + 'm left' : m + ' min left');
		var level;
		if (over) level = 'over';
		else if (mins < 15) level = 'crit';
		else if (mins < 60) level = 'warn';
		else level = 'ok';
		return { label: label, level: level };
	},

	// Flatten all mailboxes into a single sorted list:
	//   1. mails with slaHours, sorted by deadline ascending (most burning first)
	//   2. mails without slaHours, sorted by uid descending (newest first)
	collectMessages: function() {
		var all = [];
		var that = this;
		Object.keys(this.messagesByBox).forEach(function(box){
			that.messagesByBox[box].forEach(function(m){ all.push(m); });
		});
		var urgent = all.filter(function(m){ return m.slaHours; });
		var regular = all.filter(function(m){ return !m.slaHours; });
		urgent.sort(function(a, b){
			var aDl = new Date(a.date).getTime() + a.slaHours * 3600 * 1000;
			var bDl = new Date(b.date).getTime() + b.slaHours * 3600 * 1000;
			return aDl - bDl;
		});
		regular.sort(function(a, b){ return b.id - a.id; });
		return urgent.concat(regular);
	},

	getDom: function(){
        var wrapper = document.createElement("table");
        wrapper.className = "small mmm-mail";
        var that = this;

        var messages = this.collectMessages();
        if (this.config.numberOfEmails) {
            messages = messages.slice(0, this.config.numberOfEmails);
        }

        if (messages.length === 0) {
            wrapper.innerHTML = "No Unread mails";
            wrapper.className = "small dimmed";
            return wrapper;
        }

        var count = 0;
        messages.forEach(function (mailObj) {
            var name = (mailObj.sender[0].name || '').replace(/['"]+/g,"");
            var subject = (mailObj.subject || '').replace(/[\['"\]]+/g,"");

            var emailWrapper = document.createElement("tr");
            emailWrapper.className = "normal";

            var nameWrapper = document.createElement("tr");
            nameWrapper.className = "bright";
            nameWrapper.innerHTML = name.length ? name : mailObj.sender[0].address;
            emailWrapper.appendChild(nameWrapper);

            var subjectWrapper = document.createElement("tr");
            subjectWrapper.className = "light";
            if (subject.length > that.config.subjectlength) {
                subject = subject.substring(0, that.config.subjectlength);
            }
            subjectWrapper.innerHTML = subject;
            emailWrapper.appendChild(subjectWrapper);

            if (mailObj.slaHours && mailObj.date) {
                var sla = that.formatSla(mailObj.date, mailObj.slaHours);
                var slaWrapper = document.createElement("tr");
                slaWrapper.className = "sla sla-" + sla.level;
                slaWrapper.innerHTML = sla.label;
                emailWrapper.appendChild(slaWrapper);
            }

            wrapper.appendChild(emailWrapper);

            // Fade older entries to black, same math as before but applied
            // to the merged sorted list.
            if (that.config.fade) {
                var startingPoint = messages.length * 0.25;
                var steps = messages.length - startingPoint;
                if (count >= startingPoint) {
                    var currentStep = count - startingPoint;
                    emailWrapper.style.opacity = 1 - (1 / steps * currentStep);
                }
            }
            count++;
        });

        return wrapper;
    }
});
