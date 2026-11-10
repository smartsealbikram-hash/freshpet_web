import {codeScanner} from './functions.mjs';
const form = document.getElementById('materials-form'),
	scannedList = document.querySelector('#scan-module .list'),
	scanSummary = document.getElementById('scanned-total');

function createList(listInput, list){
	scannedList.innerHTML = '';
	scanSummary.querySelector('span').textContent = list.length+'/'+scanSummary.dataset.requested;
	scanSummary.classList.remove('hide');
	list.forEach(item => {
		scannedList.insertAdjacentHTML('beforeend', '<li><div class="content">'+item.code+'</div><div class="right-assist"><button type="button" class="btn icon"><span class="material-icons">delete</span></button></div></li>');
	});
	listInput.value = JSON.stringify(list);
}

function processScannedItems(input, list){
	const scannedParts = input.split(' ');
	if(scannedParts.length == 1){
		const search = list.find(item => item.code == scannedParts[0]);
		if(search)
			throw new Error('Bag has already been added.');

		return {
			'code': scannedParts[0],
			'scanned_text': input
		}
	} else {
		let resin = scannedParts[2],
			bagIdIndex = 3;
		if(scannedParts[bagIdIndex].length == 1){
			resin += scannedParts[bagIdIndex];
			bagIdIndex++;
		}
		let bagId = scannedParts[bagIdIndex].slice(0, 10),
			bagWeight = scannedParts[bagIdIndex].slice(10);

		const search = list.find(item => item.code == bagId);
		if(search)
			throw new Error('Bag has already been added.');

		return {
			'code': bagId,
			'bag_no': scannedParts[0],
			'resin': resin,
			'bag_weight': bagWeight,
			'scanned_text': input
		}
	}
}

codeScanner(form, createList, processScannedItems);