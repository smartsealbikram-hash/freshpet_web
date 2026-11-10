let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  dataLayer.push({event: 'pwa_installed'});
  location.reload();
});

document.body.addEventListener('themetoggle', e => {
	G.ajax({
		url: config.site_url+'/inc/settings',
  	type: 'POST',
  	data: {theme: e.detail.theme}
  });
});

const setupCommonFns = page => {
	G('.btn,.fab').waves();
	G('main img[data-src], .lazy-video').lazyload();
	G('main .tooltip').tooltip();

	if(sessionStorage.pwaMode != 'browser')
		G('a.blank-on-browser[target="_blank"]').each(an => an.removeAttribute('target'));

	if(page){
		const pageTitle = document.querySelectorAll(".page-title");
		if(page.metaTitle == 'Home')
			nav.classList.add("home");
		else
			nav.classList.remove("home");
		pageTitle.forEach(t => {
			if(page.metaTitle=="Home" && t.tagName=="LI")
				t.innerHTML = '<img src="'+config.site_url+'/img/logo/logo2.png">';
			else
				t.textContent = page.metaTitle;
		});
		let subTitle = document.getElementById("page-sub-title");
		if("subTitle" in page){
			if(subTitle)
				subTitle.innerHTML = page.subTitle;
			else {
				subTitle = G('<p id="page-sub-title">'+page.subTitle+"</p>")[0];
				pageTitle[1].parentElement.append(subTitle);
			}
		} else if(subTitle)
			subTitle.remove();
	}
};

G(() => {
	const navDropdown = document.querySelectorAll('nav .dropdown');
	const _navDropDown = G(navDropdown).dropdown({
		coverTrigger: false,
		dropOnHover: true,
		onToggle: (state, trigger, dropdown) => {
			if(state == 'open'){
				for (let i = 0, l = navDropdown.length; i < l; i++) {
					if(navDropdown[i] != dropdown)
						G(navDropdown[i]).dropdown('close');
				}
			}
		}
	});
	_navDropDown.on('click', e => {
		_navDropDown.dropdown('close');
	});

	const faiTriggers = document.querySelectorAll('.start-fai');
	if(faiTriggers.length){
		const faiSheet = G('#fai').sheets({
			type: 'modal',
			openHalfway: false,
			onOpen: function(sheets){
				if(!chatCont.classList.contains('loaded')){
					G.ajax({
						url: config.site_url+'/inc/chat',
						type: 'POST',
						data: {
							action: 'load-chat'
						}
					}).then(data => {
						chatCont.innerHTML = data.responseText;
						chatCont.classList.add('loaded');
						chatCont.parentElement.scrollTop = chatCont.parentElement.scrollHeight;

						faiTriggers.forEach(el => {
							const badge = el.querySelector('.badge');
							if(badge)
								badge.remove();
						});

					}).catch(xhr => {
						console.log('Failed', xhr);
						G.snackbar('An error occurred.');
					});
				}
			}
		});
		const chatCont = document.getElementById('chat-cont');
		G(faiTriggers).on('click', () => {
			faiSheet.sheets('open');
		});
	}

	document.body.addEventListener('click', async e => {
		if(e.target.closest('.back-button'))
			history.back();
		else if(e.target.closest('.install-app')){
			if(deferredPrompt != null){
				deferredPrompt.prompt();
				const { outcome } = await deferredPrompt.userChoice;
				deferredPrompt = null;
			} else {
				const deviceInfo = G.deviceInfo();
				if(deviceInfo.os == 'iOS'){
					if(deviceInfo.browser == 'Safari'){
						G.dialog({
							title: 'Install App',
							description: 'To install [[BusinessName]], tap the <strong>Share</strong> button, scroll down to tap <strong>Add to Home Screen</strong>. Finally tap <strong>Add</strong> to complete.'
						});
					} else {
						G.dialog({
							title: 'Switch to Safari',
							description: 'To install [[BusinessName]], open this site on Safari. On iOS, only Safari browser can install apps.'
						});
					}
				} else if(deviceInfo.browser == 'Firefox' || deviceInfo.browser == 'Safari' || deviceInfo.browser == 'Opera'){
					G.dialog({
						title: 'Installation not supported by browser',
						description: 'Looks like your browser does not support this feature. You can open this site on another browser (we recommend Chrome) and use the install option from the My Account dropdown in the top right.'
					});
				} else {
					G.dialog({
						title: 'Install App',
						description: 'Go to your broswer menu - typically an overflow menu (<span class="material-icons">more_vert</span>), and look for an <strong>Add to Home Screen</strong> or <strong>Install</strong> option. Then follow the onscreen instructions to install the app.'
					});
				}
			}
		} else if(e.target.closest('.send-action')){
			const btn = e.target.closest('.send-action'),
				dialogPayload = {
				title: 'Are you sure?',
				confirmingAction: {
					text: 'Yes',
					onPress: () => {
						const payload = {
							action: btn.dataset.action
						};
						if(btn.dataset.id)
							payload.id = btn.dataset.id;

						G.ajax({
							type: 'POST',
							data: payload
						}).then(data => {
							const response = JSON.parse(data.responseText);
							handleAjaxResponse(response);
						}).catch(xhr => {
							console.log('Failed', xhr);
							G.snackbar('An error occurred.');
						});
					}
				},
				dismissiveAction: {
					text: 'Cancel'
				}
			};
			if(btn.dataset.msg)
				dialogPayload.description = btn.dataset.msg;
			G.dialog(dialogPayload);
		}
	});
});