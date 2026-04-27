var NodeHelper = require("node_helper");
var util = require('util');

var ImapClient = require('emailjs-imap-client');


//Email-Analyse Function to format the fetched Email-Object
var analyzeEmails = function(path, client, that) {
		var query = {unseen: true};
		var Result = [];
		client.search(path, query).then((ids) => {
			console.log("Mail-Seach complete");
			if(ids.length>0)
			{
			client.listMessages(path, ids, ['uid','envelope']).then((messages) => {
				messages.forEach(function(m){
					var newMail = {
						id: m.uid,
						date: m.envelope.date,
						subject: m.envelope.subject,
						from: m.envelope.from,
						sender: m.envelope.sender,
						to: m.envelope.to
					}
					Result.push(newMail);
				})
				console.log("%s Mails fetched from %s", Result.length, path);
				that.sendSocketNotification('EMAIL_FETCH',{user: client.options.auth.user, messages: Result});
			});
			}
			else
			{
				that.sendSocketNotification('EMAIL_FETCH', {user: client.options.auth.user, messages: []});
			}
		});

	};

module.exports = NodeHelper.create({

	start: function(){
        console.log(this.name + ' helper started ...');
	},
    socketNotificationReceived : function(notification, payload){
		var that = this;
		if(notification === 'LISTEN_EMAIL'){
			var mailbox = payload.mailbox || 'INBOX';

			var login = [	payload.host,
							payload.port,
							{
							auth: {
								user: payload.user,
								pass: payload.pass,
								}
							}
						];

			var client = new ImapClient(login[0] , login[1], login[2]);


			//Create the Event Functions
			//==================================
			//--> IMAP-Update event
			client.onupdate = function(path, type, value){
				analyzeEmails(mailbox, this, that);
				if (type === 'exists') {
					client.listMessages(mailbox, value, ['envelope']).then((messages) => {
						messages.forEach((message) => {
							var d = message.envelope;
							console.log("NEUE EMAIL VON %s (%s) im Postfach %s",d.from[0].name,d.from[0].address,client.options.auth.user);
							that.sendSocketNotification('EMAIL_NEWMAIL', {user: client.options.auth.user, sender: d.from[0]});
						});
					});
				};
			}

			//--> Mailbox close Infomation Event
			client.onclosemailbox = function(path){
				console.log("MMM-Mail-Helper: Mailbox Closed: " + path);
			}

			//--> Imap Error Event
			client.onerror = function(err) {
				console.log("MMM-Mail-Helper: " + err);
				that.sendSocketNotification('EMAIL_ERROR', {user: client.options.auth.user});
			};


			//====================================
			//Last but Not Least: Configure and Start the IMAP-Client
			client.logLevel = client.LOG_LEVEL_NONE;
			client.connect().then(() => {
				console.log("connected");
				client.selectMailbox(mailbox).then(() => {
					analyzeEmails(mailbox, client, that);
				});
			});

		}
    },



});
