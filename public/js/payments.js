import { initLinksList } from './functions.mjs';

function initPage(){
	let touchTimeout = null,
		isLongPress = false,
		numItemsSelected = 0,
		amountSelected = 0;
	const linksList = G('.link-list'),
		checkBoxes = document.querySelectorAll('.link-list input[type="checkbox"]'),
		selectionActions = document.getElementById('selection-actions'),
		numItemsEl = document.getElementById('num-items'),
		amountEl = document.getElementById('amount-items');

	G('.tab-controller').tabs();

	linksList.on('click change touchstart touchend', e => {
		if(e.type == 'click'){
			if(e.target.nodeName == 'INPUT' || e.target.nodeName == 'LABEL')
				e.stopImmediatePropagation();

		} else if(e.type == 'change'){
			if(e.target.checked)
				e.target.closest('li').classList.add('selected');
			else
				e.target.closest('li').classList.remove('selected');

			numItemsSelected = amountSelected = 0;
			checkBoxes.forEach(el => {
				if(el.checked){
					numItemsSelected++;
					amountSelected += parseInt(el.dataset.amount);
				}
			});

			if(numItemsSelected > 0){
				numItemsEl.textContent = numItemsSelected;
				amountEl.textContent = amountSelected.toLocaleString();
				selectionActions.classList.add('active');
			} else
				selectionActions.classList.remove('active');

		} if(e.type == 'touchstart'){
			clearTimeout(touchTimeout);
			isLongPress = false;
			touchTimeout = setTimeout(function() {
				isLongPress = true;
				linksList[0].classList.add('active');
			}, 500);
		} else {
			if(isLongPress)
				e.preventDefault();
			clearTimeout(touchTimeout);
		}
	});

	initLinksList();

	G('.btn.approve').on('click', () => {
		G.dialog({
			title: 'Approve payments?',
			description: numItemsSelected+' payments of <strong>₹'+amountSelected.toLocaleString()+'</strong> will be approved upon confirmation',
			confirmingAction: {
				text: 'Confirm',
				onPress: () => {
					checkBoxes.forEach(el => {
						if(el.checked){
							G.ajax({
								url: 'inc/approvals',
								type: 'POST',
								data: {
									entity_type: 'payments',
									entity_id: el.value,
									decision: 'Approve',
									remarks: ''
								}
							}).then().catch();
						}
					});
					G.snackbar('Payments approved');
					locationHandler('refresh');
				}
			},
			dismissiveAction: {
				text: 'Cancel'
			}
		});
	});

	G('.btn.paid').on('click', () => {
		G.dialog({
			title: 'Mark payments paid?',
			description: numItemsSelected+' payments of <strong>₹'+amountSelected.toLocaleString()+'</strong> will be marked as Paid upon confirmation',
			confirmingAction: {
				text: 'Confirm',
				onPress: () => {
					let selectedPayments = [];
					checkBoxes.forEach(el => {
						if(el.checked)
							selectedPayments.push(el.value);
					});
					if(selectedPayments.length){
						G.ajax({
							type: 'POST',
							data: {
								action: 'mark-paid',
								payments: JSON.stringify(selectedPayments)
							}
						}).then(data => {
							handleAjaxResponse(JSON.parse(data.responseText));

						}).catch(xhr => {
							console.log('Failed', xhr);
							G.snackbar('An error occurred.');
						});
					}
				}
			},
			dismissiveAction: {
				text: 'Cancel'
			}
		});
	})

	if(!localStorage.guideSelectableList && window.innerWidth < 1024){
		G.snackbar({
			message: 'Long press an item to enable selection.',
			duration: 0,
			closeButton: true
		});
		localStorage.guideSelectableList = 1;
	}
}

EventBus.subscribe('payments', 'in', initPage);
EventBus.subscribe('payments', 'out', () => {
	G('.tab-controller').tabs('destroy');
});