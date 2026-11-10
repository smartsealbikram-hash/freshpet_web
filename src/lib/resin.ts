/** Shared scanner client script used by load-resin / return-resin (identical in the PHP originals). */
export const resinScanJs = (V: string, extraImports = '') => `
	import { setupSheet, initInputs, initAjaxForms, codeScanner${extraImports}} from './js/functions.mjs?v=${V}';
	const form = document.getElementById('resin-form'), scannedList = document.querySelector('#scan-module .list'), scanSummary = document.getElementById('scanned-total');
	function createList(listInput, list){
		scannedList.innerHTML = '';
		scanSummary.classList.remove('hide');
		list.forEach(item => { scannedList.insertAdjacentHTML('beforeend', '<li><div class="content">'+item.code+'</div><div class="right-assist"><button type="button" class="btn icon"><span class="material-icons">delete</span></button></div></li>'); });
		listInput.value = JSON.stringify(list);
	}
	function processScannedItems(input, list){
		const scannedParts = input.split(' ');
		let code = scannedParts[0];
		return G.ajax({ type: 'POST', data: { verify: code } }).then(data => {
			const response = JSON.parse(data.responseText);
			if(response.success) return { code: code }
			else throw new Error(response.message);
		});
	}`;

export const scanForm = `<form id="resin-form" method="post" class="ajax"><input type="text" name="scanned_items" hidden>
	<div id="scan-module" class="mt2"><div class="center relative"><span class="material-icons giant">barcode_scanner</span><p class="neutral-color-3">Scan bags to load in this machine</p>
	<div class="input-field"><input type="text" id="scanner-input" autocomplete="off"><label>Not listening. Tap to start scanning or typing</label><span class="helper"></span></div></div>
	<h4 class="success-color mb0 hide" id="scanned-total">Scanned Bags</h4><ul class="list right-assist compact mb2"></ul></div>
	<div class="fab-cont center"><button type="submit" class="fab extended"><span class="material-icons">save</span> Save</button></div></form>`;
