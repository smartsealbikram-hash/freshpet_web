import { Ctx, Page } from './ctx';
import { env } from './env';
import { esc } from './html';
import { hasAccess, insertPageContents } from './functions';
import { str } from './html';

const V = env.VERSION;

function themeLinks(ctx: Ctx, extraCss: string) {
  const apple = ctx.settings.allow_ios_theme && (ctx.device.os === 'Mac OS' || ctx.device.os === 'iOS') ? '-apple' : '';
  const dark = ctx.S.theme === 'dark' ? '-dark' : '';
  const user = ctx.S.themeDefault ? '' : ' user-defined';
  return `<link rel="stylesheet" type="text/css" href="${env.SITE_URL}/css/glowingstone-one${apple}${dark}.min.css?v=${V}" class="theme-css${user}" data-theme="${esc(ctx.S.theme)}">
	<link rel="stylesheet" href="${env.SITE_URL}/css/glowingstone-two${apple}${dark}.min.css?v=${V}" class="theme-css${user}" data-theme="${esc(ctx.S.theme)}" media="none" onload="if(media!='all')media='all'">
	<link rel="stylesheet" type="text/css" href="${env.SITE_URL}${extraCss}?v=${V}">`;
}

/** Full document for the staff app (port of index.php). */
export async function renderAppShell(ctx: Ctx, page: Page): Promise<string> {
  const { db, S, settings } = ctx;
  const title = page.pageTitle ?? page.metaTitle ?? '';
  let body = '';

  if (ctx.isLoggedIn) {
    const logo = S.theme === 'light' ? settings.logo_light : settings.logo_dark;
    let unread = 0;
    if (S.user.department == 10 || S.user.id == 11 || S.user.id == 22) {
      const r: any = await db.selectOne('SELECT COUNT(cm.id) as total FROM chat_messages cm JOIN chats c ON cm.chat = c.id WHERE user_1 = 0 AND user_2 = ? AND is_read = 0', [ctx.userId]);
      unread = Number(r?.total ?? 0);
    }
    const isFai = S.user.department == 10;
    const depts = await db.selectAll('SELECT id, icon, name FROM departments WHERE status = 2 ORDER BY name');
    let numNav = 2;
    if (S.user.id == 11 || S.user.id == 22) numNav--;
    S.user.settings ??= {};
    if (!S.user.settings.most_visited_depts) {
      S.user.settings.most_visited_depts = {};
      for (let i = 0; i < numNav && i < depts.length; i++) S.user.settings.most_visited_depts[depts[i].id] = 1;
    }
    const visited = Object.entries(S.user.settings.most_visited_depts as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([k]) => Number(k));
    let deptNav = '';
    for (let i = 0; i < numNav; i++) {
      const d = depts.find((x: any) => x.id === visited[i]);
      if (d) deptNav += `<li><a href="${env.SITE_URL}/department?d=${d.id}"><span class="material-icons">${esc(d.icon)}</span><span class="label">${esc(d.name)}</span></a></li>`;
    }
    body += `<header>
		<nav class="navigation fixed top ${title === 'Home' ? 'home' : ''}">
		  <div class="container">
		    <ul class="desktop-nav">
		      <li class="logo left"><a href="#"><img src="img/logo/${esc(logo)}"></a></li>
		      <li><a href="${env.SITE_URL}/home" class="waves"><span class="icon material-icons">home</span> Home</a></li>
		      <li>
		        <a href="#" class="nav-dropdown-trigger"><span class="material-icons">account_circle</span> Account</a>
		        <div class="dropdown" data-trigger=".nav-dropdown-trigger">
		          <ul>
		            <li><a href="#"><strong>${esc(S.user.name)}</strong></a></li>
		            <li class="show-on-browser"><a class="install-app" href="#"><span class="material-icons">file_download</span> Install App</a></li>
		            <li><a href="devices"><span class="material-icons">devices</span> Devices</a></li>
		            <li><a href="login?logout=1"><span class="material-icons">exit_to_app</span> Logout</a></li>
		          </ul>
		        </div>
		      </li>
		      ${isFai ? `<li><a href="#" class="start-fai relative"><span class="material-icons">robot_2</span><span class="label">FAI</span>${unread ? `<span class="badge">${unread}</span>` : ''}</a></li>` : ''}
		    </ul>
		  </div>
		  <ul class="mobile-nav">
		    <li><a href="${page.backUrl ? esc(page.backUrl) : '#'}" class="btn icon back-button"><span class="material-icons">arrow_back</span></a></li>
		    <li class="emblem"><img src="${env.SITE_URL}/img/logo/favicon-192-mask.png"></li>
		    <li class="page-title truncate">${esc(title)}</li>
		  </ul>
		</nav>
		<div class="container">
			<h1 class="page-title">${esc(title)}</h1>
			${page.subTitle ? `<p id="page-sub-title">${page.subTitle}</p>` : ''}
		</div>
	</header>
	<nav class="bottom-nav">
		<ul>
			<li><a href="${env.SITE_URL}"><span class="material-icons">home</span><span class="label">Home</span></a></li>
			${deptNav}
			<li><a href="${env.SITE_URL}/account-nav"><span class="material-icons">account_circle</span><span class="label">My Account</span></a></li>
			${S.user.id == 11 || S.user.id == 22 ? `<li><a href="#" class="start-fai"><span class="material-icons">robot_2</span><span class="label">FAI</span>${unread ? `<span class="badge">${unread}</span>` : ''}</a></li>` : ''}
		</ul>
	</nav>`;
  }

  const fai = ctx.isLoggedIn && S.user.department == 10
    ? `<div class="sheets wide" id="fai"><div class="head"><span class="material-icons">robot_2</span> FAI</div><div class="body no-padding"><ul id="chat-cont"></ul></div></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<title>${esc(page.metaTitle ?? '')}</title>
  <meta name="description" content="${esc(page.metaDescription ?? '')}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="manifest" href="${env.SITE_URL}/manifest.webmanifest">
	<meta name="theme-color" media="(prefers-color-scheme: light)" content="#89c8ed">
	<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#d3e0e7">
	${themeLinks(ctx, '/css/style.css')}
	<link rel="icon" href="${env.SITE_URL}/img/logo/favicon-32.png" sizes="any">
	<link rel="apple-touch-icon" href="${env.SITE_URL}/img/logo/favicon-180.png">
	${insertPageContents(page, 'css')}
	${settings.before_closing_head ?? ''}
</head>
<body>
	${body}
	<main>${str(page.content ?? '')}</main>
${fai}
<script type="text/javascript">
	const config = {
		site_name: ${JSON.stringify(env.SITE_NAME)},
		site_url: ${JSON.stringify(env.SITE_URL)},
		logo: ${JSON.stringify(`${env.SITE_URL}/img/logo/${settings.logo_light ?? ''}`)},
		isLoggedIn: ${ctx.isLoggedIn ? 'true' : 'false'},
	}
</script>
<script src="${env.SITE_URL}/js/dayjs.min.js?v=${V}"></script>
<script src="${env.SITE_URL}/js/glowingstone.min.js?v=${V}"></script>
<script src="${env.SITE_URL}/js/gs-datepicker.min.js?v=${V}"></script>
<script src="${env.SITE_URL}/js/router.min.js?v=${V}"></script>
<script src="${env.SITE_URL}/js/script.js?v=${V}"></script>
<script src="${env.SITE_URL}/js/firebase.mjs?v=${V}" type="module"></script>
${insertPageContents(page, 'js')}
${settings.before_closing_body ?? ''}
</body>
</html>`;
}

/** Full document for /admin (port of admin/index.php). */
export function renderAdminShell(ctx: Ctx, page: Page): string {
  const { S, settings } = ctx;
  const A = (type: any, p: string) => hasAccess(ctx, type, p);
  const logo = S.theme === 'light' ? settings.logo_light : settings.logo_dark;
  let nav = '';
  if (ctx.isLoggedIn) {
    const sub = (id: string, icon: string, label: string, items: string) => `<li>
				<a href="#" id="nav-${id}" class="waves has-submenu"><span class="material-icons">${icon}</span> ${label} <span class="material-icons right">arrow_drop_down</span></a>
				<div class="dropdown no-auto-init" data-trigger="#nav-${id}"><ul>${items}</ul></div></li>`;
    const li = (href: string, label: string) => `<li><a href="${href}" class="waves">${label}</a></li>`;
    nav = `<nav class="navigation fixed">
		<ul class="desktop-nav">
			<li><button type="button" class="sidenav-trigger btn icon"><span class="material-icons">menu</span></button></li>
			<li class="logo left"><img src="../img/logo/${esc(logo)}"></li>
			<li><a href="profile">My Account</a></li>
			<li><a href="../login?logout=1">Logout</a></li>
		</ul>
		<ul class="mobile-nav">
			<li><button type="button" class="sidenav-trigger btn icon"><span class="material-icons">menu</span></button></li>
			<li class="logo left"><img src="../img/logo/${esc(logo)}"></li>
			<li class="tooltip" title="My Account"><a href="profile" class="btn icon"><span class="material-icons">account_circle</span></a></li>
			<li class="tooltip" title="Logout"><a href="../login?logout=1" class="btn icon"><span class="material-icons">power_settings_new</span></a></li>
		</ul>
	</nav>
	<ul id="side-nav" class="sidenav fixed" data-trigger=".sidenav-trigger">
		<li><a class="waves" href="${env.SITE_URL}/admin/"><span class="material-icons">dashboard</span> Dashboard</a></li>
		${A('view', 'production') ? sub('production', 'factory', 'Production', li('production-logs', 'Production Logs') + li('maintenance-tasks', 'Maintenance Tasks') + li('resins', 'Resins') + li('products', 'Products') + li('machines', 'Machines')) : ''}
		${A('view', 'dispatches') || A('view', 'clients') || A('view', 'transporters')
        ? sub('delivery', 'local_shipping', 'Delivery', (A('view', 'dispatches') ? li('dispatches', 'Dispatches') : '') + (A('view', 'clients') ? li('clients', 'Clients') : '') + (A('view', 'transporters') ? li('transporters', 'Transporters') : '')) : ''}
		${A('view', 'vehicles') ? `<li><a href="vehicles" class="waves"><span class="material-icons">two_wheeler</span> Vehicles</a></li>` : ''}
		${A('view', 'receiving_notes') ? sub('gate', 'door_sliding', 'Gate', li('receiving-notes?t=grn', 'GRN Register') + li('receiving-notes?t=srn', 'SRN Register')) : ''}
		${A('view', 'departments') ? `<li><a href="departments" class="waves"><span class="material-icons">account_tree</span> Departments</a></li>` : ''}
		${A('view', 'registers') ? `<li><a href="registers" class="waves"><span class="material-icons">format_list_numbered</span> Registers</a></li>` : ''}
		${A('view', 'staff') || A('view', 'admins') || A('view', 'admin_profiles')
        ? sub('accounts', 'people', 'Accounts', (A('view', 'staff') ? li('staff-accounts', 'Staff') : '') + (A('view', 'admins') ? li('admins', 'Admins') : '') + (A('view', 'admin_profiles') ? `<li class="divider"></li>` + li('staff-roles', 'Staff Roles') + li('admin-profiles', 'Admin Profiles') : '')) : ''}
		${A('view', 'settings') ? `<li><a href="settings" class="waves"><span class="material-icons">settings</span> Site Settings</a></li>` : ''}
		<li class="divider"></li>
		<li><a href="../login?logout=1" class="waves">Logout</a></li>
	</ul>`;
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<title>${esc(page.metaTitle ?? '')}</title>
	<meta name="description" content="">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="manifest" href="../manifest.webmanifest">
	<meta name="theme-color" media="(prefers-color-scheme: light)" content="#1d6586">
	<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#8fcef3">
	${themeLinks(ctx, '/admin/css/style.css')}
	<link rel="icon" href="${env.SITE_URL}/img/logo/favicon-32.png" sizes="any">
	<link rel="apple-touch-icon" href="${env.SITE_URL}/img/logo/favicon-180.png">
	${insertPageContents(page, 'css')}
</head>
<body>
	${nav}
	<main class="sidenav-active">${str(page.content ?? '')}</main>
<script type="text/javascript">
const config = {
  site_url: ${JSON.stringify(env.SITE_URL)},
  recaptcha_key: ${JSON.stringify(env.RECAPTCHA_KEY)},
  isLoggedIn: ${ctx.isLoggedIn ? 'true' : 'false'},
}
</script>
<script src="${env.SITE_URL}/js/dayjs.min.js?v=${V}"></script>
<script src="${env.SITE_URL}/js/glowingstone.min.js?v=${V}"></script>
<script src="${env.SITE_URL}/js/gs-datepicker.min.js?v=${V}"></script>
<script src="${env.SITE_URL}/js/gs-datatable.min.js?v=${V}"></script>
<script src="${env.SITE_URL}/js/gs-richeditor.min.js?v=${V}"></script>
<script src="${env.SITE_URL}/js/router.min.js?v=${V}"></script>
<script src="${env.SITE_URL}/admin/js/script.js?v=${V}"></script>
${insertPageContents(page, 'js')}
</body>
</html>`;
}
