import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getMessaging, getToken, onMessage } from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-messaging.js';
import { setupSheet } from './functions.mjs';

const firebaseConfig = {
  apiKey: "AIzaSyDtw7E-D4BWkFq5rL6bmzJzUtiG1DJOygE",
  authDomain: "freshpet-7ebb3.firebaseapp.com",
  projectId: "freshpet-7ebb3",
  storageBucket: "freshpet-7ebb3.appspot.com",
  messagingSenderId: "522750778402",
  appId: "1:522750778402:web:0afb297e5309fa4791be7b"
},
vapidKey = "BAxTocAeEkCyF-BQazn2CXa3MWoEoAKZ2DyQiUMbi8YVTVlnSVb_KBneQRK-5i8kfwRnLpL6rtewWeXOsBHA2Ik";

function getFCMToken(messaging, serviceWorker){
	return new Promise((resolve, reject) => {
		if(sessionStorage.getItem('fcmToken'))
			return resolve(sessionStorage.getItem('fcmToken'));

		if('Notification' in window){
			getToken(messaging, {
				serviceWorkerRegistration: serviceWorker,
				vapidKey: vapidKey
			}).then((currentToken) => {
				if (currentToken)
					saveFCMToken(currentToken, resolve, reject);

			}).catch((err) => {
				reject('An error occurred: '+err);
			});
		} else {
			const device = G.deviceInfo();

			if(device.os == 'iOS'){
				if(sessionStorage.pwaMode == 'twa'){
					if (window.iOSPushCapability){
					 	window.addEventListener('push-permission-request', (message) => {
						  if (message && message.detail && message.detail.state == 'granted')
						    saveFCMToken(message.detail.token, resolve, reject);
						  else
						  	reject('Permission not granted');

						}, {once: true});

					 	window.webkit.messageHandlers['push-permission-request'].postMessage('push-permission-request');

					} else
						reject('Notifications are not supported on this device.');

				} else if(sessionStorage.pwaMode == 'browser')
					reject('To receive notifications, you must add FreshPet to your home screen. Tap <span class="material-icons">ios_share</span> Share and then Add to Home Screen. Open the app from your home screen and try again.');
			} else
				reject('Notifications are not supported on your browser. Please switch to a modern web browser.');
		}
	});
}

function saveFCMToken(token, resolve, reject){
	sessionStorage.setItem('fcmToken', token);
	const failError = 'Something went wrong. We couldn\'t save your device info to send notifications. Please try agian later or from another device';

	G.ajax({
		url: config.site_url+'/devices',
		type: 'POST',
		data: {
			action: 'save',
			tag: token
		}
	}).then(data => {
		if(data.responseText == '0')
			reject(failError);
		else
			resolve(token);
	}).catch(err => {
		console.log(err);
		reject(failError);
	});
}

function promptServiceWorkerUpdate(serviceWorker){
	const sheet = setupSheet('Update app');
	sheet.body.innerHTML = '<h3>An update is available</h3><p>It is recommended to update app to get the latest version for new features and bug fixes.</p><p><button type="button" class="btn filled">Update App</button>';
	sheet.body.addEventListener('click', e => {
		if(e.target.matches('button')){
			if (serviceWorker.waiting)
	      serviceWorker.waiting.postMessage({ type: 'SKIP_WAITING' });
		}
	});
}

// Initialize Firebase
const firebase = initializeApp(firebaseConfig);
const messaging = getMessaging();

onMessage(messaging, (payload) => {
	navigator.serviceWorker.getRegistration('/firebase-cloud-messaging-push-scope').then(registration => {
		registration.showNotification(
			payload.notification.title,
			{ body: payload.notification.body }
		)
	});
});

if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers['push-permission-request'])
  window.iOSPushCapability = true;

window.addEventListener('push-notification', (message) => {
	if (message && message.detail) {
		if (message.detail.link)
			window.location.href = message.detail.link;
	}
});

let serviceWorker = null;

if ("serviceWorker" in navigator){
	navigator.serviceWorker.register(config.site_url+"/service-worker.js", {
		type: 'module'
	}).then((swRegistration) => {
		serviceWorker = swRegistration;

		if(serviceWorker.waiting)
			promptServiceWorkerUpdate(serviceWorker);

		serviceWorker.onupdatefound = () => {
      const installingWorker = serviceWorker.installing;
      if (installingWorker) {
        installingWorker.onstatechange = () => {
          if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // A previous worker is active, so we have an update
						promptServiceWorkerUpdate(serviceWorker);
          }
        };
      }
    };

    navigator.serviceWorker.addEventListener('controllerchange', () => {
	    location.reload();
	  });

		if(config.isLoggedIn && 'Notification' in window){
			getFCMToken(messaging, swRegistration);
		}
	});
}

function enableCommSetting(name){
  G.ajax({
  	url: config.site_url+'/devices',
  	type: 'POST',
  	data: {
  		action: 'save-comm-settings',
  		name: name,
  		value: 'true'
  	}
  }).then(data => {
		if(data.responseText != '1')
      G.snackbar('An error occurred');

  }).catch(xhr => {
		console.log('Failed', xhr);
		G.snackbar('An error occurred.');

	}).finally(() => {
  	button.disabled = false;
		label.querySelector('.spinner').remove();
  });
}

document.body.addEventListener('click', e => {
	if(e.target.closest('#enable-notification')){
		const btn = e.target.closest('#enable-notification');
		btn.disabled = true;
		btn.insertAdjacentHTML('beforeend', '<span class="spinner right-icon"</span>');

		getFCMToken(messaging, serviceWorker).then((token) => {
			if(btn.dataset.comm != undefined){
				if(config.isLoggedIn){
					enableCommSetting(btn.dataset.comm);
				} else {
					G.ajax({
						type: 'POST',
						data: {
							action: 'saveNotifToken',
							token: token
						}
					}).then(data => {}).catch(xhr => {
						console.log('Failed', xhr);
						G.snackbar('An error occurred.');
					});
				}
			}

			window.location.reload();

		}, (err) => {
			G.snackbar(err);
			btn.disabled = false;
			btn.querySelector('.spinner').remove();
		});
	}
});

document.body.addEventListener('change', e => {
	if(e.target.matches('input#enable-notification') && e.target.checked){
    const checkbox = e.target,
      label = checkbox.nextElementSibling,
      form = checkbox.closest('form'),
      button = form.querySelector('button[type=submit]');

    label.insertAdjacentHTML('afterbegin', '<span class="spinner right-icon"></span>');
    button.disabled = true;

    getFCMToken(messaging, serviceWorker).then((token) => {
      // console.log('token returned', token);
      enableCommSetting(checkbox.dataset.name);

    }, (err) => {
      G.snackbar.duration = 8000;
      G.snackbar(err);
      button.disabled = false;
      label.querySelector('.spinner').remove();
      checkbox.checked = false;
    });
  }
});