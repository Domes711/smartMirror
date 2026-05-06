var NodeHelper = require("node_helper");
var util = require('util');

var ImapClient = require('emailjs-imap-client');


// Fetch unread message envelopes from `path`, tag them with the originating
// mailbox + slaHours so the frontend can sort/group across mailboxes, and
// emit one EMAIL_FETCH per mailbox.
var analyzeEmails = function(path, client, that, user, slaHours) {
		var query = {unseen: true};
		var Result = [];
		client.search(path, query).then((ids) => {
			if(ids.length>0)
			{
			client.listMessages(path, ids, ['uid','envelope']).then((messages) => {
				messages.forEach(function(m){
					Result.push({
						id: m.uid,
						date: m.envelope.date,
						subject: m.envelope.subject,
						from: m.envelope.from,
						sender: m.envelope.sender,
						to: m.envelope.to,
						mailbox: path,
						slaHours: slaHours
					});
				})
				console.log("MMM-Mail-Helper: %s mails fetched from %s", Result.length, path);
				that.sendSocketNotification('EMAIL_FETCH', {user: user, mailbox: path, messages: Result});
			});
			}
			else
			{
				that.sendSocketNotification('EMAIL_FETCH', {user: user, mailbox: path, messages: []});
			}
		});
	};

// One ImapClient per mailbox so each can keep its own onupdate subscription.
function watchMailbox(payload, mb, that) {
	var client = new ImapClient(payload.host, payload.port, {
		auth: { user: payload.user, pass: payload.pass }
	});

	client.onupdate = function(path, type, value){
		analyzeEmails(mb.name, this, that, payload.user, mb.slaHours);
		if (type === 'exists') {
			client.listMessages(mb.name, value, ['envelope']).then((messages) => {
				messages.forEach((message) => {
					var d = message.envelope;
					console.log("MMM-Mail-Helper: new mail from %s (%s) in %s",
						(d.from[0].name || ''), d.from[0].address, mb.name);
					that.sendSocketNotification('EMAIL_NEWMAIL',
						{user: payload.user, mailbox: mb.name, sender: d.from[0]});
				});
			});
		};
	};

	client.onclosemailbox = function(path){
		console.log("MMM-Mail-Helper: Mailbox Closed: " + path);
	};

	client.onerror = function(err) {
		console.log("MMM-Mail-Helper [" + mb.name + "]: " + err);
		that.sendSocketNotification('EMAIL_ERROR', {user: payload.user, mailbox: mb.name});
	};

	client.logLevel = client.LOG_LEVEL_NONE;
	client.connect().then(() => {
		console.log("MMM-Mail-Helper: connected, opening " + mb.name);
		client.selectMailbox(mb.name).then(() => {
			analyzeEmails(mb.name, client, that, payload.user, mb.slaHours);
		});
	});
}

module.exports = NodeHelper.create({

	start: function(){
        console.log(this.name + ' helper started ...');
	},

    socketNotificationReceived : function(notification, payload){
		if(notification === 'LISTEN_EMAIL'){
			// Normalise to a mailboxes array. Legacy single-mailbox configs
			// (mailbox + slaHours) become a one-element list.
			var mailboxes = (payload.mailboxes && payload.mailboxes.length)
				? payload.mailboxes
				: [{ name: payload.mailbox || 'INBOX', slaHours: payload.slaHours || null }];

			var that = this;
			mailboxes.forEach(function(mb) {
				watchMailbox(payload, mb, that);
			});
		}
    },

});
