import { Ctx, Page, exit } from '@/lib/ctx';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { sanitize, sentenceCase, toInt } from '@/lib/functions';
import { text } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  S.current_page = 'devices';
  const user = S.user.id;

  if (post.action) {
    if (post.action === 'save') {
      try {
        const device: any = await ctx.account.getCurrentDevice();
        if (device.tag != post.tag) await db.update('user_devices', { tag: sanitize(post.tag) }, 'id = ?', [device.id]);
        text(1);
      } catch (e: any) { if (e?.result) throw e; text(0); }
    } else if (post.action === 'remove-device') {
      try { await db.delete('user_devices', 'id = ? AND user = ?', [toInt(post.id), user]); text(1); } catch (e: any) { if (e?.result) throw e; text(0); }
    } else if (post.action === 'save-comm-settings') {
      const comm = String(post.name).split('_');
      const commId = toInt(comm[2]);
      const col = comm[1] === 'email' ? 'email_enabled' : comm[1] === 'sms' ? 'sms_enabled' : 'push_enabled';
      try {
        const cs: any = await db.selectOne('SELECT id FROM comm_settings WHERE user = ? AND comm = ?', [user, commId]);
        if (cs) await db.update('comm_settings', { [col]: post.value === 'true' ? 1 : 0 }, 'id = ?', [cs.id]);
        else if (post.value === 'true') await db.insert('comm_settings', { user, comm: commId, [col]: 1 });
        else text(1);
        text(1);
      } catch (e: any) { if (e?.result) throw e; text(0); }
    }
    return exit(new Response(''));
  }

  const current: any = await ctx.account.getCurrentDevice();
  const rows = await db.selectAll(
    "SELECT t.*, email_enabled, sms_enabled, push_enabled FROM comm_types t LEFT JOIN comm_settings s ON s.user = ? AND t.id = s.comm WHERE category != 'Admin' ORDER BY category, name", [user]);
  const byCat: Record<string, any[]> = {};
  for (const r of rows) (byCat[r.category] ??= []).push(r);
  let commRows = '';
  for (const [cat, list] of Object.entries(byCat)) {
    if (cat) commRows += `<tr><td colspan="4">${esc(cat)}</td></tr>`;
    for (const v of list) {
      commRows += `<tr>
				<td style="min-width:12rem">${esc(sentenceCase(v.name))}<br><small class="neutral-color-4">${esc(v.description)}</small></td>
				<td><div class="input-field no-margin"><input type="checkbox" name="comm_push_${v.id}" id="comm${v.id}_push" class="comm-settings-toggle"${v.push_enabled ? ' checked' : ''}><label for="comm${v.id}_push">&nbsp;</label></td>
			</tr>`;
    }
  }
  const devices = await db.selectAll('SELECT * FROM user_devices WHERE user = ?', [user]);

  return {
    metaTitle: 'Devices & Notifications',
    pageTitle: 'Devices',
    metaDescription: '',
    content: `<section>
	<div class="container">
		<div class="row">
			<div class="col xs12 m8">
				${current.tag === null
          ? `<div class="row"><div class="col xs8"><h2 class="section-title">Notifications</h2><p class="neutral-color-3 mtn1">Notifications are not enabled on this device.</p></div><div class="col xs4 text-right"><button type="button" class="btn outline small mt1" id="enable-notification">Enable</button></div></div>`
          : '<h2 class="section-title">Notifications</h2>'}
				<hr>
				<div class="responsive-table"><table><thead><th style="min-width:12rem">Type</th><th>Push Notif.</th></thead><tbody>${commRows}</tbody></table></div>
			</div>
			<div class="col xs12 m8 mt2">
				<h2 class="text-uppercase">My Devices</h2>
				<div class="card"><div class="content"><ul class="list two-line right-assist">
					${devices.map((r: any) => `<li><div class="content">${esc(r.description)}<br><small>Added ${date('d M Y h:i A', strtotime(r.date_added) as number)}</small></div><div class="right-assist"><button type="button" class="btn outline small right-assist red remove-device" data-id="${r.id}">Remove</button></div></li>`).join('')}
				</ul></div></div>
			</div>
		</div>
	</div>
</section>`,
    js: `<script>
	const urlParams = new URLSearchParams(window.location.search);
	const highlighComm = urlParams.get('highlight');
	if(highlighComm != null){
		const tr = document.querySelector('[id^="comm'+highlighComm+'"]').closest('tr');
		tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
		tr.animate([{ background: 'transparent' },{ background: 'var(--primary-container)' },{ background: 'transparent' },{ background: 'var(--primary-container)' },{ background: 'transparent' }], { duration: 2000 });
	}
	G('.remove-device').on('click', function(){
		const btn = this, id = this.dataset.id;
		G.dialog({
			title: 'Remove Device?',
			description: 'You will no longer receive notifications on this device',
			confirmingAction: { text: 'Remove', onPress: function(){
				G.ajax({ type: 'POST', data: { action: 'remove-device', id: id } }).then(data => {
					if(data.responseText == '1'){ sessionStorage.removeItem('fcmToken'); btn.closest('li').remove(); }
					else G.snackbar('An error occurred');
				}).catch(xhr => { console.log('Failed', xhr); G.snackbar('An error occurred.'); });
			}},
			dismissiveAction: { text: 'Cancel' }
		});
	});
	G('.comm-settings-toggle').on('change', function(){
		const switcher = this, row = switcher.closest('tr');
		if(row.classList.contains('necessary')){
			let oneChecked = false;
			row.querySelectorAll('input[type="checkbox"]').forEach(inp => { if(inp.checked) oneChecked = true; });
			if(!oneChecked){ G(switcher.parentElement).shake(); switcher.checked = true; G.snackbar('You must keep at least one mode of communication open for this type'); return false; }
		}
		G.ajax({ type: 'POST', data: { action: 'save-comm-settings', name: switcher.name, value: switcher.checked }, success: function(data){
			if(data == '1') G.snackbar('Saved'); else G.snackbar('An error occurred. Could not save.');
		}});
	});
</script>`,
  };
}
