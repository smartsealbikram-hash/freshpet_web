import { initInputs, initAjaxForms, mgmtApproval, processAjaxForm } from './functions.mjs';

function initPage(){
	initInputs();
	initAjaxForms();
	mgmtApproval();

	const form = document.querySelector('form.ajax'),
		statusField = document.querySelector('select[name="status"]'),
		statusRelatedFields = document.querySelectorAll('.status-fields');

	G('input[name="date_sign_offer"]').datepicker({
		startDate: dayjs(),
		endDate: dayjs().add(1, 'week')
	});
	G('.expandable').expandableImg();

	if(statusField){
		statusField.addEventListener('change', e => {
			statusRelatedFields.forEach(div => {
				if(parseInt(e.target.value) >= parseInt(div.dataset.minStatus)){
					div.classList.remove('hide');
					div.querySelectorAll('[data-required]').forEach(el => {
						el.required = true;
					});
				} else {
					div.classList.add('hide');
					div.querySelectorAll('[data-required]').forEach(el => {
						el.required = false;
					});
				}
			});
		});
	}

	document.querySelectorAll('input[type="number"]').forEach(inp => {
		inp.addEventListener('input', e => {
			const basicSalary = parseInt(document.querySelector('input[name="basic_salary"]').value) ?? 0,
				hra = parseInt(document.querySelector('input[name="hra"]').value) || 0,
				ta = parseInt(document.querySelector('input[name="ta"]').value) || 0,
				sa = parseInt(document.querySelector('input[name="sa"]').value) || 0,
				pf = parseInt(document.querySelector('input[name="pf"]').value) || 0,
				esi = parseInt(document.querySelector('input[name="esi"]').value) || 0,
				tds = parseInt(document.querySelector('input[name="tds"]').value) || 0,
				le = parseInt(document.querySelector('input[name="le"]').value) || 0,
				cpf = parseInt(document.querySelector('input[name="cpf"]').value) || 0,
				cesi = parseInt(document.querySelector('input[name="cesi"]').value) || 0,
				gross = basicSalary+hra+ta+sa,
				deductions = pf+esi+tds,
				benefits = le+cpf+cesi;

			document.getElementById('gross-salary').textContent = gross.toLocaleString();
			document.getElementById('total-deductions').textContent = deductions.toLocaleString();
			document.getElementById('annual-ctc').textContent = (gross*12+benefits).toLocaleString();
		});
	});

	G('#create-account').on('click', e => {
		G.dialog({
			title: 'Create Account',
			description: '<form method="post"><input type="text" name="create-account" value="1" hidden><p>Select items given to the employee.</p><div class="input-field mb1"><input type="checkbox" name="belongings[]" id="belongings-phone" value="Phone"><label for="belongings-phone">Phone</label></div><div class="input-field mb1"><input type="checkbox" name="belongings[]" id="belongings-sim" value="SIM Card"><label for="belongings-sim">SIM Card</label></div><div class="input-field mb1"><input type="checkbox" name="belongings[]" id="belongings-keys" value="Keys"><label for="belongings-keys">Keys</label></div></form>',
			confirmingAction: {
				text: 'Create',
				onPress: dl => {
					const dlForm = dl.querySelector('form');
					processAjaxForm(dlForm).then(data => {}).catch(() => {});
				}
			},
			dismissiveAction: {
				text: 'Cancel'
			}
		});
	});

	G('#layoff-employee').on('click', e => {
		G.dialog({
			title: 'Layoff employee?',
			description: '<p>The employee\'s account will be disabled and logged out within 10 minutes.</p><div class="input-field"><input type="text" name="performance"><label>Performance</label><span class="helper">Describe the performance of the employee <strong>in one word</strong></span></div>',
			onLoad: dl => {
				G(dl.querySelector('input')).textInput();
			},
			confirmingAction: {
				text: 'Confirm',
				onPress: dl => {
					const performanceField = dl.querySelector('input');

					G.ajax({
						type: 'POST',
						data: {
							action: 'layoff',
							performance: performanceField.value
						}
					}).then(data => {
						window.location.reload();

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
	});

	G('#cancel-interview').on('click', e => {
		G.dialog({
			title: 'Cancel hiring this candidate?',
			description: '<p>The interview status will be reverted to "Rejected".</p><div class="input-field"><textarea maxlength="500" name="remarks" rows="4"></textarea><label>Remarks</label></div>',
			onLoad: dl => {
				G(dl.querySelector('textarea')).textInput();
			},
			confirmingAction: {
				text: 'Cancel',
				onPress: dl => {
					const remarksField = dl.querySelector('textarea');

					G.ajax({
						type: 'POST',
						data: {
							action: 'cancel-interview',
							remarks: remarksField.value
						}
					}).then(data => {
						window.location.reload();

					}).catch(xhr => {
						console.log('Failed', xhr);
						G.snackbar('An error occurred.');
					});
				}
			},
			dismissiveAction: {
				text: 'Close'
			}
		});
	});
}

EventBus.subscribe('interview', 'in', initPage);