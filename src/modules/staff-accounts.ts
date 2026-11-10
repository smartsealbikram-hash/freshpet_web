import { Ctx, Page } from '@/lib/ctx';
import { esc } from '@/lib/html';
import { noData } from '@/lib/functions';
import { P, V, halt } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (P(ctx, 'jobs') === 0) halt('You do not have access to this item.');
  const rows = await ctx.db.selectAll('SELECT u.id, u.status, u.name, sr.name as role FROM users u JOIN staff_roles sr ON u.role = sr.id WHERE u.status > 0 AND access_level = 3 ORDER BY role ASC, status DESC');
  let body = '';
  if (rows.length) {
    body = '<div class="input-field"><span class="material-icons left-assist">search</span><input type="search" name="list-search" class="list-search"><label>Search</label></div>';
    let prev = '';
    for (const r of rows) {
      if (r.role !== prev) {
        if (prev) body += '</ul></div></div>';
        body += `<div class="card mb1"><div class="content"><h4>${esc(r.role)}</h4><ul class="list dividers edged link-list">`;
        prev = r.role;
      }
      body += `<li data-url="staff-account?id=${r.id}"${r.status < 2 ? ' class="faded"' : ''}>${esc(r.name)}</li>`;
    }
    body += '</ul></div></div>';
  } else body = noData('Staff Accounts');
  return {
    metaTitle: 'Staff Accounts', pageTitle: 'Staff Accounts', metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>${body}</div></div></div></section>`,
    js: `<script type="module">
	import { initLinksList } from './js/functions.mjs?v=${V}';
	initLinksList();
	const listSearchField = document.querySelector('.list-search');
	if(listSearchField){
		const listItems = document.querySelectorAll('.list > li');
		G(listSearchField).textInput();
		listSearchField.addEventListener('input', e => {
			if(listSearchField.value.length){
				const searchTerm = listSearchField.value.toLowerCase();
				listItems.forEach(el => { if(el.innerHTML.toLowerCase().includes(searchTerm)) el.classList.remove('hide'); else el.classList.add('hide'); })
			} else listItems.forEach(el => el.classList.remove('hide'));
		});
	}
</script>`,
  };
}
