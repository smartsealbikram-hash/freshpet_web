import { processAjaxForm, initializeDyno } from './functions.mjs';

function initPage(){
	const nav = document.querySelector('nav.navigation'),
		timelineCont = document.getElementById('timeline-cont'),
		cancelBtn = document.getElementById('cancel-dispatch'),
		sheets = G('.sheets').sheets({
			type: 'modal'
		});

	loadTimeline();

	document.querySelector('section').addEventListener('click', e => {
		if(e.target.closest('.checkpoint-done')){
			const btn = e.target.closest('.checkpoint-done');
			let signaturePad = null;

			let dialogOpts = {
				title: 'Mark as Done?',
				description: '<p>Confirm if you would like to mark this checkpoint as complete.</p><form method="post"><input name="action2" value="timeline-advance" hidden><input name="checkpoint" value="'+btn.dataset.checkpoint+'" hidden><button type="submit" class="hide"></button>',
				confirmingAction: {
					text: 'Mark Done',
					onPress: (dl) => {
						const form = dl.querySelector('form');
						if(form.checkValidity()){
							const signInput = dl.querySelector('input[name="signature"]');
							if(signInput){
								if(signaturePad.isEmpty()){
									if(signInput.value.length == 0){
										const signLabel = dl.querySelector('#sign-label');
										signLabel.classList.add('error-color');
										signLabel.textContent = 'Draw your Signature';
										G(signLabel).shake();
										return false;
									}
								} else
									signInput.value = signaturePad.toDataURL();
							}
							form.requestSubmit();
						} else
							return false;
					}
				},
				dismissiveAction: {
					text: 'Cancel'
				},
				onLoad: (dl) => {
					G(dl.querySelectorAll('.input-field input')).textInput();
					G(dl.querySelectorAll('.input-field .datepicker')).datepicker();
					dl.querySelector('form').addEventListener('submit', e => {
						e.preventDefault();
						processAjaxForm(e.target).then(data => {
							loadTimeline();
						});
					});

					if(dl.querySelector('.dyno-content')){
						const addDyno = dl.querySelector('.add-dyno');
						initializeDyno(G(addDyno));
						addDyno.click();
					}

					const signatureCanvas = dl.querySelector('#signature');
					if(signatureCanvas){
						signaturePad = new SignaturePad(signatureCanvas, {
							penColor: '#0d37ae'
						});

						dl.querySelector('#clear-sign').addEventListener('click', () => {
							const img = dl.querySelector('#sign-image');
							if(img)
								img.remove();
							else
								signaturePad.clear();
						});
					}
				}
			}

			G.ajax({
				type: 'POST',
				data: {
					action: 'additional-info',
					checkpoint: btn.dataset.checkpoint
				}
			}).then(data => {
				if(data.responseText.length){
					dialogOpts.description += data.responseText;
				}
			}).catch(xhr => {
				console.log('Failed', xhr);
				G.snackbar('An error occurred.');
			}).finally(() => {
				dialogOpts.description += '</form>';
				G.dialog(dialogOpts);
			});
		}
	});

	if(cancelBtn){
		cancelBtn.addEventListener('click', e => {
			G.dialog({
				title: 'Cancel Dispatch?',
				description: 'Press Cancel to cancel this dispatch?',
				confirmingAction: {
					text: 'Cancel',
					onPress: () => {
						G.ajax({
							type: 'POST',
							data: {
								action: 'cancel-dispatch'
							}
						}).then(data => {
							// console.log(data.responseText);
							const response = JSON.parse(data.responseText);
							handleAjaxResponse(response);

						}).catch(xhr => {
							console.log('Failed', xhr);
							G.snackbar('An error occurred.');
						});
					}
				},
				dismissiveAction: {
					text: 'Nevermind'
				}
			});
		});
	}

	function loadTimeline(){
		const progress = G(nav).progress();

		G.ajax({
			type: 'POST',
			data: {
				action: 'load-timeline'
			}
		}).then(data => {
			// console.log(data.responseText);
			timelineCont.innerHTML = data.responseText;

		}).catch(xhr => {
			console.log('Failed', xhr);
			G.snackbar('An error occurred.');

		}).finally(() => {
			progress[0].remove();
		});
	}
}

EventBus.subscribe('/dispatch', 'in', initPage);