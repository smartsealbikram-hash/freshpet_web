export function processAjaxForm(form){
	const action = form.querySelector('.action'),
	submitButtons = form.querySelectorAll('button[type=submit]'),
	textBanner = form.querySelector('.text-banner'),
	spinner = document.createElement('span');

	spinner.classList.add('spinner');
	let activeButton = null,
		progressBar = null;

	if(submitButtons.length){
		for (let i = 0, l = submitButtons.length; i < l; i++) {
			if(submitButtons[i] == document.activeElement || submitButtons[i].contains(document.activeElement))
				activeButton = submitButtons[i];
			submitButtons[i].disabled = true;
		}
		if(activeButton == null)
			activeButton = submitButtons[0];

		activeButton.append(spinner);
	}
	if(textBanner)
		textBanner.remove();
	if(action){
		progressBar = G(action).progress({
			insertType: 'prepend'
		});
	}

	return new Promise((resolve, reject) => {
		const formData = new FormData(form);
		if(activeButton && activeButton.name != '')
			formData.append(activeButton.name, '');

		G.ajax({
			url: form.action,
			type: 'POST',
			data: formData,
			progress: function(percent){
				if(action){
					progressBar[0].dataset.progress = percent;
					progressBar.progress('update');
				}
			}
		}).then(data => {
      // console.log(data.responseText);
			let response = data.responseText;
			if(!response.length)
				response = '{}';
			response = JSON.parse(response);

			if(activeButton){
				const check = document.createElement('span');
				check.classList.add('material-icons', 'right-icon');
				check.textContent = 'check_circle';
				activeButton.append(check);

				setTimeout(function() {
					check.remove();
				}, 2000);
			}

      //reset delete field of dyno items
			form.querySelectorAll('input[name^="deleted"]').forEach(input => {
				input.value = '';
			});

			handleAjaxResponse(response, action);

			if('error' in response || ('message' in response && response.message.type != 'success' && response.message.type != 'snackbar'))
				reject(response);
			else
				resolve(response);

		}).catch(xhr => {
			console.log(xhr);
			if(action)
				progressBar[0].remove();
			spinner.remove();
			for (let i = 0, l = submitButtons.length; i < l; i++) {
				submitButtons[i].disabled = false;
			}

			G.dialog({
				title: 'Could not save details',
				description: 'An unexpected error occurred',
				dismissiveAction: {
					text: 'Close'
				}
			});
			reject(xhr);

		}).finally(() => {
			if(action)
				progressBar[0].remove();
			spinner.remove();
			for (let i = 0, l = submitButtons.length; i < l; i++) {
				submitButtons[i].disabled = false;
			}
		});
	});
}

export function initInputs(parent = document.querySelector('main')){
	G(parent.querySelectorAll('.input-field input[type="text"], .input-field input[type="search"], .input-field input[type="email"], .input-field input[type="tel"], .input-field input[type="url"], .input-field input[type="number"], .input-field input[type="password"], .input-field textarea')).textInput();
	G(parent.querySelectorAll('.input-field select')).selectInput();
	G(parent.querySelectorAll('.input-field input[type="checkbox"], .input-field input[type="radio"]')).toggleInput();
	G(parent.querySelectorAll('.file-input input[type="file"]')).fileInput();
	G(parent.querySelectorAll('.datepicker')).datepicker();
	const richEditors = parent.querySelectorAll('.rich-editor');
	if(richEditors.length){
		G(richEditors).richEditor({
			mediaUrl: config.site_url+'/admin/inc/editor-media'
		});
	}
}

export function initAjaxForms(selector = 'form.ajax'){
	G(selector).on('submit', function(e){
		e.preventDefault();
		const form = this;

		if(form.classList.contains('confirm')){
			let desc = '';
			if(form.hasAttribute('data-msg'))
				desc = form.dataset.msg;

			G.dialog({
				title: 'Confirm your changes',
				description: desc,
				confirmingAction: {
					text: 'Proceed',
					onPress: function(){
						processAjaxForm(form).catch(() => {});
					}
				},
				dismissiveAction: {
					text: 'Take Another Look'
				}
			});
		} else
			processAjaxForm(form).catch(() => {});
	});
}

export function initContentSlider(){
	document.querySelectorAll('.content-slider').forEach(el => {
		G(el).slider({
			slideWidth: JSON.parse(el.dataset.width),
			slideGap: '1rem',
			controlsPosition: 'neighbors',
			center: false,
			loop: false,
			snap: false,
			auto: false
		});
	});
}

export function initLinksList(){
	G('.link-list li').waves();
	G('.link-list').on('click', e => {
		const li = e.target.closest('li');
		if(li && li.dataset.url != undefined)
			locationHandler(li.dataset.url);
	});
}

let sheet = null,
	sheetTitle = null,
	sheetBody = null;
export function setupSheet(title, width = 'normal'){
	if(!sheet){
		sheet = G('<div class="sheets" id="page-sheet"><div class="head"><span class="title"></span></div><div class="body"></div></div>');
		sheetTitle = sheet[0].querySelector('.title');
		sheetBody = sheet[0].querySelector('.body');
		document.body.appendChild(sheet[0]);

		sheet.sheets({
			type: 'modal'
		});
	}
	if(width != 'normal')
		sheet[0].classList.add(width);
	else
		sheet[0].classList.remove('wide', 'extra-wide');

	sheetTitle.textContent = title;
	sheetBody.innerHTML = '';
	G(sheetBody).progress({
		type: 'circular',
		insertType: 'prepend',
		center: true
	});
	setTimeout(function() {
		sheet.sheets('open');
	}, 100);

	return {
		sheet: sheet,
		title: sheetTitle,
		body: sheetBody
	}
}

export function initSearchAutocomplete(cont = document){
	let searchInputs = cont.querySelectorAll('.autocomplete');
  G(searchInputs).on('input', G.throttle(e => {
  	const input = e.target,
  		inputCont = input.closest('.input-field'),
  		searchResults = inputCont.querySelector('.search-results'),
			searchResultsDD = searchResults.parentElement;

  	if(input.value.length > 1){
	  	G.ajax({
	  		type: 'POST',
	  		data: {
	  			action: 'autocomplete',
	  			name: input.name,
	  			search: input.value
	  		}
	  	}).then(data => {
  			if(data.responseText.length) {
					searchResults.innerHTML = data.responseText;
					searchResultsDD.classList.add('active');
					searchResultsDD.style.display = 'block';

				} else {
					searchResultsDD.classList.remove('active');
					searchResultsDD.style.display = 'none';
					inputCont.querySelector('input[hidden]').value = '';
				}
			}).catch(err => {
				searchResults.innerHTML = '<li class="error-color"><span class="material-icons">error</span> An error occurred</li>';
			});
		} else {
			searchResultsDD.classList.remove('active');
			searchResultsDD.style.display = 'none';
			searchResults.innerHTML = '';
		}
  }, 1000));

  G(cont.querySelectorAll('.search-results.fill')).on('click', function(e){
  	const inputCont = this.closest('.input-field'),
  		input = inputCont.querySelector('input[type="search"]'),
  		hiddenInput = inputCont.querySelector('input[hidden]');

  	if(hiddenInput){
  		hiddenInput.value = e.target.dataset.id;
  		hiddenInput.dispatchEvent(new Event('input'));
  	}
  	input.value = e.target.textContent;
  	this.innerHTML = '';
  	this.parentElement.style.display = 'none';
  	input.focus();
  });

  document.addEventListener('click', e => {
  	searchInputs.forEach(inp => {
  		if(inp.classList.contains('active') && !inp.contains(e.target)){
  			inp.querySelector('input').value = '';
  			inp.querySelector('.dropdown').style.display = 'none';
  		}
  	});
  });
}

export function checkGuide(name){
	return new Promise((resolve, reject) => {
		if(localStorage[name])
			resolve();

		G.ajax({
			url: config.site_url+'/inc/guides',
			type: 'POST',
			data: {
				action: 'check',
				guide: name
			}
		}).then(data => {
			if(data.responseText == 1){
				localStorage[name] = 1;
				resolve();
			} else
				reject();
		});
	});
}
export function seenGuide(name){
	G.ajax({
		url: config.site_url+'/inc/guides',
		type: 'POST',
		data: {
			action: 'seen',
			guide: name
		}
	}).then(data => {
		localStorage[name] = 1;
	});
}
export function handleGuide(selector = '#seen-guide'){
	G(selector).on('click', e => {
		const btn = e.target.closest('#seen-guide'),
			guide = btn.dataset.guide;

		btn.closest('.card').remove();

		seenGuide(guide);
	});
}

export function nextInputDepends(e){
	const dependent = e.target.closest('.next-input-depends').nextElementSibling;

	if(e.target.checked || e.target.value == 1){
		let displayClass = 'block';
		if(e.target.dataset.display)
			displayClass = e.target.dataset.display;

		G(dependent).slideDown(300, displayClass);
		dependent.querySelectorAll('input[data-required="true"], select[data-required="true"]').forEach(input => {
			input.required = true;
		});
	} else {
		G(dependent).slideUp(300);
		dependent.querySelectorAll('input[data-required="true"], select[data-required="true"]').forEach(input => {
			input.required = false;
		});
	}
}

export function codeScanner(form, createList, processScannedItem){
	const scanModule = form.querySelector('#scan-module'),
		input = form.querySelector('#scanner-input'),
		scannedList = scanModule.querySelector('.list'),
		listInput = form.querySelector('input[name="scanned_items"]'),
		deletedInput = form.querySelector('input[name="deleted_items"]');
	let list = [],
		banner = scanModule.querySelector('.text-banner'),
		errorCont = banner,
		errorSuffix = '',
		inputTimeout = null;
	if(!banner){
		banner = input.nextElementSibling;
		errorCont = input.parentElement.querySelector('.helper');
		errorSuffix = '-color';
	}
	const bannerInitialMsg = banner.textContent;

	input.addEventListener('focus', e => {
		banner.textContent = 'Listening...';
	});
	banner.parentElement.addEventListener('click', () => input.focus());

	if(listInput && listInput.value.length){
		try {
			list = JSON.parse(listInput.value);
			createList(listInput, list);
		} catch(e){
			console.log(e.message);
		}
	}
	input.focus();

	// listen for input from scanner
	input.addEventListener('keydown', async e => {
		if(e.key == 'Enter'){
			e.preventDefault();

			try {
				const scannedItem = await processScannedItem(input.value, list);
				list.push(scannedItem);

				input.value = '';
				errorCont.textContent = 'Added';
				errorCont.classList.add('success'+errorSuffix);
				createList(listInput, list);
				navigator.vibrate(200);

			} catch (e){
				errorCont.innerHTML = e.message;
				errorCont.classList.add('error'+errorSuffix);
				navigator.vibrate([300, 100, 300, 100]);
			}

			clearTimeout(inputTimeout);
			inputTimeout = setTimeout(function() {
				if(document.activeElement == input)
					banner.textContent = 'Listening...';
				else
					banner.textContent = bannerInitialMsg;
				banner.classList.remove('success'+errorSuffix, 'error'+errorSuffix);
				if(errorSuffix.length)
					errorCont.textContent = '';
				input.value = '';
			}, 2000);
		} else {
			banner.textContent = 'Receiving input...';
			clearTimeout(inputTimeout);
			inputTimeout = setTimeout(function() {
				banner.textContent = 'Listening...';
			}, 1000);
		}
	});

	input.addEventListener('blur', e => {
		banner.textContent = bannerInitialMsg;
	});

	scannedList.addEventListener('click', e => {
		if(e.target.closest('button')){
			const li = e.target.closest('li'),
				code = li.querySelector('.content').textContent,
				listIndex = list.findIndex(item => item.code == code);

			if(typeof listIndex !== 'undefined'){
				if('id' in list[listIndex])
					deletedInput.value += list[listIndex].id+',';
				list.splice(listIndex, 1);
			}
			li.remove();
			createList(listInput, list);
		}
	});
}

let dynoCounter = 1,
dynoItems = [];
export function initializeDyno(addButton){
	if(!addButton.length)
		return;

  addButton.each(function(){
    this.dataset.counter = dynoCounter;

    const eatMe = this.previousElementSibling.querySelector('.eat-me'),
    	selectsInEatMe = eatMe.querySelectorAll('select');
    G(selectsInEatMe).selectInput('destroy');
    [...selectsInEatMe].forEach(el => el.removeAttribute('id'));
    eatMe.classList.remove('eat-me');
    const	template = eatMe.outerHTML;
    eatMe.remove();

    this.previousElementSibling.addEventListener('click', function(e){
	  	if(e.target.closest('.delete') || e.target.closest('.remove')){
		    e.preventDefault();
		    let deleteButton = e.target.closest('.delete') || e.target.closest('.remove'),
		    	id = deleteButton.dataset.itemid;

		    if(id){
		      const deletedItemsField = this.querySelector('input[name^="deleted"]'),
		      deletedItems = deletedItemsField.value;
		      deletedItemsField.value = deletedItems+id+',';
		    }
		    deleteButton.closest('li').remove();
		  }
	  });

    dynoItems[dynoCounter] = template;
    dynoCounter++;
  });

  addButton.on('click', function(e){
    e.preventDefault();
    const thisCount = this.dataset.counter;
    let existingItems = this.previousElementSibling.querySelector(':scope > li:last-child');

    // console.log(thisCount);
    const newContent = G(dynoItems[thisCount])[0];
    newContent.querySelectorAll('input[type="checkbox"],input[type="radio"]').forEach(input => {
    	const label = input.nextElementSibling;
    	let	id = input.id;
    	if(!id)
    		id = input.name+input.value;
    	const	newId = id+Math.round(Math.random()*1000);

    	input.id = newId;
    	label.setAttribute('for', newId);
    });
    this.previousElementSibling.append(newContent);

    if(existingItems && location.href.includes('dispatch')){
    	existingItems.querySelectorAll('input, select').forEach(el => {
    		if(el.name.length)
	    		newContent.querySelector('[name="'+el.name+'"]').value = el.value;
    	});
    }

    G(newContent.querySelectorAll('.input-field input, .inputf-field textarea:not(.rich-editor-d)')).textInput();
    G(newContent.querySelectorAll('.file-input input')).fileInput();
    G(newContent.querySelectorAll('.input-field select')).selectInput('reload');
    G(newContent.querySelectorAll('.datepicker')).datepicker();
    G(newContent.querySelectorAll('.datepicker-future')).datepicker({
    	startDate: dayjs()
    });
    if(newContent.querySelector( '.rich-editor-d' )){
	    ClassicEditor.create( newContent.querySelector( '.rich-editor-d' ), richEditorsOpts).then( editor => {
			}).catch( error => {
				console.error( error );
			});
		}
		stepperInput(newContent);
		setTimeout(function() {
	  	newContent.querySelector('input:not([hidden]), select, textarea').focus();
	  }, 100);
  });
}

export function stepperInput(cont = document){
	G(cont.querySelectorAll('.stepper-input .btn')).on('click', e => {
		const btn = e.target.closest('.btn'),
			input = btn.parentElement.querySelector('input');
		let value = parseInt(input.value);

		if(btn.classList.contains('more'))
			input.stepUp();
		else
			input.stepDown();
	});
}

export function locationSwitcher() {
	const input = document.querySelector('#locations select');
	if(!input)
		return;

	if(!input.gsInitialized)
		G(input).selectInput();
	input.addEventListener('change', e => {
		G.ajax({
			type: 'POST',
			url: config.site_url+'/inc/settings',
			data: {
				changeLocation: e.target.value
			}
		}).then(data => {
			locationHandler('refresh');

		}).catch(xhr => {
			console.log('Failed', xhr);
			G.snackbar('An error occurred.');
		});
	});
}

export function mgmtApproval(){
	G('.mgmt-decision').on('click', e => {
		const btn = e.target.closest('.mgmt-decision');
		G.dialog({
			title: 'Confirm your action',
			description: '<form method="post" action="inc/approvals"><input type="text" name="entity_type" value="'+btn.dataset.entityType+'" hidden><input type="number" name="entity_id" value="'+btn.dataset.entityId+'" hidden><input type="text" name="decision" value="'+btn.dataset.decision+'" hidden><div class="input-field"><textarea name="remarks" maxlength="500" rows="4"></textarea><label>Remarks</label></div></form>',
			onLoad: function(d){
				G(d.querySelector('.input-field textarea')).textInput();
			},
			confirmingAction: {
				text: btn.dataset.decision,
				onPress: function(d){
					const form = d.querySelector('form');
					processAjaxForm(form).then(() => {});
				}
			},
			dismissiveAction: {
				text: 'Cancel'
			}
		});
	});
}