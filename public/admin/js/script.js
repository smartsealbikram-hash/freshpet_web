let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

document.body.addEventListener('themetoggle', e => {
	G.ajax({
		url: 'inc/settings',
  	type: 'POST',
  	data: {theme: e.detail.theme}
  });
});

function setupCommonFns() {
	G('main .btn, main .fab').waves();

	if(document.getElementById('datatable') || document.getElementById('datatable-ajax')){
		let datatableButtons = [
			{
				display: '<span class="material-icons" style="transform:rotate(90deg)">expand</span>',
				tooltip: 'Toggle Extra-wide Table',
				onClick: (table, tableState) => {
					const cont = table.closest('.container');
					let tableWidth = 'normal';
					if(cont.classList.contains('extended'))
						cont.classList.remove('extended');
					else {
						cont.classList.add('extended');
						tableWidth = 'extended';
					}
					G.ajax({
						url: 'inc/settings',
						type: 'POST',
						data: {
							page: location.pathname,
							tableWidth: tableWidth
						}
					});
				}
			}
		];
		if(typeof additionalDatatableBtns !== 'undefined')
			datatableButtons = additionalDatatableBtns.concat(datatableButtons);

		let datatableOpts = {
			buttons: datatableButtons,
			debug: false,
			onDraw: function(table){
				G(table.querySelectorAll('tbody .table-tooltip')).tooltip();
			}
		};
		if(typeof datatableSelectionActions !== 'undefined'){
			datatableOpts.rowSelection = true;
			datatableOpts.selectionActions = datatableSelectionActions;
		}
		if(document.getElementById('datatable'))
			G(document.getElementById('datatable')).dataTable(datatableOpts);
		else if(document.getElementById('datatable-ajax')){
			datatableOpts.ajax = '';
			G(document.getElementById('datatable-ajax')).dataTable(datatableOpts);
		}

		const urlParams = new URLSearchParams(location.search);
		if (urlParams.has('search')) {
			const quickSearch = document.querySelector('.datatable-wrapper .dt-quick-search');
			quickSearch.value = urlParams.get('search');
			quickSearch.dispatchEvent(new Event('input'));
		}
	}

	G('main .tooltip').tooltip();

	G.ajax({
		url: 'inc/settings',
		type: 'POST',
		data: {
			action: 'load-settings',
			page: location.pathname
		}
	}).then(data => {
		const response = JSON.parse(data.responseText);
		const sidenav = G('#side-nav');
		if(sidenav.length){
			if(response['sidenav'] == 'close')
				sidenav.sidenav('close');
			else if(sidenav[0].classList.contains('fixed') && window.innerWidth >= 1200)
				sidenav.sidenav('open');
		}

		const datatable = document.getElementById('datatable') || document.getElementById('datatable-ajax');
		if(datatable){
			if(response['tableWidth'] == 'extended')
				datatable.closest('.container').classList.add('extended');
			else
				datatable.closest('.container').classList.remove('extended');
		}
	}).catch(xhr => {
		console.log('Failed', xhr);
		G.snackbar('An error occurred.');
	});
}

function sendAction(action, param = null){
	const payload = {
		action: action,
	};
	if(param)
		payload.param = param;

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

function initializeDyno(addButton = null){
	if(!addButton.length)
		return;

	let dynoCounter = 1,
		dynoItems = [];
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
	  	if(e.target.closest('.remove')){
		    e.preventDefault();
		    const deleteButton = e.target.closest('.remove'),
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

    G(newContent.querySelectorAll('.input-field input[type="text"], .input-field input[type="search"], .input-field input[type="email"], .input-field input[type="tel"], .input-field input[type="url"], .input-field input[type="number"], .input-field input[type="password"], .input-field textarea:not(.rich-editor-d)')).textInput();
		G(newContent.querySelectorAll('.input-field select')).selectInput('reload');
		G(newContent.querySelectorAll('.file-input input')).fileInput();
		G(newContent.querySelectorAll('.rich-editor')).richEditor({
			mediaUrl: config.site_url+'/admin/inc/editor-media'
		});
		setTimeout(function() {
			newContent.querySelector('input:not([hidden]), select, textarea').focus();
		}, 100);
  });
}

let sidenavTimeout;
G('#side-nav').sidenav({
	fixed: true,
	onToggle: state => {
		clearTimeout(sidenavTimeout);
		let timeout = (state == 'open') ? 4000 : 4;
		let pageName = location.pathname;
		sidenavTimeout = setTimeout(function() { // time to open nav and move to another page. No need to save state in this case
			if(pageName == location.pathname){
				G.ajax({
					url: 'inc/settings',
					type: 'POST',
					data: {
						page: location.pathname,
						sidenav: state
					}
				});
			}
		}, timeout);
	}
});
G('#side-nav .dropdown').dropdown({
	position: 'none',
	closeOnClickOutside: false,
	onToggle: function(state, trigger, dropdown){
		if(state == 'open'){
			const ul = dropdown.closest('ul'),
				activeDDs = ul.querySelectorAll('.dropdown.active');
			for (var i = 0; i < activeDDs.length; i++) {
				if(activeDDs[i] != dropdown)
					G(activeDDs[i]).dropdown('close');
			}
		}
	}
});

G('.tooltip').tooltip();

document.addEventListener('keydown', e => {
	if(e.altKey && (e.key == 'a' || e.key == 'å')){
		const mainFab = document.querySelector('main > .fab-cont > .fab');
		if(mainFab)
			mainFab.click();
	}
});

document.querySelector('main').addEventListener('click', async e => {
	if(e.target.closest('.delete')){
		const btn = e.target.closest('.delete');

		G.dialog({
			title: 'Confirm delete?',
			description: btn.dataset.msg || null,
			confirmingAction: {
				text: 'Delete',
				onPress: () => {
					G.ajax({
						url: 'inc/delete',
						type: 'POST',
						data: {
							type: btn.dataset.type,
							id: btn.dataset.id
						}
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
		});
	} else if(e.target.closest('.take-action')){
		const btn = e.target.closest('.take-action');

		if(btn.classList.contains('confirm')){
			G.dialog({
				title: 'Are you sure?',
				description: btn.dataset.msg ?? '',
				confirmingAction: {
					text: 'Confirm',
					onPress: () => {
						sendAction(btn.dataset.action, btn.dataset.param);
					}
				},
				dismissiveAction: {
					text: 'Cancel'
				}
			});
		} else
			sendAction(btn.dataset.action, btn.dataset.param);
	}
});

document.body.addEventListener('change', function(e){
	if(e.target.closest('.change-status')){
		const toggle = e.target.closest('.change-status');
		let status = 1;

		if(toggle.checked)
			status= 2;

		G.ajax({
			url: 'inc/status',
			type: "post",
			data: {
				status : status,
				id : toggle.dataset.id,
				type: toggle.dataset.type
			}
		}).then(data => {
			G.snackbar(data.responseText);
		}).catch(xhr => {
			console.log('Failed', xhr);
			G.snackbar('An error occurred.');
		});
	}
});

document.documentElement.addEventListener('mousemove', () => {
	document.body.classList.remove('to-abyss');
	G.debounce(() => {
		document.body.classList.add('to-abyss');
	}, 5*60*1000);
});